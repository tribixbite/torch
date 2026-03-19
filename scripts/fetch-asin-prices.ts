#!/usr/bin/env bun
/**
 * Fetch prices from Amazon for entries with ASINs but no price.
 */
import { Database } from 'bun:sqlite';

const dbPath = `${import.meta.dir}/../pipeline-data/db/torch.sqlite`;
const db = new Database(dbPath, { strict: true });
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 30000');

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

function extractPrice(html: string): number {
  // Try structured data first
  const patterns = [
    /"priceAmount"\s*:\s*"(\d+\.?\d*)"/,
    /"price"\s*:\s*"?\$?(\d+\.?\d*)"?/,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m) {
      const p = parseFloat(m[1]);
      if (p >= 5 && p <= 5000) return p;
    }
  }
  // Frequency-based price from $XX.XX patterns
  const allPrices = html.match(/\$(\d{1,4}\.\d{2})/g) || [];
  const counts = new Map<number, number>();
  for (const pm of allPrices) {
    const p = parseFloat(pm.replace('$', ''));
    if (p >= 5 && p <= 5000) {
      counts.set(p, (counts.get(p) || 0) + 1);
    }
  }
  let best = 0, bestCount = 0;
  for (const [p, c] of counts) {
    if (c > bestCount) { bestCount = c; best = p; }
  }
  return best;
}

// Get entries with ASINs but no price
const entries = db.prepare(`
  SELECT id, brand, model, asin FROM flashlights
  WHERE (price_usd IS NULL OR price_usd <= 0)
    AND json_extract(type, '$[0]') NOT IN ('accessory','blog','not_flashlight','removed')
    AND asin IS NOT NULL AND asin != ''
`).all() as { id: string; brand: string; model: string; asin: string }[];

console.log(`${entries.length} entries with ASINs need prices`);

const updatePrice = db.prepare(`UPDATE flashlights SET price_usd = ? WHERE id = ?`);
let updated = 0;

for (const e of entries) {
  const html = fetchPage(`https://www.amazon.com/dp/${e.asin}`);
  const price = extractPrice(html);
  
  if (price > 0) {
    updatePrice.run(price, e.id);
    console.log(`  ${e.brand} ${e.model}: $${price.toFixed(2)} (ASIN: ${e.asin})`);
    updated++;
  } else {
    console.log(`  ${e.brand} ${e.model}: no price found (ASIN: ${e.asin})`);
  }
  
  await Bun.sleep(3000);
}

console.log(`\nResults: ${updated} prices updated`);
db.close();
