#!/usr/bin/env bun
/**
 * Merge duplicate brand+model entries, keeping the entry with more populated fields.
 * Also removes entries that are clearly not flashlights.
 */
import { Database } from 'bun:sqlite';
import { resolve } from 'path';

const dbPath = resolve(import.meta.dirname!, '../pipeline-data/db/torch.sqlite');
const db = new Database(dbPath);
db.exec('PRAGMA busy_timeout = 30000');
db.exec('PRAGMA journal_mode = WAL');

const dupes = db.query(`
  SELECT GROUP_CONCAT(id) as ids
  FROM flashlights
  GROUP BY LOWER(brand), LOWER(model)
  HAVING COUNT(*) > 1
`).all() as { ids: string }[];

const fields = ['led','battery','lumens','throw_m','runtime_hours','switch','features','color','material','length_mm','weight_g','price_usd','intensity_cd','image_urls','raw_spec_text','url','type','year'];

// Non-flashlight entries to delete entirely
const NOT_FLASHLIGHT = new Set([
	'miniware-mhp30-mini-hot-plate-reflow-station',
	'miniware-mhp30-mini-hot-plate-reflow-station-nichia',
]);

let merged = 0, deleted = 0;

const tx = db.transaction(() => {
	for (const group of dupes) {
		const ids = group.ids.split(',');

		if (ids.some(id => NOT_FLASHLIGHT.has(id))) {
			for (const id of ids) {
				db.run('DELETE FROM flashlights WHERE id = ?', id);
				console.log(`  DELETE (not flashlight): ${id}`);
				deleted++;
			}
			continue;
		}

		const rows = ids.map(id => db.query('SELECT * FROM flashlights WHERE id = ?').get(id) as Record<string, any>);

		const coverage = rows.map(r => {
			let count = 0;
			for (const f of fields) {
				const v = r[f];
				if (v !== null && v !== undefined && v !== '' && v !== '[]') count++;
			}
			return count;
		});

		const keepIdx = coverage[0] >= coverage[1] ? 0 : 1;
		const removeIdx = keepIdx === 0 ? 1 : 0;
		const keep = rows[keepIdx];
		const remove = rows[removeIdx];

		const updates: string[] = [];
		const values: any[] = [];
		for (const f of fields) {
			const keepVal = keep[f];
			const removeVal = remove[f];
			const keepEmpty = keepVal === null || keepVal === undefined || keepVal === '' || keepVal === '[]';
			const removeHas = removeVal !== null && removeVal !== undefined && removeVal !== '' && removeVal !== '[]';
			if (keepEmpty && removeHas) {
				updates.push(`${f} = ?`);
				values.push(removeVal);
			}
		}

		// Delete duplicate first to avoid UNIQUE constraint issues
		db.run('DELETE FROM flashlights WHERE id = ?', remove.id);

		if (updates.length > 0) {
			values.push(keep.id);
			db.run(`UPDATE flashlights SET ${updates.join(', ')} WHERE id = ?`, ...values);
			console.log(`  MERGE ${remove.id} → ${keep.id} (${updates.length} fields copied)`);
		} else {
			console.log(`  DROP  ${remove.id} (no unique data vs ${keep.id})`);
		}
		merged++;
	}
});
tx();

console.log(`\nMerged ${merged} pairs, deleted ${deleted} non-flashlight entries`);
db.close();
