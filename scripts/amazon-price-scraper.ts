/**
 * Scrape current Amazon prices using Playwright.
 * No extensions needed — just loads Amazon product pages and extracts price.
 *
 * Usage: bun scripts/amazon-price-scraper.ts [ASIN...]
 * Or: bun scripts/amazon-price-scraper.ts --db [limit]  (pull ASINs from DB)
 */
import { chromium } from '/data/data/com.termux/files/home/.bun/install/global/node_modules/playwright-core';
import Database from 'bun:sqlite';
import { resolve } from 'path';

const USER_DATA = resolve(process.env.HOME!, '.cache/amazon-playwright-profile');
const DB_PATH = resolve(process.env.HOME!, 'git/torch/pipeline-data/db/torch.sqlite');
const CRAWL_DELAY = 3000; // ms between pages

interface PriceResult {
  asin: string;
  price: number | null;
  title: string | null;
  error?: string;
}

/** Get ASINs that need pricing from the DB */
function getAsinsFromDb(limit: number): string[] {
  const db = new Database(DB_PATH, { readonly: true });
  // Flashlights with an ASIN but no price, or price is old
  const rows = db.prepare(`
    SELECT DISTINCT f.asin FROM flashlights f
    WHERE f.asin IS NOT NULL AND f.asin != ''
      AND (f.price_usd IS NULL OR f.price_usd = 0 OR f.price_usd = '')
    ORDER BY CASE f.brand
      WHEN 'Wurkkos' THEN 1 WHEN 'Skilhunt' THEN 2 WHEN 'Sofirn' THEN 3
      WHEN 'Nitecore' THEN 4 WHEN 'Fenix' THEN 5 WHEN 'Acebeam' THEN 6
      WHEN 'Zebralight' THEN 7 WHEN 'Olight' THEN 8 WHEN 'ThruNite' THEN 9
      WHEN 'Streamlight' THEN 10 WHEN 'Armytek' THEN 11 WHEN 'Emisar' THEN 12
      WHEN 'Noctigon' THEN 13 WHEN 'Convoy' THEN 14 WHEN 'Wuben' THEN 15
      WHEN 'Rovyvon' THEN 16 WHEN 'Lumintop' THEN 17 WHEN 'Imalent' THEN 18
      ELSE 99
    END, f.brand
    LIMIT ?
  `).all(limit) as { asin: string }[];
  db.close();
  return rows.map(r => r.asin);
}

async function main() {
  let asins: string[];

  if (process.argv[2] === '--db') {
    const limit = parseInt(process.argv[3] || '20', 10);
    asins = getAsinsFromDb(limit);
    console.log(`Loaded ${asins.length} ASINs from DB (limit ${limit})`);
  } else if (process.argv.length > 2) {
    asins = process.argv.slice(2);
  } else {
    asins = ['B0DGSKPL8F', 'B08JCM95X6', 'B0DH3CLSDB', 'B0D8123MXV', 'B0DKXVZGCW'];
  }

  if (asins.length === 0) {
    console.log('No ASINs to process');
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
  const results: PriceResult[] = [];
  let consecutiveFailures = 0;

  for (let i = 0; i < asins.length; i++) {
    const asin = asins[i];
    const url = `https://www.amazon.com/dp/${asin}`;

    try {
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });

      // Check for CAPTCHA
      const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 300) ?? '');
      if (bodyText.toLowerCase().includes('captcha') || bodyText.toLowerCase().includes('robot')) {
        console.log(`[${i + 1}/${asins.length}] ${asin} — CAPTCHA hit, stopping`);
        results.push({ asin, price: null, title: null, error: 'CAPTCHA' });
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          console.log('3 consecutive failures, aborting');
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
      console.log(`[${i + 1}/${asins.length}] ${asin} — $${priceNum ?? 'N/A'} — ${data.title?.slice(0, 60) ?? 'no title'}`);

      results.push({ asin, price: priceNum, title: data.title });
      consecutiveFailures = 0;

    } catch (err) {
      console.log(`[${i + 1}/${asins.length}] ${asin} — ERROR: ${(err as Error).message.slice(0, 80)}`);
      results.push({ asin, price: null, title: null, error: (err as Error).message.slice(0, 200) });
      consecutiveFailures++;
      if (consecutiveFailures >= 3) {
        console.log('3 consecutive failures, aborting');
        break;
      }
    }

    // Delay between requests
    if (i < asins.length - 1) {
      await page.waitForTimeout(CRAWL_DELAY);
    }
  }

  // Update DB with results
  const succeeded = results.filter(r => r.price !== null && r.price > 0);
  if (succeeded.length > 0) {
    const db = new Database(DB_PATH);
    db.exec('PRAGMA busy_timeout = 30000');
    const stmt = db.prepare('UPDATE flashlights SET price_usd = ? WHERE asin = ?');
    const tx = db.transaction(() => {
      for (const r of succeeded) {
        const changes = stmt.run(r.price, r.asin);
        if ((changes as any).changes > 0) {
          console.log(`  DB updated: ${r.asin} → $${r.price}`);
        }
      }
    });
    tx();
    db.close();
  }

  console.log(`\nDone: ${succeeded.length}/${results.length} prices scraped`);

  await context.close();
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
