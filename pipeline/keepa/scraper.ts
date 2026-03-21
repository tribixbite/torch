/**
 * Keepa ASIN discovery + product detail scraper.
 * Handles token budget (60/hr), batching, and extraction to canonical format.
 */
import { KeepaClient, type KeepaProduct } from './client.js';
import { generateId } from '../schema/canonical.js';
import type { FlashlightEntry } from '../schema/canonical.js';
import {
	upsertFlashlight,
	upsertDiscoveredAsin,
	markAsinScraped,
	getUnscrapedAsins,
	countDiscoveredAsins,
	addPrice,
	addSource,
	addRawSpecText,
} from '../store/db.js';
import { BRANDS, getBrandSearchTerms, type BrandConfig } from '../config/brands.js';
import { normalizeBrandName } from '../store/brand-aliases.js';

const BATCH_SIZE = 100; // Max per API call — cron handles pacing at 60 tokens/hr
const DETAIL_TOKEN_COST = 1; // per ASIN
const FINDER_TOKEN_COST = 11; // per finder query

/**
 * Phase 1: Discover ASINs for all configured brands via Product Finder.
 * Stores ASINs in discovered_asins table for incremental processing.
 */
export async function discoverAllBrands(client: KeepaClient): Promise<{
	totalDiscovered: number;
	byBrand: Record<string, number>;
}> {
	const byBrand: Record<string, number> = {};
	let totalDiscovered = 0;

	for (const brand of BRANDS) {
		const terms = getBrandSearchTerms(brand);
		let brandCount = 0;

		for (const term of terms) {
			console.log(`  Discovering: "${term}" ...`);
			try {
				const result = await client.findProducts({
					title: term,
					perPage: 10000,
					page: 0,
				});

				console.log(`    Found ${result.asins.length} ASINs (total: ${result.totalResults})`);

				for (const asin of result.asins) {
					upsertDiscoveredAsin(asin, brand.name);
					brandCount++;
				}
			} catch (err) {
				console.error(`    Error discovering "${term}":`, (err as Error).message);
			}
		}

		byBrand[brand.name] = brandCount;
		totalDiscovered += brandCount;
		console.log(`  ${brand.name}: ${brandCount} ASINs discovered`);
	}

	return { totalDiscovered, byBrand };
}

/**
 * Phase 2: Scrape product details for unscraped ASINs in batches.
 * Fetches from Keepa and converts to canonical FlashlightEntry.
 */
export async function scrapeUnscrapedAsins(
	client: KeepaClient,
	maxBatches = 1,
	brand?: string,
): Promise<{ scraped: number; errors: number }> {
	let scraped = 0;
	let errors = 0;

	for (let batch = 0; batch < maxBatches; batch++) {
		const unscraped = getUnscrapedAsins(brand, BATCH_SIZE);
		if (unscraped.length === 0) {
			console.log('  No more unscraped ASINs');
			break;
		}

		console.log(`  Batch ${batch + 1}: fetching ${unscraped.length} ASINs ...`);

		try {
			const asins = unscraped.map((u) => u.asin);
			const products = await client.getProducts(asins);

			console.log(`    Got ${products.length} products from Keepa`);

			for (const product of products) {
				try {
					const brand = findBrandForProduct(product, unscraped);
					const entry = keepaToCanonical(product, brand);
					if (entry) {
						upsertFlashlight(entry);

						// Store full Keepa JSON for future re-extraction
						// Strip csv arrays to save space (price history stored separately)
						const rawKeep = { ...product, csv: undefined };
						addRawSpecText(
							entry.id,
							`https://keepa.com/#!product/1-${product.asin}`,
							'keepa',
							JSON.stringify(rawKeep),
						);

						// Store full price history from CSV (not just current price)
						const amazonUrl = `https://www.amazon.com/dp/${product.asin}`;
						storePriceHistory(entry.id, product, amazonUrl);

						// Add Keepa as source
						addSource(entry.id, {
							source: 'keepa',
							url: `https://keepa.com/#!product/1-${product.asin}`,
							scraped_at: new Date().toISOString(),
							confidence: 0.7,
						});

						scraped++;
					}
					markAsinScraped(product.asin);
				} catch (err) {
					console.error(`    Error processing ${product.asin}:`, (err as Error).message);
					markAsinScraped(product.asin); // Don't retry failed items
					errors++;
				}
			}

			// Mark any ASINs not returned by Keepa as scraped (removed/invalid)
			const returnedAsins = new Set(products.map((p) => p.asin));
			for (const u of unscraped) {
				if (!returnedAsins.has(u.asin)) {
					markAsinScraped(u.asin);
				}
			}
		} catch (err) {
			console.error(`    Batch error:`, (err as Error).message);
			errors += unscraped.length;
		}
	}

	return { scraped, errors };
}

/**
 * Store full price history from Keepa CSV arrays.
 * CSV format: [keepaTime, price, keepaTime, price, ...] where price is in cents.
 * Keepa timestamp: (keepaTime + 21564000) * 60000 = Unix ms.
 * Stores Amazon (csv[0]), Buy Box (csv[18]), and 3P New (csv[1]) histories.
 */
function storePriceHistory(flashlightId: string, product: KeepaProduct, amazonUrl: string): void {
	const csv = product.csv;
	if (!csv) return;

	// Price source labels for each CSV index we care about
	const priceSources: [number, string][] = [
		[0, 'Amazon'],
		[18, 'Amazon Buy Box'],
		[1, 'Amazon 3P New'],
	];

	for (const [idx, retailer] of priceSources) {
		const series = csv[idx];
		if (!series || series.length < 2) continue;

		// Store just the most recent price point (avoid duplicating full history each run)
		// Full history is preserved in raw_spec_text as JSON
		const lastPrice = series[series.length - 1];
		if (lastPrice > 0) {
			const lastTime = series[series.length - 2];
			const unixMs = (lastTime + 21564000) * 60000;
			addPrice(flashlightId, {
				retailer,
				price: lastPrice / 100,
				currency: 'USD',
				url: amazonUrl,
				affiliate: false,
				last_checked: new Date(unixMs).toISOString(),
			});
		}
	}

	// Also store the full CSV price history as raw text for future analysis
	// Only the price-relevant indices, compacted
	const priceHistory: Record<string, [number, number][]> = {};
	for (const [idx, label] of priceSources) {
		const series = csv[idx];
		if (!series || series.length < 2) continue;
		const pairs: [number, number][] = [];
		for (let i = 0; i < series.length - 1; i += 2) {
			const price = series[i + 1];
			if (price > 0) {
				const unixMs = (series[i] + 21564000) * 60000;
				pairs.push([unixMs, price / 100]);
			}
		}
		if (pairs.length > 0) priceHistory[label] = pairs;
	}

	if (Object.keys(priceHistory).length > 0) {
		addRawSpecText(
			flashlightId,
			`https://www.amazon.com/dp/${product.asin}`,
			'price_history',
			JSON.stringify(priceHistory),
		);
	}
}

/**
 * Convert a Keepa product to our canonical FlashlightEntry.
 * Extracts structured data from Keepa's fields + parses description for specs.
 */
function keepaToCanonical(product: KeepaProduct, fallbackBrand: string): FlashlightEntry | null {
	const brand = normalizeBrandName(product.brand || fallbackBrand);
	const model = extractModel(product, brand);
	if (!model || !brand) return null;

	const id = generateId(brand, model);

	// Extract specs from description + features
	const specs = parseSpecsFromText(product);

	// Physical dimensions from Keepa (mm, grams)
	const length_mm = product.itemLength && product.itemLength > 0 ? product.itemLength / 10 : specs.length_mm;
	const weight_g = product.itemWeight && product.itemWeight > 0 ? product.itemWeight : specs.weight_g;

	// Colors from product color field + features
	const colors: string[] = [];
	if (product.color) colors.push(product.color);
	if (specs.colors.length > 0) colors.push(...specs.colors);

	// Materials — prefer materials[] array over deprecated material string
	const materials: string[] = [];
	if (product.materials?.length) {
		materials.push(...product.materials);
	} else if (product.material) {
		materials.push(product.material);
	}
	if (specs.materials.length > 0) materials.push(...specs.materials);

	// Image URLs
	const imageUrls = KeepaClient.extractImageUrls(product);

	// Price
	const price = KeepaClient.extractCurrentPrice(product);

	// Battery from features/description
	const batteries = specs.batteries.length > 0 ? specs.batteries : ['unknown'];

	// LED from features/description
	const leds = specs.leds.length > 0 ? specs.leds : ['unknown'];

	// Enrich features from Keepa-specific fields
	if (product.batteriesIncluded && !specs.features.includes('battery included')) {
		specs.features.push('battery included');
	}

	// Type classification — use specificUsesForProduct + itemTypeKeyword for better accuracy
	const types = classifyType(product);

	return {
		id,
		model,
		brand,
		type: types,
		led: leds,
		led_color: specs.ledColors,
		performance: {
			claimed: {
				lumens: specs.lumens,
				intensity_cd: specs.intensity_cd,
				throw_m: specs.throw_m,
				beam_angle: specs.beam_angle,
				runtime_hours: specs.runtime_hours,
			},
			measured: {},
		},
		battery: batteries,
		wh: specs.wh,
		charging: specs.charging,
		modes: specs.modes,
		levels: specs.levels,
		blink: specs.blink,
		length_mm,
		weight_g,
		material: [...new Set(materials)],
		color: [...new Set(colors)],
		impact: specs.impact,
		environment: specs.environment,
		switch: specs.switches,
		features: specs.features,
		price_usd: price,
		prices: [],
		purchase_urls: [`https://www.amazon.com/dp/${product.asin}`],
		info_urls: [],
		image_urls: imageUrls,
		review_refs: [],
		sources: [],
		asin: product.asin,
		ean: product.eanList?.[0],
		upc: product.upcList?.[0],
		updated_at: new Date().toISOString(),
		year: specs.year,
	};
}

/** Determine the best brand name for a product */
function findBrandForProduct(
	product: KeepaProduct,
	discovered: { asin: string; brand: string }[],
): string {
	if (product.brand) return product.brand;
	const found = discovered.find((d) => d.asin === product.asin);
	return found?.brand ?? 'Unknown';
}

/** Extract model name from title, removing brand prefix */
function extractModel(product: KeepaProduct, brand: string): string | null {
	const title = product.title;
	if (!title) return product.model || null;

	// Try to extract model from title by removing brand prefix
	let model = title;

	// Remove brand name (case-insensitive) from start
	const brandLower = brand.toLowerCase();
	const titleLower = title.toLowerCase();
	if (titleLower.startsWith(brandLower)) {
		model = title.slice(brand.length).trim();
	}

	// Remove common suffixes like "Flashlight", "Rechargeable", description text
	const stopWords = [
		' - ', ' — ', ' | ', ' with ', ' featuring ',
		' rechargeable flashlight', ' tactical flashlight',
		' led flashlight', ' flashlight', ' headlamp',
		' lantern', ' work light',
	];
	for (const stop of stopWords) {
		const idx = model.toLowerCase().indexOf(stop);
		if (idx > 3) { // Keep at least 3 chars of model name
			model = model.slice(0, idx);
		}
	}

	// Clean up
	model = model.replace(/^[\s,\-–]+/, '').replace(/[\s,\-–]+$/, '').trim();

	return model || product.model || null;
}

/** Classify flashlight type from title/category/uses */
function classifyType(product: KeepaProduct): string[] {
	const types: string[] = [];
	const text = `${product.title ?? ''} ${product.description ?? ''} ${(product.features ?? []).join(' ')} ${(product.specificUsesForProduct ?? []).join(' ')} ${product.itemTypeKeyword ?? ''} ${product.binding ?? ''}`.toLowerCase();

	if (text.includes('headlamp') || text.includes('head lamp') || text.includes('headlight')) types.push('headlamp');
	if (text.includes('lantern') || text.includes('camping light')) types.push('lantern');
	if (text.includes('penlight') || text.includes('pen light')) types.push('penlight');
	if (text.includes('keychain') || text.includes('keylight') || text.includes('key light')) types.push('keychain');
	if (text.includes('weapon light') || text.includes('weaponlight') || text.includes('gun light') || text.includes('pistol light')) types.push('weapon');
	if (text.includes('dive') || text.includes('diving') || text.includes('underwater')) types.push('dive');
	if (text.includes('bike') || text.includes('bicycle')) types.push('bike');
	if (text.includes('right angle') || text.includes('right-angle')) types.push('right-angle');

	if (types.length === 0) types.push('flashlight');
	return types;
}

/** Parsed spec results from text analysis */
interface ParsedSpecs {
	lumens: number[];
	intensity_cd?: number;
	throw_m?: number;
	beam_angle?: number;
	runtime_hours: number[];
	wh?: number;
	batteries: string[];
	leds: string[];
	ledColors: string[];
	charging: string[];
	modes: string[];
	levels?: number;
	blink: string[];
	length_mm?: number;
	weight_g?: number;
	materials: string[];
	colors: string[];
	impact: string[];
	environment: string[];
	switches: string[];
	features: string[];
	year?: number;
}

/**
 * Parse specs from Keepa product text fields (title, description, features).
 * This is a rule-based extractor — LLM enrichment happens in Phase 2.5.
 */
function parseSpecsFromText(product: KeepaProduct): ParsedSpecs {
	const allText = [
		product.title ?? '',
		product.description ?? '',
		product.shortDescription ?? '',
		...(product.features ?? []),
		...(product.specialFeatures ?? []),
		...(product.specificUsesForProduct ?? []),
		product.includedComponents ?? '',
		product.recommendedUsesForProduct ?? '',
		product.productBenefit ?? '',
		product.itemTypeKeyword ?? '',
	].join('\n');

	const textLower = allText.toLowerCase();

	return {
		lumens: extractLumens(allText),
		intensity_cd: extractNumber(allText, /(\d[\d,]*)\s*(?:cd|candela)/i),
		throw_m: extractNumber(allText, /(\d[\d,]*)\s*(?:m(?:eter)?s?\b|metre)/i) ??
			extractNumber(allText, /throw[:\s]*(\d[\d,]*)\s*m/i),
		beam_angle: extractNumber(allText, /(\d+(?:\.\d+)?)\s*°?\s*(?:beam|flood)/i),
		runtime_hours: extractRuntimes(allText),
		wh: extractNumber(allText, /(\d+(?:\.\d+)?)\s*wh/i),
		batteries: extractBatteries(textLower),
		leds: extractLeds(allText),
		ledColors: extractLedColors(textLower),
		charging: extractCharging(textLower),
		modes: extractModes(textLower),
		levels: extractNumber(allText, /(\d+)\s*(?:brightness\s+)?(?:modes?|levels?|settings?)/i),
		blink: extractBlink(textLower),
		length_mm: extractNumber(allText, /(\d+(?:\.\d+)?)\s*mm\b/i) ??
			extractLengthFromInches(allText),
		weight_g: extractWeightFromOz(allText),
		materials: extractMaterials(textLower),
		colors: extractColors(textLower),
		impact: extractImpact(textLower),
		environment: extractEnvironment(textLower),
		switches: extractSwitches(textLower),
		features: extractFeatures(textLower),
		year: extractYear(allText),
	};
}

// --- Regex-based extractors ---

function extractLumens(text: string): number[] {
	const lumens: number[] = [];
	const re = /(\d[\d,]*)\s*(?:lumens?|lm)\b/gi;
	let match;
	while ((match = re.exec(text)) !== null) {
		const val = parseInt(match[1].replace(/,/g, ''), 10);
		if (val > 0 && val < 1_000_000 && !lumens.includes(val)) {
			lumens.push(val);
		}
	}
	return lumens.sort((a, b) => b - a); // Highest first
}

function extractRuntimes(text: string): number[] {
	const runtimes: number[] = [];
	const re = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/gi;
	let match;
	while ((match = re.exec(text)) !== null) {
		const val = parseFloat(match[1]);
		if (val > 0 && val < 10000 && !runtimes.includes(val)) {
			runtimes.push(val);
		}
	}
	return runtimes;
}

function extractBatteries(text: string): string[] {
	const batteries: string[] = [];
	const patterns: [RegExp, string][] = [
		[/\b21700\b/, '21700'],
		[/\b18650\b/, '18650'],
		[/\b18350\b/, '18350'],
		[/\b16340\b/, '16340'],
		[/\b14500\b/, '14500'],
		[/\bcr123a?\b/i, 'CR123A'],
		[/\baa\b(?!\w)/, 'AA'],
		[/\baaa\b/, 'AAA'],
		[/\b26650\b/, '26650'],
		[/\b26800\b/, '26800'],
		[/\b4680\b/, '4680'],
		[/built[\s-]?in\s+(?:rechargeable\s+)?(?:li[\s-]?ion\s+)?batter/i, 'built-in'],
	];
	for (const [re, name] of patterns) {
		if (re.test(text)) batteries.push(name);
	}
	return batteries;
}

function extractLeds(text: string): string[] {
	const leds: string[] = [];
	const patterns: [RegExp, string][] = [
		[/\bSST[\s-]?20\b/i, 'SST-20'],
		[/\bSST[\s-]?40\b/i, 'SST-40'],
		[/\bSST[\s-]?70\b/i, 'SST-70'],
		[/\bSFT[\s-]?40\b/i, 'SFT-40'],
		[/\bSFT[\s-]?70\b/i, 'SFT-70'],
		[/\bXHP[\s-]?50(?:\.2|\.3)?\b/i, 'XHP50'],
		[/\bXHP[\s-]?70(?:\.2|\.3)?\b/i, 'XHP70'],
		[/\bXML[\s-]?2\b|\bXM[\s-]?L2\b/i, 'XM-L2'],
		[/\bXPL[\s-]?(?:HI|HD|V6)?\b/i, 'XP-L'],
		[/\bXPG[\s-]?(?:2|3)?\b/i, 'XP-G'],
		[/\bXPE[\s-]?(?:2)?\b/i, 'XP-E'],
		[/\bNichia\s+(?:519A|219[BCF]?|E21A)/i, 'Nichia 519A'],
		[/\b519A\b/i, '519A'],
		[/\b219[BCF]\b/i, '219B'],
		[/\bSamsung\s+LH351D\b/i, 'LH351D'],
		[/\bLH351D\b/i, 'LH351D'],
		[/\bOsram\s+(?:W1|W2|CSLNM1|CULNM1)/i, 'Osram'],
		[/\bW1\b.*\bOsram\b|\bOsram\b.*\bW1\b/i, 'Osram W1'],
		[/\bW2\b.*\bOsram\b|\bOsram\b.*\bW2\b/i, 'Osram W2'],
		[/\bCree\s+(?:XHP|XPL|XPG|XPE|XM[\s-]?L)/i, 'Cree'],
		[/\bLuminus\s+(?:SFT|SST|SBT)/i, 'Luminus'],
	];
	for (const [re, name] of patterns) {
		if (re.test(text)) {
			if (!leds.includes(name)) leds.push(name);
		}
	}
	return leds;
}

function extractLedColors(text: string): string[] {
	const colors: string[] = [];
	if (/\bneutral\s*white\b/.test(text)) colors.push('neutral white');
	if (/\bcool\s*white\b/.test(text)) colors.push('cool white');
	if (/\bwarm\s*white\b/.test(text)) colors.push('warm white');
	if (/\bred\b.*\bled\b|\bred\s*light\b/.test(text)) colors.push('red');
	if (/\bgreen\b.*\bled\b|\bgreen\s*light\b/.test(text)) colors.push('green');
	if (/\bblue\b.*\bled\b|\bblue\s*light\b/.test(text)) colors.push('blue');
	if (/\buv\b|\bultra[\s-]?violet\b/.test(text)) colors.push('UV');
	return colors;
}

function extractCharging(text: string): string[] {
	const charging: string[] = [];
	if (/\busb[\s-]?c\b/.test(text)) charging.push('USB-C');
	if (/\busb[\s-]?a\b/.test(text)) charging.push('USB-A');
	if (/\bmicro[\s-]?usb\b/.test(text)) charging.push('Micro-USB');
	if (/\bmagnetic\s*charg/i.test(text)) charging.push('magnetic');
	if (/\bwireless\s*charg/i.test(text)) charging.push('Qi');
	if (/\brechargeable\b/.test(text) && charging.length === 0) charging.push('USB');
	return charging;
}

function extractModes(text: string): string[] {
	const modes: string[] = [];
	if (/\bturbo\b/.test(text)) modes.push('turbo');
	if (/\bhigh\b/.test(text) && !/\bhigh\s*(?:quality|performance|capacity|drain|power|cri|voltage)\b/.test(text)) modes.push('high');
	if (/\bmedium\b|\bmid\b/.test(text)) modes.push('medium');
	if (/\blow\b/.test(text) && !/\blow\s*(?:battery|voltage|profile)\b/.test(text)) modes.push('low');
	if (/\bmoonlight\b|\bfirefly\b|\bultra[\s-]?low\b/.test(text)) modes.push('moonlight');
	if (/\bstrobe\b/.test(text)) modes.push('strobe');
	if (/\bsos\b/.test(text)) modes.push('SOS');
	if (/\bbeacon\b/.test(text)) modes.push('beacon');
	return modes;
}

function extractBlink(text: string): string[] {
	const blink: string[] = [];
	if (/\bstrobe\b/.test(text)) blink.push('strobe');
	if (/\bsos\b/.test(text)) blink.push('SOS');
	if (/\bbeacon\b/.test(text)) blink.push('beacon');
	return blink;
}

function extractMaterials(text: string): string[] {
	const materials: string[] = [];
	if (/\baluminum\b|\baluminium\b/.test(text)) materials.push('aluminum');
	if (/\btitanium\b/.test(text)) materials.push('titanium');
	if (/\bcopper\b/.test(text)) materials.push('copper');
	if (/\bbrass\b/.test(text)) materials.push('brass');
	if (/\bstainless\b/.test(text)) materials.push('stainless steel');
	if (/\bpolymer\b|\bplastic\b|\bnylon\b/.test(text)) materials.push('polymer');
	if (/\bpolycarbonate\b/.test(text)) materials.push('polycarbonate');
	return materials;
}

function extractColors(text: string): string[] {
	const colors: string[] = [];
	const colorMap: Record<string, string> = {
		'black': 'black', 'desert tan': 'desert tan', 'olive': 'olive',
		'od green': 'OD green', 'orange': 'orange', 'red': 'red',
		'blue': 'blue', 'pink': 'pink', 'purple': 'purple',
		'titanium': 'titanium', 'copper': 'copper', 'brass': 'brass',
		'silver': 'silver', 'white': 'white', 'camo': 'camo',
		'grey': 'grey', 'gray': 'gray', 'green': 'green',
		'rose gold': 'rose gold', 'gold': 'gold', 'yellow': 'yellow',
		'midnight blue': 'midnight blue', 'gunmetal': 'gunmetal',
		'wine red': 'wine red', 'coral': 'coral', 'teal': 'teal',
		'aqua': 'aqua', 'champagne': 'champagne', 'lavender': 'lavender',
		'mint': 'mint', 'navy': 'navy', 'burgundy': 'burgundy',
		'maroon': 'maroon', 'magenta': 'magenta', 'fuchsia': 'fuchsia',
		'violet': 'violet', 'indigo': 'indigo', 'cerulean': 'cerulean',
		'crimson': 'crimson', 'scarlet': 'scarlet', 'turquoise': 'turquoise',
		'khaki': 'khaki', 'tan': 'tan', 'bronze': 'bronze',
		'coyote': 'coyote', 'sand': 'sand', 'stone': 'stone',
	};
	for (const [key, value] of Object.entries(colorMap)) {
		if (text.includes(key) && !colors.includes(value)) colors.push(value);
	}
	return colors;
}

function extractImpact(text: string): string[] {
	const impact: string[] = [];
	const m = text.match(/(\d+(?:\.\d+)?)\s*m(?:eter)?s?\s*(?:impact|drop)/i);
	if (m) impact.push(`${m[1]}m`);
	return impact;
}

function extractEnvironment(text: string): string[] {
	const env: string[] = [];
	if (/\bipx?[\s-]?8\b/i.test(text)) env.push('IPX8');
	else if (/\bipx?[\s-]?7\b/i.test(text)) env.push('IPX7');
	else if (/\bipx?[\s-]?6\b/i.test(text)) env.push('IPX6');
	else if (/\bipx?[\s-]?5\b/i.test(text)) env.push('IPX5');
	else if (/\bipx?[\s-]?4\b/i.test(text)) env.push('IPX4');
	else if (/\bip68\b/i.test(text)) { env.push('IP68'); }
	else if (/\bip67\b/i.test(text)) { env.push('IP67'); }
	else if (/\bip66\b/i.test(text)) { env.push('IP66'); }
	if (/\bwaterproof\b/.test(text) && env.length === 0) env.push('waterproof');
	if (/\bsubmersible\b/.test(text)) env.push('submersible');
	if (/\bdust[\s-]?proof\b/.test(text)) env.push('dustproof');
	return env;
}

function extractSwitches(text: string): string[] {
	const switches: string[] = [];
	if (/\btail[\s-]?switch\b|\btail[\s-]?cap\b|\btail\s*click\b/.test(text)) switches.push('tail');
	if (/\bside[\s-]?switch\b|\bside\s*button\b/.test(text)) switches.push('side');
	if (/\bdual[\s-]?switch\b/.test(text)) switches.push('dual');
	if (/\brotary\b|\btwist\b/.test(text)) switches.push('rotary');
	if (/\belectronic\b.*\bswitch\b/.test(text)) switches.push('electronic');
	if (/\bmechanical\b.*\bswitch\b/.test(text)) switches.push('mechanical');
	return switches;
}

function extractFeatures(text: string): string[] {
	const features: string[] = [];
	if (/\bclip\b/.test(text)) features.push('clip');
	if (/\bmagnet\b|\bmagnetic\b/.test(text) && !/magnetic\s*charg/.test(text)) features.push('magnet');
	if (/\blanyard\b/.test(text)) features.push('lanyard');
	if (/\blockout\b|\block[\s-]?out\b/.test(text)) features.push('lockout');
	if (/\bmemory\b/.test(text)) features.push('mode memory');
	if (/\bramp(?:ing)?\b/.test(text)) features.push('ramping');
	if (/\banduril\b/.test(text)) features.push('Anduril');
	if (/\bbluetooth\b/.test(text)) features.push('Bluetooth');
	if (/\baux(?:iliary)?\b.*\bled\b|\baux\b.*\blight\b/.test(text)) features.push('aux LED');
	if (/\banti[\s-]?roll\b/.test(text)) features.push('anti-roll');
	if (/\bholster\b/.test(text)) features.push('holster');
	if (/\bpocket clip\b/.test(text)) features.push('pocket clip');
	if (/\btritium\b/.test(text)) features.push('tritium');
	if (/\bglow[\s-]?in[\s-]?the[\s-]?dark\b|\bgitd\b/.test(text)) features.push('GITD');
	if (/\bpower\s*bank\b|\bpower\s*output\b/.test(text)) features.push('power bank');
	if (/\bindicator\b/.test(text)) features.push('battery indicator');
	if (/\bstep[\s-]?down\b|\bthermal\s*(?:regulation|management|step)/i.test(text)) features.push('thermal stepdown');
	if (/\binstant\s*(?:turbo|access)\b/.test(text)) features.push('instant turbo');
	return features;
}

function extractNumber(text: string, pattern: RegExp): number | undefined {
	const m = text.match(pattern);
	if (!m) return undefined;
	const val = parseFloat(m[1].replace(/,/g, ''));
	return isNaN(val) ? undefined : val;
}

function extractLengthFromInches(text: string): number | undefined {
	const m = text.match(/(\d+(?:\.\d+)?)\s*(?:inches|inch|in\b|")/i);
	if (!m) return undefined;
	return Math.round(parseFloat(m[1]) * 25.4);
}

function extractWeightFromOz(text: string): number | undefined {
	const m = text.match(/(\d+(?:\.\d+)?)\s*(?:oz|ounces?)\b/i);
	if (m) return Math.round(parseFloat(m[1]) * 28.35);
	const g = text.match(/(\d+(?:\.\d+)?)\s*(?:grams?|g\b)/i);
	if (g) return parseFloat(g[1]);
	return undefined;
}

function extractYear(text: string): number | undefined {
	// Look for 4-digit year in reasonable range
	const m = text.match(/\b(20[12]\d)\b/);
	return m ? parseInt(m[1], 10) : undefined;
}
