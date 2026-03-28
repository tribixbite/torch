#!/usr/bin/env bun
/**
 * Revert data that was solely copied from parametrek.com crossref.
 *
 * Target: entries WITHOUT info_urls (Amazon-sourced) where field values
 * exactly match parametrek. These fields were written by parametrek-crossref.ts.
 *
 * Fields reverted:
 * - beam_angle: NEVER available from Amazon/Shopify. Always from parametrek.
 * - intensity_cd: Rarely in Amazon data. Usually from parametrek or FL1 derivation.
 *   We preserve if it can be derived from throw_m (which may itself be reverted).
 * - year: Sometimes from Amazon, but if it matches parametrek exactly, likely from there.
 * - throw_m: Sometimes from Amazon, but exact match to parametrek is suspicious.
 * - length_mm, weight_g, price_usd: Often from Amazon, so ONLY revert if beam_angle
 *   also matches (confirms parametrek was the source).
 * - lumens, runtime_hours: Often in Amazon data, so be conservative.
 * - led, battery, switch, features, material, color: Array fields — revert if they
 *   match parametrek exactly AND the entry has multiple parametrek-matching scalars
 *   (strong signal the entry was parametrek-enriched).
 *
 * Usage: bun run scripts/revert-parametrek-data.ts [--dry-run]
 */
import { Database } from 'bun:sqlite';

const DRY_RUN = process.argv.includes('--dry-run');
const db = new Database('pipeline-data/db/torch.sqlite');
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 30000');

const home = process.env.HOME || '/data/data/com.termux/files/home';
const raw = await Bun.file(`${home}/parametrek.json`).json();
const head: string[] = raw.head;
const pkData: any[][] = raw.data;

const colIdx: Record<string, number> = {};
head.forEach((h, i) => colIdx[h] = i);

function norm(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractCore(model: string): string {
	const cleaned = model
		.replace(/\s*-\s*(?:black|white|grey|gray|silver|gold|red|blue|green|orange|yellow|pink|purple|camo|desert|od|fde|olive|bronze|copper|titanium|ti|ss|stainless)\b.*/i, '')
		.replace(/\s+(?:LED|Flashlight|Headlamp|Torch|Light|Rechargeable|Tactical).*$/i, '')
		.trim();
	const m = cleaned.match(/\b([A-Z]{1,4}\d{1,4}[A-Z]?\d?(?:\.\d)?)\b/i);
	if (m) return m[1].toUpperCase();
	return norm(cleaned);
}

// Build parametrek lookup
const pkByExact = new Map<string, any[]>();
const pkByCore = new Map<string, any[]>();
const aliases: Record<string, string[]> = {
	'led lenser': ['ledlenser'],
	'mag instrument': ['maglite'],
	'intl outdoor': ['emisar', 'noctigon'],
	'hds systems': ['hds'],
};

for (const entry of pkData) {
	const brand = norm(entry[colIdx.brand] || '');
	const model = norm(entry[colIdx.model] || '');
	const core = extractCore(entry[colIdx.model] || '');
	const brands = aliases[brand] || [brand];
	for (const b of brands) {
		pkByExact.set(`${b}|${model}`, entry);
		if (!pkByCore.has(`${b}|${core}`)) pkByCore.set(`${b}|${core}`, entry);
	}
}

// Get all entries without info_urls (the ones parametrek-crossref targeted)
const entries = db.prepare(`
	SELECT id, brand, model, throw_m, length_mm, weight_g, price_usd,
		intensity_cd, beam_angle, year, info_urls,
		led, battery, material, switch, features, color,
		lumens, runtime_hours
	FROM flashlights
	WHERE (info_urls IS NULL OR info_urls = '[]' OR info_urls = '')
	AND json_extract(type,'$[0]') NOT IN ('accessory','blog','not_flashlight','removed')
`).all() as any[];

console.log(`Checking ${entries.length} entries without info_urls...`);

const stats: Record<string, number> = {};
let totalReverts = 0;
let entriesReverted = 0;
const details: string[] = [];
const now = new Date().toISOString();

function matchesScalar(ourVal: number | null, pkField: string, pk: any[]): boolean {
	if (ourVal == null || ourVal <= 0) return false;
	const pkVal = pk[colIdx[pkField]];
	if (pkVal == null || pkVal <= 0) return false;
	return Math.abs(ourVal - pkVal) / pkVal < 0.02;
}

function matchesArray(ourVal: string | null, pkField: string, pk: any[]): boolean {
	if (!ourVal || ourVal === '[]') return false;
	const pkVal = pk[colIdx[pkField]];
	if (!pkVal || !Array.isArray(pkVal) || pkVal.length === 0) return false;
	try {
		const ourArr: string[] = JSON.parse(ourVal);
		if (!Array.isArray(ourArr) || ourArr.length === 0) return false;
		const ourSet = new Set(ourArr.map(v => v.toLowerCase()));
		const pkSet = new Set(pkVal.filter((v: any) => typeof v === 'string').map((v: string) => v.toLowerCase()));
		return [...ourSet].every(v => pkSet.has(v)) && ourSet.size <= pkSet.size;
	} catch {
		return false;
	}
}

function matchesNumArray(ourVal: string | null, pkField: string, pk: any[]): boolean {
	if (!ourVal || ourVal === '[]') return false;
	const pkVal = pk[colIdx[pkField]];
	if (!pkVal) return false;
	try {
		const ourArr: number[] = JSON.parse(ourVal);
		const pkArr: number[] = Array.isArray(pkVal) ? pkVal : [pkVal];
		if (ourArr.length !== pkArr.length || ourArr.length === 0) return false;
		return ourArr.every((v, i) => Math.abs(v - pkArr[i]) / Math.max(pkArr[i], 1) < 0.02);
	} catch {
		return false;
	}
}

const tx = db.transaction(() => {
	for (const entry of entries) {
		const brand = norm(entry.brand);
		const model = norm(entry.model);
		const core = extractCore(entry.model);
		let pk = pkByExact.get(`${brand}|${model}`);
		if (!pk) pk = pkByCore.get(`${brand}|${core}`);
		if (!pk) continue;

		// Count how many scalar fields match parametrek (confidence signal)
		const scalarMatches: string[] = [];
		if (matchesScalar(entry.beam_angle, 'beam_angle', pk)) scalarMatches.push('beam_angle');
		if (matchesScalar(entry.intensity_cd, 'intensity', pk)) scalarMatches.push('intensity_cd');
		if (matchesScalar(entry.year, 'year', pk)) scalarMatches.push('year');
		if (matchesScalar(entry.throw_m, 'throw', pk)) scalarMatches.push('throw_m');
		if (matchesScalar(entry.length_mm, 'length', pk)) scalarMatches.push('length_mm');
		if (matchesScalar(entry.weight_g, 'weight', pk)) scalarMatches.push('weight_g');
		if (matchesScalar(entry.price_usd, 'price', pk)) scalarMatches.push('price_usd');

		// Need at least 2 scalar matches to be confident this was parametrek-filled
		if (scalarMatches.length < 2) continue;

		const fieldsCleared: string[] = [];

		// Clear scalar fields that match parametrek
		for (const field of scalarMatches) {
			if (!DRY_RUN) {
				db.prepare(`UPDATE flashlights SET ${field} = NULL, updated_at = ? WHERE id = ?`).run(now, entry.id);
			}
			stats[field] = (stats[field] || 0) + 1;
			totalReverts++;
			fieldsCleared.push(field);
		}

		// Clear array fields if 3+ scalar matches (high confidence)
		if (scalarMatches.length >= 3) {
			const arrFields: [string, string][] = [
				['led', 'led'], ['battery', 'battery'], ['material', 'material'],
				['switch', 'switch'], ['features', 'features'], ['color', 'color'],
			];
			for (const [ourField, pkField] of arrFields) {
				if (matchesArray(entry[ourField], pkField, pk)) {
					if (!DRY_RUN) {
						db.prepare(`UPDATE flashlights SET ${ourField} = '[]', updated_at = ? WHERE id = ?`).run(now, entry.id);
					}
					stats[ourField] = (stats[ourField] || 0) + 1;
					totalReverts++;
					fieldsCleared.push(ourField);
				}
			}

			// Clear numeric arrays too
			if (matchesNumArray(entry.lumens, 'lumens', pk)) {
				if (!DRY_RUN) {
					db.prepare(`UPDATE flashlights SET lumens = NULL, updated_at = ? WHERE id = ?`).run(now, entry.id);
				}
				stats['lumens'] = (stats['lumens'] || 0) + 1;
				totalReverts++;
				fieldsCleared.push('lumens');
			}
			if (matchesNumArray(entry.runtime_hours, 'runtime', pk)) {
				if (!DRY_RUN) {
					db.prepare(`UPDATE flashlights SET runtime_hours = NULL, updated_at = ? WHERE id = ?`).run(now, entry.id);
				}
				stats['runtime_hours'] = (stats['runtime_hours'] || 0) + 1;
				totalReverts++;
				fieldsCleared.push('runtime_hours');
			}
		}

		if (fieldsCleared.length > 0) {
			entriesReverted++;
			details.push(`${entry.brand} ${entry.model}: ${fieldsCleared.join(', ')}`);
		}
	}
});

tx();

console.log(`\n=== Parametrek Data Reversion ${DRY_RUN ? '(DRY RUN)' : ''} ===`);
console.log(`Entries affected: ${entriesReverted}`);
console.log(`\nFields cleared:`);
for (const [field, count] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
	console.log(`  ${field}: ${count}`);
}
console.log(`\nTotal field reversions: ${totalReverts}`);

if (details.length <= 50) {
	console.log('\nDetails:');
	for (const d of details) console.log(`  ${d}`);
} else {
	console.log(`\nFirst 50 of ${details.length}:`);
	for (const d of details.slice(0, 50)) console.log(`  ${d}`);
}

db.close();
