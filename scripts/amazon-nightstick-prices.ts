#!/usr/bin/env bun
/**
 * Fetch Nightstick prices from Amazon product pages by ASIN.
 * Step 1: Get ASINs from Amazon search results for Nightstick
 * Step 2: Fetch each product page, extract model number + price
 * Step 3: Match against our DB entries missing price
 */
import { Database } from 'bun:sqlite';

const dbPath = `${import.meta.dir}/../pipeline-data/db/torch.sqlite`;
const db = new Database(dbPath, { strict: true });
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 30000');

const updatePrice = db.prepare(`UPDATE flashlights SET price_usd = ? WHERE id = ?`);
const updateAsin = db.prepare(`UPDATE flashlights SET asin = ? WHERE id = ?`);

// Get Nightstick entries without price
const entries = db.prepare(`
  SELECT id, model FROM flashlights
  WHERE brand = 'Nightstick'
    AND (price_usd IS NULL OR price_usd <= 0)
    AND json_extract(type,'$[0]') NOT IN ('accessory','blog','not_flashlight')
`).all() as { id: string; model: string }[];

console.log(`${entries.length} Nightstick entries need price`);

// Extract model number prefix (NSP-1102, MT-90, etc.)
function extractModelNum(model: string): string | null {
  const m = model.match(/^([A-Z]{2,4}-\d{2,5}[A-Z]{0,3}\d?)/);
  return m ? m[1].toUpperCase() : null;
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
    'curl', '-s', '-L', '--compressed', '--max-time', '15',
    '-H', `User-Agent: ${UA}`,
    '-H', 'Accept-Language: en-US,en;q=0.9',
    url,
  ]);
  return proc.stdout.toString();
}

// Step 1: Get ASINs from Amazon search
console.log('Fetching Nightstick ASINs from Amazon search...');
const asins = new Set<string>();
for (let page = 1; page <= 7; page++) {
  const html = fetchPage(`https://www.amazon.com/s?k=nightstick+flashlight&rh=p_89%3ANightstick&page=${page}`);
  const asinRe = /dp\/([A-Z0-9]{10})/g;
  let m;
  while ((m = asinRe.exec(html)) !== null) {
    asins.add(m[1]);
  }
  console.log(`  Search page ${page}: ${asins.size} total ASINs`);
  await Bun.sleep(2000);
}
console.log(`Found ${asins.size} unique ASINs`);

// Step 2: Fetch each product page, extract model + price
const modelRe = /((?:NSP|NSR|TAC|USB|XPP|XPR|SFL|TSM|MTU?|VM|LGL|LGC|NSM|DCL|FDL|TWM|TCM|MT)-\d{2,5}[A-Z]{0,3}\d?)/gi;
const allPrices = new Map<string, { price: number; asin: string }>();

let i = 0;
for (const asin of asins) {
  i++;
  const html = fetchPage(`https://www.amazon.com/dp/${asin}`);
  if (!html || html.length < 1000) {
    if (i % 10 === 0) console.log(`  Progress: ${i}/${asins.size} pages, ${allPrices.size} model+price pairs`);
    await Bun.sleep(3000);
    continue;
  }

  // Extract price — look for the main price pattern
  // Amazon shows "priceAmount":"XX.XX" or class="a-price" with value
  const pricePatterns = [
    /"priceAmount"\s*:\s*"(\d+\.?\d*)"/,
    /"price"\s*:\s*"?\$?(\d+\.?\d*)"?/,
    /class="a-price[^"]*"[^>]*>.*?<span[^>]*>.*?\$(\d+\.?\d*)/s,
  ];

  let price = 0;
  for (const pat of pricePatterns) {
    const pm = html.match(pat);
    if (pm) {
      const p = parseFloat(pm[1]);
      if (p >= 10 && p <= 2000) {
        price = p;
        break;
      }
    }
  }

  // Also try all $XX.XX patterns and pick the most common one in reasonable range
  if (price === 0) {
    const allPriceMatches = html.match(/\$(\d{1,4}\.\d{2})/g) || [];
    const priceCounts = new Map<number, number>();
    for (const pm of allPriceMatches) {
      const p = parseFloat(pm.replace('$', ''));
      if (p >= 10 && p <= 2000) {
        priceCounts.set(p, (priceCounts.get(p) || 0) + 1);
      }
    }
    // Use most frequent price (likely the actual listing price)
    let maxCount = 0;
    for (const [p, c] of priceCounts) {
      if (c > maxCount) {
        maxCount = c;
        price = p;
      }
    }
  }

  if (price === 0) {
    if (i % 10 === 0) console.log(`  Progress: ${i}/${asins.size} pages, ${allPrices.size} model+price pairs`);
    await Bun.sleep(3000);
    continue;
  }

  // Extract model numbers from title and page content
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/si);
  const title = titleMatch ? titleMatch[1] : '';

  // Also check the first 5000 chars for model numbers
  const searchText = (title + ' ' + html.substring(0, 5000)).toUpperCase();

  const re = new RegExp(modelRe.source, 'gi');
  let mm;
  while ((mm = re.exec(searchText)) !== null) {
    const model = mm[1].toUpperCase();
    if (!allPrices.has(model) || price < allPrices.get(model)!.price) {
      allPrices.set(model, { price, asin });
    }
  }

  if (i % 10 === 0) {
    console.log(`  Progress: ${i}/${asins.size} pages, ${allPrices.size} model+price pairs`);
  }
  await Bun.sleep(3000); // Rate limit
}

console.log(`\nExtracted ${allPrices.size} model+price pairs from Amazon`);

// Step 3: Match against DB
let totalPriced = 0;
const tx = db.transaction(() => {
  for (const [model, { price, asin }] of allPrices) {
    // Exact match
    const matched = modelToEntries.get(model);
    if (matched) {
      for (const e of matched) {
        updatePrice.run(price, e.id);
        updateAsin.run(asin, e.id);
        totalPriced++;
      }
      console.log(`  ${model}: $${price.toFixed(2)} (${matched.length} entries)`);
    }
    // Prefix match: model is prefix of DB model (e.g., NSP-1102 matches NSP-1102A)
    for (const [key, entryList] of modelToEntries) {
      if (key.startsWith(model) && key !== model && !allPrices.has(key)) {
        for (const e of entryList) {
          updatePrice.run(price, e.id);
          updateAsin.run(asin, e.id);
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
