#!/usr/bin/env bun
/**
 * Merge remaining duplicate groups and fix obvious decimal errors.
 */
import { Database } from 'bun:sqlite';
import { resolve } from 'path';

const dbPath = resolve(import.meta.dir, '../pipeline-data/db/torch.sqlite');
const db = new Database(dbPath);
db.exec('PRAGMA busy_timeout = 30000');
db.exec('PRAGMA journal_mode = WAL');

const tx = db.transaction(() => {
	// === MT21C: 4 entries → 1 ===
	const primary = 'nitecore-mt21c';
	const others = [
		'nitecore-mt21c-1000-lumen-adjustable-right-angle-xp-l',
		'nitecore-mt21c-1000-lumen-90-degree-tiltable-head-multifunction',
		'nitecore-mt21c-1000-lumen-multifunctional-90-degree-adjustable',
	];

	// Best values: LED=Cree XP-L, lumens=[1000,400,190,50,1], throw=184,
	// weight=103g (without battery), length=131mm, price=59.95
	db.prepare(`UPDATE flashlights SET
		led = '["Cree XP-L"]',
		lumens = '[1000,400,190,50,1]',
		weight_g = 103,
		length_mm = 131,
		price_usd = 59.95
		WHERE id = ?`).run(primary);
	console.log('Updated primary: Nitecore MT21C →', primary);

	for (const id of others) {
		db.prepare(`UPDATE flashlights SET type = '["removed"]' WHERE id = ?`).run(id);
		console.log('  Removed:', id);
	}

	// === Fix Nextorch Saint Torch 31 length decimal error: 28.5 → 285mm ===
	const st31 = db.prepare('SELECT length_mm FROM flashlights WHERE id = ?')
		.get('nextorch-saint-torch-31') as { length_mm: number } | null;
	if (st31 && st31.length_mm === 28.5) {
		db.prepare('UPDATE flashlights SET length_mm = 285 WHERE id = ?')
			.run('nextorch-saint-torch-31');
		console.log('Fixed Saint Torch 31 length: 28.5 → 285mm');
	}

	// === Fix MT21C primary length if needed (13.1 → 131 decimal error) ===
	const mt21c = db.prepare('SELECT length_mm FROM flashlights WHERE id = ?')
		.get(primary) as { length_mm: number } | null;
	console.log('MT21C primary length:', mt21c?.length_mm, 'mm');
});

tx();
db.close();
