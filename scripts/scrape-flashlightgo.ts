#!/usr/bin/env bun
/**
 * Scrape flashlightgo.com Shopify JSON API for Sofirn + Wurkkos specs.
 * Uses /products/{handle}.json — no browser needed.
 * Throw/beam distance is in prose text of body_html, not in spec lists.
 */
import { Database } from 'bun:sqlite';
import { resolve } from 'path';

const CRAWL_DELAY = 2000;
const dbPath = resolve(import.meta.dir, '../pipeline-data/db/torch.sqlite');
const db = new Database(dbPath);
db.exec('PRAGMA busy_timeout = 30000');
db.exec('PRAGMA journal_mode = WAL');

interface EnrichTarget {
	id: string;
	model: string;
	brand: string;
	handle: string; // Shopify product handle from URL
	missingFields: string[];
}

/** Extract Shopify handle from flashlightgo URL */
function extractHandle(url: string): string | null {
	const m = url.match(/flashlightgo\.com\/products\/([^?#]+)/);
	return m ? m[1] : null;
}

/** Get all entries needing enrichment */
function getTargets(): EnrichTarget[] {
	const rows = db.prepare(`
		SELECT id, model, brand, info_urls, purchase_urls,
			lumens, throw_m, runtime_hours, length_mm, weight_g, battery, switch
		FROM flashlights
		WHERE brand IN ('Sofirn', 'Wurkkos')
			AND type NOT LIKE '%removed%'
			AND (lumens IS NULL OR lumens = '[]' OR throw_m IS NULL
				OR runtime_hours IS NULL OR runtime_hours = '[]'
				OR length_mm IS NULL OR weight_g IS NULL
				OR battery IS NULL OR battery = '[]'
				OR switch IS NULL OR switch = '[]')
	`).all() as any[];

	const targets: EnrichTarget[] = [];
	for (const r of rows) {
		const allUrls = [
			...(r.info_urls ? JSON.parse(r.info_urls) : []),
			...(r.purchase_urls ? JSON.parse(r.purchase_urls) : []),
		];
		const fgUrl = allUrls.find((u: string) => u.includes('flashlightgo.com'));
		if (!fgUrl) continue;
		const handle = extractHandle(fgUrl);
		if (!handle) continue;

		const missing: string[] = [];
		if (r.lumens === null || r.lumens === '[]') missing.push('lumens');
		if (r.throw_m === null) missing.push('throw_m');
		if (r.runtime_hours === null || r.runtime_hours === '[]') missing.push('runtime');
		if (r.length_mm === null) missing.push('length_mm');
		if (r.weight_g === null) missing.push('weight_g');
		if (r.battery === null || r.battery === '[]') missing.push('battery');
		if (r.switch === null || r.switch === '[]') missing.push('switch');
		targets.push({ id: r.id, model: r.model, brand: r.brand, handle, missingFields: missing });
	}
	return targets;
}

interface ExtractedSpecs {
	throw_m: number | null;
	lumens: number | null;
	length_mm: number | null;
	weight_g: number | null;
	battery: string[];
	switch_type: string | null;
	runtime_hours: number[];
}

/** Extract specs from Shopify product body_html */
function extractSpecs(bodyHtml: string): ExtractedSpecs {
	// Strip HTML tags to plain text
	const text = bodyHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

	const specs: ExtractedSpecs = {
		throw_m: null, lumens: null, length_mm: null,
		weight_g: null, battery: [], switch_type: null, runtime_hours: [],
	};

	// === Throw / beam distance (prose text patterns) ===
	const throwPatterns = [
		/(?:beam\s*(?:range|distance|throw))\s*(?:of\s*|:\s*|is\s*|up\s*to\s*)?(\d[\d,]*)\s*(?:m(?:eters?)?)\b/i,
		/(?:throw(?:\s*distance)?)\s*(?:of\s*|:\s*|is\s*|up\s*to\s*)?(\d[\d,]*)\s*(?:m(?:eters?)?)\b/i,
		/(?:max(?:imum)?\s*(?:beam\s*)?(?:range|distance|throw))\s*(?:of\s*|:\s*|is\s*)?(\d[\d,]*)\s*(?:m(?:eters?)?)\b/i,
		/(\d[\d,]*)\s*(?:m(?:eters?)?)\s*(?:beam\s*)?(?:range|distance|throw)\b/i,
		/(?:beam|throw|distance)\s*[:=]\s*(\d[\d,]*)\s*(?:m\b|meters?)/i,
		// "Beam Distance: 600m" in spec lists
		/Beam\s*Distance\s*[:：]\s*(\d[\d,]*)\s*m/i,
	];
	for (const pat of throwPatterns) {
		const m = text.match(pat);
		if (m) {
			const val = parseInt(m[1].replace(/,/g, ''), 10);
			if (val >= 15 && val <= 3000) {
				specs.throw_m = val;
				break;
			}
		}
	}

	// === Lumens ===
	const lumensPatterns = [
		/(?:max(?:imum)?|turbo|peak)\s*(?:output|brightness|lumens?)?\s*[:=]?\s*(\d[\d,]*)\s*(?:lm|lumen)/i,
		/(\d[\d,]*)\s*(?:lm|lumens?)\s*(?:max|turbo|peak)/i,
		/(?:brightness|output|luminous\s*flux)\s*[:=]?\s*(\d[\d,]*)\s*(?:lm|lumen)/i,
	];
	for (const pat of lumensPatterns) {
		const m = text.match(pat);
		if (m) {
			const val = parseInt(m[1].replace(/,/g, ''), 10);
			if (val >= 10 && val <= 200000) {
				specs.lumens = val;
				break;
			}
		}
	}

	// === Length ===
	const lengthMatch = text.match(/(?:length|overall\s*length|total\s*length)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*mm/i)
		|| text.match(/(\d+(?:\.\d+)?)\s*mm\s*\(?(?:length|long)\b/i);
	if (lengthMatch) {
		const val = parseFloat(lengthMatch[1]);
		if (val >= 30 && val <= 500) specs.length_mm = val;
	}

	// === Weight ===
	const weightMatch = text.match(/(?:weight|net\s*weight)\s*(?:\(.*?\))?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*g(?:rams?)?\b/i)
		|| text.match(/(\d+(?:\.\d+)?)\s*g\s*(?:\(.*?(?:without|w\/o|excl).*?batter)/i);
	if (weightMatch) {
		const val = parseFloat(weightMatch[1]);
		if (val >= 10 && val <= 5000) specs.weight_g = val;
	}

	// === Battery ===
	const batteryPatterns: [RegExp, string][] = [
		[/\b21700\b/, '21700'],
		[/\b18650\b/, '18650'],
		[/\b18350\b/, '18350'],
		[/\b16340\b/, '16340'],
		[/\b14500\b/, '14500'],
		[/\b26650\b/, '26650'],
		[/\bCR123A\b/i, 'CR123A'],
	];
	for (const [pat, name] of batteryPatterns) {
		if (pat.test(text)) specs.battery.push(name);
	}

	// === Switch ===
	if (/tail\s*switch|rear\s*switch|tactical\s*tail/i.test(text)) {
		if (/side\s*switch|body\s*switch/i.test(text)) {
			specs.switch_type = 'dual';
		} else {
			specs.switch_type = 'tail';
		}
	} else if (/side\s*switch|body\s*switch/i.test(text)) {
		specs.switch_type = 'side';
	} else if (/dual\s*switch/i.test(text)) {
		specs.switch_type = 'dual';
	} else if (/rotary/i.test(text)) {
		specs.switch_type = 'rotary';
	}

	// === Runtime ===
	const rtMatches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)\b/gi)];
	for (const m of rtMatches) {
		const val = parseFloat(m[1]);
		if (val >= 0.1 && val <= 2000) specs.runtime_hours.push(val);
	}
	specs.runtime_hours = [...new Set(specs.runtime_hours)].sort((a, b) => b - a);

	return specs;
}

// Prepared update statements
const updateThrow = db.prepare('UPDATE flashlights SET throw_m = ? WHERE id = ? AND throw_m IS NULL');
const updateLumens = db.prepare("UPDATE flashlights SET lumens = ? WHERE id = ? AND (lumens IS NULL OR lumens = '[]')");
const updateRuntime = db.prepare("UPDATE flashlights SET runtime_hours = ? WHERE id = ? AND (runtime_hours IS NULL OR runtime_hours = '[]')");
const updateLength = db.prepare('UPDATE flashlights SET length_mm = ? WHERE id = ? AND length_mm IS NULL');
const updateWeight = db.prepare('UPDATE flashlights SET weight_g = ? WHERE id = ? AND weight_g IS NULL');
const updateBattery = db.prepare("UPDATE flashlights SET battery = ? WHERE id = ? AND (battery IS NULL OR battery = '[]')");
const updateSwitch = db.prepare("UPDATE flashlights SET switch = ? WHERE id = ? AND (switch IS NULL OR switch = '[]')");

async function main() {
	const targets = getTargets();
	console.log(`Scraping ${targets.length} entries via Shopify JSON API...\n`);

	let totalEnriched = 0;
	let totalFields = 0;
	let errors = 0;

	for (const target of targets) {
		const apiUrl = `https://flashlightgo.com/products/${target.handle}.json`;
		try {
			const resp = await fetch(apiUrl, {
				headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TorchDB/1.0)' },
				signal: AbortSignal.timeout(15000),
			});

			if (!resp.ok) {
				console.log(`  SKIP ${target.brand} ${target.model}: HTTP ${resp.status}`);
				errors++;
				await Bun.sleep(CRAWL_DELAY);
				continue;
			}

			const data = await resp.json();
			const bodyHtml: string = data.product?.body_html || '';
			if (!bodyHtml) {
				console.log(`  SKIP ${target.brand} ${target.model}: empty body_html`);
				await Bun.sleep(CRAWL_DELAY);
				continue;
			}

			const specs = extractSpecs(bodyHtml);
			let fieldCount = 0;

			if (specs.throw_m !== null && target.missingFields.includes('throw_m')) {
				const r = updateThrow.run(specs.throw_m, target.id);
				if (r.changes > 0) { fieldCount++; console.log(`    +throw=${specs.throw_m}m`); }
			}
			if (specs.lumens !== null && target.missingFields.includes('lumens')) {
				const r = updateLumens.run(JSON.stringify([specs.lumens]), target.id);
				if (r.changes > 0) { fieldCount++; console.log(`    +lumens=${specs.lumens}`); }
			}
			if (specs.runtime_hours.length > 0 && target.missingFields.includes('runtime')) {
				const r = updateRuntime.run(JSON.stringify(specs.runtime_hours), target.id);
				if (r.changes > 0) { fieldCount++; console.log(`    +runtime=[${specs.runtime_hours.join(',')}]`); }
			}
			if (specs.length_mm !== null && target.missingFields.includes('length_mm')) {
				const r = updateLength.run(specs.length_mm, target.id);
				if (r.changes > 0) { fieldCount++; console.log(`    +length=${specs.length_mm}mm`); }
			}
			if (specs.weight_g !== null && target.missingFields.includes('weight_g')) {
				const r = updateWeight.run(specs.weight_g, target.id);
				if (r.changes > 0) { fieldCount++; console.log(`    +weight=${specs.weight_g}g`); }
			}
			if (specs.battery.length > 0 && target.missingFields.includes('battery')) {
				const r = updateBattery.run(JSON.stringify(specs.battery), target.id);
				if (r.changes > 0) { fieldCount++; console.log(`    +battery=[${specs.battery.join(',')}]`); }
			}
			if (specs.switch_type && target.missingFields.includes('switch')) {
				const r = updateSwitch.run(JSON.stringify([specs.switch_type]), target.id);
				if (r.changes > 0) { fieldCount++; console.log(`    +switch=${specs.switch_type}`); }
			}

			if (fieldCount > 0) {
				totalEnriched++;
				totalFields += fieldCount;
				console.log(`  OK ${target.brand} ${target.model}: +${fieldCount} fields`);
			} else {
				console.log(`  NODATA ${target.brand} ${target.model} [missing: ${target.missingFields.join(',')}]`);
			}
		} catch (e) {
			console.log(`  ERROR ${target.brand} ${target.model}: ${(e as Error).message}`);
			errors++;
		}

		await Bun.sleep(CRAWL_DELAY);
	}

	console.log(`\nDone: ${totalEnriched} entries enriched, ${totalFields} fields updated, ${errors} errors`);
}

await main();
db.close();
