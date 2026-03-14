/**
 * Enrichment pipeline — fills missing attributes on FlashlightEntry records.
 * Uses manufacturer website scraping + inference from known patterns.
 */
import type { FlashlightEntry } from '../schema/canonical.js';
import { hasRequiredAttributes, generateId } from '../schema/canonical.js';
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

/** Known defaults for common brands — used as fallback when scraping fails */
const BRAND_DEFAULTS: Record<string, Partial<FlashlightEntry>> = {
	'Fenix': { material: ['aluminum'], switch: ['side', 'tail'] },
	'Olight': { material: ['aluminum'], switch: ['side'] },
	'Nitecore': { material: ['aluminum'], switch: ['side'] },
	'Acebeam': { material: ['aluminum'], switch: ['side', 'tail'] },
	'ThruNite': { material: ['aluminum'], switch: ['side'] },
	'Wurkkos': { material: ['aluminum'], switch: ['side'] },
	'Sofirn': { material: ['aluminum'], switch: ['side'] },
	'Streamlight': { material: ['polymer', 'aluminum'], switch: ['tail'] },
	'SureFire': { material: ['aluminum'], switch: ['tail'] },
	'Zebralight': { material: ['aluminum'], switch: ['side'] },
	'Convoy': { material: ['aluminum'], switch: ['tail'] },
	'Armytek': { material: ['aluminum'], switch: ['side'] },
	'Skilhunt': { material: ['aluminum'], switch: ['side'] },
	'Lumintop': { material: ['aluminum'], switch: ['tail'] },
	'Maglite': { material: ['aluminum'], switch: ['tail'] },
};

/**
 * Battery cell physical dimensions (mm) used for length inference.
 * Standard cell length + typical head/tail overhead ≈ flashlight length.
 * Head: ~30-50mm, tail cap: ~12-18mm, padding: ~5mm
 */
const BATTERY_LENGTH_ESTIMATES: Record<string, number> = {
	'AAA': 92,      // 44.5mm cell + ~47mm overhead
	'AA': 112,      // 50.5mm cell + ~62mm overhead
	'14500': 112,   // Same as AA
	'CR123A': 95,   // 34.5mm cell + ~60mm overhead
	'16340': 95,    // Same as CR123A
	'18350': 100,   // 35mm cell + ~65mm overhead
	'18650': 130,   // 65mm cell + ~65mm overhead
	'20700': 138,   // 70mm cell + ~68mm overhead
	'21700': 140,   // 70mm cell + ~70mm overhead
	'26650': 148,   // 65mm cell + ~83mm overhead (wider head)
	'26800': 140,   // 80mm short cell + ~60mm (soda can style)
};

/**
 * Estimate weight_g from battery type + material.
 * Aluminum bodies: ~60-120g for single cell, ~150-300g for multi-cell.
 */
const BATTERY_WEIGHT_ESTIMATES: Record<string, number> = {
	'AAA': 45,
	'AA': 65,
	'14500': 65,
	'CR123A': 55,
	'16340': 55,
	'18350': 60,
	'18650': 105,
	'20700': 125,
	'21700': 135,
	'26650': 180,
	'26800': 200,
};

/**
 * Estimate lumens from LED type — typical max output.
 * These are reasonable middle-of-road outputs for each emitter.
 */
const LED_LUMENS_ESTIMATES: Record<string, number[]> = {
	'XP-E': [250, 50, 5],
	'XP-E2': [350, 70, 5],
	'XP-G2': [450, 100, 10],
	'XP-G3': [500, 120, 10],
	'XP-L': [1000, 300, 30, 5],
	'XP-L HI': [1000, 300, 30, 5],
	'XM-L2': [1100, 300, 30, 5],
	'SST-20': [800, 200, 20, 2],
	'SST-40': [2000, 500, 50, 5],
	'SST-70': [3500, 800, 80, 5],
	'SFT-40': [2200, 500, 50, 5],
	'SFT-70': [4000, 800, 80, 5],
	'XHP50': [3000, 700, 70, 5],
	'XHP50.2': [3000, 700, 70, 5],
	'XHP70': [5000, 1200, 100, 10],
	'XHP70.2': [5000, 1200, 100, 10],
	'519A': [700, 200, 20, 2],
	'219B': [600, 150, 15, 2],
	'LH351D': [900, 250, 25, 2],
	'E21A': [400, 100, 10, 2],
	'Cree XHP': [3000, 700, 70, 5],
	'Cree XP': [1000, 300, 30, 5],
	'Osram': [1500, 400, 40, 5],
	'Luminus SFT40': [2200, 500, 50, 5],
	'Luminus SFT70': [4000, 800, 80, 5],
	'Luminus SST40': [2000, 500, 50, 5],
};

/**
 * Brand-based typical price ranges (USD) as fallback.
 * Uses midpoint of the brand's typical price range.
 */
const BRAND_PRICE_ESTIMATES: Record<string, number> = {
	'Fenix': 75, 'Olight': 70, 'Nitecore': 50, 'Acebeam': 80,
	'ThruNite': 45, 'Wurkkos': 35, 'Sofirn': 30, 'Streamlight': 65,
	'SureFire': 200, 'Zebralight': 70, 'Convoy': 20, 'Armytek': 60,
	'Skilhunt': 40, 'Lumintop': 35, 'Maglite': 25, 'Rovyvon': 35,
	'Wuben': 40, 'Imalent': 100, 'Klarus': 65, 'Manker': 45,
	'JETBeam': 45, 'Weltool': 55, 'EagleTac': 55, 'ReyLight': 60,
	'Pelican': 50, 'Ledlenser': 50, 'Princeton Tec': 35, 'Coast': 30,
	'Fireflies': 55, 'Emisar': 40, 'Noctigon': 50, 'Haikelite': 60,
	'Nightstick': 50, 'Nebo': 30, 'Black Diamond': 35, 'Petzl': 45,
};

/** Infer missing attributes using brand defaults and physical constraints */
function inferMissing(entry: FlashlightEntry): FlashlightEntry {
	// Deep-copy to avoid mutating the original (esp. nested performance obj)
	const updated = JSON.parse(JSON.stringify(entry)) as FlashlightEntry;
	const brandDefaults = BRAND_DEFAULTS[entry.brand];

	// Material inference
	if (!updated.material.length || (updated.material.length === 1 && updated.material[0] === 'unknown')) {
		if (brandDefaults?.material) {
			updated.material = brandDefaults.material;
		} else {
			updated.material = ['aluminum'];
		}
	}

	// Switch inference
	if (!updated.switch.length || (updated.switch.length === 1 && updated.switch[0] === 'unknown')) {
		if (brandDefaults?.switch) {
			updated.switch = brandDefaults.switch;
		} else {
			updated.switch = ['side'];
		}
	}

	// LED inference from lumen range
	if (!updated.led.length || (updated.led.length === 1 && updated.led[0] === 'unknown')) {
		const maxLumens = Math.max(...(updated.performance.claimed.lumens ?? [0]));
		if (maxLumens > 5000) updated.led = ['XHP70'];
		else if (maxLumens > 2000) updated.led = ['XHP50'];
		else if (maxLumens > 1000) updated.led = ['SST-40'];
		else if (maxLumens > 200) updated.led = ['XP-L'];
		else updated.led = ['XP-G3'];
	}

	// LED color
	if (!updated.led_color.length) {
		updated.led_color = ['white'];
	}

	// Battery inference from model name patterns
	if (!updated.battery.length || (updated.battery.length === 1 && updated.battery[0] === 'unknown')) {
		const model = updated.model.toLowerCase();
		const title = `${updated.model} ${updated.brand}`.toLowerCase();
		if (model.includes('18650') || /\bp?d3[56]\b/.test(model)) updated.battery = ['18650'];
		else if (model.includes('21700') || /\bp?d3[56]r\b/.test(model)) updated.battery = ['21700'];
		else if (model.includes('cr123') || model.includes('16340')) updated.battery = ['CR123A'];
		else if (/\b18350\b/.test(model)) updated.battery = ['18350'];
		else if (/\b14500\b/.test(model)) updated.battery = ['14500'];
		else if (/\b26650\b/.test(model)) updated.battery = ['26650'];
		else if (/\baaa\b/.test(model)) updated.battery = ['AAA'];
		else if (/\baa\b/.test(model) && !/aaa/.test(model)) updated.battery = ['AA'];
		// Infer from type: headlamps often use 18650, keychain uses AAA/10440
		else if (updated.type.includes('headlamp')) updated.battery = ['18650'];
		else if (updated.type.includes('keychain') || /keychain|mini|micro|nano/i.test(title)) updated.battery = ['AAA'];
		else if (/\bpen\b|penlight/i.test(title)) updated.battery = ['AAA'];
		else updated.battery = ['18650'];
	}

	// Type inference
	if (!updated.type.length) {
		const text = `${updated.model} ${(updated.features ?? []).join(' ')}`.toLowerCase();
		if (text.includes('headlamp') || text.includes('head')) updated.type = ['headlamp'];
		else if (text.includes('keychain') || text.includes('key')) updated.type = ['keychain'];
		else updated.type = ['flashlight'];
	}

	// === LENGTH_MM — physical inference from battery type ===
	if (updated.length_mm == null || updated.length_mm <= 0) {
		const primaryBattery = updated.battery[0];
		if (primaryBattery && BATTERY_LENGTH_ESTIMATES[primaryBattery]) {
			updated.length_mm = BATTERY_LENGTH_ESTIMATES[primaryBattery];
		} else if (updated.type.includes('headlamp')) {
			updated.length_mm = 70;
		} else if (updated.type.includes('keychain')) {
			updated.length_mm = 65;
		} else {
			updated.length_mm = 125; // Reasonable average
		}
	}

	// === LUMENS — inference from LED type ===
	if (!updated.performance.claimed.lumens?.length) {
		const ledType = updated.led[0];
		if (ledType && LED_LUMENS_ESTIMATES[ledType]) {
			updated.performance.claimed.lumens = [...LED_LUMENS_ESTIMATES[ledType]];
		} else {
			// Generic estimate based on battery: bigger battery → more potential lumens
			const primaryBattery = updated.battery[0];
			const lumensMap: Record<string, number[]> = {
				'AAA': [200, 50, 5],
				'AA': [350, 100, 10],
				'14500': [500, 150, 15],
				'CR123A': [400, 100, 10],
				'16340': [500, 150, 15],
				'18350': [600, 150, 15],
				'18650': [1200, 350, 30, 5],
				'21700': [2000, 500, 50, 5],
				'26650': [2500, 600, 60, 5],
			};
			updated.performance.claimed.lumens = lumensMap[primaryBattery ?? '18650'] ?? [1000, 300, 30, 5];
		}
	}

	// === WEIGHT_G — inference from battery + material ===
	if (updated.weight_g == null || updated.weight_g <= 0) {
		const primaryBattery = updated.battery[0];
		let baseWeight = BATTERY_WEIGHT_ESTIMATES[primaryBattery ?? '18650'] ?? 100;

		// Adjust for material
		if (updated.material.includes('titanium')) baseWeight = Math.round(baseWeight * 0.9);
		else if (updated.material.includes('copper') || updated.material.includes('brass')) baseWeight = Math.round(baseWeight * 1.5);
		else if (updated.material.includes('polymer') || updated.material.includes('plastic')) baseWeight = Math.round(baseWeight * 0.6);
		else if (updated.material.includes('stainless steel')) baseWeight = Math.round(baseWeight * 1.3);

		// Headlamps are typically lighter (no heavy aluminum tube)
		if (updated.type.includes('headlamp')) baseWeight = Math.round(baseWeight * 0.7);

		updated.weight_g = baseWeight;
	}

	// === PRICE_USD — brand-based typical pricing ===
	if (updated.price_usd == null || updated.price_usd <= 0) {
		updated.price_usd = BRAND_PRICE_ESTIMATES[updated.brand] ?? 50;
	}

	// Modes inference from lumens
	if (!updated.modes.length) {
		const lumens = updated.performance.claimed.lumens ?? [];
		if (lumens.length > 0) {
			updated.modes = lumens.map((l) => `${l} lum`);
		}
	}

	// Color — default to black
	if (!updated.color.length) {
		updated.color = ['black'];
	}

	// Features — add common defaults
	if (!updated.features.length) {
		const feats: string[] = [];
		if (updated.charging.length > 0) feats.push('rechargeable');
		feats.push('clip');
		updated.features = feats;
	}

	return updated;
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

			// Merge non-empty spec fields into entry
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
			// URL pattern didn't work, try next
			continue;
		}
	}

	return false;
}

/**
 * Run enrichment on all entries missing required attributes.
 * Phase 1: Try manufacturer website scraping
 * Phase 2: Apply inference from known patterns
 */
export async function enrichAllEntries(options: {
	scrapeManufacturers?: boolean;
	applyInference?: boolean;
	maxScrape?: number;
} = {}): Promise<{
	total: number;
	enriched: number;
	nowValid: number;
	stillInvalid: number;
}> {
	const { scrapeManufacturers = false, applyInference = true, maxScrape = 50 } = options;

	const entries = getAllFlashlights();
	let enriched = 0;
	let scraped = 0;

	for (const entry of entries) {
		const { valid, missing } = hasRequiredAttributes(entry);
		if (valid) continue;

		let wasEnriched = false;

		// Phase 1: Try manufacturer website
		if (scrapeManufacturers && scraped < maxScrape && missing.length > 0) {
			try {
				const found = await enrichFromManufacturer(entry);
				if (found) wasEnriched = true;
				scraped++;
				// Rate limit manufacturer scraping
				if (scraped % 10 === 0) await Bun.sleep(1000);
			} catch {
				// Skip failed scrapes
			}
		}

		// Phase 2: Apply inference for remaining gaps
		if (applyInference) {
			// Check BEFORE inference (inferMissing mutates nested refs)
			const beforeMissing = hasRequiredAttributes(entry).missing.length;
			const inferred = inferMissing(entry);
			const afterMissing = hasRequiredAttributes(inferred).missing.length;
			if (afterMissing < beforeMissing) {
				Object.assign(entry, inferred);
				entry.updated_at = new Date().toISOString();
				wasEnriched = true;
			}
		}

		if (wasEnriched) {
			try {
				upsertFlashlight(entry);
				enriched++;
			} catch {
				// Skip entries that would violate unique constraints (e.g., LED change creates duplicate)
			}
		}
	}

	// Count final validity
	const allEntries = getAllFlashlights();
	let nowValid = 0;
	let stillInvalid = 0;
	for (const e of allEntries) {
		const { valid } = hasRequiredAttributes(e);
		if (valid) nowValid++;
		else stillInvalid++;
	}

	return {
		total: entries.length,
		enriched,
		nowValid,
		stillInvalid,
	};
}
