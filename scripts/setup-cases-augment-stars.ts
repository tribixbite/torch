/**
 * Augment Keepa-sourced rows with stars/review_count/price by scraping
 * the parent ASIN's Amazon PDP. Keepa often returns null for these
 * fields even with stats=180, so we backfill via Playwright. One PDP
 * fetch updates every variation that shares that parent.
 *
 * Usage:
 *   bun scripts/setup-cases-augment-stars.ts [maxParents]
 */
import { chromium } from '/data/data/com.termux/files/home/.bun/install/global/node_modules/playwright-core';
import Database from 'bun:sqlite';
import { resolve } from 'path';

const DB_PATH = resolve(process.env.HOME!, 'git/torch/pipeline-data/db/setup.sqlite');
const USER_DATA = resolve(process.env.HOME!, '.cache/setup-cases-playwright-profile');
const CRAWL_DELAY = 3000;

const db = new Database(DB_PATH);
db.exec('PRAGMA busy_timeout = 30000');

const maxParents = parseInt(process.argv[2] ?? '50', 10);

// Pull parent ASINs that have variations missing stars (Keepa rows usually).
const parents = db.prepare(`
  SELECT parent_asin, COUNT(*) as variation_count
  FROM case_variations
  WHERE (stars IS NULL OR stars = 0)
  GROUP BY parent_asin
  ORDER BY variation_count DESC
  LIMIT ?
`).all(maxParents) as { parent_asin: string; variation_count: number }[];

if (!parents.length) {
  console.log('No parents need augmentation');
  process.exit(0);
}
console.log(`Augmenting ${parents.length} parents (covering ${parents.reduce((s, p) => s + p.variation_count, 0)} variations)`);

const updateChildren = db.prepare(`
  UPDATE case_variations
  SET stars = COALESCE(?, stars),
      review_count = COALESCE(?, review_count),
      price_usd = COALESCE(?, price_usd)
  WHERE parent_asin = ?
`);

interface ParentScrape {
  stars: number | null;
  reviewCount: number | null;
  priceUsd: number | null;
  status: 'ok' | 'unavailable' | 'captcha' | 'error';
}

async function scrapeParent(page: any, asin: string): Promise<ParentScrape> {
  const out: ParentScrape = { stars: null, reviewCount: null, priceUsd: null, status: 'error' };
  try {
    const r = await page.goto(`https://www.amazon.com/dp/${asin}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (r && r.status() === 404) { out.status = 'unavailable'; return out; }
  } catch { return out; }

  // Handle interstitial
  for (let i = 0; i < 2; i++) {
    const interstitial = await page.evaluate(() =>
      /click the button below to continue shopping/i.test(document.body?.innerText ?? '')
      && !document.querySelector('#productTitle')
    );
    if (!interstitial) break;
    try {
      await page.click('button.a-button-text, button[type="submit"], a.a-link-normal', { timeout: 3000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 12000 });
    } catch {
      try { await page.goto(`https://www.amazon.com/dp/${asin}`, { waitUntil: 'domcontentloaded', timeout: 20000 }); } catch {}
    }
  }
  try { await page.waitForSelector('#productTitle', { timeout: 6000 }); } catch {}

  const probe = await page.evaluate(() => ({
    snippet: (document.body?.innerText ?? '').slice(0, 300).toLowerCase(),
    hasTitle: !!document.querySelector('#productTitle'),
  }));
  if (/captcha|robot check|automated access/.test(probe.snippet)) { out.status = 'captcha'; return out; }
  if (!probe.hasTitle) { out.status = 'unavailable'; return out; }

  const ext = await page.evaluate(() => {
    const text = (sel: string) => (document.querySelector(sel) as HTMLElement | null)?.innerText?.trim() ?? null;
    let starsText = text('#acrPopover [aria-label]')
      ?? (document.querySelector('#acrPopover') as HTMLElement | null)?.title
      ?? text('span[data-hook="rating-out-of-text"]');
    if (!starsText) {
      const popover = document.querySelector('#averageCustomerReviews_feature_div .a-icon-alt') as HTMLElement | null;
      starsText = popover?.innerText ?? null;
    }
    const reviewsText = text('#acrCustomerReviewText') ?? text('[data-hook="total-review-count"]');
    const priceText = text('#corePrice_feature_div .a-offscreen')
      ?? text('#corePriceDisplay_desktop_feature_div .a-offscreen')
      ?? text('.priceToPay .a-offscreen')
      ?? text('.a-price .a-offscreen');
    return { starsText, reviewsText, priceText };
  });

  if (ext.starsText) {
    const m = ext.starsText.match(/([\d.]+)\s*out of\s*5/i) ?? ext.starsText.match(/^([\d.]+)/);
    if (m) out.stars = parseFloat(m[1]);
  }
  if (ext.reviewsText) {
    const m = ext.reviewsText.replace(/,/g, '').match(/(\d+)/);
    if (m) out.reviewCount = parseInt(m[1], 10);
  }
  if (ext.priceText) {
    const m = ext.priceText.replace(/[^\d.]/g, '').match(/[\d.]+/);
    if (m) out.priceUsd = parseFloat(m[0]);
  }
  out.status = 'ok';
  return out;
}

async function main() {
  const ctx = await chromium.launchPersistentContext(USER_DATA, {
    executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
    headless: process.env.DISPLAY ? false : true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-notifications', '--disable-dev-shm-usage'],
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = ctx.pages()[0] ?? await ctx.newPage();

  let updated = 0;
  for (const p of parents) {
    const r = await scrapeParent(page, p.parent_asin);
    const ok = r.status === 'ok' && (r.stars != null || r.reviewCount != null || r.priceUsd != null);
    if (ok) {
      const res = updateChildren.run(r.stars, r.reviewCount, r.priceUsd, p.parent_asin);
      updated += res.changes;
      console.log(`  ${p.parent_asin}: ${r.stars ?? '-'}* ${r.reviewCount ?? '-'} reviews $${r.priceUsd ?? '-'} → updated ${res.changes} variations`);
    } else {
      console.log(`  ${p.parent_asin}: ${r.status}`);
    }
    await new Promise(rr => setTimeout(rr, CRAWL_DELAY));
  }
  console.log(`Augment done: ${updated} rows updated`);
  await ctx.close();
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
