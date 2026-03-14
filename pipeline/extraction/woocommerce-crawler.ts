/**
 * WooCommerce Store API crawler.
 * Uses the public Store API (no auth needed):
 *   /wp-json/wc/store/v1/products?per_page=100&page=N
 */
import { generateId } from '../schema/canonical.js';
import type { FlashlightEntry } from '../schema/canonical.js';
import { upsertFlashlight, addSource } from '../store/db.js';
import { htmlToText } from './manufacturer-scraper.js';

const CRAWL_DELAY = 800;

/** WooCommerce Store API product structure */
interface WooProduct {
	id: number;
	name: string;
	slug: string;
	permalink: string;
	description: string;
	short_description: string;
	sku: string;
	prices: {
		price: string;       // in minor units (cents)
		regular_price: string;
		sale_price: string;
		currency_code: string;
		currency_minor_unit: number;
	};
	images: Array<{
		id: number;
		src: string;
		alt: string;
	}>;
	categories: Array<{ id: number; name: string; slug: string }>;
	tags: Array<{ id: number; name: string; slug: string }>;
	attributes: Array<{
		id: number;
		name: string;
		taxonomy: string;
		has_variations: boolean;
		terms: Array<{ id: number; name: string; slug: string }>;
	}>;
	variations: Array<{
		id: number;
		attributes: Array<{ name: string; value: string }>;
	}>;
	weight: string; // kg as string
	dimensions: {
		length: string;  // cm
		width: string;
		height: string;
	};
}

/** WooCommerce store configuration */
interface WooStore {
	brand: string;
	baseUrl: string;
	/** Custom API path (default: /wp-json/wc/store/v1/products) */
	apiPath?: string;
	/** Filter products to only flashlights */
	isFlashlight?: (product: WooProduct) => boolean;
}

export const WOOCOMMERCE_STORES: WooStore[] = [
	{
		brand: 'Skilhunt',
		baseUrl: 'https://www.skilhunt.com',
		isFlashlight: (p) => {
			const text = `${p.name} ${p.short_description} ${p.categories.map((c) => c.name).join(' ')}`.toLowerCase();
			return /flashlight|headlamp|lantern|torch|light|lumen/i.test(text);
		},
	},
	{
		brand: 'Lumintop',
		baseUrl: 'https://lumintop.com',
		isFlashlight: (p) => {
			const text = `${p.name} ${p.short_description} ${p.categories.map((c) => c.name).join(' ')}`.toLowerCase();
			return /flashlight|headlamp|lantern|torch|light|lumen/i.test(text);
		},
	},
	{
		brand: 'EagTac',
		baseUrl: 'https://www.eagtac.com',
		// EagTac uses /wp-json/wc/store/products (no v1)
		apiPath: '/wp-json/wc/store/products',
		isFlashlight: (p) => {
			const text = `${p.name} ${p.short_description} ${p.categories.map((c) => c.name).join(' ')}`.toLowerCase();
			return /flashlight|headlamp|lantern|torch|light|lumen/i.test(text);
		},
	},
];

/**
 * Fetch all products from a WooCommerce store via Store API.
 */
async function fetchAllProducts(store: WooStore): Promise<WooProduct[]> {
	const allProducts: WooProduct[] = [];
	let page = 1;
	const perPage = 100;

	const apiBase = store.apiPath ?? '/wp-json/wc/store/v1/products';

	while (true) {
		const url = `${store.baseUrl}${apiBase}?per_page=${perPage}&page=${page}`;
		try {
			const res = await fetch(url, {
				headers: {
					'User-Agent': 'Mozilla/5.0 (compatible; TorchBot/1.0)',
					'Accept': 'application/json',
				},
			});

			if (!res.ok) {
				if (res.status === 404 || res.status === 400) break;
				throw new Error(`HTTP ${res.status}`);
			}

			const products = await res.json() as WooProduct[];
			if (!products || products.length === 0) break;

			allProducts.push(...products);
			console.log(`    Page ${page}: ${products.length} products (total: ${allProducts.length})`);

			if (products.length < perPage) break;
			page++;
			await Bun.sleep(CRAWL_DELAY);
		} catch (err) {
			console.log(`    Error on page ${page}: ${(err as Error).message}`);
			break;
		}
	}

	return allProducts;
}

/**
 * Convert a WooCommerce product to FlashlightEntry.
 */
function wooToEntry(product: WooProduct, brand: string): FlashlightEntry | null {
	// Extract model from name
	let model = product.name;
	if (model.toLowerCase().startsWith(brand.toLowerCase())) {
		model = model.slice(brand.length).trim();
	}
	// Clean model name
	model = model
		.replace(/^[\s\-–—:]+/, '')
		.replace(/\s+(?:rechargeable|tactical|led|edc|super\s*bright)\s+(?:flashlight|headlamp|lantern|light|torch)s?$/i, '')
		.replace(/\s+(?:flashlight|headlamp|lantern|light|torch)s?$/i, '')
		.trim();

	if (!model || model.length < 2) return null;

	// Parse description for specs
	const text = htmlToText(`${product.description} ${product.short_description}`);
	const specs = parseWooSpecs(text, product);

	// Price (from minor units)
	const minorUnit = product.prices?.currency_minor_unit ?? 2;
	const price = product.prices?.price
		? parseFloat(product.prices.price) / Math.pow(10, minorUnit)
		: undefined;

	// Weight (WooCommerce stores it in kg)
	let weight_g = specs.weight_g;
	if (!weight_g && product.weight) {
		const wkg = parseFloat(product.weight);
		if (wkg > 0) weight_g = Math.round(wkg * 1000);
	}

	// Length (WooCommerce stores dimensions in cm)
	let length_mm = specs.length_mm;
	if (!length_mm && product.dimensions?.length) {
		const lcm = parseFloat(product.dimensions.length);
		if (lcm > 0) length_mm = Math.round(lcm * 10);
	}

	// Images
	const imageUrls = product.images
		.filter((img) => !/placeholder|default/i.test(img.src))
		.map((img) => img.src)
		.slice(0, 8);

	// Colors from attributes
	const colors: string[] = [...(specs.colors ?? [])];
	const colorAttr = product.attributes.find((a) => /color|colour|finish/i.test(a.name));
	if (colorAttr) {
		for (const term of colorAttr.terms) {
			const c = term.name.toLowerCase();
			if (!colors.includes(c)) colors.push(c);
		}
	}

	// Type from categories
	const types: string[] = [];
	const catText = product.categories.map((c) => c.name).join(' ').toLowerCase();
	const nameText = `${product.name} ${catText}`;
	if (/headlamp|head lamp/i.test(nameText)) types.push('headlamp');
	if (/lantern/i.test(nameText)) types.push('lantern');
	if (/keychain|key light/i.test(nameText)) types.push('keychain');
	if (/right.?angle/i.test(nameText)) types.push('right-angle');
	if (/dive|diving/i.test(nameText)) types.push('dive');
	if (types.length === 0) types.push('flashlight');

	const id = generateId(brand, model, specs.leds?.[0]);

	return {
		id,
		model,
		brand,
		type: types,
		led: specs.leds ?? [],
		led_color: specs.ledColors ?? [],
		performance: {
			claimed: {
				lumens: specs.lumens ?? [],
				intensity_cd: specs.intensity_cd,
				throw_m: specs.throw_m,
				beam_angle: specs.beam_angle,
				runtime_hours: specs.runtime_hours ?? [],
			},
			measured: {},
		},
		battery: specs.batteries ?? [],
		charging: specs.charging ?? [],
		modes: specs.modes ?? [],
		levels: specs.levels,
		blink: specs.blink ?? [],
		length_mm,
		bezel_mm: specs.bezel_mm,
		body_mm: specs.body_mm,
		weight_g,
		material: specs.materials ?? [],
		color: colors,
		impact: specs.impact ?? [],
		environment: specs.environment ?? [],
		switch: specs.switches ?? [],
		features: specs.features ?? [],
		price_usd: price,
		prices: [],
		purchase_urls: [product.permalink],
		info_urls: [product.permalink],
		image_urls: imageUrls,
		review_refs: [],
		sources: [],
		updated_at: new Date().toISOString(),
	};
}

/** Parse specs from WooCommerce description text */
function parseWooSpecs(text: string, product: WooProduct): {
	lumens?: number[];
	intensity_cd?: number;
	throw_m?: number;
	beam_angle?: number;
	runtime_hours?: number[];
	weight_g?: number;
	length_mm?: number;
	bezel_mm?: number;
	body_mm?: number;
	batteries?: string[];
	leds?: string[];
	ledColors?: string[];
	charging?: string[];
	modes?: string[];
	levels?: number;
	blink?: string[];
	materials?: string[];
	colors?: string[];
	impact?: string[];
	environment?: string[];
	switches?: string[];
	features?: string[];
} {
	// Normalize smart quotes
	const t = text
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
		.replace(/[\u201C\u201D\u201E\u201F\u2033\u2034\u2036\u2037]/g, '"')
		.replace(/[\u2010-\u2015]/g, '-')
		.replace(/\u00A0/g, ' ');

	const specs: ReturnType<typeof parseWooSpecs> = {};

	// Lumens
	const lumens: number[] = [];
	const lumRe = /(\d[\d,]*)\s*(?:lumens?|lm)\b/gi;
	let m;
	while ((m = lumRe.exec(t)) !== null) {
		const val = parseInt(m[1].replace(/,/g, ''), 10);
		if (val > 0 && val < 1_000_000 && !lumens.includes(val)) lumens.push(val);
	}
	if (lumens.length > 0) specs.lumens = lumens.sort((a, b) => b - a);

	// Throw/beam distance
	const throwMatch = t.match(/(?:throw|beam\s*distance|max\s*distance)[:\s]*(\d[\d,]*)\s*m(?:eters?)?\b/i);
	if (throwMatch) specs.throw_m = parseInt(throwMatch[1].replace(/,/g, ''), 10);

	// Intensity
	const cdMatch = t.match(/(\d[\d,]*)\s*(?:cd|candela)\b/i);
	if (cdMatch) specs.intensity_cd = parseInt(cdMatch[1].replace(/,/g, ''), 10);

	// Runtime
	const runtimes: number[] = [];
	const rtRe = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/gi;
	while ((m = rtRe.exec(t)) !== null) {
		const val = parseFloat(m[1]);
		if (val > 0 && val < 10000 && !runtimes.includes(val)) runtimes.push(val);
	}
	if (runtimes.length > 0) specs.runtime_hours = runtimes;

	// Dimensions
	const lenMatch = t.match(/length[:\s]*(\d+(?:\.\d+)?)\s*mm/i);
	if (lenMatch) specs.length_mm = parseFloat(lenMatch[1]);
	const lenInch = t.match(/length[:\s]*(\d+(?:\.\d+)?)["]\s*\(\s*(\d+(?:\.\d+)?)\s*mm\)/i);
	if (lenInch) specs.length_mm = parseFloat(lenInch[2]);

	const bezelMatch = t.match(/(?:head|bezel)\s*(?:diameter|diam)?[:\s]*(\d+(?:\.\d+)?)\s*mm/i);
	if (bezelMatch) specs.bezel_mm = parseFloat(bezelMatch[1]);

	const bodyMatch = t.match(/(?:body|tube)\s*(?:diameter|diam)?[:\s]*(\d+(?:\.\d+)?)\s*mm/i);
	if (bodyMatch) specs.body_mm = parseFloat(bodyMatch[1]);

	const weightMatch = t.match(/weight[:\s]*(\d+(?:\.\d+)?)\s*g(?:rams?)?\b/i);
	if (weightMatch) specs.weight_g = parseFloat(weightMatch[1]);

	// Battery
	const batteries: string[] = [];
	const battPatterns: [RegExp, string][] = [
		[/\b21700\b/, '21700'], [/\b18650\b/, '18650'], [/\b18350\b/, '18350'],
		[/\b16340\b/, '16340'], [/\b14500\b/, '14500'], [/\bCR123A?\b/i, 'CR123A'],
		[/\b26650\b/, '26650'], [/\bAA\b(?!\w)/, 'AA'], [/\bAAA\b/, 'AAA'],
	];
	for (const [re, name] of battPatterns) {
		if (re.test(t) && !batteries.includes(name)) batteries.push(name);
	}
	if (batteries.length > 0) specs.batteries = batteries;

	// LED
	const leds: string[] = [];
	const ledPatterns: [RegExp, string][] = [
		[/\bSST[\s-]?20\b/i, 'SST-20'], [/\bSST[\s-]?40\b/i, 'SST-40'],
		[/\bSFT[\s-]?40\b/i, 'SFT-40'], [/\bSFT[\s-]?70\b/i, 'SFT-70'],
		[/\bXHP[\s-]?50/i, 'XHP50'], [/\bXHP[\s-]?70/i, 'XHP70'],
		[/\bXM[\s-]?L2?\b/i, 'XM-L2'], [/\bXP[\s-]?L/i, 'XP-L'],
		[/\b519A\b/, '519A'], [/\b219[BCF]\b/, '219B'],
		[/\bLH351D\b/i, 'LH351D'], [/\bE21A\b/, 'E21A'],
	];
	for (const [re, name] of ledPatterns) {
		if (re.test(t) && !leds.includes(name)) leds.push(name);
	}
	if (leds.length > 0) specs.leds = leds;

	// LED color
	const ledColors: string[] = [];
	if (/neutral\s*white/i.test(t)) ledColors.push('neutral white');
	if (/cool\s*white/i.test(t)) ledColors.push('cool white');
	if (/warm\s*white/i.test(t)) ledColors.push('warm white');
	if (ledColors.length > 0) specs.ledColors = ledColors;

	// Charging
	const charging: string[] = [];
	if (/usb[\s-]?c\b/i.test(t)) charging.push('USB-C');
	if (/micro[\s-]?usb/i.test(t)) charging.push('Micro-USB');
	if (/magnetic\s*charg/i.test(t)) charging.push('magnetic');
	if (charging.length > 0) specs.charging = charging;

	// Material
	const materials: string[] = [];
	if (/aluminum|aluminium|A6061/i.test(t)) materials.push('aluminum');
	if (/titanium/i.test(t)) materials.push('titanium');
	if (/copper/i.test(t)) materials.push('copper');
	if (/stainless/i.test(t)) materials.push('stainless steel');
	if (/polymer|plastic|nylon/i.test(t)) materials.push('polymer');
	if (materials.length > 0) specs.materials = materials;

	// Switch
	const switches: string[] = [];
	if (/tail[\s-]?switch|tail[\s-]?cap/i.test(t)) switches.push('tail');
	if (/side[\s-]?switch|side\s*button/i.test(t)) switches.push('side');
	if (/dual[\s-]?switch/i.test(t)) switches.push('dual');
	if (/rotary|twist/i.test(t)) switches.push('rotary');
	if (switches.length > 0) specs.switches = switches;

	// Features
	const features: string[] = [];
	if (/\bclip\b/i.test(t) && !/video\s*clip/i.test(t)) features.push('clip');
	if (/\bmagnet/i.test(t) && !/magnetic\s*charg/i.test(t)) features.push('magnet');
	if (/\blanyard/i.test(t)) features.push('lanyard');
	if (/\blockout/i.test(t)) features.push('lockout');
	if (/\bmemory/i.test(t)) features.push('mode memory');
	if (/\banduril/i.test(t)) features.push('Anduril');
	if (/\brechargeable/i.test(t)) features.push('rechargeable');
	if (features.length > 0) specs.features = features;

	// Environment/IP
	const env: string[] = [];
	const ipMatch = t.match(/\bIP[X]?(\d{1,2})\b/i);
	if (ipMatch) {
		const rating = ipMatch[1].length === 1 ? `IPX${ipMatch[1]}` : `IP${ipMatch[1]}`;
		env.push(rating);
	}
	if (env.length > 0) specs.environment = env;

	// Blink
	const blink: string[] = [];
	if (/\bstrobe\b/i.test(t)) blink.push('strobe');
	if (/\bsos\b/i.test(t)) blink.push('SOS');
	if (/\bbeacon\b/i.test(t)) blink.push('beacon');
	if (blink.length > 0) specs.blink = blink;

	return specs;
}

/**
 * Crawl a single WooCommerce store.
 */
export async function crawlWooStore(store: WooStore): Promise<{
	total: number;
	saved: number;
	skipped: number;
}> {
	console.log(`  Fetching products from ${store.brand} (${store.baseUrl})...`);
	const products = await fetchAllProducts(store);
	console.log(`  Found ${products.length} total products`);

	let saved = 0;
	let skipped = 0;

	for (const product of products) {
		if (store.isFlashlight && !store.isFlashlight(product)) {
			skipped++;
			continue;
		}

		const entry = wooToEntry(product, store.brand);
		if (entry) {
			upsertFlashlight(entry);
			addSource(entry.id, {
				source: `woocommerce:${store.brand}`,
				url: product.permalink,
				scraped_at: new Date().toISOString(),
				confidence: 0.85,
			});
			saved++;
		} else {
			skipped++;
		}
	}

	return { total: products.length, saved, skipped };
}

/**
 * Crawl all configured WooCommerce stores.
 */
export async function crawlAllWooStores(): Promise<{
	totalSaved: number;
	byBrand: Record<string, number>;
}> {
	let totalSaved = 0;
	const byBrand: Record<string, number> = {};

	for (const store of WOOCOMMERCE_STORES) {
		console.log(`\n--- ${store.brand} (WooCommerce) ---`);
		try {
			const result = await crawlWooStore(store);
			totalSaved += result.saved;
			byBrand[store.brand] = result.saved;
			console.log(`  Result: ${result.saved} saved, ${result.skipped} skipped`);
		} catch (err) {
			console.log(`  Error: ${(err as Error).message}`);
			byBrand[store.brand] = 0;
		}
		await Bun.sleep(2000);
	}

	return { totalSaved, byBrand };
}
