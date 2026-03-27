/**
 * Canonical battery normalizer — consolidates ~647 unique battery strings into ~50-80 canonical values.
 *
 * Rules:
 * - Cell types: strip quantity-1 prefix (1x18650 → 18650), normalize IEC names (123A → CR123A)
 * - Chemistry: Li-ion/Li-Ion/lithium-ion → Li-ion, Li-polymer/Li-Pol → Li-poly
 * - Built-in: all integrated/built-in/capacity-only/Wh strings → built-in
 * - Multi-cell: 2x18650 → expands to BOTH 18650 AND 2x18650 (so filtering by 18650 catches 2x)
 * - Pack: wired pack / Li-ion Battery Pack → Li-ion pack
 * - Drop: USB, rechargeable, generic "1 battery" — not real battery types
 *
 * Usage:
 *   import { normalizeBattery, normalizeBatteryArray } from './battery-normalizer.js';
 *   normalizeBattery("1x18650")       // → "18650"
 *   normalizeBattery("Li-Ion")        // → "Li-ion"
 *   normalizeBattery("5000mAh")       // → "built-in"
 *   normalizeBattery("USB")           // → null (not a battery type)
 *   normalizeBatteryArray(["2x18650"]) // → ["18650", "2x18650"]
 */

// --- Exact canonical overrides (lowercase key → canonical value, null = drop) ---

const CANONICAL_MAP: Record<string, string | null> = {
	// CR123A aliases
	'123a': 'CR123A',
	'cr123': 'CR123A',
	'rcr123': 'CR123A',
	'rcr123a': 'CR123A',
	'123a lithium': 'CR123A',

	// IMR/brand-prefixed cells → bare cell type
	'imr16340': '16340',
	'sf18650b': '18650',
	'18650 li-ion': '18650',
	'18650 li-Ion': '18650',
	'1xaaa': 'AAA',
	'10880 li-ion': '10880',

	// D/C cell normalization
	'd cell': 'D',
	'd cells': 'D',
	'c cell': 'C',
	'c cells': 'C',

	// ZITHION (Olight/Coast proprietary) = built-in Li-ion
	'zithion': 'built-in',
	'zithion-x': 'built-in',
	'zx840 zithion': 'built-in',
	'coast zithion lithium-ion': 'built-in',

	// NiMH/NiCd Sub-C variants
	'nimh sub-c': 'Sub-C',
	'nicd sub-c': 'Sub-C',

	// NiMH casing variants
	'ni-mh': 'NiMH',

	// D-cell variants
	'd alkaline': 'D',
	'd-cell': 'D',
	'd cell alkaline': 'D',
	'4d': '4xD',

	// "6 AA Alkaline batteries" and similar wordy forms
	'6 aa alkaline batteries': '6xAA',

	// LR space variants
	'lr 41': 'LR41',
	'lr 44': 'LR44',
	'l736': 'LR41',
	'r44': 'LR44',
	'ag13/lr44': 'LR44',

	// SF-prefixed cells → bare cell
	'sf18350': '18350',

	// Coast/Olight proprietary ZITHION variants
	'zithion-x® z855': 'built-in',
	'zx1010': 'built-in',
	'zx104': 'built-in',
	'zx350': 'built-in',
	'zx440': 'built-in',
	'z955 rechargeable': 'built-in',

	// Nitecore proprietary packs
	'hlb1500': 'built-in',

	// Power banks — not flashlight batteries
	'nb10000 gen 3': null,
	'nb20000 gen 3 power bank': null,

	// Generic/junk
	'battery included': null,
	'external usb device': null,
	'usb power source': null,
	'usb type-c rechargeable': null,
	'mains powered': null,
	'removable battery': null,
	'proprietary': 'built-in',
	'custom': 'built-in',
	'lithium': 'Li-ion',
	'lithium power cell': 'Li-ion',

	// Lead acid
	'lead acid': 'lead-acid',
	'sealed lead-acid': 'lead-acid',

	// Pelican proprietary
	'sl-b50': 'built-in',

	// Li-ion chemistry aliases
	'li-ion': 'Li-ion',
	'li-Ion': 'Li-ion',
	'li-ion': 'Li-ion',
	'lithium-ion': 'Li-ion',
	'lithium ion': 'Li-ion',
	'lithium-ion': 'Li-ion',
	'li ion': 'Li-ion',

	// Li-poly chemistry aliases
	'li-polymer': 'Li-poly',
	'li-pol': 'Li-poly',
	'li-poly': 'Li-poly',
	'lithium polymer': 'Li-poly',
	'lithium-polymer': 'Li-poly',
	'li-polymer': 'Li-poly',
	'li-poly': 'Li-poly',
	'lipo': 'Li-poly',

	// Alkaline normalization
	'alkaline': 'alkaline',
	'alkaline batteries': 'alkaline',

	// Drop values (not battery types)
	'usb': null,
	'rechargeable': null,
	'1 battery': null,
	'1 lithium-ion battery': null,
	'usb-c rechargeable': null,
};

// --- Built-in detection patterns ---

/** Matches built-in / integrated variants */
const BUILT_IN_RE = /^(?:built[- ]?in|integrated|internal)\b/i;

/** Matches capacity-only strings: "5000mAh", "630mAh", "1000 mAh" etc. */
const CAPACITY_ONLY_RE = /^\d[\d,]*\s*m[Aa][Hh]\b/;

/** Matches Wh strings: "0.5Wh li-poly", "18Wh li-ion" */
const WH_RE = /^\d+\.?\d*\s*Wh\b/i;

/** Matches voltage+capacity strings: "3.7V 5000mAh", "3.6V 1000mAh lithium polymer" */
const VOLTAGE_CAPACITY_RE = /^\d+\.?\d*\s*V\b/i;

/** Matches "mAh" anywhere (capacity descriptors without a cell type) */
const HAS_MAH_RE = /\d+\s*m[Aa][Hh]/;

/** Matches strings that are clearly rechargeable descriptors, not types */
const RECHARGEABLE_DESC_RE = /^rechargeable\s+(?:li|lithium)/i;

/** Matches pack types: "Li-ion Battery Pack", "wired pack", etc. */
const PACK_RE = /\b(?:battery\s*pack|wired\s*pack)\b/i;

/** Matches LiFePO4 pack */
const LIFEPO4_PACK_RE = /^lifePo4\s+battery\s*pack$/i;

/** Known cell form factors (standard cylindrical + coin + traditional) */
const CELL_RE = /^(?:10150|10180|10220|10280|10400|10440|10880|10900|14100|14250|14300|14500|14580|16300|16340|16650|18350|18500|18650|20350|20700|21140|21700|22430|22650|26350|26650|26800|26980|32650|32700|33140|46950|CR123A|CR2032|CR2016|LR44|LR41|AA|AAA|C|D|Sub-C)$/;

/** Multi-cell prefix: "2x", "3x", "4x" etc. */
const MULTI_CELL_RE = /^(\d+)\s*[x×]\s*(.+)$/i;

/** Quantity-1 prefix: "1x18650" → "18650" */
const SINGLE_PREFIX_RE = /^1\s*[x×]\s*(.+)$/i;

// --- Chemistry detection (for pack/generic strings) ---

const CHEMISTRY_LIION_RE = /li[\s-]*ion|lithium[\s-]*ion/i;
const CHEMISTRY_LIPOLY_RE = /li[\s-]*poly|lithium[\s-]*poly|li[\s-]*po\b|lipo/i;
const CHEMISTRY_NIMH_RE = /\bnimh\b/i;
const CHEMISTRY_NICD_RE = /\bnicd\b/i;
const CHEMISTRY_LIFEPO4_RE = /\blifepo4\b/i;

/**
 * Normalize a single battery string to its canonical form.
 * Returns null if the string should be dropped (not a battery type).
 */
export function normalizeBattery(raw: string): string | null {
	let s = raw.trim();
	if (!s || s === 'unknown') return null;

	// 1. Check canonical map (case-insensitive)
	const mapKey = s.toLowerCase();
	if (mapKey in CANONICAL_MAP) {
		return CANONICAL_MAP[mapKey];
	}

	// 2. Built-in variants → "built-in"
	if (BUILT_IN_RE.test(s)) return 'built-in';

	// 3. Custom/proprietary battery packs with model numbers → "built-in"
	// Must check BEFORE pack detection (NBP68 contains "battery pack")
	if (/^(?:NBP|NL|ARB-L)\d/i.test(s)) return 'built-in';
	if (/^custom(?:ized?|ised?)\s/i.test(s)) return 'built-in';

	// 4. Tool batteries (18V, 21V etc.) → drop
	// Must check BEFORE voltage+capacity check
	if (/^(?:18|20|21|24|36|40|56|80)\s*V$/i.test(s)) return null;
	if (/^18[\s-](?:to|-)?\s*21\s*V/i.test(s)) return null;

	// 5. Lantern batteries → canonical
	// Must check BEFORE voltage+capacity check
	if (/6\s*V\s*(?:lantern|zinc|carbon)/i.test(s)) return '6V lantern';
	if (/12\s*V\s*(?:lantern|zinc|carbon|sla|sealed)/i.test(s)) return '12V lantern';

	// 6. Capacity-only strings (5000mAh, 630mAh) → "built-in"
	if (CAPACITY_ONLY_RE.test(s)) return 'built-in';

	// 7. Wh strings (0.5Wh li-poly, 18Wh li-ion) → "built-in"
	if (WH_RE.test(s)) return 'built-in';

	// 8. Voltage+capacity strings (3.7V 5000mAh, 3.7V Li-ion) → "built-in"
	if (VOLTAGE_CAPACITY_RE.test(s)) return 'built-in';

	// 9. Strings with mAh but no recognized cell type → "built-in"
	//    (e.g. "600mAh lithium polymer", "850mAh rechargeable battery")
	if (HAS_MAH_RE.test(s) && !CELL_RE.test(s.replace(MULTI_CELL_RE, '$2'))) {
		return 'built-in';
	}

	// 10. LiFePO4 pack
	if (LIFEPO4_PACK_RE.test(s)) return 'LiFePO4';

	// 11. Pack types (check BEFORE rechargeable descriptors — "Rechargeable Li-ion Battery Pack" is a pack)
	if (PACK_RE.test(s)) {
		if (CHEMISTRY_LIPOLY_RE.test(s)) return 'Li-poly';
		return 'Li-ion pack';
	}

	// 12. Rechargeable descriptors → "built-in" or chemistry
	if (/^rechargeable$/i.test(s)) return null;
	// "Rechargeable Li-ion" / "Li-ion Rechargeable" → Li-ion (chemistry, not built-in)
	if (/^(?:rechargeable\s+li-ion|li-ion\s+rechargeable)$/i.test(s)) return 'Li-ion';
	// "Rechargeable Lithium-ion" (standalone, no cell) → built-in
	if (/^rechargeable\s+lithium/i.test(s)) return 'built-in';

	// 13. Strip quantity-1 prefix: "1x18650" → "18650"
	const singleMatch = s.match(SINGLE_PREFIX_RE);
	if (singleMatch) {
		s = singleMatch[1].trim();
	}

	// 14. Multi-cell prefix: "2x18650" stays as-is (expansion handled in normalizeBatteryArray)
	// Also handles "3xD Alkaline" → normalize cell part ("D Alkaline" → "D") then rebuild
	const multiMatch = s.match(MULTI_CELL_RE);
	if (multiMatch) {
		const count = parseInt(multiMatch[1]);
		const cell = normalizeBattery(multiMatch[2]);
		if (!cell) return null;
		return `${count}x${cell}`;
	}

	// 14b. Strip trailing "Alkaline" from cell names: "3xD Alkaline" handled above via recursion
	s = s.replace(/\s+(?:Alkaline|alkaline|batteries?)\s*$/i, '').trim();

	// 15. CR123A aliases
	if (/^(?:123A|CR123)$/i.test(s)) return 'CR123A';

	// 16. Strip trailing chemistry: "18650 Li-ion" → "18650"
	s = s.replace(/\s+(?:li[\s-]*ion|lithium[\s-]*ion|li[\s-]*poly|lithium[\s-]*poly)$/i, '').trim();

	// 16b. Re-check canonical map after stripping (e.g. "custom li-poly" → "custom" → built-in)
	const strippedKey = s.toLowerCase();
	if (strippedKey in CANONICAL_MAP) {
		return CANONICAL_MAP[strippedKey];
	}

	// 17. Known cell form factor — return as-is (already normalized)
	if (CELL_RE.test(s)) return s;

	// 18. Standalone chemistry strings
	if (CHEMISTRY_LIFEPO4_RE.test(s) && s.length < 20) return 'LiFePO4';
	if (CHEMISTRY_LIPOLY_RE.test(s) && s.length < 30) return 'Li-poly';
	if (CHEMISTRY_LIION_RE.test(s) && s.length < 30) return 'Li-ion';
	if (CHEMISTRY_NIMH_RE.test(s) && s.length < 20) return 'NiMH';
	if (CHEMISTRY_NICD_RE.test(s) && s.length < 20) return 'NiCd';

	// 19. Sealed lithium polymer → Li-poly
	if (/sealed\s+lithium\s+polymer/i.test(s)) return 'Li-poly';

	// 20. "D" cell variations
	if (/^D$/i.test(s)) return 'D';

	// 21. Coin cells — normalize casing
	if (/^cr2032$/i.test(s)) return 'CR2032';
	if (/^cr2016$/i.test(s)) return 'CR2016';
	if (/^2016\b/i.test(s)) return 'CR2016';
	if (/^lr44$/i.test(s)) return 'LR44';
	if (/^lr41$/i.test(s)) return 'LR41';

	// 22. Proprietary cell codes (INR26-110, IXR33-150, BA2B, ZX* etc.) → built-in
	if (/^(?:INR|IXR|ZX)\d/i.test(s)) return 'built-in';

	// 23. Anything left that's very long is likely a description → "built-in"
	if (s.length > 30) return 'built-in';

	// 24. If nothing matched, return trimmed value (rare cell types, etc.)
	return s;
}

/**
 * Normalize an array of battery strings:
 * - Normalize each through normalizeBattery()
 * - Expand multi-cell entries (2x18650 → 18650 + 2x18650)
 * - Deduplicate and filter nulls
 */
export function normalizeBatteryArray(arr: string[]): string[] {
	const result = new Set<string>();

	for (const raw of arr) {
		const canonical = normalizeBattery(raw);
		if (!canonical) continue;

		// Multi-cell expansion: "2x18650" → add both "18650" and "2x18650"
		const multiMatch = canonical.match(/^(\d+)x(.+)$/);
		if (multiMatch && parseInt(multiMatch[1]) > 1) {
			result.add(multiMatch[2]); // base cell type (e.g. "18650")
			result.add(canonical);      // multi-cell form (e.g. "2x18650")
		} else {
			result.add(canonical);
		}
	}

	return [...result].sort();
}

// --- Test cases ---

export const BATTERY_TEST_CASES: Array<[string, string | null]> = [
	// Standard cells — pass through
	['18650', '18650'],
	['21700', '21700'],
	['14500', '14500'],
	['AA', 'AA'],
	['AAA', 'AAA'],
	['CR123A', 'CR123A'],
	['CR2032', 'CR2032'],
	['CR2016', 'CR2016'],
	['LR44', 'LR44'],
	['D', 'D'],
	['C', 'C'],
	['Sub-C', 'Sub-C'],

	// Quantity-1 prefix stripping
	['1x18650', '18650'],
	['1x18350', '18350'],
	['1xCR123A', 'CR123A'],
	['1x21700', '21700'],
	['1xAAA', 'AAA'],
	['1x10180', '10180'],
	['1x16340', '16340'],

	// Multi-cell stays as-is (expansion tested separately)
	['2x18650', '2x18650'],
	['3xAAA', '3xAAA'],
	['2xCR123A', '2xCR123A'],
	['2x16340', '2x16340'],
	['3x18650', '3x18650'],
	['4xAA', '4xAA'],
	['4xD', '4xD'],
	['2xD', '2xD'],

	// CR123A aliases
	['123A', 'CR123A'],
	['CR123', 'CR123A'],
	['RCR123', 'CR123A'],
	['123A lithium', 'CR123A'],

	// Chemistry prefix stripping
	['IMR16340', '16340'],
	['SF18650B', '18650'],
	['18650 Li-ion', '18650'],
	['10880 Li-ion', '10880'],

	// D/C cell variants
	['D cell', 'D'],
	['C cell', 'C'],

	// Chemistry canonicalization
	['Li-ion', 'Li-ion'],
	['Li-Ion', 'Li-ion'],
	['lithium-ion', 'Li-ion'],
	['Lithium-ion', 'Li-ion'],
	['li-ion', 'Li-ion'],
	['Lithium Ion', 'Li-ion'],
	['Li-polymer', 'Li-poly'],
	['Li-Pol', 'Li-poly'],
	['lithium polymer', 'Li-poly'],
	['Lithium Polymer', 'Li-poly'],
	['lithium-polymer', 'Li-poly'],
	['Li-Polymer', 'Li-poly'],
	['Lithium polymer rechargeable', 'Li-poly'],
	['NiMH', 'NiMH'],
	['NiCd', 'NiCd'],
	['LiFePO4', 'LiFePO4'],
	['alkaline', 'alkaline'],
	['Alkaline', 'alkaline'],
	['alkaline batteries', 'alkaline'],

	// Built-in variants
	['built-in', 'built-in'],
	['built-in Li-ion', 'built-in'],
	['Built-In Li-ion Battery Pack', 'built-in'],
	['Built-in Li-ion Battery Pack', 'built-in'],
	['Built-In Li-Ion Battery Pack', 'built-in'],
	['Integrated Li-ion', 'built-in'],
	['Integrated Rechargeable Lithium-ion', 'built-in'],
	['built-in rechargeable', 'built-in'],
	['built-in lithium-ion', 'built-in'],
	['Built-in 1050mAh Lithium Polymer Battery', 'built-in'],
	['Built-in 1050mAh Lithium Polymer', 'built-in'],
	['Built-in', 'built-in'],
	['Built-in Li-ion', 'built-in'],
	['Built in only', 'built-in'],
	['Internal Battery Pack', 'built-in'],
	['Built-in lithium polymer', 'built-in'],
	['Built-in lithium-ion battery', 'built-in'],
	['internal Li-ion 1000mAh', 'built-in'],
	['built-in 1700mAh', 'built-in'],
	['built-in 500mAh polymer lithium battery', 'built-in'],

	// ZITHION (Olight/Coast proprietary)
	['ZITHION', 'built-in'],
	['ZITHION-X', 'built-in'],
	['ZX840 ZITHION', 'built-in'],
	['COAST ZITHION lithium-ion', 'built-in'],

	// Capacity-only → built-in
	['5000mAh', 'built-in'],
	['630mAh', 'built-in'],
	['1650mAh', 'built-in'],
	['4000mAh', 'built-in'],
	['650mAh', 'built-in'],
	['300mAh', 'built-in'],
	['700mAh', 'built-in'],
	['6000mAh', 'built-in'],
	['1500mAh', 'built-in'],
	['100mAh', 'built-in'],

	// Wh strings → built-in
	['0.5Wh li-poly', 'built-in'],
	['1.9Wh li-poly', 'built-in'],
	['0.4Wh li-poly', 'built-in'],
	['18Wh li-ion', 'built-in'],
	['3.7Wh li-poly', 'built-in'],
	['13Wh li-ion', 'built-in'],

	// Voltage+capacity → built-in
	['3.7V 5000mAh', 'built-in'],
	['3.7V 230mAh Rechargeable Lithium Polymer Battery (built-in)', 'built-in'],
	['3.7V Li-ion', 'built-in'],
	['3.7V Li-ion Battery Pack', 'built-in'],
	['3.7V 13.69Wh Li-ion Battery Pack', 'built-in'],
	['7.4V li-ion', 'built-in'],

	// mAh strings with chemistry → built-in
	['130 mAh lithium-ion', 'built-in'],
	['600mAh lithium polymer', 'built-in'],
	['1500mAh Li-ion', 'built-in'],
	['330mAh lithium polymer', 'built-in'],
	['280mAh lithium polymer', 'built-in'],
	['300mAh lithium polymer', 'built-in'],
	['2000mAh Li-ion', 'built-in'],
	['850mAh rechargeable battery', 'built-in'],
	['700mAh rechargeable battery', 'built-in'],
	['1000mAh lithium', 'built-in'],
	['500mAh USB-C rechargeable', 'built-in'],
	['1000mAh USB-C rechargeable', 'built-in'],
	['600mAh built-in rechargeable battery', 'built-in'],
	['5500mAh rechargeable battery', 'built-in'],
	['1100mAh built-in', 'built-in'],
	['110mAh Built-in', 'built-in'],
	['330 mAh Li-Po', 'built-in'],
	['330 mAh internal rechargeable', 'built-in'],
	['260mAh Li-po rechargeable', 'built-in'],
	['330mAh Li-Po battery', 'built-in'],
	['330mAh Lipo', 'built-in'],
	['600mAh Li-Poly Battery', 'built-in'],
	['1900mAh 3.7V lithium', 'built-in'],
	['10000mAh battery pack', 'built-in'],
	['1200mAh li-ion', 'built-in'],
	['2000mAh Li-ion Battery Pack', 'built-in'],
	['130mAh 3.7V Li-ion Battery', 'built-in'],

	// Pack types
	['wired pack', 'Li-ion pack'],
	['Li-ion Battery Pack', 'Li-ion pack'],
	['Li-ion battery pack', 'Li-ion pack'],
	['Lithium-ion battery pack', 'Li-ion pack'],
	['lithium-ion battery pack', 'Li-ion pack'],
	['Rechargeable Li-ion Battery Pack', 'Li-ion pack'],
	['LiFePO4 battery pack', 'LiFePO4'],

	// Sealed lithium polymer
	['Sealed Lithium Polymer', 'Li-poly'],

	// Rechargeable descriptors
	['Rechargeable Lithium-ion', 'built-in'],
	['rechargeable lithium-ion', 'built-in'],
	['Li-ion Rechargeable', 'Li-ion'],
	['Rechargeable Li-ion', 'Li-ion'],
	['rechargeable', null],

	// Proprietary packs → built-in
	['Customized 550mAh IMR16340 Rechargeable Battery', 'built-in'],
	['Customised Li-Ion Battery', 'built-in'],
	['NBP68 HD battery pack', 'built-in'],
	['NL1840HP 4000mAh Battery', 'built-in'],

	// Drop values
	['USB', null],
	['1 battery', null],
	['1 lithium-ion battery', null],
	['USB-C rechargeable', null],

	// Coin cells from "2016" prefix
	['2016 3V Lithium', 'CR2016'],
	['2016 Lithium Coin Cell', 'CR2016'],

	// NiMH/NiCd Sub-C
	['NiMH Sub-C', 'Sub-C'],
	['NiCd Sub-C', 'Sub-C'],

	// Tool voltages → drop
	['18V', null],
	['21V', null],

	// Lantern batteries
	['12V Zinc Carbon Lantern Battery', '12V lantern'],
	['12V SLA', '12V lantern'],
];

/** Test normalizeBatteryArray multi-cell expansion */
export const ARRAY_TEST_CASES: Array<[string[], string[]]> = [
	// Multi-cell expansion
	[['2x18650'], ['18650', '2x18650']],
	[['3xAAA'], ['3xAAA', 'AAA']],
	[['2xCR123A'], ['2xCR123A', 'CR123A']],
	[['2x16340'], ['16340', '2x16340']],
	// Dedup across entries
	[['18650', '1x18650'], ['18650']],
	[['Li-Ion', 'Li-ion', 'lithium-ion'], ['Li-ion']],
	// Mixed
	[['2x18650', '18650'], ['18650', '2x18650']],
	// Drop + normalize
	[['USB', '18650', 'built-in Li-ion'], ['18650', 'built-in']],
];

/** Run built-in self-test. Returns { passed, failed, errors } */
export function runSelfTest(): { passed: number; failed: number; errors: string[] } {
	let passed = 0;
	const errors: string[] = [];

	// Single-value tests
	for (const [input, expected] of BATTERY_TEST_CASES) {
		const actual = normalizeBattery(input);
		if (actual === expected) {
			passed++;
		} else {
			errors.push(`  FAIL: normalizeBattery("${input}") → ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
		}
	}

	// Array tests
	for (const [input, expected] of ARRAY_TEST_CASES) {
		const actual = normalizeBatteryArray(input);
		const actualJson = JSON.stringify(actual);
		const expectedJson = JSON.stringify(expected);
		if (actualJson === expectedJson) {
			passed++;
		} else {
			errors.push(`  FAIL: normalizeBatteryArray(${JSON.stringify(input)}) → ${actualJson} (expected ${expectedJson})`);
		}
	}

	return { passed, failed: errors.length, errors };
}

// CLI self-test mode
if (import.meta.main) {
	console.log('=== Battery Normalizer Self-Test ===\n');
	const { passed, failed, errors } = runSelfTest();
	for (const err of errors) console.log(err);
	const total = BATTERY_TEST_CASES.length + ARRAY_TEST_CASES.length;
	console.log(`\n${passed} passed, ${failed} failed out of ${total} test cases`);
	if (failed > 0) process.exit(1);
}
