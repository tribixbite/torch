#!/usr/bin/env bun
/**
 * Scrape Nightstick flashlight prices and update the torch.sqlite database.
 *
 * Grainger.com uses Datadome anti-bot protection that blocks all non-browser HTTP
 * clients (curl, fetch, etc.) regardless of headers, cookies, or user-agent. Direct
 * scraping is impossible without a full headless browser with JS execution.
 *
 * Strategy: scrape prices from OpticsPlanet's listing JSON (publicly accessible via
 * curl) which contains structured product data with model numbers and retail prices.
 * OpticsPlanet is a major Nightstick authorized dealer with competitive pricing.
 *
 * For items with hasOptions (multiple variants), we fetch the individual product page
 * and extract model+price from the JSON-LD structured data.
 *
 * Rate limited to 1 request per 3 seconds. Uses PRAGMA busy_timeout = 30000.
 */
import { Database } from 'bun:sqlite';

const DB_PATH = `${import.meta.dir}/../pipeline-data/db/torch.sqlite`;
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36';
const RATE_LIMIT_MS = 3000;
const BASE_URL = 'https://www.opticsplanet.com';
const LISTING_URL = `${BASE_URL}/nightstick-brand.html`;
const MAX_PAGES = 8; // 216 products / 60 per page = 4 pages, allow extra margin
const MIN_PRICE = 5; // ignore prices below $5 (likely accessories)
const MAX_PRICE = 2000; // sanity cap

// Nightstick model number regex — matches prefixes like NSP-1102, MT-90, TWM-854XL, etc.
const MODEL_RE = /\b((?:NSP|NSR|TAC|USB|XPP|XPR|SFL|TSM|MT|LGL|LGC|TWM|TCM|VM|FDL|DCL|NSM|SLR|NS)-\d{2,5}[A-Z]{0,4}\d?)\b/gi;

// ── DB setup ──────────────────────────────────────────────────────────────────
const db = new Database(DB_PATH, { strict: true });
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 30000');

const updatePrice = db.prepare(`UPDATE flashlights SET price_usd = ? WHERE id = ?`);

// Get Nightstick entries missing price (exclude known non-flashlights)
const entries = db.prepare(`
  SELECT id, model FROM flashlights
  WHERE brand = 'Nightstick'
    AND (price_usd IS NULL OR price_usd <= 0)
`).all() as { id: string; model: string }[];

console.log(`[db] ${entries.length} Nightstick entries need price`);

/** Extract model number prefix from our DB model string ("NSP-1102: Multi-Purpose LED..." → "NSP-1102") */
function extractModelNum(model: string): string | null {
  // Model field is "PREFIX-NUM...: Description"
  const m = model.match(/^([A-Z]{2,4}-\d{2,5}[A-Z]{0,4}\d?)/);
  return m ? m[1].toUpperCase() : null;
}

/** Extract all Nightstick model numbers from an arbitrary string */
function extractModels(text: string): string[] {
  const models: string[] = [];
  const re = new RegExp(MODEL_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    models.push(m[1].toUpperCase());
  }
  return [...new Set(models)];
}

// Build lookup: model number → list of DB entries needing price
const modelToEntries = new Map<string, { id: string; model: string }[]>();
for (const e of entries) {
  const num = extractModelNum(e.model);
  if (num) {
    if (!modelToEntries.has(num)) modelToEntries.set(num, []);
    modelToEntries.get(num)!.push(e);
  }
}
console.log(`[db] ${modelToEntries.size} unique model numbers to match\n`);

// ── HTTP fetch via curl ───────────────────────────────────────────────────────
function fetchPage(url: string): string {
  const proc = Bun.spawnSync([
    'curl', '-s', '-L', '--compressed', '--max-time', '20',
    '-H', `User-Agent: ${UA}`,
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    '-H', 'Accept-Language: en-US,en;q=0.9',
    url,
  ]);
  return proc.stdout.toString();
}

// ── Step 1: Attempt Grainger.com directly (expected to fail) ──────────────────
console.log('[grainger] Attempting Grainger.com direct access...');
const graingerTest = fetchPage('https://www.grainger.com/category/lighting/flashlights?brandName=NIGHTSTICK&filters=brandName');
const graingerBlocked = graingerTest.includes('Whoops') || graingerTest.includes('captcha-delivery') || graingerTest.length < 5000;

if (graingerBlocked) {
  console.log('[grainger] Blocked by Datadome anti-bot protection (expected)');
  console.log('[grainger] Falling back to OpticsPlanet listing data...\n');
} else {
  console.log('[grainger] Unexpectedly accessible — but this path is not implemented');
  console.log('[grainger] Proceeding with OpticsPlanet fallback anyway\n');
}

// ── Step 2: Scrape OpticsPlanet listing JSON ──────────────────────────────────
// Each listing page returns a JSON blob embedded in a <script> tag with up to 60 products
// including sku, price, fullName, url, productCode, etc.

interface OPElement {
  sku: string | null;
  price: number | null;
  fullName: string;
  url: string;
  productCode: string | null;
  hasOptions: number;
  variantCount: number;
  brandName: string;
}

/** Parse the productListConfig JSON from an OpticsPlanet listing page */
function parseListingJSON(html: string): { total: number; elements: OPElement[] } {
  const match = html.match(/var productListConfig = (\{[\s\S]*?\});/);
  if (!match) return { total: 0, elements: [] };
  try {
    const data = JSON.parse(match[1]);
    return {
      total: data.data?.total ?? 0,
      elements: data.data?.gridProducts?.elements ?? [],
    };
  } catch {
    return { total: 0, elements: [] };
  }
}

// Collect all model → price pairs from listing pages
const allPrices = new Map<string, number>(); // model → lowest price found
const variantUrls: string[] = []; // product URLs that need individual page fetch for variants

console.log('[opticsplanet] Fetching listing pages...');
let totalElements = 0;

for (let page = 1; page <= MAX_PAGES; page++) {
  const url = page === 1 ? LISTING_URL : `${LISTING_URL}?_iv_page=${page}`;
  const html = fetchPage(url);
  const { total, elements } = parseListingJSON(html);

  if (elements.length === 0) {
    console.log(`  Page ${page}: 0 elements — stopping pagination`);
    break;
  }

  let pageMatched = 0;
  for (const el of elements) {
    const price = el.price;
    if (price == null || price <= 0) continue;
    if (price < MIN_PRICE || price > MAX_PRICE) continue;

    const sku = el.sku || '';
    const productCode = el.productCode || '';
    const name = el.fullName || '';
    const elUrl = el.url || '';

    // Extract model from sku: format is "28X-FL-XPP-5410G" or "28X-FLW-TWML-TWM-854XL"
    // Model is embedded after the productCode prefix
    let models: string[] = [];

    // Try SKU first (most reliable source of model number)
    if (sku) {
      // Strip the OpticsPlanet prefix (productCode + dash) to get the model part
      let modelPart = sku;
      if (productCode && sku.startsWith(productCode + '-')) {
        modelPart = sku.slice(productCode.length + 1);
      }
      models = extractModels(modelPart);
      // Also try the full SKU if the stripped part didn't yield results
      if (models.length === 0) {
        models = extractModels(sku);
      }
    }

    // If no model found in SKU, try the product name
    if (models.length === 0) {
      models = extractModels(name);
    }

    // If no model found in name, try the URL slug
    if (models.length === 0) {
      models = extractModels(elUrl.replace(/-/g, ' '));
    }

    // For items with multiple variants (hasOptions=1), queue for individual page fetch
    if (el.hasOptions && models.length === 0) {
      variantUrls.push(`${BASE_URL}/${elUrl}.html`);
      continue;
    }

    for (const model of models) {
      // Only store the lowest price seen for each model
      if (!allPrices.has(model) || price < allPrices.get(model)!) {
        allPrices.set(model, price);
        pageMatched++;
      }
    }
  }

  totalElements += elements.length;
  console.log(`  Page ${page}: ${elements.length} elements, ${pageMatched} new model+price pairs (${allPrices.size} total)`);

  // Stop if we've seen all products
  if (totalElements >= total) {
    console.log(`  Reached total (${total}) — stopping pagination`);
    break;
  }

  await Bun.sleep(RATE_LIMIT_MS);
}

console.log(`\n[opticsplanet] ${allPrices.size} model+price pairs from listing pages`);
console.log(`[opticsplanet] ${variantUrls.length} multi-variant pages need individual fetch\n`);

// ── Step 3: Fetch individual variant pages for products with multiple options ─
if (variantUrls.length > 0) {
  console.log('[opticsplanet] Fetching variant product pages...');
  let variantMatched = 0;

  for (let i = 0; i < variantUrls.length; i++) {
    const url = variantUrls[i];
    const html = fetchPage(url);
    if (!html || html.length < 1000) continue;

    // Extract JSON-LD product data which has individual variant offers
    const jsonLdRe = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let jm: RegExpExecArray | null;

    while ((jm = jsonLdRe.exec(html)) !== null) {
      try {
        const data = JSON.parse(jm[1]);
        if (data['@type'] !== 'Product') continue;

        // Offers may be an array (AggregateOffer with multiple) or single
        const offers = data.offers;
        let offerList: any[] = [];
        if (Array.isArray(offers)) {
          offerList = offers;
        } else if (offers?.['@type'] === 'AggregateOffer' && Array.isArray(offers.offers)) {
          offerList = offers.offers;
        } else if (offers) {
          offerList = [offers];
        }

        for (const offer of offerList) {
          const price = parseFloat(offer.price || offer.lowPrice || '0');
          if (price < MIN_PRICE || price > MAX_PRICE) continue;

          const sku = String(offer.sku || '');
          const offerName = String(offer.name || data.name || '');

          let models = extractModels(sku);
          if (models.length === 0) models = extractModels(offerName);
          if (models.length === 0) models = extractModels(data.description || '');

          for (const model of models) {
            if (!allPrices.has(model) || price < allPrices.get(model)!) {
              allPrices.set(model, price);
              variantMatched++;
            }
          }
        }

        // Also try top-level product name if offers didn't yield model numbers
        if (offerList.length > 0) {
          const lowPrice = parseFloat(
            data.offers?.lowPrice || data.offers?.price ||
            offerList[0]?.price || offerList[0]?.lowPrice || '0'
          );
          if (lowPrice >= MIN_PRICE && lowPrice <= MAX_PRICE) {
            const nameModels = extractModels(data.name || '');
            for (const model of nameModels) {
              if (!allPrices.has(model)) {
                allPrices.set(model, lowPrice);
                variantMatched++;
              }
            }
          }
        }
      } catch {
        // Skip malformed JSON-LD
      }
    }

    if ((i + 1) % 5 === 0) {
      console.log(`  Progress: ${i + 1}/${variantUrls.length} variant pages, ${variantMatched} new matches`);
    }
    await Bun.sleep(RATE_LIMIT_MS);
  }

  console.log(`\n[opticsplanet] ${variantMatched} additional model+price pairs from variant pages`);
}

console.log(`\n[total] ${allPrices.size} model+price pairs collected`);

// ── Step 4: Match scraped prices against DB entries and update ─────────────────
let totalUpdated = 0;
let totalSkipped = 0;
const matched: string[] = [];
const unmatched: string[] = [];

const tx = db.transaction(() => {
  for (const [model, price] of allPrices) {
    // Direct match
    const directEntries = modelToEntries.get(model);
    if (directEntries) {
      for (const e of directEntries) {
        updatePrice.run(price, e.id);
        totalUpdated++;
      }
      matched.push(`  ${model}: $${price.toFixed(2)} (${directEntries.length} entries)`);
      continue;
    }

    // Prefix match: "USB-558XL" should match DB entry "USB-558XLS" or "USB-558XLLB"
    let prefixMatched = false;
    for (const [key, entryList] of modelToEntries) {
      if (key.startsWith(model) && key !== model && !allPrices.has(key)) {
        for (const e of entryList) {
          updatePrice.run(price, e.id);
          totalUpdated++;
        }
        matched.push(`  ${model} -> ${key}: $${price.toFixed(2)} (${entryList.length} entries, prefix)`);
        prefixMatched = true;
      }
    }

    if (!prefixMatched) {
      unmatched.push(model);
      totalSkipped++;
    }
  }
});
tx();

// ── Report ────────────────────────────────────────────────────────────────────
console.log('\n=== Results ===');
console.log(`Prices updated: ${totalUpdated}`);
console.log(`Models matched:`);
for (const m of matched.sort()) console.log(m);

if (unmatched.length > 0) {
  console.log(`\nModels found on retailer but not in our DB (${unmatched.length}):`);
  console.log(`  ${unmatched.sort().join(', ')}`);
}

// Show remaining gap
const remaining = db.prepare(`
  SELECT COUNT(*) as cnt FROM flashlights
  WHERE brand = 'Nightstick'
    AND (price_usd IS NULL OR price_usd <= 0)
`).get() as { cnt: number };

const total = db.prepare(`
  SELECT COUNT(*) as cnt FROM flashlights WHERE brand = 'Nightstick'
`).get() as { cnt: number };

const withPrice = total.cnt - remaining.cnt;
console.log(`\n[db] Nightstick: ${withPrice}/${total.cnt} now have price (${remaining.cnt} still missing)`);

db.close();
