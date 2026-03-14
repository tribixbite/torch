/**
 * Generic manufacturer website scraper.
 * Fetches product pages, extracts text, and parses specs.
 * Uses standard fetch + HTML-to-text conversion.
 */
import type { ExtractionResult } from '../schema/canonical.js';

const USER_AGENT = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const FETCH_TIMEOUT = 15000;
const RETRY_DELAY = 2000;
const MAX_RETRIES = 2;

/** Fetch a URL and return the raw HTML text */
export async function fetchPage(url: string): Promise<string> {
	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

			const res = await fetch(url, {
				headers: {
					'User-Agent': USER_AGENT,
					'Accept': 'text/html,application/xhtml+xml',
					'Accept-Language': 'en-US,en;q=0.9',
				},
				signal: controller.signal,
				redirect: 'follow',
			});

			clearTimeout(timeout);

			if (!res.ok) {
				throw new Error(`HTTP ${res.status} ${res.statusText}`);
			}

			return await res.text();
		} catch (err) {
			lastError = err as Error;
			if (attempt < MAX_RETRIES) {
				await Bun.sleep(RETRY_DELAY * (attempt + 1));
			}
		}
	}

	throw lastError ?? new Error(`Failed to fetch ${url}`);
}

/**
 * Strip HTML tags and extract readable text content.
 * Lightweight alternative to full DOM parsing / Readability.
 */
export function htmlToText(html: string): string {
	return html
		// Remove script, style, nav, footer, header elements
		.replace(/<(script|style|nav|footer|header|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, '')
		// Remove HTML comments
		.replace(/<!--[\s\S]*?-->/g, '')
		// Convert common block elements to newlines
		.replace(/<\/?(?:div|p|h[1-6]|tr|li|br|section|article)[^>]*>/gi, '\n')
		// Convert table cells to tabs
		.replace(/<\/?(?:td|th)[^>]*>/gi, '\t')
		// Remove remaining tags
		.replace(/<[^>]+>/g, '')
		// Decode HTML entities
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
		// Normalize smart quotes and special chars
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
		.replace(/[\u2033\u2036]/g, '"')
		.replace(/[\u201C\u201D\u201E\u201F\u2034\u2037]/g, '"')
		.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-')
		.replace(/\u00A0/g, ' ')
		// Collapse whitespace
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/**
 * Extract structured spec data from product page text.
 * Uses pattern matching on common spec table formats.
 */
export function extractSpecsFromText(text: string): Partial<ExtractionResult> {
	const result: Partial<ExtractionResult> = {};

	// Extract lumens
	const lumensMatches: number[] = [];
	const lumensRe = /(\d[\d,]*)\s*(?:lumens?|lm)\b/gi;
	let m;
	while ((m = lumensRe.exec(text)) !== null) {
		const val = parseInt(m[1].replace(/,/g, ''), 10);
		if (val > 0 && val < 1_000_000 && !lumensMatches.includes(val)) {
			lumensMatches.push(val);
		}
	}
	if (lumensMatches.length > 0) result.lumens = lumensMatches.sort((a, b) => b - a);

	// Extract intensity in candela
	const cdMatch = text.match(/(\d[\d,]*)\s*(?:cd|candela)\b/i);
	if (cdMatch) result.intensity_cd = parseInt(cdMatch[1].replace(/,/g, ''), 10);

	// Extract throw distance
	const throwMatch = text.match(/(?:throw|beam\s*distance)[:\s]*(\d[\d,]*)\s*m(?:eters?)?\b/i);
	if (throwMatch) result.throw_m = parseInt(throwMatch[1].replace(/,/g, ''), 10);

	// Extract CRI
	const criMatch = text.match(/(?:CRI|color\s*rendering)[:\s]*(?:>?\s*)?(\d+)/i);
	if (criMatch) {
		const cri = parseInt(criMatch[1], 10);
		if (cri >= 50 && cri <= 100) result.cri = cri;
	}

	// Extract CCT
	const cctMatch = text.match(/(\d{4,5})\s*K\b/);
	if (cctMatch) {
		const cct = parseInt(cctMatch[1], 10);
		if (cct >= 1800 && cct <= 10000) result.cct = cct;
	}

	// Extract weight
	const weightGMatch = text.match(/(?:weight|mass)[:\s]*(\d+(?:\.\d+)?)\s*(?:g(?:rams?)?)\b/i);
	if (weightGMatch) result.weight_g = parseFloat(weightGMatch[1]);
	else {
		const weightOzMatch = text.match(/(?:weight)[:\s]*(\d+(?:\.\d+)?)\s*(?:oz|ounces?)\b/i);
		if (weightOzMatch) result.weight_g = Math.round(parseFloat(weightOzMatch[1]) * 28.35);
	}

	// Extract length
	const lengthMmMatch = text.match(/(?:length|overall)[:\s]*(\d+(?:\.\d+)?)\s*mm\b/i);
	if (lengthMmMatch) result.length_mm = parseFloat(lengthMmMatch[1]);
	else {
		const lengthInMatch = text.match(/(?:length|overall)[:\s]*(\d+(?:\.\d+)?)\s*(?:in(?:ches?)?|")\b/i);
		if (lengthInMatch) result.length_mm = Math.round(parseFloat(lengthInMatch[1]) * 25.4);
	}

	// Extract bezel diameter
	const bezelMatch = text.match(/(?:bezel|head)\s*(?:diameter|diam\.?|⌀)[:\s]*(\d+(?:\.\d+)?)\s*mm/i);
	if (bezelMatch) result.bezel_mm = parseFloat(bezelMatch[1]);

	// Extract body diameter
	const bodyMatch = text.match(/(?:body|tube)\s*(?:diameter|diam\.?|⌀)[:\s]*(\d+(?:\.\d+)?)\s*mm/i);
	if (bodyMatch) result.body_mm = parseFloat(bodyMatch[1]);

	// Extract battery types
	const batteries: string[] = [];
	const batteryPatterns: [RegExp, string][] = [
		[/\b21700\b/, '21700'], [/\b18650\b/, '18650'], [/\b18350\b/, '18350'],
		[/\b16340\b/, '16340'], [/\b14500\b/, '14500'], [/\bCR123A?\b/i, 'CR123A'],
		[/\b26650\b/, '26650'], [/\b26800\b/, '26800'],
		[/\bAA\b(?![\w])/, 'AA'], [/\bAAA\b/, 'AAA'],
	];
	for (const [re, name] of batteryPatterns) {
		if (re.test(text) && !batteries.includes(name)) batteries.push(name);
	}
	if (batteries.length > 0) result.battery = batteries;

	// Extract LED types
	const leds: string[] = [];
	const ledPatterns: [RegExp, string][] = [
		[/\bSST[\s-]?20\b/i, 'SST-20'], [/\bSST[\s-]?40\b/i, 'SST-40'],
		[/\bSST[\s-]?70\b/i, 'SST-70'], [/\bSFT[\s-]?40\b/i, 'SFT-40'],
		[/\bXHP[\s-]?50\b/i, 'XHP50'], [/\bXHP[\s-]?70\b/i, 'XHP70'],
		[/\bXM[\s-]?L2?\b/i, 'XM-L2'], [/\bXP[\s-]?L\b/i, 'XP-L'],
		[/\b519A\b/, '519A'], [/\b219[BCF]\b/, '219B'],
		[/\bLH351D\b/i, 'LH351D'], [/\bE21A\b/, 'E21A'],
	];
	for (const [re, name] of ledPatterns) {
		if (re.test(text) && !leds.includes(name)) leds.push(name);
	}
	if (leds.length > 0) result.led = leds;

	// Extract price
	const priceMatch = text.match(/\$(\d+(?:\.\d{2})?)\b/);
	if (priceMatch) result.price_usd = parseFloat(priceMatch[1]);

	// Extract IP rating
	const ipMatch = text.match(/\bIP[X]?(\d{1,2})\b/i);
	if (ipMatch) {
		// Store as environment info — will be normalized later
	}

	return result;
}

/**
 * Scrape a manufacturer product page and extract specs.
 * Returns partial extraction result for merging.
 */
export async function scrapeProductPage(url: string): Promise<{
	text: string;
	specs: Partial<ExtractionResult>;
}> {
	const html = await fetchPage(url);
	const text = htmlToText(html);
	const specs = extractSpecsFromText(text);
	return { text, specs };
}
