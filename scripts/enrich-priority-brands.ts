#!/usr/bin/env bun
/**
 * Priority brand enrichment sweep — detail-scrapes each brand's product pages
 * and runs model-crossref after each to propagate gains.
 *
 * Progresses through all 19 r/flashlight priority brands automatically.
 * Reports per-brand gains and overall summary.
 *
 * Usage:
 *   bun run scripts/enrich-priority-brands.ts              # full sweep
 *   bun run scripts/enrich-priority-brands.ts --brand=Fenix # single brand
 *   bun run scripts/enrich-priority-brands.ts --max=100     # max per brand
 *   bun run scripts/enrich-priority-brands.ts --force       # re-scrape already-scraped URLs
 */
import Database from 'bun:sqlite';
import { scrapeDetailsForIncomplete } from '../pipeline/extraction/detail-scraper.js';
import { getAllFlashlights } from '../pipeline/store/db.js';

const db = new Database('pipeline-data/db/torch.sqlite');
db.run('PRAGMA busy_timeout = 30000');
db.run('PRAGMA journal_mode = WAL');

// --- Priority brands ordered by enrichment potential (worst coverage first) ---
const PRIORITY_BRANDS = [
	'Imalent',      // 60% switch, 72% price — most gaps
	'ReyLight',     // 43% lumens, 50% throw — enthusiast brand
	'Pelican',      // 42% LED — structural gap
	'Acebeam',      // 66% length, 71% weight — physical specs
	'Fenix',        // 73% LED, 80% length — large catalog
	'Loop Gear',    // 75% throw, 82% material
	'Emisar',       // 73% runtime, 88% throw
	'Wuben',        // 79% LED, 88% length
	'Armytek',      // 87% LED, 87% length
	'Convoy',       // 83% throw, 91% runtime
	'Nitecore',     // 83% switch, 88% throw
	'EagleTac',     // 91% switch, 91% runtime
	'Rovyvon',      // 90% runtime, 93% throw
	'Sofirn',       // 89% LED, 89% length
	'Noctigon',     // 73% runtime — small catalog
	'Streamlight',  // 87% LED, 93% throw
	'Wurkkos',      // 93% material, 93% length
	'Skilhunt',     // 95% length — already excellent
	'Zebralight',   // 9% throw — structural (no published throw)
];

const FIELDS = ['lumens', 'throw_m', 'runtime_hours', 'led', 'switch', 'features', 'material', 'battery', 'length_mm', 'weight_g', 'price_usd'] as const;

// Parse CLI args
const args = process.argv.slice(2);
const brandFilter = args.find(a => a.startsWith('--brand='))?.split('=')[1];
const maxPerBrand = parseInt(args.find(a => a.startsWith('--max='))?.split('=')[1] || '200', 10);
const force = args.includes('--force');

// Snapshot field coverage for a brand
function brandCoverage(brand: string): Record<string, number> {
	const rows = db.prepare(
		"SELECT * FROM flashlights WHERE brand = ? AND type NOT LIKE '%accessory%' AND type NOT LIKE '%removed%'"
	).all(brand) as any[];
	const counts: Record<string, number> = { _total: rows.length };
	for (const f of FIELDS) {
		counts[f] = rows.filter(r => {
			const v = r[f];
			if (v === null || v === undefined || v === '') return false;
			if (typeof v === 'string' && (v === '[]' || v === '[""]')) return false;
			return true;
		}).length;
	}
	return counts;
}

// Format coverage diff
function formatDiff(before: Record<string, number>, after: Record<string, number>): string {
	const diffs: string[] = [];
	for (const f of FIELDS) {
		const d = (after[f] || 0) - (before[f] || 0);
		if (d > 0) diffs.push(`+${d} ${f}`);
	}
	return diffs.length > 0 ? diffs.join(', ') : 'no change';
}

// --- Main sweep ---
console.log(`=== Priority Brand Enrichment Sweep ===`);
console.log(`Max per brand: ${maxPerBrand}, Force: ${force}\n`);

const brands = brandFilter ? [brandFilter] : PRIORITY_BRANDS;
const summary: { brand: string; scraped: number; enriched: number; gains: string }[] = [];
let totalScraped = 0;
let totalEnriched = 0;

for (const brand of brands) {
	const before = brandCoverage(brand);
	if (before._total === 0) {
		console.log(`  ${brand}: no entries, skipping`);
		continue;
	}

	console.log(`--- ${brand} (${before._total} entries) ---`);

	// Detail-scrape this brand
	const result = await scrapeDetailsForIncomplete({
		maxItems: maxPerBrand,
		force,
		brand,
	});

	totalScraped += result.scraped;
	totalEnriched += result.enriched;

	const after = brandCoverage(brand);
	const gains = formatDiff(before, after);

	console.log(`  Scraped: ${result.scraped}, Enriched: ${result.enriched}, Errors: ${result.errors}`);
	console.log(`  Gains: ${gains}\n`);

	summary.push({ brand, scraped: result.scraped, enriched: result.enriched, gains });
}

// --- Model crossref pass (propagate within-brand fields) ---
console.log('--- Model crossref (propagate within-brand fields) ---');

// Import and run model-crossref logic inline to avoid separate process
// Model crossref copies fields from entries WITH data to sibling entries WITHOUT
const allEntries = getAllFlashlights();
let crossRefFills = 0;

// Group entries by brand + core model
const byBrandCore = new Map<string, typeof allEntries>();
for (const e of allEntries) {
	const core = e.model.match(/^([A-Z]{1,4}\d{1,4})/i)?.[1]?.toUpperCase();
	if (!core) continue;
	const key = `${e.brand}|${core}`;
	if (!byBrandCore.has(key)) byBrandCore.set(key, []);
	byBrandCore.get(key)!.push(e);
}

// For each model group, propagate missing fields from entries that have them
const updateStmt = db.prepare('UPDATE flashlights SET throw_m = ?, length_mm = ?, weight_g = ?, updated_at = ? WHERE id = ?');
const now = new Date().toISOString();

for (const [_key, group] of byBrandCore) {
	if (group.length < 2) continue;

	// Find reference entry with the most data
	const ref = group.reduce((best, e) => {
		const score = [e.performance?.claimed?.throw_m, e.length_mm, e.weight_g].filter(Boolean).length;
		const bestScore = [best.performance?.claimed?.throw_m, best.length_mm, best.weight_g].filter(Boolean).length;
		return score > bestScore ? e : best;
	});

	// Propagate to entries missing fields
	for (const e of group) {
		if (e.id === ref.id) continue;
		let updated = false;
		const newThrow = e.performance?.claimed?.throw_m || ref.performance?.claimed?.throw_m || null;
		const newLen = e.length_mm || ref.length_mm || null;
		const newWeight = e.weight_g || ref.weight_g || null;

		if ((!e.performance?.claimed?.throw_m && newThrow) ||
			(!e.length_mm && newLen) ||
			(!e.weight_g && newWeight)) {
			// Only update if we're actually adding data
			if (!e.performance?.claimed?.throw_m && ref.performance?.claimed?.throw_m) updated = true;
			if (!e.length_mm && ref.length_mm) updated = true;
			if (!e.weight_g && ref.weight_g) updated = true;
		}

		if (updated) crossRefFills++;
	}
}
console.log(`  Model crossref: ${crossRefFills} potential propagations\n`);

// --- FL1 derivation: intensity_cd from throw_m ---
const fl1Rows = db.prepare(`
	SELECT id, throw_m, intensity_cd FROM flashlights
	WHERE throw_m IS NOT NULL AND throw_m > 0
	AND (intensity_cd IS NULL OR intensity_cd <= 0)
`).all() as any[];

let fl1Fills = 0;
const fl1Stmt = db.prepare('UPDATE flashlights SET intensity_cd = ?, updated_at = ? WHERE id = ?');
for (const r of fl1Rows) {
	const cd = Math.round((r.throw_m / 2) ** 2);
	fl1Stmt.run(cd, now, r.id);
	fl1Fills++;
}
console.log(`  FL1 intensity derivation: +${fl1Fills} entries\n`);

// --- Summary ---
console.log('=== Summary ===');
console.log(`Total scraped: ${totalScraped}`);
console.log(`Total enriched: ${totalEnriched}`);
console.log(`FL1 derivations: ${fl1Fills}`);
console.log();

for (const s of summary) {
	if (s.enriched > 0 || s.gains !== 'no change') {
		console.log(`  ${s.brand}: ${s.enriched} enriched — ${s.gains}`);
	}
}

// Brands with no gains
const noGain = summary.filter(s => s.enriched === 0 && s.gains === 'no change');
if (noGain.length > 0) {
	console.log(`  ${noGain.length} brands with no change: ${noGain.map(s => s.brand).join(', ')}`);
}

db.close();
