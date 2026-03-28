#!/usr/bin/env bun
/**
 * Priority brand enrichment sweep — detail-scrapes each brand's product pages
 * and runs model-crossref after each to propagate gains.
 *
 * Covers all brands from zakreviews.com + zeroair.org reviews (44 brands).
 * Loops until no new enrichments are found across all brands.
 *
 * Usage:
 *   bun run scripts/enrich-priority-brands.ts              # full sweep, loop until done
 *   bun run scripts/enrich-priority-brands.ts --brand=Fenix # single brand
 *   bun run scripts/enrich-priority-brands.ts --max=100     # max per brand per pass
 *   bun run scripts/enrich-priority-brands.ts --force       # re-scrape already-scraped URLs
 *   bun run scripts/enrich-priority-brands.ts --no-loop     # single pass only
 */
import Database from 'bun:sqlite';
import { scrapeDetailsForIncomplete } from '../pipeline/extraction/detail-scraper.js';
import { getAllFlashlights } from '../pipeline/store/db.js';

const db = new Database('pipeline-data/db/torch.sqlite');
db.run('PRAGMA busy_timeout = 30000');
db.run('PRAGMA journal_mode = WAL');

// --- All zakreviews.com + zeroair.org brands, ordered by enrichment potential ---
// Priority tier: r/flashlight favorites with worst coverage first
// Extended tier: remaining review-site brands by catalog size
const PRIORITY_BRANDS = [
	// Tier 1: worst coverage, most gaps
	'Imalent', 'ReyLight', 'Pelican', 'Acebeam', 'Fenix',
	// Tier 2: medium coverage, large catalogs
	'Loop Gear', 'Emisar', 'Wuben', 'Armytek', 'Convoy',
	'Nitecore', 'EagleTac', 'Rovyvon', 'Sofirn', 'Noctigon',
	'Streamlight', 'Wurkkos', 'Skilhunt', 'Zebralight',
	// Tier 3: zakreviews/zeroair brands not in r/flashlight priority list
	'Olight', 'Lumintop', 'ThruNite', 'JETBeam', 'Klarus',
	'Nextorch', 'Manker', 'Cyansky', 'Amutorch', 'Vastlite',
	'Coast', 'Fireflies', 'Folomov', 'Laulima', 'Mateminco',
	'Rofis', 'Weltool', 'BLF', 'Haikelite', 'Malkoff',
	'Meote', 'NightWatch', 'Niwalker', 'NlightD', 'Speras',
	'Sunwayman', 'SureFire', 'Trustfire', 'WildTrail',
];

const FIELDS = ['lumens', 'throw_m', 'runtime_hours', 'led', 'switch', 'features', 'material', 'battery', 'length_mm', 'weight_g', 'price_usd'] as const;

// Parse CLI args
const args = process.argv.slice(2);
const brandFilter = args.find(a => a.startsWith('--brand='))?.split('=')[1];
const maxPerBrand = parseInt(args.find(a => a.startsWith('--max='))?.split('=')[1] || '200', 10);
const force = args.includes('--force');
const noLoop = args.includes('--no-loop');

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

// Run FL1 derivation pass: intensity_cd = (throw_m / 2)^2
function runFL1Derivation(): number {
	const fl1Rows = db.prepare(`
		SELECT id, throw_m, intensity_cd FROM flashlights
		WHERE throw_m IS NOT NULL AND throw_m > 0
		AND (intensity_cd IS NULL OR intensity_cd <= 0)
	`).all() as any[];

	const now = new Date().toISOString();
	const fl1Stmt = db.prepare('UPDATE flashlights SET intensity_cd = ?, updated_at = ? WHERE id = ?');
	let fills = 0;
	for (const r of fl1Rows) {
		const cd = Math.round((r.throw_m / 2) ** 2);
		fl1Stmt.run(cd, now, r.id);
		fills++;
	}
	return fills;
}

// --- Main loop — repeat until convergence ---
const brands = brandFilter ? [brandFilter] : PRIORITY_BRANDS;
let pass = 0;
let grandTotalScraped = 0;
let grandTotalEnriched = 0;

while (true) {
	pass++;
	console.log(`\n${'='.repeat(60)}`);
	console.log(`=== Pass ${pass} — ${brands.length} brands, max ${maxPerBrand}/brand ===`);
	console.log(`${'='.repeat(60)}\n`);

	const summary: { brand: string; scraped: number; enriched: number; gains: string }[] = [];
	let passScraped = 0;
	let passEnriched = 0;

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

		passScraped += result.scraped;
		passEnriched += result.enriched;

		const after = brandCoverage(brand);
		const gains = formatDiff(before, after);

		console.log(`  Scraped: ${result.scraped}, Enriched: ${result.enriched}, Errors: ${result.errors}`);
		console.log(`  Gains: ${gains}\n`);

		summary.push({ brand, scraped: result.scraped, enriched: result.enriched, gains });
	}

	grandTotalScraped += passScraped;
	grandTotalEnriched += passEnriched;

	// FL1 derivation after each pass
	const fl1Fills = runFL1Derivation();
	if (fl1Fills > 0) {
		console.log(`  FL1 intensity derivation: +${fl1Fills} entries`);
	}

	// Pass summary
	console.log(`\n--- Pass ${pass} Summary ---`);
	console.log(`  Scraped: ${passScraped}, Enriched: ${passEnriched}, FL1: ${fl1Fills}`);

	for (const s of summary) {
		if (s.enriched > 0 || s.gains !== 'no change') {
			console.log(`  ${s.brand}: ${s.enriched} enriched — ${s.gains}`);
		}
	}

	const noGain = summary.filter(s => s.enriched === 0 && s.gains === 'no change');
	if (noGain.length > 0) {
		console.log(`  ${noGain.length} brands with no change: ${noGain.map(s => s.brand).join(', ')}`);
	}

	// Check if any brand had new scrapes (not yet-scraped URLs remaining)
	// If passScraped == 0, all URLs have been scraped — nothing left to do
	if (passScraped === 0 || noLoop) {
		console.log(`\n>>> ${passScraped === 0 ? 'All URLs scraped — converged.' : 'Single pass mode (--no-loop).'}`);
		break;
	}

	console.log(`\n>>> ${passScraped} URLs scraped this pass — continuing to next pass...`);
}

// --- Grand total ---
console.log(`\n${'='.repeat(60)}`);
console.log(`=== GRAND TOTAL (${pass} passes) ===`);
console.log(`  Scraped: ${grandTotalScraped}`);
console.log(`  Enriched: ${grandTotalEnriched}`);
console.log(`${'='.repeat(60)}`);

db.close();
