#!/usr/bin/env bun
/**
 * Deduplicate flashlight entries with identical brand+model.
 * For each duplicate group:
 * 1. Pick the "best" entry (most filled fields)
 * 2. Merge non-null fields from other entries into the best one
 * 3. Delete the duplicate entries
 * 4. Merge raw_spec_text entries
 */
import { Database } from 'bun:sqlite';

const dbPath = `${import.meta.dir}/../pipeline-data/db/torch.sqlite`;
const db = new Database(dbPath, { strict: true });
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 30000');

// Fields to consider for merging (scalar = take non-null, array = take non-empty)
const scalarFields = [
  'throw_m', 'length_mm', 'weight_g', 'price_usd', 'intensity_cd',
  'beam_angle', 'efficacy', 'cri', 'cct', 'tint_duv', 'wh',
  'bezel_mm', 'body_mm', 'year', 'levels',
] as const;

const arrayFields = [
  'lumens', 'runtime_hours', 'led', 'led_color', 'battery', 'material',
  'color', 'switch', 'features', 'charging', 'modes', 'blink',
  'impact', 'environment', 'purchase_urls', 'info_urls', 'image_urls',
  'led_options',
] as const;

const idFields = ['asin', 'ean', 'upc'] as const;

interface Row { [key: string]: any }

// Count non-null, non-empty fields for scoring
function scoreEntry(row: Row): number {
  let score = 0;
  for (const f of scalarFields) {
    if (row[f] != null && row[f] > 0) score++;
  }
  for (const f of arrayFields) {
    if (row[f] && row[f] !== '[]') score++;
  }
  for (const f of idFields) {
    if (row[f]) score++;
  }
  return score;
}

// Get all duplicate groups
const groups = db.prepare(`
  SELECT brand, model, GROUP_CONCAT(id) as ids
  FROM flashlights
  WHERE json_extract(type,'$[0]') NOT IN ('accessory','blog','not_flashlight')
  GROUP BY brand, model
  HAVING COUNT(*) > 1
`).all() as { brand: string; model: string; ids: string }[];

console.log(`Found ${groups.length} duplicate groups (${groups.reduce((s, g) => s + g.ids.split(',').length - 1, 0)} extra entries)`);

// Build dynamic SELECT for all fields
const allFields = [...scalarFields, ...arrayFields, ...idFields, 'type', 'family_id', 'discontinued'];
const selectFields = ['id', ...allFields].join(', ');

const getEntry = db.prepare(`SELECT ${selectFields} FROM flashlights WHERE id = ?`);
const deleteEntry = db.prepare(`DELETE FROM flashlights WHERE id = ?`);
const deleteRawText = db.prepare(`DELETE FROM raw_spec_text WHERE flashlight_id = ?`);

// Build UPDATE statements dynamically
function buildUpdate(fields: Record<string, any>, id: string) {
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE flashlights SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

// Merge array fields: combine unique values from all entries
function mergeArrays(entries: Row[], field: string): string {
  const combined = new Set<string>();
  for (const e of entries) {
    if (e[field] && e[field] !== '[]') {
      try {
        const arr = JSON.parse(e[field]);
        if (Array.isArray(arr)) arr.forEach((v: string) => combined.add(typeof v === 'string' ? v : JSON.stringify(v)));
      } catch {}
    }
  }
  return JSON.stringify([...combined]);
}

let mergedCount = 0;
let deletedCount = 0;

const tx = db.transaction(() => {
  for (const group of groups) {
    const ids = group.ids.split(',').map(s => s.trim());
    const entries = ids.map(id => getEntry.get(id) as Row).filter(Boolean);

    if (entries.length < 2) continue;

    // Score each entry, pick the best
    const scored = entries.map(e => ({ entry: e, score: scoreEntry(e) }));
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0].entry;
    const others = scored.slice(1).map(s => s.entry);

    // Merge fields from others into best
    const updates: Record<string, any> = {};

    // Scalar fields: take first non-null from others if best is null
    for (const f of scalarFields) {
      if (best[f] == null || best[f] <= 0) {
        for (const other of others) {
          if (other[f] != null && other[f] > 0) {
            updates[f] = other[f];
            break;
          }
        }
      }
    }

    // Array fields: merge unique values
    for (const f of arrayFields) {
      const merged = mergeArrays(entries, f);
      if (merged !== '[]' && (best[f] === '[]' || !best[f])) {
        updates[f] = merged;
      } else if (merged !== '[]' && best[f] !== '[]') {
        // If merged has more items, use it
        try {
          const bestArr = JSON.parse(best[f] || '[]');
          const mergedArr = JSON.parse(merged);
          if (mergedArr.length > bestArr.length) {
            updates[f] = merged;
          }
        } catch {}
      }
    }

    // ID fields
    for (const f of idFields) {
      if (!best[f]) {
        for (const other of others) {
          if (other[f]) {
            updates[f] = other[f];
            break;
          }
        }
      }
    }

    // Delete duplicate entries FIRST (before updating best, to avoid unique constraint)
    for (const other of others) {
      // Move raw_spec_text to point to best entry (don't delete — might have unique text)
      db.prepare(`UPDATE raw_spec_text SET flashlight_id = ? WHERE flashlight_id = ?`).run(best.id, other.id);
      deleteEntry.run(other.id);
      deletedCount++;
    }

    // Apply updates to best entry (after deletes to avoid unique constraint collision)
    if (Object.keys(updates).length > 0) {
      buildUpdate(updates, best.id);
      mergedCount++;
    }
  }
});

tx();

console.log(`\nResults:`);
console.log(`  Groups merged: ${mergedCount}`);
console.log(`  Entries deleted: ${deletedCount}`);
console.log(`  Remaining entries: ${(db.prepare(`SELECT COUNT(*) as c FROM flashlights`).get() as any).c}`);

db.close();
