/**
 * Scrape current Amazon prices using Playwright.
 * Tracks results in `amazon_price_checks` table so cron and manual batches
 * share state and never re-scrape the same ASIN.
 *
 * Usage:
 *   bun scripts/amazon-price-scraper.ts [--db <limit>] [ASIN...]
 *   bun scripts/amazon-price-scraper.ts --db 50     # 50 from DB queue
 *   bun scripts/amazon-price-scraper.ts B0DGSKPL8F  # specific ASINs
 */
import { chromium } from '/data/data/com.termux/files/home/.bun/install/global/node_modules/playwright-core';
import Database from 'bun:sqlite';
import { resolve } from 'path';

const USER_DATA = resolve(process.env.HOME!, '.cache/amazon-playwright-profile');
const DB_PATH = resolve(process.env.HOME!, 'git/torch/pipeline-data/db/torch.sqlite');
const CRAWL_DELAY = 3000; // ms between pages

// Priority brands for queue ordering
const PRIORITY_BRANDS: Record<string, number> = {
  Wurkkos: 1, Skilhunt: 2, Sofirn: 3, Nitecore: 4, Fenix: 5, Acebeam: 6,
  Zebralight: 7, Olight: 8, ThruNite: 9, Streamlight: 10, Armytek: 11,
  Emisar: 12, Noctigon: 13, Convoy: 14, Wuben: 15, Rovyvon: 16,
  Lumintop: 17, Imalent: 18,
};

interface QueueRow { asin: string; brand: string; has_alt_url: number }

/** Ensure tracking table exists */
function initDb(db: Database): void {
  db.exec('PRAGMA busy_timeout = 30000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS amazon_price_checks (
      asin TEXT PRIMARY KEY,
      price_cents INTEGER,        -- null = unavailable
      status TEXT NOT NULL,        -- 'ok', 'unavailable', 'captcha', 'error'
      title TEXT,
      checked_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/** Get unchecked ASINs needing prices, ordered by priority brand */
function getQueue(db: Database, limit: number): QueueRow[] {
  return db.prepare(`
    SELECT f.asin, f.brand,
      CASE WHEN f.purchase_urls LIKE '%,"%' THEN 1 ELSE 0 END as has_alt_url
    FROM flashlights f
    WHERE f.asin IS NOT NULL AND f.asin != ''
      AND (f.price_usd IS NULL OR f.price_usd = 0 OR f.price_usd = '')
      AND f.asin NOT IN (SELECT asin FROM amazon_price_checks)
    ORDER BY CASE f.brand
      ${Object.entries(PRIORITY_BRANDS).map(([b, n]) => `WHEN '${b}' THEN ${n}`).join(' ')}
      ELSE 99
    END, f.brand
    LIMIT ?
  `).all(limit) as QueueRow[];
}

async function main() {
  const db = new Database(DB_PATH);
  initDb(db);

  let asins: string[];
  let fromDb = false;

  if (process.argv[2] === '--db') {
    const limit = parseInt(process.argv[3] || '20', 10);
    const queue = getQueue(db, limit);
    asins = queue.map(r => r.asin);
    fromDb = true;
    console.log(`Queue: ${asins.length} unchecked ASINs (limit ${limit})`);
    // Show brand breakdown
    const brands = new Map<string, number>();
    for (const r of queue) brands.set(r.brand, (brands.get(r.brand) ?? 0) + 1);
    const sorted = [...brands.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log('Brands:', sorted.map(([b, c]) => `${b}(${c})`).join(', '));
  } else if (process.argv.length > 2) {
    asins = process.argv.slice(2);
  } else {
    asins = ['B0DGSKPL8F', 'B08JCM95X6', 'B0DH3CLSDB'];
  }

  if (asins.length === 0) {
    console.log('No ASINs to process — queue empty');
    db.close();
    return;
  }

  console.log(`Scraping ${asins.length} Amazon prices...`);

  const context = await chromium.launchPersistentContext(USER_DATA, {
    executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
    headless: false,
    args: ['--no-sandbox', '--disable-gpu', '--disable-notifications'],
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = context.pages()[0] || await context.newPage();

  // Prepared statements for recording results
  const insertCheck = db.prepare(`
    INSERT OR REPLACE INTO amazon_price_checks (asin, price_cents, status, title, checked_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
  const updatePrice = db.prepare('UPDATE flashlights SET price_usd = ? WHERE asin = ?');

  let scraped = 0;
  let priced = 0;
  let unavailable = 0;
  let consecutiveFailures = 0;

  for (let i = 0; i < asins.length; i++) {
    const asin = asins[i];
    const url = `https://www.amazon.com/dp/${asin}`;

    try {
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });

      // Check for CAPTCHA
      const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 300) ?? '');
      if (bodyText.toLowerCase().includes('captcha') || bodyText.toLowerCase().includes('robot')) {
        console.log(`[${i + 1}/${asins.length}] ${asin} — CAPTCHA`);
        insertCheck.run(asin, null, 'captcha', null);
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          console.log('3 consecutive CAPTCHAs, aborting');
          break;
        }
        continue;
      }

      const data = await page.evaluate(() => {
        const priceEl = document.querySelector('.a-price .a-offscreen');
        const titleEl = document.querySelector('#productTitle');
        return {
          price: priceEl?.textContent?.trim() ?? null,
          title: titleEl?.textContent?.trim() ?? null,
        };
      });

      const priceNum = data.price ? parseFloat(data.price.replace(/[^0-9.]/g, '')) : null;
      const priceCents = priceNum ? Math.round(priceNum * 100) : null;

      if (priceNum && priceNum > 0) {
        // Available — update both tracking table and flashlights price
        insertCheck.run(asin, priceCents, 'ok', data.title);
        const changes = updatePrice.run(priceNum, asin);
        const dbNote = (changes as any).changes > 0 ? ' [DB]' : '';
        console.log(`[${i + 1}/${asins.length}] ${asin} — $${priceNum}${dbNote} — ${data.title?.slice(0, 55) ?? '?'}`);
        priced++;
      } else {
        // Unavailable — record in tracking table, DON'T set price
        insertCheck.run(asin, null, 'unavailable', data.title);
        console.log(`[${i + 1}/${asins.length}] ${asin} — UNAVAILABLE — ${data.title?.slice(0, 55) ?? 'no title'}`);
        unavailable++;
      }

      scraped++;
      consecutiveFailures = 0;

    } catch (err) {
      const msg = (err as Error).message.slice(0, 100);
      console.log(`[${i + 1}/${asins.length}] ${asin} — ERROR: ${msg}`);
      insertCheck.run(asin, null, 'error', msg);
      consecutiveFailures++;
      if (consecutiveFailures >= 3) {
        console.log('3 consecutive errors, aborting');
        break;
      }
    }

    if (i < asins.length - 1) {
      await page.waitForTimeout(CRAWL_DELAY);
    }
  }

  // Summary
  const totalChecked = db.prepare('SELECT COUNT(*) as c FROM amazon_price_checks').get() as any;
  const totalOk = db.prepare("SELECT COUNT(*) as c FROM amazon_price_checks WHERE status = 'ok'").get() as any;
  const totalUnavail = db.prepare("SELECT COUNT(*) as c FROM amazon_price_checks WHERE status = 'unavailable'").get() as any;
  const remaining = db.prepare(`
    SELECT COUNT(*) as c FROM flashlights
    WHERE asin IS NOT NULL AND asin != ''
      AND (price_usd IS NULL OR price_usd = 0 OR price_usd = '')
      AND asin NOT IN (SELECT asin FROM amazon_price_checks)
  `).get() as any;

  console.log(`\n=== Session: ${priced} priced, ${unavailable} unavailable, ${scraped} total ===`);
  console.log(`=== All-time: ${totalChecked.c} checked (${totalOk.c} ok, ${totalUnavail.c} unavailable) ===`);
  console.log(`=== Queue remaining: ${remaining.c} ===`);

  db.close();
  await context.close();
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
