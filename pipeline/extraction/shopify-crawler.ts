/**
 * Shopify-based product crawler.
 * Many flashlight brands use Shopify stores, which provide a JSON API:
 *   /products.json?limit=250&page=N
 *   /products/{handle}.json
 * No API key needed — public product data.
 */
import { generateId } from '../schema/canonical.js';
import type { FlashlightEntry } from '../schema/canonical.js';
import { upsertFlashlight, addSource, addRawSpecText, countFlashlights } from '../store/db.js';
import { htmlToText } from './manufacturer-scraper.js';
import { normalizeBrandName } from '../store/brand-aliases.js';

const CRAWL_DELAY = 800; // ms between requests

/** Shopify product JSON structure (subset of fields we use) */
interface ShopifyProduct {
	id: number;
	title: string;
	handle: string;
	vendor: string;
	product_type: string;
	tags: string[];
	body_html: string;
	images: Array<{
		id: number;
		src: string;
		alt: string | null;
		width: number;
		height: number;
	}>;
	variants: Array<{
		id: number;
		title: string;
		price: string;
		sku: string;
		barcode: string;
		grams: number;
		weight: number;
		weight_unit: string;
		option1: string | null;
		option2: string | null;
		available: boolean;
	}>;
	options: Array<{
		name: string;
		values: string[];
	}>;
}

/** Shopify store configuration */
interface ShopifyStore {
	brand: string;
	baseUrl: string;
	/** Public URL for building purchase links (when API URL differs, e.g. myshopify domain) */
	publicUrl?: string;
	/** Filter: only include products matching this predicate */
	isFlashlight?: (product: ShopifyProduct) => boolean;
	/** For retailer stores: extract brand from vendor field instead of using fixed brand */
	isRetailer?: boolean;
	/** Option name that contains emitter specs embedded in variant strings (e.g. "Emitter Type") */
	emitterSpecOption?: string;
}

/** Known Shopify stores for flashlight brands */
export const SHOPIFY_STORES: ShopifyStore[] = [
	{
		brand: 'Fenix',
		baseUrl: 'https://www.fenixlighting.com',
		isFlashlight: (p) => {
			const type = p.product_type.toLowerCase();
			return /flashlight|headlamp|lantern|light|lamp/i.test(type) ||
				p.tags.some((t) => /flashlight|headlamp|lantern/i.test(t));
		},
	},
	{
		brand: 'Olight',
		baseUrl: 'https://www.olightstore.com',
		isFlashlight: (p) => {
			const type = p.product_type.toLowerCase();
			return /flashlight|headlamp|lantern|light/i.test(type) ||
				p.tags.some((t) => /flashlight|headlamp|lantern|light/i.test(t));
		},
	},
	// ThruNite: BigCommerce (not Shopify)
	// Wurkkos: UeeShop (not Shopify)
	// Sofirn: Shoplazza (not Shopify)
	// Acebeam: nopCommerce (not Shopify)
	// Skilhunt: WooCommerce (not Shopify)
	// Lumintop: WooCommerce (not Shopify)
	{
		brand: 'Nitecore',
		baseUrl: 'https://www.nitecorestore.com',
		isFlashlight: (p) => {
			const type = (p.product_type ?? '').toLowerCase();
			const title = p.title.toLowerCase();
			// Nitecore sells batteries, chargers, accessories — filter to lights only
			return (/flashlight|headlamp|lantern|light|lamp/i.test(type) ||
				/flashlight|headlamp|lantern|torch|lumen/i.test(title)) &&
				!/battery|charger|adapter|case|holster|filter|diffuser|mount/i.test(type);
		},
	},
	{
		brand: 'Rovyvon',
		baseUrl: 'https://www.rovyvon.com',
	},
	{
		brand: 'Wuben',
		baseUrl: 'https://www.wubenlight.com',
	},
	{
		brand: 'Imalent',
		baseUrl: 'https://www.imalentstore.com',
	},
	// Klarus: Custom PHP (not Shopify)
	{
		brand: 'Maglite',
		baseUrl: 'https://maglite.com',
		isFlashlight: (p) => {
			// Maglite uses Inkybay for custom engraving, creating hundreds of duplicates
			// Filter out PD Custom Products and bundles
			const type = (p.product_type ?? '').toLowerCase();
			const tags = p.tags.map((t) => t.toLowerCase());
			if (type === 'pd custom product' || tags.some((t) => t.includes('inkybay'))) return false;
			if (type.includes('bundle') || type.includes('combo')) return false;
			return /flashlight|headlamp|lantern|light|lamp|solitaire|mag-tac|maglite/i.test(
				`${p.title} ${type}`
			);
		},
	},
	{
		brand: 'Ledlenser',
		baseUrl: 'https://ledlenserusa.com',
	},
	{
		brand: 'Pelican',
		baseUrl: 'https://shop.pelican.com',
		isFlashlight: (p) => {
			const text = `${p.title} ${p.product_type} ${p.tags.join(' ')}`.toLowerCase();
			return /flashlight|headlamp|light|lamp/i.test(text);
		},
	},
	{
		brand: 'Fireflies',
		// Custom domain blocks /products.json (503), use myshopify domain for API
		baseUrl: 'https://ff-light.myshopify.com',
		publicUrl: 'https://www.firefly-outdoor.com',
		// Emitter specs embedded in variant option2: "FFL5009R 5000K CRI95 2200lm 220m"
		emitterSpecOption: 'Emitter Type',
		isFlashlight: (p) => {
			const text = `${p.title} ${p.product_type ?? ''}`.toLowerCase();
			// Filter out accessories: O-rings, emitters, tripods, clips, batteries
			return /flashlight|headlamp|lantern|torch|edc|right.?angle/i.test(text) &&
				!/o-ring|emitter|tripod|clip|battery|upgrade|service/i.test(text);
		},
	},
	// --- Retailer stores (multi-brand, use vendor field for brand) ---
	{
		brand: 'Killzone',
		baseUrl: 'https://www.killzoneflashlights.com',
		isRetailer: true,
		isFlashlight: (p) => {
			const type = (p.product_type ?? '').toLowerCase();
			return /flashlight|headlamp|lantern|light/i.test(type) ||
				/flashlight|headlamp|lantern|lumen|torch/i.test(p.title.toLowerCase());
		},
	},
	{
		brand: 'NealGadgets',
		baseUrl: 'https://www.nealsgadgets.com',
		isRetailer: true,
		isFlashlight: (p) => {
			const text = `${p.title} ${p.product_type ?? ''}`.toLowerCase();
			return /flashlight|headlamp|lantern|torch|lumen|lep\b/i.test(text) &&
				!/knife|blade|tool|pen\b(?!light)|spinner|fidget|wallet/i.test(text);
		},
	},
	{
		brand: 'GoingGear',
		baseUrl: 'https://goinggear.com',
		isRetailer: true,
		isFlashlight: (p) => {
			const type = (p.product_type ?? '').toLowerCase();
			return /flashlight|headlamp|lantern|light/i.test(type);
		},
	},
	{
		brand: 'BatteryJunction',
		baseUrl: 'https://www.batteryjunction.com',
		isRetailer: true,
		isFlashlight: (p) => {
			const type = (p.product_type ?? '').toLowerCase();
			const title = p.title.toLowerCase();
			return /flashlight|headlamp|lantern/i.test(type) ||
				(/flashlight|headlamp|lantern|torch/i.test(title) &&
				!/battery|charger|mount|holster|filter|diffuser|switch\s+cap|lens|accessory|replacement/i.test(type));
		},
	},
	{
		brand: 'FlashlightGo',
		baseUrl: 'https://flashlightgo.com',
		isRetailer: true,
		isFlashlight: (p) => {
			const text = `${p.title} ${p.product_type ?? ''}`.toLowerCase();
			return /flashlight|headlamp|lantern|torch|lumen/i.test(text);
		},
	},
	{
		brand: 'Skylumen',
		baseUrl: 'https://skylumen.com',
		isRetailer: true,
		isFlashlight: (p) => {
			const text = `${p.title} ${p.product_type ?? ''}`.toLowerCase();
			return /flashlight|headlamp|lantern|light|torch|lumen/i.test(text) &&
				!/battery|charger|holster|pouch|strap/i.test(text);
		},
	},
	// --- New brand stores (from PIPELINE.md TODO) ---
	{
		brand: 'Nextorch',
		baseUrl: 'https://www.nextorch.com',
		isFlashlight: (p) => {
			const text = `${p.title} ${p.product_type ?? ''}`.toLowerCase();
			return /flashlight|headlamp|lantern|light|torch/i.test(text);
		},
	},
	{
		brand: 'PowerTac',
		baseUrl: 'https://www.powertac.com',
	},
	{
		brand: 'Nightstick',
		baseUrl: 'https://www.nightstick.com',
		isFlashlight: (p) => {
			const text = `${p.title} ${p.product_type ?? ''} ${p.tags.join(' ')}`.toLowerCase();
			return /flashlight|headlamp|lantern|light|lamp/i.test(text);
		},
	},
	{
		brand: 'Malkoff',
		baseUrl: 'https://malkoffdevices.com',
	},
	{
		brand: 'ReyLight',
		baseUrl: 'https://reylight.net',
	},
	{
		brand: 'Lumintop',
		baseUrl: 'https://www.lumintoponline.com',
		isFlashlight: (p) => {
			const text = `${p.title} ${p.product_type ?? ''}`.toLowerCase();
			// Filter out accessories: batteries, clips, tailcaps, chargers, etc.
			return !/battery|clip|tailcap|tail cap|charger|holster|diffuser|filter|lanyard|o-ring/i.test(text);
		},
	},
	{
		brand: 'FourSevens',
		baseUrl: 'https://www.foursevens.com',
	},
	{
		brand: 'Modlite',
		baseUrl: 'https://modlite.com',
		isFlashlight: (p) => {
			const text = `${p.title} ${p.product_type ?? ''}`.toLowerCase();
			return /light|handheld|weapon|head\b|body\b/i.test(text) &&
				!/mount|switch|cap|battery|charger|holster|sling/i.test(text);
		},
	},
	{
		brand: 'CloudDefensive',
		baseUrl: 'https://www.clouddefensive.com',
		isFlashlight: (p) => {
			const text = `${p.title} ${p.product_type ?? ''}`.toLowerCase();
			return /rein|light|owl|mcw/i.test(text) &&
				!/mount|switch|tape|pad|rail|sling|hat|shirt|patch/i.test(text);
		},
	},
	// --- New retailer stores ---
	{
		brand: 'JLHawaii808',
		baseUrl: 'https://jlhawaii808.com',
		isRetailer: true,
		isFlashlight: (p) => {
			const text = `${p.title} ${p.product_type ?? ''}`.toLowerCase();
			return /flashlight|headlamp|lantern|torch|emisar|noctigon|hank/i.test(text);
		},
	},
	{
		brand: 'FlashlightWorldCA',
		baseUrl: 'https://flashlightworld.ca',
		isRetailer: true,
		isFlashlight: (p) => {
			const text = `${p.title} ${p.product_type ?? ''}`.toLowerCase();
			return /flashlight|headlamp|lantern|torch|light/i.test(text) &&
				!/battery|charger|filter|diffuser|mount|holster/i.test(text);
		},
	},
	{
		brand: 'FenixStore',
		baseUrl: 'https://www.fenix-store.com',
		isRetailer: true,
		isFlashlight: (p) => {
			const type = (p.product_type ?? '').toLowerCase();
			return /flashlight|headlamp|lantern|light/i.test(type);
		},
	},
	{
		brand: 'TorchDirectUK',
		baseUrl: 'https://torchdirect.co.uk',
		isRetailer: true,
		isFlashlight: (p) => {
			const text = `${p.title} ${p.product_type ?? ''}`.toLowerCase();
			return /flashlight|headlamp|lantern|torch|light/i.test(text) &&
				!/battery|charger|filter|case|pouch/i.test(text);
		},
	},
	{
		brand: 'Loop Gear',
		baseUrl: 'https://loopgear.com',
		isFlashlight: (p) => {
			const text = `${p.title} ${p.product_type ?? ''} ${p.tags.join(' ')}`.toLowerCase();
			return /flashlight|torch|edc|light|lantern/i.test(text) &&
				!/battery|charger|case|pouch|clip|strap/i.test(text);
		},
	},
];

/**
 * Fetch all products from a Shopify store.
 * Uses the /products.json endpoint with pagination (250 per page).
 */
async function fetchAllProducts(store: ShopifyStore): Promise<ShopifyProduct[]> {
	const allProducts: ShopifyProduct[] = [];
	let page = 1;
	const limit = 250;

	while (true) {
		const url = `${store.baseUrl}/products.json?limit=${limit}&page=${page}`;
		try {
			const res = await fetch(url, {
				headers: {
					'User-Agent': 'Mozilla/5.0 (compatible; TorchBot/1.0)',
					'Accept': 'application/json',
				},
			});

			if (!res.ok) {
				if (res.status === 404 || res.status === 401) {
					console.log(`    ${store.brand}: Not a Shopify store or API disabled (${res.status})`);
					break;
				}
				throw new Error(`HTTP ${res.status}`);
			}

			const data = await res.json() as { products: ShopifyProduct[] };
			if (!data.products || data.products.length === 0) break;

			allProducts.push(...data.products);
			console.log(`    Page ${page}: ${data.products.length} products (total: ${allProducts.length})`);

			if (data.products.length < limit) break; // Last page
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
 * Convert a Shopify product to FlashlightEntry.
 * Extracts structured data from tags + body_html.
 */
function shopifyToEntry(product: ShopifyProduct, brand: string, storeUrl: string, isRetailer = false, emitterSpecOption?: string): FlashlightEntry | null {
	// For retailer stores, extract brand from vendor field
	if (isRetailer && product.vendor) {
		brand = normalizeBrandName(product.vendor);
	}

	// Extract model name from title (remove brand prefix and product type suffixes)
	let model = product.title;
	const brandLower = brand.toLowerCase();
	if (model.toLowerCase().startsWith(brandLower)) {
		model = model.slice(brand.length).trim();
	}
	// Remove leading separators and common prefixes
	model = model.replace(/^[\s\-–—:]+/, '');
	// Remove retailer prefixes like "Garage Sale -", "Pre-Order -", "Clearance -"
	model = model.replace(/^(?:garage\s*sale|pre[\s-]?order|clearance|new|sale|hot|limited)\s*[-–—:]\s*/i, '');
	// If brand still appears at start after cleanup, remove it again
	if (model.toLowerCase().startsWith(brandLower)) {
		model = model.slice(brand.length).trim().replace(/^[\s\-–—:]+/, '');
	}
	// Remove common suffixes (progressive, longest first)
	const suffixPatterns = [
		/\s+(?:rechargeable|tactical|led|edc|super\s*bright|high\s*performance|compact|professional|outdoor)\s+(?:flashlight|headlamp|lantern|work\s*light|pen\s*light|key\s*light|search\s*light|bike\s*light|camping\s*light|spotlight|floodlight|head\s*lamp|lamp|light|torch)s?$/i,
		/\s+(?:flashlight|headlamp|lantern|work\s*light|penlight|pen\s*light|keylight|key\s*light|searchlight|search\s*light|bike\s*light|camping\s*light|spotlight|floodlight|head\s*lamp|lamp|light|torch)s?$/i,
		/\s+(?:bundle|kit|set|combo|pack|gift\s*set)$/i,
	];
	for (const pattern of suffixPatterns) {
		model = model.replace(pattern, '');
	}
	// Remove brand name if it appears anywhere in the model
	model = model.replace(new RegExp(`\\b${brand}\\b`, 'gi'), '').trim();
	// Clean up double spaces and trailing separators
	model = model.replace(/\s{2,}/g, ' ').replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '').trim();

	if (!model || model.length < 2) return null;

	// Parse tags for structured data
	const tags = product.tags.map((t) => t.toLowerCase().trim());
	const tagSet = new Set(tags);

	// Extract specs from body_html text
	const bodyText = htmlToText(product.body_html ?? '');
	const specs = parseShopifySpecs(bodyText, tags);

	// Colors from variant options
	const colors: string[] = [];
	const colorOption = product.options.find((o) => /color|colour|finish/i.test(o.name));
	if (colorOption) {
		for (const val of colorOption.values) {
			const cleaned = normalizeColor(val);
			if (cleaned && !colors.includes(cleaned)) colors.push(cleaned);
		}
	}
	// Colors from tags: "COLOR_Black" (Ledlenser format) or "Color: Black"
	if (!colors.length) {
		for (const tag of tags) {
			const colorTagMatch = tag.match(/^color[_:]\s*(.+)/i);
			if (colorTagMatch) {
				const cleaned = normalizeColor(colorTagMatch[1]);
				if (cleaned && !colors.includes(cleaned)) colors.push(cleaned);
			}
		}
	}

	// Images (filter out spec charts, icons)
	const imageUrls = product.images
		.filter((img) => !img.alt || !/spec|chart|diagram|icon|badge|logo/i.test(img.alt))
		.map((img) => img.src.replace(/\?v=\d+/, ''))
		.slice(0, 8);

	// Price from first available variant (filter out $0 catalog-only stores)
	const availableVariant = product.variants.find((v) => v.available) ?? product.variants[0];
	const rawPrice = availableVariant ? parseFloat(availableVariant.price) : undefined;
	const price = rawPrice && rawPrice > 0 ? rawPrice : undefined;

	// Weight from variant (grams)
	const weight_g = availableVariant?.grams > 0
		? availableVariant.grams
		: specs.weight_g;

	// Type classification
	const types: string[] = [];
	const typeText = `${product.title} ${product.product_type}`.toLowerCase();
	if (typeText.includes('headlamp') || typeText.includes('head lamp')) types.push('headlamp');
	if (typeText.includes('lantern')) types.push('lantern');
	if (typeText.includes('keychain') || typeText.includes('key light')) types.push('keychain');
	if (typeText.includes('pen') || typeText.includes('penlight')) types.push('penlight');
	if (typeText.includes('weapon') || typeText.includes('gun') || typeText.includes('pistol')) types.push('weapon');
	if (typeText.includes('bike') || typeText.includes('bicycle')) types.push('bike');
	if (typeText.includes('right angle') || typeText.includes('right-angle')) types.push('right-angle');
	if (typeText.includes('dive') || typeText.includes('diving')) types.push('dive');
	if (types.length === 0) types.push('flashlight');

	// Features from tags
	const features: string[] = [...(specs.features ?? [])];
	if (tagSet.has('battery included') || tags.some((t) => t.includes('battery included'))) features.push('battery included');
	if (tagSet.has('battery indicator') || tags.some((t) => t.includes('battery') && t.includes('indicator'))) features.push('battery indicator');
	if (tagSet.has('memory') || tags.some((t) => t.includes('memory'))) features.push('mode memory');
	if (tagSet.has('strobe') || tags.some((t) => t.includes('strobe'))) features.push('strobe');
	if (tagSet.has('rechargeable') || tags.some((t) => t.includes('rechargeable'))) features.push('rechargeable');
	if (tags.some((t) => t.includes('clip'))) features.push('clip');
	if (tags.some((t) => t.includes('magnet'))) features.push('magnet');
	if (tags.some((t) => t.includes('lockout'))) features.push('lockout');

	// Switch from tags
	const switches: string[] = [...(specs.switches ?? [])];
	for (const tag of tags) {
		if (tag.includes('switch')) {
			if (tag.includes('dual')) switches.push('dual');
			else if (tag.includes('tail')) switches.push('tail');
			else if (tag.includes('side')) switches.push('side');
			else if (tag.includes('rotary')) switches.push('rotary');
		}
	}

	// Battery from tags
	const batteries: string[] = [...(specs.batteries ?? [])];
	const batteryPatterns: [string, string][] = [
		['21700', '21700'], ['18650', '18650'], ['18350', '18350'],
		['16340', '16340'], ['14500', '14500'], ['cr123', 'CR123A'],
		['26650', '26650'], ['aa', 'AA'], ['aaa', 'AAA'],
	];
	for (const [pattern, name] of batteryPatterns) {
		if (tags.some((t) => t.includes(pattern)) && !batteries.includes(name)) {
			batteries.push(name);
		}
	}

	// Charging from tags
	const charging: string[] = [...(specs.charging ?? [])];
	if (tags.some((t) => t.includes('usbc') || t.includes('usb-c') || t.includes('type-c') || t.includes('type c'))) charging.push('USB-C');
	if (tags.some((t) => t.includes('micro') && t.includes('usb'))) charging.push('Micro-USB');
	if (tags.some((t) => t.includes('magnetic') && t.includes('charg'))) charging.push('magnetic');

	// IP rating from tags
	const environment: string[] = [...(specs.environment ?? [])];
	for (const tag of tags) {
		const ipMatch = tag.match(/ip[x]?(\d{1,2})/i);
		if (ipMatch) {
			const rating = `IP${ipMatch[1].length === 1 ? 'X' + ipMatch[1] : ipMatch[1]}`;
			if (!environment.includes(rating)) environment.push(rating);
		}
	}

	// === Killzone structured tags: Battery_21700, Metal_Aluminum, Emitter_SST-40, Brand_Wurkkos ===
	for (const tag of tags) {
		if (tag.startsWith('battery_') && batteries.length === 0) {
			const batt = tag.slice(8); // "battery_21700" → "21700"
			const battMap: Record<string, string> = {
				'21700': '21700', '18650': '18650', '18350': '18350', '16340': '16340',
				'14500': '14500', 'cr123a': 'CR123A', 'cr123': 'CR123A', '26650': '26650',
				'26800': '26800', 'aa': 'AA', 'aaa': 'AAA',
			};
			const mapped = battMap[batt.toLowerCase()];
			if (mapped && !batteries.includes(mapped)) batteries.push(mapped);
		}
		if (tag.startsWith('metal_') && !specs.materials?.length) {
			const mat = tag.slice(6).toLowerCase(); // "metal_aluminum" → "aluminum"
			const parsedMats: string[] = [];
			if (/aluminum|aluminium/.test(mat)) parsedMats.push('aluminum');
			else if (mat === 'titanium') parsedMats.push('titanium');
			else if (mat === 'copper') parsedMats.push('copper');
			else if (mat === 'brass') parsedMats.push('brass');
			else if (/stainless/.test(mat)) parsedMats.push('stainless steel');
			else if (/polymer|plastic|polycarbonate/.test(mat)) parsedMats.push('polymer');
			if (parsedMats.length > 0) specs.materials = parsedMats;
		}
		if (tag.startsWith('emitter_') && !specs.leds?.length) {
			const emitter = tag.slice(8); // "emitter_sst-40" → "sst-40"
			const emitterPatterns: [RegExp, string][] = [
				[/^sst[\s-]?20$/i, 'SST-20'], [/^sst[\s-]?40$/i, 'SST-40'],
				[/^sft[\s-]?40$/i, 'SFT-40'], [/^sft[\s-]?70$/i, 'SFT-70'],
				[/^xhp[\s-]?50/i, 'XHP50'], [/^xhp[\s-]?70/i, 'XHP70'],
				[/^xp[\s-]?l/i, 'XP-L'], [/^519a$/i, '519A'],
				[/^lh351d$/i, 'LH351D'], [/^e21a$/i, 'E21A'],
			];
			const parsedLeds: string[] = [];
			for (const [re, name] of emitterPatterns) {
				if (re.test(emitter)) { parsedLeds.push(name); break; }
			}
			// If no pattern matched, use cleaned value directly
			if (parsedLeds.length === 0 && emitter.length > 2) parsedLeds.push(emitter);
			if (parsedLeds.length > 0) specs.leds = parsedLeds;
		}
	}

	// === Wuben structured tags: Emitter_SST-40, Battery Type_21700, Waterproof Level_IPX8 ===
	for (const tag of tags) {
		if (tag.startsWith('emitter_') && !specs.leds?.length) {
			const emitter = tag.slice(8);
			const emitterPatterns: [RegExp, string][] = [
				[/^sst[\s-]?20$/i, 'SST-20'], [/^sst[\s-]?40$/i, 'SST-40'],
				[/^sst[\s-]?70$/i, 'SST-70'],
				[/^sft[\s-]?40$/i, 'SFT-40'], [/^sft[\s-]?70$/i, 'SFT-70'],
				[/^xhp[\s-]?50/i, 'XHP50'], [/^xhp[\s-]?70/i, 'XHP70'],
				[/^xp[\s-]?l/i, 'XP-L'], [/^519a$/i, '519A'],
				[/^lh351d$/i, 'LH351D'], [/^e21a$/i, 'E21A'],
				[/^cob$/i, 'COB'], [/^lep$/i, 'LEP'],
			];
			const parsedLeds: string[] = [];
			for (const [re, name] of emitterPatterns) {
				if (re.test(emitter)) { parsedLeds.push(name); break; }
			}
			if (parsedLeds.length === 0 && emitter.length > 2) parsedLeds.push(emitter);
			if (parsedLeds.length > 0) specs.leds = parsedLeds;
		}
		if (tag.startsWith('battery type_') && batteries.length === 0) {
			const batt = tag.slice(13); // "battery type_21700" → "21700"
			const battMap: Record<string, string> = {
				'21700': '21700', '18650': '18650', '18350': '18350', '16340': '16340',
				'14500': '14500', 'cr123a': 'CR123A', 'cr123': 'CR123A', '26650': '26650',
				'26800': '26800', 'aa': 'AA', 'aaa': 'AAA',
			};
			const mapped = battMap[batt.toLowerCase()];
			if (mapped && !batteries.includes(mapped)) batteries.push(mapped);
		}
		if (tag.startsWith('waterproof level_') && environment.length === 0) {
			const wp = tag.slice(17); // "waterproof level_ipx8" → "ipx8"
			const ipM = wp.match(/ip[x]?(\d{1,2})/i);
			if (ipM) {
				const rating = ipM[1].length === 1 ? `IPX${ipM[1]}` : `IP${ipM[1]}`;
				if (!environment.includes(rating)) environment.push(rating);
			}
		}
		if (tag.startsWith('body material_') && !specs.materials?.length) {
			const mat = tag.slice(14).toLowerCase();
			const parsedMats: string[] = [];
			if (/aluminum|aluminium/.test(mat)) parsedMats.push('aluminum');
			else if (mat === 'titanium') parsedMats.push('titanium');
			else if (mat === 'copper') parsedMats.push('copper');
			else if (mat === 'brass') parsedMats.push('brass');
			else if (/stainless/.test(mat)) parsedMats.push('stainless steel');
			else if (/polymer|plastic|polycarbonate/.test(mat)) parsedMats.push('polymer');
			if (parsedMats.length > 0) specs.materials = parsedMats;
		}
	}

	// === Ledlenser encoded tags: max-light-output-lumens-*, beam-distance-m-*, weight-g-* ===
	for (const tag of tags) {
		const llLumens = tag.match(/^max-light-output-lumens-(\d+)$/);
		if (llLumens && !specs.lumens?.length) {
			const val = parseInt(llLumens[1], 10);
			if (val > 0 && val < 1_000_000) specs.lumens = [val];
		}
		const llThrow = tag.match(/^beam-distance-m-(\d+)$/);
		if (llThrow && !specs.throw_m) {
			specs.throw_m = parseInt(llThrow[1], 10);
		}
		const llWeight = tag.match(/^weight-g-(\d+)$/);
		if (llWeight && !specs.weight_g) {
			specs.weight_g = parseFloat(llWeight[1]);
		}
		const llRuntime = tag.match(/^burn-time-h-(\d+)$/);
		if (llRuntime && !specs.runtime_hours?.length) {
			specs.runtime_hours = [parseFloat(llRuntime[1])];
		}
		const llIp = tag.match(/^protection-class-(ip\w+)$/i);
		if (llIp) {
			const rating = llIp[1].toUpperCase();
			if (!environment.includes(rating)) environment.push(rating);
		}
	}

	// === Plain tag matching for material/LED (non-prefixed tags, e.g. Loop Gear) ===
	if (!specs.materials?.length) {
		const matTagMap: Record<string, string> = {
			'titanium': 'titanium', 'aluminum': 'aluminum', 'aluminium': 'aluminum',
			'copper': 'copper', 'brass': 'brass', 'stainless steel': 'stainless steel',
			'stainless': 'stainless steel', 'polymer': 'polymer', 'polycarbonate': 'polycarbonate',
			'titanium damascus': 'titanium', 'zirconium damascus': 'zirconium',
			'damascus': 'damascus steel', 'super conductor': 'copper',
		};
		for (const tag of tags) {
			const mapped = matTagMap[tag];
			if (mapped) { specs.materials = [mapped]; break; }
		}
	}
	if (!specs.leds?.length) {
		const ledTagPatterns: [RegExp, string][] = [
			[/^nichia\s*519a$/i, '519A'], [/^nichia\s*219[bcf]$/i, 'Nichia'],
			[/^sst[\s-]?20$/i, 'SST-20'], [/^sst[\s-]?40$/i, 'SST-40'],
			[/^sft[\s-]?40$/i, 'SFT-40'], [/^sft[\s-]?70$/i, 'SFT-70'],
			[/^xhp[\s-]?50/i, 'XHP50'], [/^xhp[\s-]?70/i, 'XHP70'],
			[/^cob$/i, 'COB'], [/^lep$/i, 'LEP'],
		];
		for (const tag of tags) {
			for (const [re, name] of ledTagPatterns) {
				if (re.test(tag)) { specs.leds = [name]; break; }
			}
			if (specs.leds?.length) break;
		}
	}

	// === Emitter variant parsing (e.g. Fireflies: "FFL5009R 5000K CRI95 2200lm 220m") ===
	if (emitterSpecOption) {
		const emitterOption = product.options.find((o) => o.name === emitterSpecOption);
		if (emitterOption) {
			const variantLeds: string[] = [];
			const variantLumens: number[] = [];
			let maxThrow = 0;
			let bestCri: number | undefined;
			const ccts: number[] = [];

			for (const val of emitterOption.values) {
				// Parse formats like:
				//   "FFL5009R 5000K CRI95 2200lm 220m"
				//   "21x Nichia E21A 4500K R9080 6000LM"
				//   "Luminous SFT70 6500K 2600lm 300m"
				const cleaned = val.trim();
				if (!cleaned) continue;

				// Extract LED name — everything before the first number followed by K
				const ledMatch = cleaned.match(/^(?:\d+x\s+)?(.+?)\s+\d{4,5}K/i);
				if (ledMatch) {
					const ledName = ledMatch[1].trim();
					if (ledName && !variantLeds.includes(ledName)) variantLeds.push(ledName);
				}

				// Extract CCT
				const cctMatch = cleaned.match(/(\d{4,5})K/);
				if (cctMatch) {
					const cct = parseInt(cctMatch[1], 10);
					if (cct >= 1800 && cct <= 10000 && !ccts.includes(cct)) ccts.push(cct);
				}

				// Extract CRI
				const criMatch = cleaned.match(/CRI(\d+)|R(\d+)/i);
				if (criMatch) {
					const cri = parseInt(criMatch[1] ?? criMatch[2], 10);
					if (cri >= 50 && cri <= 100 && (!bestCri || cri > bestCri)) bestCri = cri;
				}

				// Extract lumens
				const lmMatch = cleaned.match(/(\d+)\s*l[mM]/);
				if (lmMatch) {
					const lm = parseInt(lmMatch[1], 10);
					if (lm > 0 && lm < 1_000_000 && !variantLumens.includes(lm)) variantLumens.push(lm);
				}

				// Extract throw
				const throwMatch = cleaned.match(/(\d+)\s*m\s*$/);
				if (throwMatch) {
					const t = parseInt(throwMatch[1], 10);
					if (t > maxThrow && t < 10000) maxThrow = t;
				}
			}

			// Merge variant data (supplement, don't overwrite)
			if (variantLeds.length > 0 && !specs.leds?.length) specs.leds = variantLeds;
			if (variantLumens.length > 0 && !specs.lumens?.length) specs.lumens = variantLumens.sort((a, b) => b - a);
			if (maxThrow > 0 && !specs.throw_m) specs.throw_m = maxThrow;
			if (bestCri && !specs.cri) specs.cri = bestCri;
		}
	}

	// Resolve final weight — prefer variant grams, fall back to parsed spec (including Ledlenser tags)
	const finalWeight = weight_g ?? specs.weight_g;

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
				efficacy: specs.efficacy,
				cri: specs.cri,
				cct: specs.cct,
				runtime_hours: specs.runtime_hours ?? [],
			},
			measured: {},
		},
		battery: [...new Set(batteries)],
		wh: specs.wh,
		charging: [...new Set(charging)],
		modes: specs.modes ?? [],
		levels: specs.levels,
		blink: specs.blink ?? [],
		length_mm: specs.length_mm,
		bezel_mm: specs.bezel_mm,
		body_mm: specs.body_mm,
		weight_g: finalWeight,
		material: [...new Set(specs.materials ?? [])],
		color: [...new Set(colors)],
		impact: specs.impact ?? [],
		environment: [...new Set(environment)],
		switch: [...new Set(switches)],
		features: [...new Set(features)],
		price_usd: price,
		prices: [],
		purchase_urls: [`${storeUrl}/products/${product.handle}`],
		info_urls: [`${storeUrl}/products/${product.handle}`],
		image_urls: imageUrls,
		review_refs: [],
		sources: [],
		updated_at: new Date().toISOString(),
	};
}

/** Parse specs from Shopify body_html text + Fenix-style cus-lqd-specs */
interface ParsedShopifySpecs {
	lumens?: number[];
	intensity_cd?: number;
	throw_m?: number;
	beam_angle?: number;
	efficacy?: number;
	cri?: number;
	cct?: number;
	runtime_hours?: number[];
	wh?: number;
	batteries?: string[];
	leds?: string[];
	ledColors?: string[];
	charging?: string[];
	modes?: string[];
	levels?: number;
	blink?: string[];
	length_mm?: number;
	bezel_mm?: number;
	body_mm?: number;
	weight_g?: number;
	materials?: string[];
	impact?: string[];
	environment?: string[];
	switches?: string[];
	features?: string[];
}

function parseShopifySpecs(text: string, _tags: string[]): ParsedShopifySpecs {
	const specs: ParsedShopifySpecs = {};

	// Lumens
	const lumens: number[] = [];
	const lumensRe = /(\d[\d,]*)\s*(?:lumens?|lm)\b/gi;
	let m;
	while ((m = lumensRe.exec(text)) !== null) {
		const val = parseInt(m[1].replace(/,/g, ''), 10);
		if (val > 0 && val < 1_000_000 && !lumens.includes(val)) lumens.push(val);
	}
	if (lumens.length > 0) specs.lumens = lumens.sort((a, b) => b - a);

	// Throw/beam distance — try labeled patterns first to avoid false positives
	// Priority 1: labeled "throw|beam distance: NNNm" format
	const throwLabeled = text.match(/(?:throw|beam\s*distance|peak\s*beam\s*distance|max(?:imum)?\s*(?:beam\s*)?distance)[:\s]*(\d[\d,]*)\s*m(?:eters?)?\b/i);
	if (throwLabeled) specs.throw_m = parseInt(throwLabeled[1].replace(/,/g, ''), 10);
	else {
		// Priority 2: "NNN feet (MMM meters)" or "NNN ft. (MMM m)" compound format
		const compound = text.match(/(\d[\d,]*)\s*(?:feet|ft\.?)\s*\(\s*(\d[\d,]*)\s*m(?:eters?)?\s*\)/i);
		if (compound) specs.throw_m = parseInt(compound[2].replace(/,/g, ''), 10);
		else {
			// Priority 3: reverse "NNNm throw" or "NNN meters beam"
			const reverseThrow = text.match(/(\d[\d,]*)[\s-]*m(?:eters?)?\s*(?:throw|beam\s*distance|beam)(?!Ah)\b/i);
			if (reverseThrow) specs.throw_m = parseInt(reverseThrow[1].replace(/,/g, ''), 10);
			else {
				// Priority 4: yards with conversion
				const yardsMatch = text.match(/(?:throw|beam\s*distance|peak\s*beam\s*distance)[:\s]*(\d[\d,]*)\s*(?:yards?|yds?)\b/i);
				if (yardsMatch) specs.throw_m = Math.round(parseInt(yardsMatch[1].replace(/,/g, ''), 10) * 0.9144);
			}
		}
	}

	// Intensity
	const cdMatch = text.match(/(\d[\d,]*)\s*(?:cd|candela)\b/i);
	if (cdMatch) specs.intensity_cd = parseInt(cdMatch[1].replace(/,/g, ''), 10);

	// CRI
	const criMatch = text.match(/CRI[:\s>]*(\d+)/i);
	if (criMatch) {
		const cri = parseInt(criMatch[1], 10);
		if (cri >= 50 && cri <= 100) specs.cri = cri;
	}

	// CCT
	const cctMatch = text.match(/(\d{4,5})\s*K\b/);
	if (cctMatch) {
		const cct = parseInt(cctMatch[1], 10);
		if (cct >= 1800 && cct <= 10000) specs.cct = cct;
	}

	// Runtime — hours and days (converted to hours)
	const runtimes: number[] = [];
	const runtimeRe = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/gi;
	while ((m = runtimeRe.exec(text)) !== null) {
		const val = parseFloat(m[1]);
		if (val > 0 && val < 10000 && !runtimes.includes(val)) runtimes.push(val);
	}
	// Also capture "NN days" runtime (convert to hours)
	const dayRe = /(\d+(?:\.\d+)?)\s*days?\b/gi;
	while ((m = dayRe.exec(text)) !== null) {
		const val = Math.round(parseFloat(m[1]) * 24 * 100) / 100;
		if (val > 0 && val < 100000 && !runtimes.includes(val)) runtimes.push(val);
	}
	if (runtimes.length > 0) specs.runtime_hours = runtimes;

	// Modes count
	const modesMatch = text.match(/(\d+)\s*(?:brightness\s+)?(?:mode|level|setting)s?/i);
	if (modesMatch) specs.levels = parseInt(modesMatch[1], 10);

	// Length (mm) — parse multiple formats
	const sizeMatch = text.match(/length[:\s]*(\d+(?:\.\d+)?)["\s]*(?:inches?|in\.?)?\s*\(?\s*(\d+(?:\.\d+)?)\s*mm\)?/i);
	if (sizeMatch) specs.length_mm = parseFloat(sizeMatch[2]);
	else {
		const mmOnly = text.match(/(?:length|overall\s*length)[:\s]*(\d+(?:\.\d+)?)\s*mm/i);
		if (mmOnly) specs.length_mm = parseFloat(mmOnly[1]);
		else {
			// Reversed format: "114mm(length)" or "72.6mm (length)"
			const reversedMm = text.match(/(\d+(?:\.\d+)?)\s*mm\s*\(?length\)?/i);
			if (reversedMm) specs.length_mm = parseFloat(reversedMm[1]);
			else {
				// Centimeters: "Length: 4.25 in. (10.8 cm)" or "10.8 centimeters"
				const cmMatch = text.match(/length[:\s]*(?:\d+(?:\.\d+)?\s*(?:in\.?|inches?|")?\s*\(?\s*)?(\d+(?:\.\d+)?)\s*(?:cm|centimeters?)\)?/i);
				if (cmMatch) specs.length_mm = Math.round(parseFloat(cmMatch[1]) * 10);
				else {
					// Inches-only: "Length: 5.74 inches" or "Length: 5.74""
					const inOnly = text.match(/length[:\s]*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")\b/i);
					if (inOnly) specs.length_mm = Math.round(parseFloat(inOnly[1]) * 25.4);
				}
			}
		}
	}

	// Head/bezel diameter
	const headMatch = text.match(/head[:\s]*(\d+(?:\.\d+)?)["\s]*(?:inches?|in\.?)?\s*\(?\s*(\d+(?:\.\d+)?)\s*mm\)?/i);
	if (headMatch) specs.bezel_mm = parseFloat(headMatch[2]);

	// Body diameter
	const bodyMatch = text.match(/body[:\s]*(\d+(?:\.\d+)?)["\s]*(?:inches?|in\.?)?\s*\(?\s*(\d+(?:\.\d+)?)\s*mm\)?/i);
	if (bodyMatch) specs.body_mm = parseFloat(bodyMatch[2]);

	// Weight — parse multiple formats
	const weightMatch = text.match(/weight[:\s]*(\d+(?:\.\d+)?)\s*(?:oz\.?|ounces?)?\s*\(?\s*(\d+(?:\.\d+)?)\s*g(?:rams?)?\s*\)?/i);
	if (weightMatch) specs.weight_g = parseFloat(weightMatch[2]);
	else {
		const gOnly = text.match(/weight[:\s]*(\d+(?:\.\d+)?)\s*g(?:rams?)?/i);
		if (gOnly) specs.weight_g = parseFloat(gOnly[1]);
		else {
			// Slash format: "1.64 oz. / 46.9 g"
			const slashW = text.match(/(\d+(?:\.\d+)?)\s*(?:oz\.?|ounces?)\s*[/|]\s*(\d+(?:\.\d+)?)\s*g\b/i);
			if (slashW) specs.weight_g = parseFloat(slashW[2]);
			else {
				// Oz-only with weight label
				const ozOnly = text.match(/weight[:\s]*(\d+(?:\.\d+)?)\s*(?:oz\.?|ounces?)\b/i);
				if (ozOnly) specs.weight_g = Math.round(parseFloat(ozOnly[1]) * 28.35);
			}
		}
	}

	// LED type from body text
	const leds: string[] = [];
	const ledPatterns: [RegExp, string][] = [
		[/\bSST[\s-]?20\b/i, 'SST-20'], [/\bSST[\s-]?40\b/i, 'SST-40'],
		[/\bSST[\s-]?70\b/i, 'SST-70'], [/\bSFT[\s-]?40\b/i, 'SFT-40'],
		[/\bSFT[\s-]?70\b/i, 'SFT-70'],
		[/\bXHP[\s-]?50(?:\.2|\.3)?\b/i, 'XHP50'], [/\bXHP[\s-]?70(?:\.2|\.3)?\b/i, 'XHP70'],
		[/\bXM[\s-]?L2?\b/i, 'XM-L2'], [/\bXP[\s-]?L\s*(?:HI|HD|V6)?\b/i, 'XP-L'],
		[/\bXP[\s-]?G[23]?\b/i, 'XP-G'], [/\bXP[\s-]?E2?\b/i, 'XP-E'],
		[/\b519A\b/, '519A'], [/\b219[BCF]\b/, '219B'],
		[/\bLH351D\b/i, 'LH351D'], [/\bE21A\b/, 'E21A'],
		[/\bLuminus\s+SFT[\s-]?70\b/i, 'Luminus SFT70'],
		[/\bLuminus\s+SFT[\s-]?40\b/i, 'Luminus SFT40'],
		[/\bLuminus\s+SST[\s-]?40\b/i, 'Luminus SST40'],
		[/\bCree\s+XHP/i, 'Cree XHP'],
		[/\bOsram\b.*\bW[12]\b|\bW[12]\b.*\bOsram\b/i, 'Osram'],
		[/\bCOB\s*LED\b/i, 'COB'], [/\bLEP\b/, 'LEP'],
		[/\b319A\b/, '319A'], [/\bSST[\s-]?10\b/i, 'SST-10'],
		[/\bSFT[\s-]?42\w?\b/i, 'SFT-42'], [/\b7070\s*LED\b/i, '7070'],
		[/\bLUXEON\s+TX\b/i, 'Luxeon TX'], [/\bSFN60\b/i, 'SFN60'],
		[/\bM515S\b/i, 'M515S'],
	];
	for (const [re, name] of ledPatterns) {
		if (re.test(text) && !leds.includes(name)) leds.push(name);
	}
	if (leds.length > 0) specs.leds = leds;

	// LED color
	const ledColors: string[] = [];
	if (/neutral\s*white/i.test(text)) ledColors.push('neutral white');
	if (/cool\s*white/i.test(text)) ledColors.push('cool white');
	if (/warm\s*white/i.test(text)) ledColors.push('warm white');
	if (ledColors.length > 0) specs.ledColors = ledColors;

	// Battery types from body text
	const batteries: string[] = [];
	const batteryPatterns: [RegExp, string][] = [
		[/\b21700[iI]?\b/, '21700'], [/\b18650[iI]?\b/, '18650'], [/\b18350\b/, '18350'],
		[/\b16340\b/, '16340'], [/\b14500\b/, '14500'], [/\bCR123A?\b/i, 'CR123A'],
		[/\b26650\b/, '26650'], [/\bAA\b(?!\w)/, 'AA'], [/\bAAA\b/, 'AAA'],
	];
	for (const [re, name] of batteryPatterns) {
		if (re.test(text) && !batteries.includes(name)) batteries.push(name);
	}
	if (batteries.length > 0) specs.batteries = batteries;

	// Charging
	const charging: string[] = [];
	if (/usb[\s-]?c\b/i.test(text)) charging.push('USB-C');
	if (/micro[\s-]?usb/i.test(text)) charging.push('Micro-USB');
	if (/magnetic\s*charg/i.test(text)) charging.push('magnetic');
	if (charging.length > 0) specs.charging = charging;

	// Materials from body text
	const materials: string[] = [];
	if (/\baluminum\b|\baluminium\b|A6061/i.test(text)) materials.push('aluminum');
	if (/\btitanium\b/i.test(text)) materials.push('titanium');
	if (/\bcopper\b/i.test(text)) materials.push('copper');
	if (/\bbrass\b/i.test(text)) materials.push('brass');
	if (/\bstainless\b/i.test(text)) materials.push('stainless steel');
	if (/\bpolymer\b|\bplastic\b|\bnylon\b|\bpolycarbonate\b/i.test(text)) materials.push('polymer');
	if (materials.length > 0) specs.materials = materials;

	// Switches from body text
	const switches: string[] = [];
	if (/tail[\s-]?switch|tail[\s-]?cap|tail\s*click/i.test(text)) switches.push('tail');
	if (/side[\s-]?switch|side\s*button/i.test(text)) switches.push('side');
	if (/dual[\s-]?switch/i.test(text)) switches.push('dual');
	if (/rotary\b|twist/i.test(text)) switches.push('rotary');
	if (switches.length > 0) specs.switches = switches;

	// Features from body text
	const features: string[] = [];
	if (/\bclip\b/i.test(text) && !/video\s*clip/i.test(text)) features.push('clip');
	if (/\bmagnet(?:ic)?\b/i.test(text) && !/magnetic\s*charg/i.test(text)) features.push('magnet');
	if (/\blanyard\b/i.test(text)) features.push('lanyard');
	if (/\blockout\b/i.test(text)) features.push('lockout');
	if (/\bmemory\b/i.test(text) && !/card|flash\s*memory|storage/i.test(text)) features.push('mode memory');
	if (/\banduril\b/i.test(text)) features.push('Anduril');
	if (/\bpower\s*bank\b/i.test(text)) features.push('power bank');
	if (/\banti[\s-]?roll\b/i.test(text)) features.push('anti-roll');
	if (/\bthermal\s*(?:regulation|management|step)/i.test(text)) features.push('thermal stepdown');
	if (features.length > 0) specs.features = features;

	// IP rating
	const environment: string[] = [];
	const ipMatch = text.match(/\bIP[X]?(\d{1,2})\b/i);
	if (ipMatch) {
		const rating = ipMatch[1].length === 1 ? `IPX${ipMatch[1]}` : `IP${ipMatch[1]}`;
		environment.push(rating);
	}
	if (environment.length > 0) specs.environment = environment;

	// Blink modes
	const blink: string[] = [];
	if (/\bstrobe\b/i.test(text)) blink.push('strobe');
	if (/\bsos\b/i.test(text)) blink.push('SOS');
	if (/\bbeacon\b/i.test(text)) blink.push('beacon');
	if (blink.length > 0) specs.blink = blink;

	// Impact resistance
	const impact: string[] = [];
	const impactMatch = text.match(/(\d+(?:\.\d+)?)[\s-]*m(?:eter)?s?\s*(?:impact|drop)/i);
	if (impactMatch) impact.push(`${impactMatch[1]}m`);
	if (impact.length > 0) specs.impact = impact;

	return specs;
}

/** Normalize color variant names to canonical form */
function normalizeColor(raw: string): string | null {
	const lower = raw.toLowerCase().trim();
	// Skip non-color options like "With Battery" or "Bundle"
	if (/bundle|kit|set|pack|combo|gift|battery|charger|holster|case/i.test(lower)) return null;

	// Map common variants to canonical names
	const colorMap: Record<string, string> = {
		'black': 'black', 'blk': 'black',
		'white': 'white',
		'desert tan': 'desert tan', 'tan': 'tan', 'coyote': 'coyote',
		'olive': 'olive', 'od green': 'OD green', 'green': 'green',
		'orange': 'orange',
		'red': 'red', 'wine red': 'wine red', 'crimson': 'crimson',
		'blue': 'blue', 'midnight blue': 'midnight blue', 'navy': 'navy',
		'pink': 'pink', 'rose': 'pink', 'rose gold': 'rose gold',
		'purple': 'purple', 'violet': 'violet',
		'titanium': 'titanium', 'ti': 'titanium',
		'copper': 'copper', 'cu': 'copper',
		'brass': 'brass',
		'silver': 'silver',
		'gray': 'gray', 'grey': 'gray', 'urban gray': 'urban gray', 'gunmetal': 'gunmetal',
		'camo': 'camo', 'digital camo': 'digital camo',
		'gold': 'gold', 'champagne': 'champagne',
		'yellow': 'yellow',
		'teal': 'teal', 'aqua': 'aqua', 'turquoise': 'turquoise',
		'coral': 'coral',
		'lavender': 'lavender', 'mint': 'mint',
		'burgundy': 'burgundy', 'maroon': 'maroon',
	};

	// Try exact match first
	if (colorMap[lower]) return colorMap[lower];

	// Try substring match
	for (const [key, value] of Object.entries(colorMap)) {
		if (lower.includes(key)) return value;
	}

	// Return cleaned-up original if not mapped (might be a valid color we don't know)
	if (lower.length > 2 && lower.length < 30) return lower;
	return null;
}

/**
 * Crawl a single Shopify store for all flashlight products.
 */
export async function crawlShopifyStore(store: ShopifyStore): Promise<{
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
		// Apply filter if configured
		if (store.isFlashlight && !store.isFlashlight(product)) {
			skipped++;
			continue;
		}

		const publicUrl = store.publicUrl ?? store.baseUrl;
		const entry = shopifyToEntry(product, store.brand, publicUrl, store.isRetailer, store.emitterSpecOption);
		if (entry) {
			try {
				upsertFlashlight(entry);
				addSource(entry.id, {
					source: `shopify:${store.isRetailer ? entry.brand : store.brand}`,
					url: `${publicUrl}/products/${product.handle}`,
					scraped_at: new Date().toISOString(),
					confidence: 0.9,
				});
				// Save body_html as raw spec text for AI parsing (especially useful for
				// JS-rendered stores like Pelican where detail scraper can't extract specs)
				const bodyText = product.body_html ? htmlToText(product.body_html) : '';
				if (bodyText.length > 50) {
					addRawSpecText(entry.id, `${publicUrl}/products/${product.handle}`, 'specs', bodyText);
				}
				saved++;
			} catch {
				// Skip entries that violate unique constraints (duplicate brand+model+led)
				skipped++;
			}
		} else {
			skipped++;
		}
	}

	return { total: products.length, saved, skipped };
}

/**
 * Crawl all configured Shopify stores.
 */
export async function crawlAllShopifyStores(): Promise<{
	totalSaved: number;
	byBrand: Record<string, number>;
}> {
	let totalSaved = 0;
	const byBrand: Record<string, number> = {};

	for (const store of SHOPIFY_STORES) {
		console.log(`\n--- ${store.brand} (Shopify) ---`);
		try {
			const result = await crawlShopifyStore(store);
			totalSaved += result.saved;
			byBrand[store.brand] = result.saved;
			console.log(`  Result: ${result.saved} saved, ${result.skipped} skipped`);
		} catch (err) {
			console.log(`  Error: ${(err as Error).message}`);
			byBrand[store.brand] = 0;
		}
		await Bun.sleep(2000); // Delay between stores
	}

	return { totalSaved, byBrand };
}
