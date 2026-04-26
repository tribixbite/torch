/**
 * Playwright fallback / parallel scraper for the /setup case browser.
 *
 * For each ASIN pulled from setup.sqlite asin_pool (or passed on argv),
 * navigate the Amazon PDP and extract:
 *   - title, stars, review count, current price, item weight
 *   - all per-variation swatches: ASIN, color name, swatch image
 *
 * Runs only on entries without a successful keepa enrichment, so it
 * complements the Keepa pipeline rather than duplicating it.
 *
 * Usage:
 *   DISPLAY=:1 bun scripts/setup-cases-playwright.ts --pool 20  # pull 20 from queue
 *   DISPLAY=:1 bun scripts/setup-cases-playwright.ts B0XXXXXXX  # specific ASINs
 */
import { chromium } from '/data/data/com.termux/files/home/.bun/install/global/node_modules/playwright-core';
import Database from 'bun:sqlite';
import { resolve } from 'path';

const DB_PATH = resolve(process.env.HOME!, 'git/torch/pipeline-data/db/setup.sqlite');
const USER_DATA = resolve(process.env.HOME!, '.cache/setup-cases-playwright-profile');
const CRAWL_DELAY = 3000;
const CAPTCHA_ABORT_AT = 3;

const db = new Database(DB_PATH);
db.exec('PRAGMA busy_timeout = 30000');

const insertVar = db.prepare(`
  INSERT OR REPLACE INTO case_variations
    (variation_asin, parent_asin, title, color_or_pattern,
     weight_g, weight_raw, price_usd, stars, review_count,
     thumbnail_url, amazon_url, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'playwright')
`);
const updatePool = db.prepare(`
  UPDATE asin_pool SET enriched_at = datetime('now'), enrich_status = ?, enrich_source = 'playwright'
  WHERE asin = ?
`);
const insertPool = db.prepare(`
  INSERT OR IGNORE INTO asin_pool (asin, source) VALUES (?, 'playwright-search')
`);

interface Variation {
  asin: string;
  color: string | null;
  image: string | null;
}
interface ScrapeResult {
  asin: string;
  title: string | null;
  weightRaw: string | null;
  weightG: number | null;
  priceUsd: number | null;
  stars: number | null;
  reviewCount: number | null;
  mainImage: string | null;
  variations: Variation[];
  status: 'ok' | 'no-weight' | 'unavailable' | 'captcha' | 'error';
  errorMsg?: string;
}

/**
 * Convert a weight string like "0.86 ounces", "24 g", "0.05 lb" to grams.
 * Returns null if no recognizable number/unit.
 */
function parseWeightToGrams(raw: string | null): number | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/,/g, '');
  const m = s.match(/([\d.]+)\s*(grams?|g|kilograms?|kg|ounces?|oz|pounds?|lbs?)\b/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const u = m[2];
  if (u.startsWith('kg') || u.startsWith('kilo')) return n * 1000;
  if (u === 'g' || u.startsWith('gram')) return n;
  if (u.startsWith('oz') || u.startsWith('ounce')) return n * 28.3495;
  if (u.startsWith('lb') || u.startsWith('pound')) return n * 453.592;
  return null;
}

async function scrapePdp(page: any, asin: string): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    asin, title: null, weightRaw: null, weightG: null,
    priceUsd: null, stars: null, reviewCount: null,
    mainImage: null, variations: [], status: 'error',
  };

  try {
    const resp = await page.goto(`https://www.amazon.com/dp/${asin}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    if (resp && resp.status() === 404) {
      result.status = 'unavailable';
      return result;
    }
  } catch (e) {
    result.errorMsg = (e as Error).message;
    return result;
  }

  // Handle the "Continue shopping" interstitial Amazon serves to suspected bots.
  // The page has a single button — clicking it reissues the request with a fresh anti-bot token.
  for (let attempt = 0; attempt < 2; attempt++) {
    const interstitial = await page.evaluate(() => {
      const txt = (document.body?.innerText ?? '').toLowerCase();
      return /click the button below to continue shopping|continue shopping/.test(txt) && !document.querySelector('#productTitle');
    });
    if (!interstitial) break;
    try {
      await page.click('button.a-button-text, button[type="submit"], a.a-link-normal', { timeout: 4000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
    } catch {
      // try a navigation back to the product URL — clicking sometimes lands on home
      try { await page.goto(`https://www.amazon.com/dp/${asin}`, { waitUntil: 'domcontentloaded', timeout: 20000 }); } catch {}
    }
  }

  try {
    await page.waitForSelector('#productTitle', { timeout: 8000 });
  } catch {
    // downstream check still records as unavailable
  }

  const probe = await page.evaluate(() => ({
    snippet: (document.body?.innerText ?? '').slice(0, 400).toLowerCase(),
    hasTitle: !!document.querySelector('#productTitle'),
  }));
  if (/captcha|robot check|automated access/.test(probe.snippet)) {
    result.status = 'captcha';
    return result;
  }
  if (!probe.hasTitle) {
    result.status = 'unavailable';
    result.errorMsg = probe.snippet.slice(0, 200);
    if (process.env.DEBUG) console.log(`    DEBUG ${asin}: ${probe.snippet.slice(0, 200)}`);
    return result;
  }

  const extracted = await page.evaluate(() => {
    const text = (sel: string) => (document.querySelector(sel) as HTMLElement | null)?.innerText?.trim() ?? null;

    const title = text('#productTitle');

    // Stars: "4.5 out of 5 stars" anywhere
    let starsText = text('#acrPopover [aria-label]') ??
      (document.querySelector('#acrPopover') as HTMLElement | null)?.title ??
      text('span[data-hook="rating-out-of-text"]');
    if (!starsText) {
      const popover = document.querySelector('#averageCustomerReviews_feature_div .a-icon-alt') as HTMLElement | null;
      starsText = popover?.innerText ?? null;
    }

    // Review count text
    const reviewsText = text('#acrCustomerReviewText') ?? text('[data-hook="total-review-count"]');

    // Current price
    const priceText = text('#corePrice_feature_div .a-offscreen') ??
      text('#corePriceDisplay_desktop_feature_div .a-offscreen') ??
      text('.priceToPay .a-offscreen') ??
      text('.a-price .a-offscreen');

    // Main image — the data-old-hires gives the largest version
    const mainImg = (document.querySelector('#landingImage, #imgTagWrapperId img') as HTMLImageElement | null);
    const mainImage = mainImg?.dataset.oldHires ?? mainImg?.src ?? null;

    // Weight: scan ALL prodDetTable / a-keyvalue rows + detail bullets for "Item Weight" or "Package Weight"
    let weightRaw: string | null = null;
    let isItemWeight = false;
    const allTables = Array.from(document.querySelectorAll(
      'table.prodDetTable, table.a-keyvalue, #productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr'
    )) as (HTMLTableElement | HTMLTableRowElement)[];
    const rows: HTMLTableRowElement[] = [];
    for (const t of allTables) {
      if (t.tagName === 'TABLE') {
        rows.push(...Array.from((t as HTMLTableElement).rows));
      } else {
        rows.push(t as HTMLTableRowElement);
      }
    }
    for (const row of rows) {
      const th = row.cells[0]?.innerText?.trim().toLowerCase() ?? '';
      const td = row.cells[1]?.innerText?.trim() ?? '';
      if (!td) continue;
      if (th === 'item weight') {
        weightRaw = td; isItemWeight = true; break;
      }
      if (!isItemWeight && /weight/.test(th) && /\d/.test(td)) {
        weightRaw = td;
        if (/item/.test(th)) { isItemWeight = true; break; }
      }
    }
    if (!weightRaw) {
      const bullets = Array.from(document.querySelectorAll('#detailBullets_feature_div li, #detailBulletsWrapper_feature_div li')) as HTMLElement[];
      for (const li of bullets) {
        const t = li.innerText.replace(/\s+/g, ' ').trim();
        const m = t.match(/(item weight|package weight|weight)\s*[:\u200f\u2019]*\s*([\d.]+\s*(?:g|gram|grams|kg|kilogram|oz|ounce|ounces|lb|lbs|pound|pounds))/i);
        if (m) { weightRaw = m[2].trim(); if (/item/i.test(m[1])) break; }
      }
    }

    // Variations: walk swatches, capture asin + color name + image
    const variations: { asin: string; color: string | null; image: string | null }[] = [];
    const swatches = Array.from(document.querySelectorAll(
      '#variation_color_name li[data-defaultasin], #variation_color_name li[data-csa-c-asin], #variation_pattern_name li[data-defaultasin]'
    )) as HTMLLIElement[];
    for (const li of swatches) {
      const a = li.dataset.defaultasin ?? li.dataset.csaCAsin ?? null;
      if (!a) continue;
      const img = li.querySelector('img') as HTMLImageElement | null;
      const color = (li.querySelector('.swatch-title-text-display') as HTMLElement | null)?.innerText?.trim()
        ?? img?.alt
        ?? null;
      variations.push({ asin: a, color, image: img?.src ?? null });
    }

    return { title, starsText, reviewsText, priceText, mainImage, weightRaw, variations };
  });

  result.title = extracted.title;
  result.mainImage = extracted.mainImage;
  result.weightRaw = extracted.weightRaw;
  result.weightG = parseWeightToGrams(extracted.weightRaw);

  if (extracted.starsText) {
    const m = extracted.starsText.match(/([\d.]+)\s*out of\s*5/i) ?? extracted.starsText.match(/^([\d.]+)/);
    if (m) result.stars = parseFloat(m[1]);
  }
  if (extracted.reviewsText) {
    const m = extracted.reviewsText.replace(/,/g, '').match(/(\d+)/);
    if (m) result.reviewCount = parseInt(m[1], 10);
  }
  if (extracted.priceText) {
    const m = extracted.priceText.replace(/[^\d.]/g, '').match(/[\d.]+/);
    if (m) result.priceUsd = parseFloat(m[0]);
  }
  result.variations = extracted.variations as Variation[];

  if (!result.weightG) {
    result.status = 'no-weight';
  } else {
    result.status = 'ok';
  }
  return result;
}

function persist(parentAsin: string, r: ScrapeResult): number {
  if (r.status !== 'ok' || !r.weightG || !r.title) {
    updatePool.run(r.status, parentAsin);
    return 0;
  }
  let inserted = 0;
  if (r.variations.length > 0) {
    for (const v of r.variations) {
      const img = v.image ?? r.mainImage;
      if (!img) continue;
      insertPool.run(v.asin); // make sure variation is in pool too
      insertVar.run(
        v.asin, parentAsin, r.title, v.color,
        r.weightG, r.weightRaw, r.priceUsd, r.stars, r.reviewCount,
        img, `https://www.amazon.com/dp/${v.asin}`,
      );
      inserted++;
    }
  } else if (r.mainImage) {
    insertVar.run(
      parentAsin, parentAsin, r.title, null,
      r.weightG, r.weightRaw, r.priceUsd, r.stars, r.reviewCount,
      r.mainImage, `https://www.amazon.com/dp/${parentAsin}`,
    );
    inserted = 1;
  }
  updatePool.run('ok', parentAsin);
  return inserted;
}

function getPoolBatch(limit: number): string[] {
  return (db.prepare(`
    SELECT asin FROM asin_pool
    WHERE enriched_at IS NULL
    ORDER BY discovered_at ASC
    LIMIT ?
  `).all(limit) as { asin: string }[]).map(r => r.asin);
}

async function discoverViaSearch(page: any, queries: string[], pagesPerQuery: number): Promise<number> {
  let added = 0;
  for (const q of queries) {
    for (let pg = 1; pg <= pagesPerQuery; pg++) {
      const url = `https://www.amazon.com/s?k=${encodeURIComponent(q)}&page=${pg}`;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (e) {
        console.log(`  search page failed: ${(e as Error).message}`);
        continue;
      }
      const found: string[] = await page.evaluate(() => {
        const results = Array.from(document.querySelectorAll('[data-asin][data-component-type="s-search-result"]')) as HTMLElement[];
        return results.map(el => el.dataset.asin ?? '').filter(Boolean);
      });
      let perPage = 0;
      for (const a of found) {
        const r = insertPool.run(a);
        if (r.changes > 0) perPage++;
      }
      added += perPage;
      console.log(`  "${q}" page ${pg}: ${found.length} results, +${perPage} new`);
      if (found.length === 0) break;
      await new Promise(r => setTimeout(r, CRAWL_DELAY));
    }
  }
  return added;
}

async function main() {
  const args = process.argv.slice(2);
  const ctxConfig = {
    executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
    headless: process.env.DISPLAY ? false : true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-notifications', '--disable-dev-shm-usage'],
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };

  if (args[0] === '--discover-search') {
    const pagesPerQuery = parseInt(args[1] ?? '3', 10);
    const queries = args.slice(2).length > 0 ? args.slice(2) : [
      'pixel 8 pro case', 'pixel 8 pro case slim', 'pixel 8 pro case thin',
      'pixel 8 pro case clear', 'pixel 8 pro case design', 'pixel 8 pro case pattern',
      'pixel 8 pro case galaxy', 'pixel 8 pro case nature', 'pixel 8 pro case tech',
    ];
    const ctx = await chromium.launchPersistentContext(USER_DATA, ctxConfig);
    const page = ctx.pages()[0] ?? await ctx.newPage();
    const added = await discoverViaSearch(page, queries, pagesPerQuery);
    console.log(`Discovery done: +${added} new ASINs in pool`);
    await ctx.close();
    db.close();
    return;
  }

  let asins: string[];
  if (args[0] === '--pool') {
    const n = parseInt(args[1] ?? '20', 10);
    asins = getPoolBatch(n);
    console.log(`Pulled ${asins.length} ASINs from pool`);
  } else if (args[0] === '--pool-random') {
    const n = parseInt(args[1] ?? '20', 10);
    asins = (db.prepare(`
      SELECT asin FROM asin_pool
      WHERE enriched_at IS NULL
      ORDER BY RANDOM() LIMIT ?
    `).all(n) as { asin: string }[]).map(r => r.asin);
    console.log(`Pulled ${asins.length} random ASINs from pool`);
  } else if (args[0] === '--pool-search') {
    // Only enrich ASINs discovered via Amazon search (clean pool)
    const n = parseInt(args[1] ?? '20', 10);
    asins = (db.prepare(`
      SELECT asin FROM asin_pool
      WHERE enriched_at IS NULL AND source = 'playwright-search'
      ORDER BY discovered_at ASC LIMIT ?
    `).all(n) as { asin: string }[]).map(r => r.asin);
    console.log(`Pulled ${asins.length} search-discovered ASINs from pool`);
  } else if (args[0] === '--pool-source') {
    const source = args[1];
    const n = parseInt(args[2] ?? '20', 10);
    asins = (db.prepare(`
      SELECT asin FROM asin_pool
      WHERE enriched_at IS NULL AND source = ?
      ORDER BY discovered_at ASC LIMIT ?
    `).all(source, n) as { asin: string }[]).map(r => r.asin);
    console.log(`Pulled ${asins.length} ASINs with source='${source}' from pool`);
  } else if (args.length > 0) {
    asins = args;
  } else {
    console.error('Usage: --discover-search [pagesPerQuery] | --pool N | --pool-search N | ASIN [ASIN...]');
    process.exit(1);
  }
  if (asins.length === 0) {
    console.log('Nothing to scrape');
    return;
  }

  const context = await chromium.launchPersistentContext(USER_DATA, ctxConfig);
  const page = context.pages()[0] ?? await context.newPage();

  let captchas = 0;
  let inserted = 0;
  for (const asin of asins) {
    const r = await scrapePdp(page, asin);
    const added = persist(asin, r);
    inserted += added;
    console.log(`  ${asin}: ${r.status}${r.weightG ? ` ${r.weightG.toFixed(1)}g` : ''}${added ? ` +${added} variations` : ''}`);
    if (r.status === 'captcha') {
      captchas++;
      if (captchas >= CAPTCHA_ABORT_AT) {
        console.log(`Aborting: ${captchas} consecutive CAPTCHAs`);
        break;
      }
    } else {
      captchas = 0;
    }
    await new Promise(r => setTimeout(r, CRAWL_DELAY));
  }
  console.log(`Total inserted: ${inserted}`);
  await context.close();
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
