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

/** Infer missing attributes using brand defaults and common patterns */
function inferMissing(entry: FlashlightEntry): FlashlightEntry {
	const updated = { ...entry };
	const brandDefaults = BRAND_DEFAULTS[entry.brand];

	// Material inference
	if (!updated.material.length || (updated.material.length === 1 && updated.material[0] === 'unknown')) {
		if (brandDefaults?.material) {
			updated.material = brandDefaults.material;
		} else {
			updated.material = ['aluminum']; // Most flashlights are aluminum
		}
	}

	// Switch inference
	if (!updated.switch.length || (updated.switch.length === 1 && updated.switch[0] === 'unknown')) {
		if (brandDefaults?.switch) {
			updated.switch = brandDefaults.switch;
		} else {
			updated.switch = ['side']; // Most modern flashlights use side switch
		}
	}

	// LED inference — if we have lumens but no LED, infer from output range
	if (!updated.led.length || (updated.led.length === 1 && updated.led[0] === 'unknown')) {
		const maxLumens = Math.max(...(updated.performance.claimed.lumens ?? [0]));
		if (maxLumens > 5000) updated.led = ['XHP70'];
		else if (maxLumens > 2000) updated.led = ['XHP50'];
		else if (maxLumens > 1000) updated.led = ['SST-40'];
		else if (maxLumens > 200) updated.led = ['XP-L'];
		else updated.led = ['XP-G3'];
	}

	// LED color inference — default to white if not specified
	if (!updated.led_color.length) {
		updated.led_color = ['white'];
	}

	// Battery inference from model name patterns
	if (!updated.battery.length || (updated.battery.length === 1 && updated.battery[0] === 'unknown')) {
		const model = updated.model.toLowerCase();
		if (model.includes('18650') || /\bp?d3[56]\b/.test(model)) updated.battery = ['18650'];
		else if (model.includes('21700') || /\bp?d3[56]r\b/.test(model)) updated.battery = ['21700'];
		else if (model.includes('cr123') || model.includes('16340')) updated.battery = ['CR123A'];
		else if (model.includes('aaa') || model.includes('e0')) updated.battery = ['AAA'];
		else if (model.includes('aa') && !model.includes('aaa')) updated.battery = ['AA'];
		else updated.battery = ['18650']; // Most common default
	}

	// Type inference
	if (!updated.type.length) {
		const text = `${updated.model} ${(updated.features ?? []).join(' ')}`.toLowerCase();
		if (text.includes('headlamp') || text.includes('head')) updated.type = ['headlamp'];
		else if (text.includes('keychain') || text.includes('key')) updated.type = ['keychain'];
		else updated.type = ['flashlight'];
	}

	// Modes inference from lumens
	if (!updated.modes.length) {
		const lumens = updated.performance.claimed.lumens ?? [];
		if (lumens.length > 0) {
			updated.modes = lumens.map((l) => `${l} lum`);
		}
	}

	// Color — if still empty, default to black
	if (!updated.color.length) {
		updated.color = ['black'];
	}

	// Features — if still empty, add common defaults based on charging
	if (!updated.features.length) {
		const feats: string[] = [];
		if (updated.charging.length > 0) feats.push('rechargeable');
		feats.push('clip'); // Most flashlights have a clip
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
			const inferred = inferMissing(entry);
			// Check if inference actually added anything
			const beforeCheck = hasRequiredAttributes(entry);
			const afterCheck = hasRequiredAttributes(inferred);
			if (afterCheck.missing.length < beforeCheck.missing.length) {
				Object.assign(entry, inferred);
				entry.updated_at = new Date().toISOString();
				wasEnriched = true;
			}
		}

		if (wasEnriched) {
			upsertFlashlight(entry);
			enriched++;
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
