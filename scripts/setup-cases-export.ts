/**
 * Export case_variations from setup.sqlite to static/cases.json so the
 * SvelteKit SPA can fetch it client-side. Mirrors the existing
 * static/deals.json pattern used by the main torch UI.
 */
import Database from 'bun:sqlite';
import { resolve } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

const DB_PATH = resolve(process.env.HOME!, 'git/torch/pipeline-data/db/setup.sqlite');
const OUT_PATH = resolve(process.env.HOME!, 'git/torch/static/cases.json');

const db = new Database(DB_PATH, { readonly: true });

interface Row {
  variation_asin: string;
  parent_asin: string;
  title: string;
  color_or_pattern: string | null;
  weight_g: number;
  weight_raw: string | null;
  price_usd: number | null;
  stars: number | null;
  review_count: number | null;
  thumbnail_url: string;
  amazon_url: string;
  source: string;
  fetched_at: string;
}

const rows = db.prepare(`
  SELECT variation_asin, parent_asin, title, color_or_pattern,
         weight_g, weight_raw, price_usd, stars, review_count,
         thumbnail_url, amazon_url, source, fetched_at
  FROM case_variations
  WHERE weight_g IS NOT NULL AND weight_g > 0
  ORDER BY weight_g ASC
`).all() as Row[];

mkdirSync(resolve(OUT_PATH, '..'), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify({
  generatedAt: new Date().toISOString(),
  count: rows.length,
  cases: rows,
}, null, 2));

console.log(`Wrote ${rows.length} variations to ${OUT_PATH}`);
db.close();
