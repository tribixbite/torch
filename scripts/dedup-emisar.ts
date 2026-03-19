#!/usr/bin/env bun
/**
 * Deduplicate Emisar/Noctigon entries:
 * 1. Merge "New X" entries into their base "X" counterparts
 * 2. Merge old LED-suffix entries into configurable (no-LED-suffix) entries
 * 3. Keep the best data from each entry during merge
 */
import { getDb, closeDb } from '../pipeline/store/db.js';

const db = getDb();

interface MergePair {
	keepId: string;
	deleteId: string;
	reason: string;
}

// Find merge candidates
const pairs: MergePair[] = [];

// 1. Find "New X" → "X" pairs (prefer the configurable entry with led_options)
const newEntries = db.prepare(`
	SELECT id, model, brand, led, led_options, price_usd,
		length_mm, weight_g, throw_m, lumens, runtime_hours,
		switch, features, color, material, battery
	FROM flashlights
	WHERE brand IN ('Emisar','Noctigon') AND model LIKE 'New %'
`).all() as Record<string, unknown>[];

for (const newEntry of newEntries) {
	const newModel = newEntry.model as string;
	// Strip "New " or "New Emisar " or "New Noctigon " prefix
	const baseModel = newModel
		.replace(/^New\s+(?:Emisar|Noctigon)\s+/i, '')
		.replace(/^New\s+/i, '');

	// Also try stripping "with tint ramping and instant" suffix for matching
	const baseModelClean = baseModel
		.replace(/\s+with\s+tint\s+ramping\s+(?:and|&amp;|&)\s+instant\s*/i, '')
		.trim();

	// Look for matching base entry
	const candidates = db.prepare(`
		SELECT id, model, led_options, price_usd FROM flashlights
		WHERE brand = ? AND (model = ? OR model = ?)
		AND id != ?
	`).all(newEntry.brand, baseModel, baseModelClean, newEntry.id) as Record<string, unknown>[];

	if (candidates.length > 0) {
		const base = candidates[0];
		// Prefer the entry with led_options (configurable data)
		const newHasOpts = (newEntry.led_options as string) !== '[]';
		const baseHasOpts = (base.led_options as string) !== '[]';

		if (newHasOpts && !baseHasOpts) {
			pairs.push({ keepId: newEntry.id as string, deleteId: base.id as string, reason: `"${newModel}" has led_options, "${base.model}" doesn't` });
		} else {
			pairs.push({ keepId: base.id as string, deleteId: newEntry.id as string, reason: `"${base.model}" is base, "${newModel}" is "New" variant` });
		}
	}
}

// 2. Find same-model entries where one has LED suffix and the other doesn't
const dupes = db.prepare(`
	SELECT f1.id as id1, f2.id as id2, f1.model,
		f1.led_options as opts1, f2.led_options as opts2,
		f1.price_usd as price1, f2.price_usd as price2
	FROM flashlights f1
	JOIN flashlights f2 ON f1.brand = f2.brand AND f1.model = f2.model AND f1.id < f2.id
	WHERE f1.brand IN ('Emisar','Noctigon')
`).all() as Record<string, unknown>[];

for (const d of dupes) {
	const hasOpts1 = (d.opts1 as string) !== '[]';
	const hasOpts2 = (d.opts2 as string) !== '[]';
	if (hasOpts1 && !hasOpts2) {
		pairs.push({ keepId: d.id1 as string, deleteId: d.id2 as string, reason: `same model "${d.model}", first has led_options` });
	} else if (hasOpts2 && !hasOpts1) {
		pairs.push({ keepId: d.id2 as string, deleteId: d.id1 as string, reason: `same model "${d.model}", second has led_options` });
	} else {
		// Both have or both lack led_options — keep the one with more data
		const price1 = d.price1 as number | null;
		const price2 = d.price2 as number | null;
		if (price1 && !price2) {
			pairs.push({ keepId: d.id1 as string, deleteId: d.id2 as string, reason: `same model "${d.model}", first has price` });
		} else {
			pairs.push({ keepId: d.id2 as string, deleteId: d.id1 as string, reason: `same model "${d.model}", second preferred` });
		}
	}
}

// 3. Find "New" entries with NO matching base (these are standalone "New" products)
// These should have their "New" prefix stripped from the model name

console.log(`Found ${pairs.length} merge pairs:\n`);
for (const p of pairs) {
	console.log(`  KEEP: ${p.keepId}`);
	console.log(`  DEL:  ${p.deleteId}`);
	console.log(`  Why:  ${p.reason}\n`);
}

if (process.argv.includes('--execute')) {
	console.log('\n=== Executing merges ===\n');

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

	for (const p of pairs) {
		const keep = db.prepare('SELECT * FROM flashlights WHERE id = ?').get(p.keepId) as Record<string, unknown>;
		const del = db.prepare('SELECT * FROM flashlights WHERE id = ?').get(p.deleteId) as Record<string, unknown>;
		if (!keep || !del) {
			console.log(`  SKIP: ${p.keepId} or ${p.deleteId} not found`);
			continue;
		}

		// Merge scalar fields: keep non-null values from both, prefer keepId
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

		// Merge lumens/runtime_hours (JSON number arrays)
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

		// Transfer sources
		db.prepare(`UPDATE sources SET flashlight_id = ? WHERE flashlight_id = ?`).run(p.keepId, p.deleteId);
		// Transfer raw_spec_text
		db.prepare(`UPDATE raw_spec_text SET flashlight_id = ? WHERE flashlight_id = ?`).run(p.keepId, p.deleteId);
		// Delete the duplicate
		db.prepare('DELETE FROM flashlights WHERE id = ?').run(p.deleteId);
		console.log(`  DELETED ${p.deleteId}`);
	}

	// 4. Strip "New" prefix from remaining "New X" entries that had no base match
	const remainingNew = db.prepare(`
		SELECT id, model FROM flashlights
		WHERE brand IN ('Emisar','Noctigon') AND model LIKE 'New %'
	`).all() as { id: string; model: string }[];

	for (const entry of remainingNew) {
		const cleanModel = entry.model
			.replace(/^New\s+(?:Emisar|Noctigon)\s+/i, '')
			.replace(/^New\s+/i, '');
		db.prepare('UPDATE flashlights SET model = ? WHERE id = ?').run(cleanModel, entry.id);
		console.log(`  RENAMED "${entry.model}" → "${cleanModel}"`);
	}

	// 5. Also handle "D4 D4V2 HIGH POWER" junk model name from jlhawaii808
	const junkNames = db.prepare(`
		SELECT id, model FROM flashlights
		WHERE brand IN ('Emisar','Noctigon')
		AND (model LIKE '%HIGH POWER%' OR model LIKE '%LED Flashlight%')
	`).all() as { id: string; model: string }[];

	for (const entry of junkNames) {
		// Try to extract the real model: "D4 D4V2 HIGH POWER" → "D4V2"
		const match = entry.model.match(/\b(D[A-Z]?\d+[A-Z]*(?:\s+(?:Ti|Brass|Copper|Mule|V2))*)\b/i);
		if (match) {
			console.log(`  CLEANED "${entry.model}" → "${match[1]}"`);
			// Don't update yet — check if it would create a duplicate
		}
	}

	console.log('\nDone!');
} else {
	console.log('Dry run. Pass --execute to actually merge.');
}

closeDb();
