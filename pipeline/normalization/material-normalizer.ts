/**
 * Canonical material normalizer — consolidates ~220 unique material strings into ~15 canonical values.
 *
 * Rules:
 * - Case-insensitive merge: aluminum/Aluminum/ALUMINUM → aluminum
 * - Synonym merge: Plastic/ABS/Polycarbonate/Nylon/polymer → polymer
 * - Alloy descriptors stripped: "Aircraft-grade 6061-T6 Aluminum" → aluminum
 * - Compound materials split where sensible
 * - Drop junk: "LED", "0", "NO", "Other", product descriptions
 *
 * Usage:
 *   import { normalizeMaterial, normalizeMaterialArray } from './material-normalizer.js';
 *   normalizeMaterial("Anodized Aluminum")  // → "aluminum"
 *   normalizeMaterial("Polycarbonate (PC)") // → "polymer"
 */

// --- Canonical map: lowercase key → canonical value (null = drop) ---

const CANONICAL_MAP: Record<string, string | null> = {
	// Aluminum variants
	'aluminum': 'aluminum',
	'aluminium': 'aluminum',
	'anodized aluminum': 'aluminum',
	'anodized aluminium': 'aluminum',
	'hard anodized aluminum': 'aluminum',
	'space aluminum': 'aluminum',
	'aluminum alloy': 'aluminum',
	'aluminium alloy': 'aluminum',
	'aviation aluminum alloy': 'aluminum',
	'aero grade aluminum alloy': 'aluminum',
	'aero grade aluminum': 'aluminum',
	'aerospace-grade aluminum alloy': 'aluminum',
	'aircraft grade aluminium': 'aluminum',
	'aircraft-grade aluminium': 'aluminum',
	'aircraft-grade 6061-t6 aluminum': 'aluminum',
	'aircraft-grade 6061-t6 aluminum w/type iii hard anodized finish': 'aluminum',
	'aircraft-grade 6061-t6 aluminum w/type ii hard anodized finish': 'aluminum',
	'aircraft-grade 6061-t6 aluminum housing with type iii hard anodized finish': 'aluminum',
	'aircraft-grade 6061-t6 aluminum housing': 'aluminum',
	'aluminum with type iii anodized': 'aluminum',
	'aluminum with type ii anodized': 'aluminum',
	'6061-t6 aluminum': 'aluminum',
	'6063 aluminum': 'aluminum',
	'type-iii hard-anodized 6061-t6 aluminum': 'aluminum',
	'all metal body (al6061-t6 high-quality aluminum alloy)': 'aluminum',
	'adc12 aluminum alloy': 'aluminum',
	'alu': 'aluminum',
	'alluminum': 'aluminum',
	'hard-anodized': 'aluminum',
	'aluminum casing': 'aluminum',
	'aluminum/stainless steel with micro-arc oxidation (mao) marbling': 'aluminum',
	'aluminium alloy,led': 'aluminum',
	'anodized aluminum': 'aluminum',

	// Stainless steel variants
	'stainless steel': 'stainless steel',
	'304 stainless steel with bead blasted finish': 'stainless steel',
	'30cr13 steel': 'stainless steel',
	'stainless steel copper': 'stainless steel',  // primary material
	'titanium coated stainless steel': 'stainless steel',
	'stamped steel': 'steel',
	'alloy steel': 'steel',
	'steel': 'steel',
	'magnetic steel': 'steel',

	// Titanium variants
	'titanium': 'titanium',
	'titanium alloy': 'titanium',
	'ti-stonewashed': 'titanium',
	'timascus': 'titanium',  // titanium-damascus composite

	// Copper
	'copper': 'copper',

	// Brass / Bronze
	'brass': 'brass',
	'bronze': 'brass',
	'delrin, brass': 'brass',

	// Polymer / plastic family — all thermoplastics
	'polymer': 'polymer',
	'plastic': 'polymer',
	'abs': 'polymer',
	'abs plastic': 'polymer',
	'abs polymers': 'polymer',
	'polymer,abs': 'polymer',
	'polycarbonate': 'polymer',
	'polycarbonate (pc)': 'polymer',
	'polycarbonate (pc) / abs': 'polymer',
	'pc/abs': 'polymer',
	'pc': 'polymer',
	'pc material': 'polymer',
	'nylon': 'polymer',
	'nylon polymer': 'polymer',
	'nylone': 'polymer',  // typo
	'glass-filled nylon polymer': 'polymer',
	'glass-filled nylon housing': 'polymer',
	'glass-filled nylon': 'polymer',
	'engineered polymer': 'polymer',
	'synthetic': 'polymer',
	'thermoplastic': 'polymer',
	'thermoplastic elastomers': 'polymer',
	'non slip polymer': 'polymer',
	'polymer plastic': 'polymer',
	'high-quality polymers + strong rubber': 'polymer',
	'high strength polymer + floating fiber housing': 'polymer',
	'durable, corrosion-resistant plastics': 'polymer',
	'metal or robust plastic': 'polymer',  // vague, default to polymer
	'plastic or metal': 'polymer',
	'metal or durable plastic': 'polymer',
	'durable pc': 'polymer',
	'pc2805 high-grade plastic (bayer material science ag)': 'polymer',
	'pc 2805 plastic': 'polymer',
	'pc2805 plastic': 'polymer',
	'high impact abs': 'polymer',
	'abs and lexan': 'polymer',
	'lexan': 'polymer',
	'plastic metal': 'polymer',
	'acrylonitrile butadiene styrene': 'polymer',
	'acrylonitrile butadiene styrene (abs)': 'polymer',
	'polyamide': 'polymer',
	'polypropylene': 'polymer',
	'polystyrene': 'polymer',
	'polyvinyl chloride': 'polymer',
	'pvc': 'polymer',
	'petg': 'polymer',
	'pe': 'polymer',
	'pa': 'polymer',
	'pu': 'polymer',
	'pa66+30%gf': 'polymer',
	'pa + gf': 'polymer',
	'resin': 'polymer',
	'acrylic': 'polymer',
	'xenoy': 'polymer',  // GE polymer blend
	'gfrn': 'polymer',   // glass-filled reinforced nylon
	'tough, fiberglass reinforced nylon': 'polymer',
	'sturdy nylon': 'polymer',
	'anti-static impact modified pc/pbt': 'polymer',
	'plastic with rubber grip': 'polymer',
	'exl': 'polymer',  // engineering polymer

	// Rubber / Silicone
	'rubber': 'rubber',
	'silicone': 'rubber',
	'silicone rubber': 'rubber',
	'silicone material': 'rubber',
	'rubberized housing': 'rubber',
	'nitrile rubber': 'rubber',
	'neoprene': 'rubber',
	'elastic': 'rubber',

	// Glass
	'glass': 'glass',
	'optical glass': 'glass',
	'corning gorilla glass': 'glass',
	'toughened ultra-clear glass lens with anti-reflective coating': 'glass',
	'glass and metal': 'glass',
	'photo luminescent polycarbonate (pc)': 'polymer',  // glow PC

	// Magnesium
	'magnesium': 'magnesium',
	'magnesium alloy': 'magnesium',

	// Carbon fiber
	'carbon fiber': 'carbon fiber',

	// Leather / Fabric
	'leather': 'leather',
	'faux leather': 'leather',
	'basketweave artifical leather snap closure': 'leather',
	'cotton': 'fabric',
	'cloth': 'fabric',
	'nylon + cotton': 'fabric',
	'100-percent-cotton-jersey': 'fabric',
	'cordura': 'fabric',
	'invista(r) 1000d cordura(r)': 'fabric',
	'600d nylon fabric': 'fabric',
	'oxford fabric': 'fabric',
	'oxford cloth': 'fabric',
	'mesh': 'fabric',
	'polyester': 'fabric',
	'tpu-bonded fabric': 'fabric',
	'kydex': 'polymer',  // thermoplastic (holster material)

	// Zirconium
	'zirconium': 'zirconium',

	// Damascus steel
	'damascus steel': 'damascus steel',

	// Micarta
	'micarta': 'micarta',

	// Tungsten
	'tungsten': 'tungsten',

	// Iron
	'iron': 'steel',

	// Lead
	'lead': 'lead',

	// Platinum / precious metals
	'platinum': 'platinum',

	// Zinc
	'zinc alloy': 'zinc alloy',
	'zinc plated': 'zinc alloy',

	// EVA foam
	'eva': 'rubber',
	'ethylene vinyl acetate (eva)': 'rubber',
	'ethylene vinyl acetate': 'rubber',
	'foam': 'rubber',

	// Composite / blend
	'blend': null,  // too vague
	'composite': null,
	'alloy': null,  // too vague
	'metal': null,  // too vague
	'full-metal body': null,
	'stainless steel; silicone': null,  // compound, skip

	// Junk / non-material values
	'other': null,
	'0': null,
	'no': null,
	'led': null,
	'black': null,
	'silver': null,
	'turboglow': null,
	'nichia high color rendering': null,  // LED, not material
	'nickel-metal hydride': null,  // battery chemistry
	'nickel-cadmium': null,
	'fenix headlamp': null,
	'usb magnetic charging cord': null,
	'moisture resistant material': null,
	'industrial grade construction': null,
	'antistatic': null,
	'paper': null,
	'vinyl': null,
	'6061 series alum bezel with mil-spec hard anodizing': 'aluminum',
	'drivers are fully potted and tested': null,

	// Nickel
	'nickel': 'nickel',
	'magnet/nickel': 'nickel',
	'magnet': null,
	'magnetic': null,

	// Multi-material (extract primary)
	'polyethylene, stainless steel': 'stainless steel',
	'rubber, iron, stainless steel, magnet': 'stainless steel',
};

/**
 * Normalize a single material string to its canonical form.
 * Returns null if the string should be dropped.
 */
export function normalizeMaterial(raw: string): string | null {
	const s = raw.trim();
	if (!s) return null;

	// Check canonical map (case-insensitive)
	const key = s.toLowerCase();
	if (key in CANONICAL_MAP) {
		return CANONICAL_MAP[key];
	}

	// Aluminum patterns (catch remaining alloy descriptions)
	if (/\baluminu?m\b/i.test(s)) return 'aluminum';

	// Stainless steel
	if (/\bstainless\s+steel\b/i.test(s)) return 'stainless steel';

	// Titanium
	if (/\btitanium\b/i.test(s)) return 'titanium';

	// Polycarbonate / ABS / Nylon / polymer
	if (/\b(?:polycarbonate|abs|nylon|polyamide|polymer|plastic)\b/i.test(s)) return 'polymer';

	// Silicone / rubber
	if (/\b(?:silicone|rubber|neoprene)\b/i.test(s)) return 'rubber';

	// Leather
	if (/\bleather\b/i.test(s)) return 'leather';

	// Glass
	if (/\bglass\b/i.test(s)) return 'glass';

	// Copper
	if (/\bcopper\b/i.test(s)) return 'copper';

	// Brass
	if (/\bbrass\b/i.test(s)) return 'brass';

	// Steel (generic)
	if (/\bsteel\b/i.test(s)) return 'steel';

	// Short junk / unknown
	if (s.length > 50) return null; // long descriptions are usually junk

	// Pass through as-is for unknown short values
	return s.toLowerCase();
}

/**
 * Normalize an array of material strings:
 * normalize each, filter nulls, deduplicate, sort.
 */
export function normalizeMaterialArray(arr: string[]): string[] {
	const result = new Set<string>();
	for (const raw of arr) {
		const canonical = normalizeMaterial(raw);
		if (canonical) result.add(canonical);
	}
	return [...result].sort();
}

// --- Test cases ---

export const MATERIAL_TEST_CASES: Array<[string, string | null]> = [
	// Aluminum variants
	['aluminum', 'aluminum'],
	['Aluminum', 'aluminum'],
	['Anodized Aluminum', 'aluminum'],
	['Aircraft-grade 6061-T6 Aluminum w/Type III Hard Anodized Finish', 'aluminum'],
	['6061-T6 Aluminum', 'aluminum'],
	['aluminium', 'aluminum'],
	['Alu', 'aluminum'],
	['Alluminum', 'aluminum'],
	['Hard anodized aluminum', 'aluminum'],
	['Space Aluminum', 'aluminum'],

	// Stainless steel
	['stainless steel', 'stainless steel'],
	['Stainless Steel', 'stainless steel'],
	['304 stainless steel with bead blasted finish', 'stainless steel'],

	// Titanium
	['titanium', 'titanium'],
	['Titanium', 'titanium'],
	['Titanium alloy', 'titanium'],
	['Ti-Stonewashed', 'titanium'],

	// Copper / Brass
	['copper', 'copper'],
	['Copper', 'copper'],
	['brass', 'brass'],
	['Brass', 'brass'],
	['bronze', 'brass'],

	// Polymer family
	['polymer', 'polymer'],
	['Polymer', 'polymer'],
	['Plastic', 'polymer'],
	['plastic', 'polymer'],
	['ABS', 'polymer'],
	['Abs', 'polymer'],
	['Nylon', 'polymer'],
	['nylon', 'polymer'],
	['Polycarbonate', 'polymer'],
	['Polycarbonate (PC)', 'polymer'],
	['Engineered Polymer', 'polymer'],
	['Synthetic', 'polymer'],
	['Glass-filled Nylon Polymer', 'polymer'],
	['Acrylonitrile Butadiene Styrene', 'polymer'],
	['GFRN', 'polymer'],
	['Xenoy', 'polymer'],
	['LEXAN', 'polymer'],
	['ABS and LEXAN', 'polymer'],
	['High Impact ABS', 'polymer'],

	// Rubber
	['Rubber', 'rubber'],
	['rubber', 'rubber'],
	['Silicone', 'rubber'],
	['silicone', 'rubber'],
	['Silicone Rubber', 'rubber'],
	['Neoprene', 'rubber'],

	// Glass
	['Glass', 'glass'],
	['glass', 'glass'],
	['Optical Glass', 'glass'],

	// Magnesium
	['magnesium', 'magnesium'],
	['magnesium alloy', 'magnesium'],

	// Carbon fiber
	['carbon fiber', 'carbon fiber'],
	['Carbon Fiber', 'carbon fiber'],

	// Leather / Fabric
	['Leather', 'leather'],
	['leather', 'leather'],
	['Faux Leather', 'leather'],
	['cotton', 'fabric'],
	['Cordura', 'fabric'],
	['Polyester', 'fabric'],
	['600D Nylon Fabric', 'fabric'],

	// Steel
	['steel', 'steel'],
	['Alloy Steel', 'steel'],
	['iron', 'steel'],

	// Special metals
	['zirconium', 'zirconium'],
	['damascus steel', 'damascus steel'],
	['tungsten', 'tungsten'],
	['zinc alloy', 'zinc alloy'],

	// Junk → null
	['Other', null],
	['other', null],
	['0', null],
	['NO', null],
	['LED', null],
	['Black', null],
	['Nickel-Metal Hydride', null],
	['Fenix Headlamp', null],
	['USB Magnetic Charging Cord', null],
	['Metal', null],
	['Blend', null],
];

/** Run built-in self-test */
export function runSelfTest(): { passed: number; failed: number; errors: string[] } {
	let passed = 0;
	const errors: string[] = [];
	for (const [input, expected] of MATERIAL_TEST_CASES) {
		const actual = normalizeMaterial(input);
		if (actual === expected) {
			passed++;
		} else {
			errors.push(`  FAIL: "${input}" → ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
		}
	}
	return { passed, failed: errors.length, errors };
}

// CLI self-test
if (import.meta.main) {
	console.log('=== Material Normalizer Self-Test ===\n');
	const { passed, failed, errors } = runSelfTest();
	for (const err of errors) console.log(err);
	console.log(`\n${passed} passed, ${failed} failed out of ${MATERIAL_TEST_CASES.length} test cases`);
	if (failed > 0) process.exit(1);
}
