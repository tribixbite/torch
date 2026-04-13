/**
 * Generates static/deals.json — a curated feed of flashlight deals.
 * Runs after keepa-cron enrichment.
 * Deal = current price <= historical Amazon low, AND in stock on Amazon.
 */
import { Database } from 'bun:sqlite';
import { resolve } from 'path';

const DB_PATH = resolve(import.meta.dir, '../pipeline-data/db/torch.sqlite');
const OUTPUT_PATH = resolve(import.meta.dir, '../static/deals.json');

interface DealEntry {
	model: string;
	brand: string;
	price: number;
	amazon_low: number;
	url: string;
	updated: string;
}

const db = new Database(DB_PATH, { readonly: true });
db.exec('PRAGMA journal_mode = WAL');

// Load Amazon availability data — true = in stock, false = OOS
const availMap = new Map<string, boolean>();
const availRows = db.prepare(
	`SELECT flashlight_id, text_content FROM raw_spec_text WHERE category = 'amazon_availability'`
).all() as { flashlight_id: string; text_content: string }[];
for (const ar of availRows) {
	try {
		const avail = JSON.parse(ar.text_content) as Record<string, boolean>;
		availMap.set(ar.flashlight_id, Object.values(avail).some(v => v === true));
	} catch { /* skip */ }
}
console.log(`deals-feed: ${availMap.size} availability records (${[...availMap.values()].filter(v => v).length} in stock)`);

// Join flashlights with their price history
const rows = db.prepare(`
	SELECT f.id, f.model, f.brand, f.price_usd, f.purchase_urls, f.updated_at,
	       r.text_content
	FROM flashlights f
	JOIN raw_spec_text r ON r.flashlight_id = f.id AND r.category = 'price_history'
	WHERE f.price_usd > 0
	  AND f.type NOT LIKE '%accessory%'
	  AND f.type NOT LIKE '%blog%'
	  AND f.type NOT LIKE '%removed%'
`).all() as {
	id: string;
	model: string;
	brand: string;
	price_usd: number;
	purchase_urls: string;
	updated_at: string;
	text_content: string;
}[];

// Accessory keywords — products with these in the model name are not flashlights
// Accessory keywords — products with these in the model name are not flashlights
const ACCESSORY_RE = /\b(cases?|holsters?|pouche?s?|adapte?o?rs?|cables?|chargers?|covers?|replacement|battery\s+packs?|filters?|diffusers?|mounts?|brackets?|straps?|sheaths?|lanyards?|clip\s+only|glass\s+lens|o-rings?|tail\s*caps?|bezels?|pocket\s+clips?|remote\s+switch|bulbs?|conversion\s+kit|upgrade|docks?|molle|P13\.5S|krypton|rechargeable\s+batter|li-ion\s+rechargeable|ZITHION|accessories|FB-1\s+Universal)\b/i;

const deals: DealEntry[] = [];
let skippedOos = 0;
let skippedSanity = 0;
let skippedAccessory = 0;

for (const row of rows) {
	// Skip obvious accessories by model name keywords
	if (ACCESSORY_RE.test(row.model)) {
		skippedAccessory++;
		continue;
	}
	// Skip if known OOS on Amazon
	if (availMap.get(row.id) === false) {
		skippedOos++;
		continue;
	}

	let parsed: Record<string, [number, number][]>;
	try {
		parsed = JSON.parse(row.text_content);
	} catch {
		continue;
	}

	const series = parsed['Amazon'] ?? parsed['Amazon Buy Box'] ?? parsed['Amazon 3P New'];
	if (!series || series.length === 0) continue;

	const allPrices = series.map(p => p[1]).filter(p => p > 0);
	if (allPrices.length === 0) continue;

	const currentPrice = row.price_usd;
	const minPrice = Math.min(...allPrices);
	const lastAmazon = allPrices[allPrices.length - 1];

	// Price sanity: if DB price is < 30% of last Amazon price, it's a data error
	if (lastAmazon > 0 && currentPrice < lastAmazon * 0.3) {
		skippedSanity++;
		continue;
	}

	// Deal = price <= historical Amazon low
	if (currentPrice > minPrice) continue;

	// Extract first purchase URL
	let url = '';
	try {
		const urls = JSON.parse(row.purchase_urls);
		if (Array.isArray(urls) && urls.length > 0) url = urls[0];
	} catch { /* no url */ }

	deals.push({
		model: row.model,
		brand: row.brand,
		price: Math.round(currentPrice * 100) / 100,
		amazon_low: Math.round(minPrice * 100) / 100,
		url,
		updated: row.updated_at,
	});
}

// Deduplicate: URL first, then brand + core model (first alphanumeric token)
const seen = new Set<string>();
const deduped = deals.filter(d => {
	// URL-based dedup (same Amazon listing)
	if (d.url) {
		if (seen.has(d.url)) return false;
		seen.add(d.url);
	}
	// Core model dedup — "T0 Pocket Keychain" and "T0 12 Lumens" are same product
	const coreModel = d.model.match(/^[\w\-\.]+/)?.[0] ?? d.model;
	const key = `${d.brand}|${coreModel}`.toLowerCase();
	if (seen.has(key)) return false;
	seen.add(key);
	return true;
});

// Sort by price ascending (cheapest deals first), cap at 100
deduped.sort((a, b) => a.price - b.price);
const top = deduped.slice(0, 100);

await Bun.write(OUTPUT_PATH, JSON.stringify(top, null, 2));
console.log(`deals-feed: ${top.length} deals written (skipped ${skippedOos} OOS, ${skippedSanity} price-insane, ${skippedAccessory} accessories, ${deals.length - deduped.length} dupes)`);

db.close();
