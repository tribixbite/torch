#!/usr/bin/env bun
/**
 * Fix image URL ordering for intl-outdoor entries:
 * 1. Move Shopify CDN URLs to front of array
 * 2. Remove duplicate intl-outdoor thumbnail/cache variants
 * 3. Remove intl-outdoor URLs when Shopify alternatives exist
 */
import { Database } from 'bun:sqlite';
import { resolve } from 'path';

const dbPath = resolve(import.meta.dir, '../pipeline-data/db/torch.sqlite');
const db = new Database(dbPath);
db.exec('PRAGMA busy_timeout = 30000');

interface Row { id: string; image_urls: string; brand: string; model: string; }

const entries = db.prepare(`
  SELECT id, image_urls, brand, model FROM flashlights
  WHERE brand IN ('Emisar', 'Noctigon')
  AND image_urls IS NOT NULL AND image_urls != '[]'
  AND image_urls LIKE '%intl-outdoor%'
`).all() as Row[];

console.log(`Processing ${entries.length} entries with intl-outdoor URLs...`);

const update = db.prepare('UPDATE flashlights SET image_urls = ? WHERE id = ?');
let fixed = 0;

for (const e of entries) {
  try {
    const urls: string[] = JSON.parse(e.image_urls);

    // Separate into shopify and intl-outdoor
    const shopify: string[] = [];
    const intlOutdoor: string[] = [];
    const other: string[] = [];

    for (const url of urls) {
      if (url.includes('cdn.shopify.com')) {
        shopify.push(url);
      } else if (url.includes('intl-outdoor.com')) {
        intlOutdoor.push(url);
      } else {
        other.push(url);
      }
    }

    // For intl-outdoor, keep only /image/ variants (not /thumbnail/ or /small_image/)
    const dedupedIntl = intlOutdoor.filter(u => u.includes('/image/'));

    let newUrls: string[];
    if (shopify.length > 0) {
      // Shopify first, then others, then deduped intl-outdoor as fallback
      newUrls = [...shopify, ...other, ...dedupedIntl];
    } else {
      // No shopify — keep best intl-outdoor (image > small_image > thumbnail)
      const bestIntl = dedupedIntl.length > 0 ? dedupedIntl : intlOutdoor.slice(0, 2);
      newUrls = [...bestIntl, ...other];
    }

    // Skip .gif URLs as first entry (animated GIFs don't thumbnail well)
    if (newUrls.length > 1 && newUrls[0].endsWith('.gif')) {
      const gif = newUrls.shift()!;
      newUrls.push(gif);
    }

    const newJson = JSON.stringify(newUrls);
    if (newJson !== e.image_urls) {
      update.run(newJson, e.id);
      fixed++;
      const oldFirst = urls[0].replace(/.*\//, '').slice(0, 50);
      const newFirst = newUrls[0].replace(/.*\//, '').slice(0, 50);
      console.log(`  ${e.id}: ${oldFirst} → ${newFirst} (${shopify.length} shopify, ${intlOutdoor.length} intl)`);
    }
  } catch (err) {
    console.error(`  Error on ${e.id}: ${err}`);
  }
}

console.log(`\nFixed ${fixed}/${entries.length} entries`);

// Check remaining
const remaining = db.prepare(`
  SELECT COUNT(*) as c FROM flashlights
  WHERE brand IN ('Emisar', 'Noctigon') AND image_urls LIKE '%intl-outdoor%'
`).get() as { c: number };
console.log(`Remaining Emisar/Noctigon entries with intl-outdoor URLs: ${remaining.c}`);
