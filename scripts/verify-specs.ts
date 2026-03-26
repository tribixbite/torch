#!/usr/bin/env bun
/**
 * Spec verification — cross-check all entries against reasonable bounds.
 * Flags but does NOT auto-fix (per data integrity rules).
 * Appends findings to output/data-audit.md.
 */
import { Database } from 'bun:sqlite';
import { resolve } from 'path';
import { existsSync } from 'fs';

const dbPath = resolve(import.meta.dir, '../pipeline-data/db/torch.sqlite');
const db = new Database(dbPath, { readonly: true });
db.exec('PRAGMA busy_timeout = 30000');

interface Row { [key: string]: any }

interface Flagged {
	id: string;
	brand: string;
	model: string;
	issue: string;
	value: string;
}

const flags: Flagged[] = [];

// Get all non-removed entries
const entries = db.prepare(`
	SELECT * FROM flashlights WHERE type NOT LIKE '%removed%' AND type NOT LIKE '%blog%'
`).all() as Row[];

console.log(`Verifying ${entries.length} entries...`);

for (const e of entries) {
	// Weight sanity: 1g – 5000g
	if (e.weight_g != null && e.weight_g > 0) {
		if (e.weight_g < 1) flags.push({ id: e.id, brand: e.brand, model: e.model, issue: 'weight too low', value: `${e.weight_g}g` });
		if (e.weight_g > 5000) flags.push({ id: e.id, brand: e.brand, model: e.model, issue: 'weight >5kg', value: `${e.weight_g}g` });
	}

	// Length sanity: 10mm – 1000mm
	if (e.length_mm != null && e.length_mm > 0) {
		if (e.length_mm < 10) flags.push({ id: e.id, brand: e.brand, model: e.model, issue: 'length <10mm', value: `${e.length_mm}mm` });
		if (e.length_mm > 1000) flags.push({ id: e.id, brand: e.brand, model: e.model, issue: 'length >1m', value: `${e.length_mm}mm` });
	}

	// Price sanity: 0 – 5000
	if (e.price_usd != null && e.price_usd > 5000) {
		flags.push({ id: e.id, brand: e.brand, model: e.model, issue: 'price >$5000', value: `$${e.price_usd}` });
	}

	// Throw sanity: >5000m needs LEP or searchlight justification
	if (e.throw_m != null && e.throw_m > 5000) {
		flags.push({ id: e.id, brand: e.brand, model: e.model, issue: 'throw >5km', value: `${e.throw_m}m` });
	}

	// Lumens sanity
	if (e.lumens && e.lumens !== '[]') {
		try {
			const arr = JSON.parse(e.lumens) as number[];
			const maxLum = Math.max(...arr);
			if (maxLum > 200000) {
				flags.push({ id: e.id, brand: e.brand, model: e.model, issue: 'lumens >200k', value: `${maxLum}lm` });
			}
		} catch { /* skip parse errors */ }
	}

	// Runtime sanity
	if (e.runtime_hours && e.runtime_hours !== '[]') {
		try {
			const arr = JSON.parse(e.runtime_hours) as number[];
			const maxRuntime = Math.max(...arr);
			if (maxRuntime > 10000) {
				flags.push({ id: e.id, brand: e.brand, model: e.model, issue: 'runtime >10,000h', value: `${maxRuntime}h` });
			}
		} catch { /* skip parse errors */ }
	}

	// ANSI FL1 consistency: intensity_cd ≈ (throw_m/2)²
	if (e.throw_m != null && e.throw_m > 0 && e.intensity_cd != null && e.intensity_cd > 0) {
		const expected = (e.throw_m / 2) ** 2;
		const ratio = e.intensity_cd / expected;
		if (ratio < 0.5 || ratio > 2.0) {
			flags.push({
				id: e.id, brand: e.brand, model: e.model,
				issue: 'FL1 mismatch (throw vs intensity)',
				value: `throw=${e.throw_m}m → expected ${Math.round(expected)}cd, got ${e.intensity_cd}cd (ratio: ${ratio.toFixed(2)})`
			});
		}
	}

	// Battery vs weight: impossible combos
	if (e.weight_g != null && e.weight_g > 0 && e.weight_g < 20 && e.battery && e.battery !== '[]') {
		try {
			const bats = JSON.parse(e.battery) as string[];
			const heavyBats = ['21700', '26650', '26800', '32650'];
			if (bats.some(b => heavyBats.some(hb => b.includes(hb)))) {
				flags.push({
					id: e.id, brand: e.brand, model: e.model,
					issue: 'weight too low for battery type',
					value: `${e.weight_g}g with ${bats.join(', ')}`
				});
			}
		} catch { /* skip parse errors */ }
	}
}

// Sort flags by issue type
flags.sort((a, b) => a.issue.localeCompare(b.issue) || a.brand.localeCompare(b.brand));

// Print summary
const issueCounts: Record<string, number> = {};
for (const f of flags) {
	issueCounts[f.issue] = (issueCounts[f.issue] ?? 0) + 1;
}

console.log(`\nSpec verification complete: ${flags.length} issues found`);
for (const [issue, count] of Object.entries(issueCounts).sort((a, b) => b[1] - a[1])) {
	console.log(`  ${issue}: ${count}`);
}

// Append to audit report
const outputPath = resolve(import.meta.dir, '../output/data-audit.md');
const sections: string[] = [];
sections.push('\n## 7. Spec Verification Flags\n');
sections.push(`${flags.length} issues found across ${entries.length} entries.\n`);

sections.push('| Issue | Count |');
sections.push('|-------|-------|');
for (const [issue, count] of Object.entries(issueCounts).sort((a, b) => b[1] - a[1])) {
	sections.push(`| ${issue} | ${count} |`);
}
sections.push('');

// Detail listing
for (const [issue, _count] of Object.entries(issueCounts).sort((a, b) => b[1] - a[1])) {
	sections.push(`### ${issue}`);
	const items = flags.filter(f => f.issue === issue);
	for (const f of items.slice(0, 30)) {
		sections.push(`- **${f.brand} ${f.model}** (${f.id}): ${f.value}`);
	}
	if (items.length > 30) sections.push(`- ... and ${items.length - 30} more`);
	sections.push('');
}

if (existsSync(outputPath)) {
	const existing = await Bun.file(outputPath).text();
	await Bun.write(outputPath, existing + '\n' + sections.join('\n'));
} else {
	await Bun.write(outputPath, sections.join('\n'));
}
console.log(`\nAppended to ${outputPath}`);
