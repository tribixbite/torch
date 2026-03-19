#!/usr/bin/env bun
/**
 * Cross-seller deduplication:
 * 1. Delete accessories/parts from Emisar/Noctigon (jlhawaii808 inventory)
 * 2. Clean junk model names ("D4 D4V2 HIGH POWER" → "D4V2")
 * 3. Merge same-model entries across sellers (keep best data, unify sources)
 * 4. Strip verbose jlhawaii808 model suffixes
 */
import { getDb, closeDb } from '../pipeline/store/db.js';

const db = getDb();
const dryRun = !process.argv.includes('--execute');

// --- Phase 1: Delete accessories/parts ---
const accessoryPatterns = [
	'%Tool%', '%Optics%', '%MCPCB%', '%Clip%', '%O-ring%', '%Oring%',
	'%Lanyard%', '%Short Tube%', '%Extension Tube%', '%Switch cap%',
	'%Driver%', '%Adapter%', '%Bezel%', '%Tailcap%', '%Tail Cap%',
	'%Pocket Clip%', '%Gasket%', '%Body/Tube%', '%Body Tube%',
	'%Removal Tool%', '%Replacement%', '%Magnetic Tailcap Only%',
	'%PCB Board%', '%Holster%', '%parts/accessories%', '%Reflashing%',
];

const accessoryIds: string[] = [];
for (const pat of accessoryPatterns) {
	const rows = db.prepare(`
		SELECT id, model FROM flashlights
		WHERE brand IN ('Emisar','Noctigon') AND model LIKE ?
	`).all(pat) as { id: string; model: string }[];
	for (const r of rows) {
		if (!accessoryIds.includes(r.id)) {
			accessoryIds.push(r.id);
			console.log(`  ACCESSORY: "${r.model}" [${r.id}]`);
		}
	}
}

// Also catch standalone generic entries
const genericNames = db.prepare(`
	SELECT id, model FROM flashlights
	WHERE brand IN ('Emisar','Noctigon')
	AND model IN ('Single', 'Triple', 'Single LED + MCPCB', 'QUAD OPTICS CUSTOM W/REFLECTORS')
`).all() as { id: string; model: string }[];
for (const r of genericNames) {
	if (!accessoryIds.includes(r.id)) {
		accessoryIds.push(r.id);
		console.log(`  GENERIC: "${r.model}" [${r.id}]`);
	}
}

console.log(`\nPhase 1: ${accessoryIds.length} accessories/parts to delete\n`);

// --- Phase 2: Normalize junk model names ---
interface ModelFix {
	id: string;
	oldModel: string;
	newModel: string;
}
const modelFixes: ModelFix[] = [];

/** Normalize an Emisar/Noctigon model name to a clean canonical form */
function normalizeEmisarModel(model: string): string {
	let m = model;
	// Strip brand names embedded in model
	m = m.replace(/\b(?:Emisar|Noctigon)\s+/gi, '');
	// Strip CUSTOM BUILT/BUILD-TO-ORDER variations (all formats from jlhawaii808)
	m = m.replace(/\s*\*?"?\s*CUSTOM\s*"?\s*\*?"?\s*BUIL[DT]-?TO[- ]?ORDER\s*"?\*?\s*/gi, '');
	m = m.replace(/\s*\*?CUSTOM\s+BUIL[DT]-?TO[- ]?ORDER\*?\s*/gi, '');
	m = m.replace(/\s*\*?"?BUIL[DT]-?TO[- ]?ORDER"?\*?\s*/gi, '');
	// Strip verbose flashlight descriptors
	m = m.replace(/\s*W\/Lume\s*X1\s*Driver\s*/gi, '');
	m = m.replace(/\s*High\s+Power\s+(?:Quad\s+)?(?:EDC\s+)?LED\s+Flashlight\s*/gi, '');
	m = m.replace(/\s*High\s+Power\s+LED\s+Flashlight\s*/gi, '');
	m = m.replace(/\s*LED\s+Flashlight\s*/gi, '');
	m = m.replace(/\s*High\s+Power(?:\s+(?:Quad\s+)?(?:EDC|Mini))?\s*/gi, ' ');
	m = m.replace(/\s*(?:EDC\s+)?Flashlight\b/gi, '');
	m = m.replace(/\s*\d+\s*lm\b/gi, ''); // "4300lm"
	// Clean up leftover quotes (preserve * in "1*21700" but strip decorative *MULE*)
	m = m.replace(/(?<=\D)\*|\*(?=\D)/g, ''); // Strip * not between digits
	m = m.replace(/"+/g, '').replace(/\s{2,}/g, ' ').trim();
	// Strip trailing preposition fragments
	m = m.replace(/\s+(?:with|and|or)\s*$/i, '').trim();
	// Fix "D4 D4V2" → "D4V2" (nealsgadgets uses combined model names)
	m = m.replace(/^D4\s+D4V2\b/i, 'D4V2');
	return m;
}

// Find all entries that could benefit from model name cleaning
const allEmisarNoctigon = db.prepare(`
	SELECT id, model FROM flashlights
	WHERE brand IN ('Emisar','Noctigon')
`).all() as { id: string; model: string }[];

for (const r of allEmisarNoctigon) {
	if (accessoryIds.includes(r.id)) continue;
	const cleaned = normalizeEmisarModel(r.model);
	if (cleaned !== r.model && cleaned.length > 1) {
		modelFixes.push({ id: r.id, oldModel: r.model, newModel: cleaned });
	}
}

console.log(`Phase 2: ${modelFixes.length} model name fixes:`);
for (const f of modelFixes) {
	console.log(`  "${f.oldModel}" → "${f.newModel}" [${f.id}]`);
}

// --- Phase 3: Find cross-seller duplicates (same brand+model, different IDs) ---
// This runs AFTER model fixes (in execute mode) to catch newly-matching entries
interface MergePair {
	keepId: string;
	deleteId: string;
	reason: string;
}

function findDuplicatePairs(): MergePair[] {
	const pairs: MergePair[] = [];
	const dupes = db.prepare(`
		SELECT brand, model, GROUP_CONCAT(id) as ids, COUNT(*) as cnt
		FROM flashlights
		WHERE brand IN ('Emisar','Noctigon')
		GROUP BY brand, model
		HAVING cnt > 1
	`).all() as { brand: string; model: string; ids: string; cnt: number }[];

	for (const d of dupes) {
		const ids = d.ids.split(',');
		// Get all entries
		const entries = ids.map(id =>
			db.prepare('SELECT * FROM flashlights WHERE id = ?').get(id.trim()) as Record<string, unknown>
		).filter(Boolean);

		if (entries.length < 2) continue;

		// Rank entries: prefer configurable (has led_options), then most data fields
		entries.sort((a, b) => {
			const aOpts = (a.led_options as string) !== '[]' ? 1 : 0;
			const bOpts = (b.led_options as string) !== '[]' ? 1 : 0;
			if (aOpts !== bOpts) return bOpts - aOpts;

			// Count non-null/non-empty fields
			const countFields = (e: Record<string, unknown>) => {
				let n = 0;
				for (const [k, v] of Object.entries(e)) {
					if (k === 'id' || k === 'brand' || k === 'model') continue;
					if (v != null && v !== '' && v !== '[]') n++;
				}
				return n;
			};
			return countFields(b) - countFields(a);
		});

		const keepEntry = entries[0];
		for (let i = 1; i < entries.length; i++) {
			pairs.push({
				keepId: keepEntry.id as string,
				deleteId: entries[i].id as string,
				reason: `same "${d.model}" (${d.brand}), keeping entry with most data`,
			});
		}
	}
	return pairs;
}

const preMergePairs = findDuplicatePairs();
console.log(`\nPhase 3: ${preMergePairs.length} cross-seller merge pairs (before model fixes)`);
for (const p of preMergePairs) {
	console.log(`  KEEP: ${p.keepId}`);
	console.log(`  DEL:  ${p.deleteId}`);
	console.log(`  Why:  ${p.reason}\n`);
}

// === Execute ===
if (!dryRun) {
	console.log('\n=== Executing ===\n');

	// Phase 1: Delete accessories
	for (const id of accessoryIds) {
		db.prepare('DELETE FROM sources WHERE flashlight_id = ?').run(id);
		db.prepare('DELETE FROM raw_spec_text WHERE flashlight_id = ?').run(id);
		db.prepare('DELETE FROM flashlights WHERE id = ?').run(id);
	}
	console.log(`Deleted ${accessoryIds.length} accessories/parts`);

	// Phase 2: Fix model names
	for (const f of modelFixes) {
		db.prepare('UPDATE flashlights SET model = ? WHERE id = ?').run(f.newModel, f.id);
	}
	console.log(`Fixed ${modelFixes.length} model names`);

	// Phase 3: Merge duplicates (re-scan after model fixes may create new matches)
	const mergePairs = findDuplicatePairs();
	console.log(`Found ${mergePairs.length} merge pairs after model fixes`);

	const mergeJsonArrays = (a: string, b: string): string => {
		try {
			const arrA = JSON.parse(a || '[]') as unknown[];
			const arrB = JSON.parse(b || '[]') as unknown[];
			const merged = [...new Set([...arrA, ...arrB])];
			return JSON.stringify(merged);
		} catch {
			return a || b || '[]';
		}
	};

	for (const p of mergePairs) {
		const keep = db.prepare('SELECT * FROM flashlights WHERE id = ?').get(p.keepId) as Record<string, unknown>;
		const del = db.prepare('SELECT * FROM flashlights WHERE id = ?').get(p.deleteId) as Record<string, unknown>;
		if (!keep || !del) continue;

		// Merge scalar fields: fill nulls from deleted entry
		const scalarFields = ['price_usd', 'length_mm', 'weight_g', 'bezel_mm', 'body_mm',
			'intensity_cd', 'throw_m', 'beam_angle', 'efficacy', 'cri', 'cct', 'wh', 'levels', 'year'];
		const updates: string[] = [];
		const params: Record<string, unknown> = {};

		for (const f of scalarFields) {
			if (keep[f] == null && del[f] != null) {
				updates.push(`${f} = $${f}`);
				params[`$${f}`] = del[f];
			}
		}

		// Merge array fields: union
		const arrayFields = ['led', 'led_color', 'led_options', 'battery', 'charging',
			'modes', 'blink', 'material', 'color', 'impact', 'environment',
			'switch', 'features', 'purchase_urls', 'info_urls', 'image_urls'];
		for (const f of arrayFields) {
			const keepVal = keep[f] as string || '[]';
			const delVal = del[f] as string || '[]';
			if (keepVal === '[]' && delVal !== '[]') {
				updates.push(`${f} = $${f}`);
				params[`$${f}`] = delVal;
			} else if (keepVal !== '[]' && delVal !== '[]') {
				const merged = mergeJsonArrays(keepVal, delVal);
				if (merged !== keepVal) {
					updates.push(`${f} = $${f}`);
					params[`$${f}`] = merged;
				}
			}
		}

		// Merge lumens/runtime_hours
		for (const f of ['lumens', 'runtime_hours']) {
			const keepVal = keep[f] as string || '[]';
			const delVal = del[f] as string || '[]';
			if (keepVal === '[]' && delVal !== '[]') {
				updates.push(`${f} = $${f}`);
				params[`$${f}`] = delVal;
			}
		}

		if (updates.length > 0) {
			params['$id'] = p.keepId;
			db.prepare(`UPDATE flashlights SET ${updates.join(', ')} WHERE id = $id`).run(params);
			console.log(`  MERGED ${updates.length} fields from ${p.deleteId} → ${p.keepId}`);
		}

		// Transfer sources and raw_spec_text
		db.prepare('UPDATE sources SET flashlight_id = ? WHERE flashlight_id = ?').run(p.keepId, p.deleteId);
		db.prepare('UPDATE raw_spec_text SET flashlight_id = ? WHERE flashlight_id = ?').run(p.keepId, p.deleteId);
		db.prepare('DELETE FROM flashlights WHERE id = ?').run(p.deleteId);
		console.log(`  DELETED ${p.deleteId}`);
	}

	// Phase 4: Strip "New " prefix from any remaining "New X" entries
	const remainingNew = db.prepare(`
		SELECT id, model, brand FROM flashlights
		WHERE brand IN ('Emisar','Noctigon') AND model LIKE 'New %'
	`).all() as { id: string; model: string; brand: string }[];
	for (const entry of remainingNew) {
		const cleanModel = entry.model
			.replace(/^New\s+(?:Emisar|Noctigon)\s+/i, '')
			.replace(/^New\s+/i, '');
		// Check if renaming would create a conflict
		const existing = db.prepare(`
			SELECT id FROM flashlights WHERE brand = ? AND model = ? AND id != ?
		`).get(entry.brand, cleanModel, entry.id) as { id: string } | undefined;
		if (existing) {
			// Merge into existing entry instead of renaming
			console.log(`  MERGE+DELETE "${entry.model}" → existing "${cleanModel}" [${existing.id}]`);
			db.prepare('UPDATE sources SET flashlight_id = ? WHERE flashlight_id = ?').run(existing.id, entry.id);
			db.prepare('UPDATE raw_spec_text SET flashlight_id = ? WHERE flashlight_id = ?').run(existing.id, entry.id);
			db.prepare('DELETE FROM flashlights WHERE id = ?').run(entry.id);
		} else {
			db.prepare('UPDATE flashlights SET model = ? WHERE id = ?').run(cleanModel, entry.id);
			console.log(`  RENAMED "${entry.model}" → "${cleanModel}"`);
		}
	}

	console.log('\nDone!');
} else {
	console.log('\nDry run. Pass --execute to apply changes.');
}

closeDb();
