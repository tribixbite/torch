/**
 * Build step: converts SQLite data → FlashlightDB JSON format for the SPA.
 * Produces flashlights.now.json compatible with the existing frontend.
 */
import { getAllFlashlights, updateEntryType } from '../store/db.js';
import type { FlashlightEntry } from '../schema/canonical.js';
import { resolve } from 'path';
import { existsSync } from 'fs';

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
		extract: (e) => e.brand },
	{ id: 'type', display: 'type', unit: '', cvis: '', link: 'type', srch: true, mode: ['any', 'all', 'only', 'none'], sortable: false,
		extract: (e) => e.type },
	{ id: 'led', display: 'LED', unit: '', cvis: '', link: 'led', srch: true, mode: ['any', 'all', 'only'], sortable: false,
		extract: (e) => e.led },
	{ id: 'trueled', display: 'LED', unit: '', cvis: 'never', link: 'led', srch: false, mode: ['any', 'all', 'only'], sortable: false,
		extract: (e) => e.led },
	{ id: 'battery', display: 'battery', unit: '', cvis: 'always', link: 'battery', srch: true, mode: ['any', 'all', 'only', 'none'], sortable: false,
		extract: (e) => e.battery },
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
		extract: (e) => e.features },
	{ id: 'intensity', display: 'intensity', unit: '{si}cd', cvis: 'never', link: 'throw', srch: false, mode: ['any'], sortable: true,
		extract: (e) => e.performance.claimed.intensity_cd ?? '' },
	{ id: 'throw', display: 'throw', unit: '{} m', cvis: '', link: 'throw', srch: false, mode: ['any'], sortable: true,
		extract: (e) => e.performance.claimed.throw_m ?? '' },
	{ id: 'led_color', display: 'LED&nbsp;color', unit: '', cvis: '', link: 'led_color', srch: true, mode: ['any', 'all', 'only', 'none'], sortable: false,
		extract: (e) => e.led_color },
	{ id: 'switch', display: 'switch', unit: '', cvis: 'always', link: 'switch', srch: true, mode: ['any', 'all', 'only', 'none'], sortable: false,
		extract: (e) => e.switch },
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
		extract: (e) => e.material },
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
	{ id: '_reviews', display: '_reviews', unit: '', cvis: 'never', link: '_reviews', srch: false, mode: ['any'], sortable: false,
		extract: (_e) => 0 },
	{ id: 'purchase', display: 'purchase', unit: '{link}', cvis: 'always', link: 'purchase', srch: false, mode: ['any'], sortable: false,
		extract: (e) => e.purchase_urls.length > 0 ? e.purchase_urls : [] },
	{ id: 'price', display: 'price', unit: '${}', cvis: 'always', link: 'price', srch: false, mode: ['any'], sortable: true,
		extract: (e) => e.price_usd ?? '' },
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

/** Compute sort indices for a numeric sortable column */
function computeSortIndices(data: unknown[][], colIdx: number): { dec: number[]; inc: number[] } {
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

	const inc = [...dec].reverse();
	return { dec, inc };
}

/** Compute sort indices for a string sortable column (alphabetical) */
function computeStringSortIndices(data: unknown[][], colIdx: number): { dec: number[]; inc: number[] } {
	type IndexedStr = { idx: number; val: string };
	const indexed: IndexedStr[] = [];

	for (let i = 0; i < data.length; i++) {
		const raw = data[i][colIdx];
		indexed.push({ idx: i, val: typeof raw === 'string' ? raw.toLowerCase() : '' });
	}

	// Ascending alphabetical (A→Z), empties last
	const inc = indexed
		.sort((a, b) => {
			if (!a.val && !b.val) return 0;
			if (!a.val) return 1;
			if (!b.val) return -1;
			return a.val.localeCompare(b.val);
		})
		.map((v) => v.idx);

	const dec = [...inc].reverse();
	return { dec, inc };
}

/** Build opts[] — filter definitions for each column */
function buildOpts(data: unknown[][]): (unknown[] | null)[] {
	const MULTI_COLS = new Set(['type', 'blink', 'levels', 'led_color', 'switch', 'color', 'material']);
	// Mega-multi: columns with many options that benefit from grouped display
	const MEGA_MULTI_COLS = new Set(['brand', 'led', 'trueled', 'battery', 'environment']);
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
	};

	// Composite filters group sub-columns under one header
	// _bat would group battery+wh but wh is 0% populated, so skip it
	// diam groups bezel_size + body_size (both sparse but functional)
	const MULTIPLE_COLS: Record<string, number[]> = {
		diam: [22, 23],  // bezel_size (index 22), body_size (index 23)
	};

	return COLUMNS.map((col, i) => {
		if (MEGA_MULTI_COLS.has(col.id)) {
			const options = collectOptions(data, i);
			return ['mega-multi', options];
		}
		if (MULTI_COLS.has(col.id)) {
			const options = collectOptions(data, i);
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

		if (isBlog || isCategoryPage || isMarketingPage) {
			entry.type = ['blog'];
			updateEntryType(entry.id, ['blog']);
			blogCount++;
		}
	}
	if (blogCount > 0) console.log(`  Classified ${blogCount} non-product pages (excluded from main view)`);

	// Keep all entries — accessories/blogs are filterable via type column
	const entries = allEntries;

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

	// Build data array — each row is 36 elements in column order
	const data: unknown[][] = [];
	const picColIdx = COLUMNS.findIndex((c) => c.id === '_pic');

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
