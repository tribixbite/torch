#!/usr/bin/env bun
/**
 * Cross-reference missing fields using model name matching within same brand.
 * Conservative: requires matching on the "core model" identifier, not generic words.
 * Also runs FL1 derivation for entries with throw OR intensity but not both.
 */
import { Database } from 'bun:sqlite';

const dbPath = `${import.meta.dir}/../pipeline-data/db/torch.sqlite`;
const db = new Database(dbPath, { strict: true });
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 30000');

/** Extract the "core model" from a model string — the first alphanumeric token that looks like a model number */
function extractCoreModel(model: string): string | null {
  // Remove brand prefixes that sometimes appear in model names
  const cleaned = model.trim();

  // Look for typical model identifiers: letter+digit combos like "E70", "PD35", "MH12", "H04F"
  // These are the real model identifiers, not descriptive words
  const modelMatch = cleaned.match(/\b([A-Z]{1,4}\d{1,4}[A-Z]?\d?(?:\.\d)?)\b/i);
  if (modelMatch) return modelMatch[1].toUpperCase();

  // Try first word if it's a proper model name (not generic)
  const genericWords = new Set(['tactical', 'work', 'rechargeable', 'mini', 'led', 'flashlight',
    'lantern', 'headlamp', 'penlight', 'spotlight', 'light', 'ultra', 'pro', 'max', 'plus',
    'camping', 'hunting', 'diving', 'super', 'new', 'the', 'classic', 'professional']);

  const firstWord = cleaned.split(/[\s\-_]+/)[0];
  if (firstWord && firstWord.length >= 2 && !genericWords.has(firstWord.toLowerCase())) {
    // Only use if it has at least one digit or is a known model prefix pattern
    if (/\d/.test(firstWord)) return firstWord.toUpperCase();
  }

  return null;
}

// Fields to cross-reference
interface FieldConfig {
  name: string;
  nullCheck: string;  // SQL WHERE clause for missing
  hasCheck: string;   // SQL WHERE clause for present
  column: string;
}

const fields: FieldConfig[] = [
  { name: 'throw_m', nullCheck: "(throw_m IS NULL OR throw_m <= 0)", hasCheck: "throw_m IS NOT NULL AND throw_m > 0", column: 'throw_m' },
  { name: 'runtime_hours', nullCheck: "(runtime_hours IS NULL OR runtime_hours = '[]')", hasCheck: "runtime_hours IS NOT NULL AND runtime_hours <> '[]'", column: 'runtime_hours' },
  { name: 'length_mm', nullCheck: "(length_mm IS NULL OR length_mm <= 0)", hasCheck: "length_mm IS NOT NULL AND length_mm > 0", column: 'length_mm' },
  { name: 'weight_g', nullCheck: "(weight_g IS NULL OR weight_g <= 0)", hasCheck: "weight_g IS NOT NULL AND weight_g > 0", column: 'weight_g' },
  { name: 'lumens', nullCheck: "(lumens IS NULL OR lumens = '[]')", hasCheck: "lumens IS NOT NULL AND lumens <> '[]'", column: 'lumens' },
  { name: 'led', nullCheck: "(led IS NULL OR led = '[]')", hasCheck: "led IS NOT NULL AND led <> '[]'", column: 'led' },
  { name: 'material', nullCheck: "(material IS NULL OR material = '[]')", hasCheck: "material IS NOT NULL AND material <> '[]'", column: 'material' },
  { name: 'battery', nullCheck: "(battery IS NULL OR battery = '[]')", hasCheck: "battery IS NOT NULL AND battery <> '[]'", column: 'battery' },
  { name: 'switch', nullCheck: "(switch IS NULL OR switch = '[]')", hasCheck: "switch IS NOT NULL AND switch <> '[]'", column: 'switch' },
  { name: 'features', nullCheck: "(features IS NULL OR features = '[]')", hasCheck: "features IS NOT NULL AND features <> '[]'", column: 'features' },
  { name: 'color', nullCheck: "(color IS NULL OR color = '[]')", hasCheck: "color IS NOT NULL AND color <> '[]'", column: 'color' },
  { name: 'price_usd', nullCheck: "(price_usd IS NULL OR price_usd <= 0)", hasCheck: "price_usd IS NOT NULL AND price_usd > 0", column: 'price_usd' },
];

const stats: Record<string, number> = {};

// Build a map of brand+coreModel → donor values for each field
for (const field of fields) {
  stats[field.name] = 0;

  // Get entries missing this field
  const missing = db.prepare(`
    SELECT id, brand, model FROM flashlights
    WHERE json_extract(type,'$[0]') NOT IN ('accessory','blog','not_flashlight')
    AND ${field.nullCheck}
  `).all() as any[];

  // Get donor entries that have this field
  const donors = db.prepare(`
    SELECT brand, model, ${field.column} as val FROM flashlights
    WHERE json_extract(type,'$[0]') NOT IN ('accessory','blog','not_flashlight')
    AND ${field.hasCheck}
  `).all() as any[];

  // Build donor map: brand+coreModel → list of values
  const donorMap = new Map<string, any[]>();
  for (const d of donors) {
    const core = extractCoreModel(d.model);
    if (!core || core.length < 2) continue;
    const key = `${d.brand}|${core}`;
    if (!donorMap.has(key)) donorMap.set(key, []);
    donorMap.get(key)!.push(d.val);
  }

  // Match missing entries to donors
  const update = db.prepare(`UPDATE flashlights SET ${field.column} = ? WHERE id = ?`);

  const tx = db.transaction(() => {
    for (const m of missing) {
      const core = extractCoreModel(m.model);
      if (!core || core.length < 2) continue;
      const key = `${m.brand}|${core}`;
      const donorValues = donorMap.get(key);
      if (!donorValues || donorValues.length === 0) continue;

      // For scalar fields, all donors must agree (unique value)
      if (['throw_m', 'length_mm', 'weight_g', 'price_usd'].includes(field.name)) {
        const unique = [...new Set(donorValues.map(v => v))];
        if (unique.length === 1) {
          update.run(unique[0], m.id);
          stats[field.name]++;
        }
      } else {
        // For array fields (runtime, lumens, led, etc.), take the first donor's value
        // Only if all donors agree
        const unique = [...new Set(donorValues.map(v => JSON.stringify(v)))];
        if (unique.length === 1) {
          update.run(donorValues[0], m.id);
          stats[field.name]++;
        }
      }
    }
  });

  tx();
  if (stats[field.name] > 0) {
    console.log(`${field.name}: +${stats[field.name]}`);
  }
}

// ===== FL1 DERIVATION =====
// If throw is present but intensity is missing: intensity_cd = (throw_m / 2)^2
// If intensity is present but throw is missing: throw_m = 2 * sqrt(intensity_cd)
const fl1Throw = db.prepare(`
  UPDATE flashlights SET throw_m = ROUND(2.0 * sqrt(intensity_cd), 1)
  WHERE (throw_m IS NULL OR throw_m <= 0)
  AND intensity_cd IS NOT NULL AND intensity_cd > 0
  AND json_extract(type,'$[0]') NOT IN ('accessory','blog','not_flashlight')
`).run();
if (fl1Throw.changes > 0) console.log(`FL1 throw from intensity: +${fl1Throw.changes}`);

const fl1Intensity = db.prepare(`
  UPDATE flashlights SET intensity_cd = ROUND((throw_m / 2.0) * (throw_m / 2.0), 0)
  WHERE (intensity_cd IS NULL OR intensity_cd <= 0)
  AND throw_m IS NOT NULL AND throw_m > 0
  AND json_extract(type,'$[0]') NOT IN ('accessory','blog','not_flashlight')
`).run();
if (fl1Intensity.changes > 0) console.log(`FL1 intensity from throw: +${fl1Intensity.changes}`);

console.log(`\nTotal fixes: ${Object.values(stats).reduce((a, b) => a + b, 0) + (fl1Throw.changes || 0)}`);

db.close();
