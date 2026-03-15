/**
 * Manufacturer website catalog crawler.
 * Discovers product URLs from sitemaps and product listing pages,
 * then scrapes individual product pages for specs.
 * No API rate limits — uses HTTP with polite delays.
 */
import { fetchPage, htmlToText, extractSpecsFromText } from './manufacturer-scraper.js';
import { generateId } from '../schema/canonical.js';
import type { FlashlightEntry, ExtractionResult } from '../schema/canonical.js';
import { upsertFlashlight, addSource, countFlashlights } from '../store/db.js';

const CRAWL_DELAY = 1500; // ms between requests (polite crawling)

/** Site-specific crawler configuration */
interface SiteCrawler {
	brand: string;
	/** Discover all product URLs for the brand */
	discoverUrls: () => Promise<string[]>;
	/** Extract structured data from a product page */
	extractProduct: (url: string, html: string, text: string) => FlashlightEntry | null;
}

// --- Generic helpers ---

/** Extract URLs from a sitemap.xml */
async function parseSitemap(sitemapUrl: string): Promise<string[]> {
	try {
		const xml = await fetchPage(sitemapUrl);
		const urls: string[] = [];
		const re = /<loc>\s*(https?:\/\/[^<]+)\s*<\/loc>/gi;
		let m;
		while ((m = re.exec(xml)) !== null) {
			urls.push(m[1]);
		}

		// Check for nested sitemaps (sitemap index)
		const sitemapRe = /<sitemap>[\s\S]*?<loc>\s*(https?:\/\/[^<]+)\s*<\/loc>[\s\S]*?<\/sitemap>/gi;
		const nestedUrls: string[] = [];
		while ((m = sitemapRe.exec(xml)) !== null) {
			nestedUrls.push(m[1]);
		}

		// Recursively fetch nested sitemaps
		for (const nested of nestedUrls) {
			if (nested !== sitemapUrl) { // Prevent infinite loop
				try {
					const childUrls = await parseSitemap(nested);
					urls.push(...childUrls);
				} catch {
					// Skip failed nested sitemaps
				}
			}
		}

		return [...new Set(urls)];
	} catch (err) {
		console.log(`    Sitemap error for ${sitemapUrl}: ${(err as Error).message}`);
		return [];
	}
}

/** Extract product links from an HTML listing page */
function extractProductLinks(html: string, baseUrl: string, pathPattern: RegExp): string[] {
	const urls: string[] = [];
	const re = /href=["'](\/[^"']+)["']/gi;
	let m;
	while ((m = re.exec(html)) !== null) {
		if (pathPattern.test(m[1])) {
			const fullUrl = new URL(m[1], baseUrl).toString();
			if (!urls.includes(fullUrl)) urls.push(fullUrl);
		}
	}
	return urls;
}

/** Build a FlashlightEntry from extracted specs */
function buildEntryFromSpecs(
	brand: string,
	model: string,
	specs: Partial<ExtractionResult>,
	url: string,
	imageUrls: string[] = [],
): FlashlightEntry {
	const id = generateId(brand, model, specs.led?.[0]);

	return {
		id,
		model,
		brand,
		type: specs.type ?? ['flashlight'],
		led: specs.led ?? [],
		led_color: specs.led_color ?? [],
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
		battery: specs.battery ?? [],
		wh: specs.wh,
		charging: specs.charging ?? [],
		modes: specs.modes ?? [],
		levels: specs.levels,
		blink: specs.blink ?? [],
		length_mm: specs.length_mm,
		bezel_mm: specs.bezel_mm,
		body_mm: specs.body_mm,
		weight_g: specs.weight_g,
		material: specs.material ?? [],
		color: specs.color ?? [],
		impact: specs.impact ?? [],
		environment: specs.environment ?? [],
		switch: specs.switch ?? [],
		features: specs.features ?? [],
		price_usd: specs.price_usd,
		prices: [],
		purchase_urls: [],
		info_urls: [url],
		image_urls: imageUrls,
		review_refs: [],
		sources: [],
		year: specs.year,
		updated_at: new Date().toISOString(),
	};
}

/** Extract model name from a URL path */
function modelFromPath(path: string): string {
	// Get last path segment, remove extension, replace hyphens/underscores with spaces
	const segment = path.split('/').filter(Boolean).pop() ?? '';
	return segment
		.replace(/\.html?$/i, '')
		.replace(/[-_]+/g, ' ')
		.replace(/\b\w/g, (c) => c.toUpperCase())
		.trim();
}

/** Extract image URLs from HTML */
function extractImages(html: string, baseUrl: string): string[] {
	const images: string[] = [];
	const re = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
	let m;
	while ((m = re.exec(html)) !== null) {
		const src = m[1];
		// Filter for product images (not icons/logos/social)
		if (/product|item|catalog|upload|image|photo|pic/i.test(src) &&
			!/icon|logo|social|facebook|twitter|instagram|badge|flag|cart|arrow|close/i.test(src)) {
			try {
				const fullUrl = new URL(src, baseUrl).toString();
				if (!images.includes(fullUrl)) images.push(fullUrl);
			} catch {
				// Invalid URL, skip
			}
		}
	}
	return images.slice(0, 5); // Limit to 5 images
}

/** Extract colors from product page (often in variant selectors) */
function extractPageColors(html: string): string[] {
	const colors: string[] = [];
	// Look for color option selectors
	const colorRe = /(?:data-color|data-option|data-value|value)=["']((?:black|white|red|blue|green|orange|yellow|pink|purple|silver|gold|bronze|copper|titanium|olive|camo|tan|desert|grey|gray|champagne|rose|teal|navy|midnight|wine|coral|mint|lavender|burgundy|aqua|gunmetal|maroon|fuchsia|magenta|turquoise|khaki|sand|coyote|stone|indigo|scarlet|crimson|violet|cerulean)[^"']*)["']/gi;
	let m;
	while ((m = colorRe.exec(html)) !== null) {
		const color = m[1].toLowerCase().trim();
		if (!colors.includes(color)) colors.push(color);
	}
	return colors;
}

/** Extract price from product page */
function extractPagePrice(html: string): number | undefined {
	// Look for price in common patterns
	const priceRe = /(?:data-price|itemprop="price"|class="[^"]*price[^"]*")[^>]*>?\s*\$?(\d+(?:\.\d{2})?)/gi;
	const m = priceRe.exec(html);
	if (m) return parseFloat(m[1]);

	// JSON-LD structured data
	const jsonLdRe = /"price"\s*:\s*"?(\d+(?:\.\d{2})?)"?/;
	const ld = jsonLdRe.exec(html);
	if (ld) return parseFloat(ld[1]);

	return undefined;
}

// --- Site-specific crawlers ---

const CRAWLERS: SiteCrawler[] = [
	{
		brand: 'Fenix',
		async discoverUrls() {
			const urls: string[] = [];

			// Try sitemap first
			const sitemapUrls = await parseSitemap('https://www.fenixlighting.com/sitemap.xml');
			const productUrls = sitemapUrls.filter((u) => /\/products\//.test(u) || /-flashlight|-headlamp|-lantern/.test(u));
			urls.push(...productUrls);

			// Also try collection pages
			for (const category of ['flashlights', 'headlamps', 'lanterns']) {
				try {
					const html = await fetchPage(`https://www.fenixlighting.com/collections/${category}`);
					const links = extractProductLinks(html, 'https://www.fenixlighting.com', /\/products\//);
					urls.push(...links);
					await Bun.sleep(CRAWL_DELAY);
				} catch { /* skip */ }
			}

			return [...new Set(urls)];
		},
		extractProduct(url, html, text) {
			const model = modelFromPath(url).replace(/^Fenix\s+/i, '');
			const specs = extractSpecsFromText(text);
			const images = extractImages(html, url);
			const price = extractPagePrice(html);
			const colors = extractPageColors(html);

			if (specs.color) colors.push(...specs.color);
			if (price) specs.price_usd = price;
			specs.color = [...new Set(colors)];

			return buildEntryFromSpecs('Fenix', model, specs, url, images);
		},
	},
	{
		brand: 'Olight',
		async discoverUrls() {
			const urls: string[] = [];
			const sitemapUrls = await parseSitemap('https://www.olightstore.com/sitemap.xml');
			urls.push(...sitemapUrls.filter((u) => /\.html$/.test(u) && !/\/blog\/|\/info\/|\/review\/|\/about|\/contact|\/policy|\/cart|\/account/.test(u)));

			for (const category of ['flashlights', 'headlamps', 'olanterns']) {
				try {
					const html = await fetchPage(`https://www.olightstore.com/${category}.html`);
					const links = extractProductLinks(html, 'https://www.olightstore.com', /\.html$/);
					urls.push(...links.filter((u) => !/\/blog\/|\/info\/|\/review\//.test(u)));
					await Bun.sleep(CRAWL_DELAY);
				} catch { /* skip */ }
			}

			return [...new Set(urls)];
		},
		extractProduct(url, html, text) {
			const model = modelFromPath(url).replace(/\.html$/i, '').replace(/^Olight\s+/i, '');
			const specs = extractSpecsFromText(text);
			const images = extractImages(html, url);
			const price = extractPagePrice(html);
			const colors = extractPageColors(html);

			if (specs.color) colors.push(...specs.color);
			if (price) specs.price_usd = price;
			specs.color = [...new Set(colors)];

			return buildEntryFromSpecs('Olight', model, specs, url, images);
		},
	},
	{
		brand: 'Nitecore',
		async discoverUrls() {
			const urls: string[] = [];
			const sitemapUrls = await parseSitemap('https://www.nitecore.com/sitemap.xml');
			urls.push(...sitemapUrls.filter((u) => /\/product\//.test(u)));

			// Category pages
			for (const cat of ['flashlights', 'headlamps', 'lanterns']) {
				try {
					const html = await fetchPage(`https://www.nitecore.com/category/${cat}`);
					const links = extractProductLinks(html, 'https://www.nitecore.com', /\/product\//);
					urls.push(...links);
					await Bun.sleep(CRAWL_DELAY);
				} catch { /* skip */ }
			}

			return [...new Set(urls)];
		},
		extractProduct(url, html, text) {
			const model = modelFromPath(url).replace(/^Nitecore\s+/i, '');
			const specs = extractSpecsFromText(text);
			const images = extractImages(html, url);
			const price = extractPagePrice(html);

			if (price) specs.price_usd = price;

			return buildEntryFromSpecs('Nitecore', model, specs, url, images);
		},
	},
	{
		brand: 'Acebeam',
		async discoverUrls() {
			const urls: string[] = [];
			const sitemapUrls = await parseSitemap('https://www.acebeam.com/sitemap.xml');
			urls.push(...sitemapUrls.filter((u) => !/(\/blog|\/about|\/contact|\/cart|\/account|\/policy|\/faq|\/review)/.test(u)));

			try {
				const html = await fetchPage('https://www.acebeam.com/all-products');
				const links = extractProductLinks(html, 'https://www.acebeam.com', /^\/[a-z0-9]/);
				urls.push(...links.filter((u) => !/\/blog|\/about|\/contact|\/cart|\/account/.test(u)));
			} catch { /* skip */ }

			return [...new Set(urls)];
		},
		extractProduct(url, html, text) {
			const model = modelFromPath(url).replace(/^Acebeam\s+/i, '');
			const specs = extractSpecsFromText(text);
			const images = extractImages(html, url);
			const price = extractPagePrice(html);

			if (price) specs.price_usd = price;

			return buildEntryFromSpecs('Acebeam', model, specs, url, images);
		},
	},
	{
		brand: 'ThruNite',
		async discoverUrls() {
			const urls: string[] = [];
			const sitemapUrls = await parseSitemap('https://thrunite.com/sitemap.xml');
			urls.push(...sitemapUrls.filter((u) => /\/products?\//.test(u)));

			return [...new Set(urls)];
		},
		extractProduct(url, html, text) {
			const model = modelFromPath(url).replace(/^Thrunite\s+/i, '');
			const specs = extractSpecsFromText(text);
			const images = extractImages(html, url);
			const price = extractPagePrice(html);

			if (price) specs.price_usd = price;

			return buildEntryFromSpecs('ThruNite', model, specs, url, images);
		},
	},
	{
		brand: 'Wurkkos',
		async discoverUrls() {
			const urls: string[] = [];
			const sitemapUrls = await parseSitemap('https://wurkkos.com/sitemap.xml');
			urls.push(...sitemapUrls.filter((u) => /\/products\//.test(u)));

			return [...new Set(urls)];
		},
		extractProduct(url, html, text) {
			const model = modelFromPath(url).replace(/^Wurkkos\s+/i, '');
			const specs = extractSpecsFromText(text);
			const images = extractImages(html, url);
			const price = extractPagePrice(html);

			if (price) specs.price_usd = price;

			return buildEntryFromSpecs('Wurkkos', model, specs, url, images);
		},
	},
	{
		brand: 'Sofirn',
		async discoverUrls() {
			const urls: string[] = [];
			const sitemapUrls = await parseSitemap('https://www.sofirnlight.com/sitemap.xml');
			urls.push(...sitemapUrls.filter((u) => /\/products\//.test(u)));

			return [...new Set(urls)];
		},
		extractProduct(url, html, text) {
			const model = modelFromPath(url).replace(/^Sofirn\s+/i, '');
			const specs = extractSpecsFromText(text);
			const images = extractImages(html, url);
			const price = extractPagePrice(html);

			if (price) specs.price_usd = price;

			return buildEntryFromSpecs('Sofirn', model, specs, url, images);
		},
	},
	{
		brand: 'Streamlight',
		async discoverUrls() {
			const urls: string[] = [];
			const sitemapUrls = await parseSitemap('https://www.streamlight.com/sitemap.xml');
			urls.push(...sitemapUrls.filter((u) => /\/products?\//.test(u)));

			return [...new Set(urls)];
		},
		extractProduct(url, html, text) {
			const model = modelFromPath(url).replace(/^Streamlight\s+/i, '');
			const specs = extractSpecsFromText(text);
			const images = extractImages(html, url);
			const price = extractPagePrice(html);

			if (price) specs.price_usd = price;

			return buildEntryFromSpecs('Streamlight', model, specs, url, images);
		},
	},
	{
		brand: 'Skilhunt',
		async discoverUrls() {
			const urls: string[] = [];
			const sitemapUrls = await parseSitemap('https://www.skilhunt.com/sitemap.xml');
			urls.push(...sitemapUrls.filter((u) => /\/product\//.test(u)));

			return [...new Set(urls)];
		},
		extractProduct(url, html, text) {
			const model = modelFromPath(url).replace(/^Skilhunt\s+/i, '');
			const specs = extractSpecsFromText(text);
			const images = extractImages(html, url);
			const price = extractPagePrice(html);

			if (price) specs.price_usd = price;

			return buildEntryFromSpecs('Skilhunt', model, specs, url, images);
		},
	},
	{
		brand: 'Lumintop',
		async discoverUrls() {
			const urls: string[] = [];
			const sitemapUrls = await parseSitemap('https://www.lumintop.com/sitemap.xml');
			urls.push(...sitemapUrls.filter((u) => /\/product\//.test(u) || /-flashlight|-headlamp/.test(u)));

			return [...new Set(urls)];
		},
		extractProduct(url, html, text) {
			const model = modelFromPath(url).replace(/^Lumintop\s+/i, '');
			const specs = extractSpecsFromText(text);
			const images = extractImages(html, url);
			const price = extractPagePrice(html);

			if (price) specs.price_usd = price;

			return buildEntryFromSpecs('Lumintop', model, specs, url, images);
		},
	},
	{
		brand: 'Klarus',
		async discoverUrls() {
			// Klarus uses numeric item IDs: /item/{id}.html (IDs 64-154 with gaps)
			const urls: string[] = [];
			for (let id = 60; id <= 160; id++) {
				urls.push(`https://www.klaruslight.com/item/${id}.html`);
			}
			return urls;
		},
		extractProduct(url, html, text) {
			// Klarus uses structured div.sme/div.pme pairs for specs
			const specPairs: Record<string, string> = {};
			const pairRe = /<div\s+class="sme\b[^"]*"[^>]*>(.*?)<\/div>\s*<div\s+class="pme\b[^"]*"[^>]*>(.*?)<\/div>/gis;
			let pm;
			while ((pm = pairRe.exec(html)) !== null) {
				const label = pm[1].replace(/<[^>]+>/g, '').replace(/[：:]\s*$/, '').trim().toLowerCase();
				const value = pm[2].replace(/<[^>]+>/g, '').trim();
				if (label && value) specPairs[label] = value;
			}

			// Extract model from "Product Model" spec or page title
			let model = specPairs['product model'] ?? '';
			if (!model) {
				const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/is);
				if (titleMatch) model = titleMatch[1].replace(/<[^>]+>/g, '').trim();
			}
			model = model.replace(/^Klarus\s+/i, '').trim();
			if (!model || model.length < 2) return null;

			// Start with generic text extraction
			const specs = extractSpecsFromText(text);

			// Override with structured data (higher confidence)
			const maxBrightness = specPairs['maximum brightness'] ?? specPairs['max brightness'];
			if (maxBrightness) {
				const lm = maxBrightness.match(/(\d[\d,]*)\s*lumen/i);
				if (lm) specs.lumens = [parseInt(lm[1].replace(/,/g, ''), 10)];
			}

			const longestRange = specPairs['longest range'] ?? specPairs['max range'];
			if (longestRange) {
				const rng = longestRange.match(/(\d[\d,]*)\s*m/i);
				if (rng) specs.throw_m = parseInt(rng[1].replace(/,/g, ''), 10);
			}

			const ledModel = specPairs['led model'] ?? specPairs['led mode']; // typo on some pages
			if (ledModel && !specs.led?.length) {
				specs.led = [ledModel.trim()];
			}

			// Dimensions: find the largest value as length (always largest dimension)
			const dims = specPairs['dimensions'] ?? specPairs['dimension'];
			if (dims) {
				const dimNums: number[] = [];
				const dimRe = /(\d+(?:\.\d+)?)\s*mm/gi;
				let dm;
				while ((dm = dimRe.exec(dims)) !== null) {
					dimNums.push(parseFloat(dm[1]));
				}
				if (dimNums.length > 0) {
					specs.length_mm = Math.max(...dimNums);
					// If 3 dimensions, the two smaller are bezel and body
					if (dimNums.length >= 3) {
						const sorted = [...dimNums].sort((a, b) => a - b);
						specs.body_mm = sorted[0];
						specs.bezel_mm = sorted[1];
					}
				}
			}

			// Weight: strip parenthetical notes, handle full-width parens
			const weightVal = specPairs['weight'] ?? specPairs['weigh'];
			if (weightVal) {
				const wm = weightVal.match(/(\d+(?:\.\d+)?)\s*g/i);
				if (wm) specs.weight_g = parseFloat(wm[1]);
			}

			// Runtime
			const maxRuntime = specPairs['maximum runtime'] ?? specPairs['max runtime'];
			if (maxRuntime) {
				const rt = maxRuntime.match(/(\d+(?:\.\d+)?)\s*hour/i);
				if (rt) specs.runtime_hours = [parseFloat(rt[1])];
			}

			// IP rating
			const waterproof = specPairs['waterproof rating'] ?? specPairs['waterproof'];
			if (waterproof) {
				const ipM = waterproof.match(/IP[X]?(\d{1,2})/i);
				if (ipM) {
					const rating = ipM[1].length === 1 ? `IPX${ipM[1]}` : `IP${ipM[1]}`;
					specs.environment = [rating];
				}
			}

			// Impact resistance (note: Klarus has typo "lmpact" with lowercase L)
			const impact = specPairs['impact resistance'] ?? specPairs['lmpact resistance'];
			if (impact) {
				const im = impact.match(/(\d+(?:\.\d+)?)\s*m/i);
				if (im) specs.impact = [`${im[1]}m`];
			}

			const images = extractImages(html, url);
			const price = extractPagePrice(html);
			if (price) specs.price_usd = price;

			return buildEntryFromSpecs('Klarus', model, specs, url, images);
		},
	},
	{
		brand: 'Emisar',
		async discoverUrls() {
			// intl-outdoor.com is Magento — no sitemap, no API. Discover via category pages.
			const categoryUrls = [
				'https://intl-outdoor.com/single-channel-led-flashlights.html',
				'https://intl-outdoor.com/tint-ramping-instant-channel-swiching-led-flashlights.html',
				'https://intl-outdoor.com/triple-channel-led-flashlights.html',
				'https://intl-outdoor.com/headlamps-worklights.html',
				'https://intl-outdoor.com/mule-led-flashlights.html',
			];
			const productUrls: string[] = [];

			for (const catUrl of categoryUrls) {
				try {
					const html = await fetchPage(catUrl);
					// Extract product links from category listing
					const re = /href=["'](https?:\/\/intl-outdoor\.com\/[^"']*\.html)["']/gi;
					let m;
					while ((m = re.exec(html)) !== null) {
						const url = m[1];
						// Filter to product pages (not category, cart, account pages)
						if (!/components|accessories|checkout|customer|catalogsearch|review/i.test(url) &&
							/led|flashlight|headlamp|mule|emisar|noctigon/i.test(url)) {
							if (!productUrls.includes(url)) productUrls.push(url);
						}
					}
					await Bun.sleep(CRAWL_DELAY);
				} catch { /* skip failed category pages */ }
			}

			return productUrls;
		},
		extractProduct(url, html, text) {
			// Extract model name from <h1> or URL
			let model = '';
			const h1Match = html.match(/<h1[^>]*class="[^"]*product-name[^"]*"[^>]*>(.*?)<\/h1>/is)
				?? html.match(/<h1[^>]*>(.*?)<\/h1>/is);
			if (h1Match) {
				model = h1Match[1].replace(/<[^>]+>/g, '').trim();
			}
			if (!model) model = modelFromPath(url);
			// Skip components/accessories (not flashlights)
			const fullTitle = model.toLowerCase();
			if (/\b(?:replacement|spare|pcb|optic|glass|lens|lanyard|clip|tube|extension|button|ring|aux|auxiliary|magnet.*cap|bezel.*ring|o-ring|gasket|driver)\b/i.test(fullTitle)) {
				return null;
			}

			// Normalize: extract the core model (e.g. "D4V2" from "Emisar D4V2 High Power LED Flashlight")
			model = model.replace(/^(?:Emisar|Noctigon)\s+/i, '');
			// Trim trailing descriptions
			model = model.replace(/\s+(?:High\s+Power|Quad|Dual|Triple|Channel|LED|Flashlight|Headlamp|Right\s*Angle|Work\s*Light|Mule).*$/i, '').trim();
			if (!model || model.length < 2) return null;

			// Determine brand from model name or page title
			const pageTitle = (h1Match?.[1] ?? '').replace(/<[^>]+>/g, '');
			const brand = /noctigon/i.test(pageTitle) ? 'Noctigon' : 'Emisar';

			// Start with generic text extraction
			const specs = extractSpecsFromText(text);

			// Parse Emisar-specific dimension format: "95mm(length) * 28mm(head) * 24mm(body)"
			const emisarDims = text.match(/(\d+(?:\.\d+)?)\s*mm\s*\(?length\)?\s*[×*x]\s*(\d+(?:\.\d+)?)\s*mm\s*\(?head\)?\s*[×*x]\s*(\d+(?:\.\d+)?)\s*mm\s*\(?body\)?/i);
			if (emisarDims) {
				specs.length_mm = parseFloat(emisarDims[1]);
				specs.bezel_mm = parseFloat(emisarDims[2]);
				specs.body_mm = parseFloat(emisarDims[3]);
			}

			// Parse weight: "58g" or "58 grams"
			const weightM = text.match(/(?:weight|net\s*weight)[:\s]*(\d+(?:\.\d+)?)\s*g\b/i);
			if (weightM) specs.weight_g = parseFloat(weightM[1]);

			// Parse LED variants from <select> dropdown options
			const leds: string[] = [];
			// Find select elements labeled "LED" or "LED & Tint" or "Channel"
			const selectRe = /<label[^>]*>([^<]*(?:LED|Tint|Emitter|Channel)[^<]*)<\/label>[\s\S]*?<select[^>]*>([\s\S]*?)<\/select>/gi;
			let sm;
			while ((sm = selectRe.exec(html)) !== null) {
				const optionsHtml = sm[2];
				const optRe = /<option[^>]*>(.*?)<\/option>/gi;
				let om;
				while ((om = optRe.exec(optionsHtml)) !== null) {
					const optText = om[1].replace(/<[^>]+>/g, '').trim();
					if (!optText || /choose|select|please/i.test(optText)) continue;
					// Clean LED name: extract core emitter from text like "Nichia 519A sm573 - 5700K D200 R9080 +$4.00"
					const ledName = optText
						.replace(/\s*\+?\$[\d.]+.*$/, '') // Remove price suffix
						.replace(/\s*-\s*\d{4,5}K.*$/, '') // Remove CCT suffix for primary name
						.trim();
					if (ledName && ledName.length > 1 && !leds.includes(ledName)) {
						leds.push(ledName);
					}
				}
			}
			if (leds.length > 0) specs.led = leds;

			// Parse performance tables: "NTG35 5000K: 4200 lm / 17,100 cd"
			const lumens: number[] = [];
			const candelas: number[] = [];
			const perfRe = /(\d[\d,]*)\s*(?:lumens?|lm)\b/gi;
			let pm;
			while ((pm = perfRe.exec(text)) !== null) {
				const val = parseInt(pm[1].replace(/,/g, ''), 10);
				if (val > 0 && val < 1_000_000 && !lumens.includes(val)) lumens.push(val);
			}
			const cdRe = /(\d[\d,]*)\s*(?:cd|candela)\b/gi;
			while ((pm = cdRe.exec(text)) !== null) {
				const val = parseInt(pm[1].replace(/,/g, ''), 10);
				if (val > 0 && val < 100_000_000 && !candelas.includes(val)) candelas.push(val);
			}
			if (lumens.length > 0) specs.lumens = lumens.sort((a, b) => b - a);
			if (candelas.length > 0 && !specs.intensity_cd) {
				specs.intensity_cd = Math.max(...candelas);
			}

			// IP rating
			const ipMatch = text.match(/\bIP[X]?(\d{1,2})\b/i);
			if (ipMatch) {
				const rating = ipMatch[1].length === 1 ? `IPX${ipMatch[1]}` : `IP${ipMatch[1]}`;
				specs.environment = [rating];
			}

			// Material is always aluminum for Emisar/Noctigon
			if (!specs.material?.length && /alumin/i.test(text)) {
				specs.material = ['aluminum'];
			}

			// Battery from text
			if (!specs.battery?.length) {
				const batts: string[] = [];
				if (/\b21700\b/.test(text)) batts.push('21700');
				if (/\b18650\b/.test(text)) batts.push('18650');
				if (/\b18350\b/.test(text)) batts.push('18350');
				if (/\b26800\b/.test(text)) batts.push('26800');
				if (batts.length > 0) specs.battery = batts;
			}

			// Anduril firmware is always present for Emisar/Noctigon
			if (!specs.features?.length) specs.features = [];
			if (/anduril/i.test(text) && !specs.features.includes('Anduril')) {
				specs.features.push('Anduril');
			}

			// Switch type (Emisar typically uses side switch with aux LEDs)
			if (!specs.switch?.length && /side\s*switch/i.test(text)) {
				specs.switch = ['side'];
			}

			// Charging
			if (!specs.charging?.length) {
				const chg: string[] = [];
				if (/usb[\s-]?c/i.test(text)) chg.push('USB-C');
				if (chg.length > 0) specs.charging = chg;
			}

			const images = extractImages(html, url);
			const price = extractPagePrice(html);
			if (price) specs.price_usd = price;

			// Extract colors from body color dropdown
			const colors: string[] = [];
			const colorSelectRe = /<label[^>]*>([^<]*(?:Body\s*Color|Color|Finish)[^<]*)<\/label>[\s\S]*?<select[^>]*>([\s\S]*?)<\/select>/gi;
			let cm;
			while ((cm = colorSelectRe.exec(html)) !== null) {
				const optionsHtml = cm[2];
				const optRe = /<option[^>]*>(.*?)<\/option>/gi;
				let om;
				while ((om = optRe.exec(optionsHtml)) !== null) {
					const colorText = om[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
					if (!colorText || /choose|select|please/i.test(colorText)) continue;
					// Map to canonical colors
					const colorMap: Record<string, string> = {
						'black': 'black', 'dark grey': 'gray', 'cyan': 'cyan',
						'green': 'green', 'sand': 'sand', 'stone': 'gray',
						'white': 'white', 'red': 'red', 'blue': 'blue',
						'grey': 'gray', 'desert tan': 'tan', 'olive': 'olive',
						'orange': 'orange', 'purple': 'purple',
					};
					for (const [key, val] of Object.entries(colorMap)) {
						if (colorText.includes(key) && !colors.includes(val)) {
							colors.push(val);
						}
					}
				}
			}
			if (colors.length > 0) specs.color = colors;

			return buildEntryFromSpecs(brand, model, specs, url, images);
		},
	},
	{
		brand: 'SureFire',
		async discoverUrls() {
			// BigCommerce — no sitemap. Paginate /flashlights/ category.
			const urls: string[] = [];
			for (let page = 1; page <= 5; page++) {
				const pageUrl = page === 1
					? 'https://www.surefire.com/flashlights/'
					: `https://www.surefire.com/flashlights/?page=${page}`;
				try {
					const html = await fetchPage(pageUrl);
					// SureFire product links are at root level: /product-slug/
					const re = /href=["'](\/[a-z0-9][a-z0-9-]*\/)["']/gi;
					let m;
					while ((m = re.exec(html)) !== null) {
						const path = m[1];
						// Exclude non-product pages
						if (!/^\/(flashlights|weaponlights|headlamps|account|cart|checkout|search|blog|about|contact|support|faq|warranty|pages|collections|categories|cdn)/.test(path) &&
							path.length > 3 && path.length < 80) {
							const fullUrl = `https://www.surefire.com${path}`;
							if (!urls.includes(fullUrl)) urls.push(fullUrl);
						}
					}
					await Bun.sleep(CRAWL_DELAY);
				} catch { break; }
			}
			return [...new Set(urls)];
		},
		extractProduct(url, html, text) {
			const model = modelFromPath(url).replace(/^Surefire\s+/i, '');
			const specs = extractSpecsFromText(text);

			// SureFire uses <dl>/<dt>/<dd> spec tables — extract structured data
			const dlRe = /<dt[^>]*>(.*?)<\/dt>\s*<dd[^>]*>(.*?)<\/dd>/gis;
			let dm;
			while ((dm = dlRe.exec(html)) !== null) {
				const label = dm[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
				const value = dm[2].replace(/<[^>]+>/g, '').trim();

				if (/max.*output|lumens/i.test(label)) {
					const lm = value.match(/(\d[\d,]*)/);
					if (lm) specs.lumens = [parseInt(lm[1].replace(/,/g, ''), 10)];
				}
				if (/peak.*candela|candela/i.test(label)) {
					const cd = value.match(/(\d[\d,]*)/);
					if (cd) specs.intensity_cd = parseInt(cd[1].replace(/,/g, ''), 10);
				}
				if (/beam.*distance|distance/i.test(label)) {
					const dist = value.match(/(\d[\d,]*)\s*m/i);
					if (dist) specs.throw_m = parseInt(dist[1].replace(/,/g, ''), 10);
				}
				if (/runtime|run\s*time/i.test(label)) {
					const rt = value.match(/(\d+(?:\.\d+)?)\s*(?:hour|hr)/i);
					if (rt) specs.runtime_hours = [parseFloat(rt[1])];
				}
				if (/length/i.test(label)) {
					const mm = value.match(/(\d+(?:\.\d+)?)\s*(?:cm)/i);
					if (mm) specs.length_mm = Math.round(parseFloat(mm[1]) * 10);
					else {
						const inches = value.match(/(\d+(?:\.\d+)?)\s*(?:in|")/i);
						if (inches) specs.length_mm = Math.round(parseFloat(inches[1]) * 25.4);
					}
				}
				if (/weight/i.test(label)) {
					const g = value.match(/(\d+(?:\.\d+)?)\s*g\b/i);
					if (g) specs.weight_g = parseFloat(g[1]);
					else {
						const oz = value.match(/(\d+(?:\.\d+)?)\s*oz/i);
						if (oz) specs.weight_g = Math.round(parseFloat(oz[1]) * 28.35);
					}
				}
				if (/batter/i.test(label)) {
					const batts: string[] = [];
					if (/CR123/i.test(value)) batts.push('CR123A');
					if (/18650/i.test(value)) batts.push('18650');
					if (/18350/i.test(value)) batts.push('18350');
					if (/AAA/i.test(value)) batts.push('AAA');
					if (/AA\b/i.test(value)) batts.push('AA');
					if (batts.length > 0) specs.battery = batts;
				}
				if (/material|construc/i.test(label)) {
					const mats: string[] = [];
					if (/aluminum|aluminium/i.test(value)) mats.push('aluminum');
					if (/polymer|nylon|plastic/i.test(value)) mats.push('polymer');
					if (mats.length > 0) specs.material = mats;
				}
				if (/water|ip[x]?\d/i.test(label)) {
					const ipM = value.match(/IP[X]?(\d{1,2})/i);
					if (ipM) {
						const rating = ipM[1].length === 1 ? `IPX${ipM[1]}` : `IP${ipM[1]}`;
						specs.environment = [rating];
					}
				}
			}

			const images = extractImages(html, url);
			const price = extractPagePrice(html);
			if (price) specs.price_usd = price;

			return buildEntryFromSpecs('SureFire', model, specs, url, images);
		},
	},
	{
		brand: 'Armytek',
		async discoverUrls() {
			// CS-Cart platform — two-level discovery: model categories → product pages
			const urls: string[] = [];

			// Step 1: Get model category links from /flashlights/models/ and /headlamps/
			const indexPages = [
				'https://www.armytek.com/flashlights/',
				'https://www.armytek.com/flashlights/models/',
				'https://www.armytek.com/headlamps/',
			];
			const modelCategories: string[] = [];

			for (const indexUrl of indexPages) {
				try {
					const html = await fetchPage(indexUrl);
					// Extract model category links: /flashlights/models/{model-name}/
					const re = /href=["'](\/(?:flashlights|headlamps)\/(?:models\/)?[a-z0-9-]+\/)["']/gi;
					let m;
					while ((m = re.exec(html)) !== null) {
						const fullUrl = `https://www.armytek.com${m[1]}`;
						if (!modelCategories.includes(fullUrl) &&
							!/\/types\/|\/accessories|\/batteries|\/charger|\/filters/i.test(m[1])) {
							modelCategories.push(fullUrl);
						}
					}
					await Bun.sleep(CRAWL_DELAY);
				} catch { /* skip */ }
			}

			// Step 2: Crawl each model category to find individual product pages
			for (const catUrl of modelCategories) {
				try {
					const html = await fetchPage(catUrl);
					const re = /href=["'](\/(?:flashlights|headlamps)\/models\/[a-z0-9-]+\/[a-z0-9-]+\/)["']/gi;
					let m;
					while ((m = re.exec(html)) !== null) {
						const fullUrl = `https://www.armytek.com${m[1]}`;
						if (!urls.includes(fullUrl)) urls.push(fullUrl);
					}
					await Bun.sleep(CRAWL_DELAY);
				} catch { /* skip */ }
			}

			return [...new Set(urls)];
		},
		extractProduct(url, html, text) {
			const model = modelFromPath(url)
				.replace(/^Armytek\s+/i, '')
				.replace(/\s+(?:warm|white|pro|multi|v\d+)$/i, (m) => m); // Keep suffixes like "Pro", "V2"
			const specs = extractSpecsFromText(text);

			// Armytek uses #tc-table for structured specs
			const tableRe = /<tr[^>]*>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<\/tr>/gis;
			let tm;
			while ((tm = tableRe.exec(html)) !== null) {
				const label = tm[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
				const value = tm[2].replace(/<[^>]+>/g, '').trim();

				if (/max.*brightness|light.*output|luminous.*flux/i.test(label)) {
					const lm = value.match(/(\d[\d,]*)\s*(?:lm|lumen)/i);
					if (lm) specs.lumens = [parseInt(lm[1].replace(/,/g, ''), 10)];
				}
				if (/beam.*distance|throw/i.test(label)) {
					const dist = value.match(/(\d[\d,]*)\s*m/i);
					if (dist) specs.throw_m = parseInt(dist[1].replace(/,/g, ''), 10);
				}
				if (/beam.*intensity|candela/i.test(label)) {
					const cd = value.match(/(\d[\d,]*)\s*cd/i);
					if (cd) specs.intensity_cd = parseInt(cd[1].replace(/,/g, ''), 10);
				}
				if (/^length/i.test(label)) {
					const mm = value.match(/(\d+(?:\.\d+)?)\s*mm/i);
					if (mm) specs.length_mm = parseFloat(mm[1]);
				}
				if (/head.*diameter|bezel/i.test(label)) {
					const mm = value.match(/(\d+(?:\.\d+)?)\s*mm/i);
					if (mm) specs.bezel_mm = parseFloat(mm[1]);
				}
				if (/body.*diameter/i.test(label)) {
					const mm = value.match(/(\d+(?:\.\d+)?)\s*mm/i);
					if (mm) specs.body_mm = parseFloat(mm[1]);
				}
				if (/weight.*(?:without|w\/o|no)\s*batt/i.test(label) || /^weight$/i.test(label)) {
					const g = value.match(/(\d+(?:\.\d+)?)\s*g\b/i);
					if (g) specs.weight_g = parseFloat(g[1]);
				}
				if (/protection|water/i.test(label)) {
					const ipM = value.match(/IP[X]?(\d{1,2})/i);
					if (ipM) {
						const rating = ipM[1].length === 1 ? `IPX${ipM[1]}` : `IP${ipM[1]}`;
						specs.environment = [rating];
					}
				}
				if (/impact/i.test(label)) {
					const im = value.match(/(\d+(?:\.\d+)?)\s*m/i);
					if (im) specs.impact = [`${im[1]}m`];
				}
			}

			// Parse multi-mode runtime from Armytek's detailed table rows
			// Format: "2500 lm / 2h 40min" or "0.15 lm / 200 days"
			const runtimes: number[] = [];
			const rtRe = /(\d+(?:\.\d+)?)\s*(?:lm|lumen)\s*[/|]\s*(\d+)\s*h(?:ours?)?\s*(?:(\d+)\s*min)?/gi;
			let rm;
			while ((rm = rtRe.exec(text)) !== null) {
				const hours = parseInt(rm[2], 10) + (rm[3] ? parseInt(rm[3], 10) / 60 : 0);
				if (hours > 0 && hours < 10000 && !runtimes.includes(hours)) runtimes.push(hours);
			}
			// Also check for "NNN days" runtime
			const daysRe = /(\d+)\s*days?/gi;
			while ((rm = daysRe.exec(text)) !== null) {
				const hours = parseInt(rm[1], 10) * 24;
				if (hours > 0 && hours < 100000 && !runtimes.includes(hours)) runtimes.push(hours);
			}
			if (runtimes.length > 0 && !specs.runtime_hours?.length) {
				specs.runtime_hours = runtimes.sort((a, b) => b - a);
			}

			// Parse LED from product title (Armytek puts LED in title, not spec table)
			if (!specs.led?.length) {
				const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/is);
				if (titleMatch) {
					const title = titleMatch[1].replace(/<[^>]+>/g, '');
					const ledPatterns: [RegExp, string][] = [
						[/\bXHP50\.2\b/i, 'XHP50.2'], [/\bXHP50\.3\b/i, 'XHP50.3'],
						[/\bXHP50\b/i, 'XHP50'], [/\bXHP70\.2\b/i, 'XHP70.2'],
						[/\bXHP70\b/i, 'XHP70'], [/\bNichia 144A\b/i, 'Nichia 144A'],
						[/\bNichia 144AR\b/i, 'Nichia 144AR'], [/\bSST[\s-]?40\b/i, 'SST-40'],
						[/\bSST[\s-]?20\b/i, 'SST-20'], [/\b519A\b/, '519A'],
						[/\bSFT[\s-]?70\b/i, 'SFT-70'], [/\bSFT[\s-]?40\b/i, 'SFT-40'],
						[/\bXM[\s-]?L2\b/i, 'XM-L2'], [/\bXP[\s-]?L\b/i, 'XP-L'],
					];
					for (const [re, name] of ledPatterns) {
						if (re.test(title)) {
							specs.led = [name];
							break;
						}
					}
				}
			}

			// Armytek material is typically aluminum
			if (!specs.material?.length && /alumin/i.test(text)) {
				specs.material = ['aluminum'];
			}

			const images = extractImages(html, url);
			const price = extractPagePrice(html);
			if (price) specs.price_usd = price;

			return buildEntryFromSpecs('Armytek', model, specs, url, images);
		},
	},
];

/**
 * Crawl a single brand's manufacturer website.
 * Returns count of products discovered and saved.
 */
export async function crawlBrand(brandName: string): Promise<{
	discovered: number;
	saved: number;
	errors: number;
}> {
	const crawler = CRAWLERS.find((c) => c.brand.toLowerCase() === brandName.toLowerCase());
	if (!crawler) {
		console.log(`  No crawler configured for ${brandName}`);
		return { discovered: 0, saved: 0, errors: 0 };
	}

	console.log(`  Discovering product URLs for ${crawler.brand}...`);
	let urls: string[];
	try {
		urls = await crawler.discoverUrls();
	} catch (err) {
		console.log(`  Discovery failed: ${(err as Error).message}`);
		return { discovered: 0, saved: 0, errors: 1 };
	}

	console.log(`  Found ${urls.length} potential product URLs`);
	let saved = 0;
	let errors = 0;

	for (let i = 0; i < urls.length; i++) {
		const url = urls[i];
		try {
			const html = await fetchPage(url);
			const text = htmlToText(html);

			// Skip non-product pages (too short or no spec-related content)
			if (text.length < 200) continue;
			if (!/lumen|battery|led|flashlight|headlamp|lantern/i.test(text)) continue;

			const entry = crawler.extractProduct(url, html, text);
			if (entry && entry.model && entry.model.length > 1) {
				upsertFlashlight(entry);
				addSource(entry.id, {
					source: `manufacturer:${crawler.brand}`,
					url,
					scraped_at: new Date().toISOString(),
					confidence: 0.85,
				});
				saved++;
			}
		} catch (err) {
			errors++;
		}

		// Progress logging every 10 items
		if ((i + 1) % 10 === 0) {
			console.log(`    Progress: ${i + 1}/${urls.length} (saved: ${saved}, errors: ${errors})`);
		}

		// Polite crawl delay
		await Bun.sleep(CRAWL_DELAY);
	}

	return { discovered: urls.length, saved, errors };
}

/**
 * Crawl all configured manufacturer websites.
 */
export async function crawlAllBrands(): Promise<{
	totalDiscovered: number;
	totalSaved: number;
	totalErrors: number;
	byBrand: Record<string, { discovered: number; saved: number }>;
}> {
	let totalDiscovered = 0;
	let totalSaved = 0;
	let totalErrors = 0;
	const byBrand: Record<string, { discovered: number; saved: number }> = {};

	for (const crawler of CRAWLERS) {
		console.log(`\n--- ${crawler.brand} ---`);
		const result = await crawlBrand(crawler.brand);
		totalDiscovered += result.discovered;
		totalSaved += result.saved;
		totalErrors += result.errors;
		byBrand[crawler.brand] = { discovered: result.discovered, saved: result.saved };
	}

	return { totalDiscovered, totalSaved, totalErrors, byBrand };
}

/** Get list of configured crawler brand names */
export function getCrawlerBrands(): string[] {
	return CRAWLERS.map((c) => c.brand);
}
