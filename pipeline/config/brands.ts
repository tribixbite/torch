/**
 * Target brands for discovery — r/flashlight approved + notable manufacturers.
 * Each brand has optional aliases for fuzzy matching and Keepa search keywords.
 */
export interface BrandConfig {
	/** Canonical display name */
	name: string;
	/** Keepa title search keywords (defaults to "name flashlight") */
	searchTerms?: string[];
	/** Alternative spellings / aliases */
	aliases?: string[];
	/** Manufacturer site URL for future scraping */
	siteUrl?: string;
}

export const BRANDS: BrandConfig[] = [
	{ name: 'Acebeam', siteUrl: 'https://www.acebeam.com' },
	{ name: 'Armytek', siteUrl: 'https://www.armytek.com' },
	{ name: 'Convoy', siteUrl: 'https://www.convoy-store.com' },
	{ name: 'Emisar', aliases: ['Noctigon'], searchTerms: ['Emisar flashlight', 'Noctigon flashlight'] },
	{ name: 'Fenix', siteUrl: 'https://www.fenixlighting.com' },
	{ name: 'Lumintop', siteUrl: 'https://www.lumintop.com' },
	{ name: 'Nitecore', siteUrl: 'https://www.nitecore.com' },
	{ name: 'Olight', siteUrl: 'https://www.olightstore.com' },
	{ name: 'Skilhunt', siteUrl: 'https://www.skilhunt.com' },
	{ name: 'Sofirn', aliases: ['Wurkkos'], searchTerms: ['Sofirn flashlight', 'Wurkkos flashlight'], siteUrl: 'https://www.sofirnlight.com' },
	{ name: 'Streamlight', siteUrl: 'https://www.streamlight.com' },
	{ name: 'SureFire', aliases: ['Surefire'], siteUrl: 'https://www.surefire.com' },
	{ name: 'ThruNite', aliases: ['Thrunite'], siteUrl: 'https://www.thrunite.com' },
	{ name: 'Wurkkos', siteUrl: 'https://wurkkos.com' },
	{ name: 'Zebralight', siteUrl: 'https://www.zebralight.com' },
	// Additional notable brands for broader coverage
	{ name: 'Eagletac', aliases: ['EagleTac'] },
	{ name: 'Haikelite' },
	{ name: 'Klarus' },
	{ name: 'Imalent' },
	{ name: 'Manker' },
	{ name: 'Rovyvon', aliases: ['RovyVon'] },
	{ name: 'Wuben' },
	{ name: 'YLP' },
	{ name: 'Pelican' },
	{ name: 'Coast' },
	{ name: 'Maglite', aliases: ['Mag-Lite', 'MagLite'] },
	{ name: 'Ledlenser', aliases: ['Led Lenser'] },
	{ name: 'Nightcore' },
	{ name: 'Fireflies', searchTerms: ['Fireflies flashlight light'] },
	{ name: 'Catapult', searchTerms: ['Catapult flashlight'] },
];

/** Get all search terms for a brand */
export function getBrandSearchTerms(brand: BrandConfig): string[] {
	if (brand.searchTerms) return brand.searchTerms;
	const terms = [`${brand.name} flashlight`];
	if (brand.aliases) {
		for (const alias of brand.aliases) {
			terms.push(`${alias} flashlight`);
		}
	}
	return terms;
}
