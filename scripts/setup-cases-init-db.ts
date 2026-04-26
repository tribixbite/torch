/**
 * Initialize pipeline-data/db/setup.sqlite for the /setup case browser.
 * Schema: case_variations (one row per color/style variation) + asin_pool
 * (discovery queue tracking which parent ASINs we've enriched).
 */
import Database from 'bun:sqlite';
import { resolve } from 'path';
import { mkdirSync } from 'fs';

const DB_DIR = resolve(process.env.HOME!, 'git/torch/pipeline-data/db');
const DB_PATH = resolve(DB_DIR, 'setup.sqlite');

mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 30000');

db.exec(`
  CREATE TABLE IF NOT EXISTS asin_pool (
    asin TEXT PRIMARY KEY,
    parent_asin TEXT,
    source TEXT NOT NULL,                   -- 'keepa-finder', 'keepa-product', 'playwright-search'
    discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
    enriched_at TEXT,                       -- null until we've fetched details
    enrich_status TEXT,                     -- 'ok', 'no-weight', 'error', 'unavailable'
    enrich_source TEXT                      -- 'keepa', 'playwright'
  );

  CREATE TABLE IF NOT EXISTS case_variations (
    variation_asin TEXT PRIMARY KEY,        -- the per-color/style ASIN
    parent_asin TEXT NOT NULL,              -- listing root
    title TEXT NOT NULL,
    color_or_pattern TEXT,                  -- "Black", "Galaxy Marble", etc.
    weight_g REAL NOT NULL,                 -- normalized to grams
    weight_raw TEXT,                        -- original string e.g. "1.2 ounces"
    price_usd REAL,                         -- nullable; some listings have no current price
    stars REAL,                             -- 0..5
    review_count INTEGER,
    thumbnail_url TEXT NOT NULL,
    amazon_url TEXT NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    source TEXT NOT NULL                    -- 'keepa' or 'playwright'
  );

  CREATE INDEX IF NOT EXISTS idx_case_variations_parent
    ON case_variations(parent_asin);
  CREATE INDEX IF NOT EXISTS idx_case_variations_weight
    ON case_variations(weight_g);
  CREATE INDEX IF NOT EXISTS idx_case_variations_stars
    ON case_variations(stars);
  CREATE INDEX IF NOT EXISTS idx_asin_pool_unenriched
    ON asin_pool(enriched_at) WHERE enriched_at IS NULL;
`);

const counts = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM asin_pool) as pool,
    (SELECT COUNT(*) FROM case_variations) as variations
`).get() as { pool: number; variations: number };

console.log(`Initialized ${DB_PATH}`);
console.log(`  asin_pool:        ${counts.pool}`);
console.log(`  case_variations:  ${counts.variations}`);

db.close();
