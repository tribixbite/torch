#!/usr/bin/env bun
/**
 * Unified DB migration: normalize material, switch, and features columns.
 * Runs each normalizer's self-test first, then applies to DB.
 *
 * Usage: bun run scripts/normalize-all.ts [--dry-run]
 */
import Database from 'bun:sqlite';
import { normalizeMaterialArray, runSelfTest as matTest } from '../pipeline/normalization/material-normalizer.js';
import { normalizeSwitchArray, runSelfTest as swTest } from '../pipeline/normalization/switch-normalizer.js';
import { normalizeFeatureArray, runSelfTest as featTest } from '../pipeline/normalization/features-normalizer.js';

const DRY_RUN = process.argv.includes('--dry-run');
const db = new Database('pipeline-data/db/torch.sqlite');
db.run('PRAGMA busy_timeout = 30000');
db.run('PRAGMA journal_mode = WAL');

// --- Self-tests ---
console.log('Running self-tests...');
for (const [name, test] of [['Material', matTest], ['Switch', swTest], ['Features', featTest]] as const) {
	const { passed, failed, errors } = test();
	if (failed > 0) {
		console.error(`${name} self-test FAILED: ${failed} failures`);
		for (const err of errors) console.error(err);
		process.exit(1);
	}
	console.log(`  ${name}: ${passed} passed`);
}
console.log('All self-tests OK\n');

const now = new Date().toISOString();

// --- Generic column normalizer ---
interface NormConfig {
	column: string;
	normalizer: (arr: string[]) => string[];
}

function normalizeColumn(config: NormConfig) {
	const { column, normalizer } = config;
	const rows = db.prepare(
		`SELECT id, brand, model, ${column} FROM flashlights WHERE ${column} IS NOT NULL AND ${column} != '[]' AND ${column} != ''`
	).all() as any[];

	const before = new Set<string>();
	const after = new Set<string>();
	let updated = 0;
	let droppedAll = 0;
	let unchanged = 0;

	const updateStmt = db.prepare(`UPDATE flashlights SET ${column} = ?, updated_at = ? WHERE id = ?`);

	console.log(`Processing ${rows.length} entries with ${column} data...`);
	for (const row of rows) {
		try {
			const original: string[] = JSON.parse(row[column]);
			if (!Array.isArray(original)) continue;

			for (const v of original) before.add(v);
			const normalized = normalizer(original);
			for (const v of normalized) after.add(v);

			const origJson = JSON.stringify(original);
			const normJson = JSON.stringify(normalized);

			if (origJson !== normJson) {
				if (normalized.length === 0 && original.length > 0) droppedAll++;
				if (!DRY_RUN) updateStmt.run(normJson, now, row.id);
				updated++;
				// Log significant changes
				const origSet = new Set(original);
				const normSet = new Set(normalized);
				const changed = original.length !== normalized.length ||
					[...origSet].some(s => !normSet.has(s));
				if (changed && updated <= 30) {
					console.log(`  ${row.brand} ${row.model}: ${origJson} → ${normJson}`);
				}
			} else {
				unchanged++;
			}
		} catch { /* skip malformed JSON */ }
	}

	console.log(`  ${column}: ${updated} updated, ${unchanged} unchanged, ${droppedAll} fully dropped`);
	console.log(`  Unique: ${before.size} → ${after.size}\n`);
	return { before: before.size, after: after.size, updated };
}

// --- Run all normalizations ---
console.log(`=== Normalizing${DRY_RUN ? ' (DRY RUN)' : ''} ===\n`);

const matResult = normalizeColumn({ column: 'material', normalizer: normalizeMaterialArray });
const swResult = normalizeColumn({ column: 'switch', normalizer: normalizeSwitchArray });
const featResult = normalizeColumn({ column: 'features', normalizer: normalizeFeatureArray });

console.log('=== Summary ===');
console.log(`Material: ${matResult.before} → ${matResult.after} unique (${matResult.updated} rows updated)`);
console.log(`Switch:   ${swResult.before} → ${swResult.after} unique (${swResult.updated} rows updated)`);
console.log(`Features: ${featResult.before} → ${featResult.after} unique (${featResult.updated} rows updated)`);
