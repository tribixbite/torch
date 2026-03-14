/**
 * Detail scraper — fetches full product page HTML to extract specs
 * not available from the Shopify JSON API (length, LED, material, etc.).
 * Runs as enrichment pass on existing DB entries.
 */
import { getAllFlashlights, upsertFlashlight, addSource } from '../store/db.js';
import { hasRequiredAttributes } from '../schema/canonical.js';
import type { FlashlightEntry } from '../schema/canonical.js';
import { fetchPage, htmlToText } from './manufacturer-scraper.js';

const CRAWL_DELAY = 1200; // ms between requests

/**
 * Scrape the full product page HTML for missing specs.
 * Uses the entry's info_urls or purchase_urls to find the product page.
 */
export async function scrapeDetailForEntry(entry: FlashlightEntry): Promise<{
	enriched: boolean;
	fieldsAdded: string[];
}> {
	const fieldsAdded: string[] = [];

	// Find a URL to scrape
	const urls = [...(entry.info_urls ?? []), ...(entry.purchase_urls ?? [])];
	if (urls.length === 0) return { enriched: false, fieldsAdded };

	for (const url of urls) {
		try {
			const html = await fetchPage(url);
			const text = htmlToText(html);

			// Extract specs from full page HTML (more aggressive than body_html)
			enrichFromFullPage(entry, html, text, fieldsAdded);

			if (fieldsAdded.length > 0) {
				entry.updated_at = new Date().toISOString();
				return { enriched: true, fieldsAdded };
			}
		} catch {
			// Try next URL
			continue;
		}
	}

	return { enriched: false, fieldsAdded };
}

/**
 * Extract detailed specs from full product page HTML.
 * Handles Shopify cus-lqd-specs format, generic spec tables, and text patterns.
 */
function enrichFromFullPage(
	entry: FlashlightEntry,
	html: string,
	text: string,
	fieldsAdded: string[],
): void {
	// === LENGTH / DIMENSIONS ===
	if (!entry.length_mm || entry.length_mm <= 0) {
		// Fenix format: "Length: 5.74" (145.8mm)"
		let m = text.match(/length[:\s]*(\d+(?:\.\d+)?)["\s]*(?:inches?|in\.?)?\s*\(?\s*(\d+(?:\.\d+)?)\s*mm\)?/i);
		if (m) {
			entry.length_mm = parseFloat(m[2]);
			fieldsAdded.push('length_mm');
		} else {
			// Direct mm format: "Length: 145.8 mm" or "145.8mm length"
			m = text.match(/(?:length|overall\s*length|total\s*length)[:\s]*(\d+(?:\.\d+)?)\s*mm/i);
			if (m) {
				entry.length_mm = parseFloat(m[1]);
				fieldsAdded.push('length_mm');
			} else {
				// Inches only: "Length: 5.74 inches"
				m = text.match(/(?:length|overall\s*length)[:\s]*(\d+(?:\.\d+)?)\s*(?:inches?|in\b|")/i);
				if (m) {
					entry.length_mm = Math.round(parseFloat(m[1]) * 25.4);
					fieldsAdded.push('length_mm');
				} else {
					// Generic "NNNmm" near dimension words
					m = text.match(/(?:dimension|size|measure)[^.]*?(\d{2,4}(?:\.\d+)?)\s*mm/i);
					if (m) {
						const val = parseFloat(m[1]);
						if (val >= 20 && val <= 800) { // Reasonable flashlight length
							entry.length_mm = val;
							fieldsAdded.push('length_mm');
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
			[/\bOSRAM\b/i, 'Osram'],
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
		// "1247 feet (380 meters)" format
		let m = text.match(/(\d[\d,]*)\s*(?:feet|ft)?\s*\(?\s*(\d[\d,]*)\s*m(?:eters?)?\s*\)?/i);
		if (m) {
			entry.performance.claimed.throw_m = parseInt(m[2].replace(/,/g, ''), 10);
			fieldsAdded.push('throw_m');
		} else {
			m = text.match(/(?:beam\s*distance|throw|range)[:\s]*(\d[\d,]*)\s*m(?:eters?)?\b/i);
			if (m) {
				entry.performance.claimed.throw_m = parseInt(m[1].replace(/,/g, ''), 10);
				fieldsAdded.push('throw_m');
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
		if (/polymer|plastic|nylon|polycarbonate/i.test(text)) materials.push('polymer');
		if (materials.length > 0) {
			entry.material = materials;
			fieldsAdded.push('material');
		}
	}

	// === SWITCH (from full page HTML) ===
	if (!entry.switch.length) {
		const switches: string[] = [];
		if (/tail[\s-]?switch|tail[\s-]?cap|tail\s*click/i.test(text)) switches.push('tail');
		if (/side[\s-]?switch|side\s*button/i.test(text)) switches.push('side');
		if (/dual[\s-]?switch/i.test(text)) switches.push('dual');
		if (/rotary\b|twist/i.test(text)) switches.push('rotary');
		if (switches.length > 0) {
			entry.switch = switches;
			fieldsAdded.push('switch');
		}
	}

	// === BATTERY (from full page HTML) ===
	if (!entry.battery.length || entry.battery[0] === 'unknown') {
		const batteries: string[] = [];
		const patterns: [RegExp, string][] = [
			[/\b21700\b/, '21700'], [/\b18650\b/, '18650'], [/\b18350\b/, '18350'],
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
}

/**
 * Run detail scraping on all entries missing required attributes.
 * Fetches full product page HTML for each entry.
 */
export async function scrapeDetailsForIncomplete(options: {
	maxItems?: number;
	onlyMissing?: string[];
} = {}): Promise<{
	total: number;
	scraped: number;
	enriched: number;
	errors: number;
}> {
	const { maxItems = 500, onlyMissing } = options;
	const entries = getAllFlashlights();

	let scraped = 0;
	let enriched = 0;
	let errors = 0;

	for (const entry of entries) {
		if (scraped >= maxItems) break;

		const { valid, missing } = hasRequiredAttributes(entry);
		if (valid) continue;

		// If onlyMissing is specified, only scrape entries missing those specific fields
		if (onlyMissing && !missing.some((m) => onlyMissing.includes(m))) continue;

		try {
			const result = await scrapeDetailForEntry(entry);
			scraped++;

			if (result.enriched) {
				upsertFlashlight(entry);
				enriched++;

				if (scraped % 25 === 0) {
					console.log(`  Progress: ${scraped} scraped, ${enriched} enriched (${result.fieldsAdded.join(', ')})`);
				}
			}
		} catch {
			errors++;
		}

		await Bun.sleep(CRAWL_DELAY);
	}

	return { total: entries.length, scraped, enriched, errors };
}
