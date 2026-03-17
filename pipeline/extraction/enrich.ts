/**
 * Enrichment pipeline — fills missing attributes ONLY from real sources.
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  DATA INTEGRITY RULE: NEVER FABRICATE OR INFER DATA VALUES.    ║
 * ║                                                                ║
 * ║  Allowed:                                                      ║
 * ║  • Scraping real values from manufacturer product pages         ║
 * ║  • ANSI FL1 derivation: intensity = (throw/2)^2 and reverse   ║
 * ║  • Color keyword detection from model name (observable fact)    ║
 * ║  • Type classification from product title (observable fact)     ║
 * ║                                                                ║
 * ║  FORBIDDEN — these produce incorrect data:                     ║
 * ║  • Guessing weight from battery type                           ║
 * ║  • Guessing length from battery type                           ║
 * ║  • Guessing lumens from LED type                               ║
 * ║  • Guessing price from brand averages                          ║
 * ║  • Defaulting material to "aluminum"                           ║
 * ║  • Defaulting switch to "side"                                 ║
 * ║  • Defaulting battery to "18650"                               ║
 * ║  • Defaulting features to ["clip"]                             ║
 * ║  • Any heuristic, estimate, or "reasonable average"            ║
 * ║                                                                ║
 * ║  If a value is unknown, leave it EMPTY. Empty is honest.       ║
 * ║  A wrong value is worse than no value.                         ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */
import type { FlashlightEntry } from '../schema/canonical.js';
import { getAllFlashlights, upsertFlashlight, getRawSpecText } from '../store/db.js';
import { scrapeProductPage } from './manufacturer-scraper.js';

/** Well-known manufacturer product page URL patterns */
const BRAND_URL_PATTERNS: Record<string, (model: string) => string[]> = {
	'Fenix': (m) => [
		`https://www.fenixlighting.com/${m.toLowerCase().replace(/\s+/g, '-')}.html`,
		`https://www.fenixlighting.com/products/${m.toLowerCase().replace(/\s+/g, '-')}`,
	],
	'Acebeam': (m) => [
		`https://www.acebeam.com/product/${m.toLowerCase().replace(/\s+/g, '-')}`,
		`https://www.acebeam.com/${m.toLowerCase().replace(/\s+/g, '-')}`,
	],
	'Nitecore': (m) => [
		`https://www.nitecore.com/product/${m.toLowerCase().replace(/\s+/g, '-')}`,
	],
	'Olight': (m) => [
		`https://www.olightstore.com/product/${m.toLowerCase().replace(/\s+/g, '-')}.html`,
		`https://www.olightstore.com/${m.toLowerCase().replace(/\s+/g, '-')}.html`,
	],
	'ThruNite': (m) => [
		`https://www.thrunite.com/product/${m.toLowerCase().replace(/\s+/g, '-')}/`,
		`https://www.thrunite.com/${m.toLowerCase().replace(/\s+/g, '-')}/`,
	],
	'Wurkkos': (m) => [
		`https://wurkkos.com/products/${m.toLowerCase().replace(/\s+/g, '-')}`,
	],
	'Sofirn': (m) => [
		`https://www.sofirnlight.com/products/${m.toLowerCase().replace(/\s+/g, '-')}`,
	],
	'Streamlight': (m) => [
		`https://www.streamlight.com/products/${m.toLowerCase().replace(/\s+/g, '-')}`,
	],
	'Emisar': (m) => [
		`https://intl-outdoor.com/emisar-${m.toLowerCase().replace(/\s+/g, '-')}-high-power-led-flashlight.html`,
		`https://intl-outdoor.com/${m.toLowerCase().replace(/\s+/g, '-')}.html`,
	],
	'Noctigon': (m) => [
		`https://intl-outdoor.com/noctigon-${m.toLowerCase().replace(/\s+/g, '-')}-high-power-led-flashlight.html`,
		`https://intl-outdoor.com/${m.toLowerCase().replace(/\s+/g, '-')}.html`,
	],
	'SureFire': (m) => [
		`https://www.surefire.com/${m.toLowerCase().replace(/\s+/g, '-')}/`,
	],
	'Armytek': (m) => [
		`https://www.armytek.com/flashlights/models/${m.toLowerCase().replace(/\s+/g, '-')}/`,
	],
};

/**
 * ANSI FL1 standard derivation: throw and intensity are mathematically linked.
 * throw_m = 2 * sqrt(intensity_cd)
 * intensity_cd = (throw_m / 2)^2
 * This is NOT fabrication — it's the definitional relationship.
 */
function deriveThrowIntensity(entry: FlashlightEntry): boolean {
	let changed = false;
	const perf = entry.performance.claimed;

	// Derive intensity from throw
	if (perf.throw_m && perf.throw_m > 0 && (!perf.intensity_cd || perf.intensity_cd <= 0)) {
		perf.intensity_cd = Math.round((perf.throw_m / 2) ** 2);
		changed = true;
	}

	// Derive throw from intensity
	if (perf.intensity_cd && perf.intensity_cd > 0 && (!perf.throw_m || perf.throw_m <= 0)) {
		perf.throw_m = Math.round(2 * Math.sqrt(perf.intensity_cd));
		changed = true;
	}

	return changed;
}

/**
 * Detect color from model name — keyword matching is an observable fact,
 * not fabrication. "Fenix PD35 Rose Gold" contains "rose" → pink.
 */
function detectColorFromModelName(entry: FlashlightEntry): boolean {
	if (entry.color.length > 0) return false; // Already has color data

	const colorKeywords: Record<string, string> = {
		'black': 'black', 'midnight': 'black',
		'pink': 'pink', 'rose': 'pink', 'rose gold': 'pink',
		'red': 'red', 'crimson': 'red', 'wine': 'red',
		'blue': 'blue', 'navy': 'blue', 'cobalt': 'blue', 'sapphire': 'blue',
		'green': 'green', 'olive': 'green', 'od green': 'green', 'odg': 'green',
		'orange': 'orange',
		'yellow': 'yellow',
		'purple': 'purple', 'violet': 'purple',
		'white': 'white',
		'silver': 'silver', 'chrome': 'silver',
		'gray': 'gray', 'grey': 'gray', 'gunmetal': 'gray',
		'copper': 'copper',
		'brass': 'brass',
		'brown': 'brown', 'tan': 'brown', 'desert': 'brown', 'sand': 'brown',
		'fde': 'brown', 'flat dark earth': 'brown',
		'camo': 'camo', 'camouflage': 'camo',
		'teal': 'teal', 'turquoise': 'teal',
		'rainbow': 'rainbow', 'gold': 'gold', 'titanium gray': 'gray',
		'khaki': 'brown', 'beige': 'brown', 'stonewash': 'gray',
	};

	const title = entry.model.toLowerCase();
	const detected: string[] = [];
	for (const [keyword, color] of Object.entries(colorKeywords)) {
		if (title.includes(keyword) && !detected.includes(color)) {
			detected.push(color);
		}
	}

	if (detected.length > 0) {
		entry.color = detected;
		return true;
	}
	return false;
}

/**
 * Try to scrape manufacturer website for an entry and merge specs.
 * Returns true if any new data was found.
 */
async function enrichFromManufacturer(entry: FlashlightEntry): Promise<boolean> {
	const urlPatterns = BRAND_URL_PATTERNS[entry.brand];
	if (!urlPatterns) return false;

	const urls = urlPatterns(entry.model);
	for (const url of urls) {
		try {
			const { specs } = await scrapeProductPage(url);
			let enriched = false;

			if (specs.lumens?.length && (!entry.performance.claimed.lumens?.length)) {
				entry.performance.claimed.lumens = specs.lumens;
				enriched = true;
			}
			if (specs.intensity_cd && !entry.performance.claimed.intensity_cd) {
				entry.performance.claimed.intensity_cd = specs.intensity_cd;
				enriched = true;
			}
			if (specs.throw_m && !entry.performance.claimed.throw_m) {
				entry.performance.claimed.throw_m = specs.throw_m;
				enriched = true;
			}
			if (specs.weight_g && !entry.weight_g) {
				entry.weight_g = specs.weight_g;
				enriched = true;
			}
			if (specs.length_mm && !entry.length_mm) {
				entry.length_mm = specs.length_mm;
				enriched = true;
			}
			if (specs.bezel_mm && !entry.bezel_mm) {
				entry.bezel_mm = specs.bezel_mm;
				enriched = true;
			}
			if (specs.body_mm && !entry.body_mm) {
				entry.body_mm = specs.body_mm;
				enriched = true;
			}
			if (specs.battery?.length && (!entry.battery.length || entry.battery[0] === 'unknown')) {
				entry.battery = specs.battery;
				enriched = true;
			}
			if (specs.led?.length && (!entry.led.length || entry.led[0] === 'unknown')) {
				entry.led = specs.led;
				enriched = true;
			}
			if (specs.cri) {
				entry.performance.claimed.cri = specs.cri;
				enriched = true;
			}
			if (specs.cct) {
				entry.performance.claimed.cct = specs.cct;
				enriched = true;
			}
			if (specs.price_usd && !entry.price_usd) {
				entry.price_usd = specs.price_usd;
				enriched = true;
			}
			if (specs.runtime_hours?.length && (!entry.performance.claimed.runtime_hours?.length)) {
				entry.performance.claimed.runtime_hours = specs.runtime_hours;
				enriched = true;
			}
			if (specs.switch?.length && !entry.switch.length) {
				entry.switch = specs.switch;
				enriched = true;
			}
			if (specs.material?.length && !entry.material.length) {
				entry.material = specs.material;
				enriched = true;
			}
			if (specs.features?.length && !entry.features.length) {
				entry.features = specs.features;
				enriched = true;
			}
			if (specs.environment?.length && !entry.environment.length) {
				entry.environment = specs.environment;
				enriched = true;
			}
			if (specs.charging?.length && !entry.charging.length) {
				entry.charging = specs.charging;
				enriched = true;
			}
			if (specs.blink?.length && !entry.blink.length) {
				entry.blink = specs.blink;
				enriched = true;
			}

			return enriched;
		} catch {
			continue;
		}
	}

	return false;
}

/**
 * Extract observable specs from the product title/model name.
 * These are NOT guesses — the data is literally in the product name.
 * E.g., "Fenix PD36R 21700 XHP50 2800lm" → battery=21700, led=XHP50
 */
function enrichFromTitle(entry: FlashlightEntry): boolean {
	const title = entry.model;
	let changed = false;

	// Lumens from title (only if empty)
	// Battery Junction: "Model - 1800 Lumens - Includes 1 x 18650"
	// Shopify: "Model 5600lm" or "Model 1200 Lumen"
	if (!entry.performance?.claimed?.lumens?.length) {
		const lumMatch = title.match(/(\d[\d,]*)\s*(?:lumens?|lm)\b/i);
		if (lumMatch) {
			const lm = parseInt(lumMatch[1].replace(/,/g, ''), 10);
			if (lm > 0 && lm < 1_000_000) {
				if (!entry.performance) entry.performance = { claimed: {} } as FlashlightEntry['performance'];
				entry.performance.claimed.lumens = [lm];
				changed = true;
			}
		}
	}

	// LED from title (only if empty)
	if (!entry.led?.length) {
		const ledPatterns: [RegExp, string][] = [
			[/\bXHP\d+(?:\.\d+)?(?:\s*HI)?\b/i, ''], // Use matched text
			[/\bXM[\s-]?L2?\b/i, 'XM-L2'], [/\bXP[\s-]?L\w?\b/i, 'XP-L'],
			[/\bXP[\s-]?G[23S]?\b/i, 'XP-G'], [/\bXP[\s-]?E2?\b/i, 'XP-E'],
			[/\bXP[\s-]?C\b/i, 'XP-C'], [/\bXQ[\s-]?E\b/i, 'XQ-E'],
			[/\bXPH[\s-]?\d+/i, 'XHP35'],
			[/\bSST[\s-]?\d+\w?\b/i, ''], [/\bSFT[\s-]?\d+\w?\b/i, ''],
			[/\bSBT[\s-]?\d+\w?\b/i, ''],
			[/\b519A\b/, '519A'], [/\b219[BCF]\b/, ''],
			[/\bLH351D\b/i, 'LH351D'], [/\bGT[\s-]?FC40\b/i, 'GT-FC40'],
			[/\bNichia\b/i, 'Nichia'], [/\bOsram\b/i, 'Osram'],
			[/\bLuminus\b/i, 'Luminus'], [/\bCOB\b/, 'COB'], [/\bLEP\b/, 'LEP'],
			[/\bC4\s*LED\b/i, 'C4 LED'], [/\bUV\s*LED\b/i, 'UV LED'],
			[/\bRGB\s*LED\b/i, 'RGB LED'],
			[/\bWhite\s*Laser\b/i, 'White Laser'],
		];
		for (const [re, name] of ledPatterns) {
			const m = title.match(re);
			if (m) {
				entry.led = [name || m[0]];
				changed = true;
				break;
			}
		}
	}

	// Battery from title (only if empty)
	// Use (?:^|\D) instead of \b to handle "1x18650" where \b fails between "x" and "1"
	if (!entry.battery?.length) {
		const batPatterns: [RegExp, string][] = [
			[/(?:^|\D)21700(?:\D|$)/, '21700'], [/(?:^|\D)18650(?:\D|$)/, '18650'],
			[/(?:^|\D)18350(?:\D|$)/, '18350'], [/(?:^|\D)14500(?:\D|$)/, '14500'],
			[/(?:^|\D)26650(?:\D|$)/, '26650'], [/(?:^|\D)26800(?:\D|$)/, '26800'],
			[/(?:^|\D)16340(?:\D|$)/, '16340'], [/(?:^|\D)10440(?:\D|$)/, '10440'],
			[/(?:^|\D)10280(?:\D|$)/, '10280'],
			[/CR123A?\b/i, 'CR123A'],
			[/\b(?:AA|1xAA|2xAA|3xAA)\b(?!A)/i, 'AA'], [/\bAAA\b/i, 'AAA'],
		];
		for (const [re, name] of batPatterns) {
			if (re.test(title)) {
				entry.battery = [name];
				changed = true;
				break;
			}
		}
	}

	// Throw from title: "500m Range", "500 meters beam distance", "1600Lumen 500 Meters", "5600lm 1500m"
	if (!entry.performance?.claimed?.throw_m) {
		const throwM = title.match(/(\d{2,4})\s*m(?:eters?)?\s*(?:range|beam|throw|distance)/i)
			?? title.match(/(?:range|beam|throw|distance)[:\s]*(\d{2,4})\s*m\b/i)
			// "1000Lumens 120 Meters" — lumens followed by meters
			?? title.match(/\d+\s*lumens?\s+(\d{2,4})\s*meters?\b/i)
			// "5600lm 1500m" — short lm/m format common in flashlight product titles
			?? title.match(/\d+\s*lm\s+(\d{2,4})\s*m\b/i)
			// "NNNm Thrower" or "NNNm Throw" or "NNNm Tactical"
			?? title.match(/(\d{2,4})\s*m\s+(?:Throw(?:er)?|Tactical|EDC|Spotlight|Flood)/i);
		if (throwM) {
			const val = parseInt(throwM[1], 10);
			if (val >= 20 && val <= 5000) {
				if (!entry.performance) entry.performance = { claimed: {} } as FlashlightEntry['performance'];
				entry.performance.claimed.throw_m = val;
				changed = true;
			}
		}
	}

	// Material from title
	if (!entry.material?.length) {
		if (/\btitanium\b/i.test(title)) { entry.material = ['titanium']; changed = true; }
		else if (/\bcopper\b/i.test(title)) { entry.material = ['copper']; changed = true; }
		else if (/\bbrass\b/i.test(title)) { entry.material = ['brass']; changed = true; }
		else if (/\bstainless\s*steel\b/i.test(title)) { entry.material = ['stainless steel']; changed = true; }
		else if (/\b(?:alumin(?:um|ium))\b/i.test(title)) { entry.material = ['aluminum']; changed = true; }
		else if (/\bdamascus\b/i.test(title)) { entry.material = ['damascus steel']; changed = true; }
		else if (/\bzirconium\b/i.test(title)) { entry.material = ['zirconium']; changed = true; }
		else if (/\bpolymer\b/i.test(title)) { entry.material = ['polymer']; changed = true; }
		else if (/\bpolycarbonate\b/i.test(title)) { entry.material = ['polycarbonate']; changed = true; }
	}

	return changed;
}

/**
 * Extract switch, material, runtime, and other specs from raw_spec_text.
 * These are real values present in product descriptions — not fabrication.
 */
function enrichFromRawSpecText(entry: FlashlightEntry): boolean {
	const rawTexts = getRawSpecText(entry.id);
	if (rawTexts.length === 0) return false;

	// Combine all raw text for this entry
	const combined = rawTexts.map(r => r.text_content).join('\n');
	let changed = false;

	// Switch type extraction (only if missing)
	if (!entry.switch?.length) {
		const switchPatterns: [RegExp, string][] = [
			[/\btail[\s-]*(?:cap\s+)?switch\b/i, 'tail'],
			[/\bside[\s-]*switch\b/i, 'side'],
			[/\brotary\b.*?\bswitch\b|\bswitch\b.*?\brotary\b/i, 'rotary'],
			[/\btwist(?:y)?[\s-]*(?:head|switch)\b/i, 'twisty'],
			[/\bpush[\s-]*button\b/i, 'push button'],
			[/\btactical[\s-]*(?:tail\s+)?switch\b/i, 'tail'],
			[/\bdual[\s-]*switch\b/i, 'dual'],
			[/\belectronic[\s-]*(?:side\s+)?switch\b/i, 'electronic'],
			[/\bmagnetic[\s-]*(?:ring|control)\b/i, 'magnetic ring'],
			[/\bclicky\b/i, 'tail'],
		];
		const detected: string[] = [];
		for (const [re, switchType] of switchPatterns) {
			if (re.test(combined) && !detected.includes(switchType)) {
				detected.push(switchType);
			}
		}
		if (detected.length > 0 && detected.length <= 2) {
			entry.switch = detected;
			changed = true;
		}
	}

	// Material extraction (only if missing)
	if (!entry.material?.length) {
		const matPatterns: [RegExp, string][] = [
			[/\b(?:6061|7075|A6061)[\s-]*T6?\s*alum/i, 'aluminum'],
			[/\balumini?um\s*(?:alloy|body|construction|housing)?\b/i, 'aluminum'],
			[/\bstainless\s*steel\b/i, 'stainless steel'],
			[/\bpolycarbonate\b/i, 'polycarbonate'],
			[/\btitanium\b/i, 'titanium'],
			[/\bpolymer\b/i, 'polymer'],
			[/\bnylon\b/i, 'nylon'],
			[/\bcopper\s*(?:body|construction|housing)?\b/i, 'copper'],
			[/\bbrass\s*(?:body|construction|housing)?\b/i, 'brass'],
			[/\bABS\s*(?:plastic|body)?\b/, 'ABS'],
		];
		const detected: string[] = [];
		for (const [re, mat] of matPatterns) {
			if (re.test(combined) && !detected.includes(mat)) {
				detected.push(mat);
				if (detected.length >= 2) break; // Cap at 2 materials
			}
		}
		if (detected.length > 0) {
			entry.material = detected;
			changed = true;
		}
	}

	// Runtime extraction from raw text (only if missing)
	if (!entry.performance?.claimed?.runtime_hours?.length) {
		// "Runtime: 1.5h (high) / 8h (low)" or "120 hours" or "2h 30min"
		const runtimePatterns = [
			// "XX hours" or "XXh" patterns — capture the highest value
			/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*(?:\(?\s*(?:high|turbo|max)\s*\)?)/i,
			/(?:runtime|run\s*time)[:\s]*(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i,
			/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*(?:of\s+)?runtime/i,
		];
		for (const re of runtimePatterns) {
			const m = combined.match(re);
			if (m) {
				const hrs = parseFloat(m[1]);
				if (hrs > 0 && hrs < 10000) {
					if (!entry.performance) entry.performance = { claimed: {} } as FlashlightEntry['performance'];
					entry.performance.claimed.runtime_hours = [hrs];
					changed = true;
					break;
				}
			}
		}
	}

	// Features extraction from raw text (only if missing)
	if (!entry.features?.length) {
		const featurePatterns: [RegExp, string][] = [
			[/\bpocket\s*clip\b/i, 'clip'],
			[/\bbelt\s*clip\b/i, 'clip'],
			[/\b(?:removable|two[\s-]way)\s*clip\b/i, 'clip'],
			[/\bmagnetic\s*(?:tail(?:\s*cap)?|base|end)\b/i, 'magnetic tailcap'],
			[/\btail[\s-]*stand\b/i, 'magnetic tailcap'],
			[/\bIPX[4-9]\b/i, 'waterproof'],
			[/\bwaterproof\b/i, 'waterproof'],
			[/\bwater[\s-]*resistant\b/i, 'waterproof'],
			[/\brechargeable\b/i, 'rechargeable'],
			[/\bUSB[\s-]*C?\s*charg/i, 'rechargeable'],
			[/\bbuilt[\s-]*in\s*(?:battery|charging)\b/i, 'rechargeable'],
			[/\blockout\b/i, 'lockout'],
			[/\bstrobe\b/i, 'strobe'],
			[/\bSOS\b/, 'SOS'],
			[/\blanyard\b/i, 'lanyard'],
			[/\bholster\b/i, 'holster'],
			[/\bmemory\s*mode\b/i, 'mode memory'],
			[/\bpower\s*indicator\b/i, 'power indicator'],
			[/\bbattery\s*(?:level\s*)?indicator\b/i, 'power indicator'],
			[/\banti[\s-]*roll\b/i, 'anti-roll'],
		];
		const detected: string[] = [];
		for (const [re, feat] of featurePatterns) {
			if (re.test(combined) && !detected.includes(feat)) {
				detected.push(feat);
			}
		}
		if (detected.length > 0) {
			entry.features = detected;
			changed = true;
		}
	}

	// Color from raw text (only if missing — supplement model name detection)
	if (!entry.color?.length) {
		const colorPatterns: [RegExp, string][] = [
			[/\bavailable\s+in\s+(?:\w+\s+)?black\b/i, 'black'],
			[/\bcolor:\s*black\b/i, 'black'],
			[/\bdesert\s*tan\b/i, 'brown'],
			[/\bOD\s*green\b/i, 'green'],
			[/\bcamo(?:uflage)?\s+(?:pattern|finish)\b/i, 'camo'],
		];
		for (const [re, color] of colorPatterns) {
			if (re.test(combined)) {
				entry.color = [color];
				changed = true;
				break;
			}
		}
	}

	return changed;
}

/**
 * Run enrichment on all entries.
 * Phase 1: Manufacturer website scraping (real data)
 * Phase 2: ANSI FL1 derivation (throw ↔ intensity)
 * Phase 3: Color detection from model name (observable fact)
 * Phase 4: Extract specs from title (observable fact)
 * Phase 5: Extract switch/material/runtime from raw spec text (real values)
 *
 * NO PHASE FOR: guessing, estimating, defaulting, or inferring.
 */
export async function enrichAllEntries(options: {
	scrapeManufacturers?: boolean;
	maxScrape?: number;
} = {}): Promise<{
	total: number;
	enriched: number;
}> {
	const { scrapeManufacturers = false, maxScrape = 50 } = options;

	const entries = getAllFlashlights();
	let enriched = 0;
	let scraped = 0;

	for (const entry of entries) {
		let wasEnriched = false;

		// Phase 1: Scrape manufacturer websites for real data
		if (scrapeManufacturers && scraped < maxScrape) {
			try {
				const found = await enrichFromManufacturer(entry);
				if (found) wasEnriched = true;
				scraped++;
				if (scraped % 10 === 0) await Bun.sleep(1000);
			} catch {
				// Skip failed scrapes
			}
		}

		// Phase 2: ANSI FL1 throw ↔ intensity derivation (exact formula)
		if (deriveThrowIntensity(entry)) {
			wasEnriched = true;
		}

		// Phase 3: Color from model name (observable, not fabricated)
		if (detectColorFromModelName(entry)) {
			wasEnriched = true;
		}

		// Phase 4: Extract LED, battery, throw from product title (observable fact)
		if (enrichFromTitle(entry)) {
			wasEnriched = true;
		}

		// Phase 5: Extract switch, material, runtime from raw spec text (real values)
		if (enrichFromRawSpecText(entry)) {
			wasEnriched = true;
		}

		if (wasEnriched) {
			try {
				entry.updated_at = new Date().toISOString();
				upsertFlashlight(entry);
				enriched++;
			} catch {
				// Skip entries that would violate unique constraints
			}
		}
	}

	return {
		total: entries.length,
		enriched,
	};
}
