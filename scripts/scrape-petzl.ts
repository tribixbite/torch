#!/usr/bin/env bun
/**
 * Scrape Petzl headlamp specs from petzl.com product pages.
 *
 * Uses fetch (pages are server-rendered, no JS needed).
 * Extracts: lumens, throw, runtime, weight, battery, price, switch, features.
 * Petzl does NOT publish: LED type, length, material.
 */
import { Database } from 'bun:sqlite';
import { resolve } from 'path';

const CRAWL_DELAY = 2000;
const dbPath = resolve(import.meta.dir, '../pipeline-data/db/torch.sqlite');
const db = new Database(dbPath);
db.exec('PRAGMA busy_timeout = 30000');
db.exec('PRAGMA journal_mode = WAL');

// Petzl product URLs from site reconnaissance
const PETZL_PRODUCTS = [
	// Sport headlamps
	{ slug: 'DUO-RL', category: 'Sport' },
	{ slug: 'DUO-S', category: 'Sport' },
	{ slug: 'NAO-RL', category: 'Sport' },
	{ slug: 'SWIFT-RL', category: 'Sport' },
	{ slug: 'SWIFT-RL-CLASSIC', category: 'Sport' },
	{ slug: 'ARIA-2R-RGB', category: 'Sport' },
	{ slug: 'ACTIK-CORE', category: 'Sport' },
	{ slug: 'IKO-CORE', category: 'Sport' },
	{ slug: 'ACTIK', category: 'Sport' },
	{ slug: 'SWIFT-LT', category: 'Sport' },
	{ slug: 'IKO', category: 'Sport' },
	{ slug: 'ARIA-1R-RGB', category: 'Sport' },
	{ slug: 'TIKKA-CORE', category: 'Sport' },
	{ slug: 'TIKKA', category: 'Sport' },
	{ slug: 'TIKKINA', category: 'Sport' },
	{ slug: 'TIKKID', category: 'Sport' },
	// Professional headlamps
	{ slug: 'XENA', category: 'Professional' },
	{ slug: 'PIXA-R', category: 'Professional' },
	{ slug: 'PIXA', category: 'Professional' },
	{ slug: 'ARIA-2R', category: 'Professional' },
	{ slug: 'ARIA-1R', category: 'Professional' },
	{ slug: 'ARIA-2', category: 'Professional' },
	{ slug: 'ARIA-1', category: 'Professional' },
	{ slug: 'ARIA-2-RGB', category: 'Professional' },
	{ slug: 'ARIA-1-RGB', category: 'Professional' },
];

interface PetzlSpecs {
	slug: string;
	url: string;
	lumens: number | null;
	throw_m: number | null;
	runtime_hours: number[];
	weight_g: number | null;
	battery: string[];
	price_usd: number | null;
	features: string[];
	switch_type: string | null;
	ipx: string | null;
}

/** Parse specs from raw HTML text */
function parseSpecs(html: string, slug: string, url: string): PetzlSpecs {
	const specs: PetzlSpecs = {
		slug, url,
		lumens: null, throw_m: null, runtime_hours: [],
		weight_g: null, battery: [], price_usd: null,
		features: [], switch_type: null, ipx: null,
	};

	// Brightness (lumens) from specs section
	const brightnessMatch = html.match(/Brightness\s*:?\s*(\d+)\s*(?:lm|lumen)/i);
	if (brightnessMatch) specs.lumens = parseInt(brightnessMatch[1]);

	// Weight from specs section
	const weightMatch = html.match(/Weight\s*:?\s*(\d+)\s*g/i);
	if (weightMatch) specs.weight_g = parseInt(weightMatch[1]);

	// Price
	const priceMatch = html.match(/\$(\d+(?:\.\d{2})?)/);
	if (priceMatch) specs.price_usd = parseFloat(priceMatch[1]);

	// IPX rating
	const ipxMatch = html.match(/IP[X ]?\d+/i);
	if (ipxMatch) specs.ipx = ipxMatch[0].replace(' ', '').toUpperCase();

	// Battery / energy
	const energyMatch = html.match(/Energy\s*:?\s*([^<\n]+)/i);
	if (energyMatch) {
		const energy = energyMatch[1].trim();
		if (/lithium.ion|li-ion|rechargeable/i.test(energy)) {
			specs.battery.push('built-in');
		}
		if (/3\s*x?\s*AAA|AAA/i.test(energy)) {
			specs.battery.push('AAA');
		}
		if (/AA(?!A)/i.test(energy)) {
			specs.battery.push('AA');
		}
	}

	// Watertightness
	if (specs.ipx) specs.features.push(specs.ipx);

	// Rechargeable
	if (/rechargeable|USB-C|USB/i.test(html)) {
		specs.features.push('rechargeable');
	}
	if (/USB-C/i.test(html)) specs.features.push('USB-C');
	if (/lock/i.test(html) && /mode|function/i.test(html)) specs.features.push('lockout');
	if (/red\s*(light|LED|mode)/i.test(html)) specs.features.push('red light');
	if (/strobe/i.test(html)) specs.features.push('strobe');
	if (/reactive/i.test(html)) specs.features.push('reactive lighting');

	// Switch type — Petzl headlamps typically use a single top/side button
	if (/single\s*button|one\s*button/i.test(html)) {
		specs.switch_type = 'side';
	} else if (/button/i.test(html)) {
		specs.switch_type = 'side';
	}

	// Lighting performance table — extract throw and runtime from MAX POWER row
	// Look for distance values in the lighting table
	const distanceMatches = [...html.matchAll(/(\d+)\s*m(?:\s|<)/g)];
	const throwCandidates = distanceMatches
		.map(m => parseInt(m[1]))
		.filter(d => d >= 20 && d <= 2000); // reasonable throw range
	if (throwCandidates.length > 0) {
		specs.throw_m = Math.max(...throwCandidates); // MAX POWER row has highest distance
	}

	// Runtime — look for hour values
	const runtimeMatches = [...html.matchAll(/(\d+(?:\.\d+)?)\s*h(?:ours?|r)?(?:\s|<|$)/gi)];
	const runtimeValues = runtimeMatches
		.map(m => parseFloat(m[1]))
		.filter(h => h >= 0.5 && h <= 1000); // reasonable runtime range
	if (runtimeValues.length > 0) {
		// Deduplicate and sort descending
		specs.runtime_hours = [...new Set(runtimeValues)].sort((a, b) => b - a);
	}

	return specs;
}

/** Fetch a Petzl product page */
async function fetchProduct(slug: string, category: string): Promise<PetzlSpecs | null> {
	const url = `https://www.petzl.com/US/en/${category}/Headlamps/${slug}`;
	try {
		const resp = await fetch(url, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (compatible; TorchDB/1.0)',
				'Accept': 'text/html',
			},
		});
		if (!resp.ok) {
			console.log(`  SKIP ${slug}: HTTP ${resp.status}`);
			return null;
		}
		const html = await resp.text();
		return parseSpecs(html, slug, url);
	} catch (e) {
		console.log(`  ERROR ${slug}: ${(e as Error).message}`);
		return null;
	}
}

/** Match Petzl slug to DB entries */
function matchToDb(slug: string): string[] {
	const modelName = slug.replace(/-/g, ' ').toLowerCase();
	const rows = db.prepare(`
		SELECT id FROM flashlights
		WHERE brand = 'Petzl'
			AND type NOT LIKE '%removed%'
			AND LOWER(model) LIKE ?
	`).all(`%${modelName}%`) as { id: string }[];
	return rows.map(r => r.id);
}

// Prepared statements
const updateLumens = db.prepare('UPDATE flashlights SET lumens = ? WHERE id = ? AND (lumens IS NULL OR lumens = "[]")');
const updateThrow = db.prepare('UPDATE flashlights SET throw_m = ? WHERE id = ? AND throw_m IS NULL');
const updateRuntime = db.prepare('UPDATE flashlights SET runtime_hours = ? WHERE id = ? AND (runtime_hours IS NULL OR runtime_hours = "[]")');
const updateWeight = db.prepare('UPDATE flashlights SET weight_g = ? WHERE id = ? AND weight_g IS NULL');
const updateBattery = db.prepare('UPDATE flashlights SET battery = ? WHERE id = ? AND (battery = "[]" OR battery IS NULL)');
const updatePrice = db.prepare('UPDATE flashlights SET price_usd = ? WHERE id = ? AND price_usd IS NULL');
const updateSwitch = db.prepare('UPDATE flashlights SET switch = ? WHERE id = ? AND (switch IS NULL OR switch = "[]")');

let totalUpdated = 0;
let totalFields = 0;

async function main() {
	console.log(`Scraping ${PETZL_PRODUCTS.length} Petzl products...\n`);

	for (const product of PETZL_PRODUCTS) {
		const specs = await fetchProduct(product.slug, product.category);
		if (!specs) continue;

		const dbIds = matchToDb(product.slug);
		if (dbIds.length === 0) {
			console.log(`  NO MATCH: ${product.slug}`);
			continue;
		}

		let fieldCount = 0;
		for (const id of dbIds) {
			if (specs.lumens !== null) {
				const r = updateLumens.run(JSON.stringify([specs.lumens]), id);
				if (r.changes > 0) fieldCount++;
			}
			if (specs.throw_m !== null) {
				const r = updateThrow.run(specs.throw_m, id);
				if (r.changes > 0) fieldCount++;
			}
			if (specs.runtime_hours.length > 0) {
				const r = updateRuntime.run(JSON.stringify(specs.runtime_hours), id);
				if (r.changes > 0) fieldCount++;
			}
			if (specs.weight_g !== null) {
				const r = updateWeight.run(specs.weight_g, id);
				if (r.changes > 0) fieldCount++;
			}
			if (specs.battery.length > 0) {
				const r = updateBattery.run(JSON.stringify(specs.battery), id);
				if (r.changes > 0) fieldCount++;
			}
			if (specs.price_usd !== null) {
				const r = updatePrice.run(specs.price_usd, id);
				if (r.changes > 0) fieldCount++;
			}
			if (specs.switch_type) {
				const r = updateSwitch.run(JSON.stringify([specs.switch_type]), id);
				if (r.changes > 0) fieldCount++;
			}
		}

		if (fieldCount > 0) {
			totalUpdated++;
			totalFields += fieldCount;
			console.log(`  OK ${product.slug}: +${fieldCount} fields across ${dbIds.length} entries`);
		} else {
			console.log(`  SKIP ${product.slug}: no new data (${dbIds.length} entries already complete)`);
		}

		await Bun.sleep(CRAWL_DELAY);
	}

	console.log(`\nDone: ${totalUpdated} products enriched, ${totalFields} fields updated`);
}

await main();
db.close();
