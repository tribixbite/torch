/**
 * Canonical features normalizer — consolidates ~259 unique feature strings into ~60 canonical values.
 *
 * Rules:
 * - Case-insensitive dedup: USB-C charging / usb-c charging → USB-C charging
 * - Synonym merge: clip / pocket clip → clip, IPX8 / IP68 / waterproof → IPX8
 * - IP rating normalization: keep highest rating per entry
 * - Drop: vague descriptors, marketing copy, material properties
 *
 * Usage:
 *   import { normalizeFeature, normalizeFeatureArray } from './features-normalizer.js';
 *   normalizeFeature("pocket clip") // → "clip"
 *   normalizeFeature("IPX-8")       // → "IPX8"
 */

// --- Canonical map: lowercase key → canonical value (null = drop) ---

const CANONICAL_MAP: Record<string, string | null> = {
	// Core features — pass through with consistent casing
	'rechargeable': 'rechargeable',
	'clip': 'clip',
	'pocket clip': 'clip',
	'lanyard': 'lanyard',
	'lanyard hole': 'lanyard',
	'~lanyard hole': 'lanyard',
	'magnet': 'magnet',
	'magnetic tailcap': 'magnet',
	'battery included': 'battery included',
	'mode memory': 'mode memory',
	'power bank': 'power bank',
	'powerbank': 'power bank',
	'lockout': 'lockout',
	'strobe': 'strobe',
	'holster': 'holster',
	'battery indicator': 'battery indicator',
	'battery check': 'battery indicator',
	'power indicator': 'battery indicator',
	'low battery warning': 'battery indicator',
	'low voltage warn': 'battery indicator',
	'sos': 'SOS',
	'anti-roll': 'anti-roll',
	'regulation': 'regulation',
	'thermal regulation': 'regulation',
	'thermal stepdown': 'thermal stepdown',
	'temperature control': 'thermal stepdown',
	'temperature regulation': 'thermal stepdown',
	'temperature control protection': 'thermal stepdown',
	'tailstand': 'tailstand',
	'tail standing': 'tailstand',
	'tail stand': 'tailstand',
	'turbo': 'turbo',
	'instant turbo': 'turbo',
	'strike bezel': 'strike bezel',
	'moonlight': 'moonlight',
	'sub-lumen': 'moonlight',
	'candlelight': 'moonlight',
	'ramping': 'ramping',
	'variable output': 'ramping',
	'~variable output': 'ramping',
	'beacon': 'beacon',
	'glow-in-the-dark': 'GITD',
	'gitd': 'GITD',
	'downcast led': 'downcast LED',
	'red led': 'downcast LED',
	'night light ring': 'downcast LED',
	'night light stripe': 'downcast LED',
	'dual springs': 'dual springs',
	'focusable': 'focusable',
	'zoomable': 'focusable',
	'adjustable focus': 'focusable',
	'adjustable beam': 'focusable',
	'focus': 'focusable',
	'focusing': 'focusable',
	'advanced focus system': 'focusable',
	'configurable': 'configurable',
	'aux led': 'aux LED',
	'aux color': 'aux LED',
	'bluetooth': 'Bluetooth',
	'anduril': 'Anduril',
	'lep': 'LEP',
	'pivoting head': 'pivoting head',
	'adjustable head': 'pivoting head',
	'adjustable tilt': 'pivoting head',
	'momentary': 'momentary',
	'dual': 'dual fuel',
	'dual fuel': 'dual fuel',
	'tactical': 'tactical',
	'hidden port': 'hidden port',
	'reverse polarity protection': 'reverse polarity protection',

	// Charging type normalization
	'usb-c charging': 'USB-C charging',
	'usb-c': 'USB-C charging',
	'micro-usb charging': 'micro-USB charging',
	'micro-usb': 'micro-USB charging',
	'magnetic charging': 'magnetic charging',
	'charging': 'rechargeable',  // generic "charging" = rechargeable

	// IP ratings — normalize to standard format
	'ipx8': 'IPX8',
	'ip68': 'IPX8',   // IP68 = IPX8 + dust protection (effectively same for flashlights)
	'waterproof': 'waterproof',
	'ipx7': 'IPX7',
	'ip-x7 waterproof': 'IPX7',
	'ipx4': 'IPX4',
	'ipx-4': 'IPX4',
	'ip67': 'IPX7',   // IP67 ≈ IPX7
	'ipx5': 'IPX5',
	'ipx6': 'IPX6',
	'ipx-8': 'IPX8',
	'ipx-7': 'IPX7',
	'ip54': 'IP54',
	'ip55': 'IP55',
	'ip56': 'IP56',
	'ip65': 'IP65',
	'ip66': 'IPX6',
	'storm proof': 'waterproof',
	'water resistant': 'waterproof',
	'dust resistant': null,  // not really a feature for flashlights

	// Carabiner / attachment
	'carabiner hook': 'carabiner',
	'quick release': 'quick release',
	'adjustable headband': null,  // headlamp accessory, not feature

	// Drop proof / impact
	'drop proof': null,   // covered by impact rating
	'crush proof': null,
	'shockproof': null,

	// Various
	'collapsible': 'collapsible',
	'lantern': 'lantern mode',
	'color filters': 'color filters',
	'ar-coated lens': null,  // lens coating, not feature
	'high cri': 'high CRI',

	// UV / colored LEDs
	'uv': 'UV',
	'uv light': 'UV',
	'red light': 'red light',
	'green light': 'green light',
	'blue light': 'blue light',

	// Timer / candle / programmable
	'timer': 'timer',
	'candle mode': 'candle mode',
	'programmable': 'programmable',
	'flashable': 'flashable',

	// Mounting
	'tripod mount': 'tripod mount',
	'hook': 'hook',
	'keychain': 'keychain',
	'carabiner': 'carabiner',

	// Laser
	'laser': 'laser',

	// Impact
	'impact resistant': null,  // covered by impact rating column

	// Lifetime guarantee
	'lifetime guarantee': null,  // warranty, not feature
	'made in the usa': null,

	// Sensor
	'proximity sensor': 'proximity sensor',
	'motion sensor': 'sensor',

	// Dimmable / multi-mode
	'dimmable': 'ramping',
	'multi-mode': null,  // all multi-mode lights already show modes

	// Flood/throw
	'flood and throw': 'flood and throw',
	'dual beam': 'flood and throw',

	// Integrated charger
	'integrated charger': 'rechargeable',

	// Tail/side (switch types, not features)
	'tailcap': null,
	'side switch': null,
	'side': null,
	'rotary': null,

	// Chemical resistant
	'chemical resistant': 'chemical resistant',

	// Removable globe
	'removable globe': null,  // Pelican specific, niche

	// Tritium
	'tritium': 'tritium',

	// Low voltage
	'low voltage warning': 'battery indicator',

	// Junk / marketing
	'tail': null,         // switch position, not feature
	'tail switch': null,
	'twist': null,        // switch type
	'twist switch': null,
	'dual switches': null, // switch description
	'remote': null,       // switch type
};

/**
 * Normalize a single feature string to its canonical form.
 * Returns null if the string should be dropped.
 */
export function normalizeFeature(raw: string): string | null {
	const s = raw.trim();
	if (!s || s === 'unknown') return null;

	// Check canonical map (case-insensitive)
	const key = s.toLowerCase();
	if (key in CANONICAL_MAP) {
		return CANONICAL_MAP[key];
	}

	// Long marketing descriptions → drop
	if (s.length > 50) return null;

	// Pass through unrecognized short values as-is (lowercase)
	return s.toLowerCase();
}

/**
 * Normalize an array of feature strings:
 * normalize each, filter nulls, deduplicate, sort.
 */
export function normalizeFeatureArray(arr: string[]): string[] {
	const result = new Set<string>();
	for (const raw of arr) {
		const canonical = normalizeFeature(raw);
		if (canonical) result.add(canonical);
	}
	return [...result].sort();
}

// --- Test cases ---

export const FEATURE_TEST_CASES: Array<[string, string | null]> = [
	// Core features
	['rechargeable', 'rechargeable'],
	['clip', 'clip'],
	['pocket clip', 'clip'],
	['lanyard', 'lanyard'],
	['lanyard hole', 'lanyard'],
	['magnet', 'magnet'],
	['magnetic tailcap', 'magnet'],
	['mode memory', 'mode memory'],
	['lockout', 'lockout'],
	['strobe', 'strobe'],
	['SOS', 'SOS'],
	['holster', 'holster'],

	// Battery indicator merge
	['battery indicator', 'battery indicator'],
	['battery check', 'battery indicator'],
	['power indicator', 'battery indicator'],
	['low battery warning', 'battery indicator'],

	// Charging
	['USB-C charging', 'USB-C charging'],
	['usb-c charging', 'USB-C charging'],
	['micro-usb charging', 'micro-USB charging'],
	['magnetic charging', 'magnetic charging'],
	['charging', 'rechargeable'],

	// IP ratings
	['IPX8', 'IPX8'],
	['IP68', 'IPX8'],
	['waterproof', 'waterproof'],
	['IPX7', 'IPX7'],
	['IP67', 'IPX7'],
	['IP-X7 Waterproof', 'IPX7'],
	['IPX4', 'IPX4'],
	['IPX-4', 'IPX4'],

	// Moonlight / sub-lumen
	['moonlight', 'moonlight'],
	['sub-lumen', 'moonlight'],
	['candlelight', 'moonlight'],

	// Thermal
	['thermal stepdown', 'thermal stepdown'],
	['temperature control', 'thermal stepdown'],
	['thermal regulation', 'regulation'],

	// Focusable
	['focusable', 'focusable'],
	['adjustable focus', 'focusable'],
	['adjustable beam', 'focusable'],
	['focus', 'focusable'],

	// GITD
	['glow-in-the-dark', 'GITD'],
	['GITD', 'GITD'],

	// Aux LED
	['aux LED', 'aux LED'],
	['aux color', 'aux LED'],

	// Tailstand
	['tailstand', 'tailstand'],
	['tail standing', 'tailstand'],

	// Turbo
	['turbo', 'turbo'],
	['instant turbo', 'turbo'],

	// Pivoting head
	['pivoting head', 'pivoting head'],
	['adjustable head', 'pivoting head'],
	['adjustable tilt', 'pivoting head'],

	// Branded
	['Anduril', 'Anduril'],
	['Bluetooth', 'Bluetooth'],
	['LEP', 'LEP'],

	// Anti-roll
	['anti-roll', 'anti-roll'],

	// Ramping
	['ramping', 'ramping'],
	['variable output', 'ramping'],

	// Junk → null
	['tail', null],
	['twist', null],
	['dust resistant', null],
	['drop proof', null],
];

/** Run built-in self-test */
export function runSelfTest(): { passed: number; failed: number; errors: string[] } {
	let passed = 0;
	const errors: string[] = [];
	for (const [input, expected] of FEATURE_TEST_CASES) {
		const actual = normalizeFeature(input);
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
	console.log('=== Features Normalizer Self-Test ===\n');
	const { passed, failed, errors } = runSelfTest();
	for (const err of errors) console.log(err);
	console.log(`\n${passed} passed, ${failed} failed out of ${FEATURE_TEST_CASES.length} test cases`);
	if (failed > 0) process.exit(1);
}
