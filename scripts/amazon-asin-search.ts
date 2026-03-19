#!/usr/bin/env bun
/**
 * Search Amazon for product ASINs by brand+model.
 * Extracts ASINs from search result pages and updates the DB.
 * Only fills EMPTY asin fields — never overwrites.
 */
import { Database } from 'bun:sqlite';

const dbPath = `${import.meta.dir}/../pipeline-data/db/torch.sqlite`;
const db = new Database(dbPath, { strict: true });
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 30000');

// Target: Nightstick entries without ASIN but missing price
const entries = db.prepare(`
  SELECT id, brand, model
  FROM flashlights
  WHERE brand = 'Nightstick'
    AND (asin IS NULL OR asin = '')
    AND (price_usd IS NULL OR price_usd <= 0)
    AND json_extract(type,'$[0]') NOT IN ('accessory','blog','not_flashlight')
`).all() as { id: string; brand: string; model: string }[];

console.log(`Found ${entries.length} Nightstick entries without ASIN`);

const updateAsinAndPrice = db.prepare(`UPDATE flashlights SET asin = ?, price_usd = ? WHERE id = ?`);
const updateAsin = db.prepare(`UPDATE flashlights SET asin = ? WHERE id = ?`);

let found = 0;
let priced = 0;
let errors = 0;
const delay = 4000; // 4s between requests

// Extract model number prefix (e.g., "NSP-4607B" from "NSP-4607B: Dual-Light ...")
function extractModelNumber(model: string): string {
  // Nightstick models follow patterns like NSP-XXXXX, NSR-XXXX, USB-XXXX, TAC-XXX, etc.
  const m = model.match(/^([A-Z]{2,4}-\d{3,5}[A-Z]?)/);
  if (m) return m[1];
  // Also try "MT-XXX" style
  const m2 = model.match(/^([A-Z]{1,3}-\d{2,4}[A-Z]?)/);
  if (m2) return m2[1];
  return model.split(':')[0].split(' ')[0].trim();
}

for (let i = 0; i < entries.length; i++) {
  const entry = entries[i];
  const modelNum = extractModelNumber(entry.model);
  const searchQuery = `Nightstick+${encodeURIComponent(modelNum)}+flashlight`;
  const url = `https://www.amazon.com/s?k=${searchQuery}`;

  try {
    const proc = Bun.spawnSync([
      'curl', '-s', '-L', '--compressed', '--max-time', '15',
      '-H', 'User-Agent: Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36',
      '-H', 'Accept-Language: en-US,en;q=0.9',
      url,
    ]);

    const html = proc.stdout.toString();
    if (!html || html.length < 1000) {
      errors++;
      continue;
    }

    // Extract ASINs from search results (data-asin attributes)
    const asinMatches = html.match(/data-asin="(B[A-Z0-9]{9})"/g);
    if (!asinMatches || asinMatches.length === 0) {
      // Try URL-based ASIN extraction
      const urlAsins = html.match(/\/dp\/(B[A-Z0-9]{9})/g);
      if (!urlAsins || urlAsins.length === 0) {
        if (i < 5 || i % 50 === 0) console.log(`  [${i+1}/${entries.length}] ${modelNum}: no ASINs found`);
        errors++;
        continue;
      }
    }

    // Get first ASIN (most relevant result)
    const allAsins = new Set<string>();
    const dataAsinRe = /data-asin="(B[A-Z0-9]{9})"/g;
    let match;
    while ((match = dataAsinRe.exec(html)) !== null) {
      allAsins.add(match[1]);
    }
    const urlAsinRe = /\/dp\/(B[A-Z0-9]{9})/g;
    while ((match = urlAsinRe.exec(html)) !== null) {
      allAsins.add(match[1]);
    }

    if (allAsins.size === 0) {
      errors++;
      continue;
    }

    const asin = [...allAsins][0]; // First (most relevant) result

    // Also try to extract price from search results
    // Amazon search pages show prices near each result
    const priceRe = /\$(\d{1,4}\.\d{2})/g;
    const prices: number[] = [];
    while ((match = priceRe.exec(html)) !== null) {
      const p = parseFloat(match[1]);
      if (p >= 10 && p <= 1000) prices.push(p);
    }

    if (prices.length > 0) {
      // Use lowest reasonable price
      prices.sort((a, b) => a - b);
      const price = prices[0];
      updateAsinAndPrice.run(asin, price, entry.id);
      priced++;
      found++;
      console.log(`  [${i+1}/${entries.length}] ${modelNum}: ASIN=${asin} $${price.toFixed(2)}`);
    } else {
      updateAsin.run(asin, entry.id);
      found++;
      console.log(`  [${i+1}/${entries.length}] ${modelNum}: ASIN=${asin} (no price)`);
    }
  } catch (e: any) {
    errors++;
  }

  // Rate limit
  if (i < entries.length - 1) {
    await Bun.sleep(delay);
  }

  // Progress
  if ((i + 1) % 25 === 0) {
    console.log(`  Progress: ${i+1}/${entries.length} (found: ${found}, priced: ${priced}, errors: ${errors})`);
  }
}

console.log(`\nResults: ${found} ASINs found, ${priced} with prices, ${errors} errors`);
db.close();
