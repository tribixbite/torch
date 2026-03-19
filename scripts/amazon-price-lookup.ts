#!/usr/bin/env bun
/**
 * Look up prices from Amazon product pages by ASIN.
 * Only fills EMPTY price_usd fields — never overwrites.
 * Uses curl to bypass basic bot detection.
 */
import { Database } from 'bun:sqlite';

const dbPath = `${import.meta.dir}/../pipeline-data/db/torch.sqlite`;
const db = new Database(dbPath, { strict: true });
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 30000');

// Get entries with ASIN but no price
const entries = db.prepare(`
  SELECT id, brand, model, asin
  FROM flashlights
  WHERE asin IS NOT NULL AND asin <> ''
    AND (price_usd IS NULL OR price_usd <= 0)
    AND json_extract(type,'$[0]') NOT IN ('accessory','blog','not_flashlight')
`).all() as { id: string; brand: string; model: string; asin: string }[];

console.log(`Found ${entries.length} entries with ASIN but no price`);

const updatePrice = db.prepare(`UPDATE flashlights SET price_usd = ? WHERE id = ?`);

let updated = 0;
let errors = 0;
const delay = 3000; // 3s between requests to avoid rate limiting

for (let i = 0; i < entries.length; i++) {
  const entry = entries[i];
  const url = `https://www.amazon.com/dp/${entry.asin}`;

  try {
    // Use curl with mobile UA to get price
    const proc = Bun.spawnSync([
      'curl', '-s', '-L', '--compressed', '--max-time', '15',
      '-H', 'User-Agent: Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36',
      '-H', 'Accept-Language: en-US,en;q=0.9',
      url,
    ]);

    const html = proc.stdout.toString();

    if (!html || html.length < 1000) {
      console.log(`  [${i+1}/${entries.length}] ${entry.brand} ${entry.model}: empty response`);
      errors++;
      continue;
    }

    // Extract prices from the page
    const priceMatches = html.match(/\$(\d{1,4}\.\d{2})/g);
    if (!priceMatches || priceMatches.length === 0) {
      console.log(`  [${i+1}/${entries.length}] ${entry.brand} ${entry.model}: no prices found`);
      errors++;
      continue;
    }

    // Parse all prices, filter reasonable range ($5-$2000)
    const prices = priceMatches
      .map(p => parseFloat(p.replace('$', '')))
      .filter(p => p >= 5 && p <= 2000);

    if (prices.length === 0) {
      console.log(`  [${i+1}/${entries.length}] ${entry.brand} ${entry.model}: no reasonable prices`);
      errors++;
      continue;
    }

    // Use the lowest reasonable price (typically the current listing price)
    // Skip very low outliers (shipping costs, add-ons) by using the 2nd price if >3 options
    prices.sort((a, b) => a - b);
    const price = prices.length > 3 ? prices[1] : prices[0];

    updatePrice.run(price, entry.id);
    updated++;
    console.log(`  [${i+1}/${entries.length}] ${entry.brand} ${entry.model}: $${price.toFixed(2)}`);
  } catch (e: any) {
    console.log(`  [${i+1}/${entries.length}] ${entry.brand} ${entry.model}: error - ${e.message}`);
    errors++;
  }

  // Rate limit
  if (i < entries.length - 1) {
    await Bun.sleep(delay);
  }
}

console.log(`\nResults: ${updated} prices found, ${errors} errors`);
db.close();
