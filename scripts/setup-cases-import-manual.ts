/**
 * Import manually-curated picks (e.g. from a research subagent) into setup.sqlite.
 * Reads JSON array of objects matching case_variations columns from a file.
 *
 * Usage:
 *   bun scripts/setup-cases-import-manual.ts output/manual-case-picks.json
 */
import Database from 'bun:sqlite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

const DB_PATH = resolve(process.env.HOME!, 'git/torch/pipeline-data/db/setup.sqlite');

interface ManualPick {
  asin?: string;
  variation_asin?: string;
  parent_asin?: string;
  title: string;
  color_or_pattern?: string | null;
  weight_g: number;
  weight_raw?: string | null;
  price_usd?: number | null;
  stars?: number | null;
  review_count?: number | null;
  thumbnail_url: string;
  amazon_url?: string;
  theme?: string;
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: bun setup-cases-import-manual.ts <picks.json>');
  process.exit(1);
}

const raw = readFileSync(resolve(file), 'utf8');
let picks: ManualPick[];
try {
  picks = JSON.parse(raw);
} catch (e) {
  // Try extracting JSON array from a text wrapper
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) throw e;
  picks = JSON.parse(m[0]);
}

if (!Array.isArray(picks)) {
  console.error('Input is not a JSON array');
  process.exit(1);
}

const db = new Database(DB_PATH);
db.exec('PRAGMA busy_timeout = 30000');

const insert = db.prepare(`
  INSERT OR REPLACE INTO case_variations
    (variation_asin, parent_asin, title, color_or_pattern,
     weight_g, weight_raw, price_usd, stars, review_count,
     thumbnail_url, amazon_url, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')
`);
const ensurePool = db.prepare(`
  INSERT OR IGNORE INTO asin_pool (asin, source, enriched_at, enrich_status, enrich_source)
  VALUES (?, 'manual', datetime('now'), 'ok', 'manual')
`);

let inserted = 0;
let skipped = 0;
const tx = db.transaction((rows: ManualPick[]) => {
  for (const r of rows) {
    const variationAsin = r.variation_asin ?? r.asin;
    const parentAsin = r.parent_asin ?? variationAsin;
    if (!variationAsin || !r.title || !r.weight_g || !r.thumbnail_url) {
      console.warn(`skip (missing required): ${JSON.stringify(r).slice(0, 100)}`);
      skipped++;
      continue;
    }
    const url = r.amazon_url ?? `https://www.amazon.com/dp/${variationAsin}`;
    ensurePool.run(variationAsin);
    insert.run(
      variationAsin, parentAsin, r.title, r.color_or_pattern ?? null,
      r.weight_g, r.weight_raw ?? null, r.price_usd ?? null, r.stars ?? null,
      r.review_count ?? null, r.thumbnail_url, url,
    );
    inserted++;
  }
});
tx(picks);

console.log(`Imported ${inserted} manual picks (${skipped} skipped).`);
db.close();
