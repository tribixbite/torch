/**
 * Generates static/deals.json — a curated feed of flashlight deals.
 * Runs after keepa-cron enrichment. Filters to entries with ≥20% price drop
 * OR at historical low, sorted by drop percentage descending.
 */
import { Database } from 'bun:sqlite';
import { resolve } from 'path';

const DB_PATH = resolve(import.meta.dir, '../pipeline-data/db/torch.sqlite');
const OUTPUT_PATH = resolve(import.meta.dir, '../static/deals.json');

interface DealEntry {
	model: string;
	brand: string;
	price: number;
	was_price: number;
	drop_pct: number;
	at_low: boolean;
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

const now = Date.now();
const MS_90D = 90 * 24 * 60 * 60 * 1000;
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

	const sorted = [...series].sort((a, b) => a[0] - b[0]);
	const allPrices = sorted.map(p => p[1]).filter(p => p > 0);
	if (allPrices.length === 0) continue;

	const currentPrice = row.price_usd;
	const minPrice = Math.min(...allPrices);

	// 90-day median
	const cutoff90 = now - MS_90D;
	const recent = sorted.filter(p => p[0] >= cutoff90 && p[1] > 0).map(p => p[1]);
	let median90: number;
	if (recent.length >= 3) {
		const s = [...recent].sort((a, b) => a - b);
		const mid = Math.floor(s.length / 2);
		median90 = s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
	} else {
		const s = [...allPrices].sort((a, b) => a - b);
		const mid = Math.floor(s.length / 2);
		median90 = s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
	}

	const dropPct = currentPrice < median90
		? Math.round((median90 - currentPrice) / median90 * 100)
		: 0;
	const atLow = currentPrice <= minPrice * 1.05;

	// Filter: ≥20% drop OR at historical low
	if (dropPct < 20 && !atLow) continue;

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
		was_price: Math.round(median90 * 100) / 100,
		drop_pct: dropPct,
		at_low: atLow,
		url,
		updated: row.updated_at,
	});
}

// Sort by drop percentage descending, cap at 100
deals.sort((a, b) => b.drop_pct - a.drop_pct);
const top = deals.slice(0, 100);

await Bun.write(OUTPUT_PATH, JSON.stringify(top, null, 2));
console.log(`deals-feed: ${top.length} deals written to ${OUTPUT_PATH}`);

db.close();
