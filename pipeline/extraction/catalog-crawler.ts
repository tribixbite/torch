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

/**
 * Fetch a page using curl — bypasses Cloudflare TLS fingerprinting
 * that blocks bun/node fetch. Used for sites like pelican.com.
 */
async function fetchWithCurl(url: string): Promise<string> {
	const proc = Bun.spawn(['curl', '-sS', '-L', '--max-time', '20',
		'-H', 'User-Agent: Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
		'-H', 'Accept: text/html,application/xhtml+xml',
		'-H', 'Accept-Language: en-US,en;q=0.9',
		url,
	], { stdout: 'pipe', stderr: 'pipe' });
	const html = await new Response(proc.stdout).text();
	const exitCode = await proc.exited;
	if (exitCode !== 0 || html.length < 100) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(`curl failed (exit ${exitCode}): ${stderr.trim()}`);
	}
	// Detect Cloudflare challenge in response
	if (html.includes('Just a moment...') && html.includes('challenges.cloudflare.com')) {
		throw new Error('Cloudflare challenge detected');
	}
	return html;
}

/** Site-specific crawler configuration */
interface SiteCrawler {
	brand: string;
	/** Discover all product URLs for the brand */
	discoverUrls: () => Promise<string[]>;
	/** Extract structured data from a product page */
	extractProduct: (url: string, html: string, text: string) => FlashlightEntry | null;
	/** Optional custom fetch function for sites behind Cloudflare TLS fingerprinting */
	fetchFn?: (url: string) => Promise<string>;
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
		led_options: specs.led_options ?? [],
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
			// UeeShop platform — sitemap redirects to /, so paginate collection pages
			const urls: string[] = [];
			const categories = ['flashlight', 'edc-light', 'underwater-torch', 'tractical-light', 'headlamp', 'powerful-torch', 'mini-torch'];

			for (const cat of categories) {
				for (let page = 1; page <= 5; page++) {
					try {
						const listUrl = `https://wurkkos.com/collections/${cat}?page=${page}`;
						const html = await fetchPage(listUrl);
						// Extract product links: /products/product-slug
						const re = /href=["'](\/products\/[a-z0-9][a-z0-9_,.-]*?)["']/gi;
						let m;
						while ((m = re.exec(html)) !== null) {
							const productUrl = `https://wurkkos.com${m[1]}`;
							if (!urls.includes(productUrl)) urls.push(productUrl);
						}
						// Stop pagination when no products on page
						if (!/\/products\//i.test(html)) break;
						await Bun.sleep(CRAWL_DELAY);
					} catch { break; }
				}
			}

			// Exclude accessory/battery URLs
			return urls.filter((u) => !/batter|charger|accessor|cable|case|strap|clip|diffuser|mount/i.test(u));
		},
		extractProduct(url, html, text) {
			const model = modelFromPath(url).replace(/^Wurkkos[-\s]+/i, '');
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
			// Shoplazza platform — sitemap blocked by Cloudflare, paginate collection pages
			const urls: string[] = [];
			const categories = ['sofirn-flashlights', 'powerful-flashlights', 'tactical-flashlight',
				'diving-flashlights', 'edc-flashlights', 'mini-flashlights', 'headlamps', 'lanterns'];

			for (const cat of categories) {
				for (let page = 1; page <= 10; page++) {
					try {
						const listUrl = `https://www.sofirnlight.com/collections/${cat}?page=${page}`;
						const html = await fetchPage(listUrl);
						const re = /href=["'](\/products\/[a-z0-9][a-z0-9_.-]*?)["']/gi;
						let m;
						let found = 0;
						while ((m = re.exec(html)) !== null) {
							const productUrl = `https://www.sofirnlight.com${m[1]}`;
							if (!urls.includes(productUrl)) {
								urls.push(productUrl);
								found++;
							}
						}
						if (found === 0) break; // No new products, stop pagination
						await Bun.sleep(CRAWL_DELAY);
					} catch { break; }
				}
			}

			// Exclude accessories
			return urls.filter((u) => !/batter|charger|accessor|case|strap|clip|diffuser/i.test(u));
		},
		extractProduct(url, html, text) {
			const model = modelFromPath(url).replace(/^Sofirn[-\s]+/i, '');
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
			// "Mule" is a meaningful variant (no optic/lens) — keep it as distinct model
			model = model.replace(/\s+(?:High\s+Power|Quad|Dual|Triple|Channel|LED|Flashlight|Headlamp|Right\s*Angle|Work\s*Light).*$/i, '').trim();
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
			// intl-outdoor (Magento 1.x) uses <p> tags for option headings, not <label>
			const selectRe = /<(?:label|p|div|span)[^>]*>([^<]*(?:LED|Tint|Emitter|Channel)[^<]*)<\/(?:label|p|div|span)>[\s\S]*?<select[^>]*>([\s\S]*?)<\/select>/gi;
			let sm;
			while ((sm = selectRe.exec(html)) !== null) {
				const optionsHtml = sm[2];
				const optRe = /<option[^>]*>(.*?)<\/option>/gi;
				let om;
				while ((om = optRe.exec(optionsHtml)) !== null) {
					const optText = om[1].replace(/<[^>]+>/g, '').trim();
					if (!optText || /choose|select|please/i.test(optText)) continue;
					// Clean LED name from formats like:
					//   "Cool White - SST20, 6500K"
					//   "Nichia 519A sm573 - 5700K D200 R9080 +$4.00"
					const ledName = optText
						.replace(/\s*\+?\$[\d.]+.*$/, '')  // Remove price suffix
						.replace(/&amp;/g, '&')             // Decode HTML entities
						.trim();
					if (ledName && ledName.length > 1 && !leds.includes(ledName)) {
						leds.push(ledName);
					}
				}
			}
			if (leds.length > 0) {
				specs.led = leds.slice(0, 2); // Primary LED(s) for standard led field
				if (leds.length > 2) {
					// Configurable product with multiple LED options
					specs.led_options = leds;
					if (!specs.features) specs.features = [];
					specs.features.push('configurable');
				}
			}

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
			// intl-outdoor base price from itemprop="price"; skip sub-$5 placeholders
			const basePrice = extractPagePrice(html);
			if (basePrice && basePrice >= 5) {
				specs.price_usd = basePrice;
			}
			// Surcharges are in <option price="N"> attrs (handled by JS on page)

			// Extract colors from body color dropdown
			const colors: string[] = [];
			// Magento uses <p> tags for option headings, not <label>
			const colorSelectRe = /<(?:label|p|div|span)[^>]*>([^<]*(?:Body\s*Color|Color|Finish)[^<]*)<\/(?:label|p|div|span)>[\s\S]*?<select[^>]*>([\s\S]*?)<\/select>/gi;
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
			// BigCommerce — no sitemap. Paginate multiple category pages.
			const urls: string[] = [];
			const categories = ['flashlights', 'weapon-lights', 'hands-free', 'helmet-lights'];

			for (const category of categories) {
				for (let page = 1; page <= 5; page++) {
					const pageUrl = page === 1
						? `https://www.surefire.com/${category}/`
						: `https://www.surefire.com/${category}/?page=${page}`;
					try {
						const html = await fetchPage(pageUrl);
						// SureFire product links are at root level: /product-slug/
						// Match both relative (/slug/) and absolute (https://www.surefire.com/slug/) URLs
						const reRel = /href=["'](\/[a-z0-9][a-z0-9-]*\/)["']/gi;
						const reAbs = /href=["'](https?:\/\/(?:www\.)?surefire\.com\/[a-z0-9][a-z0-9-]*\/)["']/gi;
						let m;
						while ((m = reRel.exec(html)) !== null) {
							const path = m[1];
							// Exclude non-product / navigation pages
							if (!/^\/(flashlights|weapon-lights|hands-free|helmet-lights|weaponlights|headlamps|account|cart|checkout|search|blog|about|contact|support|faq|warranty|pages|collections|categories|cdn|company|filtered|full-block|accessories|parts-accessories|suppressor-accessories|weaponlight-accessories)\/?$/i.test(path) &&
								path.length > 3 && path.length < 80) {
								const fullUrl = `https://www.surefire.com${path}`;
								if (!urls.includes(fullUrl)) urls.push(fullUrl);
							}
						}
						while ((m = reAbs.exec(html)) !== null) {
							const absPath = new URL(m[1]).pathname;
							if (!/^\/(flashlights|weapon-lights|hands-free|helmet-lights|weaponlights|headlamps|account|cart|checkout|search|blog|about|contact|support|faq|warranty|pages|collections|categories|cdn|company|filtered|full-block|accessories|parts-accessories|suppressor-accessories|weaponlight-accessories)\/?$/i.test(absPath) &&
								absPath.length > 3 && absPath.length < 80) {
								const fullUrl = `https://www.surefire.com${absPath}`;
								if (!urls.includes(fullUrl)) urls.push(fullUrl);
							}
						}
						// If page has no product links, stop paginating this category
						if (urls.length === 0 && page > 1) break;
						await Bun.sleep(CRAWL_DELAY);
					} catch { break; }
				}
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
			// CS-Cart platform — paginate /flashlights/models/ listing (4+ pages, ~95 products)
			const urls: string[] = [];
			const modelCategories: string[] = [];

			// Step 1: Paginate the models listing to find model family categories
			for (let page = 1; page <= 6; page++) {
				const listUrl = page === 1
					? 'https://www.armytek.com/flashlights/models/'
					: `https://www.armytek.com/flashlights/models/page-${page}/`;
				try {
					const html = await fetchPage(listUrl);
					// Match both relative and absolute URLs for model categories
					const reRel = /href=["'](\/flashlights\/models\/[a-z0-9-]+\/)["']/gi;
					const reAbs = /href=["'](https?:\/\/(?:www\.)?armytek\.com\/flashlights\/models\/[a-z0-9-]+\/)["']/gi;
					let m;
					while ((m = reRel.exec(html)) !== null) {
						const fullUrl = `https://www.armytek.com${m[1]}`;
						// Exclude non-model pages
						if (!/\/features\/|\/activity-hobby\/|\/types\/|\/accessories|\/batteries|\/charger|\/filters|\/page-\d/i.test(m[1]) &&
							!modelCategories.includes(fullUrl)) {
							modelCategories.push(fullUrl);
						}
					}
					while ((m = reAbs.exec(html)) !== null) {
						const fullUrl = m[1].replace(/^http:/, 'https:').replace('armytek.com', 'www.armytek.com');
						if (!/\/features\/|\/activity-hobby\/|\/types\/|\/accessories|\/batteries|\/charger|\/filters|\/page-\d/i.test(fullUrl) &&
							!modelCategories.includes(fullUrl)) {
							modelCategories.push(fullUrl);
						}
					}
					// Stop paginating if page returned no new categories
					const prevCount = modelCategories.length;
					if (page > 1 && prevCount === modelCategories.length) break;
					await Bun.sleep(CRAWL_DELAY);
				} catch { break; }
			}

			// Step 2: Crawl each model category to find individual product pages
			for (const catUrl of modelCategories) {
				try {
					const html = await fetchPage(catUrl);
					// Match both relative and absolute product URLs
					const reRel = /href=["'](\/flashlights\/models\/[a-z0-9-]+\/[a-z0-9-]+\/)["']/gi;
					const reAbs = /href=["'](https?:\/\/(?:www\.)?armytek\.com\/flashlights\/models\/[a-z0-9-]+\/[a-z0-9-]+\/)["']/gi;
					let m;
					while ((m = reRel.exec(html)) !== null) {
						const fullUrl = `https://www.armytek.com${m[1]}`;
						if (!urls.includes(fullUrl)) urls.push(fullUrl);
					}
					while ((m = reAbs.exec(html)) !== null) {
						const fullUrl = m[1].replace(/^http:/, 'https:').replace('armytek.com', 'www.armytek.com');
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
	{
		brand: 'Zebralight',
		async discoverUrls() {
			// Shift4Shop (3dcart) — has sitemap with product URLs
			const sitemapUrls = await parseSitemap('https://www.zebralight.com/sitemap.xml');
			return sitemapUrls.filter((u) => /_p_\d+\.html/.test(u));
		},
		extractProduct(url, html, text) {
			// Extract model from <h1> product title
			let model = '';
			const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/is);
			if (h1Match) {
				model = h1Match[1].replace(/<[^>]+>/g, '').trim();
			}
			if (!model) model = modelFromPath(url);

			// Skip accessories: holders, clips, batteries, headbands
			if (/\b(?:holder|clip|headband|battery|batteries|lanyard|charger)\b/i.test(model) &&
				!/flashlight|headlamp/i.test(model)) {
				return null;
			}

			const specs = extractSpecsFromText(text);

			// Zebralight dimension format: "Length: 4.2 inch (106 mm)" or "4.2 inches (106 mm)"
			const lenM = text.match(/length[:\s]*(\d+(?:\.\d+)?)\s*inch(?:es)?\s*\((\d+(?:\.\d+)?)\s*mm\)/i);
			if (lenM) specs.length_mm = parseFloat(lenM[2]);

			const headM = text.match(/head\s*(?:diameter)?[:\s]*(\d+(?:\.\d+)?)\s*inch(?:es)?\s*\((\d+(?:\.\d+)?)\s*mm\)/i);
			if (headM) specs.bezel_mm = parseFloat(headM[2]);

			const bodyM = text.match(/body\s*(?:diameter)?[:\s]*(\d+(?:\.\d+)?)\s*inch(?:es)?\s*\((\d+(?:\.\d+)?)\s*mm\)/i);
			if (bodyM) specs.body_mm = parseFloat(bodyM[2]);

			// Weight: "3.2 oz (91 grams)"
			const wtM = text.match(/(\d+(?:\.\d+)?)\s*oz\.?\s*\((\d+(?:\.\d+)?)\s*grams?\)/i);
			if (wtM) specs.weight_g = parseFloat(wtM[2]);

			// LED from title: "XHP70.3 HI" "XHP50.2" "XHP35" "LH351D"
			const ledM = model.match(/\b(XHP\d+(?:\.\d+)?(?:\s*HI)?|LH351D|SST-?\d+|519A|SFT\d+)\b/i);
			if (ledM && !specs.led?.length) specs.led = [ledM[1]];

			// Battery from text
			if (!specs.battery?.length) {
				if (/21700/i.test(text)) specs.battery = ['21700'];
				else if (/18650/i.test(text)) specs.battery = ['18650'];
				else if (/\bAA\b/.test(text)) specs.battery = ['AA'];
				else if (/\bCR123A?\b/i.test(text)) specs.battery = ['CR123A'];
			}

			// Material: always aluminum for Zebralight
			if (!specs.material?.length && /alumin/i.test(text)) {
				specs.material = ['aluminum'];
			}

			// Switch: electronic side switch
			if (!specs.switch?.length) {
				if (/electronic\s*(?:soft[- ]?touch\s*)?switch/i.test(text)) {
					specs.switch = ['side'];
				}
			}

			// IP rating
			const ipM = text.match(/IPX?(\d{1,2})/i);
			if (ipM) specs.environment = [`IPX${ipM[1]}`];

			// Zebralight features: PID thermal regulation, programmable
			if (!specs.features?.length) specs.features = [];
			if (/PID\s*thermal/i.test(text)) specs.features.push('thermal regulation');
			if (/programmable/i.test(text)) specs.features.push('programmable');

			// Parse multiple lumen levels from "H1: 2600 Lm"
			const lumens: number[] = [];
			const lmRe = /(\d{2,5})\s*Lm\b/gi;
			let lm;
			while ((lm = lmRe.exec(text)) !== null) {
				const val = parseInt(lm[1], 10);
				if (val > 0 && val < 100000 && !lumens.includes(val)) lumens.push(val);
			}
			if (lumens.length > 0) specs.lumens = lumens.sort((a, b) => b - a);

			// Type from model name
			if (/^H\d/i.test(model)) specs.type = ['headlamp'];
			else if (/^SC/i.test(model)) specs.type = ['flashlight'];

			// CCT and CRI
			const cctM = text.match(/(\d{4,5})\s*K\b/);
			if (cctM) specs.cct_k = parseInt(cctM[1], 10);
			const criM = text.match(/(\d+)\+?\s*CRI\b/i);
			if (criM) specs.cri = parseInt(criM[1], 10);

			const images = extractImages(html, url);
			const price = extractPagePrice(html);
			if (price) specs.price_usd = price;

			return buildEntryFromSpecs('Zebralight', model, specs, url, images);
		},
	},
	{
		brand: 'Pelican',
		// Pelican.com uses Cloudflare that blocks bun/node TLS fingerprints
		fetchFn: fetchWithCurl,
		async discoverUrls() {
			// Pelican corporate site — multiple category pages
			// Uses curl to bypass Cloudflare TLS fingerprint blocking
			const base = 'https://www.pelican.com';
			const categories = [
				'/us/en/products/flashlights',
				'/us/en/products/tactical-flashlights',
				'/us/en/products/headlamps',
				'/us/en/products/right-angle-lights',
				'/us/en/products/remote-area-lights',
			];
			const urls: string[] = [];
			for (const cat of categories) {
				try {
					const html = await fetchWithCurl(`${base}${cat}`);
					// Product URLs: /us/en/product/<category>/<model>
					const re = /href="([^"]*\/us\/en\/product\/(?:flashlights|tactical-flashlights|headlamps|right-angle-lights|remote-area-lights)\/[^"]+)"/gi;
					let m;
					while ((m = re.exec(html)) !== null) {
						const fullUrl = m[1].startsWith('http') ? m[1] : `${base}${m[1]}`;
						if (!urls.includes(fullUrl)) urls.push(fullUrl);
					}
				} catch (err) {
					console.log(`    Pelican ${cat} error: ${(err as Error).message}`);
				}
			}
			return urls;
		},
		extractProduct(url, html, _text) {
			// --- Model name from <h1> or JSON-LD ---
			let model = '';
			const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/is);
			if (h1Match) model = h1Match[1].replace(/<[^>]+>/g, '').trim();
			if (!model) {
				// Fallback: title tag "2780 Headlamp"
				const titleM = html.match(/<title>\s*(.*?)\s*<\/title>/i);
				if (titleM) model = titleM[1].split('|')[0].trim();
			}
			if (!model) return null;

			// Skip accessories
			if (/\b(?:battery|batteries|charger|case|bag|strap|clip|wand|cone|filter)\b/i.test(model) &&
				!/flashlight|headlamp|headlight|lantern|light/i.test(model)) {
				return null;
			}

			const specs: Partial<ExtractionResult> = {};

			// --- Type from model name ---
			if (/headlamp|headlight/i.test(model)) specs.type = ['headlamp'];
			else if (/lantern/i.test(model)) specs.type = ['lantern'];
			else if (/right.?angle/i.test(model)) specs.type = ['right-angle'];
			else specs.type = ['flashlight'];

			// --- Price from JSON-LD (nested in offers object) ---
			const jsonLd = html.match(/"@context"\s*:\s*"http:\/\/schema\.org"[\s\S]*?"offers"[\s\S]*?"price"\s*:\s*"?([\d.]+)"?/);
			if (jsonLd) specs.price_usd = parseFloat(jsonLd[1]);

			// --- Extract spec rows from product-specs-table ---
			// Format: <div>Key</div> ... <div>Value</div> in paired col-md-6 divs
			// Table ends at ansi-fl1-section or component-section boundary
			const specTable = html.match(/product-specs-table[\s\S]*?(?=ansi-fl1|component-section|<\/section)/);
			if (specTable) {
				const rowRe = /<div class="col-md-6">\s*<div>([\s\S]*?)<\/div>\s*<\/div>\s*<div class="col-md-6">\s*<div>([\s\S]*?)<\/div>/gi;
				let rm;
				while ((rm = rowRe.exec(specTable[0])) !== null) {
					const key = rm[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
					const val = rm[2].replace(/<[^>]+>/g, '').trim();
					if (!val || val === '-' || val === 'N/A') continue;

					switch (key) {
						case 'length': {
							// "3.00" (7.6 cm)" or "6.32" (16.1 cm)"
							const cmM = val.match(/\((\d+(?:\.\d+)?)\s*cm\)/);
							if (cmM) specs.length_mm = parseFloat(cmM[1]) * 10;
							else {
								// inches: "6.32""
								const inM = val.match(/([\d.]+)\s*[""]/);
								if (inM) specs.length_mm = parseFloat(inM[1]) * 25.4;
							}
							break;
						}
						case 'weight with batteries':
						case 'weight w/ batteries': {
							// "8.8 oz (249.48 g)"
							const gM = val.match(/\((\d+(?:\.\d+)?)\s*g\)/);
							if (gM) specs.weight_g = parseFloat(gM[1]);
							else {
								const ozM = val.match(/([\d.]+)\s*oz/);
								if (ozM) specs.weight_g = parseFloat(ozM[1]) * 28.3495;
							}
							break;
						}
						case 'weight no batteries': {
							// Use this only if we don't have "with batteries" weight
							if (!specs.weight_g) {
								const gM = val.match(/\((\d+(?:\.\d+)?)\s*g\)/);
								if (gM) specs.weight_g = parseFloat(gM[1]);
							}
							break;
						}
						case 'switch type':
							specs.switch = val.split(/\s*[\/,]\s*/).map((s: string) => s.toLowerCase().trim()).filter(Boolean);
							break;
						case 'battery size':
							specs.battery = val.split(/\s*[\/,]\s*/).filter(Boolean);
							break;
						case 'body material':
							specs.material = [val];
							break;
						case 'lamp type':
						case 'lamp secondary type':
							if (val.toLowerCase() !== 'led' && !specs.led?.length) {
								specs.led = [val];
							}
							break;
						case 'rechargeable':
							if (val.toLowerCase() === 'yes') {
								if (!specs.charging) specs.charging = [];
								specs.charging.push('USB');
							}
							break;
						case 'light modes': {
							specs.modes = val.split(/\s*[\/,]\s*/).map((s: string) => s.toLowerCase().trim()).filter(Boolean);
							break;
						}
					}
				}
			}

			// --- ANSI FL1 table: lumens, runtime, beam distance, candela ---
			const fl1Table = html.match(/ansifl1-table[\s\S]*?<\/table>/);
			if (fl1Table) {
				const tbl = fl1Table[0];

				// Lumens: <td>430<br><span...>LUMENS</span></td>
				const lumens: number[] = [];
				const lumRe = /(\d[\d,]*)\s*<br\s*\/?>\s*<span[^>]*>\s*LUMENS/gi;
				let lm;
				while ((lm = lumRe.exec(tbl)) !== null) {
					const v = parseInt(lm[1].replace(/,/g, ''), 10);
					if (v > 0 && !lumens.includes(v)) lumens.push(v);
				}
				if (lumens.length > 0) specs.lumens = lumens.sort((a, b) => b - a);

				// Beam distance: <td>124m</td>
				const beams: number[] = [];
				const beamRe = /<td[^>]*>\s*(\d+)\s*m\s*<\/td>/gi;
				let bm;
				while ((bm = beamRe.exec(tbl)) !== null) {
					const v = parseInt(bm[1], 10);
					if (v > 0 && !beams.includes(v)) beams.push(v);
				}
				if (beams.length > 0) specs.throw_m = Math.max(...beams);

				// Candela: <td>3868cd</td>
				const candelas: number[] = [];
				const cdRe = /<td[^>]*>\s*([\d,]+)\s*cd\s*<\/td>/gi;
				let cd;
				while ((cd = cdRe.exec(tbl)) !== null) {
					const v = parseInt(cd[1].replace(/,/g, ''), 10);
					if (v > 0) candelas.push(v);
				}
				if (candelas.length > 0) specs.intensity_cd = Math.max(...candelas);

				// Runtime: "1h 30min" or "3h" or "12h 00min"
				const runtimes: number[] = [];
				const rtRe = /(\d+)h\s*(?:(\d+)\s*min)?/gi;
				let rt;
				while ((rt = rtRe.exec(tbl)) !== null) {
					const hrs = parseInt(rt[1], 10);
					const mins = rt[2] ? parseInt(rt[2], 10) : 0;
					const total = hrs + mins / 60;
					if (total > 0 && !runtimes.includes(total)) runtimes.push(total);
				}
				if (runtimes.length > 0) specs.runtime_hours = runtimes.sort((a, b) => a - b);

				// IPX rating from FL1 table
				const ipxM = tbl.match(/IPX(\d)/i);
				if (ipxM) specs.environment = [`IPX${ipxM[1]}`];

				// Impact/drop resistance from FL1 table — row after drop.gif icon
				const dropM = tbl.match(/drop\.gif[\s\S]*?<td[^>]*colspan[^>]*>\s*(\d+(?:\.\d+)?)\s*m\s*<\/td>/i);
				if (dropM) specs.impact = [`${dropM[1]}m drop`];
			}

			// --- Images from product gallery (only product images, not navbar/footer) ---
			const images: string[] = [];
			// Extract from Vue :product prop images array for exact product images
			const imgArrayRe = /"complete_url"\s*:\s*"([^"]+)"/g;
			let im;
			while ((im = imgArrayRe.exec(html)) !== null) {
				const src = im[1].replace(/\\\//g, '/');
				if (!images.includes(src)) images.push(src);
			}
			// Fallback: S3 URLs only from product section (skip navbar images)
			if (images.length === 0) {
				const productSection = html.match(/product-main-image[\s\S]*?product-specs/);
				const section = productSection ? productSection[0] : html;
				const s3Re = /https:\/\/pelicanweb-prod\.s3[^"'\s]+\.(?:jpg|png|webp)/gi;
				while ((im = s3Re.exec(section)) !== null) {
					const src = im[0];
					if (!images.includes(src) && !/icon|logo|badge|navbar/i.test(src)) {
						images.push(src);
					}
				}
			}

			// --- Colors from Vue :product prop (product_color.name) ---
			const colorMatches: string[] = [];
			const colorRe = /"product_color"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/g;
			let cm;
			while ((cm = colorRe.exec(html)) !== null) {
				// Color name like "Black \/ White \/ Photoluminescent" (JSON-escaped slashes)
				const colorParts = cm[1].replace(/\\\//g, '/').split('/').map((c: string) => c.trim().toLowerCase()).filter(Boolean);
				for (const c of colorParts) {
					if (/^(black|white|yellow|red|blue|green|orange|silver|gray|grey|tan|olive|coyote|photoluminescent|pink|purple|hi-?vis|desert tan)$/i.test(c)) {
						if (!colorMatches.includes(c)) colorMatches.push(c);
					}
				}
			}
			if (colorMatches.length > 0) specs.color = colorMatches;

			// --- Features ---
			if (!specs.features) specs.features = [];
			if (/IPX[78]/i.test(html)) specs.features.push('waterproof');
			if (/rechargeable/i.test(html) && specs.charging?.length) specs.features.push('rechargeable');
			if (/glow.?in.?the.?dark|photoluminescent/i.test(html)) specs.features.push('glow-in-the-dark');
			if (/downcast/i.test(html)) specs.features.push('downcast LED');
			if (/pivoting|pivot/i.test(html)) specs.features.push('pivoting head');

			// LED: Pelican uses generic "LED" but some have specific types in description
			if (!specs.led?.length) specs.led = ['LED'];

			const entry = buildEntryFromSpecs('Pelican', model, specs, url, images.slice(0, 5));

			// Add Shopify purchase URL from Vue :product prop
			const handleMatch = html.match(/"handle"\s*:\s*"([^"]+)"/);
			if (handleMatch) {
				entry.purchase_urls = [`https://shop.pelican.com/products/${handleMatch[1]}`];
			}

			return entry;
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

	// Use custom fetch function if available (e.g. curl for Cloudflare-protected sites)
	const fetchFn = crawler.fetchFn ?? fetchPage;

	for (let i = 0; i < urls.length; i++) {
		const url = urls[i];
		try {
			const html = await fetchFn(url);
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
