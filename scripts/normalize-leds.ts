/**
 * One-shot DB migration: normalize all LED values in the flashlights table.
 * Updates the `led` and `led_options` columns with canonical LED names.
 *
 * Usage: bun run scripts/normalize-leds.ts [--dry-run]
 */
import Database from 'bun:sqlite';
import { normalizeLedArray, runSelfTest } from '../pipeline/normalization/led-normalizer.js';

const DRY_RUN = process.argv.includes('--dry-run');
const db = new Database('pipeline-data/db/torch.sqlite');
db.run('PRAGMA busy_timeout = 30000');
db.run('PRAGMA journal_mode = WAL');

// Run self-test first
console.log('Running LED normalizer self-test...');
const { passed, failed, errors } = runSelfTest();
if (failed > 0) {
	console.error(`Self-test FAILED: ${failed} failures`);
	for (const err of errors) console.error(err);
	process.exit(1);
}
console.log(`Self-test OK: ${passed}/${passed + failed} passed\n`);

// Collect unique LED values before normalization
const beforeLeds = new Set<string>();
const afterLeds = new Set<string>();

// Process `led` column
const rows = db.prepare(`SELECT id, brand, model, led FROM flashlights WHERE led IS NOT NULL AND led != '[]' AND led != ''`).all() as any[];
let updated = 0;
let genericsCleared = 0;
let unchanged = 0;

const updateStmt = db.prepare(`UPDATE flashlights SET led = ?, updated_at = ? WHERE id = ?`);
const now = new Date().toISOString();

console.log(`Processing ${rows.length} entries with LED data...`);
for (const row of rows) {
	try {
		const original: string[] = JSON.parse(row.led);
		if (!Array.isArray(original)) continue;

		for (const l of original) beforeLeds.add(l);

		const normalized = normalizeLedArray(original);
		for (const l of normalized) afterLeds.add(l);

		const originalJson = JSON.stringify(original);
		const normalizedJson = JSON.stringify(normalized);

		if (originalJson !== normalizedJson) {
			if (normalized.length === 0 && original.length > 0) {
				genericsCleared++;
			}
			if (!DRY_RUN) {
				updateStmt.run(normalizedJson, now, row.id);
			}
			updated++;
			// Log significant changes (not just case changes)
			const origSet = new Set(original.map((s: string) => s.toLowerCase()));
			const normSet = new Set(normalized.map(s => s.toLowerCase()));
			const lostAll = normalized.length === 0 && original.length > 0;
			const changed = original.length !== normalized.length ||
				[...origSet].some(s => !normSet.has(s));
			if (lostAll || changed) {
				console.log(`  ${row.brand} ${row.model}: ${originalJson} → ${normalizedJson}`);
			}
		} else {
			unchanged++;
		}
	} catch {
		// Skip malformed JSON
	}
}

// Process `led_options` column
const optRows = db.prepare(`SELECT id, brand, model, led_options FROM flashlights WHERE led_options IS NOT NULL AND led_options != '[]' AND led_options != ''`).all() as any[];
let optUpdated = 0;
const updateOptStmt = db.prepare(`UPDATE flashlights SET led_options = ?, updated_at = ? WHERE id = ?`);

console.log(`\nProcessing ${optRows.length} entries with led_options...`);
for (const row of optRows) {
	try {
		const original: string[] = JSON.parse(row.led_options);
		if (!Array.isArray(original)) continue;

		const normalized = normalizeLedArray(original);
		const originalJson = JSON.stringify(original);
		const normalizedJson = JSON.stringify(normalized);

		if (originalJson !== normalizedJson) {
			if (!DRY_RUN) {
				updateOptStmt.run(normalizedJson, now, row.id);
			}
			optUpdated++;
			console.log(`  ${row.brand} ${row.model} (options): ${originalJson} → ${normalizedJson}`);
		}
	} catch {
		// Skip malformed JSON
	}
}

console.log(`\n=== Summary${DRY_RUN ? ' (DRY RUN)' : ''} ===`);
console.log(`LED column: ${updated} updated, ${unchanged} unchanged, ${genericsCleared} generics cleared`);
console.log(`LED options: ${optUpdated} updated`);
console.log(`Unique LED strings: ${beforeLeds.size} → ${afterLeds.size}`);
