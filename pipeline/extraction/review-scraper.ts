/**
 * Review site scraper — discovers flashlight review pages, extracts spec tables,
 * and merges extracted data into existing database entries.
 *
 * Currently supports zakreviews.com. Additional review sites can be added by
 * implementing a SiteConfig and registering it in REVIEW_SITES.
 *
 * Only updates EXISTING entries (never creates new ones). Only fills MISSING
 * fields (never overwrites existing data).
 */
import { getAllFlashlights, upsertFlashlight, addSource, addRawSpecText } from '../store/db.js';
import type { FlashlightEntry } from '../schema/canonical.js';
import { fetchPage, htmlToText } from './manufacturer-scraper.js';

const CRAWL_DELAY = 1500; // 1.5s between requests

// ─── Site configuration ────────────────────────────────────────────────────────

/** Configuration for a review site scraper */
interface SiteConfig {
	/** Human-readable name */
	name: string;
	/** Base URL (no trailing slash) */
	baseUrl: string;
	/** Discover all review URLs from the site */
	discoverUrls: (maxPages?: number) => Promise<string[]>;
	/** Extract brand + model + specs from a review page HTML */
	parseReview: (html: string, url: string) => ParsedReview | null;
}

/** Data extracted from a single review page */
interface ParsedReview {
	brand: string;
	model: string;
	specs: Partial<ExtractedSpecs>;
	rawSpecText: string;
}

/** Spec fields we can extract from review tables */
interface ExtractedSpecs {
	lumens: number[];
	throw_m: number;
	intensity_cd: number;
	runtime_hours: number[];
	length_mm: number;
	weight_g: number;
	bezel_mm: number;
	body_mm: number;
	led: string[];
	battery: string[];
	switch: string[];
	material: string[];
	cri: number;
	cct: number;
	price_usd: number;
	charging: string[];
	environment: string[];
	features: string[];
}

// ─── ZakReviews site implementation ────────────────────────────────────────────

/**
 * Discover all review URLs from zakreviews.com by crawling paginated index pages.
 * Page 1 is index.html, pages 2-N are index2.html through indexN.html.
 */
async function discoverZakReviewUrls(maxPages = 20): Promise<string[]> {
	const baseUrl = 'https://zakreviews.com';
	const urls = new Set<string>();

	for (let page = 1; page <= maxPages; page++) {
		const indexUrl = page === 1 ? `${baseUrl}/index.html` : `${baseUrl}/index${page}.html`;
		console.log(`  Fetching index page ${page}: ${indexUrl}`);

		try {
			const html = await fetchPage(indexUrl);

			// Extract all .html links from the page content area
			const linkRe = /href="([^"]*\.html)"/gi;
			let match;
			while ((match = linkRe.exec(html)) !== null) {
				let href = match[1];

				// Skip non-review pages (index, category, tag, arbitrary list pages)
				if (/^index\d*\.html$/.test(href)) continue;
				if (/^category\//.test(href)) continue;
				if (/^tag\//.test(href)) continue;
				if (/^categories\.html$/.test(href)) continue;
				if (/^arbitrary-list/.test(href)) continue;
				if (/^flashlight-of-the-year/.test(href)) continue;

				// Normalize to absolute URL
				if (!href.startsWith('http')) {
					href = href.startsWith('/') ? `${baseUrl}${href}` : `${baseUrl}/${href}`;
				}

				// Only include zakreviews.com URLs
				if (href.startsWith(baseUrl)) {
					urls.add(href);
				}
			}

			await Bun.sleep(CRAWL_DELAY);
		} catch (err) {
			// 404 means no more pages
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('404')) {
				console.log(`  Page ${page} returned 404 — end of index pages`);
				break;
			}
			console.warn(`  Error fetching page ${page}: ${msg}`);
			break;
		}
	}

	return Array.from(urls);
}

/**
 * Parse a zakreviews.com review page.
 * Extracts brand/model from the title and specs from the specification table.
 */
function parseZakReview(html: string, url: string): ParsedReview | null {
	// Extract title: "Review: Brand Model - description..."
	const titleMatch = html.match(/<title>\s*Review:\s*(.+?)\s*(?:-|–|—)\s/i);
	if (!titleMatch) return null; // Not a review page

	const titleText = titleMatch[1].trim();
	// Brand is the first word, model is the rest
	const parts = titleText.split(/\s+/);
	if (parts.length < 2) return null;

	const brand = parts[0];
	const model = parts.slice(1).join(' ');

	// Extract the specifications table
	// The spec table appears after <h2 id="section1">Specifications</h2>
	const specTableMatch = html.match(
		/<h2[^>]*>Specifications<\/h2>\s*<table>([\s\S]*?)<\/table>/i,
	);
	if (!specTableMatch) {
		console.warn(`  No spec table found in ${url}`);
		return null;
	}

	const tableHtml = specTableMatch[1];
	const specs = parseSpecTable(tableHtml);

	// Build raw spec text for debugging/AI parsing
	const rawText = htmlToText(specTableMatch[0]);

	return { brand, model, specs, rawSpecText: rawText };
}

/**
 * Parse spec rows from a zakreviews two-column table.
 * Each row has a label (td[0]) and a value (td[1]).
 */
function parseSpecTable(tableHtml: string): Partial<ExtractedSpecs> {
	const specs: Partial<ExtractedSpecs> = {};

	// Extract all rows from tbody
	const rowRe = /<tr>\s*<td>([^<]*)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi;
	let row;

	while ((row = rowRe.exec(tableHtml)) !== null) {
		const label = row[1].trim().toLowerCase();
		// Strip HTML tags from value, decode entities
		const rawValue = row[2]
			.replace(/<[^>]+>/g, '')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&nbsp;/g, ' ')
			.trim();

		// Map label to spec field
		parseSpecRow(label, rawValue, specs);
	}

	return specs;
}

/**
 * Map a single spec table row (label + value) to the appropriate ExtractedSpecs field.
 * Handles the various label formats found on zakreviews.com.
 */
function parseSpecRow(label: string, value: string, specs: Partial<ExtractedSpecs>): void {
	// === BATTERY ===
	if (label === 'battery' || label === 'batteries') {
		const batteries = parseBatteryValue(value);
		if (batteries.length > 0) specs.battery = batteries;
	}

	// === LED ===
	else if (label === 'led' || label === 'leds' || label === 'emitter' || label === 'emitters') {
		const leds = parseLedValue(value);
		if (leds.length > 0) specs.led = leds;
	}

	// === MAX OUTPUT (lumens) ===
	else if (/^max\s*output/.test(label) && !/sustainable/.test(label) && !/50%/.test(label)) {
		const m = value.match(/(\d[\d,]*)\s*(?:lm|lumens?)?/i);
		if (m) {
			const lm = parseInt(m[1].replace(/,/g, ''), 10);
			if (lm > 0 && lm < 1_000_000) {
				specs.lumens = [lm];
			}
		}
	}

	// === MAX THROW ===
	else if (/^max\s*throw/.test(label)) {
		const m = value.match(/(\d[\d,]*)\s*m/i);
		if (m) {
			const throwVal = parseInt(m[1].replace(/,/g, ''), 10);
			if (throwVal >= 5 && throwVal <= 5000) {
				specs.throw_m = throwVal;
			}
		}
	}

	// === INTENSITY (candela) ===
	else if (/candela|intensity/.test(label)) {
		const m = value.match(/(\d[\d,]*)\s*(?:cd|candela)?/i);
		if (m) {
			specs.intensity_cd = parseInt(m[1].replace(/,/g, ''), 10);
		}
	}

	// === LENGTH ===
	else if (label === 'length' || label === 'overall length') {
		const mmMatch = value.match(/(\d+(?:\.\d+)?)\s*mm/i);
		if (mmMatch) {
			specs.length_mm = parseFloat(mmMatch[1]);
		} else {
			// Inches: "5.74 inches" or "5.74in"
			const inMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:in(?:ches?)?|")/i);
			if (inMatch) {
				specs.length_mm = Math.round(parseFloat(inMatch[1]) * 25.4);
			} else {
				// cm: "12.5 cm"
				const cmMatch = value.match(/(\d+(?:\.\d+)?)\s*cm/i);
				if (cmMatch) {
					specs.length_mm = Math.round(parseFloat(cmMatch[1]) * 10);
				}
			}
		}
	}

	// === HEAD/BEZEL DIAMETER ===
	else if (/^head\s*(?:diameter)?$/.test(label) || /^bezel\s*(?:diameter)?$/.test(label)) {
		const m = value.match(/(\d+(?:\.\d+)?)\s*mm/i);
		if (m) specs.bezel_mm = parseFloat(m[1]);
	}

	// === BODY/TUBE DIAMETER ===
	else if (/^body\s*(?:diameter)?$/.test(label) || /^tube\s*(?:diameter)?$/.test(label)) {
		const m = value.match(/(\d+(?:\.\d+)?)\s*mm/i);
		if (m) specs.body_mm = parseFloat(m[1]);
	}

	// === WEIGHT (without battery) ===
	else if (label === 'weight') {
		const gMatch = value.match(/(\d+(?:\.\d+)?)\s*g(?:rams?)?\b/i);
		if (gMatch) {
			specs.weight_g = parseFloat(gMatch[1]);
		} else {
			const ozMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:oz\.?|ounces?)/i);
			if (ozMatch) {
				specs.weight_g = Math.round(parseFloat(ozMatch[1]) * 28.35);
			}
		}
	}

	// === CRI ===
	else if (/color\s*rendering|^cri$/.test(label)) {
		const m = value.match(/(\d+(?:\.\d+)?)/);
		if (m) {
			const cri = parseFloat(m[1]);
			if (cri >= 50 && cri <= 100) specs.cri = Math.round(cri);
		}
	}

	// === CCT (Color Temperature) ===
	else if (/color\s*temp/.test(label) || label === 'cct') {
		// May be a range like "3957-4136K" — take the first value
		const m = value.match(/(\d{4,5})\s*K?\b/);
		if (m) {
			const cct = parseInt(m[1], 10);
			if (cct >= 1800 && cct <= 10000) specs.cct = cct;
		}
	}

	// === PRICE ===
	else if (/price|cost|msrp/.test(label)) {
		// "$100" or "$20-25" (take first value) or "~$100"
		const m = value.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
		if (m) {
			const price = parseFloat(m[1]);
			if (price > 0 && price < 10000) specs.price_usd = price;
		}
	}

	// === CHARGING ===
	else if (/^charging$/.test(label)) {
		const charging: string[] = [];
		if (/usb[\s-]?c\b|type[\s-]?c\b/i.test(value)) charging.push('USB-C');
		if (/micro[\s-]?usb/i.test(value)) charging.push('Micro-USB');
		if (/magnetic/i.test(value)) charging.push('magnetic');
		if (/usb[\s-]?a\b/i.test(value)) charging.push('USB-A');
		// "USB-magnetic" is a Skilhunt thing
		if (/usb[\s-]?magnetic/i.test(value)) {
			if (!charging.includes('magnetic')) charging.push('magnetic');
		}
		if (charging.length > 0) specs.charging = charging;
	}

	// === WATER RESISTANCE / IP RATING ===
	else if (/water|ip\s*rating|resistance|submersible/.test(label)) {
		const ipMatch = value.match(/IP[X\-]?(\d{1,2})/i);
		if (ipMatch) {
			const rating = ipMatch[1].length === 1 ? `IPX${ipMatch[1]}` : `IP${ipMatch[1]}`;
			specs.environment = [rating];
		}
	}

	// === SWITCH ===
	else if (/^switch(?:es)?$/.test(label)) {
		const switches: string[] = [];
		if (/tail/i.test(value)) switches.push('tail');
		if (/side/i.test(value)) switches.push('side');
		if (/dual/i.test(value)) switches.push('dual');
		if (/rotary|twist/i.test(value)) switches.push('rotary');
		if (switches.length > 0) specs.switch = switches;
	}

	// === MATERIAL ===
	else if (/^(?:body\s*)?material$/.test(label)) {
		const materials: string[] = [];
		if (/aluminum|aluminium|6061/i.test(value)) materials.push('aluminum');
		if (/titanium/i.test(value)) materials.push('titanium');
		if (/copper/i.test(value)) materials.push('copper');
		if (/brass/i.test(value)) materials.push('brass');
		if (/stainless/i.test(value)) materials.push('stainless steel');
		if (/polymer|plastic|nylon|polycarbonate/i.test(value)) materials.push('polymer');
		if (materials.length > 0) specs.material = materials;
	}
}

/**
 * Parse battery value strings like "1x21700", "18350", "1xAA, 1x14500", "2x18650".
 */
function parseBatteryValue(value: string): string[] {
	const batteries: string[] = [];
	const patterns: [RegExp, string][] = [
		[/21700/i, '21700'], [/18650/i, '18650'], [/18350/i, '18350'],
		[/16340/i, '16340'], [/14500/i, '14500'], [/CR123A?/i, 'CR123A'],
		[/26650/i, '26650'], [/26800/i, '26800'],
		[/\bAA\b(?!A)/, 'AA'], [/\bAAA\b/, 'AAA'],
	];
	for (const [re, name] of patterns) {
		if (re.test(value) && !batteries.includes(name)) batteries.push(name);
	}
	return batteries;
}

/**
 * Parse LED value strings like "Nichia 519A", "Nichia 519A, or unspecified cool white LED".
 * Returns normalized LED identifiers.
 */
function parseLedValue(value: string): string[] {
	const leds: string[] = [];
	const ledPatterns: [RegExp, string][] = [
		[/\bLuminus\s+SFT[\s-]?70\b/i, 'Luminus SFT70'],
		[/\bLuminus\s+SFT[\s-]?40\b/i, 'Luminus SFT40'],
		[/\bSST[\s-]?10\b/i, 'SST-10'], [/\bSST[\s-]?20\b/i, 'SST-20'],
		[/\bSST[\s-]?40\b/i, 'SST-40'], [/\bSST[\s-]?70\b/i, 'SST-70'],
		[/\bSFT[\s-]?40\b/i, 'SFT-40'], [/\bSFT[\s-]?42\b/i, 'SFT-42'],
		[/\bSFT[\s-]?70\b/i, 'SFT-70'], [/\bSFT[\s-]?90\b/i, 'SFT-90'],
		[/\bSBT[\s-]?90\b/i, 'SBT-90'],
		[/\bXHP[\s-]?50(?:\.\d)?\b/i, 'XHP50'], [/\bXHP[\s-]?70(?:\.\d)?\b/i, 'XHP70'],
		[/\bXM[\s-]?L2?\b/i, 'XM-L2'], [/\bXP[\s-]?L\s*(?:HI|HD|V6)?\b/i, 'XP-L'],
		[/\bXP[\s-]?G[23S]?\b/i, 'XP-G'], [/\bXP[\s-]?E2?\b/i, 'XP-E'],
		[/\b519A\b/, '519A'], [/\b219[BCF]\b/, '219B'], [/\b319A\b/, '319A'],
		[/\bLH351D\b/i, 'LH351D'], [/\bE21A\b/, 'E21A'],
		[/\bOSRAM\b/i, 'Osram'], [/\bCOB\b/, 'COB'], [/\bLEP\b/, 'LEP'],
		[/\b7070\b/, '7070'], [/\bNichia\b/i, 'Nichia'],
		[/\bCree\s+XHP/i, 'Cree XHP'], [/\bCree\s+XP/i, 'Cree XP'],
		[/\bGT[\s-]?FC40\b/i, 'GT-FC40'], [/\bFC40\b/i, 'FC40'],
		[/\bC4\s*LED\b/i, 'C4'],
		[/\bLUXEON\s+TX\b/i, 'Luxeon TX'],
		[/\b144A\b/, '144A'],
	];
	for (const [re, name] of ledPatterns) {
		if (re.test(value) && !leds.includes(name)) leds.push(name);
	}
	return leds;
}

// ─── 1Lumen site implementation ──────────────────────────────────────────────

/**
 * Discover review URLs from 1lumen.com via sitemap.
 * Sitemap index at /sitemaps.xml → /post-sitemap1.xml with all ~942 review URLs.
 */
async function discover1LumenUrls(_maxPages = 20): Promise<string[]> {
	const urls = new Set<string>();

	try {
		console.log('  Fetching 1lumen sitemap index...');
		const sitemapIndex = await fetchPage('https://1lumen.com/sitemaps.xml');
		// Extract post-sitemap URLs
		const sitemapRe = /<loc>(https:\/\/1lumen\.com\/post-sitemap\d*\.xml)<\/loc>/gi;
		const sitemapUrls: string[] = [];
		let sm;
		while ((sm = sitemapRe.exec(sitemapIndex)) !== null) {
			sitemapUrls.push(sm[1]);
		}
		if (sitemapUrls.length === 0) {
			// Fallback: try direct URL
			sitemapUrls.push('https://1lumen.com/post-sitemap1.xml');
		}

		for (const smUrl of sitemapUrls) {
			console.log(`  Fetching sitemap: ${smUrl}`);
			const xml = await fetchPage(smUrl);
			// Handle both plain and CDATA-wrapped URLs
			const locRe = /<loc>(?:<!\[CDATA\[)?(https:\/\/1lumen\.com\/review\/[^\]<]+?)(?:\]\]>)?<\/loc>/gi;
			let loc;
			while ((loc = locRe.exec(xml)) !== null) {
				urls.add(loc[1].trim());
			}
			console.log(`  Found ${urls.size} review URLs so far`);
			await Bun.sleep(CRAWL_DELAY);
		}
	} catch (err) {
		console.warn(`  Error fetching 1lumen sitemap: ${err instanceof Error ? err.message : err}`);
	}

	return Array.from(urls);
}

/**
 * Parse a 1lumen.com review page.
 * Specs in wp-block-table with striped style. Brand+model from h1 or thead.
 * Separate dimensions table (3 cols: name, mm, inches) and weight table.
 */
function parse1LumenReview(html: string, url: string): ParsedReview | null {
	// Extract brand + model from <h1 class="entry-title">
	const h1Match = html.match(/<h1[^>]*class="entry-title"[^>]*>([^<]+)<\/h1>/i);
	if (!h1Match) return null;

	const fullTitle = h1Match[1].trim();
	const parts = fullTitle.split(/\s+/);
	if (parts.length < 2) return null;

	const brand = parts[0];
	const model = parts.slice(1).join(' ');

	const specs: Partial<ExtractedSpecs> = {};

	// Find all tables in wp-block-table figures
	const tableRe = /<figure[^>]*class="wp-block-table[^"]*"[^>]*>\s*<table[^>]*>([\s\S]*?)<\/table>/gi;
	let tableMatch;
	const tables: string[] = [];
	while ((tableMatch = tableRe.exec(html)) !== null) {
		tables.push(tableMatch[1]);
	}

	for (const table of tables) {
		const theadLower = table.toLowerCase();

		// Detect table type by thead content
		if (/brand\s*[&\/]/i.test(theadLower) || /brand\/model/i.test(theadLower)) {
			// Main spec table — two-column key-value
			parseMainSpecTable1Lumen(table, specs);
		} else if (/millimeters/i.test(theadLower)) {
			// Dimensions table
			parseDimensionsTable1Lumen(table, specs);
		} else if (/weight\s*in\s*grams/i.test(theadLower) || /weight\s*in\s*oz/i.test(theadLower)) {
			// Weight table
			parseWeightTable1Lumen(table, specs);
		}
	}

	// Also try expanded format (newer reviews with sections like "Dimensions:", "LED & Beam")
	parseExpandedSpec1Lumen(html, specs);

	const rawText = htmlToText(tables.join('\n'));
	return { brand, model, specs, rawSpecText: rawText };
}

/** Parse 1lumen main spec table (two-column label-value) */
function parseMainSpecTable1Lumen(table: string, specs: Partial<ExtractedSpecs>): void {
	const rowRe = /<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi;
	let row;
	while ((row = rowRe.exec(table)) !== null) {
		const label = row[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
		const value = row[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();

		if (/^led\b|^led\s*type/i.test(label)) {
			const leds = parseLedValue(value);
			if (leds.length > 0 && !specs.led?.length) specs.led = leds;
		} else if (/max\.?\s*output|max\.?\s*lumens|specified\s*output/i.test(label)) {
			const m = value.match(/(\d[\d,]*)\s*(?:lm|lumens?)?/i);
			if (m) {
				const lm = parseInt(m[1].replace(/,/g, ''), 10);
				if (lm > 0 && lm < 1_000_000 && !specs.lumens?.length) specs.lumens = [lm];
			}
		} else if (/max\.?\s*beam\s*distance|specified\s*beam\s*distance/i.test(label)) {
			const m = value.match(/(\d[\d,]*)\s*m(?:eters?)?/i);
			if (m) {
				const t = parseInt(m[1].replace(/,/g, ''), 10);
				if (t >= 5 && t <= 5000 && !specs.throw_m) specs.throw_m = t;
			}
		} else if (/max\.?\s*beam\s*intensity|specified\s*beam\s*intensity/i.test(label)) {
			// "39,240 cd" or combined "5,875 cd / 153 meters"
			const m = value.match(/(\d[\d,]*)\s*cd/i);
			if (m && !specs.intensity_cd) specs.intensity_cd = parseInt(m[1].replace(/,/g, ''), 10);
			// Also grab throw from combined field
			const tm = value.match(/(\d[\d,]*)\s*m(?:eters?)?/i);
			if (tm && !specs.throw_m) {
				const t = parseInt(tm[1].replace(/,/g, ''), 10);
				if (t >= 5 && t <= 5000) specs.throw_m = t;
			}
		} else if (/battery\s*config/i.test(label)) {
			const batteries = parseBatteryValue(value);
			if (batteries.length > 0 && !specs.battery?.length) specs.battery = batteries;
		} else if (/switch\s*type/i.test(label)) {
			const switches: string[] = [];
			if (/tail/i.test(value)) switches.push('tail');
			if (/side/i.test(value)) switches.push('side');
			if (/rotary|twist/i.test(value)) switches.push('rotary');
			if (/dual/i.test(value)) switches.push('dual');
			if (/electronic|e-switch/i.test(value) && switches.length === 0) switches.push('side');
			if (switches.length > 0 && !specs.switch?.length) specs.switch = switches;
		} else if (/waterproof|water\s*resistance/i.test(label)) {
			const ipMatch = value.match(/IP[X\-]?(\d{1,2})/i);
			if (ipMatch && !specs.environment?.length) {
				const rating = ipMatch[1].length === 1 ? `IPX${ipMatch[1]}` : `IP${ipMatch[1]}`;
				specs.environment = [rating];
			}
		} else if (/onboard\s*charging/i.test(label)) {
			if (/usb[\s-]?c|type[\s-]?c/i.test(value) && !specs.charging?.length) specs.charging = ['USB-C'];
			else if (/micro[\s-]?usb/i.test(value) && !specs.charging?.length) specs.charging = ['Micro-USB'];
			else if (/magnetic/i.test(value) && !specs.charging?.length) specs.charging = ['magnetic'];
		}
		// Length/weight from expanded table within main spec
		else if (label === 'length') {
			const mm = value.match(/(\d+(?:\.\d+)?)\s*mm/i);
			if (mm && !specs.length_mm) specs.length_mm = parseFloat(mm[1]);
		} else if (/weight\s*with\s*battery/i.test(label) || label === 'weight') {
			const g = value.match(/(\d+(?:\.\d+)?)\s*g\b/i);
			if (g && !specs.weight_g) specs.weight_g = parseFloat(g[1]);
		}
	}
}

/** Parse 1lumen dimensions table (3 columns: label, mm, inches) */
function parseDimensionsTable1Lumen(table: string, specs: Partial<ExtractedSpecs>): void {
	const rowRe = /<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>/gi;
	let row;
	while ((row = rowRe.exec(table)) !== null) {
		const label = row[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
		const value = row[2].replace(/<[^>]+>/g, '').trim();
		const mm = value.match(/(\d+(?:\.\d+)?)\s*mm/i);
		if (!mm) continue;
		const v = parseFloat(mm[1]);

		if (label === 'length' && !specs.length_mm && v >= 15 && v <= 1000) {
			specs.length_mm = v;
		} else if (/head\s*diameter|bezel/i.test(label) && !specs.bezel_mm) {
			specs.bezel_mm = v;
		} else if (/body\s*diameter/i.test(label) && !specs.body_mm) {
			specs.body_mm = v;
		}
	}
}

/** Parse 1lumen weight table */
function parseWeightTable1Lumen(table: string, specs: Partial<ExtractedSpecs>): void {
	const rowRe = /<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>/gi;
	let row;
	while ((row = rowRe.exec(table)) !== null) {
		const label = row[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
		const value = row[2].replace(/<[^>]+>/g, '').trim();
		const g = value.match(/(\d+(?:\.\d+)?)\s*g\b/i);
		if (!g) continue;

		// Prefer "without battery" weight, but take "with battery" if that's all we have
		if (/without\s*battery/i.test(label) && !specs.weight_g) {
			specs.weight_g = parseFloat(g[1]);
		} else if (/with\s*battery/i.test(label) && !specs.weight_g) {
			specs.weight_g = parseFloat(g[1]);
		}
	}
}

/** Parse 1lumen expanded format (2024+ reviews with section headers in main table) */
function parseExpandedSpec1Lumen(html: string, specs: Partial<ExtractedSpecs>): void {
	// These newer reviews have rows like <td><strong>Dimensions:</strong></td><td></td>
	// followed by data rows. We already parse normal rows, but let's grab specifics.
	const expandedRe = /<tr>\s*<td>([^<]*(?:<strong>[^<]*<\/strong>[^<]*)?)<\/td>\s*<td>([^<]*)<\/td>\s*<\/tr>/gi;
	let row;
	while ((row = expandedRe.exec(html)) !== null) {
		const label = row[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
		const value = row[2].trim();

		if (/^specified\s*output/i.test(label)) {
			const m = value.match(/(\d[\d,]*)\s*(?:lm|lumens?)?/i);
			if (m && !specs.lumens?.length) {
				const lm = parseInt(m[1].replace(/,/g, ''), 10);
				if (lm > 0 && lm < 1_000_000) specs.lumens = [lm];
			}
		} else if (/^specified\s*beam\s*distance/i.test(label)) {
			const m = value.match(/(\d+)\s*m/i);
			if (m && !specs.throw_m) {
				const t = parseInt(m[1], 10);
				if (t >= 5 && t <= 5000) specs.throw_m = t;
			}
		} else if (/^specified\s*beam\s*intensity/i.test(label)) {
			const m = value.match(/(\d[\d,]*)\s*cd/i);
			if (m && !specs.intensity_cd) specs.intensity_cd = parseInt(m[1].replace(/,/g, ''), 10);
		}
	}
}

// ─── ZeroAir site implementation ─────────────────────────────────────────────

/**
 * Discover review URLs from zeroair.org via sitemap.
 * Two sitemaps: post-sitemap.xml (1000 URLs) and post-sitemap2.xml (437 URLs).
 */
async function discoverZeroAirUrls(_maxPages = 20): Promise<string[]> {
	const urls = new Set<string>();
	const sitemapUrls = [
		'https://zeroair.org/post-sitemap.xml',
		'https://zeroair.org/post-sitemap2.xml',
	];

	for (const smUrl of sitemapUrls) {
		try {
			console.log(`  Fetching sitemap: ${smUrl}`);
			const xml = await fetchPage(smUrl);
			// URLs may be in CDATA: <loc><![CDATA[url]]></loc> or plain <loc>url</loc>
			const locRe = /<loc>(?:<!\[CDATA\[)?(https:\/\/zeroair\.org\/\d{4}\/\d{2}\/\d{2}\/[^\]<]+?)(?:\]\]>)?<\/loc>/gi;
			let loc;
			while ((loc = locRe.exec(xml)) !== null) {
				const u = loc[1].trim();
				// Only grab URLs that look like flashlight reviews
				if (/flashlight|headlamp|lantern|review/i.test(u)) {
					urls.add(u);
				}
			}
			console.log(`  Found ${urls.size} review URLs so far`);
			await Bun.sleep(CRAWL_DELAY);
		} catch (err) {
			console.warn(`  Error fetching ${smUrl}: ${err instanceof Error ? err.message : err}`);
		}
	}

	return Array.from(urls);
}

/**
 * Parse a zeroair.org review page.
 * Spec summary in a plain <table> with td[style="text-align: right;"] for labels.
 * Dimensions in prose text under <h3 id="size">.
 */
function parseZeroAirReview(html: string, url: string): ParsedReview | null {
	// Brand + model from h1: "Sofirn SC21 Pro Flashlight Review"
	const h1Match = html.match(/<h1[^>]*>(.+?)\s+(?:Flashlight|Headlamp|Lantern|Light)\s+Review/i);
	if (!h1Match) return null;

	const fullTitle = h1Match[1].replace(/<[^>]+>/g, '').trim();
	const parts = fullTitle.split(/\s+/);
	if (parts.length < 2) return null;

	const brand = parts[0];
	const model = parts.slice(1).join(' ');
	const specs: Partial<ExtractedSpecs> = {};
	const text = htmlToText(html);

	// Find spec summary table — rows with style="text-align: right;" in first td
	const specRowRe = /<tr>\s*<td[^>]*text-align:\s*right[^>]*>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi;
	let row;
	while ((row = specRowRe.exec(html)) !== null) {
		const label = row[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
		const value = row[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#8211;/g, '–').replace(/&#215;/g, '×').trim();

		if (/^emitter/i.test(label)) {
			const leds = parseLedValue(value);
			if (leds.length > 0) specs.led = leds;
		} else if (/^price\s*in\s*usd/i.test(label)) {
			const m = value.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
			if (m) {
				const price = parseFloat(m[1]);
				if (price > 0 && price < 10000) specs.price_usd = price;
			}
		} else if (/^cell/i.test(label)) {
			specs.battery = parseBatteryValue(value);
		} else if (/^switch\s*type/i.test(label)) {
			const switches: string[] = [];
			if (/tail/i.test(value)) switches.push('tail');
			if (/side|e[\s-]?switch/i.test(value)) switches.push('side');
			if (/rotary|twist/i.test(value)) switches.push('rotary');
			if (switches.length > 0) specs.switch = switches;
		} else if (/^claimed\s*lumens/i.test(label)) {
			const m = value.match(/(\d[\d,]*)/);
			if (m) {
				const lm = parseInt(m[1].replace(/,/g, ''), 10);
				if (lm > 0 && lm < 1_000_000) specs.lumens = [lm];
			}
		} else if (/^claimed\s*throw/i.test(label)) {
			const m = value.match(/(\d[\d,]*)/);
			if (m) {
				const t = parseInt(m[1].replace(/,/g, ''), 10);
				if (t >= 5 && t <= 5000) specs.throw_m = t;
			}
		} else if (/candela.*calculated|^candela/i.test(label)) {
			const m = value.match(/(\d[\d,]*)\s*cd/i);
			if (m) specs.intensity_cd = parseInt(m[1].replace(/,/g, ''), 10);
		} else if (/^on[\s-]?board\s*charging/i.test(label)) {
			if (/yes/i.test(value)) {
				// Check charge port type in next row — we'll also look for it separately
			}
		} else if (/^charge\s*port\s*type/i.test(label)) {
			if (/usb[\s-]?c|type[\s-]?c/i.test(value)) specs.charging = ['USB-C'];
			else if (/micro/i.test(value)) specs.charging = ['Micro-USB'];
			else if (/magnetic/i.test(value)) specs.charging = ['magnetic'];
		}
	}

	// Extract dimensions from prose under "Size and Comps" section
	// Format A: "Length: 73mm" / "Body Diameter: 22.5 mm"
	const lenMatch = text.match(/(?:length|overall)[:\s]+(\d+(?:\.\d+)?)\s*mm/i);
	if (lenMatch) {
		const len = parseFloat(lenMatch[1]);
		if (len >= 15 && len <= 1000) specs.length_mm = len;
	}
	// Format B: "133.5mm x 31mm x 23mm and 116g"
	if (!specs.length_mm) {
		const dimMatch = text.match(/(\d+(?:\.\d+)?)\s*mm\s*x\s*(\d+(?:\.\d+)?)\s*mm\s*x\s*(\d+(?:\.\d+)?)\s*mm/i);
		if (dimMatch) {
			const dims = [parseFloat(dimMatch[1]), parseFloat(dimMatch[2]), parseFloat(dimMatch[3])];
			const maxDim = Math.max(...dims);
			if (maxDim >= 15 && maxDim <= 1000) specs.length_mm = maxDim;
		}
	}
	// Format C: "Dimensions: 188.3 × 28.5 × 60.8 mm"
	if (!specs.length_mm) {
		const dimMatch2 = text.match(/Dimensions[:\s]+(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)\s*mm/i);
		if (dimMatch2) {
			const dims = [parseFloat(dimMatch2[1]), parseFloat(dimMatch2[2]), parseFloat(dimMatch2[3])];
			const maxDim = Math.max(...dims);
			if (maxDim >= 15 && maxDim <= 1000) specs.length_mm = maxDim;
		}
	}

	// Extract weight from prose
	const weightMatch = text.match(/(?:weight|weighs?)[:\s]+(\d+(?:\.\d+)?)\s*g\b/i);
	if (weightMatch) specs.weight_g = parseFloat(weightMatch[1]);
	if (!specs.weight_g) {
		// "and 116g" pattern
		const wm = text.match(/\band\s+(\d+(?:\.\d+)?)\s*g\b/i);
		if (wm) specs.weight_g = parseFloat(wm[1]);
	}

	// Extract material from text
	const materials: string[] = [];
	if (/\baluminum|aluminium\b/i.test(text)) materials.push('aluminum');
	if (/\btitanium\b/i.test(text)) materials.push('titanium');
	if (/\bcopper\b/i.test(text) && !/copper\s*(?:board|pcb|mcpcb)/i.test(text)) materials.push('copper');
	if (/\bbrass\b/i.test(text)) materials.push('brass');
	if (/\bstainless\b/i.test(text)) materials.push('stainless steel');
	if (materials.length > 0 && !specs.material?.length) specs.material = materials;

	const rawText = htmlToText(html.substring(0, 5000));
	return { brand, model, specs, rawSpecText: rawText };
}

// ─── TGReviews site implementation ──────────────────────────────────────────

/**
 * Discover review URLs from tgreviews.com via sitemap.
 * Sitemap at /sitemap-1.xml with ~290 review URLs.
 */
async function discoverTGReviewUrls(_maxPages = 20): Promise<string[]> {
	const urls = new Set<string>();

	try {
		console.log('  Fetching tgreviews sitemap...');
		const sitemapIndex = await fetchPage('https://tgreviews.com/sitemap.xml');
		// Find sub-sitemaps
		const subRe = /<loc>(https:\/\/tgreviews\.com\/sitemap[^<]*)<\/loc>/gi;
		const subUrls: string[] = [];
		let sm;
		while ((sm = subRe.exec(sitemapIndex)) !== null) {
			subUrls.push(sm[1]);
		}
		if (subUrls.length === 0) subUrls.push('https://tgreviews.com/sitemap-1.xml');

		for (const subUrl of subUrls) {
			console.log(`  Fetching: ${subUrl}`);
			const xml = await fetchPage(subUrl);
			// Match date-based review URLs (handle CDATA)
			const locRe = /<loc>(?:<!\[CDATA\[)?(https:\/\/tgreviews\.com\/\d{4}\/\d{2}\/\d{2}\/[^\]<]+?)(?:\]\]>)?<\/loc>/gi;
			let loc;
			while ((loc = locRe.exec(xml)) !== null) {
				const u = loc[1].trim();
				// Skip known non-review pages
				const slug = u.replace(/\/$/, '').split('/').pop() || '';
				if (/^collection$|^glossary$|^tfc$|^grizzlys-guide/i.test(slug)) continue;
				urls.add(u);
			}
			console.log(`  Found ${urls.size} review URLs so far`);
			await Bun.sleep(CRAWL_DELAY);
		}
	} catch (err) {
		console.warn(`  Error fetching tgreviews sitemap: ${err instanceof Error ? err.message : err}`);
	}

	return Array.from(urls);
}

/**
 * Parse a tgreviews.com review page.
 * H1: "Brand Model Review – Tagline"
 * Size table under #size with wp-block-table
 * Mode chart under #modes with lumens/candela/throw
 * Inline text sections for LED (#emitter), battery (#batteries), switch (#switch)
 */
function parseTGReview(html: string, url: string): ParsedReview | null {
	// Extract brand + model from h1: "Thrunite Catapult Pro Review – The Thrower for Everyone"
	const h1Match = html.match(/<h1[^>]*>(.+?)\s+Review\b/i);
	if (!h1Match) return null;

	const fullTitle = h1Match[1].replace(/<[^>]+>/g, '').trim();
	const parts = fullTitle.split(/\s+/);
	if (parts.length < 2) return null;

	const brand = parts[0];
	const model = parts.slice(1).join(' ');
	const specs: Partial<ExtractedSpecs> = {};
	const text = htmlToText(html);

	// === Size & Measurements table ===
	// Find wp-block-table near #size heading with rows like "Length | 104.3"
	const sizeTableRe = /<figure[^>]*class="wp-block-table[^"]*"[^>]*>\s*<table[^>]*>([\s\S]*?)<\/table>/gi;
	let tableMatch;
	while ((tableMatch = sizeTableRe.exec(html)) !== null) {
		const table = tableMatch[1];
		const tableLower = table.toLowerCase();

		// Size table has rows like "Length", "Bezel Diameter", "Weight"
		if (/length|bezel|diameter/i.test(tableLower) && !/lumens|candela|turbo|high|low/i.test(tableLower)) {
			const rowRe = /<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>/gi;
			let row;
			while ((row = rowRe.exec(table)) !== null) {
				const label = row[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
				const value = row[2].replace(/<[^>]+>/g, '').trim();

				if (label === 'length' && !specs.length_mm) {
					const m = value.match(/(\d+(?:\.\d+)?)/);
					if (m) {
						const v = parseFloat(m[1]);
						if (v >= 15 && v <= 1000) specs.length_mm = v;
					}
				} else if (/bezel|maximum\s*head/i.test(label) && !specs.bezel_mm) {
					const m = value.match(/(\d+(?:\.\d+)?)/);
					if (m) specs.bezel_mm = parseFloat(m[1]);
				} else if (/body\s*tube/i.test(label) && !specs.body_mm) {
					const m = value.match(/(\d+(?:\.\d+)?)/);
					if (m) specs.body_mm = parseFloat(m[1]);
				} else if (/weight/i.test(label) && !specs.weight_g) {
					const m = value.match(/(\d+(?:\.\d+)?)\s*g/i);
					if (m) specs.weight_g = parseFloat(m[1]);
				}
			}
		}

		// Mode chart has "Lumens", "Candela", "Throw" columns
		if (/lumens|candela/i.test(tableLower) && /turbo|high|low/i.test(tableLower)) {
			// Get max lumens/throw/candela from first data row (Turbo)
			const rowRe = /<tr>\s*<td>([\s\S]*?)<\/td>((?:\s*<td>[\s\S]*?<\/td>)+)\s*<\/tr>/gi;
			let row;
			let isFirstDataRow = true;
			while ((row = rowRe.exec(table)) !== null) {
				const level = row[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
				if (/turbo|max|high/i.test(level) && isFirstDataRow) {
					// Extract all cell values
					const cellRe = /<td>([\s\S]*?)<\/td>/gi;
					const cells: string[] = [];
					let cell;
					while ((cell = cellRe.exec(row[0])) !== null) {
						cells.push(cell[1].replace(/<[^>]+>/g, '').trim());
					}
					// cells[0]=Level, cells[1]=Lumens, cells[2]=Candela, cells[3]=Throw(m)
					if (cells[1] && !specs.lumens?.length) {
						const lm = parseInt(cells[1].replace(/,/g, ''), 10);
						if (lm > 0 && lm < 1_000_000) specs.lumens = [lm];
					}
					if (cells[2] && !specs.intensity_cd) {
						const cd = parseInt(cells[2].replace(/,/g, ''), 10);
						if (cd > 0) specs.intensity_cd = cd;
					}
					if (cells[3] && !specs.throw_m) {
						const t = parseInt(cells[3].replace(/,/g, ''), 10);
						if (t >= 5 && t <= 5000) specs.throw_m = t;
					}
					isFirstDataRow = false;
				}
			}
		}
	}

	// === Inline spec extraction from text sections ===
	// LED: after "Emitter" or "emitter" heading
	const ledSection = text.match(/(?:emitter|led)[:\s]+([^\n]+)/i);
	if (ledSection && !specs.led?.length) {
		const leds = parseLedValue(ledSection[1]);
		if (leds.length > 0) specs.led = leds;
	}

	// Battery: after "batteries" or "battery" or "power"
	const battSection = text.match(/(?:batteries?|power|cell)[:\s]+([^\n]+)/i);
	if (battSection && !specs.battery?.length) {
		const batteries = parseBatteryValue(battSection[1]);
		if (batteries.length > 0) specs.battery = batteries;
	}

	// Switch
	const switchSection = text.match(/(?:switch)[:\s]+([^\n]+)/i);
	if (switchSection && !specs.switch?.length) {
		const switches: string[] = [];
		const sv = switchSection[1];
		if (/tail/i.test(sv)) switches.push('tail');
		if (/side/i.test(sv)) switches.push('side');
		if (/rotary/i.test(sv)) switches.push('rotary');
		if (/electronic/i.test(sv) && switches.length === 0) switches.push('side');
		if (switches.length > 0) specs.switch = switches;
	}

	// Price
	const priceMatch = text.match(/\$(\d+(?:\.\d{1,2})?)\s*(?:USD|usd|retail)?/);
	if (priceMatch && !specs.price_usd) {
		const price = parseFloat(priceMatch[1]);
		if (price > 0 && price < 10000) specs.price_usd = price;
	}

	// Material
	const materials: string[] = [];
	if (/anodized\s*aluminum|aluminum\s*body|alumin(?:um|ium)/i.test(text)) materials.push('aluminum');
	if (/\btitanium\b/i.test(text)) materials.push('titanium');
	if (/\bcopper\b/i.test(text) && !/copper\s*(?:board|pcb|mcpcb)/i.test(text)) materials.push('copper');
	if (materials.length > 0 && !specs.material?.length) specs.material = materials;

	// Charging
	if (!specs.charging?.length) {
		if (/usb[\s-]?c\s*charg|charg.*usb[\s-]?c/i.test(text)) specs.charging = ['USB-C'];
		else if (/magnetic\s*(?:usb)?\s*charg/i.test(text)) specs.charging = ['magnetic'];
	}

	const rawText = htmlToText(html.substring(0, 5000));
	return { brand, model, specs, rawSpecText: rawText };
}

// ─── SammySHP site implementation ────────────────────────────────────────────

/**
 * Discover review URLs from sammyshp.de via the tag page.
 * All flashlight reviews tagged "taschenlampe" at /betablog/tag/taschenlampe
 */
async function discoverSammySHPUrls(_maxPages = 20): Promise<string[]> {
	const urls = new Set<string>();
	const baseUrl = 'https://sammyshp.de';

	try {
		console.log('  Fetching sammyshp.de tag page...');
		const html = await fetchPage(`${baseUrl}/betablog/tag/taschenlampe`);
		// Extract post links: /betablog/post/NNN
		const linkRe = /href="(\/betablog\/post\/\d+)"/gi;
		let match;
		while ((match = linkRe.exec(html)) !== null) {
			urls.add(`${baseUrl}${match[1]}`);
		}

		// Also check paginated tag pages
		for (let page = 2; page <= 10; page++) {
			try {
				await Bun.sleep(CRAWL_DELAY);
				const pageHtml = await fetchPage(`${baseUrl}/betablog/tag/taschenlampe?page=${page}`);
				let found = false;
				while ((match = linkRe.exec(pageHtml)) !== null) {
					urls.add(`${baseUrl}${match[1]}`);
					found = true;
				}
				if (!found) break;
			} catch {
				break;
			}
		}
	} catch (err) {
		console.warn(`  Error fetching sammyshp: ${err instanceof Error ? err.message : err}`);
	}

	return Array.from(urls);
}

/**
 * Parse a sammyshp.de review page (German language).
 * Dimensions in <table class="x-dimensions-table">.
 * Runtime/performance in <table class="x-runtime-table">.
 */
function parseSammySHPReview(html: string, url: string): ParsedReview | null {
	// Brand + model from <title>: "SammysHP Blog › Vastlite Minima Bow LED"
	const titleMatch = html.match(/<title>[^›]*›\s*(.+?)\s*<\/title>/i);
	if (!titleMatch) return null;

	const fullTitle = titleMatch[1].trim();
	const parts = fullTitle.split(/\s+/);
	if (parts.length < 2) return null;

	const brand = parts[0];
	const model = parts.slice(1).join(' ');
	const specs: Partial<ExtractedSpecs> = {};

	// === Dimensions table (x-dimensions-table) ===
	const dimTableMatch = html.match(/<table[^>]*class="x-dimensions-table"[^>]*>([\s\S]*?)<\/table>/i);
	if (dimTableMatch) {
		const table = dimTableMatch[1];
		// Rows use either <td> or <th> for labels, German decimal comma
		const rowRe = /<tr[^>]*>\s*<(?:td|th)>([\s\S]*?)<\/(?:td|th)>\s*<td>([\s\S]*?)<\/td>/gi;
		let row;
		while ((row = rowRe.exec(table)) !== null) {
			const label = row[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
			// German uses comma for decimal: "120,5" → "120.5"
			const rawValue = row[2].replace(/<[^>]+>/g, '').trim().replace(',', '.');

			if (/^l[aä]nge|^h[oö]he/i.test(label) && !specs.length_mm) {
				const m = rawValue.match(/(\d+(?:\.\d+)?)\s*mm/i);
				if (m) {
					const v = parseFloat(m[1]);
					if (v >= 15 && v <= 1000) specs.length_mm = v;
				}
			} else if (/durchmesser.*kopf|bezel/i.test(label) && !specs.bezel_mm) {
				const m = rawValue.match(/(\d+(?:\.\d+)?)\s*mm/i);
				if (m) specs.bezel_mm = parseFloat(m[1]);
			} else if (/durchmesser.*akkurohr|body/i.test(label) && !specs.body_mm) {
				const m = rawValue.match(/(\d+(?:\.\d+)?)\s*mm/i);
				if (m) specs.body_mm = parseFloat(m[1]);
			} else if (/gewicht.*ohne|gewicht.*gesamt|^gewicht/i.test(label) && !specs.weight_g) {
				const m = rawValue.match(/(\d+(?:\.\d+)?)\s*g/i);
				if (m) specs.weight_g = parseFloat(m[1]);
			}
		}
	}

	// === Runtime/performance table (x-runtime-table) ===
	const rtTableMatch = html.match(/<table[^>]*class="x-runtime-table"[^>]*>([\s\S]*?)<\/table>/i);
	if (rtTableMatch) {
		const table = rtTableMatch[1];
		// Get first data row (Turbo) for max lumens/throw/intensity
		const rowRe = /<tr>\s*<td>([\s\S]*?)<\/td>((?:\s*<td>[\s\S]*?<\/td>)+)\s*<\/tr>/gi;
		let row;
		let firstRow = true;
		while ((row = rowRe.exec(table)) !== null && firstRow) {
			const cellRe = /<td>([\s\S]*?)<\/td>/gi;
			const cells: string[] = [];
			let cell;
			while ((cell = cellRe.exec(row[0])) !== null) {
				cells.push(cell[1].replace(/<[^>]+>/g, '').replace(/<br\s*\/?>/gi, ' ').trim().replace(',', '.'));
			}
			// cells[0]=Mode, cells[1]=Helligkeit(lm), cells[2]=Laufzeit, cells[3]=Intensität(cd) (Reichweite)
			if (cells[1] && !specs.lumens?.length) {
				// May have "1500 lm" or "1500 / 1300 lm" (multiple variants)
				const lmMatch = cells[1].match(/(\d+)\s*(?:lm)?/);
				if (lmMatch) {
					const lm = parseInt(lmMatch[1], 10);
					if (lm > 0 && lm < 1_000_000) specs.lumens = [lm];
				}
			}
			if (cells[3] && !specs.intensity_cd) {
				// "4410 cd" or "4410 cd (132 m)"
				const cdMatch = cells[3].match(/(\d+)\s*cd/i);
				if (cdMatch) specs.intensity_cd = parseInt(cdMatch[1], 10);
				const throwMatch = cells[3].match(/\((\d+)\s*m\)/i);
				if (throwMatch && !specs.throw_m) {
					const t = parseInt(throwMatch[1], 10);
					if (t >= 5 && t <= 5000) specs.throw_m = t;
				}
			}
			firstRow = false;
		}
	}

	// === Comparison table (x-comparison-table) — may have battery, switch, LED info ===
	const compTableMatch = html.match(/<table[^>]*class="x-comparison-table"[^>]*>([\s\S]*?)<\/table>/i);
	if (compTableMatch) {
		const table = compTableMatch[1];
		const rowRe = /<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>/gi;
		let row;
		while ((row = rowRe.exec(table)) !== null) {
			const label = row[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
			const value = row[2].replace(/<[^>]+>/g, '').trim();

			if (/^akku|^batterie/i.test(label) && !specs.battery?.length) {
				specs.battery = parseBatteryValue(value);
			} else if (/^lichtquelle|^led|^emitter/i.test(label) && !specs.led?.length) {
				specs.led = parseLedValue(value);
			} else if (/^bedienung/i.test(label) && !specs.switch?.length) {
				const switches: string[] = [];
				if (/heckschalter|tail/i.test(value)) switches.push('tail');
				if (/seitenschalter|side/i.test(value)) switches.push('side');
				if (/twisty|dreh/i.test(value)) switches.push('rotary');
				if (switches.length > 0) specs.switch = switches;
			} else if (/^helligkeit/i.test(label) && !specs.lumens?.length) {
				const m = value.match(/(\d+)\s*(?:lm)?/i);
				if (m) {
					const lm = parseInt(m[1], 10);
					if (lm > 0 && lm < 1_000_000) specs.lumens = [lm];
				}
			} else if (/^reichweite/i.test(label) && !specs.throw_m) {
				const m = value.match(/(\d+)\s*m/i);
				if (m) {
					const t = parseInt(m[1], 10);
					if (t >= 5 && t <= 5000) specs.throw_m = t;
				}
			}
		}
	}

	// Extract LED from text if not found in tables
	if (!specs.led?.length) {
		const text = htmlToText(html);
		const ledMatch = text.match(/(?:LED|Emitter|Lichtquelle)[:\s]+([^\n]+)/i);
		if (ledMatch) {
			const leds = parseLedValue(ledMatch[1]);
			if (leds.length > 0) specs.led = leds;
		}
	}

	// Extract battery from text
	if (!specs.battery?.length) {
		const text = htmlToText(html);
		const battMatch = text.match(/(?:Akku|Batterie|battery)[:\s]+([^\n]+)/i);
		if (battMatch) specs.battery = parseBatteryValue(battMatch[1]);
	}

	const rawText = htmlToText(html.substring(0, 5000));
	return { brand, model, specs, rawSpecText: rawText };
}

// ─── Site registry ─────────────────────────────────────────────────────────────

const REVIEW_SITES: Record<string, SiteConfig> = {
	zakreviews: {
		name: 'Zak Reviews',
		baseUrl: 'https://zakreviews.com',
		discoverUrls: discoverZakReviewUrls,
		parseReview: parseZakReview,
	},
	'1lumen': {
		name: '1Lumen',
		baseUrl: 'https://1lumen.com',
		discoverUrls: discover1LumenUrls,
		parseReview: parse1LumenReview,
	},
	zeroair: {
		name: 'ZeroAir',
		baseUrl: 'https://zeroair.org',
		discoverUrls: discoverZeroAirUrls,
		parseReview: parseZeroAirReview,
	},
	tgreviews: {
		name: 'TG Reviews',
		baseUrl: 'https://tgreviews.com',
		discoverUrls: discoverTGReviewUrls,
		parseReview: parseTGReview,
	},
	sammyshp: {
		name: 'SammySHP',
		baseUrl: 'https://sammyshp.de',
		discoverUrls: discoverSammySHPUrls,
		parseReview: parseSammySHPReview,
	},
};

// ─── Fuzzy matching ────────────────────────────────────────────────────────────

/**
 * Normalize a string for fuzzy matching: lowercase, remove special characters,
 * collapse whitespace.
 */
function normalizeForMatch(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Find the best matching database entry for a review's brand + model.
 * Uses normalized string comparison:
 *   1. Exact brand + model match (normalized)
 *   2. Brand matches and review model is contained in DB model (or vice versa)
 *   3. Brand matches and a suffix-trimmed model matches (e.g. "M150 v4" matches "M150")
 *
 * Returns null if no confident match is found.
 */
function findMatchingEntry(
	brand: string,
	model: string,
	entries: FlashlightEntry[],
): FlashlightEntry | null {
	const normBrand = normalizeForMatch(brand);
	const normModel = normalizeForMatch(model);

	// Pre-filter to entries matching this brand
	const brandMatches = entries.filter((e) => normalizeForMatch(e.brand) === normBrand);
	if (brandMatches.length === 0) return null;

	// Priority 1: Exact normalized model match
	const exact = brandMatches.find((e) => normalizeForMatch(e.model) === normModel);
	if (exact) return exact;

	// Priority 2: DB model contains review model, or review model contains DB model
	// Prefer the longest overlap
	let bestMatch: FlashlightEntry | null = null;
	let bestScore = 0;

	for (const entry of brandMatches) {
		const entryModel = normalizeForMatch(entry.model);

		// Check containment (either direction)
		if (entryModel.includes(normModel) || normModel.includes(entryModel)) {
			// Score by length of overlap (longer match = better)
			const overlapLen = Math.min(entryModel.length, normModel.length);
			if (overlapLen > bestScore) {
				bestScore = overlapLen;
				bestMatch = entry;
			}
		}
	}

	if (bestMatch) return bestMatch;

	// Priority 3: Strip version suffixes (v2, v3, v4, 2.0, etc.) from both sides
	const stripVersion = (s: string) => s.replace(/\s*(?:v\d+|[\d]+\.[\d]+|\bpro\b|\bplus\b)\s*$/i, '').trim();
	const strippedReviewModel = stripVersion(normModel);

	for (const entry of brandMatches) {
		const strippedEntryModel = stripVersion(normalizeForMatch(entry.model));
		if (strippedEntryModel === strippedReviewModel && strippedReviewModel.length >= 2) {
			return entry;
		}
	}

	return null;
}

// ─── Merge logic ───────────────────────────────────────────────────────────────

/**
 * Merge extracted review specs into a database entry.
 * Only fills MISSING fields — never overwrites existing data.
 * Returns list of fields that were actually updated.
 */
function mergeSpecs(entry: FlashlightEntry, specs: Partial<ExtractedSpecs>): string[] {
	const fieldsAdded: string[] = [];

	// === Scalar performance fields (in performance.claimed) ===
	if (specs.throw_m && (!entry.performance.claimed.throw_m || entry.performance.claimed.throw_m <= 0)) {
		entry.performance.claimed.throw_m = specs.throw_m;
		fieldsAdded.push('throw_m');
	}

	if (specs.intensity_cd && !entry.performance.claimed.intensity_cd) {
		entry.performance.claimed.intensity_cd = specs.intensity_cd;
		fieldsAdded.push('intensity_cd');
	}

	if (specs.cri && !entry.performance.claimed.cri) {
		entry.performance.claimed.cri = specs.cri;
		fieldsAdded.push('cri');
	}

	if (specs.cct && !entry.performance.claimed.cct) {
		entry.performance.claimed.cct = specs.cct;
		fieldsAdded.push('cct');
	}

	// === Array performance fields ===
	if (specs.lumens?.length && !entry.performance.claimed.lumens?.length) {
		entry.performance.claimed.lumens = specs.lumens;
		fieldsAdded.push('lumens');
	}

	if (specs.runtime_hours?.length && !entry.performance.claimed.runtime_hours?.length) {
		entry.performance.claimed.runtime_hours = specs.runtime_hours;
		fieldsAdded.push('runtime_hours');
	}

	// === Physical dimensions ===
	if (specs.length_mm && (!entry.length_mm || entry.length_mm <= 0)) {
		entry.length_mm = specs.length_mm;
		fieldsAdded.push('length_mm');
	}

	if (specs.weight_g && (!entry.weight_g || entry.weight_g <= 0)) {
		entry.weight_g = specs.weight_g;
		fieldsAdded.push('weight_g');
	}

	if (specs.bezel_mm && (!entry.bezel_mm || entry.bezel_mm <= 0)) {
		entry.bezel_mm = specs.bezel_mm;
		fieldsAdded.push('bezel_mm');
	}

	if (specs.body_mm && (!entry.body_mm || entry.body_mm <= 0)) {
		entry.body_mm = specs.body_mm;
		fieldsAdded.push('body_mm');
	}

	// === Array fields (only fill if currently empty) ===
	if (specs.led?.length && (!entry.led.length || entry.led[0] === 'unknown')) {
		entry.led = specs.led;
		fieldsAdded.push('led');
	}

	if (specs.battery?.length && (!entry.battery.length || entry.battery[0] === 'unknown')) {
		entry.battery = specs.battery;
		fieldsAdded.push('battery');
	}

	if (specs.switch?.length && !entry.switch.length) {
		entry.switch = specs.switch;
		fieldsAdded.push('switch');
	}

	if (specs.material?.length && !entry.material.length) {
		entry.material = specs.material;
		fieldsAdded.push('material');
	}

	if (specs.charging?.length && !entry.charging.length) {
		entry.charging = specs.charging;
		fieldsAdded.push('charging');
	}

	if (specs.environment?.length && !entry.environment.length) {
		entry.environment = specs.environment;
		fieldsAdded.push('environment');
	}

	if (specs.features?.length && !entry.features.length) {
		entry.features = specs.features;
		fieldsAdded.push('features');
	}

	// === Price ===
	if (specs.price_usd && (!entry.price_usd || entry.price_usd <= 0)) {
		entry.price_usd = specs.price_usd;
		fieldsAdded.push('price_usd');
	}

	return fieldsAdded;
}

// ─── Also extract mode data from mode tables (runtime_hours, additional lumens) ─

/**
 * Extract additional spec data from the modes table and other content
 * outside the main spec table. This includes runtime data and mode lumens.
 */
function extractModesData(html: string): Partial<ExtractedSpecs> {
	const specs: Partial<ExtractedSpecs> = {};
	const text = htmlToText(html);

	// Extract runtime hours from the output/runtime table or text
	const runtimes: number[] = [];
	// Match "NN.N hours" or "NNN minutes" in runtime context
	const rtHourRe = /(\d+(?:\.\d+)?)\s*hours?\b/gi;
	let rtm;
	while ((rtm = rtHourRe.exec(text)) !== null) {
		const val = parseFloat(rtm[1]);
		if (val > 0 && val < 5000 && !runtimes.includes(val)) runtimes.push(val);
	}
	// Also capture "NNN minutes" and convert to hours
	const rtMinRe = /(\d+(?:\.\d+)?)\s*minutes?\b/gi;
	while ((rtm = rtMinRe.exec(text)) !== null) {
		const val = parseFloat(rtm[1]) / 60;
		const rounded = Math.round(val * 100) / 100;
		if (rounded > 0 && rounded < 5000 && !runtimes.includes(rounded)) runtimes.push(rounded);
	}
	if (runtimes.length > 0) specs.runtime_hours = runtimes;

	// Extract switch info from UI section
	const switches: string[] = [];
	if (/tail[\s-]?switch|tail[\s-]?cap|tail\s*click|rear\s*switch/i.test(text)) switches.push('tail');
	if (/side[\s-]?switch|side\s*button|e[\s-]?switch/i.test(text)) switches.push('side');
	if (/dual[\s-]?switch|two\s*switch/i.test(text)) switches.push('dual');
	if (/rotary|twist|magnetic\s*(?:control\s*)?ring/i.test(text)) switches.push('rotary');
	if (switches.length > 0) specs.switch = switches;

	// Extract features from accessories and body text
	const features: string[] = [];
	if (/\bpocket\s*clip\b|\bclip\b/i.test(text) && !/video\s*clip/i.test(text)) features.push('clip');
	if (/\bmagnet\b/i.test(text) && !/magnetic\s*charg/i.test(text)) features.push('magnet');
	if (/\blanyard\b/i.test(text)) features.push('lanyard');
	if (/\blockout\b/i.test(text)) features.push('lockout');
	if (/\brechargeable\b/i.test(text)) features.push('rechargeable');
	if (/\banduril\b/i.test(text)) features.push('Anduril');
	if (/\bpower\s*bank\b/i.test(text)) features.push('power bank');
	if (features.length > 0) specs.features = features;

	// Extract material from body text
	const materials: string[] = [];
	if (/aluminum|aluminium|6061/i.test(text)) materials.push('aluminum');
	if (/titanium/i.test(text)) materials.push('titanium');
	if (/copper/i.test(text)) materials.push('copper');
	if (/brass/i.test(text)) materials.push('brass');
	if (/stainless/i.test(text)) materials.push('stainless steel');
	if (materials.length > 0) specs.material = materials;

	return specs;
}

// ─── Main scraper functions ────────────────────────────────────────────────────

/**
 * Scrape a review site and merge specs into existing database entries.
 *
 * @param site - Site key (e.g. "zakreviews")
 * @param maxPages - Maximum number of index pages to crawl for URL discovery
 * @returns Count of discovered reviews and enriched database entries
 */
export async function scrapeReviewSite(
	site: string,
	maxPages?: number,
): Promise<{ discovered: number; enriched: number }> {
	const config = REVIEW_SITES[site];
	if (!config) {
		throw new Error(
			`Unknown review site: "${site}". Available: ${Object.keys(REVIEW_SITES).join(', ')}`,
		);
	}

	console.log(`=== Scraping ${config.name} ===\n`);

	// Step 1: Discover all review URLs
	console.log('Step 1: Discovering review URLs...');
	const urls = await config.discoverUrls(maxPages);
	console.log(`  Found ${urls.length} candidate URLs\n`);

	if (urls.length === 0) return { discovered: 0, enriched: 0 };

	// Step 2: Load all database entries for matching
	const entries = getAllFlashlights();
	console.log(`  Loaded ${entries.length} database entries for matching\n`);

	// Step 3: Fetch and parse each review page
	console.log('Step 2: Fetching and parsing reviews...');
	let discovered = 0;
	let enriched = 0;
	let matched = 0;
	let unmatched = 0;
	let notReview = 0;
	let errors = 0;

	for (let i = 0; i < urls.length; i++) {
		const url = urls[i];

		try {
			const html = await fetchPage(url);

			// Parse review page (returns null if not a review)
			const review = config.parseReview(html, url);
			if (!review) {
				notReview++;
				if (i % 10 === 0) {
					console.log(`  [${i + 1}/${urls.length}] Skipped (not a review): ${url}`);
				}
				await Bun.sleep(CRAWL_DELAY);
				continue;
			}

			discovered++;

			// Also extract data from modes tables and body text
			const modesData = extractModesData(html);

			// Find matching database entry
			const match = findMatchingEntry(review.brand, review.model, entries);
			if (!match) {
				unmatched++;
				console.log(`  [${i + 1}/${urls.length}] No DB match: ${review.brand} ${review.model}`);
				await Bun.sleep(CRAWL_DELAY);
				continue;
			}

			matched++;

			// Merge spec table data first (higher confidence)
			const specFields = mergeSpecs(match, review.specs);

			// Then merge modes/body data (only fills what spec table didn't)
			const modesFields = mergeSpecs(match, modesData);

			const allFields = [...specFields, ...modesFields];

			if (allFields.length > 0) {
				match.updated_at = new Date().toISOString();
				upsertFlashlight(match);
				enriched++;
				console.log(
					`  [${i + 1}/${urls.length}] Enriched: ${match.brand} ${match.model} (+${allFields.join(', ')})`,
				);
			} else {
				console.log(
					`  [${i + 1}/${urls.length}] Matched but no new data: ${match.brand} ${match.model}`,
				);
			}

			// Store raw spec text for debugging
			if (review.rawSpecText.length >= 30) {
				addRawSpecText(match.id, url, 'review-specs', review.rawSpecText);
			}

			// Add source reference
			addSource(match.id, {
				source: config.name,
				url,
				scraped_at: new Date().toISOString(),
				confidence: 0.9,
			});
		} catch (err) {
			errors++;
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`  [${i + 1}/${urls.length}] Error: ${msg} — ${url}`);
		}

		await Bun.sleep(CRAWL_DELAY);
	}

	console.log(`\n=== ${config.name} Summary ===`);
	console.log(`  Candidate URLs: ${urls.length}`);
	console.log(`  Parsed reviews: ${discovered}`);
	console.log(`  Not reviews: ${notReview}`);
	console.log(`  Matched to DB: ${matched}`);
	console.log(`  Unmatched: ${unmatched}`);
	console.log(`  Enriched: ${enriched}`);
	console.log(`  Errors: ${errors}`);

	return { discovered, enriched };
}

/**
 * Scrape zakreviews.com specifically.
 * Convenience wrapper for `scrapeReviewSite('zakreviews')`.
 */
export async function scrapeZakReviews(
	maxPages?: number,
): Promise<{ discovered: number; enriched: number }> {
	return scrapeReviewSite('zakreviews', maxPages);
}

/**
 * Scrape all configured review sites.
 */
export async function scrapeAllReviewSites(
	maxPages?: number,
): Promise<{ totalDiscovered: number; totalEnriched: number; bySite: Record<string, { discovered: number; enriched: number }> }> {
	let totalDiscovered = 0;
	let totalEnriched = 0;
	const bySite: Record<string, { discovered: number; enriched: number }> = {};

	for (const [key, config] of Object.entries(REVIEW_SITES)) {
		console.log(`\n${'='.repeat(60)}`);
		console.log(`Scraping: ${config.name}`);
		console.log('='.repeat(60));

		const result = await scrapeReviewSite(key, maxPages);
		totalDiscovered += result.discovered;
		totalEnriched += result.enriched;
		bySite[config.name] = result;
	}

	return { totalDiscovered, totalEnriched, bySite };
}
