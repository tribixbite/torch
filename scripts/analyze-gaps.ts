/**
 * Analyze data completeness gaps per brand in the flashlight database.
 * Reports missing-field percentages for the 16 required parametrek attributes.
 *
 * Usage: bun scripts/analyze-gaps.ts
 */
import { getDb, closeDb } from '../pipeline/store/db.js';

interface BrandGap {
	brand: string;
	total: number;
	// Gap counts for each field
	led: number;
	battery: number;
	lumens: number;
	throw_m: number;
	runtime_hours: number;
	switch: number;
	features: number;
	color: number;
	material: number;
	length_mm: number;
	weight_g: number;
	price_usd: number;
	purchase_url: number;
	type: number;
}

const MIN_ENTRIES = 20;
const TOP_N = 30;

const db = getDb();

// Query all flashlights grouped by brand with gap counts.
// For JSON array fields: empty means '[]' or NULL or ''.
// For scalar fields: NULL means missing.
// model and brand are always present (NOT NULL), so excluded from gap analysis.
const rows = db.prepare(`
	SELECT
		brand,
		COUNT(*) AS total,

		-- JSON array fields: missing if NULL, '', or '[]'
		SUM(CASE WHEN led IS NULL OR led = '' OR led = '[]' THEN 1 ELSE 0 END) AS led_gap,
		SUM(CASE WHEN battery IS NULL OR battery = '' OR battery = '[]' THEN 1 ELSE 0 END) AS battery_gap,
		SUM(CASE WHEN lumens IS NULL OR lumens = '' OR lumens = '[]' THEN 1 ELSE 0 END) AS lumens_gap,
		SUM(CASE WHEN runtime_hours IS NULL OR runtime_hours = '' OR runtime_hours = '[]' THEN 1 ELSE 0 END) AS runtime_gap,
		SUM(CASE WHEN switch IS NULL OR switch = '' OR switch = '[]' THEN 1 ELSE 0 END) AS switch_gap,
		SUM(CASE WHEN features IS NULL OR features = '' OR features = '[]' THEN 1 ELSE 0 END) AS features_gap,
		SUM(CASE WHEN color IS NULL OR color = '' OR color = '[]' THEN 1 ELSE 0 END) AS color_gap,
		SUM(CASE WHEN material IS NULL OR material = '' OR material = '[]' THEN 1 ELSE 0 END) AS material_gap,
		SUM(CASE WHEN type IS NULL OR type = '' OR type = '[]' THEN 1 ELSE 0 END) AS type_gap,
		SUM(CASE WHEN purchase_urls IS NULL OR purchase_urls = '' OR purchase_urls = '[]' THEN 1 ELSE 0 END) AS purchase_url_gap,

		-- Scalar fields: missing if NULL
		SUM(CASE WHEN throw_m IS NULL THEN 1 ELSE 0 END) AS throw_gap,
		SUM(CASE WHEN length_mm IS NULL THEN 1 ELSE 0 END) AS length_gap,
		SUM(CASE WHEN weight_g IS NULL THEN 1 ELSE 0 END) AS weight_gap,
		SUM(CASE WHEN price_usd IS NULL THEN 1 ELSE 0 END) AS price_gap

	FROM flashlights
	GROUP BY brand
	HAVING total >= ${MIN_ENTRIES}
	ORDER BY total DESC
	LIMIT ${TOP_N}
`).all() as Record<string, number | string>[];

// Also compute an overall summary row
const summaryRow = db.prepare(`
	SELECT
		'ALL' AS brand,
		COUNT(*) AS total,
		SUM(CASE WHEN led IS NULL OR led = '' OR led = '[]' THEN 1 ELSE 0 END) AS led_gap,
		SUM(CASE WHEN battery IS NULL OR battery = '' OR battery = '[]' THEN 1 ELSE 0 END) AS battery_gap,
		SUM(CASE WHEN lumens IS NULL OR lumens = '' OR lumens = '[]' THEN 1 ELSE 0 END) AS lumens_gap,
		SUM(CASE WHEN runtime_hours IS NULL OR runtime_hours = '' OR runtime_hours = '[]' THEN 1 ELSE 0 END) AS runtime_gap,
		SUM(CASE WHEN switch IS NULL OR switch = '' OR switch = '[]' THEN 1 ELSE 0 END) AS switch_gap,
		SUM(CASE WHEN features IS NULL OR features = '' OR features = '[]' THEN 1 ELSE 0 END) AS features_gap,
		SUM(CASE WHEN color IS NULL OR color = '' OR color = '[]' THEN 1 ELSE 0 END) AS color_gap,
		SUM(CASE WHEN material IS NULL OR material = '' OR material = '[]' THEN 1 ELSE 0 END) AS material_gap,
		SUM(CASE WHEN type IS NULL OR type = '' OR type = '[]' THEN 1 ELSE 0 END) AS type_gap,
		SUM(CASE WHEN purchase_urls IS NULL OR purchase_urls = '' OR purchase_urls = '[]' THEN 1 ELSE 0 END) AS purchase_url_gap,
		SUM(CASE WHEN throw_m IS NULL THEN 1 ELSE 0 END) AS throw_gap,
		SUM(CASE WHEN length_mm IS NULL THEN 1 ELSE 0 END) AS length_gap,
		SUM(CASE WHEN weight_g IS NULL THEN 1 ELSE 0 END) AS weight_gap,
		SUM(CASE WHEN price_usd IS NULL THEN 1 ELSE 0 END) AS price_gap
	FROM flashlights
`).get() as Record<string, number | string>;

closeDb();

// Format as percentage string
function pct(gap: number, total: number): string {
	if (total === 0) return '  -  ';
	const p = (gap / total) * 100;
	if (p === 0) return '  0% ';
	if (p === 100) return '100% ';
	return `${p.toFixed(0).padStart(3)}% `;
}

// Column definitions: [header, db column suffix]
const cols: [string, string][] = [
	['type', 'type_gap'],
	['led', 'led_gap'],
	['battery', 'battery_gap'],
	['lumens', 'lumens_gap'],
	['throw', 'throw_gap'],
	['runtime', 'runtime_gap'],
	['switch', 'switch_gap'],
	['features', 'features_gap'],
	['color', 'color_gap'],
	['material', 'material_gap'],
	['length', 'length_gap'],
	['weight', 'weight_gap'],
	['price', 'price_gap'],
	['purch_url', 'purchase_url_gap'],
];

// Header
const brandW = 20;
const totalW = 6;
const colW = 9;
const header =
	'brand'.padEnd(brandW) +
	'total'.padStart(totalW) +
	cols.map(([h]) => h.padStart(colW)).join('');
const separator = '-'.repeat(header.length);

console.log('\n=== Flashlight DB — Data Gaps by Brand (min ' + MIN_ENTRIES + ' entries, top ' + TOP_N + ') ===\n');
console.log(header);
console.log(separator);

for (const row of rows) {
	const brand = String(row.brand).padEnd(brandW).slice(0, brandW);
	const total = Number(row.total);
	const line =
		brand +
		String(total).padStart(totalW) +
		cols.map(([, key]) => pct(Number(row[key]), total).padStart(colW)).join('');
	console.log(line);
}

// Summary row
console.log(separator);
{
	const total = Number(summaryRow.total);
	const line =
		'ALL'.padEnd(brandW) +
		String(total).padStart(totalW) +
		cols.map(([, key]) => pct(Number(summaryRow[key]), total).padStart(colW)).join('');
	console.log(line);
}

// Compute average gap score per brand (avg of all field gap percentages)
console.log('\n\n=== Worst Overall Completeness (avg gap% across all 14 checked fields) ===\n');
const brandScores = rows.map((row) => {
	const total = Number(row.total);
	const gaps = cols.map(([, key]) => (Number(row[key]) / total) * 100);
	const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
	return { brand: String(row.brand), total, avgGap };
});
brandScores.sort((a, b) => b.avgGap - a.avgGap);

console.log('brand'.padEnd(brandW) + 'total'.padStart(totalW) + 'avg_gap%'.padStart(10));
console.log('-'.repeat(brandW + totalW + 10));
for (const { brand, total, avgGap } of brandScores) {
	console.log(
		brand.padEnd(brandW).slice(0, brandW) +
			String(total).padStart(totalW) +
			`${avgGap.toFixed(1)}%`.padStart(10),
	);
}
