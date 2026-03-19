#!/usr/bin/env bun
/**
 * Scrape Nightstick product prices from OpticsPlanet individual product pages.
 * Step 1: Get product URLs from listing pages
 * Step 2: Fetch each product page, extract model+price from JSON-LD
 * Step 3: Match against our DB by Nightstick model number
 */
import { Database } from 'bun:sqlite';

const dbPath = `${import.meta.dir}/../pipeline-data/db/torch.sqlite`;
const db = new Database(dbPath, { strict: true });
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 30000');

const updatePrice = db.prepare(`UPDATE flashlights SET price_usd = ? WHERE id = ?`);

// Get our Nightstick entries without price
const entries = db.prepare(`
  SELECT id, model FROM flashlights
  WHERE brand = 'Nightstick'
    AND (price_usd IS NULL OR price_usd <= 0)
    AND json_extract(type,'$[0]') NOT IN ('accessory','blog','not_flashlight')
`).all() as { id: string; model: string }[];

console.log(`${entries.length} Nightstick entries need price`);

// Extract model number from our model string
function extractModelNum(model: string): string | null {
  // Match Nightstick model number patterns including suffixes like XL, XLB
  // Also handle MT-90, MT-100G etc. (2-digit models)
  const m = model.match(/^([A-Z]{2,4}-\d{2,5}[A-Z]{0,3}\d?)/);
  return m ? m[1] : null;
}

// Build lookup: model number → entries
const modelToEntries = new Map<string, { id: string; model: string }[]>();
for (const e of entries) {
  const num = extractModelNum(e.model);
  if (num) {
    const key = num.toUpperCase();
    if (!modelToEntries.has(key)) modelToEntries.set(key, []);
    modelToEntries.get(key)!.push(e);
  }
}
console.log(`${modelToEntries.size} unique model numbers`);

const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36';

function fetchPage(url: string): string {
  const proc = Bun.spawnSync([
    'curl', '-s', '-L', '--compressed', '--max-time', '20',
    '-H', `User-Agent: ${UA}`,
    '-H', 'Accept-Language: en-US,en;q=0.9',
    url,
  ]);
  return proc.stdout.toString();
}

// Step 1: Get all product URLs from listing pages (paginate fully)
const productUrls = new Set<string>();
const bases = ['nightstick-brand', 'nightstick-flashlights'];
const MAX_PAGES = 15;

for (const base of bases) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://www.opticsplanet.com/${base}.html?_iv_page=${page}`;
    const html = fetchPage(url);
    const urlRe = /href="(https:\/\/www\.opticsplanet\.com\/nightstick-[^"]*\.html)"/g;
    let m;
    const before = productUrls.size;
    while ((m = urlRe.exec(html)) !== null) {
      const u = m[1];
      if (u.includes('_iv_page') || u.endsWith('brand.html') || u.endsWith('flashlights.html')) continue;
      productUrls.add(u);
    }
    const added = productUrls.size - before;
    if (page % 5 === 0) console.log(`  ${base} page ${page}: ${added} new (${productUrls.size} total)`);
    await Bun.sleep(1500);
  }
}

console.log(`Found ${productUrls.size} product URLs`);

// Step 2: Fetch each product page, extract all variant model+price pairs
const allPrices = new Map<string, number>();
const modelRe = /((?:NSP|NSR|TAC|USB|XPP|XPR|SFL|TSM|MTU?|VM|LGL|LGC|NSM|DCL|FDL|TWM|TCM|MT)-\d{3,5}[A-Z]{0,3}\d?)/gi;

/** Extract all Nightstick model numbers from a string */
function extractModels(text: string): string[] {
  const matches: string[] = [];
  let mm;
  const re = new RegExp(modelRe.source, 'gi');
  while ((mm = re.exec(text)) !== null) {
    matches.push(mm[1].toUpperCase());
  }
  return matches;
}

let i = 0;
for (const url of productUrls) {
  i++;
  const html = fetchPage(url);
  if (!html || html.length < 1000) continue;

  // Extract JSON-LD product data
  const jsonLdRe = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let jm;
  while ((jm = jsonLdRe.exec(html)) !== null) {
    try {
      const data = JSON.parse(jm[1]);
      if (data['@type'] !== 'Product') continue;

      // Check offers (may be array or single)
      const offers = data.offers;
      const offerList = Array.isArray(offers) ? offers : offers ? [offers] : [];

      for (const offer of offerList) {
        const sku = offer.sku || '';
        const price = parseFloat(offer.price || offer.lowPrice || '0');
        if (price < 10 || price > 2000) continue;

        // Try SKU first, then product name/description
        let models = extractModels(sku);
        if (models.length === 0) {
          models = extractModels(data.name || '');
        }
        if (models.length === 0) {
          models = extractModels(data.description || '');
        }

        for (const model of models) {
          if (!allPrices.has(model) || price < allPrices.get(model)!) {
            allPrices.set(model, price);
          }
        }
      }

      // Also try product-level name if no offers had models
      if (offerList.length > 0) {
        const topPrice = parseFloat(
          data.offers?.lowPrice || data.offers?.price ||
          offerList[0]?.price || offerList[0]?.lowPrice || '0'
        );
        if (topPrice >= 10 && topPrice <= 2000) {
          const nameModels = extractModels(data.name || '');
          for (const model of nameModels) {
            if (!allPrices.has(model)) {
              allPrices.set(model, topPrice);
            }
          }
        }
      }
    } catch {}
  }

  if (i % 10 === 0) {
    console.log(`  Progress: ${i}/${productUrls.size} pages, ${allPrices.size} model+price pairs`);
  }
  await Bun.sleep(2000); // Rate limit
}

console.log(`\nExtracted ${allPrices.size} model+price pairs from OpticsPlanet`);

// Step 3: Match against our DB
let totalPriced = 0;
const tx = db.transaction(() => {
  for (const [model, price] of allPrices) {
    const entries = modelToEntries.get(model);
    if (entries) {
      for (const e of entries) {
        updatePrice.run(price, e.id);
        totalPriced++;
      }
      console.log(`  ${model}: $${price.toFixed(2)} (${entries.length} entries)`);
    }
    // Also try without trailing letters (e.g., "USB-558XL" matches "USB-558XLB")
    for (const [key, entryList] of modelToEntries) {
      if (key.startsWith(model) && key !== model && !allPrices.has(key)) {
        for (const e of entryList) {
          updatePrice.run(price, e.id);
          totalPriced++;
        }
        console.log(`  ${model} → ${key}: $${price.toFixed(2)} (${entryList.length} entries, prefix match)`);
      }
    }
  }
});
tx();

console.log(`\nResults: ${totalPriced} prices updated`);
db.close();
