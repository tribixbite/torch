#!/usr/bin/env bun
/**
 * Scrape wurkkos.com product pages for missing specs.
 * UeeShop platform — product descriptions have throw in prose text.
 * JSON-LD and meta descriptions also contain spec data.
 */
import { Database } from 'bun:sqlite';
import { resolve } from 'path';

const CRAWL_DELAY = 2500;
const dbPath = resolve(import.meta.dir, '../pipeline-data/db/torch.sqlite');
const db = new Database(dbPath);
db.exec('PRAGMA busy_timeout = 30000');
db.exec('PRAGMA journal_mode = WAL');

interface WurkkosTarget {
	id: string;
	model: string;
	missingFields: string[];
}

/** Get Wurkkos entries still needing throw */
function getTargets(): WurkkosTarget[] {
	const rows = db.prepare(`
		SELECT id, model, throw_m, length_mm, runtime_hours, weight_g, switch
		FROM flashlights
		WHERE brand = 'Wurkkos' AND type NOT LIKE '%removed%'
			AND (throw_m IS NULL OR length_mm IS NULL
				OR runtime_hours IS NULL OR runtime_hours = '[]'
				OR weight_g IS NULL OR switch IS NULL OR switch = '[]')
	`).all() as any[];

	return rows.map(r => {
		const missing: string[] = [];
		if (r.throw_m === null) missing.push('throw_m');
		if (r.length_mm === null) missing.push('length_mm');
		if (r.runtime_hours === null || r.runtime_hours === '[]') missing.push('runtime');
		if (r.weight_g === null) missing.push('weight_g');
		if (r.switch === null || r.switch === '[]') missing.push('switch');
		return { id: r.id, model: r.model, missingFields: missing };
	});
}

/** Fetch all product URLs from wurkkos.com collections */
async function fetchProductUrls(): Promise<Map<string, string>> {
	const urls = new Map<string, string>();
	const collectionsUrl = 'https://www.wurkkos.com/collections/all-products';

	try {
		const resp = await fetch(collectionsUrl, {
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TorchDB/1.0)' },
			signal: AbortSignal.timeout(15000),
		});
		const html = await resp.text();

		// Extract product links
		const linkMatches = [...html.matchAll(/href="(\/products\/[^"]+)"/g)];
		for (const m of linkMatches) {
			const path = m[1];
			const fullUrl = `https://www.wurkkos.com${path}`;
			urls.set(path, fullUrl);
		}
	} catch (e) {
		console.log(`Error fetching collections: ${(e as Error).message}`);
	}

	return urls;
}

/** Try to match a DB model name to a wurkkos.com product URL */
function findProductUrl(model: string, urlMap: Map<string, string>): string | null {
	const modelLower = model.toLowerCase().replace(/\s+/g, '-');
	// Try direct match on model name
	for (const [path, url] of urlMap) {
		const pathLower = path.toLowerCase();
		// Extract core model identifier (e.g., "ts22", "hd50", "td07")
		const coreModel = model.split(' ')[0].toLowerCase();
		if (pathLower.includes(coreModel)) return url;
	}
	return null;
}

/** Extract specs from wurkkos.com product page HTML */
function extractFromPage(html: string): {
	throw_m: number | null;
	length_mm: number | null;
	weight_g: number | null;
	switch_type: string | null;
	runtime_hours: number[];
} {
	const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
	const result = { throw_m: null as number | null, length_mm: null as number | null,
		weight_g: null as number | null, switch_type: null as string | null, runtime_hours: [] as number[] };

	// Throw from meta description or body
	const throwPatterns = [
		/(?:beam\s*(?:range|distance|throw))\s*(?:of\s*|:\s*|is\s*)?(\d[\d,]*)\s*(?:m(?:eters?)?)\b/i,
		/(?:throw)\s*(?:of\s*|:\s*|is\s*)?(\d[\d,]*)\s*(?:m(?:eters?)?)\b/i,
		/(\d[\d,]*)\s*(?:m(?:eters?)?)\s*(?:beam\s*)?(?:range|distance|throw)\b/i,
		/(?:Throw|distance)\s*[:：]\s*(\d[\d,]*)\s*[Mm]/i,
		/illumination\s*distance\s*(?:exceeds?\s*|over\s*)?(\d[\d,]*)\s*m/i,
	];
	for (const pat of throwPatterns) {
		const m = text.match(pat);
		if (m) {
			const val = parseInt(m[1].replace(/,/g, ''), 10);
			if (val >= 15 && val <= 3000) { result.throw_m = val; break; }
		}
	}

	// Length
	const lenMatch = text.match(/(?:length|overall\s*length)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*mm/i);
	if (lenMatch) {
		const val = parseFloat(lenMatch[1]);
		if (val >= 30 && val <= 500) result.length_mm = val;
	}

	// Weight
	const wMatch = text.match(/(?:weight|net\s*weight)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*g(?:rams?)?\b/i);
	if (wMatch) {
		const val = parseFloat(wMatch[1]);
		if (val >= 10 && val <= 5000) result.weight_g = val;
	}

	// Switch
	if (/tail\s*switch|tactical\s*tail/i.test(text)) {
		result.switch_type = /side\s*switch/i.test(text) ? 'dual' : 'tail';
	} else if (/side\s*switch|side\s*button/i.test(text)) {
		result.switch_type = 'side';
	}

	// Runtime
	const rtMatches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)\b/gi)];
	for (const m of rtMatches) {
		const val = parseFloat(m[1]);
		if (val >= 0.1 && val <= 2000) result.runtime_hours.push(val);
	}
	result.runtime_hours = [...new Set(result.runtime_hours)].sort((a, b) => b - a);

	return result;
}

// Prepared statements
const updateThrow = db.prepare('UPDATE flashlights SET throw_m = ? WHERE id = ? AND throw_m IS NULL');
const updateLength = db.prepare('UPDATE flashlights SET length_mm = ? WHERE id = ? AND length_mm IS NULL');
const updateWeight = db.prepare('UPDATE flashlights SET weight_g = ? WHERE id = ? AND weight_g IS NULL');
const updateSwitch = db.prepare("UPDATE flashlights SET switch = ? WHERE id = ? AND (switch IS NULL OR switch = '[]')");
const updateRuntime = db.prepare("UPDATE flashlights SET runtime_hours = ? WHERE id = ? AND (runtime_hours IS NULL OR runtime_hours = '[]')");

async function main() {
	console.log('Fetching Wurkkos product catalog...');
	const urlMap = await fetchProductUrls();
	console.log(`Found ${urlMap.size} product URLs on wurkkos.com\n`);

	const targets = getTargets();
	console.log(`${targets.length} Wurkkos entries need enrichment\n`);

	let enriched = 0, fields = 0, noUrl = 0, noData = 0;

	for (const target of targets) {
		const url = findProductUrl(target.model, urlMap);
		if (!url) {
			console.log(`  NO URL: ${target.model}`);
			noUrl++;
			continue;
		}

		try {
			const resp = await fetch(url, {
				headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TorchDB/1.0)' },
				signal: AbortSignal.timeout(15000),
			});
			if (!resp.ok) {
				console.log(`  SKIP ${target.model}: HTTP ${resp.status}`);
				continue;
			}

			const html = await resp.text();
			const specs = extractFromPage(html);
			let fc = 0;

			if (specs.throw_m !== null && target.missingFields.includes('throw_m')) {
				if (updateThrow.run(specs.throw_m, target.id).changes > 0) {
					fc++; console.log(`    +throw=${specs.throw_m}m`);
				}
			}
			if (specs.length_mm !== null && target.missingFields.includes('length_mm')) {
				if (updateLength.run(specs.length_mm, target.id).changes > 0) {
					fc++; console.log(`    +length=${specs.length_mm}mm`);
				}
			}
			if (specs.weight_g !== null && target.missingFields.includes('weight_g')) {
				if (updateWeight.run(specs.weight_g, target.id).changes > 0) {
					fc++; console.log(`    +weight=${specs.weight_g}g`);
				}
			}
			if (specs.switch_type && target.missingFields.includes('switch')) {
				if (updateSwitch.run(JSON.stringify([specs.switch_type]), target.id).changes > 0) {
					fc++; console.log(`    +switch=${specs.switch_type}`);
				}
			}
			if (specs.runtime_hours.length > 0 && target.missingFields.includes('runtime')) {
				if (updateRuntime.run(JSON.stringify(specs.runtime_hours), target.id).changes > 0) {
					fc++; console.log(`    +runtime=[${specs.runtime_hours.join(',')}]`);
				}
			}

			if (fc > 0) {
				enriched++;
				fields += fc;
				console.log(`  OK ${target.model}: +${fc} fields`);
			} else {
				console.log(`  NODATA ${target.model} [${target.missingFields.join(',')}]`);
				noData++;
			}
		} catch (e) {
			console.log(`  ERROR ${target.model}: ${(e as Error).message}`);
		}

		await Bun.sleep(CRAWL_DELAY);
	}

	console.log(`\nDone: ${enriched} enriched, ${fields} fields, ${noUrl} no URL, ${noData} no data`);
}

await main();
db.close();
