/**
 * Detail scraper — fetches full product page HTML to extract specs
 * not available from the Shopify JSON API (length, LED, material, etc.).
 * Runs as enrichment pass on existing DB entries.
 */
import { getAllFlashlights, upsertFlashlight, addSource, addRawSpecText, getScrapedUrlSet } from '../store/db.js';
import { hasRequiredAttributes } from '../schema/canonical.js';
import type { FlashlightEntry } from '../schema/canonical.js';
import { fetchPage, htmlToText } from './manufacturer-scraper.js';

const CRAWL_DELAY = 1200; // ms between requests

/**
 * Scrape the full product page HTML for missing specs.
 * Uses the entry's info_urls or purchase_urls to find the product page.
 */
export async function scrapeDetailForEntry(
	entry: FlashlightEntry,
	scrapedUrls?: Set<string>,
): Promise<{
	enriched: boolean;
	fieldsAdded: string[];
	skipped: boolean;
}> {
	const fieldsAdded: string[] = [];

	// Find a URL to scrape
	const urls = [...(entry.info_urls ?? []), ...(entry.purchase_urls ?? [])];
	if (urls.length === 0) return { enriched: false, fieldsAdded, skipped: false };

	// Skip entries where ALL URLs were already scraped (no new pages to try)
	if (scrapedUrls && urls.every((u) => scrapedUrls.has(u))) {
		return { enriched: false, fieldsAdded, skipped: true };
	}

	for (const url of urls) {
		// Skip individual URLs already scraped
		if (scrapedUrls?.has(url)) continue;

		try {
			const html = await fetchPage(url);
			const text = htmlToText(html);

			// Extract specs from full page HTML (more aggressive than body_html)
			enrichFromFullPage(entry, html, text, fieldsAdded, url);

			if (fieldsAdded.length > 0) {
				entry.updated_at = new Date().toISOString();
				return { enriched: true, fieldsAdded, skipped: false };
			}
		} catch {
			// Try next URL
			continue;
		}
	}

	return { enriched: false, fieldsAdded, skipped: false };
}

/**
 * Extract detailed specs from full product page HTML.
 * Handles Shopify cus-lqd-specs format, generic spec tables, and text patterns.
 */
function enrichFromFullPage(
	entry: FlashlightEntry,
	html: string,
	_text: string,
	fieldsAdded: string[],
	url: string = '',
): void {
	// Normalize smart quotes and special chars for reliable regex matching
	const text = _text
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'") // Smart single quotes → '
		.replace(/[\u2033\u2036]/g, '"')  // Double prime → "
		.replace(/[\u201C\u201D\u201E\u201F\u2034\u2037]/g, '"') // Smart double quotes → "
		.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-') // Various dashes → -
		.replace(/\u00A0/g, ' '); // Non-breaking space → space

	// === LENGTH / DIMENSIONS ===
	if (!entry.length_mm || entry.length_mm <= 0) {
		// Fenix format: 'Length: 5.74" (145.8mm)' — with smart quotes normalized
		let m = text.match(/length[:\s]*(\d+(?:\.\d+)?)["\s]*(?:inch(?:es)?|in\.?)?\s*\(?\s*(\d+(?:\.\d+)?)\s*mm\)?/i);
		if (m) {
			entry.length_mm = parseFloat(m[2]);
			fieldsAdded.push('length_mm');
		} else {
			// Direct mm format: "Length: 145.8 mm"
			m = text.match(/(?:length|overall\s*length|total\s*length)[:\s]*(\d+(?:\.\d+)?)\s*mm/i);
			if (m) {
				entry.length_mm = parseFloat(m[1]);
				fieldsAdded.push('length_mm');
			} else {
				// Reversed format: "114mm(length)" or "72.6mm (length)"
				m = text.match(/(\d+(?:\.\d+)?)\s*mm\s*\(?length\)?/i);
				if (m) {
					entry.length_mm = parseFloat(m[1]);
					fieldsAdded.push('length_mm');
				} else {
					// Centimeters format: "Length: 10.8 cm" or "10.8 centimeters"
					m = text.match(/(?:length|overall\s*length)[:\s]*(?:\d+(?:\.\d+)?\s*(?:in\.?|inch(?:es)?|")?\s*\(?\s*)?(\d+(?:\.\d+)?)\s*(?:cm|centimeters?)\)?/i);
					if (m) {
						entry.length_mm = Math.round(parseFloat(m[1]) * 10);
						fieldsAdded.push('length_mm');
					} else {
						// Inches only: "Length: 5.74 inches"
						m = text.match(/(?:length|overall\s*length)[:\s]*(\d+(?:\.\d+)?)\s*(?:inch(?:es)?|in\b|")/i);
						if (m) {
							entry.length_mm = Math.round(parseFloat(m[1]) * 25.4);
							fieldsAdded.push('length_mm');
						} else {
							// Generic "NNNmm" near dimension words
							m = text.match(/(?:dimension|size|measure)[^.]*?(\d{2,4}(?:\.\d+)?)\s*mm/i);
							if (m) {
								const val = parseFloat(m[1]);
								if (val >= 20 && val <= 800) {
									entry.length_mm = val;
									fieldsAdded.push('length_mm');
								}
							}
						}
					}
				}
			}
		}
	}

	// === BEZEL/HEAD DIAMETER ===
	if (!entry.bezel_mm || entry.bezel_mm <= 0) {
		const m = text.match(/(?:head|bezel)[:\s]*(?:\d+(?:\.\d+)?\s*(?:"|in\.?)\s*\(?\s*)?(\d+(?:\.\d+)?)\s*mm/i);
		if (m) {
			entry.bezel_mm = parseFloat(m[1]);
			fieldsAdded.push('bezel_mm');
		}
	}

	// === BODY DIAMETER ===
	if (!entry.body_mm || entry.body_mm <= 0) {
		const m = text.match(/(?:body|tube|barrel)[:\s]*(?:\d+(?:\.\d+)?\s*(?:"|in\.?)\s*\(?\s*)?(\d+(?:\.\d+)?)\s*mm/i);
		if (m) {
			entry.body_mm = parseFloat(m[1]);
			fieldsAdded.push('body_mm');
		}
	}

	// === WEIGHT ===
	if (!entry.weight_g || entry.weight_g <= 0) {
		// "5.96 oz. (169g)" format
		let m = text.match(/weight[:\s]*(\d+(?:\.\d+)?)\s*(?:oz\.?|ounces?)?\s*\(?\s*(\d+(?:\.\d+)?)\s*g(?:rams?)?\)?/i);
		if (m) {
			entry.weight_g = parseFloat(m[2]);
			fieldsAdded.push('weight_g');
		} else {
			// Slash format: "1.64 oz. / 46.9 g"
			m = text.match(/(\d+(?:\.\d+)?)\s*(?:oz\.?|ounces?)\s*[/|]\s*(\d+(?:\.\d+)?)\s*g\b/i);
			if (m) {
				entry.weight_g = parseFloat(m[2]);
				fieldsAdded.push('weight_g');
			} else {
				m = text.match(/weight[:\s]*(\d+(?:\.\d+)?)\s*g(?:rams?)?\b/i);
				if (m) {
					entry.weight_g = parseFloat(m[1]);
					fieldsAdded.push('weight_g');
				} else {
					m = text.match(/weight[:\s]*(\d+(?:\.\d+)?)\s*(?:oz\.?|ounces?)\b/i);
					if (m) {
						entry.weight_g = Math.round(parseFloat(m[1]) * 28.35);
						fieldsAdded.push('weight_g');
					}
				}
			}
		}
	}

	// === LUMENS ===
	if (!entry.performance.claimed.lumens?.length) {
		const lumens: number[] = [];
		const re = /(\d[\d,]*)\s*(?:lumens?|lm)\b/gi;
		let m;
		while ((m = re.exec(text)) !== null) {
			const val = parseInt(m[1].replace(/,/g, ''), 10);
			if (val > 0 && val < 1_000_000 && !lumens.includes(val)) lumens.push(val);
		}
		if (lumens.length > 0) {
			entry.performance.claimed.lumens = lumens.sort((a, b) => b - a);
			fieldsAdded.push('lumens');
		}
	}

	// === LED TYPE ===
	if (!entry.led.length || entry.led[0] === 'unknown') {
		const leds: string[] = [];
		const ledPatterns: [RegExp, string][] = [
			[/\bLuminus\s+SFT[\s-]?70\b/i, 'Luminus SFT70'],
			[/\bLuminus\s+SFT[\s-]?40\b/i, 'Luminus SFT40'],
			[/\bSST[\s-]?20\b/i, 'SST-20'], [/\bSST[\s-]?40\b/i, 'SST-40'],
			[/\bSST[\s-]?70\b/i, 'SST-70'], [/\bSFT[\s-]?40\b/i, 'SFT-40'],
			[/\bSFT[\s-]?70\b/i, 'SFT-70'],
			[/\bXHP[\s-]?50(?:\.2|\.3)?\b/i, 'XHP50'], [/\bXHP[\s-]?70(?:\.2|\.3)?\b/i, 'XHP70'],
			[/\bXM[\s-]?L2?\b/i, 'XM-L2'], [/\bXP[\s-]?L\s*(?:HI|HD|V6)?\b/i, 'XP-L'],
			[/\bXP[\s-]?G[23]?\b/i, 'XP-G'], [/\bXP[\s-]?E2?\b/i, 'XP-E'],
			[/\b519A\b/, '519A'], [/\b219[BCF]\b/, '219B'],
			[/\bLH351D\b/i, 'LH351D'], [/\bE21A\b/, 'E21A'],
			[/\bCree\s+XHP\b/i, 'Cree XHP'], [/\bCree\s+XP\b/i, 'Cree XP'],
			[/\bOSRAM\b/i, 'Osram'], [/\bCOB\b/, 'COB'], [/\bLEP\b/, 'LEP'],
			[/\b319A\b/, '319A'], [/\bSST[\s-]?10\b/i, 'SST-10'],
			[/\bSFT[\s-]?42\b/i, 'SFT-42'], [/\bSFT[\s-]?70\b/i, 'SFT-70'],
			[/\bSFT[\s-]?90\b/i, 'SFT-90'], [/\bSBT[\s-]?90\b/i, 'SBT-90'],
			[/\bSFT[\s-]?25\b/i, 'SFT-25'], [/\b7070\b/, '7070'],
			[/\bLuminus\s+\w+/i, 'Luminus'], [/\bSamsung\s+LH/i, 'Samsung LH'],
			[/\b2835\s*LED/i, '2835'], [/\b5050\s*LED/i, '5050'],
			[/\bGT[\s-]?FC40\b/i, 'GT-FC40'], [/\bFC40\b/, 'FC40'],
			[/\bNichia\b/i, 'Nichia'],
		];
		for (const [re, name] of ledPatterns) {
			if (re.test(text) && !leds.includes(name)) leds.push(name);
		}
		if (leds.length > 0) {
			entry.led = leds;
			fieldsAdded.push('led');
		}
	}

	// === BEAM DISTANCE / THROW ===
	if (!entry.performance.claimed.throw_m) {
		// Priority 1: labeled "throw|beam distance: NNNm" format
		let m = text.match(/(?:throw|beam\s*distance|peak\s*beam\s*distance|max(?:imum)?\s*(?:beam\s*)?distance|range)[:\s]*(\d[\d,]*)\s*m(?:eters?)?(?!Ah)\b/i);
		if (m) {
			entry.performance.claimed.throw_m = parseInt(m[1].replace(/,/g, ''), 10);
			fieldsAdded.push('throw_m');
		} else {
			// Priority 2: compound "NNN feet (NNN meters)" — require explicit feet/ft label
			m = text.match(/(\d[\d,]*)\s*(?:feet|ft)\s*\(?\s*(\d[\d,]*)\s*m(?:eters?)?\s*\)?/i);
			if (m) {
				entry.performance.claimed.throw_m = parseInt(m[2].replace(/,/g, ''), 10);
				fieldsAdded.push('throw_m');
			} else {
				// Priority 3: reverse "NNNm throw|beam"
				m = text.match(/(\d[\d,]*)\s*m(?:eters?)?\s*(?:throw|beam\s*distance|beam)(?!Ah)\b/i);
				if (m) {
					entry.performance.claimed.throw_m = parseInt(m[1].replace(/,/g, ''), 10);
					fieldsAdded.push('throw_m');
				} else {
					// Priority 4: yards with conversion
					m = text.match(/(?:throw|beam\s*distance)[:\s]*(\d[\d,]*)\s*(?:yards?|yds?)\b/i);
					if (m) {
						entry.performance.claimed.throw_m = Math.round(parseInt(m[1].replace(/,/g, ''), 10) * 0.9144);
						fieldsAdded.push('throw_m');
					}
				}
			}
		}
	}

	// === INTENSITY ===
	if (!entry.performance.claimed.intensity_cd) {
		const m = text.match(/(\d[\d,]*)\s*(?:cd|candela)\b/i);
		if (m) {
			entry.performance.claimed.intensity_cd = parseInt(m[1].replace(/,/g, ''), 10);
			fieldsAdded.push('intensity_cd');
		}
	}

	// === CRI ===
	if (!entry.performance.claimed.cri) {
		const m = text.match(/CRI[:\s>]*(\d+)/i);
		if (m) {
			const cri = parseInt(m[1], 10);
			if (cri >= 50 && cri <= 100) {
				entry.performance.claimed.cri = cri;
				fieldsAdded.push('cri');
			}
		}
	}

	// === CCT ===
	if (!entry.performance.claimed.cct) {
		const m = text.match(/(\d{4,5})\s*K\b/);
		if (m) {
			const cct = parseInt(m[1], 10);
			if (cct >= 1800 && cct <= 10000) {
				entry.performance.claimed.cct = cct;
				fieldsAdded.push('cct');
			}
		}
	}

	// === MATERIAL (from full page HTML) ===
	if (!entry.material.length) {
		const materials: string[] = [];
		if (/A6061|aluminum|aluminium/i.test(text)) materials.push('aluminum');
		if (/titanium/i.test(text)) materials.push('titanium');
		if (/copper/i.test(text)) materials.push('copper');
		if (/brass/i.test(text)) materials.push('brass');
		if (/stainless/i.test(text)) materials.push('stainless steel');
		if (/polymer|plastic|nylon|polycarbonate|polyamide|abs\b/i.test(text)) materials.push('polymer');
		if (materials.length > 0) {
			entry.material = materials;
			fieldsAdded.push('material');
		}
	}

	// === SWITCH (from full page HTML) ===
	if (!entry.switch.length) {
		const switches: string[] = [];
		if (/tail[\s-]?switch|tail[\s-]?cap|tail\s*click|rear\s*switch/i.test(text)) switches.push('tail');
		if (/side[\s-]?switch|side\s*button|e[\s-]?switch|electronic\s*switch|soft[\s-]?touch\s*switch/i.test(text)) switches.push('side');
		if (/dual[\s-]?switch|two\s*switch/i.test(text)) switches.push('dual');
		if (/rotary\b|twist|magnetic\s*(?:control\s*)?ring/i.test(text)) switches.push('rotary');
		if (/push[\s-]?button|momentary/i.test(text) && switches.length === 0) switches.push('side');
		if (switches.length > 0) {
			entry.switch = switches;
			fieldsAdded.push('switch');
		}
	}

	// === BATTERY (from full page HTML) ===
	if (!entry.battery.length || entry.battery[0] === 'unknown') {
		const batteries: string[] = [];
		const patterns: [RegExp, string][] = [
			[/\b21700[iI]?\b/, '21700'], [/\b18650[iI]?\b/, '18650'], [/\b18350\b/, '18350'],
			[/\b16340\b/, '16340'], [/\b14500\b/, '14500'], [/\bCR123A?\b/i, 'CR123A'],
			[/\b26650\b/, '26650'], [/\bAA\b(?!\w)/, 'AA'], [/\bAAA\b/, 'AAA'],
		];
		for (const [re, name] of patterns) {
			if (re.test(text) && !batteries.includes(name)) batteries.push(name);
		}
		if (batteries.length > 0) {
			entry.battery = batteries;
			fieldsAdded.push('battery');
		}
	}

	// === IP RATING ===
	if (!entry.environment.length) {
		const env: string[] = [];
		const ipMatch = text.match(/\bIP[X]?(\d{1,2})\b/i);
		if (ipMatch) {
			const rating = ipMatch[1].length === 1 ? `IPX${ipMatch[1]}` : `IP${ipMatch[1]}`;
			env.push(rating);
		}
		if (env.length > 0) {
			entry.environment = env;
			fieldsAdded.push('environment');
		}
	}

	// === RUNTIME — was completely missing from detail-scraper ===
	if (!entry.performance.claimed.runtime_hours?.length) {
		const runtimes: number[] = [];
		const rtRe = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/gi;
		let rtm;
		while ((rtm = rtRe.exec(text)) !== null) {
			const val = parseFloat(rtm[1]);
			if (val > 0 && val < 5000 && !runtimes.includes(val)) runtimes.push(val);
		}
		if (runtimes.length > 0) {
			entry.performance.claimed.runtime_hours = runtimes;
			fieldsAdded.push('runtime_hours');
		}
	}

	// === FEATURES — was completely missing from detail-scraper ===
	if (!entry.features.length) {
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
		if (features.length > 0) {
			entry.features = features;
			fieldsAdded.push('features');
		}
	}

	// === BLINK MODES — was missing from detail-scraper ===
	if (!entry.blink?.length) {
		const blink: string[] = [];
		if (/\bstrobe\b/i.test(text)) blink.push('strobe');
		if (/\bsos\b/i.test(text)) blink.push('SOS');
		if (/\bbeacon\b/i.test(text)) blink.push('beacon');
		if (blink.length > 0) {
			entry.blink = blink;
			fieldsAdded.push('blink');
		}
	}

	// === IMPACT RESISTANCE — was missing from detail-scraper ===
	if (!entry.impact?.length) {
		const impactMatch = text.match(/(\d+(?:\.\d+)?)\s*m(?:eter)?s?\s*(?:impact|drop)/i);
		if (impactMatch) {
			entry.impact = [`${impactMatch[1]}m`];
			fieldsAdded.push('impact');
		}
	}

	// === CHARGING — was completely missing from detail-scraper ===
	if (!entry.charging.length) {
		const charging: string[] = [];
		if (/usb[\s-]?c\b|type[\s-]?c\b/i.test(text)) charging.push('USB-C');
		if (/micro[\s-]?usb/i.test(text)) charging.push('Micro-USB');
		if (/magnetic\s*charg/i.test(text)) charging.push('magnetic');
		if (charging.length > 0) {
			entry.charging = charging;
			fieldsAdded.push('charging');
		}
	}

	// === RAW SPEC TEXT CAPTURE for future AI parsing ===
	// Extract text segments that look like spec data but weren't fully parsed by regex.
	// These get stored in raw_spec_text table for batch AI processing later.
	captureRawSpecText(entry, text, url);
}

/**
 * Identify and store spec-like text segments that regex couldn't parse.
 * Categories: specs (tables/lists), modes (output levels), runtime, features.
 */
function captureRawSpecText(entry: FlashlightEntry, text: string, url: string): void {
	const { valid, missing } = hasRequiredAttributes(entry);
	if (valid || missing.length === 0) return; // Nothing to parse

	// Extract spec table/list sections — look for "Specifications" headers and structured data
	const specSections = extractSpecSections(text);

	for (const section of specSections) {
		// Determine category based on content
		let category = 'specs';
		if (/\b(?:mode|output|turbo|high|med|low|moonlight|eco)\b/i.test(section) &&
			/\blumen|lm\b/i.test(section)) {
			category = 'modes';
		} else if (/\bruntime|run\s*time|battery\s*life|hours?\s*(?:of|per)\b/i.test(section)) {
			category = 'runtime';
		} else if (/\b(?:dimension|size|measurement|length|width|height|diameter)\b/i.test(section)) {
			category = 'dimensions';
		} else if (/\b(?:feature|include|package|accessory|compatible)\b/i.test(section)) {
			category = 'features';
		}

		// Only store if it contains data relevant to missing fields
		const relevant = missing.some((field) => {
			switch (field) {
				case 'lumens': return /\blumen|lm\b/i.test(section);
				case 'throw_m': return /\bthrow|distance|beam|range|meter|yard|feet\b/i.test(section);
				case 'runtime_hours': return /\bruntime|run\s*time|hour|battery\s*life\b/i.test(section);
				case 'length_mm': return /\blength|dimension|size|mm\b|inch(?:es)?\b|cm\b/i.test(section);
				case 'weight_g': return /\bweight|mass|gram|oz\b|ounce/i.test(section);
				case 'led': return /\bled|emitter|cree|luminus|nichia|osram|sst|xhp/i.test(section);
				case 'battery': return /\bbattery|cell|18650|21700|cr123|14500/i.test(section);
				case 'switch': return /\bswitch|button|click|tail|side\b/i.test(section);
				case 'material': return /\bmaterial|body|alloy|aluminum|titanium|steel/i.test(section);
				case 'features': return /\bfeature|waterproof|magnetic|pocket\s*clip|usb|charging/i.test(section);
				default: return true;
			}
		});

		if (relevant && section.length >= 30 && section.length <= 5000) {
			addRawSpecText(entry.id, url, category, section.trim());
		}
	}
}

/** Extract structured spec sections from page text */
function extractSpecSections(text: string): string[] {
	const sections: string[] = [];

	// Match spec table sections: "Specifications", "Technical Data", "Features" headers
	const sectionPattern = /(?:^|\n)\s*(?:specification|technical\s*(?:data|detail|spec)|feature|performance|detail|key\s*spec)[s:]?\s*\n([\s\S]{30,2000}?)(?=\n\s*(?:specification|technical|feature|review|related|share|add\s*to\s*cart|description|about)|$)/gi;
	let m;
	while ((m = sectionPattern.exec(text)) !== null) {
		sections.push(m[1].trim());
	}

	// Also capture mode tables — lines with lumen values paired with runtime
	const modeLines: string[] = [];
	const lines = text.split('\n');
	for (const line of lines) {
		// Lines like "Turbo: 2500 lumens (1.5 hours)" or "High\t1200lm\t3h"
		if (/\b(?:turbo|high|med|low|moon|eco|strobe|sos)\b/i.test(line) &&
			/\d+\s*(?:lumen|lm|hour|hr|min)\b/i.test(line)) {
			modeLines.push(line.trim());
		}
	}
	if (modeLines.length >= 2) {
		sections.push(modeLines.join('\n'));
	}

	return sections;
}

/**
 * Run detail scraping on all entries missing required attributes.
 * Fetches full product page HTML for each entry.
 */
export async function scrapeDetailsForIncomplete(options: {
	maxItems?: number;
	onlyMissing?: string[];
	force?: boolean;
} = {}): Promise<{
	total: number;
	scraped: number;
	enriched: number;
	errors: number;
	skipped: number;
}> {
	const { maxItems = 500, onlyMissing, force = false } = options;
	const entries = getAllFlashlights();

	// Load set of already-scraped URLs to skip (unless --force)
	const scrapedUrls = force ? undefined : getScrapedUrlSet();
	if (scrapedUrls) {
		console.log(`  Loaded ${scrapedUrls.size} already-scraped URLs (use --force to re-scrape)`);
	}

	let scraped = 0;
	let enriched = 0;
	let errors = 0;
	let skipped = 0;

	for (const entry of entries) {
		if (scraped >= maxItems) break;

		const { valid, missing } = hasRequiredAttributes(entry);
		if (valid) continue;

		// If onlyMissing is specified, only scrape entries missing those specific fields
		if (onlyMissing && !missing.some((m) => onlyMissing.includes(m))) continue;

		try {
			const result = await scrapeDetailForEntry(entry, scrapedUrls);

			if (result.skipped) {
				skipped++;
				continue; // Don't count toward scraped limit, don't delay
			}

			scraped++;

			if (result.enriched) {
				upsertFlashlight(entry);
				enriched++;
			}

			if (scraped % 25 === 0) {
				console.log(`  Progress: ${scraped} scraped, ${enriched} enriched, ${skipped} skipped${result.fieldsAdded.length > 0 ? ` (${result.fieldsAdded.join(', ')})` : ''}`);
			}
		} catch {
			errors++;
		}

		await Bun.sleep(CRAWL_DELAY);
	}

	return { total: entries.length, scraped, enriched, errors, skipped };
}
