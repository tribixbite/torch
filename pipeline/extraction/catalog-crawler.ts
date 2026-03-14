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
