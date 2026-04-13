/**
 * Generates static/deals.json — a curated feed of flashlight deals.
 * Runs after keepa-cron enrichment.
 * Deal = current price <= historical Amazon low. Simple.
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

// Join flashlights with their price history
const rows = db.prepare(`
	SELECT f.model, f.brand, f.price_usd, f.purchase_urls, f.updated_at,
	       r.text_content
	FROM flashlights f
	JOIN raw_spec_text r ON r.flashlight_id = f.id AND r.category = 'price_history'
	WHERE f.price_usd > 0
	  AND f.type NOT LIKE '%accessory%'
	  AND f.type NOT LIKE '%blog%'
	  AND f.type NOT LIKE '%removed%'
`).all() as {
	model: string;
	brand: string;
	price_usd: number;
	purchase_urls: string;
	updated_at: string;
	text_content: string;
}[];

const deals: DealEntry[] = [];

for (const row of rows) {
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

// Sort by price ascending (cheapest deals first), cap at 100
deals.sort((a, b) => a.price - b.price);
const top = deals.slice(0, 100);

await Bun.write(OUTPUT_PATH, JSON.stringify(top, null, 2));
console.log(`deals-feed: ${top.length} deals written to ${OUTPUT_PATH}`);

db.close();
