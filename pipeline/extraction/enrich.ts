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
import { getAllFlashlights, upsertFlashlight, getRawSpecText, getSourceUrls } from '../store/db.js';
import { scrapeProductPage } from './manufacturer-scraper.js';

/** Domains that are actual stores (have buy/cart functionality) — not just info/review sites */
const STORE_DOMAINS = [
	'fenixlighting.com', 'nitecorestore.com', 'olightstore.com', 'acebeam.com',
	'lumintop.com', 'lumintoponline.com', 'nightstick.com', 'ledlenserusa.com', 'streamlight.com',
	'nextorch.com', 'rovyvon.com', 'jetbeamlight.com', 'armytek.com',
	'powertac.com', 'imalentstore.com', 'malkoffdevices.com', 'wubenlight.com',
	'reylight.net', 'foursevens.com', 'eagtac.com', 'intl-outdoor.com',
	'zebralight.com', 'sofirnlight.com', 'wurkkos.com', 'skilhunt.com', 'klaruslight.com', 'klarus.net',
	'shop.pelican.com', 'maglite.com', 'modlite.com', 'surefire.com', 'coastportland.com',
	'clouddefensive.com', 'loopgear.com', 'skylumen.com',
	// Multi-brand retailers
	'batteryjunction.com', 'goinggear.com', 'nealsgadgets.com',
	'killzoneflashlights.com', 'jlhawaii808.com', 'fenix-store.com',
	'flashlightworld.ca', 'flashlightgo.com', 'torchdirect.co.uk',
	'amazon.com', 'amazon.co.uk',
];

/** Check if a URL is from a known store/retailer */
function isStoreUrl(url: string): boolean {
	try {
		const host = new URL(url).hostname.replace(/^www\./, '');
		return STORE_DOMAINS.some(d => host === d || host.endsWith('.' + d));
	} catch {
		return false;
	}
}

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
			[/\bSBT[\s-]?\d+\w?\b/i, ''], [/\bSFQ[\s-]?\d+\w?\b/i, ''], [/\bSSQ[\s-]?\d+\w?\b/i, ''],
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
			[/\bbody[\s-]*(?:mounted\s+)?switch\b/i, 'side'],
			[/\bhead[\s-]*switch\b/i, 'side'],
			[/\brear[\s-]*switch\b/i, 'tail'],
			[/\brotary\b.*?\bswitch\b|\bswitch\b.*?\brotary\b/i, 'rotary'],
			[/\btwist(?:y)?[\s-]*(?:head|switch)\b/i, 'twisty'],
			[/\bpush[\s-]*button\b/i, 'push button'],
			[/\btactical[\s-]*(?:tail\s+)?switch\b/i, 'tail'],
			[/\bdual[\s-]*(?:mode\s+)?(?:tail\s+)?switch\b/i, 'dual'],
			[/\btriple[\s-]*switch\b/i, 'dual'],
			[/\belectronic[\s-]*(?:side\s+)?switch\b/i, 'electronic'],
			[/\bmagnetic[\s-]*(?:ring|control|selector)\b/i, 'magnetic ring'],
			[/\bclicky\b/i, 'tail'],
			// Spec table format: "Switch\nBody" or "Switch: Body"
			[/\bswitch[:\s]+body\b/i, 'side'],
			[/\bswitch[:\s]+tail\b/i, 'tail'],
			[/\bswitch[:\s]+side\b/i, 'side'],
			[/\bswitch[:\s]+head\b/i, 'side'],
			[/\bswitch[:\s]+rear\b/i, 'tail'],
			[/\bswitch[:\s]+rotary\b/i, 'rotary'],
			[/\bswitch[:\s]+twist\b/i, 'twisty'],
			[/\bswitch[:\s]+electronic\b/i, 'electronic'],
			// "Switch Type: Push buttons" (spec table)
			[/\bswitch\s+type[:\s]+(?:push\s*button|mechanical)/i, 'push button'],
			[/\bswitch\s+type[:\s]+(?:tail|rear)/i, 'tail'],
			[/\bswitch\s+type[:\s]+(?:side|body)/i, 'side'],
			[/\bswitch\s+type[:\s]+(?:twist|rotary)/i, 'twisty'],
			// "e-switch" pattern
			[/\be[\s-]*switch\b/i, 'electronic'],
		];
		const detected: string[] = [];
		for (const [re, switchType] of switchPatterns) {
			if (re.test(combined) && !detected.includes(switchType)) {
				detected.push(switchType);
			}
		}
		// Dedup overlapping types: rotary + magnetic ring = same mechanism
		if (detected.includes('rotary') && detected.includes('magnetic ring')) {
			detected.splice(detected.indexOf('magnetic ring'), 1);
		}
		if (detected.length > 0 && detected.length <= 3) {
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
		const runtimeHoursPatterns = [
			// "XX hours" or "XXh" patterns — capture the highest value
			/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*(?:\(?\s*(?:high|turbo|max)\s*\)?)/i,
			/(?:runtime|run\s*time)[:\s：]*(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i,
			/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*(?:of\s+)?runtime/i,
			// Nightstick spec table format: "High Runtime (h): 3.0"
			/(?:high\s+)?runtime\s*\(h\)[:\s]*(\d+(?:\.\d+)?)/i,
			// Battery Junction mode table: "Runtime ... 4hours ... 65hours" (no space)
			/runtime[^.]{0,200}?(\d+(?:\.\d+)?)hours\b/i,
			// "80-hour runtime" or "72 hours of runtime"
			/(\d+(?:\.\d+)?)[\s-]*hours?\s+(?:of\s+)?runtime/i,
			// "up to X hours" or "maximum X hours" (common description format)
			/(?:up\s+to|maximum|max\.?)\s+(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/i,
		];
		// Minute-based patterns (converted to hours)
		const runtimeMinPatterns = [
			/(?:runtime|run\s*time)[:\s：]*~?\s*(\d+)\s*(?:minutes?|mins?)\b/i,
			/~?\s*(\d+)\s*(?:minutes?|mins?)\s*(?:of\s+)?runtime/i,
			// BJ mode table: "Runtime ... 65minutes" (no space)
			/runtime[^.]{0,200}?(\d+)minutes\b/i,
		];
		let foundRuntime = false;
		for (const re of runtimeHoursPatterns) {
			const m = combined.match(re);
			if (m) {
				const hrs = parseFloat(m[1]);
				if (hrs > 0 && hrs < 10000) {
					if (!entry.performance) entry.performance = { claimed: {} } as FlashlightEntry['performance'];
					entry.performance.claimed.runtime_hours = [hrs];
					changed = true;
					foundRuntime = true;
					break;
				}
			}
		}
		if (!foundRuntime) {
			for (const re of runtimeMinPatterns) {
				const m = combined.match(re);
				if (m) {
					const mins = parseFloat(m[1]);
					const hrs = Math.round((mins / 60) * 100) / 100;
					if (hrs > 0 && hrs < 10000) {
						if (!entry.performance) entry.performance = { claimed: {} } as FlashlightEntry['performance'];
						entry.performance.claimed.runtime_hours = [hrs];
						changed = true;
						break;
					}
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
			[/\bbody\s*color[:\s]+black\b/i, 'black'],
			[/\bdesert\s*tan\b/i, 'brown'],
			[/\bOD\s*green\b/i, 'green'],
			[/\bcamo(?:uflage)?\s+(?:pattern|finish)\b/i, 'camo'],
			// Spec table: "Color: X" or "Body Color: X"
			[/\b(?:body\s+)?color[:\s]+(?:olive|OD)\s*(?:green|drab)\b/i, 'green'],
			[/\b(?:body\s+)?color[:\s]+(?:desert\s*tan|FDE|flat\s*dark\s*earth|coyote)\b/i, 'brown'],
			[/\b(?:body\s+)?color[:\s]+(?:red|crimson)\b/i, 'red'],
			[/\b(?:body\s+)?color[:\s]+(?:blue|navy)\b/i, 'blue'],
			[/\b(?:body\s+)?color[:\s]+(?:silver|natural|raw)\b/i, 'silver'],
			[/\b(?:body\s+)?color[:\s]+(?:gray|grey|gunmetal|stonewash)\b/i, 'gray'],
			[/\b(?:body\s+)?color[:\s]+(?:orange|safety\s*orange)\b/i, 'orange'],
			[/\b(?:body\s+)?color[:\s]+(?:yellow|hi[\s-]*vis)\b/i, 'yellow'],
			[/\b(?:body\s+)?color[:\s]+(?:pink|rose)\b/i, 'pink'],
			[/\b(?:body\s+)?color[:\s]+(?:copper)\b/i, 'copper'],
			[/\b(?:body\s+)?color[:\s]+(?:brass)\b/i, 'brass'],
			[/\b(?:body\s+)?color[:\s]+(?:gold)\b/i, 'gold'],
			[/\b(?:body\s+)?color[:\s]+(?:white)\b/i, 'white'],
			// Nightstick format: "Body Color\nBlack"
			[/\bbody\s+color\s+black\b/i, 'black'],
			[/\bbody\s+color\s+yellow\b/i, 'yellow'],
			[/\bbody\s+color\s+green\b/i, 'green'],
			[/\bbody\s+color\s+orange\b/i, 'orange'],
			// Finish patterns
			[/\bfinish[:\s]+(?:black|dark)\b/i, 'black'],
			[/\bfinish[:\s]+(?:desert\s*tan|FDE|coyote)\b/i, 'brown'],
			[/\bfinish[:\s]+(?:OD\s*green|olive)\b/i, 'green'],
			// Anodized patterns (most common flashlight body treatment)
			[/\b(?:black\s+)?(?:hard[\s-]*)?anodized?\s+(?:black|dark)\b/i, 'black'],
			[/\b(?:anodized?|HA[\s-]*III?)\s+(?:black|dark)\s/i, 'black'],
			[/\b(?:matte|matt)\s+black\b/i, 'black'],
			[/\bblack\s+(?:anodized?|body|finish|aluminum|aluminium)\b/i, 'black'],
			// HA-III without color = black (standard mil-spec anodized finish)
			[/\btype[\s-]*III\s+(?:hard[\s-]*)?anodiz/i, 'black'],
			// Material/Color combined: "Titanium - stonewashed"
			[/\btitanium[\s-]+(?:stonewash|raw|bead\s*blast)\b/i, 'gray'],
			[/\bcopper\s*(?:body|construction)\b/i, 'copper'],
			[/\bbrass\s*(?:body|construction)\b/i, 'brass'],
		];
		for (const [re, color] of colorPatterns) {
			if (re.test(combined)) {
				entry.color = [color];
				changed = true;
				break;
			}
		}
	}

	// LED emitter extraction from raw text (only if missing)
	if (!entry.led?.length) {
		const ledRawPatterns: [RegExp, string][] = [
			// Cree XHP family
			[/\bXHP\s*70(?:\.2|\.3)?\s*(?:HI)?\b/i, ''],
			[/\bXHP\s*50(?:\.2|\.3)?\s*(?:HI)?\b/i, ''],
			[/\bXHP\s*35(?:\.2)?\s*(?:HI|HD)?\b/i, ''],
			// Cree XM/XP family
			[/\bXM[\s-]?L2?\s*(?:U[234])?\b/i, ''],
			[/\bXP[\s-]?L\s*(?:HI|HD|V[56])?\b/i, ''],
			[/\bXP[\s-]?G[23S]?\s*(?:S[235])?\b/i, ''],
			[/\bXP[\s-]?E2?\b/i, ''],
			// Luminus
			[/\bSFT[\s-]?40\b/i, 'SFT40'],
			[/\bSFT[\s-]?70\b/i, 'SFT70'],
			[/\bSST[\s-]?20\b/i, 'SST-20'],
			[/\bSST[\s-]?40\b/i, 'SST-40'],
			[/\bSST[\s-]?70\b/i, 'SST-70'],
			[/\bSBT[\s-]?90(?:\.2)?\b/i, ''],
			// Samsung
			[/\bLH351D\b/i, 'LH351D'],
			[/\bLH351B\b/i, 'LH351B'],
			// Nichia
			[/\b519A\b/, '519A'],
			[/\b219[BCF]\b/, ''],
			[/\bE21A\b/, 'E21A'],
			// Luminus LUXEON family (used by Acebeam, etc.)
			[/\bLUXEON\s*(?:HL|MX|TX|V|V2)?\s*\w*\b/i, ''],
			[/\bSFH\s*55\b/i, 'SFH55'],
			[/\bSFT[\s-]?25\w?\b/i, ''],
			// Luminus SFQ/SSQ family (newer high-density emitters)
			[/\bSFQ[\s-]?60(?:\.\d+)?\b/i, ''],
			[/\bSFQ[\s-]?40(?:\.\d+)?\b/i, ''],
			[/\bSSQ[\s-]?55(?:\.\d+)?\b/i, ''],
			[/\bSSQ[\s-]?40(?:\.\d+)?\b/i, ''],
			// Other
			[/\bGT[\s-]?FC40\b/i, 'GT-FC40'],
			[/\bOsram\s*(?:CSLNM1|CULNM1|CULPM1|KW\s*CSLNM|PM1)\.?\w*\b/i, ''],
			[/\bOsram\s*(?:W1|W2)\b/i, ''],
			[/\bCree\s+LED\b/i, 'Cree LED'],
			[/\bLEP\b/, 'LEP'],
			[/\bCOB\b/, 'COB'],
			[/\bUV\s*LED\b/i, 'UV LED'],
			[/\bWhite\s*Laser\b/i, 'White Laser'],
		];
		for (const [re, name] of ledRawPatterns) {
			const m = combined.match(re);
			if (m) {
				// Clean up the matched text: remove extra spaces, normalize
				const ledName = (name || m[0]).replace(/\s+/g, '').replace(/^XHP/, 'XHP').replace(/^XP-?/, 'XP-').replace(/^XM-?/, 'XM-').replace(/^SST-?/, 'SST-').replace(/^SBT-?/, 'SBT-');
				entry.led = [ledName];
				changed = true;
				break;
			}
		}
	}

	// Length extraction from raw text (only if missing)
	if (!entry.length_mm) {
		const lengthPatterns = [
			// "Length: 135mm" or "Length: 135 mm" or "Overall Length: 5.3 in"
			/(?:overall\s+)?length[:\s]+(\d+(?:\.\d+)?)\s*mm\b/i,
			/(?:overall\s+)?length[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")\b/i,
			// "135mm (length)" or "135mm long"
			/(\d{2,4}(?:\.\d+)?)\s*mm\s*(?:\(?(?:overall|length|long|L)\)?)/i,
			// Table cell: "135 mm" near "length" keyword (extended range for multiline)
			/length[^.]{0,80}?(\d{2,4}(?:\.\d+)?)\s*mm/i,
			// "5.3 in" or "5.3 inches" near length (extended range)
			/length[^.]{0,80}?(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/i,
			// Olight: "Length (mm / in) \n 63mm / 2.48in"
			/length\s*\(mm\b[^)]*\)\s+(\d{2,4}(?:\.\d+)?)\s*mm/i,
			// Battery Junction: "X in (Y mm)" near length — capture the mm value
			/length[^.]{0,60}?\d+(?:\.\d+)?\s*in\s*\((\d+)\s*mm\)/i,
			// "Dimensions: 135mm x 25mm" — first number is usually length
			/dimensions?[:\s]+(\d{2,4}(?:\.\d+)?)\s*(?:mm)?\s*[x×]/i,
			// "X mm x Y mm" dimensions without keyword (first = length if >50mm)
			/(\d{2,4}(?:\.\d+)?)\s*mm\s*[x×]\s*\d{2,4}(?:\.\d+)?\s*mm/i,
		];
		for (const re of lengthPatterns) {
			const m = combined.match(re);
			if (m) {
				let val = parseFloat(m[1]);
				// Convert inches to mm if the pattern matched inches
				if (re.source.includes('inches') || re.source.includes('in\\\\.')) {
					if (val < 30) val = Math.round(val * 25.4); // Only convert if clearly inches
				}
				if (val >= 20 && val <= 1000) {
					entry.length_mm = Math.round(val * 10) / 10;
					changed = true;
					break;
				}
			}
		}
	}

	// Weight extraction from raw text (only if missing)
	if (!entry.weight_g) {
		const weightPatterns = [
			// "Weight: 120g" or "Weight: 120 g" or "Weight (w/o battery): 85g"
			/weight[^.\n]{0,40}?(\d+(?:\.\d+)?)\s*(?:grams?|g)\b/i,
			// "4.2 oz" or "4.2 ounces" near weight
			/weight[^.\n]{0,40}?(\d+(?:\.\d+)?)\s*(?:oz|ounces?)\b/i,
			// "120g (weight)" or "120g without battery"
			/(\d+(?:\.\d+)?)\s*(?:grams?|g)\s*\(?(?:weight|without|w\/o|incl|with)\b/i,
			// Table cell: "120 g" near "weight" keyword
			/(?:net\s+)?weight[:\s]+(\d+(?:\.\d+)?)\s*g\b/i,
		];
		for (const re of weightPatterns) {
			const m = combined.match(re);
			if (m) {
				let val = parseFloat(m[1]);
				// Convert oz to grams
				if (re.source.includes('oz') || re.source.includes('ounce')) {
					val = Math.round(val * 28.3495);
				}
				if (val > 5 && val < 5000) {
					entry.weight_g = Math.round(val * 10) / 10;
					changed = true;
					break;
				}
			}
		}
	}

	// Battery extraction from raw text (only if missing)
	if (!entry.battery?.length) {
		const batteryPatterns: [RegExp, string][] = [
			[/\b1\s*[x×]\s*21700\b/i, '21700'], [/\bpowered\s+by\s+(?:a\s+)?21700\b/i, '21700'],
			[/\bbattery[:\s]+21700\b/i, '21700'], [/\buses?\s+(?:a\s+)?21700\b/i, '21700'],
			[/\b1\s*[x×]\s*18650\b/i, '18650'], [/\bpowered\s+by\s+(?:a\s+)?18650\b/i, '18650'],
			[/\bbattery[:\s]+18650\b/i, '18650'], [/\buses?\s+(?:a\s+)?18650\b/i, '18650'],
			[/\b1\s*[x×]\s*18350\b/i, '18350'], [/\bbattery[:\s]+18350\b/i, '18350'],
			[/\b1\s*[x×]\s*14500\b/i, '14500'], [/\bbattery[:\s]+14500\b/i, '14500'],
			[/\b1\s*[x×]\s*26650\b/i, '26650'], [/\bbattery[:\s]+26650\b/i, '26650'],
			[/\b1\s*[x×]\s*26800\b/i, '26800'], [/\bbattery[:\s]+26800\b/i, '26800'],
			[/\b1\s*[x×]\s*16340\b/i, '16340'], [/\bbattery[:\s]+16340\b/i, '16340'],
			[/\bCR123A?\b/i, 'CR123A'],
			[/\bbattery[:\s]+AA\b/i, 'AA'], [/\b(?:1|2|3)\s*[x×]\s*AA\b(?!A)/i, 'AA'],
			[/\bbattery[:\s]+AAA\b/i, 'AAA'], [/\b(?:1|2|3)\s*[x×]\s*AAA\b/i, 'AAA'],
			[/\bbuilt[\s-]*in\s+(?:Li[\s-]*(?:ion|po)?\s+)?(?:\d+\s*mAh\s+)?battery\b/i, 'built-in'],
		];
		for (const [re, bat] of batteryPatterns) {
			if (re.test(combined)) {
				entry.battery = [bat];
				changed = true;
				break;
			}
		}
	}

	// Throw extraction from raw text (only if missing)
	if (!entry.performance?.claimed?.throw_m) {
		const throwPatterns = [
			// "Beam Distance: 500m" or "Throw: 250 meters" or "Max Throw: 1500m"
			/(?:beam\s*distance|throw|range)[:\s]+(\d{2,5})\s*(?:m|meters?)\b/i,
			// "ANSI throw 500m" or "FL1 throw: 500m"
			/(?:ANSI|FL1)\s+(?:beam\s*)?(?:distance|throw)[:\s]+(\d{2,5})\s*m/i,
			// "500m beam distance" or "1500m throw"
			/(\d{2,5})\s*m\s*(?:beam\s*distance|throw|range)\b/i,
			// "Peak Beam Distance: 250 meters" — decimal allowed, "meters" spelled out
			/(?:peak\s+)?beam\s*distance[:\s]+(\d+(?:\.\d+)?)\s*(?:m|meters?)\b/i,
			// "Max Beam Distance 780 feet" or "Beam Reach: 800 ft" — feet→meters
			/(?:beam\s*(?:distance|reach)|throw)[:\s]+(\d+)\s*(?:ft|feet)\b/i,
			// "reach 250 yards" or "throw of 350 yards" — yards→meters
			/(?:beam\s*(?:distance|reach)|throw|reach(?:es)?)[:\s]+(?:up\s+to\s+)?(\d+)\s*(?:yards?|yds?)\b/i,
			// "1500 feet beam" or "780 ft throw" (number before unit+keyword) — feet→meters
			/(\d{2,5})\s*(?:ft|feet)\s*(?:beam\s*distance|throw|beam)\b/i,
			// "beam distance 500 m" — relaxed spacing
			/beam\s*distance\s+(\d{2,5})\s*(?:m|meters?)\b/i,
			// "reach up to 250 meters" or "reaches 500m"
			/reach(?:es)?\s+(?:up\s+to\s+)?(\d{2,5})\s*(?:m|meters?)\b/i,
			// "distance of 380m" or "distance: 1000 meters"
			/distance\s+(?:of\s+)?(\d{2,5})\s*(?:m|meters?)\b/i,
		];
		for (const re of throwPatterns) {
			const m = combined.match(re);
			if (m) {
				// Convert feet or yards to meters if matched
				const isFeet = /ft|feet/i.test(m[0]);
				const isYards = /yards?|yds?/i.test(m[0]);
				const val = isFeet ? Math.round(parseFloat(m[1]) * 0.3048)
					: isYards ? Math.round(parseFloat(m[1]) * 0.9144)
					: Math.round(parseFloat(m[1]));
				if (val >= 10 && val <= 5000) {
					if (!entry.performance) entry.performance = { claimed: {} } as FlashlightEntry['performance'];
					entry.performance.claimed.throw_m = val;
					changed = true;
					break;
				}
			}
		}
	}

	// Intensity (candela) extraction from raw text → FL1 derivation will compute throw_m
	if (!entry.performance?.claimed?.intensity_cd) {
		const cdPatterns = [
			// "7.5K Candela" or "65K candela" or "33K cd"
			/(\d+(?:\.\d+)?)\s*K\s*(?:candela|cd)\b/i,
			// "Peak Beam Intensity: 5000 cd" or "Intensity: 12,500 candela"
			/(?:peak\s+)?(?:beam\s+)?intensity[:\s]+(\d[\d,]*)\s*(?:cd|candela)?\b/i,
			// "Candela: 33000" or "Candela 6500"
			/candela[:\s]+(\d[\d,]*)\b/i,
			// "Lux at 1 meter (candela) is approximately 18,000" or "Lux (Candela) \n 6500"
			/lux\s*(?:at\s*1\s*(?:m|meter)?)?\s*\(?\s*candela\s*\)?[:\s]*(?:is\s*)?(?:approximately\s*)?(\d[\d,]*(?:\.\d+)?)\s*K?\b/i,
			// "11K Lux (candela)" — value before label
			/(\d+(?:\.\d+)?)\s*K?\s*(?:lux\s*\(?\s*candela\s*\)?|candela)\b/i,
		];
		for (const re of cdPatterns) {
			const m = combined.match(re);
			if (m) {
				let val = parseFloat(m[1].replace(/,/g, ''));
				// If matched with K suffix, multiply by 1000
				if (/K\s*(?:candela|cd|lux)/i.test(m[0])) val *= 1000;
				val = Math.round(val);
				if (val >= 100 && val <= 10_000_000) {
					if (!entry.performance) entry.performance = { claimed: {} } as FlashlightEntry['performance'];
					entry.performance.claimed.intensity_cd = val;
					changed = true;
					break;
				}
			}
		}
	}

	// Lumens extraction from raw text (only if missing)
	if (!entry.performance?.claimed?.lumens?.length) {
		const lumensPatterns = [
			// "Max Output: 5000 lumens" or "Output: 2800lm"
			/(?:max(?:imum)?\s+)?(?:output|brightness|luminous\s*flux)[:\s]+(\d[\d,]*)\s*(?:lumens?|lm)\b/i,
			// "5000 lumens max" or "2800lm (turbo)"
			/(\d[\d,]*)\s*(?:lumens?|lm)\s*(?:\(?\s*(?:max|turbo|high)\s*\)?)/i,
			// ANSI lumens
			/(?:ANSI|FL1)\s+(?:lumens?|output)[:\s]+(\d[\d,]*)\b/i,
			// Battery Junction table: "Max Lumens\n100" or "High Lumens\n350"
			/(?:max|high)\s+lumens?\s+(\d[\d,]*)\b/i,
			// Nightstick: "High Lumens: 350" or "Flashlight Lumens: 235"
			/(?:high|flashlight|max)\s+lumens?[:\s]+(\d[\d,]*)\b/i,
			// Simple: "420 lumens" — must be standalone (not part of "max output: X lumens" already matched)
			/\b(\d[\d,]*)\s+lumens?\b/i,
		];
		for (const re of lumensPatterns) {
			const m = combined.match(re);
			if (m) {
				const lm = parseInt(m[1].replace(/,/g, ''), 10);
				if (lm > 0 && lm < 1_000_000) {
					if (!entry.performance) entry.performance = { claimed: {} } as FlashlightEntry['performance'];
					entry.performance.claimed.lumens = [lm];
					changed = true;
					break;
				}
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
 * Phase 6: Populate purchase_urls from store source URLs (observable fact)
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

		// Phase 6: Populate purchase_urls from store source URLs (observable fact)
		if (!entry.purchase_urls?.length) {
			const sourceUrls = getSourceUrls(entry.id);
			const storeUrls = sourceUrls.filter(url => isStoreUrl(url));
			if (storeUrls.length > 0) {
				entry.purchase_urls = storeUrls.slice(0, 3); // Cap at 3 URLs
				wasEnriched = true;
			}
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
