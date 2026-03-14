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
import { getAllFlashlights, upsertFlashlight } from '../store/db.js';
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
		'rainbow': 'rainbow',
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

			return enriched;
		} catch {
			continue;
		}
	}

	return false;
}

/**
 * Run enrichment on all entries.
 * Phase 1: Manufacturer website scraping (real data)
 * Phase 2: ANSI FL1 derivation (throw ↔ intensity)
 * Phase 3: Color detection from model name (observable fact)
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
