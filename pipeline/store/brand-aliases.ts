/**
 * Shared brand name normalization — single source of truth for all pipeline modules.
 * Maps vendor/retailer names to canonical brand names used in the database.
 *
 * Imported by: shopify-crawler, detail-scraper, ai-parser, review-scraper, etc.
 */

/** Primary brand normalization: lowercase key → canonical brand */
const BRAND_MAP: Record<string, string> = {
	'acebeam': 'Acebeam',
	'armytek': 'Armytek',
	'convoy': 'Convoy',
	'eagletac': 'EagleTac',
	'eagtac': 'EagleTac',
	'emisar': 'Emisar',
	'emisar noctigon': 'Emisar',
	'fenix': 'Fenix',
	'fenix store': 'Fenix',
	'fenix flashlights': 'Fenix',
	'fenix lighting': 'Fenix',
	'fireflies': 'Fireflies',
	'haikelite': 'Haikelite',
	'imalent': 'Imalent',
	'imalent store': 'Imalent',
	'jetbeam': 'JETBeam',
	'klarus': 'Klarus',
	'ledlenser': 'Ledlenser',
	'led lenser': 'Ledlenser',
	'lumintop': 'Lumintop',
	'maglite': 'Maglite',
	'mag instrument': 'Maglite',
	'mag-lite': 'Maglite',
	'mag lite': 'Maglite',
	'mag': 'Maglite',
	'manker': 'Manker',
	'mankerlight': 'Manker',
	'nitecore': 'Nitecore',
	'nightcore': 'Nitecore',
	'noctigon': 'Noctigon',
	'olight': 'Olight',
	'pelican': 'Pelican',
	'reylight': 'ReyLight',
	'rovyvon': 'Rovyvon',
	'skilhunt': 'Skilhunt',
	'sofirn': 'Sofirn',
	'streamlight': 'Streamlight',
	'surefire': 'SureFire',
	'thrunite': 'ThruNite',
	'weltool': 'Weltool',
	'wurkkos': 'Wurkkos',
	'wuben': 'Wuben',
	'zebralight': 'Zebralight',
	'coast': 'Coast',
	'coast cutlery': 'Coast',
	'coast cutlery co': 'Coast',
	'coast cutlery company': 'Coast',
	'coast lights': 'Coast',
	'coast products': 'Coast',
	'coastproducts': 'Coast',
	'coast slayer': 'Coast',
	'cost products': 'Coast',
	'nebo': 'Nebo',
	'astrolux': 'Astrolux',
	'cyansky': 'Cyansky',
	'folomov': 'Folomov',
	'nightwatch': 'NightWatch',
	'amutorch': 'Amutorch',
	'brinyte': 'Brinyte',
	'catapult': 'Catapult',
	'mateminco': 'Mateminco',
	'nitebeam': 'NiteBeam',
	'wowtac': 'WowTac',
	'thyrm': 'Thyrm',
	'prometheus': 'Prometheus',
	'prometheus lights': 'FourSevens',
	'big idea design': 'Big Idea Design',
	'laulima metal craft': 'Laulima',
	'frelux': 'Frelux',
	'copper revival': 'Copper Revival',
	'skylumen': 'Skylumen',
	'hanko': 'Hanko',
	'veleno designs': 'Veleno',
	'fraz labs': 'Fraz Labs',
	'sunwayman': 'Sunwayman',
	'xtar': 'XTAR',
	'petzl': 'Petzl',
	'black diamond': 'Black Diamond',
	'princeton tec': 'Princeton Tec',
	'energizer': 'Energizer',
	'dorcy': 'Dorcy',
	'nightstick': 'Nightstick',
	'bayco': 'Nightstick',
	'nighstick': 'Nightstick',
	'nightstick (nigiy)': 'Nightstick',
	'powertac': 'PowerTac',
	'malkoff': 'Malkoff',
	'malkoff devices': 'Malkoff',
	'foursevens': 'FourSevens',
	'four sevens': 'FourSevens',
	'4sevens': 'FourSevens',
	'darksucks': 'FourSevens',
	'modlite': 'Modlite',
	'cloud defensive': 'Cloud Defensive',
	'clouddefensive': 'Cloud Defensive',
	'nextorch': 'Nextorch',
	'rayovac': 'Rayovac',
	'fitorch': 'Fitorch',
	'terralux': 'TerraLUX',
	'garrity': 'Garrity',
	'garrity industries': 'Garrity',
	'duracell': 'Duracell',
	'kodak': 'Kodak',
	'loop gear': 'Loop Gear',
	'bluetech': 'Bluetech',
	'onerbl': 'Onerbl',
};

/** Fuzzy/typo normalization: lowercase key → canonical brand */
const TYPO_MAP: Record<string, string> = {
	'wrukkos': 'Wurkkos',
	'skihunt': 'Skilhunt',
	'firefiles': 'Fireflies',
	'firtorch': 'Fitorch',
	'fire-foxes': 'Fireflies',
	'firefoxes': 'Fireflies',
	'fireflylite': 'Fireflies',
	'sky lumen': 'Skylumen',
	'nlightd': 'NlightD',
	'tank007': 'Tank007',
	'mhvast': 'MHvast',
	'mobi garden': 'Mobi Garden',
	'ripsshine': 'Ripsshine',
	'superfire': 'Superfire',
	'maxtoch': 'Maxtoch',
	'towild': 'Towild',
	'wontorch': 'Wontorch',
	'sunrei': 'Sunrei',
	'rofis': 'Rofis',
	'speras': 'Speras',
	'wildtrail': 'WildTrail',
	'szfeic': 'Szfeic',
	'meote': 'Meote',
	'ravemen': 'Ravemen',
	'ferei': 'Ferei',
	'niwalker': 'Niwalker',
	'wolf eyes': 'Wolf Eyes',
	'gaciron': 'Gaciron',
	'vastlite': 'Vastlite',
	'trustfire': 'Trustfire',
	'archon': 'Archon',
	'manta ray': 'Manta Ray',
	'ruisha': 'Ruisha',
	'pioneman': 'Pioneman',
	'tgzuo': 'TGZUO',
	'wwlz': 'WWLZ',
	'lumzoo': 'Lumzoo',
};

/**
 * Domains that host multiple brands under the same manufacturer.
 * Used to identify source type and brand attribution.
 */
export const SHARED_DOMAINS: Record<string, string[]> = {
	'intl-outdoor.com': ['Emisar', 'Noctigon'],
};

/** Domain → source type classification for --source filter */
export const REVIEW_DOMAINS = new Set([
	'zeroair.org',
	'1lumen.com',
	'tgreviews.com',
	'budgetlightforum.com',
	'sammyshp.de',
	'zakreviews.com',
]);

export const RETAILER_DOMAINS = new Set([
	'batteryjunction.com',
	'goinggear.com',
	'nealsgadgets.com',
	'torchdirect.co.uk',
	'flashlightworld.ca',
	'flashlightgo.com',
	'killzoneflashlights.com',
	'jlhawaii808.com',
	'fenix-store.com',
]);

/**
 * Check if a brand name has an explicit mapping (not just title-case fallback).
 */
export function isMappedBrand(vendor: string): boolean {
	const lower = vendor.toLowerCase().trim();
	return lower in BRAND_MAP || lower in TYPO_MAP;
}

/**
 * Normalize a vendor/brand name to its canonical form.
 * Checks primary map first, then typo map, then title-cases as fallback.
 */
export function normalizeBrandName(vendor: string): string {
	const lower = vendor.toLowerCase().trim();
	if (BRAND_MAP[lower]) return BRAND_MAP[lower];
	if (TYPO_MAP[lower]) return TYPO_MAP[lower];
	// Title-case fallback
	return vendor.trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Classify a source URL into a source type category.
 * Used by AI parser --source filter.
 */
export function classifySourceUrl(url: string): 'reviews' | 'retailers' | 'manufacturers' {
	try {
		const hostname = new URL(url).hostname.replace(/^www\./, '');
		if (REVIEW_DOMAINS.has(hostname)) return 'reviews';
		if (RETAILER_DOMAINS.has(hostname)) return 'retailers';
		return 'manufacturers';
	} catch {
		return 'manufacturers';
	}
}
