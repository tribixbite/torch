#!/usr/bin/env bun
/**
 * Fix entries where weight is impossibly low for the battery type.
 *
 * Two categories:
 *  1. Accessories that inherited battery data from parent product → clear battery
 *  2. Real flashlights with bogus weight (parsed from wrong field) → clear weight
 */
import { Database } from 'bun:sqlite';
import { resolve } from 'path';

const dbPath = resolve(import.meta.dir, '../pipeline-data/db/torch.sqlite');
const db = new Database(dbPath);
db.exec('PRAGMA busy_timeout = 30000');
db.exec('PRAGMA journal_mode = WAL');

const HEAVY_BATS = ['21700', '26650', '26800', '32650'];

// Keywords indicating an accessory (not a flashlight)
const ACC_KEYWORDS = [
	'clip', 'filter', 'lens', 'holster', 'mount', 'bulb', 'lamp', 'bezel', 'ring',
	'diffuser', 'carrier', 'extender', 'sleeve', 'switch', 'cap', 'lanyard', 'wand',
	'cone', 'refill', 'grease', 'kit', 'clamp', 'module', 'reflector', 'replacement',
	'battery', 'charger', 'hook', 'dummy', 'adapter', 'accessory', 'tail cap', 'bike mount',
	'headband', 'helmet',
];

interface Row {
	id: string;
	brand: string;
	model: string;
	weight_g: number;
	battery: string;
	type: string;
}

const rows = db.prepare(`
	SELECT id, brand, model, weight_g, battery, type
	FROM flashlights
	WHERE weight_g IS NOT NULL AND weight_g > 0 AND weight_g < 20
		AND battery IS NOT NULL AND battery != '[]'
		AND type NOT LIKE '%removed%' AND type NOT LIKE '%blog%'
`).all() as Row[];

const clearWeight = db.prepare('UPDATE flashlights SET weight_g = NULL WHERE id = ?');
const clearBattery = db.prepare("UPDATE flashlights SET battery = '[]' WHERE id = ?");

let clearedWeight = 0;
let clearedBattery = 0;

const tx = db.transaction(() => {
	for (const row of rows) {
		const bats: string[] = JSON.parse(row.battery);
		const hasHeavy = bats.some(b => HEAVY_BATS.some(hb => b.includes(hb)));
		if (!hasHeavy) continue;

		const lower = (row.model || '').toLowerCase();
		const isAccessory = ACC_KEYWORDS.some(k => lower.includes(k));

		if (isAccessory) {
			// Accessory inherited battery from parent — clear battery
			console.log(`  CLEAR battery (accessory): ${row.brand} ${row.model} [${row.weight_g}g, ${bats.join(', ')}]`);
			clearBattery.run(row.id);
			clearedBattery++;
		} else {
			// Real light with bogus weight — clear weight
			console.log(`  CLEAR weight (bogus): ${row.brand} ${row.model} [${row.weight_g}g, ${bats.join(', ')}]`);
			clearWeight.run(row.id);
			clearedWeight++;
		}
	}
});

tx();

console.log(`\nCleared ${clearedWeight} bogus weights, ${clearedBattery} inherited batteries`);
console.log(`Total: ${clearedWeight + clearedBattery} entries fixed`);

db.close();
