#!/usr/bin/env bun
/**
 * Comprehensive data quality audit — generates output/data-audit.md
 * Checks: duplicates, suspicious specs, missing images, no-name brands,
 * completeness distribution, sprite coverage.
 */
import { Database } from 'bun:sqlite';
import { existsSync } from 'fs';
import { resolve } from 'path';

const dbPath = resolve(import.meta.dir, '../pipeline-data/db/torch.sqlite');
const db = new Database(dbPath, { readonly: true });
db.exec('PRAGMA busy_timeout = 30000');

interface Row { [key: string]: any }

const REQUIRED_FIELDS = [
	'model', 'brand', 'type', 'led', 'battery', 'lumens', 'throw_m',
	'runtime_hours', 'switch', 'features', 'color', 'material',
	'length_mm', 'weight_g', 'price_usd', 'purchase_urls',
] as const;

/** Count non-empty required fields for an entry */
function completenessScore(row: Row): number {
	let score = 0;
	if (row.model) score++;
	if (row.brand) score++;
	if (row.type && row.type !== '[]') score++;
	if (row.led && row.led !== '[]') score++;
	if (row.battery && row.battery !== '[]') score++;
	if (row.lumens && row.lumens !== '[]') score++;
	if (row.throw_m != null && row.throw_m > 0) score++;
	if (row.runtime_hours && row.runtime_hours !== '[]') score++;
	if (row.switch && row.switch !== '[]') score++;
	if (row.features && row.features !== '[]') score++;
	if (row.color && row.color !== '[]') score++;
	if (row.material && row.material !== '[]') score++;
	if (row.length_mm != null && row.length_mm > 0) score++;
	if (row.weight_g != null && row.weight_g > 0) score++;
	if (row.price_usd != null && row.price_usd > 0) score++;
	if (row.purchase_urls && row.purchase_urls !== '[]') score++;
	return score;
}

const sections: string[] = [];
const timestamp = new Date().toISOString().split('T')[0];
sections.push(`# Data Quality Audit — ${timestamp}\n`);

// --- 1. Duplicates ---
const dupes = db.prepare(`
	SELECT LOWER(brand) as lbrand, LOWER(model) as lmodel, COUNT(*) as cnt, GROUP_CONCAT(id, ' | ') as ids
	FROM flashlights
	WHERE type NOT LIKE '%removed%' AND type NOT LIKE '%blog%'
	GROUP BY LOWER(brand), LOWER(model)
	HAVING cnt > 1
	ORDER BY cnt DESC
`).all() as Row[];

sections.push(`## 1. Duplicates (${dupes.length} groups)\n`);
if (dupes.length === 0) {
	sections.push('No duplicates found.\n');
} else {
	sections.push('| Brand | Model | Count | IDs |');
	sections.push('|-------|-------|-------|-----|');
	for (const d of dupes) {
		sections.push(`| ${d.lbrand} | ${d.lmodel} | ${d.cnt} | ${d.ids} |`);
	}
	sections.push('');
}

// --- 2. Suspicious Specs ---
sections.push('## 2. Suspicious Specs\n');

const suspChecks = [
	{ label: 'weight_g > 5000 (>5kg)', query: `SELECT id, brand, model, weight_g FROM flashlights WHERE weight_g > 5000 AND type NOT LIKE '%removed%' ORDER BY weight_g DESC` },
	{ label: 'length_mm > 1000 (>1m)', query: `SELECT id, brand, model, length_mm FROM flashlights WHERE length_mm > 1000 AND type NOT LIKE '%removed%' ORDER BY length_mm DESC` },
	{ label: 'price_usd > 3000', query: `SELECT id, brand, model, price_usd FROM flashlights WHERE price_usd > 3000 AND type NOT LIKE '%removed%' ORDER BY price_usd DESC` },
	{ label: 'throw_m > 5000', query: `SELECT id, brand, model, throw_m FROM flashlights WHERE throw_m > 5000 AND type NOT LIKE '%removed%' ORDER BY throw_m DESC` },
];

for (const check of suspChecks) {
	const rows = db.prepare(check.query).all() as Row[];
	sections.push(`### ${check.label} — ${rows.length} entries`);
	if (rows.length > 0) {
		for (const r of rows.slice(0, 20)) {
			const val = r.weight_g ?? r.length_mm ?? r.price_usd ?? r.throw_m;
			sections.push(`- **${r.brand} ${r.model}** (${r.id}): ${val}`);
		}
		if (rows.length > 20) sections.push(`- ... and ${rows.length - 20} more`);
	}
	sections.push('');
}

// Lumens check — need to parse JSON array
const lumensRows = db.prepare(`
	SELECT id, brand, model, lumens FROM flashlights
	WHERE lumens IS NOT NULL AND lumens != '[]' AND type NOT LIKE '%removed%'
`).all() as Row[];
const highLumens = lumensRows.filter(r => {
	try {
		const arr = JSON.parse(r.lumens);
		return Array.isArray(arr) && arr.some((v: number) => v > 100000);
	} catch { return false; }
});
sections.push(`### lumens > 100,000 — ${highLumens.length} entries`);
for (const r of highLumens) {
	sections.push(`- **${r.brand} ${r.model}** (${r.id}): ${r.lumens}`);
}
sections.push('');

// Runtime check
const runtimeRows = db.prepare(`
	SELECT id, brand, model, runtime_hours FROM flashlights
	WHERE runtime_hours IS NOT NULL AND runtime_hours != '[]' AND type NOT LIKE '%removed%'
`).all() as Row[];
const highRuntime = runtimeRows.filter(r => {
	try {
		const arr = JSON.parse(r.runtime_hours);
		return Array.isArray(arr) && arr.some((v: number) => v > 5000);
	} catch { return false; }
});
sections.push(`### runtime_hours > 5,000h — ${highRuntime.length} entries`);
for (const r of highRuntime.slice(0, 20)) {
	sections.push(`- **${r.brand} ${r.model}** (${r.id}): ${r.runtime_hours}`);
}
if (highRuntime.length > 20) sections.push(`- ... and ${highRuntime.length - 20} more`);
sections.push('');

// --- 3. Missing Images ---
const totalEntries = db.prepare(`SELECT COUNT(*) as cnt FROM flashlights WHERE type NOT LIKE '%removed%' AND type NOT LIKE '%blog%'`).get() as Row;
const noImage = db.prepare(`
	SELECT COUNT(*) as cnt FROM flashlights
	WHERE (image_urls IS NULL OR image_urls = '[]' OR image_urls = '')
	AND type NOT LIKE '%removed%' AND type NOT LIKE '%blog%'
`).get() as Row;

sections.push(`## 3. Image Coverage\n`);
sections.push(`- Total entries: ${totalEntries.cnt}`);
sections.push(`- Missing images: ${noImage.cnt} (${(100 * noImage.cnt / totalEntries.cnt).toFixed(1)}%)`);
sections.push(`- With images: ${totalEntries.cnt - noImage.cnt} (${(100 * (totalEntries.cnt - noImage.cnt) / totalEntries.cnt).toFixed(1)}%)`);

// Sprite coverage
const spriteMetaPath = resolve(import.meta.dir, '../pipeline-data/sprite-metadata.json');
if (existsSync(spriteMetaPath)) {
	const spriteMeta = JSON.parse(await Bun.file(spriteMetaPath).text());
	const spriteCount = spriteMeta.totalImages ?? 0;
	const idMapCount = spriteMeta.idToSprite ? Object.keys(spriteMeta.idToSprite).length : 0;
	sections.push(`- Sprite tiles: ${spriteCount}`);
	sections.push(`- Sprite ID mappings: ${idMapCount}`);
}
sections.push('');

// --- 4. No-Name Brands ---
const RETAILER_RE = /amazon\.|ebay\.|walmart\.|bestbuy\.|bhphoto\.|batteryjunction\.|goinggear\.|nealsgadgets\.|illumn\.|killzoneflashlights\.|knifecenter\.|bladehq\.|opticsplanet\.|cabelas\.|basspro\.|rei\.com|homedepot\.|lowes\.|target\.com|aliexpress\.|banggood\.|gearbest\./i;

const allBrands = db.prepare(`
	SELECT brand, COUNT(*) as cnt, GROUP_CONCAT(DISTINCT info_urls) as all_info_urls
	FROM flashlights
	WHERE type NOT LIKE '%removed%' AND type NOT LIKE '%blog%' AND type NOT LIKE '%accessory%'
	GROUP BY brand
	ORDER BY brand
`).all() as Row[];

// Check which brands have NO non-retailer info_urls
const noNameBrands: { brand: string; cnt: number; avgComp: number }[] = [];
for (const b of allBrands) {
	const urls = (b.all_info_urls ?? '').split(',').filter(Boolean);
	const hasNonRetailer = urls.some((u: string) => {
		// Parse each URL from the concatenated JSON arrays
		const matches = u.match(/https?:\/\/[^\s",\]]+/g) ?? [];
		return matches.some(m => !RETAILER_RE.test(m));
	});
	if (!hasNonRetailer) {
		// Calculate avg completeness for this brand
		const brandRows = db.prepare(`
			SELECT * FROM flashlights WHERE brand = ? AND type NOT LIKE '%removed%'
		`).all(b.brand) as Row[];
		const avgComp = brandRows.reduce((s, r) => s + completenessScore(r), 0) / brandRows.length;
		noNameBrands.push({ brand: b.brand, cnt: b.cnt, avgComp: Math.round(avgComp * 10) / 10 });
	}
}
noNameBrands.sort((a, b) => a.avgComp - b.avgComp);

sections.push(`## 4. No-Name Brands (no manufacturer URL) — ${noNameBrands.length} brands, ${noNameBrands.reduce((s, b) => s + b.cnt, 0)} entries\n`);
sections.push('| Brand | Entries | Avg Completeness |');
sections.push('|-------|---------|------------------|');
for (const b of noNameBrands.slice(0, 50)) {
	sections.push(`| ${b.brand} | ${b.cnt} | ${b.avgComp} |`);
}
if (noNameBrands.length > 50) {
	sections.push(`| ... | ${noNameBrands.slice(50).reduce((s, b) => s + b.cnt, 0)} more | ... |`);
}
sections.push('');

// --- 5. Completeness Distribution ---
const allRows = db.prepare(`SELECT * FROM flashlights WHERE type NOT LIKE '%removed%' AND type NOT LIKE '%blog%'`).all() as Row[];
const compDist: Record<number, number> = {};
for (const r of allRows) {
	const score = completenessScore(r);
	compDist[score] = (compDist[score] ?? 0) + 1;
}

sections.push('## 5. Completeness Distribution\n');
sections.push('| Score | Count | % | Bar |');
sections.push('|-------|-------|---|-----|');
for (let i = 0; i <= 16; i++) {
	const cnt = compDist[i] ?? 0;
	if (cnt === 0) continue;
	const pct = (100 * cnt / allRows.length).toFixed(1);
	const bar = '█'.repeat(Math.ceil(cnt / 100));
	sections.push(`| ${i}/16 | ${cnt} | ${pct}% | ${bar} |`);
}
sections.push('');

// --- 6. Brand Quality Report (bottom 30) ---
const brandQuality: { brand: string; cnt: number; avgComp: number }[] = [];
const brandGroups = db.prepare(`
	SELECT brand, COUNT(*) as cnt FROM flashlights
	WHERE type NOT LIKE '%removed%' AND type NOT LIKE '%blog%' AND type NOT LIKE '%accessory%'
	GROUP BY brand HAVING cnt >= 3
	ORDER BY brand
`).all() as Row[];

for (const bg of brandGroups) {
	const brandRows = db.prepare(`
		SELECT * FROM flashlights WHERE brand = ? AND type NOT LIKE '%removed%' AND type NOT LIKE '%accessory%'
	`).all(bg.brand) as Row[];
	const avgComp = brandRows.reduce((s, r) => s + completenessScore(r), 0) / brandRows.length;
	brandQuality.push({ brand: bg.brand, cnt: bg.cnt, avgComp: Math.round(avgComp * 10) / 10 });
}
brandQuality.sort((a, b) => a.avgComp - b.avgComp);

sections.push('## 6. Lowest Quality Brands (≥3 entries)\n');
sections.push('| Brand | Entries | Avg Completeness |');
sections.push('|-------|---------|------------------|');
for (const b of brandQuality.slice(0, 30)) {
	sections.push(`| ${b.brand} | ${b.cnt} | ${b.avgComp} |`);
}
sections.push('');

// Write report
const outputPath = resolve(import.meta.dir, '../output/data-audit.md');
await Bun.write(outputPath, sections.join('\n'));
console.log(`Audit report written to ${outputPath}`);
console.log(`  ${dupes.length} duplicate groups`);
console.log(`  ${noNameBrands.length} no-name brands (${noNameBrands.reduce((s, b) => s + b.cnt, 0)} entries)`);
console.log(`  ${noImage.cnt}/${totalEntries.cnt} entries missing images`);
console.log(`  ${highLumens.length} entries with lumens > 100k`);
console.log(`  ${highRuntime.length} entries with runtime > 5000h`);
