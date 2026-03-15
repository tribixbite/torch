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

	// Extract throw distance — try labeled patterns first, then contextual
	const throwMatch = text.match(/(?:throw|beam\s*distance|peak\s*beam\s*distance|max(?:imum)?\s*(?:beam\s*)?distance|range)[:\s]*(\d[\d,]*)\s*m(?:eters?)?(?!Ah)\b/i);
	if (throwMatch) {
		result.throw_m = parseInt(throwMatch[1].replace(/,/g, ''), 10);
	} else {
		// Compound "NNN feet (NNN meters)" format (Fenix, Streamlight)
		const compound = text.match(/(\d[\d,]*)\s*(?:feet|ft\.?)\s*\(?\s*(\d[\d,]*)\s*m(?:eters?)?\s*\)?/i);
		if (compound) result.throw_m = parseInt(compound[2].replace(/,/g, ''), 10);
		else {
			// Reverse format: "187m throw" or "380 meters beam distance"
			const reverseThrow = text.match(/(\d[\d,]*)\s*m(?:eters?)?\s*(?:throw|beam\s*distance|beam)(?!Ah)\b/i);
			if (reverseThrow) result.throw_m = parseInt(reverseThrow[1].replace(/,/g, ''), 10);
			else {
				// Yards format: "546 yards" — convert to meters
				const yardsMatch = text.match(/(?:throw|beam\s*distance|peak\s*beam\s*distance)[:\s]*(\d[\d,]*)\s*(?:yards?|yds?)\b/i);
				if (yardsMatch) result.throw_m = Math.round(parseInt(yardsMatch[1].replace(/,/g, ''), 10) * 0.9144);
			}
		}
	}

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

	// Extract weight — multiple formats
	const weightGMatch = text.match(/(?:weight|mass)[:\s]*(\d+(?:\.\d+)?)\s*(?:g(?:rams?)?)\b/i);
	if (weightGMatch) result.weight_g = parseFloat(weightGMatch[1]);
	else {
		// Slash format: "1.64 oz. / 46.9 g"
		const slashMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:oz\.?|ounces?)\s*[/|]\s*(\d+(?:\.\d+)?)\s*g\b/i);
		if (slashMatch) result.weight_g = parseFloat(slashMatch[2]);
		else {
			const weightOzMatch = text.match(/(?:weight)[:\s]*(\d+(?:\.\d+)?)\s*(?:oz\.?|ounces?)\b/i);
			if (weightOzMatch) result.weight_g = Math.round(parseFloat(weightOzMatch[1]) * 28.35);
		}
	}

	// Extract length — multiple formats including cm, reversed, and dimension triplets
	const lengthMmMatch = text.match(/(?:length|overall)[:\s]*(\d+(?:\.\d+)?)\s*mm\b/i);
	if (lengthMmMatch) result.length_mm = parseFloat(lengthMmMatch[1]);
	else {
		// Reversed format: "114mm(length)" or "72.6mm (length)"
		const reversedMm = text.match(/(\d+(?:\.\d+)?)\s*mm\s*\(?length\)?/i);
		if (reversedMm) result.length_mm = parseFloat(reversedMm[1]);
		else {
			// Centimeters format: "Length: 4.25 in. (10.8 cm)" or "10.8 centimeters"
			const cmMatch = text.match(/(?:length|overall)[:\s]*(?:\d+(?:\.\d+)?\s*(?:in\.?|inches?|")?\s*\(?\s*)?(\d+(?:\.\d+)?)\s*(?:cm|centimeters?)\)?/i);
			if (cmMatch) result.length_mm = Math.round(parseFloat(cmMatch[1]) * 10);
			else {
				// Inches-only format
				const lengthInMatch = text.match(/(?:length|overall)[:\s]*(\d+(?:\.\d+)?)\s*(?:in(?:ches?)?|")\b/i);
				if (lengthInMatch) result.length_mm = Math.round(parseFloat(lengthInMatch[1]) * 25.4);
			}
		}
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
		[/\b21700[iI]?\b/, '21700'], [/\b18650[iI]?\b/, '18650'], [/\b18350\b/, '18350'],
		[/\b16340\b/, '16340'], [/\b14500\b/, '14500'], [/\bCR123A?\b/i, 'CR123A'],
		[/\b26650\b/, '26650'], [/\b26800\b/, '26800'],
		[/\bAA\b(?![\w])/, 'AA'], [/\bAAA\b/, 'AAA'],
	];
	for (const [re, name] of batteryPatterns) {
		if (re.test(text) && !batteries.includes(name)) batteries.push(name);
	}
	if (batteries.length > 0) result.battery = batteries;

	// Extract LED types — comprehensive pattern list
	const leds: string[] = [];
	const ledPatterns: [RegExp, string][] = [
		[/\bLuminus\s+SFT[\s-]?70\b/i, 'Luminus SFT70'],
		[/\bLuminus\s+SFT[\s-]?40\b/i, 'Luminus SFT40'],
		[/\bSST[\s-]?10\b/i, 'SST-10'], [/\bSST[\s-]?20\b/i, 'SST-20'],
		[/\bSST[\s-]?40\b/i, 'SST-40'], [/\bSST[\s-]?70\b/i, 'SST-70'],
		[/\bSFT[\s-]?40\b/i, 'SFT-40'], [/\bSFT[\s-]?42\w?\b/i, 'SFT-42'],
		[/\bSFT[\s-]?70\b/i, 'SFT-70'],
		[/\bXHP[\s-]?50(?:\.\d)?\b/i, 'XHP50'], [/\bXHP[\s-]?70(?:\.\d)?\b/i, 'XHP70'],
		[/\bXM[\s-]?L2?\b/i, 'XM-L2'], [/\bXP[\s-]?L\s*(?:HI|HD|V6)?\b/i, 'XP-L'],
		[/\bXP[\s-]?G[23S]?\b/i, 'XP-G'], [/\bXP[\s-]?E2?\b/i, 'XP-E'],
		[/\b519A\b/, '519A'], [/\b219[BCF]\b/, '219B'], [/\b319A\b/, '319A'],
		[/\bLH351D\b/i, 'LH351D'], [/\bE21A\b/, 'E21A'],
		[/\bCree\s+XHP/i, 'Cree XHP'], [/\bCree\s+XP/i, 'Cree XP'],
		[/\bOSRAM\b/i, 'Osram'], [/\bCOB\b/, 'COB'], [/\bLEP\b/, 'LEP'],
		[/\b7070\b/, '7070'], [/\bNichia\b/i, 'Nichia'],
		[/\bC4\s*LED\b/i, 'C4'], // Streamlight proprietary
		[/\bLUXEON\s+TX\b/i, 'Luxeon TX'], [/\bSFN60\b/i, 'SFN60'],
	];
	for (const [re, name] of ledPatterns) {
		if (re.test(text) && !leds.includes(name)) leds.push(name);
	}
	if (leds.length > 0) result.led = leds;

	// Extract price
	const priceMatch = text.match(/\$(\d+(?:\.\d{2})?)\b/);
	if (priceMatch) result.price_usd = parseFloat(priceMatch[1]);

	// === RUNTIME — was completely missing ===
	const runtimes: number[] = [];
	const runtimeRe = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/gi;
	let rtm;
	while ((rtm = runtimeRe.exec(text)) !== null) {
		const val = parseFloat(rtm[1]);
		if (val > 0 && val < 5000 && !runtimes.includes(val)) runtimes.push(val);
	}
	if (runtimes.length > 0) result.runtime_hours = runtimes;

	// === SWITCH — was completely missing ===
	const switches: string[] = [];
	if (/tail[\s-]?switch|tail[\s-]?cap\s*switch|tail\s*click|tactical\s*tail|single\s*tail/i.test(text)) switches.push('tail');
	if (/side[\s-]?switch|side\s*button|single\s*side/i.test(text)) switches.push('side');
	if (/dual[\s-]?switch|body\s*and\s*tail|dual\s*(?:power\s*)?switch/i.test(text)) switches.push('dual');
	if (/rotary\b|twist(?:ing)?\s*(?:switch|head|ring)/i.test(text)) switches.push('rotary');
	if (/push[\s-]?button\s*(?:tail|rear)/i.test(text) && !switches.includes('tail')) switches.push('tail');
	if (switches.length > 0) result.switch = switches;

	// === MATERIAL — was completely missing ===
	const materials: string[] = [];
	if (/\baluminum\b|\baluminium\b|A6061|AL6061|6061[\s-]?T6|aluminum\s*alloy|aero\s*grade\s*aluminum/i.test(text)) materials.push('aluminum');
	if (/\btitanium\b/i.test(text)) materials.push('titanium');
	if (/\bcopper\b/i.test(text)) materials.push('copper');
	if (/\bbrass\b/i.test(text)) materials.push('brass');
	if (/\bstainless\b/i.test(text)) materials.push('stainless steel');
	if (/\bpolymer\b|\bplastic\b|\bnylon\b|\bpolycarbonate\b|\bpolyamide\b|\babs\b/i.test(text)) materials.push('polymer');
	if (materials.length > 0) result.material = materials;

	// === FEATURES — was completely missing ===
	const features: string[] = [];
	if (/\bclip\b/i.test(text) && !/video\s*clip/i.test(text)) features.push('clip');
	if (/\bmagnet(?:ic)?\b/i.test(text) && !/magnetic\s*charg/i.test(text)) features.push('magnet');
	if (/\blanyard\b/i.test(text)) features.push('lanyard');
	if (/\blockout\b/i.test(text)) features.push('lockout');
	if (/\bmemory\b/i.test(text) && !/card|flash\s*memory|storage/i.test(text)) features.push('mode memory');
	if (/\banduril\b/i.test(text)) features.push('Anduril');
	if (/\brechargeable\b/i.test(text)) features.push('rechargeable');
	if (/\bpower\s*bank\b/i.test(text)) features.push('power bank');
	if (/\banti[\s-]?roll\b/i.test(text)) features.push('anti-roll');
	if (/\bthermal\s*(?:regulation|management|step)/i.test(text)) features.push('thermal stepdown');
	if (/\bstrike\s*bezel\b|\bglass\s*break/i.test(text)) features.push('strike bezel');
	if (features.length > 0) result.features = features;

	// === ENVIRONMENT / IP RATING — was broken (matched but never stored) ===
	const environment: string[] = [];
	const ipMatch = text.match(/\bIP[X\-]?(\d{1,2})\b/i);
	if (ipMatch) {
		const rating = ipMatch[1].length === 1 ? `IPX${ipMatch[1]}` : `IP${ipMatch[1]}`;
		environment.push(rating);
	}
	if (environment.length > 0) result.environment = environment;

	// === CHARGING — was completely missing ===
	const charging: string[] = [];
	if (/usb[\s-]?c\b|type[\s-]?c\b/i.test(text)) charging.push('USB-C');
	if (/micro[\s-]?usb/i.test(text)) charging.push('Micro-USB');
	if (/magnetic\s*charg/i.test(text)) charging.push('magnetic');
	if (charging.length > 0) result.charging = charging;

	// === BLINK MODES — was completely missing ===
	const blink: string[] = [];
	if (/\bstrobe\b/i.test(text)) blink.push('strobe');
	if (/\bsos\b/i.test(text)) blink.push('SOS');
	if (/\bbeacon\b/i.test(text)) blink.push('beacon');
	if (blink.length > 0) result.blink = blink;

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
