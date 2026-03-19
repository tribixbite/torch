#!/usr/bin/env bun
/**
 * Cross-reference our flashlight database with parametrek.com data.
 * Matches by brand+model, fills in missing fields from parametrek.
 * Only fills EMPTY fields — never overwrites existing data.
 */
import { Database } from 'bun:sqlite';

const dbPath = `${import.meta.dir}/../pipeline-data/db/torch.sqlite`;
const db = new Database(dbPath, { strict: true });
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 30000');

// Load parametrek data
const home = process.env.HOME || '/data/data/com.termux/files/home';
const parametrekPath = `${home}/parametrek.json`;
const raw = await Bun.file(parametrekPath).json();
const head: string[] = raw.head;
const data: any[][] = raw.data;

console.log(`Loaded ${data.length} parametrek entries with ${head.length} columns`);

// Build column index map
const col: Record<string, number> = {};
head.forEach((h, i) => col[h] = i);

// Brand alias mapping: parametrek name → list of our brand names (after normalize)
// Allows one parametrek brand to map to multiple of our brands
const brandAliasMap: Record<string, string[]> = {
  'led lenser': ['ledlenser'],
  'mag instrument': ['maglite'],
  'intl outdoor': ['emisar', 'noctigon'],  // intl-outdoor.com sells both brands
  'hds systems': ['hds'],
  'l3 illumination': ['l3'],
  'underwater kinetics': ['uk'],
};

// Build parametrek lookup by normalized "brand|model"
function normalize(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Get all brand keys for a parametrek brand (aliased + original)
function getBrandKeys(s: string): string[] {
  const n = normalize(s);
  const aliases = brandAliasMap[n];
  if (aliases) return aliases;
  return [n];
}

// Extract core model identifier from a model string
function extractCoreModel(model: string): string {
  const cleaned = model
    .replace(/\s*-\s*(?:black|white|grey|gray|silver|gold|red|blue|green|orange|yellow|pink|purple|camo|desert|od|fde|olive|bronze|copper|titanium|ti|ss|stainless)\b.*/i, '')
    .replace(/\s+(?:LED|Flashlight|Headlamp|Torch|Light|Rechargeable|Tactical).*$/i, '')
    .trim();
  // Try to extract model number like "E70", "PD35", "T36"
  const modelMatch = cleaned.match(/\b([A-Z]{1,4}\d{1,4}[A-Z]?\d?(?:\.\d)?)\b/i);
  if (modelMatch) return modelMatch[1].toUpperCase();
  return normalize(cleaned);
}

// Strip spec suffixes from model names for fuzzy matching
// "Warrior Ultra 2500lm Tactical Flashlight" → "warrior ultra"
// "Baton 3 S2R 1200lm Rechargeable" → "baton 3 s2r"
function stripSpecs(model: string): string {
  return normalize(model)
    // Remove lumen/distance/weight/runtime specs: "2500lm", "470m", "1800 lumens", "220m"
    .replace(/\b\d+\s*(?:lm|lumen|lumens|mah|cd|candela)\b/gi, '')
    .replace(/\b\d+\s*(?:mm|cm|inches?|in|"|ft|feet)\b/gi, '')
    .replace(/\b\d+\s*(?:oz|grams?|g)\b/gi, '')
    .replace(/\b\d+\s*(?:hours?|hrs?|h|minutes?|mins?)\b/gi, '')
    .replace(/\b\d+m\b/g, '')  // "470m" throw distance
    .replace(/\b\d+k\b/g, '')  // "6500k" CCT
    // Remove generic descriptors (keep "mini", "pro", etc. that are part of model names)
    .replace(/\b(?:led|flashlight|headlamp|torch|lights?|rechargeable|tactical|edc|keychain|lantern|work\s*light|camping|hunting|thrower|floody|flood|usb[- ]?c?|magnetic|clip|flat|slim|compact|portable|professional|long\s*range|high\s*power|ultra\s*bright|wireless|remote|with|and|for|the|of|in|on|from|by|to|a|an|muli\s*color|multi\s*color)\b/gi, '')
    // Remove material/color suffixes
    .replace(/\b(?:aluminum|titanium|copper|brass|stainless|polymer|oal|material|black|white|grey|gray|silver|gold|red|blue|green|orange|yellow|pink|purple)\b/gi, '')
    // Remove wattage-like numbers without unit context ("1700" but keep "3" in "Baton 3")
    .replace(/\b\d{4,}\b/g, '')
    // Clean up multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
}

const parametrekByBrandModel = new Map<string, any[]>();
const parametrekByBrandCore = new Map<string, any[]>();
const parametrekByBrandStripped = new Map<string, any[]>();

for (const entry of data) {
  const brands = getBrandKeys(entry[col.brand] || '');
  const model = normalize(entry[col.model] || '');
  const core = extractCoreModel(entry[col.model] || '');

  const stripped = stripSpecs(entry[col.model] || '');

  // Index under all brand aliases
  for (const brand of brands) {
    const key = `${brand}|${model}`;
    parametrekByBrandModel.set(key, entry);

    const coreKey = `${brand}|${core}`;
    if (!parametrekByBrandCore.has(coreKey)) {
      parametrekByBrandCore.set(coreKey, entry);
    }

    // Index by stripped (spec-free) model name
    if (stripped.length >= 2) {
      const strippedKey = `${brand}|${stripped}`;
      if (!parametrekByBrandStripped.has(strippedKey)) {
        parametrekByBrandStripped.set(strippedKey, entry);
      }
    }
  }
}

console.log(`Indexed ${parametrekByBrandModel.size} by brand+model, ${parametrekByBrandCore.size} by brand+core, ${parametrekByBrandStripped.size} by brand+stripped`);

// Get our entries missing at least one key field
const entries = db.prepare(`
  SELECT id, brand, model,
    throw_m, length_mm, weight_g, price_usd, intensity_cd,
    runtime_hours, lumens, led, battery, material, switch, features, color,
    beam_angle, cri, year
  FROM flashlights
  WHERE json_extract(type,'$[0]') NOT IN ('accessory','blog','not_flashlight')
`).all() as any[];

console.log(`Checking ${entries.length} entries against parametrek...`);

// Prepared update statements
const updates: Record<string, ReturnType<typeof db.prepare>> = {
  throw_m: db.prepare(`UPDATE flashlights SET throw_m = ? WHERE id = ?`),
  length_mm: db.prepare(`UPDATE flashlights SET length_mm = ? WHERE id = ?`),
  weight_g: db.prepare(`UPDATE flashlights SET weight_g = ? WHERE id = ?`),
  price_usd: db.prepare(`UPDATE flashlights SET price_usd = ? WHERE id = ?`),
  intensity_cd: db.prepare(`UPDATE flashlights SET intensity_cd = ? WHERE id = ?`),
  runtime_hours: db.prepare(`UPDATE flashlights SET runtime_hours = ? WHERE id = ?`),
  lumens: db.prepare(`UPDATE flashlights SET lumens = ? WHERE id = ?`),
  beam_angle: db.prepare(`UPDATE flashlights SET beam_angle = ? WHERE id = ?`),
  year: db.prepare(`UPDATE flashlights SET year = ? WHERE id = ?`),
  led: db.prepare(`UPDATE flashlights SET led = ? WHERE id = ?`),
  battery: db.prepare(`UPDATE flashlights SET battery = ? WHERE id = ?`),
  material: db.prepare(`UPDATE flashlights SET material = ? WHERE id = ?`),
  switch: db.prepare(`UPDATE flashlights SET switch = ? WHERE id = ?`),
  features: db.prepare(`UPDATE flashlights SET features = ? WHERE id = ?`),
  color: db.prepare(`UPDATE flashlights SET color = ? WHERE id = ?`),
};

const stats: Record<string, number> = {};
let matched = 0;
let totalFixes = 0;

const tx = db.transaction(() => {
  for (const entry of entries) {
    const brand = normalize(entry.brand);
    const model = normalize(entry.model);
    const core = extractCoreModel(entry.model);
    const stripped = stripSpecs(entry.model);

    // Try exact match first, then core model, then stripped model
    let pk = parametrekByBrandModel.get(`${brand}|${model}`);
    if (!pk) pk = parametrekByBrandCore.get(`${brand}|${core}`);
    if (!pk && stripped.length >= 2) pk = parametrekByBrandStripped.get(`${brand}|${stripped}`);
    if (!pk) continue;

    matched++;

    // Fill scalar fields
    const scalarMap: [string, string, number][] = [
      ['throw_m', 'throw', 1],      // parametrek meters → our meters
      ['length_mm', 'length', 1],    // parametrek mm → our mm
      ['weight_g', 'weight', 1],     // parametrek g → our g
      ['price_usd', 'price', 1],     // parametrek USD → our USD
      ['intensity_cd', 'intensity', 1],
      ['beam_angle', 'beam_angle', 1],
      ['year', 'year', 1],
    ];

    for (const [ourField, pkField, mult] of scalarMap) {
      if (entry[ourField] == null || entry[ourField] <= 0) {
        const pkVal = pk[col[pkField]];
        if (pkVal != null && pkVal > 0) {
          const val = pkVal * mult;
          // Sanity checks
          if (ourField === 'throw_m' && (val < 1 || val > 5000)) continue;
          if (ourField === 'length_mm' && (val < 15 || val > 800)) continue;
          if (ourField === 'weight_g' && (val < 5 || val > 5000)) continue;
          if (ourField === 'price_usd' && (val < 1 || val > 10000)) continue;
          updates[ourField].run(val, entry.id);
          stats[ourField] = (stats[ourField] || 0) + 1;
          totalFixes++;
        }
      }
    }

    // Fill array fields
    const arrayMap: [string, string][] = [
      ['runtime_hours', 'runtime'],
      ['lumens', 'lumens'],
    ];

    for (const [ourField, pkField] of arrayMap) {
      if (!entry[ourField] || entry[ourField] === '[]') {
        const pkVal = pk[col[pkField]];
        if (pkVal != null) {
          let arr: number[];
          if (Array.isArray(pkVal)) {
            arr = pkVal.filter((v: any) => typeof v === 'number' && v > 0);
          } else if (typeof pkVal === 'number' && pkVal > 0) {
            arr = [pkVal];
          } else continue;

          if (arr.length > 0) {
            updates[ourField].run(JSON.stringify(arr), entry.id);
            stats[ourField] = (stats[ourField] || 0) + 1;
            totalFixes++;
          }
        }
      }
    }

    // Fill string array fields (led, battery, material, switch, features, color)
    const strArrayMap: [string, string][] = [
      ['led', 'led'],
      ['battery', 'battery'],
      ['material', 'material'],
      ['switch', 'switch'],
      ['features', 'features'],
      ['color', 'color'],
    ];

    for (const [ourField, pkField] of strArrayMap) {
      if (!entry[ourField] || entry[ourField] === '[]') {
        const pkVal = pk[col[pkField]];
        if (pkVal != null && Array.isArray(pkVal) && pkVal.length > 0) {
          // Filter out parametrek-internal markers (// prefix)
          const cleaned = pkVal
            .filter((v: string) => typeof v === 'string' && v.length > 0 && !v.startsWith('//'))
            .map((v: string) => v.replace(/^\/\//, ''));
          if (cleaned.length > 0) {
            updates[ourField].run(JSON.stringify(cleaned), entry.id);
            stats[ourField] = (stats[ourField] || 0) + 1;
            totalFixes++;
          }
        }
      }
    }
  }
});

tx();

console.log(`\nMatched ${matched} entries to parametrek`);
console.log(`\nResults:`);
for (const [field, count] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${field}: +${count}`);
}
console.log(`\nTotal fixes: ${totalFixes}`);

db.close();
