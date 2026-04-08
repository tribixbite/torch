#!/usr/bin/env bun
/**
 * Fix FL1 throw/intensity mismatches.
 *
 * ANSI FL1 formula: intensity_cd = (throw_m / 2)^2
 *   ⟹ throw_m = 2 * sqrt(intensity_cd)
 *
 * Strategy:
 *  - For most mismatches: trust intensity_cd, re-derive throw_m
 *  - For obviously bogus intensity_cd (>500k, or >100k when throw<300m):
 *    trust throw_m, re-derive intensity_cd
 */
import { Database } from 'bun:sqlite';
import { resolve } from 'path';

const dbPath = resolve(import.meta.dir, '../pipeline-data/db/torch.sqlite');
const db = new Database(dbPath);
db.exec('PRAGMA busy_timeout = 30000');
db.exec('PRAGMA journal_mode = WAL');

interface Row {
	id: string;
	brand: string;
	model: string;
	throw_m: number;
	intensity_cd: number;
}

const rows = db.prepare(`
	SELECT id, brand, model, throw_m, intensity_cd
	FROM flashlights
	WHERE throw_m IS NOT NULL AND throw_m > 0
		AND intensity_cd IS NOT NULL AND intensity_cd > 0
		AND type NOT LIKE '%removed%'
`).all() as Row[];

const updateThrow = db.prepare('UPDATE flashlights SET throw_m = ? WHERE id = ?');
const updateCd = db.prepare('UPDATE flashlights SET intensity_cd = ? WHERE id = ?');

let fixedThrow = 0;
let fixedCd = 0;

const tx = db.transaction(() => {
	for (const e of rows) {
		const expected_cd = (e.throw_m / 2) ** 2;
		const ratio = e.intensity_cd / expected_cd;

		// Only fix mismatches outside 50%-200% tolerance
		if (ratio >= 0.5 && ratio <= 2.0) continue;

		// Check if intensity_cd is obviously bogus
		const cdBogus = e.intensity_cd > 500000
			|| (e.intensity_cd > 100000 && e.throw_m < 300);

		if (cdBogus) {
			// Trust throw, re-derive cd
			const newCd = Math.round((e.throw_m / 2) ** 2);
			console.log(`  FIX cd: ${e.brand} ${e.model} — cd ${e.intensity_cd} → ${newCd} (from throw ${e.throw_m}m)`);
			updateCd.run(newCd, e.id);
			fixedCd++;
		} else {
			// Trust cd, re-derive throw
			const newThrow = Math.round(2 * Math.sqrt(e.intensity_cd));
			console.log(`  FIX throw: ${e.brand} ${e.model} — throw ${e.throw_m}m → ${newThrow}m (from cd ${e.intensity_cd})`);
			updateThrow.run(newThrow, e.id);
			fixedThrow++;
		}
	}
});

tx();

console.log(`\nFixed ${fixedThrow} throw values (re-derived from cd)`);
console.log(`Fixed ${fixedCd} intensity values (re-derived from throw)`);
console.log(`Total: ${fixedThrow + fixedCd} FL1 mismatches resolved`);

db.close();
