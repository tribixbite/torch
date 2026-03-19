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
  const m = model.match(/^([A-Z]{2,4}-\d{3,5}[A-Z]{0,3}\d?)/);
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

// Step 1: Get all product URLs from listing pages
const productUrls = new Set<string>();
const listingPages = [
  'https://www.opticsplanet.com/nightstick-flashlights.html',
  'https://www.opticsplanet.com/nightstick-flashlights.html?_iv_page=2',
  'https://www.opticsplanet.com/nightstick-flashlights.html?_iv_page=3',
  'https://www.opticsplanet.com/nightstick-brand.html',
  'https://www.opticsplanet.com/nightstick-brand.html?_iv_page=2',
  'https://www.opticsplanet.com/nightstick-brand.html?_iv_page=3',
];

for (let i = 0; i < listingPages.length; i++) {
  console.log(`Listing page ${i + 1}/${listingPages.length}...`);
  const html = fetchPage(listingPages[i]);
  // Extract product page URLs
  const urlRe = /href="(https:\/\/www\.opticsplanet\.com\/nightstick-[^"]*\.html)"/g;
  let m;
  while ((m = urlRe.exec(html)) !== null) {
    const url = m[1];
    // Skip listing/category pages
    if (url.includes('_iv_page') || url.endsWith('brand.html') || url.endsWith('flashlights.html')) continue;
    productUrls.add(url);
  }
  if (i < listingPages.length - 1) await Bun.sleep(2000);
}

console.log(`Found ${productUrls.size} product URLs`);

// Step 2: Fetch each product page, extract all variant model+price pairs
const allPrices = new Map<string, number>();
const modelRe = /((?:NSP|NSR|TAC|USB|XPP|XPR|SFL|TSM|MTU?|VM|LGL|NSM|DCL)-\d{3,5}[A-Z]{0,3}\d?)/i;

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

        const mm = modelRe.exec(sku);
        if (mm) {
          const model = mm[1].toUpperCase();
          // Use lowest price for each model (best deal)
          if (!allPrices.has(model) || price < allPrices.get(model)!) {
            allPrices.set(model, price);
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
