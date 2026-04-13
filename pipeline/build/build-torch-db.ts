/**
 * Build step: converts SQLite data → FlashlightDB JSON format for the SPA.
 * Produces flashlights.now.json compatible with the existing frontend.
 */
import { getAllFlashlights, updateEntryType, getDb } from '../store/db.js';
import type { FlashlightEntry } from '../schema/canonical.js';
import { normalizeLedArray } from '../normalization/led-normalizer.js';
import { normalizeBatteryArray } from '../normalization/battery-normalizer.js';
import { normalizeMaterialArray } from '../normalization/material-normalizer.js';
import { normalizeSwitchArray } from '../normalization/switch-normalizer.js';
import { normalizeFeatureArray } from '../normalization/features-normalizer.js';
import { normalizeBrandName, isMappedBrand } from '../store/brand-aliases.js';
import { resolve } from 'path';
import { existsSync } from 'fs';

/** Price statistics extracted from Keepa price history */
interface PriceStats {
	min_price: number;     // all-time Amazon low
	min_90d: number;       // lowest Amazon price in last 90 days
	sparkline: string;     // pre-computed SVG path "M0,18 L2,15 ..."
}

/**
 * Load price history from raw_spec_text, extract all-time low + sparkline SVG.
 * Deal = current price <= historical Amazon low. Simple.
 * Retailer preference: Amazon > Amazon 3P New (Buy Box preferred if available).
 */
function loadPriceData(): Map<string, PriceStats> {
	const db = getDb();
	const rows = db.prepare(
		`SELECT flashlight_id, text_content FROM raw_spec_text WHERE category='price_history'`
	).all() as { flashlight_id: string; text_content: string }[];

	const result = new Map<string, PriceStats>();
	const now = Date.now();
	const MS_90D = 90 * 24 * 60 * 60 * 1000;

	for (const row of rows) {
		let parsed: Record<string, [number, number][]>;
		try {
			parsed = JSON.parse(row.text_content);
		} catch {
			continue;
		}

		// Merge retailer series — prefer Amazon (Buy Box) over 3P
		const series = parsed['Amazon'] ?? parsed['Amazon Buy Box'] ?? parsed['Amazon 3P New'];
		if (!series || series.length === 0) continue;

		// Sort by timestamp ascending
		const sorted = [...series].sort((a, b) => a[0] - b[0]);

		// Extract positive prices
		const allPrices = sorted.map(p => p[1]).filter(p => p > 0);
		if (allPrices.length === 0) continue;

		const minPrice = Math.min(...allPrices);

		// 90-day low
		const cutoff90 = now - MS_90D;
		const recent90 = sorted.filter(p => p[0] >= cutoff90 && p[1] > 0).map(p => p[1]);
		const min90d = recent90.length > 0 ? Math.min(...recent90) : minPrice;

		// Downsample to 24 buckets (last 12 months, ~15-day intervals) for sparkline
		const MS_12M = 365 * 24 * 60 * 60 * 1000;
		const bucketCount = 24;
		const bucketWidth = MS_12M / bucketCount;
		const startTime = now - MS_12M;

		const bucketPrices: number[] = [];
		for (let b = 0; b < bucketCount; b++) {
			const bucketEnd = startTime + (b + 1) * bucketWidth;
			// Find last known price before this bucket's end
			let lastPrice = NaN;
			for (let i = sorted.length - 1; i >= 0; i--) {
				if (sorted[i][0] <= bucketEnd && sorted[i][1] > 0) {
					lastPrice = sorted[i][1];
					break;
				}
			}
			bucketPrices.push(lastPrice);
		}

		// Forward-fill NaN gaps, then backfill leading NaNs
		for (let i = 1; i < bucketPrices.length; i++) {
			if (isNaN(bucketPrices[i])) bucketPrices[i] = bucketPrices[i - 1];
		}
		for (let i = bucketPrices.length - 2; i >= 0; i--) {
			if (isNaN(bucketPrices[i])) bucketPrices[i] = bucketPrices[i + 1];
		}

		// Skip if still no valid prices
		if (bucketPrices.every(p => isNaN(p))) continue;

		// Generate SVG path (viewBox 0 0 50 20)
		const validBuckets = bucketPrices.filter(p => !isNaN(p));
		const pMin = Math.min(...validBuckets);
		const pMax = Math.max(...validBuckets);
		const pRange = pMax - pMin;

		// Skip sparkline if price variation < 5% — flat lines are visual noise
		let sparklinePath = '';
		if (pRange > 0 && pRange / pMin >= 0.05) {
			const xScale = 50 / (bucketCount - 1);
			const yPadding = 2; // 2px top/bottom padding
			const yRange = 20 - 2 * yPadding;

			const points: string[] = [];
			for (let i = 0; i < bucketPrices.length; i++) {
				if (isNaN(bucketPrices[i])) continue;
				const x = (i * xScale).toFixed(1);
				// Invert Y — lower price = higher on chart
				const y = (yPadding + yRange - ((bucketPrices[i] - pMin) / pRange) * yRange).toFixed(1);
				points.push(`${i === 0 ? 'M' : 'L'}${x},${y}`);
			}
			sparklinePath = points.join(' ');
		}

		result.set(row.flashlight_id, {
			min_price: minPrice,
			min_90d: min90d,
			sparkline: sparklinePath,
		});
	}

	return result;
}

/** Garbage brand pattern — Amazon listing artifacts with lumen values parsed as brand */
const GARBAGE_BRAND_RE = /lumens?\s*light\s*house/i;

/**
 * Normalize brand at build time. Applies BRAND_MAP + known-brand prefix stripping.
 * If the full brand doesn't match but the first word does, use the first word's canonical form.
 * This catches "Fenix UC45" → "Fenix", "Maglite Mini, Custom..." → "Maglite", etc.
 */
function normalizeBrandAtBuild(brand: string): string {
	const trimmed = brand.trim();
	if (!trimmed) return trimmed;

	// Direct match in BRAND_MAP or TYPO_MAP — return canonical form
	if (isMappedBrand(trimmed)) {
		return normalizeBrandName(trimmed);
	}

	// Known-brand prefix stripping: if the first word is a mapped brand,
	// the rest is model info leaking into the brand field
	const firstWord = trimmed.split(/[\s,]+/)[0];
	if (firstWord && firstWord.toLowerCase() !== trimmed.toLowerCase() && isMappedBrand(firstWord)) {
		return normalizeBrandName(firstWord);
	}

	// Fallback: normalize casing for case-insensitive dedup
	// normalizeBrandName's title-case fallback doesn't lowercase existing uppercase
	// (e.g., "MOLICEL" stays "MOLICEL" instead of "Molicel"), so we lowercase first
	const lower = trimmed.toLowerCase();
	return lower.replace(/\b\w/g, c => c.toUpperCase());
}

/** Retailer domains — URLs from these are NOT manufacturer websites */
const RETAILER_DOMAINS = /amazon\.|ebay\.|walmart\.|bestbuy\.|bhphoto\.|batteryjunction\.|goinggear\.|nealsgadgets\.|illumn\.|killzoneflashlights\.|knifecenter\.|bladehq\.|opticsplanet\.|cabelas\.|basspro\.|rei\.com|homedepot\.|lowes\.|target\.com|aliexpress\.|banggood\.|gearbest\.|jlhawaii808\.|jlhawaii\./i;

/** Compute completeness score: count of non-empty fields from the 16 required attributes */
function computeCompleteness(e: FlashlightEntry): number {
	let score = 0;
	if (e.model) score++;
	if (e.brand) score++;
	if (e.type?.length) score++;
	if (e.led?.length) score++;
	if (e.battery?.length) score++;
	if (e.performance?.claimed?.lumens?.length) score++;
	// throw_m is N/A for headlamps/lanterns — count it if present OR if flood type
	const isFloodType = e.type?.some((t: string) => ['headlamp', 'lantern'].includes(t)) ||
		/\bflood\b/i.test(e.model ?? '');
	if (isFloodType || (e.performance?.claimed?.throw_m && e.performance.claimed.throw_m > 0)) score++;
	if (e.performance?.claimed?.runtime_hours?.length) score++;
	if (e.switch?.length) score++;
	if (e.features?.length) score++;
	if (e.color?.length) score++;
	if (e.material?.length) score++;
	if (e.length_mm != null && e.length_mm > 0) score++;
	if (e.weight_g != null && e.weight_g > 0) score++;
	if (e.price_usd != null && e.price_usd > 0) score++;
	if (e.purchase_urls?.length) score++;
	return score;
}

/** Check if entry has a manufacturer (non-retailer) URL */
function hasMfgUrl(e: FlashlightEntry): boolean {
	for (const url of e.info_urls ?? []) {
		if (url && !RETAILER_DOMAINS.test(url)) return true;
	}
	return false;
}

/**
 * Color normalization — maps raw variant strings to 20 canonical colors.
 * Strips LED color temps, model numbers, finishes, and junk values.
 */
const COLOR_MAP: Record<string, string> = {
	'black': 'black', 'blk': 'black', 'noir': 'black', 'dark': 'black',
	'white': 'white', 'clear': 'white', 'silver': 'silver', 'chrome': 'silver',
	'gray': 'gray', 'grey': 'gray', 'gunmetal': 'gray', 'charcoal': 'gray', 'titanium': 'gray',
	'red': 'red', 'crimson': 'red', 'wine': 'red', 'maroon': 'red',
	'blue': 'blue', 'navy': 'blue', 'cobalt': 'blue', 'sapphire': 'blue',
	'green': 'green', 'olive': 'green', 'od green': 'green', 'odg': 'green', 'army green': 'green',
	'yellow': 'yellow', 'gold': 'yellow', 'amber': 'yellow',
	'orange': 'orange', 'fire': 'orange', 'lava': 'orange',
	'purple': 'purple', 'violet': 'purple', 'blurple': 'purple',
	'pink': 'pink', 'rose': 'pink', 'rose gold': 'pink', 'magenta': 'pink',
	'brown': 'brown', 'tan': 'brown', 'desert': 'brown', 'sand': 'brown', 'fde': 'brown',
	'flat dark earth': 'brown', 'coyote': 'brown', 'khaki': 'brown', 'bronze': 'brown',
	'copper': 'copper', 'brass': 'brass',
	'camo': 'camo', 'camouflage': 'camo',
	'teal': 'teal', 'turquoise': 'teal', 'aqua': 'teal', 'cyan': 'teal', 'mint': 'teal',
	'rainbow': 'rainbow',
};

function normalizeColors(rawColors: string[]): string[] {
	const result = new Set<string>();
	for (const raw of rawColors) {
		const lower = raw.toLowerCase().trim();
		// Skip LED color temps, model numbers, glow tubes, finishes
		if (/^\d+k$/i.test(lower)) continue;
		if (/\d{4}k/i.test(lower)) continue;
		if (/^(cool|neutral|warm|nw|cw)\b/i.test(lower)) continue;
		if (/glow|install|ready made|skeleton|solid|stock/i.test(lower)) continue;
		// Direct match
		if (COLOR_MAP[lower]) { result.add(COLOR_MAP[lower]); continue; }
		// Partial match — check if any keyword is in the string
		let matched = false;
		for (const [keyword, canonical] of Object.entries(COLOR_MAP)) {
			if (lower.includes(keyword)) { result.add(canonical); matched = true; break; }
		}
		if (!matched && lower.length > 0) {
			// Unknown value — skip it (don't pollute with junk)
		}
	}
	// Default to black if nothing matched
	if (result.size === 0) result.add('black');
	return [...result].sort();
}

/** Sprite metadata written by scrape-images.ts */
interface SpriteMetadata {
	cols: number;
	tileSize: number;
	totalImages: number;
	spriteFile: string;
	/** Stable mapping: flashlight ID → sprite position index */
	idToSprite?: Record<string, number>;
}

/** Column definition — maps to head[i] / disp[i] / opts[i] etc. */
interface ColumnMeta {
	id: string;
	display: string;
	unit: string;
	cvis: string; // 'always' | 'never' | ''
	link: string;
	srch: boolean;
	mode: string[];
	sortable: boolean;
	/** Extract value from a FlashlightEntry for this column */
	extract: (e: FlashlightEntry) => unknown;
}

// --- Column definitions (36 columns, matching SPA format) ---

const COLUMNS: ColumnMeta[] = [
	{ id: 'model', display: 'model', unit: '', cvis: 'always', link: 'model', srch: true, mode: ['any'], sortable: true,
		extract: (e) => e.model },
	{ id: '_pic', display: '_pic', unit: '', cvis: 'never', link: '_pic', srch: false, mode: ['any'], sortable: false,
		extract: (e) => e.image_urls.length > 0 ? e.image_urls[0] : '' },
	{ id: 'info', display: 'info', unit: '{link}', cvis: 'always', link: 'info', srch: false, mode: ['any'], sortable: false,
		extract: (e) => e.info_urls.length > 0 ? e.info_urls : [] },
	{ id: 'brand', display: 'brand', unit: '', cvis: 'always', link: 'brand', srch: true, mode: ['any'], sortable: true,
		extract: (e) => normalizeBrandAtBuild(e.brand) },
	{ id: 'type', display: 'type', unit: '', cvis: '', link: 'type', srch: true, mode: ['any', 'all', 'only', 'none'], sortable: false,
		extract: (e) => e.type },
	{ id: 'led', display: 'LED', unit: '', cvis: '', link: 'led', srch: true, mode: ['any', 'all', 'only'], sortable: false,
		extract: (e) => normalizeLedArray(e.led) },
	{ id: 'trueled', display: 'LED', unit: '', cvis: 'never', link: 'led', srch: false, mode: ['any', 'all', 'only'], sortable: false,
		extract: (e) => normalizeLedArray(e.led) },
	{ id: 'led_options', display: 'LED&nbsp;options', unit: '', cvis: 'never', link: 'led', srch: true, mode: ['any'], sortable: false,
		extract: (e) => normalizeLedArray(e.led_options ?? []) },
	{ id: 'battery', display: 'battery', unit: '', cvis: 'always', link: 'battery', srch: true, mode: ['any', 'all', 'only', 'none'], sortable: false,
		extract: (e) => normalizeBatteryArray(e.battery) },
	{ id: 'wh', display: 'capacity', unit: '{si}Wh', cvis: 'never', link: 'battery', srch: false, mode: ['any'], sortable: true,
		extract: (e) => e.wh ?? '' },
	{ id: '_bat', display: 'battery', unit: '', cvis: 'never', link: 'battery', srch: false, mode: ['any'], sortable: false,
		extract: (_e) => '' },
	{ id: 'lumens', display: 'lumens', unit: '{si}lm', cvis: 'never', link: 'modes', srch: false, mode: ['any'], sortable: true,
		extract: (e) => e.performance.claimed.lumens ?? [] },
	{ id: 'runtime', display: 'runtime', unit: '{si}h', cvis: 'never', link: 'modes', srch: false, mode: ['any'], sortable: true,
		extract: (e) => e.performance.claimed.runtime_hours ?? [] },
	{ id: 'blink', display: 'blink', unit: '', cvis: 'never', link: 'modes', srch: false, mode: ['any', 'all', 'only', 'none'], sortable: false,
		extract: (e) => e.blink.length > 0 ? e.blink : [] },
	{ id: 'levels', display: 'levels', unit: '', cvis: 'never', link: 'modes', srch: false, mode: ['any'], sortable: true,
		extract: (e) => e.levels != null ? [e.levels >= 6 ? '6+' : String(e.levels)] : [] },
	{ id: 'modes', display: 'modes', unit: '', cvis: 'always', link: 'modes', srch: false, mode: ['any'], sortable: false,
		extract: (e) => {
			if (!e.modes.length && !e.performance.claimed.lumens?.length) return [];
			// Build mode strings: "lumens lum / runtimeh"
			const lumens = e.performance.claimed.lumens ?? [];
			const runtimes = e.performance.claimed.runtime_hours ?? [];
			const modes: string[] = [];
			for (let i = 0; i < Math.max(lumens.length, runtimes.length, e.modes.length); i++) {
				const parts: string[] = [];
				if (lumens[i] != null) parts.push(`${lumens[i]} lum`);
				if (runtimes[i] != null) parts.push(`${runtimes[i]}h`);
				if (parts.length > 0) modes.push(parts.join(' / '));
				else if (e.modes[i]) modes.push(e.modes[i]);
			}
			return modes.length > 0 ? modes : [];
		},
	},
	{ id: 'features', display: 'features', unit: '', cvis: '', link: 'features', srch: true, mode: ['any', 'all'], sortable: false,
		extract: (e) => normalizeFeatureArray(e.features) },
	{ id: 'intensity', display: 'intensity', unit: '{si}cd', cvis: 'never', link: 'throw', srch: false, mode: ['any'], sortable: true,
		extract: (e) => e.performance.claimed.intensity_cd ?? '' },
	{ id: 'throw', display: 'throw', unit: '{} m', cvis: '', link: 'throw', srch: false, mode: ['any'], sortable: true,
		extract: (e) => e.performance.claimed.throw_m ?? '' },
	{ id: 'led_color', display: 'LED&nbsp;color', unit: '', cvis: '', link: 'led_color', srch: true, mode: ['any', 'all', 'only', 'none'], sortable: false,
		extract: (e) => e.led_color },
	{ id: 'switch', display: 'switch', unit: '', cvis: 'always', link: 'switch', srch: true, mode: ['any', 'all', 'only', 'none'], sortable: false,
		extract: (e) => normalizeSwitchArray(e.switch) },
	{ id: 'color', display: 'color', unit: '', cvis: '', link: 'color', srch: true, mode: ['any', 'all', 'only', 'none'], sortable: false,
		extract: (e) => normalizeColors(e.color) },
	{ id: 'length', display: 'length', unit: '{} mm', cvis: 'never', link: 'length', srch: false, mode: ['any'], sortable: true,
		extract: (e) => e.length_mm ?? '' },
	{ id: 'bezel_size', display: 'bezel&nbsp;size', unit: '{} mm', cvis: 'never', link: 'diam', srch: false, mode: ['any'], sortable: true,
		extract: (e) => e.bezel_mm ?? '' },
	{ id: 'body_size', display: 'body&nbsp;size', unit: '{} mm', cvis: 'never', link: 'diam', srch: false, mode: ['any'], sortable: true,
		extract: (e) => e.body_mm ?? '' },
	{ id: 'diam', display: 'diameters', unit: '', cvis: '', link: 'diam', srch: false, mode: ['any'], sortable: false,
		extract: (_e) => '' },
	{ id: 'measurements', display: 'measurements', unit: '', cvis: '', link: 'length', srch: false, mode: ['any'], sortable: false,
		extract: (e) => {
			const parts: string[] = [];
			if (e.length_mm) parts.push(`${e.length_mm}mm`);
			if (e.bezel_mm) parts.push(`⌀${e.bezel_mm}mm head`);
			if (e.body_mm) parts.push(`⌀${e.body_mm}mm body`);
			if (e.weight_g) parts.push(`${e.weight_g}g`);
			return parts.length > 0 ? parts : [];
		},
	},
	{ id: 'weight', display: 'weight', unit: '{} g', cvis: 'never', link: 'weight', srch: false, mode: ['any'], sortable: true,
		extract: (e) => {
			// Cap at 5000g (5kg) — anything higher is a data error
			const w = e.weight_g;
			if (w == null || w <= 0 || w > 5000) return '';
			return w;
		} },
	{ id: 'material', display: 'material', unit: '', cvis: '', link: 'material', srch: true, mode: ['any', 'all', 'only', 'none'], sortable: false,
		extract: (e) => normalizeMaterialArray(e.material) },
	{ id: 'impact', display: 'impact', unit: '{} m', cvis: '', link: 'impact', srch: false, mode: ['any'], sortable: true,
		extract: (e) => {
			// Parse "2m", "1.5m" → numeric meters
			// Filter out throw distances mistakenly in impact field (>10m is not impact resistance)
			if (e.impact.length > 0) {
				const val = parseFloat(e.impact[0].replace(/m$/i, ''));
				if (isNaN(val) || val > 10) return '';
				return val;
			}
			return '';
		} },
	{ id: 'environment', display: 'environment', unit: '', cvis: '', link: 'environment', srch: true, mode: ['any', 'all', 'only', 'none'], sortable: false,
		extract: (e) => e.environment },
	{ id: 'efficacy', display: 'efficacy', unit: '{} lm/W', cvis: 'never', link: 'efficacy', srch: false, mode: ['any'], sortable: true,
		extract: (e) => e.performance.claimed.efficacy ?? '' },
	{ id: 'beam_angle', display: 'beam&nbsp;angle', unit: '{}°', cvis: 'never', link: 'beam_angle', srch: false, mode: ['any'], sortable: true,
		extract: (e) => e.performance.claimed.beam_angle ?? '' },
	{ id: 'year', display: 'year', unit: '', cvis: 'never', link: 'year', srch: false, mode: ['any'], sortable: true,
		extract: (e) => e.year ?? '' },
	{ id: 'completeness', display: 'data&nbsp;quality', unit: '{}/16', cvis: 'never', link: 'completeness', srch: false, mode: ['any'], sortable: true,
		extract: (e) => computeCompleteness(e) },
	{ id: 'has_mfg_url', display: 'mfg&nbsp;site', unit: '', cvis: 'never', link: 'has_mfg_url', srch: false, mode: ['any'], sortable: false,
		extract: (_e) => ['no'] }, // Placeholder — overridden at build time with brand-level lookup
	{ id: '_reviews', display: '_reviews', unit: '', cvis: 'never', link: '_reviews', srch: false, mode: ['any'], sortable: false,
		extract: (_e) => 0 },
	{ id: 'purchase', display: 'purchase', unit: '{link}', cvis: 'always', link: 'purchase', srch: false, mode: ['any'], sortable: false,
		extract: (e) => e.purchase_urls.length > 0 ? e.purchase_urls : [] },
	{ id: 'price', display: 'price', unit: '${}', cvis: 'always', link: 'price', srch: false, mode: ['any'], sortable: true,
		extract: (e) => e.price_usd ?? '' },
	// Price history columns — populated from loadPriceData() Map, extract is placeholder
	// Deal = current price <= historical Amazon low (simple boolean)
	{ id: 'at_low', display: 'deal', unit: '', cvis: '', link: 'price', srch: false, mode: ['any'], sortable: false,
		extract: (_e) => [] },
	// % below all-time Amazon low (positive = below low, 0 = at/above)
	{ id: 'pct_below_low', display: '% below low', unit: '{}%', cvis: '', link: 'price', srch: false, mode: ['any'], sortable: true,
		extract: (_e) => '' },
	// % below 90-day Amazon low (positive = below 90d low, 0 = at/above)
	{ id: 'pct_below_90d', display: '% below 90d', unit: '{}%', cvis: '', link: 'price', srch: false, mode: ['any'], sortable: true,
		extract: (_e) => '' },
	{ id: '_sparkline', display: '_sparkline', unit: '', cvis: 'never', link: 'price', srch: false, mode: ['any'], sortable: false,
		extract: (_e) => '' },
];

/** Collect all unique option values for a multi/boolean filter column */
function collectOptions(data: unknown[][], colIdx: number): string[] {
	const optSet = new Set<string>();
	for (const row of data) {
		const val = row[colIdx];
		if (Array.isArray(val)) {
			for (const v of val) {
				if (typeof v === 'string' && v && v !== '' && v !== 'unknown') optSet.add(v);
			}
		} else if (typeof val === 'string' && val && val !== '' && val !== 'unknown') {
			optSet.add(val);
		}
	}
	return [...optSet].sort((a, b) => a.localeCompare(b));
}

/** Compute sort indices for a numeric sortable column (dec only — inc derived at runtime) */
function computeSortIndices(data: unknown[][], colIdx: number): { dec: number[] } {
	type IndexedValue = { idx: number; val: number };
	const indexed: IndexedValue[] = [];

	for (let i = 0; i < data.length; i++) {
		const raw = data[i][colIdx];
		let num: number;
		if (typeof raw === 'number') {
			num = raw;
		} else if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'number') {
			num = Math.max(...(raw as number[]));
		} else {
			num = -Infinity;
		}
		indexed.push({ idx: i, val: num });
	}

	// Descending sort (highest first, empty last)
	const dec = indexed
		.sort((a, b) => {
			if (a.val === -Infinity && b.val === -Infinity) return 0;
			if (a.val === -Infinity) return 1;
			if (b.val === -Infinity) return -1;
			return b.val - a.val;
		})
		.map((v) => v.idx);

	return { dec };
}

/** Compute sort indices for a string sortable column (dec only — inc derived at runtime) */
function computeStringSortIndices(data: unknown[][], colIdx: number): { dec: number[] } {
	type IndexedStr = { idx: number; val: string };
	const indexed: IndexedStr[] = [];

	for (let i = 0; i < data.length; i++) {
		const raw = data[i][colIdx];
		indexed.push({ idx: i, val: typeof raw === 'string' ? raw.toLowerCase() : '' });
	}

	// Descending alphabetical (Z→A), empties last
	const dec = indexed
		.sort((a, b) => {
			if (!a.val && !b.val) return 0;
			if (!a.val) return 1;
			if (!b.val) return -1;
			return b.val.localeCompare(a.val);
		})
		.map((v) => v.idx);

	return { dec };
}

/** Build opts[] — filter definitions for each column */
function buildOpts(data: unknown[][]): (unknown[] | null)[] {
	const MULTI_COLS = new Set(['type', 'blink', 'levels', 'led_color', 'switch', 'color', 'material', 'has_mfg_url', 'at_low']);
	// Mega-multi: columns with many options that benefit from grouped display
	const MEGA_MULTI_COLS = new Set(['brand', 'led', 'trueled', 'led_options', 'battery', 'environment']);
	const BOOLEAN_COLS = new Set(['features']);

	// Range definitions: [min, max, decimals]
	const RANGE_COLS: Record<string, { type: 'range' | 'log-range' }> = {
		wh: { type: 'log-range' },
		lumens: { type: 'log-range' },
		runtime: { type: 'log-range' },
		intensity: { type: 'log-range' },
		throw: { type: 'range' },
		impact: { type: 'range' },
		length: { type: 'log-range' },
		bezel_size: { type: 'log-range' },
		body_size: { type: 'log-range' },
		weight: { type: 'log-range' },
		price: { type: 'log-range' },
		efficacy: { type: 'range' },
		beam_angle: { type: 'range' },
		year: { type: 'range' },
		completeness: { type: 'range' },
		pct_below_low: { type: 'range' },
		pct_below_90d: { type: 'range' },
	};

	// Composite filters group sub-columns under one header
	// _bat would group battery+wh but wh is 0% populated, so skip it
	// diam groups bezel_size + body_size (both sparse but functional)
	const MULTIPLE_COLS: Record<string, number[]> = {
		diam: [22, 23],  // bezel_size (index 22), body_size (index 23)
	};

	/** Custom battery sort: popularity-weighted, common cells first */
	const BATTERY_PRIORITY: string[] = [
		// Li-ion cells (most popular first)
		'18650', '21700', '14500', '18350', '16340', 'CR123A',
		'26650', '26800', '10440', '10180',
		// Standard cells
		'AA', 'AAA', 'C', 'D',
		// Less common Li-ion
		'18500', '32650', '33140', '46950', '10280',
		// Multi-cell
		'2x18650', '3x18650', '4x18650', '2xCR123A', '2x16340', '3xAAA', '4xAA',
		// Chemistry
		'Li-ion', 'Li-poly', 'Li-ion pack', 'NiMH', 'NiCd', 'LiFePO4', 'alkaline',
		// Integrated
		'built-in',
		// Button cells
		'CR2032', 'CR2016', 'LR44', 'LR41',
		// Special
		'6V lantern', '12V lantern', 'Sub-C',
	];

	return COLUMNS.map((col, i) => {
		if (MEGA_MULTI_COLS.has(col.id)) {
			let options = collectOptions(data, i);
			// Custom sort for battery: priority list first, then alphabetical remainder
			if (col.id === 'battery') {
				const prioritySet = new Set(BATTERY_PRIORITY);
				const prioritized = BATTERY_PRIORITY.filter(b => options.includes(b));
				const remaining = options.filter(b => !prioritySet.has(b)).sort((a, b) => a.localeCompare(b));
				options = [...prioritized, ...remaining];
			}
			return ['mega-multi', options];
		}
		if (MULTI_COLS.has(col.id)) {
			let options = collectOptions(data, i);
			// Custom sort for switch: common types first
			if (col.id === 'switch') {
				const SWITCH_PRIORITY = [
					'tail', 'side', 'rotary', 'twisty', 'electronic', 'clicky', 'momentary',
					'dual', 'dual side', 'dual tail', 'dual top', 'magnetic ring', 'selector',
					'toggle', 'body', 'top', 'mechanical', 'sensor', 'remote', 'slide',
				];
				const prioritySet = new Set(SWITCH_PRIORITY);
				const prioritized = SWITCH_PRIORITY.filter(s => options.includes(s));
				const remaining = options.filter(s => !prioritySet.has(s)).sort((a, b) => a.localeCompare(b));
				options = [...prioritized, ...remaining];
			}
			// Custom sort for material: common materials first
			if (col.id === 'material') {
				const MAT_PRIORITY = [
					'aluminum', 'stainless steel', 'polymer', 'titanium', 'copper', 'brass',
					'rubber', 'magnesium', 'carbon fiber', 'steel', 'glass', 'zirconium',
					'damascus steel', 'tungsten', 'leather', 'fabric',
				];
				const prioritySet = new Set(MAT_PRIORITY);
				const prioritized = MAT_PRIORITY.filter(m => options.includes(m));
				const remaining = options.filter(m => !prioritySet.has(m)).sort((a, b) => a.localeCompare(b));
				options = [...prioritized, ...remaining];
			}
			return ['multi', options];
		}
		if (BOOLEAN_COLS.has(col.id)) {
			const options = collectOptions(data, i);
			return ['boolean', options];
		}
		if (col.id in RANGE_COLS) {
			// Compute min/max from data
			let min = Infinity;
			let max = -Infinity;
			for (const row of data) {
				const val = row[i];
				if (typeof val === 'number' && val > 0) {
					if (val < min) min = val;
					if (val > max) max = val;
				} else if (Array.isArray(val)) {
					for (const v of val) {
						if (typeof v === 'number' && v > 0) {
							if (v < min) min = v;
							if (v > max) max = v;
						}
					}
				}
			}
			if (min === Infinity) min = 0;
			if (max === -Infinity) max = 1;
			const decimals = col.id === 'runtime' ? 1 : 0;
			return [RANGE_COLS[col.id].type, min, max, decimals];
		}
		if (col.id in MULTIPLE_COLS) {
			return ['multiple', MULTIPLE_COLS[col.id]];
		}
		return null;
	});
}

/** Build the full FlashlightDB JSON from SQLite data */
export async function buildTorchDb(): Promise<{
	outputPath: string;
	entryCount: number;
	columnCount: number;
}> {
	console.log('Building FlashlightDB JSON...');

	const allEntries = getAllFlashlights();
	console.log(`  ${allEntries.length} entries from SQLite`);

	// Classify accessories — keep them in the DB but add "accessory" to their type
	const ACCESSORY_PATTERNS = /\b(o-ring|pocket clip|split ring|dummy cell|resistor|shipping protection|tail cap replacement|battery spacer|lens cap|lanyard|wrist strap|belt holster|diffuser cap|filter cap|driver tool|charging dock|replacement lamp|replacement bulb|replacement battery|replacement nimh|replacement xenon|traffic.*wand|accessory lens|gift card|mouse pad|sticker|poster|headband(?! light)|(?<!power |pd )charger(?! led| rechargeable| flashlight)|(?:color |red |blue |green |flashlight )(?:filter|diffuser)s?\b(?! (?:tip|included|set))|silicone (?:flashlight )?diffuser|filters? for (?:flashlight|light)|filter - \d|signal cone|nylon sheath|diffuser wand|diffuser tip for|helmet (?:clip|attachment|holder)|flashlight ring(?:\b)|wrist (?:flashlight )?clip|storage bag|leather holster|nylon holster|duty holster|safety wand|switch module|lamp module|lamp assembly|lens kit|lens reflector assembly|face cap assembly|grip ring|mag tube rail|charging rack|power cord|(?:ac|dc) cord|remote switch|headstrap|head(?:lamp)? strap|body kit(?! flashlight)|(?:flat top|button top)\s+(?:li-ion|lithium)|(?:lithium[- ]?ion|li-ion|nimh|nicd|nickel)\s+(?:battery|cell)\b(?! (?:flashlight|headlamp|powered)))/i;
	const GLOW_TUBE_ONLY = /^(gitd\b|.*\bglow tubes?\b(?!.*\b(flashlight|headlamp|torch)\b))/i;
	const PURE_ACCESSORY = /^(?:battery pack|holster|diffuser|charger|mount|strap|case|pouch|headband|glass lens|schneider gelion|fs[rbg]\d|mf[bdgr]\d|color filter|nf\d+ filter|a[a-z]{2}-\d|apb-\d|fx-wd|bm0\d|\d+mAh)\b/i;

	// If the model name contains strong flashlight indicators, it's a flashlight even if it mentions accessories
	const IS_FLASHLIGHT = /\b(\d+\s*lumens?|\d+\s*lm\b|flashlight|headlamp|headlight|lantern|torch|work\s*light|flood\s*light|spot\s*light|penlight|pen\s*light|searchlight|rechargeable.*led|led.*rechargeable)\b/i;
	// Standalone battery products — "6V Alkaline Lantern Battery with Spring Terminals"
	const STANDALONE_BATTERY = /\d+\s*V\s+(?:alkaline|zinc|carbon|lithium|nimh|nicd).*\bbattery\b/i;
	// Battery cell products — "18650 3300mAh", "21700 5100mah", "16650 Vapcell INR16650"
	// Matches model starting with a cell format number (5 digits) + mAh/mah or "Li-ion"/"Rechargeable Cell"
	const BATTERY_CELL = /^\d{5}\b.*\b(?:\d+\s*m[Aa][Hh]|li-ion|rechargeable\s+cell|unprotected|protected\s+\d)\b/i;
	// "mAh" + "Battery" models without flashlight/headlamp (e.g., "RC260 18650 2600mAh ... Battery")
	const MAH_BATTERY = /\d+\s*m[Aa][Hh]\b.*\b(?:battery|battery\s+stick|power\s+pack)\b/i;

	let accessoryCount = 0;
	for (const entry of allEntries) {
		// PURE_ACCESSORY and GLOW_TUBE always classify (start-of-name match is strong enough)
		const noFlashword = !(/\b(flashlight|headlamp|headlight|torch|lantern)\b/i.test(entry.model));
		const isPure = PURE_ACCESSORY.test(entry.model) || GLOW_TUBE_ONLY.test(entry.model)
			|| (STANDALONE_BATTERY.test(entry.model) && noFlashword)
			|| (BATTERY_CELL.test(entry.model) && noFlashword)
			|| (MAH_BATTERY.test(entry.model) && noFlashword && !IS_FLASHLIGHT.test(entry.model));
		// ACCESSORY_PATTERNS is weaker — skip if the model also looks like a flashlight
		const isPatternMatch = ACCESSORY_PATTERNS.test(entry.model) && !IS_FLASHLIGHT.test(entry.model);
		if ((isPure || isPatternMatch) && !entry.type.includes('accessory')) {
			entry.type = ['accessory'];
			updateEntryType(entry.id, ['accessory']);
			accessoryCount++;
		}
	}
	if (accessoryCount > 0) console.log(`  Classified ${accessoryCount} accessories (kept in DB, filterable by type)`);

	// Classify blog posts and non-product pages
	let blogCount = 0;
	for (const entry of allEntries) {
		if (entry.type.includes('blog') || entry.type.includes('accessory')) continue;
		const urls = [...(entry.info_urls ?? []), ...(entry.purchase_urls ?? [])].join(' ');
		const model = entry.model?.toLowerCase() ?? '';

		const isBlog = /\/blogs?\/|\/news\//.test(urls);
		// Category/landing pages: /pages/ or /collections/ URLs with "best" or "brightest" model titles
		const isCategoryPage = /\/pages?\/|\/collections?\//.test(urls) &&
			/^(?:best|brightest|top)\s/i.test(model);
		// Manufacturer marketing pages: /best-*, /compare*, /guide*, /award*
		const isMarketingPage = /\/(?:best-|compare|guide|award|faq)/i.test(urls) &&
			!/\/products?\//i.test(urls); // Don't exclude actual product pages
		// Model name looks like an article title, not a product name
		// Catches "Best EDC Flashlights This Year", "Guide Tactical Flashlights", etc.
		// Guard: skip if model contains a product model number (e.g. "LD70", "TK30", "PD35")
		const hasModelNumber = /\b[A-Z]{1,4}\d{1,4}[A-Z]?\b/i.test(entry.model ?? '');
		const isArticleTitle = !hasModelNumber && (
			/\b(?:guide|vs |comparison|ranked|reviewed|this year|you need|everything you need|how to |what is the best|pros and cons|holiday gift|top rated|gift guide)\b/i.test(model) ||
			/^(?:best|choosing|the best|the \d+ best)\s/i.test(model)
		);

		if (isBlog || isCategoryPage || isMarketingPage || isArticleTitle) {
			entry.type = ['blog'];
			updateEntryType(entry.id, ['blog']);
			blogCount++;
		}
	}
	if (blogCount > 0) console.log(`  Classified ${blogCount} non-product pages (excluded from main view)`);

	// Filter garbage brands — Amazon listing artifacts with lumen values parsed as brand
	let garbageBrandCount = 0;
	for (const entry of allEntries) {
		if (entry.type.includes('accessory') || entry.type.includes('blog')) continue;
		if (GARBAGE_BRAND_RE.test(entry.brand)) {
			entry.type = ['accessory'];
			updateEntryType(entry.id, ['accessory']);
			garbageBrandCount++;
		}
	}
	if (garbageBrandCount > 0) console.log(`  Filtered ${garbageBrandCount} garbage-brand entries (LUMENS LIGHT HOUSE)`);

	// Filter junk brands — charger sellers, gibberish brands, single-entry no-URL brands
	const JUNK_BRANDS = new Set([
		// Category A: charger/adapter sellers (not flashlight manufacturers)
		'ABLEGRID', 'PKPOWER', 'GUY-TECH', 'KONKIN BOO', 'SLLEA', 'HQRP',
		'K-MAINS', 'YUSTDA', 'OMNIHIL', 'LEEPRA', 'FITE ON', 'UPBRIGHT',
		'J-ZMQER', 'ESCO LITE',
		// Category B: gibberish/spam brands (all-caps, no vowels, random strings)
		'RXQMXG', 'SKTJDL', 'YJWJMZZ', 'LZJDSG', 'HXCSYC', 'YLXQ-BPRS',
		'SXZFTYHB', 'TTKXYLSB', 'XCVGBNKL', 'KM581',
		// Category D: additional gibberish one-offs
		'RYHTHYHTJUYQSD', 'FJKERWDS', 'FYIOGXG', 'GAZJYUSP', 'ILQMEHV',
		'IYEYVDKJ', 'PZHANGZVH', 'WLDWEZQI', 'ZXMURNG', 'YTBDDHYUE',
	]);
	let junkBrandCount = 0;
	for (const entry of allEntries) {
		if (entry.type.includes('accessory') || entry.type.includes('blog')) continue;
		// Match against uppercase brand (junk brands are typically all-caps)
		const brandUpper = entry.brand.trim().toUpperCase();
		if (JUNK_BRANDS.has(brandUpper) || JUNK_BRANDS.has(entry.brand.trim())) {
			entry.type = ['accessory'];
			updateEntryType(entry.id, ['accessory']);
			junkBrandCount++;
		}
	}
	if (junkBrandCount > 0) console.log(`  Filtered ${junkBrandCount} junk-brand entries (chargers, gibberish)`);

	// Filter out removed entries — they're dedup artifacts that serve no purpose in the JSON
	// Keep accessories/blogs — they're filterable via type column
	const entries = allEntries.filter(e => !e.type.includes('removed'));

	// Build brand-level manufacturer URL lookup — if ANY entry for a brand has a mfg URL, all entries inherit it
	// Uses normalized brand names so merged variants share the lookup
	const brandHasMfgUrl = new Set<string>();
	for (const entry of entries) {
		if (hasMfgUrl(entry)) brandHasMfgUrl.add(normalizeBrandAtBuild(entry.brand));
	}
	// Known manufacturer brands — sold at enthusiast retailers (jlhawaii808, nealsgadgets, illumn)
	// These all have manufacturer websites with spec sheets
	const KNOWN_MFG_BRANDS = new Set([
		'Acebeam', 'Armytek', 'Convoy', 'Cyansky', 'Emisar', 'Fenix',
		'Fireflies', 'Imalent', 'JETBeam', 'Klarus', 'Loop Gear',
		'Lumintop', 'Manker', 'Mateminco', 'Nextorch', 'Nitecore',
		'Noctigon', 'Olight', 'ReyLight', 'Rovyvon', 'Skilhunt',
		'Sofirn', 'Speras', 'Sunwayman', 'ThruNite', 'Weltool',
		'Wuben', 'Wurkkos', 'Zebralight',
	]);
	for (const b of KNOWN_MFG_BRANDS) brandHasMfgUrl.add(b);
	console.log(`  ${brandHasMfgUrl.size} brands have manufacturer URLs (${entries.length - [...entries].filter(e => brandHasMfgUrl.has(e.brand)).length} entries from brands without)`);
	// Patch hasMfgUrl to use brand-level lookup (normalized brand)
	const brandMfgLookup = (e: FlashlightEntry): boolean => brandHasMfgUrl.has(normalizeBrandAtBuild(e.brand));

	// Load sprite metadata if available (written by scrape-images.ts)
	const spriteMetaPath = resolve(import.meta.dir, '../../pipeline-data/sprite-metadata.json');
	let spriteMeta: SpriteMetadata | null = null;
	let spriteFile = '';
	if (existsSync(spriteMetaPath)) {
		spriteMeta = JSON.parse(await Bun.file(spriteMetaPath).text());
		spriteFile = spriteMeta!.spriteFile;
		console.log(`  Using sprite: ${spriteFile} (${spriteMeta!.cols} cols, ${spriteMeta!.totalImages} tiles)`);
	} else {
		console.log('  No sprite metadata found — using image URLs for _pic');
	}

	// Load price history data (Keepa)
	const priceData = loadPriceData();
	console.log(`  ${priceData.size} entries have price history data`);

	// Build data array — each row is column-count elements in column order
	const data: unknown[][] = [];
	const picColIdx = COLUMNS.findIndex((c) => c.id === '_pic');
	const mfgColIdx = COLUMNS.findIndex((c) => c.id === 'has_mfg_url');
	const atLowColIdx = COLUMNS.findIndex((c) => c.id === 'at_low');
	const pctBelowLowIdx = COLUMNS.findIndex((c) => c.id === 'pct_below_low');
	const pctBelow90dIdx = COLUMNS.findIndex((c) => c.id === 'pct_below_90d');
	const sparklineColIdx = COLUMNS.findIndex((c) => c.id === '_sparkline');

	let spriteHits = 0;
	for (let rowIdx = 0; rowIdx < entries.length; rowIdx++) {
		const entry = entries[rowIdx];
		const row: unknown[] = [];
		for (const col of COLUMNS) {
			row.push(col.extract(entry));
		}
		// If sprite available, map by flashlight ID for stable image assignment
		if (spriteMeta && picColIdx >= 0) {
			const idMap = spriteMeta.idToSprite;
			if (idMap && entry.id in idMap) {
				// ID-based mapping (stable across DB changes)
				const spriteIdx = idMap[entry.id];
				const spriteCol = spriteIdx % spriteMeta.cols;
				const spriteRow = Math.floor(spriteIdx / spriteMeta.cols);
				row[picColIdx] = [spriteCol, spriteRow];
				spriteHits++;
			} else if (!idMap) {
				// Legacy fallback: sequential index mapping (will be wrong if entries changed)
				const spriteCol = rowIdx % spriteMeta.cols;
				const spriteRow = Math.floor(rowIdx / spriteMeta.cols);
				row[picColIdx] = [spriteCol, spriteRow];
				spriteHits++;
			}
			// else: no sprite for this entry, keep the image URL from extract
		}
		// Override has_mfg_url with brand-level lookup
		if (mfgColIdx >= 0) {
			row[mfgColIdx] = brandMfgLookup(entry) ? ['yes'] : ['no'];
		}
		// Populate price history columns from Keepa data
		// Deal = current price <= historical Amazon low
		const pStats = priceData.get(entry.id);
		if (pStats) {
			const dbPrice = entry.price_usd;
			if (dbPrice && dbPrice > 0) {
				if (atLowColIdx >= 0) {
					row[atLowColIdx] = dbPrice <= pStats.min_price ? ['yes'] : [];
				}
				// % below all-time low (positive means current is cheaper)
				if (pctBelowLowIdx >= 0 && pStats.min_price > 0 && dbPrice < pStats.min_price) {
					row[pctBelowLowIdx] = Math.round((pStats.min_price - dbPrice) / pStats.min_price * 100);
				}
				// % below 90-day low (positive means current is cheaper)
				if (pctBelow90dIdx >= 0 && pStats.min_90d > 0 && dbPrice < pStats.min_90d) {
					row[pctBelow90dIdx] = Math.round((pStats.min_90d - dbPrice) / pStats.min_90d * 100);
				}
			}
			if (sparklineColIdx >= 0) row[sparklineColIdx] = pStats.sparkline;
		}
		data.push(row);
	}
	if (spriteMeta) {
		console.log(`  Sprite mapped: ${spriteHits}/${entries.length} entries have sprite images`);
	}

	// Build all metadata arrays
	const head = COLUMNS.map((c) => c.id);
	const disp = COLUMNS.map((c) => c.display);
	const opts = buildOpts(data);
	const mode = COLUMNS.map((c) => c.mode);
	const unit = COLUMNS.map((c) => c.unit);
	const srch = COLUMNS.map((c) => c.srch);
	const cvis = COLUMNS.map((c) => c.cvis);
	const link = COLUMNS.map((c) => c.link);

	// Build sort arrays for sortable columns
	const STRING_SORT_COLS = new Set(['model', 'brand']);
	const sort = COLUMNS.map((col, i) => {
		if (!col.sortable) return false;
		if (STRING_SORT_COLS.has(col.id)) return computeStringSortIndices(data, i);
		return computeSortIndices(data, i);
	});

	// Build help/note arrays (empty for now)
	const help = COLUMNS.map(() => null);
	const note = COLUMNS.map(() => null);

	const db = {
		head,
		disp,
		opts,
		mode,
		unit,
		sort,
		srch,
		cvis,
		link,
		data,
		sprite: spriteFile,
		help,
		note,
	};

	const outputPath = resolve(import.meta.dir, '../../static/flashlights.now.json');
	await Bun.write(outputPath, JSON.stringify(db));

	const stats = {
		outputPath,
		entryCount: data.length,
		columnCount: COLUMNS.length,
	};
	console.log(`  Written to ${outputPath}`);
	console.log(`  ${stats.entryCount} entries, ${stats.columnCount} columns`);
	console.log(`  File size: ${(JSON.stringify(db).length / 1024).toFixed(1)} KB`);

	return stats;
}
