/**
 * One-shot DB migration: normalize all battery values in the flashlights table.
 * Updates the `battery` column with canonical battery names.
 *
 * Usage: bun run scripts/normalize-batteries.ts [--dry-run]
 */
import Database from 'bun:sqlite';
import { normalizeBatteryArray, runSelfTest } from '../pipeline/normalization/battery-normalizer.js';

const DRY_RUN = process.argv.includes('--dry-run');
const db = new Database('pipeline-data/db/torch.sqlite');
db.run('PRAGMA busy_timeout = 30000');
db.run('PRAGMA journal_mode = WAL');

// Run self-test first
console.log('Running battery normalizer self-test...');
const { passed, failed, errors } = runSelfTest();
if (failed > 0) {
	console.error(`Self-test FAILED: ${failed} failures`);
	for (const err of errors) console.error(err);
	process.exit(1);
}
console.log(`Self-test OK: ${passed}/${passed + failed} passed\n`);

// Collect unique battery values before/after normalization
const beforeBatteries = new Set<string>();
const afterBatteries = new Set<string>();

// Process battery column
const rows = db.prepare(`SELECT id, brand, model, battery FROM flashlights WHERE battery IS NOT NULL AND battery != '[]' AND battery != ''`).all() as any[];
let updated = 0;
let droppedAll = 0;
let unchanged = 0;

const updateStmt = db.prepare(`UPDATE flashlights SET battery = ?, updated_at = ? WHERE id = ?`);
const now = new Date().toISOString();

console.log(`Processing ${rows.length} entries with battery data...`);
for (const row of rows) {
	try {
		const original: string[] = JSON.parse(row.battery);
		if (!Array.isArray(original)) continue;

		for (const b of original) beforeBatteries.add(b);

		const normalized = normalizeBatteryArray(original);
		for (const b of normalized) afterBatteries.add(b);

		const originalJson = JSON.stringify(original);
		const normalizedJson = JSON.stringify(normalized);

		if (originalJson !== normalizedJson) {
			if (normalized.length === 0 && original.length > 0) {
				droppedAll++;
			}
			if (!DRY_RUN) {
				updateStmt.run(normalizedJson, now, row.id);
			}
			updated++;
			// Log significant changes (not just reordering from dedup)
			const origSet = new Set(original);
			const normSet = new Set(normalized);
			const changed = original.length !== normalized.length ||
				[...origSet].some(s => !normSet.has(s));
			if (changed) {
				console.log(`  ${row.brand} ${row.model}: ${originalJson} → ${normalizedJson}`);
			}
		} else {
			unchanged++;
		}
	} catch {
		// Skip malformed JSON
	}
}

console.log(`\n=== Summary${DRY_RUN ? ' (DRY RUN)' : ''} ===`);
console.log(`Battery column: ${updated} updated, ${unchanged} unchanged, ${droppedAll} fully dropped`);
console.log(`Unique battery strings: ${beforeBatteries.size} → ${afterBatteries.size}`);

// Show the final canonical values
const sorted = [...afterBatteries].sort();
console.log(`\nCanonical battery values (${sorted.length}):`);
for (const b of sorted) console.log(`  ${b}`);
