#!/usr/bin/env bun
/**
 * Validate vision classifier accuracy against parametrek ground truth.
 * Read-only — reports accuracy metrics but never modifies data.
 *
 * Usage: bun run scripts/validate-vision-accuracy.ts
 */
import { Database } from 'bun:sqlite';

const dbPath = `${import.meta.dir}/../pipeline-data/db/torch.sqlite`;
const db = new Database(dbPath, { readonly: true });
db.exec('PRAGMA busy_timeout = 30000');

// Load parametrek ground truth
const home = process.env.HOME || '/data/data/com.termux/files/home';
const parametrekPath = `${home}/parametrek.json`;
const raw = await Bun.file(parametrekPath).json();
const head: string[] = raw.head;
const data: any[][] = raw.data;

const col: Record<string, number> = {};
head.forEach((h, i) => (col[h] = i));

function normalize(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

// Build parametrek lookup by brand|model
const pkLookup = new Map<string, any[]>();
for (const entry of data) {
	const brand = normalize(entry[col.brand] || '');
	const model = normalize(entry[col.model] || '');
	pkLookup.set(`${brand}|${model}`, entry);
}

// Load DB entries that have vision-derived color or switch
const entries = db
	.prepare(
		`SELECT id, brand, model, color, switch
     FROM flashlights
     WHERE json_extract(type,'$[0]') NOT IN ('accessory','blog','not_flashlight')
       AND (color IS NOT NULL AND color != '[]'
         OR switch IS NOT NULL AND switch != '[]')`,
	)
	.all() as { id: string; brand: string; model: string; color: string; switch: string }[];

console.log(`Loaded ${entries.length} DB entries with color/switch data`);
console.log(`Loaded ${data.length} parametrek entries\n`);

// Normalize color values for comparison
const colorNormMap: Record<string, string> = {
	'od green': 'green',
	olive: 'green',
	'olive drab': 'green',
	'desert tan': 'brown',
	coyote: 'brown',
	fde: 'brown',
	tan: 'brown',
	'dark gray': 'gray',
	'dark grey': 'gray',
	gunmetal: 'gray',
	natural: 'silver',
	'raw aluminum': 'silver',
	stainless: 'silver',
	sand: 'brown',
	khaki: 'brown',
	beige: 'brown',
	grey: 'gray',
};

function normalizeColor(c: string): string {
	const lower = c.toLowerCase().trim();
	return colorNormMap[lower] || lower;
}

// Compare
let colorExact = 0,
	colorPartial = 0,
	colorMismatch = 0,
	colorTotal = 0;
let switchExact = 0,
	switchPartial = 0,
	switchMismatch = 0,
	switchTotal = 0;

const colorDisagreements: { brand: string; model: string; ours: string[]; pk: string[] }[] = [];
const switchDisagreements: { brand: string; model: string; ours: string[]; pk: string[] }[] = [];

for (const entry of entries) {
	const brand = normalize(entry.brand);
	const model = normalize(entry.model);
	const pk = pkLookup.get(`${brand}|${model}`);
	if (!pk) continue;

	// Compare color
	const ourColors: string[] = JSON.parse(entry.color || '[]').map(normalizeColor);
	const pkColors: string[] = (pk[col.color] || [])
		.filter((c: string) => typeof c === 'string' && c.length > 0)
		.map(normalizeColor);

	if (ourColors.length > 0 && pkColors.length > 0) {
		colorTotal++;
		const ourSet = new Set(ourColors);
		const pkSet = new Set(pkColors);
		const overlap = [...ourSet].filter((c) => pkSet.has(c));

		if (overlap.length === ourSet.size && overlap.length === pkSet.size) {
			colorExact++;
		} else if (overlap.length > 0) {
			colorPartial++;
		} else {
			colorMismatch++;
			colorDisagreements.push({
				brand: entry.brand,
				model: entry.model,
				ours: ourColors,
				pk: pkColors,
			});
		}
	}

	// Compare switch
	const ourSwitches: string[] = JSON.parse(entry.switch || '[]').map((s: string) =>
		s.toLowerCase().trim(),
	);
	const pkSwitches: string[] = (pk[col.switch] || [])
		.filter((s: string) => typeof s === 'string' && s.length > 0)
		.map((s: string) => s.toLowerCase().trim());

	if (ourSwitches.length > 0 && pkSwitches.length > 0) {
		switchTotal++;
		const ourSet = new Set(ourSwitches);
		const pkSet = new Set(pkSwitches);
		const overlap = [...ourSet].filter((s) => pkSet.has(s));

		if (overlap.length === ourSet.size && overlap.length === pkSet.size) {
			switchExact++;
		} else if (overlap.length > 0) {
			switchPartial++;
		} else {
			switchMismatch++;
			switchDisagreements.push({
				brand: entry.brand,
				model: entry.model,
				ours: ourSwitches,
				pk: pkSwitches,
			});
		}
	}
}

// Report
console.log('=== Color Accuracy ===');
console.log(`  Compared: ${colorTotal}`);
console.log(`  Exact match: ${colorExact} (${((colorExact / colorTotal) * 100).toFixed(1)}%)`);
console.log(`  Partial overlap: ${colorPartial} (${((colorPartial / colorTotal) * 100).toFixed(1)}%)`);
console.log(`  Mismatch: ${colorMismatch} (${((colorMismatch / colorTotal) * 100).toFixed(1)}%)`);

console.log('\n=== Switch Accuracy ===');
console.log(`  Compared: ${switchTotal}`);
console.log(`  Exact match: ${switchExact} (${((switchExact / switchTotal) * 100).toFixed(1)}%)`);
console.log(`  Partial overlap: ${switchPartial} (${((switchPartial / switchTotal) * 100).toFixed(1)}%)`);
console.log(`  Mismatch: ${switchMismatch} (${((switchMismatch / switchTotal) * 100).toFixed(1)}%)`);

if (colorDisagreements.length > 0) {
	console.log(`\n=== Color Disagreements (${colorDisagreements.length}) ===`);
	for (const d of colorDisagreements.slice(0, 25)) {
		console.log(`  ${d.brand} ${d.model}: ours=[${d.ours}] pk=[${d.pk}]`);
	}
	if (colorDisagreements.length > 25) {
		console.log(`  ... and ${colorDisagreements.length - 25} more`);
	}
}

if (switchDisagreements.length > 0) {
	console.log(`\n=== Switch Disagreements (${switchDisagreements.length}) ===`);
	for (const d of switchDisagreements.slice(0, 25)) {
		console.log(`  ${d.brand} ${d.model}: ours=[${d.ours}] pk=[${d.pk}]`);
	}
	if (switchDisagreements.length > 25) {
		console.log(`  ... and ${switchDisagreements.length - 25} more`);
	}
}

db.close();
