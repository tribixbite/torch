/**
 * Keepa pipeline for the /setup Pixel 8 Pro case browser.
 *
 * Phase 1 (discovery): Product Finder query for "pixel 8 pro case" → ASINs
 *                      written to asin_pool.
 * Phase 2 (enrich):    For each parent ASIN, fetch product with stats &
 *                      variations. Insert one row per variation (color)
 *                      into case_variations, dropping any without weight.
 *
 * Token budget is checked before each call. If insufficient, we wait or
 * exit (the Playwright fallback can take over in parallel).
 *
 * Keepa weight fields are in grams (validated against API source).
 * Keepa rating is on a 0-50 scale (divide by 10 for stars).
 * Keepa stats.current[1] is current NEW price in cents.
 *
 * Usage:
 *   bun scripts/setup-cases-keepa.ts discover           # find ASINs
 *   bun scripts/setup-cases-keepa.ts enrich [N]         # enrich N parents (default 5)
 *   bun scripts/setup-cases-keepa.ts run                # discover + enrich loop
 */
import Database from 'bun:sqlite';
import { resolve } from 'path';

const DB_PATH = resolve(process.env.HOME!, 'git/torch/pipeline-data/db/setup.sqlite');
const KEEPA_KEY = process.env.KEEPA_API_KEY;
const DOMAIN = 1; // Amazon US
const SEARCH_KEYWORD = 'pixel 8 pro case';
const ENRICH_BATCH = 5; // ASINs per /product call (1 token each, batched is fine)
const POLL_INTERVAL_MS = 60_000; // when waiting for token refill

if (!KEEPA_KEY) {
  console.error('Missing KEEPA_API_KEY in env');
  process.exit(1);
}

const db = new Database(DB_PATH);
db.exec('PRAGMA busy_timeout = 30000');

interface KeepaTokenStatus {
  tokensLeft: number;
  refillRate: number;
  refillIn: number;
}

interface VariationAttribute { dimension: string; value: string; }
interface Variation {
  asin: string;
  attributes: VariationAttribute[];
  image: string;
}
interface KeepaStats {
  current?: number[];     // [AMAZON, NEW, USED, ...] in cents
  rating?: number;        // 0-50 (or -1 if unknown)
  reviewCount?: number;
}
interface KeepaProduct {
  asin: string;
  parentAsin?: string;
  title?: string;
  itemWeight?: number;    // grams
  packageWeight?: number; // grams
  imagesCSV?: string;
  variations?: Variation[];
  stats?: KeepaStats;
}
interface KeepaProductResponse {
  tokensLeft: number;
  refillIn: number;
  refillRate: number;
  products: KeepaProduct[];
}
interface KeepaQueryResponse {
  tokensLeft: number;
  refillIn: number;
  refillRate: number;
  asinList: string[];
  totalResults?: number;
}

async function getTokens(): Promise<KeepaTokenStatus> {
  const r = await fetch(`https://api.keepa.com/token?key=${KEEPA_KEY}`);
  return await r.json() as KeepaTokenStatus;
}

async function waitForTokens(min: number): Promise<void> {
  while (true) {
    const t = await getTokens();
    if (t.tokensLeft >= min) return;
    const need = min - t.tokensLeft;
    const waitMs = Math.max(POLL_INTERVAL_MS, (need / t.refillRate) * 60_000);
    console.log(`  waiting ${(waitMs / 1000).toFixed(0)}s for ${need} tokens (have ${t.tokensLeft}, refill ${t.refillRate}/min)`);
    await new Promise(r => setTimeout(r, Math.min(waitMs, POLL_INTERVAL_MS)));
  }
}

async function discoverAsins(): Promise<number> {
  console.log(`[discover] Product Finder for "${SEARCH_KEYWORD}"`);
  await waitForTokens(50); // Product Finder is more expensive than a regular product call

  const body = {
    title: SEARCH_KEYWORD,
    perPage: 10000,
    page: 0,
  };
  const url = `https://api.keepa.com/query?key=${KEEPA_KEY}&domain=${DOMAIN}&selection=${encodeURIComponent(JSON.stringify(body))}`;
  const r = await fetch(url);
  if (!r.ok) {
    console.error(`Product Finder HTTP ${r.status}: ${await r.text()}`);
    return 0;
  }
  const data = await r.json() as KeepaQueryResponse;
  console.log(`  tokensLeft after query: ${data.tokensLeft}, asinList length: ${data.asinList?.length ?? 0}, totalResults: ${data.totalResults ?? '?'}`);

  if (!data.asinList?.length) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO asin_pool (asin, source) VALUES (?, 'keepa-finder')
  `);
  const tx = db.transaction((asins: string[]) => {
    for (const a of asins) insert.run(a);
  });
  tx(data.asinList);

  const newCount = db.prepare(`SELECT COUNT(*) as n FROM asin_pool WHERE source='keepa-finder'`).get() as { n: number };
  console.log(`  asin_pool now has ${newCount.n} entries from keepa-finder`);
  return data.asinList.length;
}

function pickWeight(p: KeepaProduct): number | null {
  if (p.itemWeight && p.itemWeight > 0) return p.itemWeight;
  if (p.packageWeight && p.packageWeight > 0) return p.packageWeight;
  return null;
}

function colorOf(v: Variation): string | null {
  const attr = v.attributes?.find(a => /color|colour|pattern|style/i.test(a.dimension));
  return attr?.value ?? v.attributes?.[0]?.value ?? null;
}

function imageUrl(filename: string | null | undefined): string | null {
  if (!filename) return null;
  return `https://m.media-amazon.com/images/I/${filename}`;
}

function firstImage(csv: string | undefined): string | null {
  if (!csv) return null;
  return imageUrl(csv.split(',')[0]);
}

async function enrichBatch(asins: string[]): Promise<{ inserted: number; noWeight: number; tokensLeft: number }> {
  await waitForTokens(asins.length * 2); // ~2 tokens per ASIN (product + stats overhead)

  const url = `https://api.keepa.com/product?key=${KEEPA_KEY}&domain=${DOMAIN}&asin=${asins.join(',')}&stats=1&buybox=1`;
  const r = await fetch(url);
  if (!r.ok) {
    console.error(`product API HTTP ${r.status}: ${await r.text()}`);
    return { inserted: 0, noWeight: 0, tokensLeft: 0 };
  }
  const data = await r.json() as KeepaProductResponse;

  const insertVar = db.prepare(`
    INSERT OR REPLACE INTO case_variations
      (variation_asin, parent_asin, title, color_or_pattern,
       weight_g, weight_raw, price_usd, stars, review_count,
       thumbnail_url, amazon_url, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'keepa')
  `);
  const updatePool = db.prepare(`
    UPDATE asin_pool SET enriched_at = datetime('now'), enrich_status = ?, enrich_source = 'keepa'
    WHERE asin = ?
  `);

  let inserted = 0;
  let noWeight = 0;

  const tx = db.transaction((products: KeepaProduct[]) => {
    for (const p of products) {
      const weight = pickWeight(p);
      if (!weight) {
        updatePool.run('no-weight', p.asin);
        noWeight++;
        continue;
      }
      const stars = p.stats?.rating != null && p.stats.rating > 0 ? p.stats.rating / 10 : null;
      const reviewCount = p.stats?.reviewCount && p.stats.reviewCount > 0 ? p.stats.reviewCount : null;
      const priceCents = p.stats?.current?.[1]; // index 1 = NEW
      const price = priceCents != null && priceCents > 0 ? priceCents / 100 : null;
      const parentImage = firstImage(p.imagesCSV);
      const title = p.title ?? '';

      const variations = p.variations?.length ? p.variations : null;

      if (!variations) {
        // Single-variation listing: insert the parent itself as one row
        if (!parentImage) { updatePool.run('no-image', p.asin); continue; }
        insertVar.run(
          p.asin, p.asin, title, null,
          weight, `${weight}g`, price, stars, reviewCount,
          parentImage, `https://www.amazon.com/dp/${p.asin}`,
        );
        inserted++;
        updatePool.run('ok', p.asin);
        continue;
      }

      let variationsInserted = 0;
      for (const v of variations) {
        const img = imageUrl(v.image) ?? parentImage;
        if (!img) continue;
        insertVar.run(
          v.asin, p.asin, title, colorOf(v),
          weight, `${weight}g`, price, stars, reviewCount,
          img, `https://www.amazon.com/dp/${v.asin}`,
        );
        variationsInserted++;
      }
      inserted += variationsInserted;
      updatePool.run(variationsInserted > 0 ? 'ok' : 'no-image', p.asin);
    }
  });
  tx(data.products);

  return { inserted, noWeight, tokensLeft: data.tokensLeft };
}

async function enrich(limit: number): Promise<void> {
  const queue = db.prepare(`
    SELECT asin FROM asin_pool
    WHERE enriched_at IS NULL
    ORDER BY discovered_at ASC
    LIMIT ?
  `).all(limit) as { asin: string }[];

  if (!queue.length) {
    console.log('[enrich] queue empty');
    return;
  }
  console.log(`[enrich] processing ${queue.length} ASINs in batches of ${ENRICH_BATCH}`);

  let totalInserted = 0;
  let totalNoWeight = 0;
  for (let i = 0; i < queue.length; i += ENRICH_BATCH) {
    const batch = queue.slice(i, i + ENRICH_BATCH).map(r => r.asin);
    const { inserted, noWeight, tokensLeft } = await enrichBatch(batch);
    totalInserted += inserted;
    totalNoWeight += noWeight;
    console.log(`  batch ${i / ENRICH_BATCH + 1}: +${inserted} variations, ${noWeight} no-weight, tokensLeft=${tokensLeft}`);
  }
  console.log(`[enrich] done: +${totalInserted} variations, ${totalNoWeight} dropped (no weight)`);
}

const cmd = process.argv[2] ?? 'run';

(async () => {
  if (cmd === 'discover' || cmd === 'run') {
    await discoverAsins();
  }
  if (cmd === 'enrich' || cmd === 'run') {
    const n = parseInt(process.argv[3] ?? '20', 10);
    await enrich(n);
  }
  if (cmd !== 'discover' && cmd !== 'enrich' && cmd !== 'run') {
    console.error(`Unknown command: ${cmd}. Use: discover | enrich [N] | run`);
    process.exit(1);
  }
  db.close();
})();
