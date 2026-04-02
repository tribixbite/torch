#!/usr/bin/env bun
/**
 * Clear obviously bogus spec values from the DB.
 *
 * Targets:
 *  - throw_m <= 10    (star ratings, quantities, page positions parsed as throw)
 *  - throw_m > 5000   where NOT a known LEP/searchlight (model numbers parsed as throw)
 *  - weight_g > 5000  (model numbers / capacities parsed as weight)
 *  - length_mm < 10   (accessory dimensions, not flashlight lengths)
 *  - length_mm > 1000 (USB cables, not flashlights)
 *
 * Does NOT guess replacement values — sets to NULL (honest empty).
 */
import Database from 'better-sqlite3';
import { resolve } from 'path';

const dbPath = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '../pipeline-data/db/torch.sqlite');
const db = new Database(dbPath);
db.exec('PRAGMA busy_timeout = 30000');
db.exec('PRAGMA journal_mode = WAL');

// Known real LEP/searchlight IDs that legitimately exceed 5km throw
const LEGIT_HIGH_THROW = new Set([
	'acebeam-w10-gen-ii-ultra-throw-lep-flashlight-450-lumens-includes-1-x-21700',
	'acebeam-w50-20-zoomable-lep-flashlight',
	'nlightd-x1-3000lm-5786m-lep',
	'sky-lumen-one-off-abandoned-prototype',
	'sky-lumen-lumintop-b01vn-bicycle',
]);

// Known heavy industrial lights (scene lights, tripod lights) — verify manually
const LEGIT_HEAVY = new Set([
	'streamlight-portable-scene-light-rechargeable-lantern-with-120v-ac-dc-charger-6-x-c4-leds-3600-lumens-uses-2-x-12v-slas-45670',
	'nightsearcher-twinstar-connect-led-tripod',
	'core-lighting-wl-t006-led-tripod',
]);

interface Row {
	id: string;
	model: string;
	brand: string;
	throw_m: number | null;
	weight_g: number | null;
	length_mm: number | null;
}

let cleared = { throwLow: 0, throwHigh: 0, weight: 0, lengthLow: 0, lengthHigh: 0 };

const clearThrow = db.prepare('UPDATE flashlights SET throw_m = NULL, intensity_cd = NULL WHERE id = ?');
const clearWeight = db.prepare('UPDATE flashlights SET weight_g = NULL WHERE id = ?');
const clearLength = db.prepare('UPDATE flashlights SET length_mm = NULL WHERE id = ?');

const tx = db.transaction(() => {
	// 0. Clear bogus throw <= 10m (star ratings, quantities, page positions — no real flashlight has ≤10m throw)
	const lowThrow = db.prepare(
		'SELECT id, model, brand, throw_m, intensity_cd FROM flashlights WHERE throw_m IS NOT NULL AND throw_m > 0 AND throw_m <= 10'
	).all() as (Row & { intensity_cd: number | null })[];

	for (const row of lowThrow) {
		// Also clear intensity_cd if it was FL1-derived from the bogus throw (within 50% of (throw/2)^2)
		const expectedCd = (row.throw_m! * row.throw_m!) / 4;
		const clearIntensityToo = row.intensity_cd !== null &&
			row.intensity_cd >= expectedCd * 0.5 && row.intensity_cd <= expectedCd * 1.5;
		if (clearIntensityToo) {
			clearThrow.run(row.id); // clears both throw_m and intensity_cd
		} else {
			db.prepare('UPDATE flashlights SET throw_m = NULL WHERE id = ?').run(row.id);
		}
		cleared.throwLow++;
	}

	// 1. Clear bogus throw > 5000m (excluding known LEP lights)
	const highThrow = db.prepare(
		'SELECT id, model, brand, throw_m FROM flashlights WHERE throw_m > 5000'
	).all() as Row[];

	for (const row of highThrow) {
		if (LEGIT_HIGH_THROW.has(row.id)) continue;
		console.log(`  CLEAR throw: ${row.brand} ${row.model} — ${row.throw_m}m`);
		clearThrow.run(row.id);
		cleared.throwHigh++;
	}

	// 2. Clear bogus weight > 5000g (excluding known industrial lights)
	const heavyWeight = db.prepare(
		'SELECT id, model, brand, weight_g FROM flashlights WHERE weight_g > 5000'
	).all() as Row[];

	for (const row of heavyWeight) {
		if (LEGIT_HEAVY.has(row.id)) continue;
		console.log(`  CLEAR weight: ${row.brand} ${row.model} — ${row.weight_g}g`);
		clearWeight.run(row.id);
		cleared.weight++;
	}

	// 3. Clear bogus length < 10mm (accessory dimensions, filter remnants)
	const shortLength = db.prepare(
		'SELECT id, model, brand, length_mm FROM flashlights WHERE length_mm < 10 AND length_mm IS NOT NULL'
	).all() as Row[];

	for (const row of shortLength) {
		console.log(`  CLEAR length: ${row.brand} ${row.model} — ${row.length_mm}mm`);
		clearLength.run(row.id);
		cleared.lengthLow++;
	}

	// 4. Clear bogus length > 1000mm (USB cables, non-flashlights)
	const longLength = db.prepare(
		'SELECT id, model, brand, length_mm FROM flashlights WHERE length_mm > 1000'
	).all() as Row[];

	for (const row of longLength) {
		console.log(`  CLEAR length: ${row.brand} ${row.model} — ${row.length_mm}mm`);
		clearLength.run(row.id);
		cleared.lengthHigh++;
	}
});

tx();

console.log(`\nCleared ${cleared.throwLow} bogus throw ≤10m, ${cleared.throwHigh} bogus throw >5km, ${cleared.weight} bogus weight, ${cleared.lengthLow + cleared.lengthHigh} bogus length (${cleared.lengthLow} <10mm, ${cleared.lengthHigh} >1m)`);

db.close();
