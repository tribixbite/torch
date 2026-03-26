/**
 * Canonical LED normalizer — consolidates 904 unique LED strings into ~100-150 canonical emitter names.
 *
 * Rules:
 * - SAFE to merge: case variants, prefix variants (Cree/CREE/bare), hyphens (SST40→SST-40),
 *   spaces (XP-LHI→XP-L HI), brightness bins (T6/U2/V6), color temps (6500K), CRI bins (R9080)
 * - NEVER merge: generations (.2/.3), HD vs HI, die sizes (SST-20 vs SST-40),
 *   different families (519A vs 319A), -W variants (SFT-40-W)
 *
 * Usage:
 *   import { normalizeLed, normalizeLedArray } from './led-normalizer.js';
 *   normalizeLed("NICHIA 519A")     // → "Nichia 519A"
 *   normalizeLed("SST40")           // → "Luminus SST-40"
 *   normalizeLed("LED")             // → null (generic)
 *   normalizeLedArray(["519A", "519a", "Nichia 519A"]) // → ["Nichia 519A"]
 */

// --- Generic LED patterns: strings that provide no useful emitter information ---

/** Bare manufacturer names (no specific emitter) */
const BARE_MANUFACTURERS = new Set([
	'cree', 'nichia', 'osram', 'luminus', 'samsung', 'luxeon', 'seoul',
]);

/** Bare color/type words that aren't real LED identifiers */
const BARE_COLORS = new Set([
	'red', 'green', 'blue', 'white', 'yellow', 'amber',
	'unknown', 'infrared', 'ultraviolet',
]);

/** Pattern for generic descriptive LED strings like "High Performance Cool White LED" */
const GENERIC_DESC_RE = /^(?:high|bright|xtreme|ultra|super|advanced|premium|extreme)[\s-].*(?:led|emitter)s?$/i;

/** Pattern for temperature-only descriptions: "6500K Cool White" etc. */
const TEMP_ONLY_RE = /^\d{4,5}K\b.*$/i;

/** Pattern for generic "Warm/Cool/Neutral White LED" */
const COLOR_TEMP_LED_RE = /^(?:cool|neutral|warm|day)\s*(?:white|light)\s*(?:led|leds|emitter)?s?$/i;

/** Pattern for bare "LED", "LEDs", "LED Chip", "LED Light Chip", "White LED" etc. */
const BARE_LED_RE = /^(?:led|leds|led\s*(?:chip|light|light\s*chip|emitter|module)|(?:white|red|green|blue)\s+leds?)s?$/i;

/** Pattern for "Spot LED", "Flood LED", etc. */
const MODIFIER_LED_RE = /^(?:spot|flood|high\s*density|high\s*end|high\s*power|high\s*intensity|high\s*performance|high\s*cri|high[\s-](?:powered|efficiency|quality))\s+.*(?:led|emitter|x-led)s?$/i;

/** Pattern for wattage/count-only descriptors: "3 W LED", "1 Watt LED bulb", "24 super bright LED", "7 LEDs" */
const WATTAGE_LED_RE = /^\d+(?:\.\d+)?\s*(?:W|Watt|watt)\s+.*(?:led|bulb|emitter)s?$/i;
const COUNT_LED_RE = /^\d+\s+(?:ultra\s*bright|super\s*bright|small|high[\s-]?performance|high[\s-]?powered|high[\s-]?efficiency)?\s*(?:led|leds|bulbs?)s?$/i;
const SPELLED_COUNT_RE = /^(?:two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|thirty)\s+(?:high[\s-]?(?:performance|powered|efficiency)|ultra\s*bright|super\s*bright|separate|small)?\s*(?:led|leds|emitter|emitters)?\s*$/i;

/** Check if a string is a generic/useless LED value */
export function isGenericLed(s: string): boolean {
	const lower = s.toLowerCase().trim();
	if (!lower || lower === 'n/a') return true;
	if (BARE_LED_RE.test(lower)) return true;
	if (BARE_MANUFACTURERS.has(lower)) return true;
	if (BARE_COLORS.has(lower)) return true;
	if (GENERIC_DESC_RE.test(lower)) return true;
	if (TEMP_ONLY_RE.test(lower)) return true;
	if (COLOR_TEMP_LED_RE.test(lower)) return true;
	if (MODIFIER_LED_RE.test(lower)) return true;
	if (WATTAGE_LED_RE.test(lower)) return true;
	if (COUNT_LED_RE.test(lower)) return true;
	if (SPELLED_COUNT_RE.test(lower)) return true;
	// "Nichia White LED", "CREE White LED", etc. — manufacturer + generic
	if (/^(?:cree|nichia|osram|luminus|samsung)\s+(?:white|neutral|warm|cool)\b/i.test(lower)) return true;
	// "Cree neutral white LED"
	if (/^(?:cree|nichia|osram|luminus)\s+(?:neutral|warm|cool)\s+white\s+led/i.test(lower)) return true;
	// Bare product family names without specific emitter: "Cree XP", "Cree XHP", "red emitters"
	if (/^(?:cree\s+)?xp$/i.test(lower) || /^(?:cree\s+)?xhp$/i.test(lower)) return true;
	if (/^(?:red|green|blue|white|amber)\s+emitters?$/i.test(lower)) return true;
	return false;
}

// --- Explicit canonical mappings for tricky/ambiguous entries ---

/**
 * Case-insensitive lookup for hand-curated overrides.
 * Key = lowercase input, Value = canonical output (or null to clear).
 */
const CANONICAL_LED_MAP: Record<string, string | null> = {
	// Osram W1/W2 product line aliases
	'cslnm1': 'Osram CSLNM1.TG',
	'cslnm1.tg': 'Osram CSLNM1.TG',
	'kw cslnm1.tg': 'Osram CSLNM1.TG',
	'osram kw cslnm1.tg': 'Osram CSLNM1.TG',
	'kw cslnm1.1g': 'Osram CSLNM1.1G',
	'osram kw cslnm1.1g': 'Osram CSLNM1.1G',
	'kw cslpm1.tg': 'Osram CSLPM1.TG',
	'osram kw cslpm1.tg': 'Osram CSLPM1.TG',
	'kw culpm1.tg': 'Osram CULPM1.TG',
	'osram kw culpm1.tg': 'Osram CULPM1.TG',

	// SBT-90 Gen 2 variants → SBT-90.2
	'sbt-90 gen 2': 'Luminus SBT-90.2',
	'sbt-90 gen2': 'Luminus SBT-90.2',
	'sbt-90 ii': 'Luminus SBT-90.2',
	'sbt-90 2nd': 'Luminus SBT-90.2',
	'sbt-90 2nd generation': 'Luminus SBT-90.2',
	'sbt-90.2nd': 'Luminus SBT-90.2',
	'luminus sbt-90 gen 2': 'Luminus SBT-90.2',
	'luminus sbt-90 gen2': 'Luminus SBT-90.2',
	'luminus sbt-90 2nd': 'Luminus SBT-90.2',
	'luminus sbt-90 ii': 'Luminus SBT-90.2',
	'luminus sbt-90-gen2': 'Luminus SBT-90.2',
	'luminus sbt90 gen2': 'Luminus SBT-90.2',
	'luminus sbt-90 gen 2': 'Luminus SBT-90.2',
	'luminous sbt-90 gen2 led': 'Luminus SBT-90.2',

	// NiteLab products — normalize casing
	'nitelab uhe': 'NiteLab UHE',
	'nitelab uhe led': 'NiteLab UHE',
	'nitelab uhi 20 max': 'NiteLab UHi 20 MAX',
	'nitelab uhi 20': 'NiteLab UHi 20',
	'uhi 20 max': 'NiteLab UHi 20 MAX',
	'uhi 20': 'NiteLab UHi 20',
	'nitelab uhi 40 max': 'NiteLab UHi 40 MAX',
	'nitelab uhi 40': 'NiteLab UHi 40',
	'nitelab uhi 20 max led': 'NiteLab UHi 20 MAX',
	'nitelab uhi 40 max led': 'NiteLab UHi 40 MAX',

	// Proprietary/brand-specific — keep as-is
	'c4 led': 'C4 LED',
	'x-led': 'X-LED',
	'5mm': '5mm',
	'cob': 'COB',
	'lep': 'LEP',
	'uv led': 'UV LED',
	'rgb led': 'RGB LED',

	// Bare Osram part numbers without suffix
	'cslpm1': 'Osram CSLPM1.TG',
	'cslpm1.tg': 'Osram CSLPM1.TG',
	'culpm1.tg': 'Osram CULPM1.TG',

	// Osram without dot suffix
	'osramkwcslnm1': 'Osram CSLNM1.TG',
	'kp cslpm1.f1': 'Osram CSLPM1.F1',

	// Manufacturer typos
	'luminux sst-40': 'Luminus SST-40',
	'luminux sst40': 'Luminus SST-40',
	'luminous sst-40': 'Luminus SST-40',
	'orsam': null, // typo for Osram, but bare manufacturer → clear
	'lumimus sft-42r': 'Luminus SFT-42R',

	// COB variants → COB
	'cob led': 'COB',
	'cob leds': 'COB',
	'chip on board (cob) led': 'COB',
	'chip on board (cob) leds': 'COB',

	// Halogen/Incandescent — preserve these as non-LED lamp types
	'halogen bulb': 'Halogen',
	'quartz halogen bulb': 'Halogen',
	'incandescent': 'Incandescent',
	'krypton': 'Krypton',
	'xenon': 'Xenon',
	'xenon bulb': 'Xenon',

	// "MCE" → Cree MC-E
	'mce': 'Cree MC-E',

	// Marketing/generic descriptors that slipped through
	'creeled': null,
	'maxbright': null,
	'maxbright led': null,
	'hd led': null,
	'hod led': null,
	'single': null,
	'others': null,
	'power led': null,

	// Data errors — clear
	'cree osram': null,
	'red emitters': null,

	// Nichia 219CT — distinct from 219C (different thermal pad)
	'nichia 219ct': 'Nichia 219CT',
	'219ct': 'Nichia 219CT',

	// Nichia 519A variants — "DD" = dedomed, "-400K" is a typo for 4000K
	'519a dd': 'Nichia 519A',
	'nichia 519a-400k': 'Nichia 519A',
	'519a-400k': 'Nichia 519A',

	// Complex compound entries — extract primary emitter
	'white: floodlight(cct: 5700-6500k); spotlight(cct: 5700-7000k); red: (wl: 620-630nm)': null,
	'n/a (cool white 5500-6000k) + r g b': null,
	'95cri x-led, 4000k neutral white': 'X-LED',
};

// --- Normalizer functions ---

/** Strip multiplier prefix like "8*", "4x ", "3x " and return [multiplier, remainder] */
function stripMultiplier(s: string): [number | null, string] {
	const m = s.match(/^(\d+)\s*[x*×]\s*/i);
	if (m) return [parseInt(m[1]), s.slice(m[0].length)];
	return [null, s];
}

/** Strip color temperature values like "6500K", "5000K" */
function stripColorTemp(s: string): string {
	// "Cool White - SST20, 6500K" → "SST20"
	s = s.replace(/,?\s*\d{4,5}\s*K\b/gi, '');
	// "cool white", "neutral white", "warm white", "warm" as color temp descriptors
	s = s.replace(/\b(?:cool|neutral|warm|day)\s*white\b/gi, '');
	// Standalone "Warm", "Cool" after an emitter name (e.g. "XP-L Warm")
	s = s.replace(/\s+(?:Warm|Cool|Neutral)\s*$/i, '');
	// Leading dash/comma after stripping
	s = s.replace(/^\s*[-–,]+\s*/, '');
	// Clean up parenthetical artifacts: "(, xxx)" → "(xxx)", "( )" → ""
	s = s.replace(/\(\s*,\s*/g, '(');
	s = s.replace(/\(\s*\)/g, '');
	return s.trim();
}

/** Strip CRI bin suffixes: R9080, R9050, 95CRI+, HCRI, "high CRI" */
function stripCri(s: string): string {
	s = s.replace(/\b(?:R90[5678]0|9\d\s*CRI\+?|HCRI|high[\s-]?CRI)\+?\b/gi, '');
	// Clean up leftover "+" from CRI+
	s = s.replace(/\s*\+\s*$/, '');
	return s.trim();
}

/** Strip brightness bins at end of string: T6, U2, V6, R5, S3, Q5, K4, etc. */
function stripBrightnessBin(s: string): string {
	// Only strip if it's at the end and preceded by a space or dash
	// "XP-L2 V6" → "XP-L2", "XM-L T6" → "XM-L", "XP-G R5" → "XP-G", "XHP50.2 K4" → "XHP50.2"
	s = s.replace(/[\s-]+[TUVRSQK]\d\s*$/i, '');
	// Also "(U3)" pattern
	s = s.replace(/\s*\([TUVRSQK]\d\)\s*$/i, '');
	return s.trim();
}

/** Strip trailing "LED(s)" if a real emitter name precedes it */
function stripTrailingLed(s: string): string {
	// "Luminus SFT25R LED" → "Luminus SFT25R"
	// But NOT "UV LED" (handled by canonical map) or "C4 LED"
	const m = s.match(/^(.+?)\s+LEDs?$/i);
	if (m) {
		const base = m[1].trim();
		// Only strip if the base looks like a real emitter identifier
		if (/[A-Z]{2,}[\d-]|^\d{3}[A-Za-z]|\bS[BFS]T|\bXP|\bXM|\bXHP|\bLH\d|\bNTG|\bSFQ|\bSSQ/i.test(base)) {
			return base;
		}
	}
	return s;
}

/** Normalize manufacturer prefix to canonical casing */
function normalizeManufacturer(s: string): string {
	s = s.replace(/^(CREE|cree)\s+/i, 'Cree ');
	s = s.replace(/^(LUMINUS|luminus|Luminous|LUMINOUS|Luminux|LUMINUX|Lumimus)\s+/i, 'Luminus ');
	s = s.replace(/^(NICHIA|nichia)\s+/i, 'Nichia ');
	s = s.replace(/^(OSRAM|osram)\s+/i, 'Osram ');
	s = s.replace(/^(SAMSUNG|samsung)\s+/i, 'Samsung ');
	s = s.replace(/^(LUXEON|luxeon)\s+/i, 'Luxeon ');
	s = s.replace(/^(SEOUL|seoul)\s+/i, 'Seoul ');
	return s;
}

/** Add manufacturer prefix for known bare emitter identifiers */
function addManufacturerPrefix(s: string): string {
	// Samsung LH351D — must check before Luminus S*T pattern
	if (/^LH351/i.test(s)) return `Samsung ${s}`;

	// Cree XP/XM/XHP/XR series
	if (/^XP-?[GCEL]/i.test(s) || /^XM-?L/i.test(s) || /^XHP/i.test(s) || /^XR-?E/i.test(s)) {
		return `Cree ${s}`;
	}
	// Bare R2/R3/R5/Q4/Q5 — these are Cree brightness bins used as model names
	// Only match single letter+digit that are known Cree emitters
	if (/^(?:MC-E)$/i.test(s)) return `Cree ${s}`;

	// Luminus S*T series (SST, SFT, SBT)
	if (/^S[BFS]T-?\d/i.test(s)) return `Luminus ${s}`;

	// Nichia 519A, 319A, 219B, 219C, E21A
	if (/^(?:519|319|219)[A-Z]?$/i.test(s) || /^E21A/i.test(s)) return `Nichia ${s}`;

	// Osram CSLNM/CSLPM/CULPM/KW/P8/P9/W series
	if (/^(?:CSL[NP]M|CULPM|GW[\s.])/i.test(s)) return `Osram ${s}`;
	if (/^P[89]\b/i.test(s)) return `Osram ${s}`;
	// W1/W2 bare — too ambiguous, skip (handled by canonical map for full forms)

	return s;
}

/** Normalize Luminus hyphens: SST40→SST-40, SFT40→SFT-40, SBT90→SBT-90 */
function normalizeHyphens(s: string): string {
	// Insert hyphen between letter-group and digit-group for S*T series
	// "SST40" → "SST-40", "SFT70" → "SFT-70", "SBT90" → "SBT-90"
	// But preserve existing hyphens: "SST-40" stays "SST-40"
	// Also preserve dot-versions: "SBT90.2" → "SBT-90.2"
	s = s.replace(/\b(S[BFS]T)(\d)/gi, '$1-$2');
	// "SFT25R" → "SFT-25R"
	// Note: already handled by above since the pattern matches S[BFS]T followed by digit
	return s;
}

/** Normalize Cree XP-L HI/HD spacing variants */
function normalizeXplSpacing(s: string): string {
	// "XP-LHI" → "XP-L HI", "XPLHI" → "XP-L HI", "XPL HI" → "XP-L HI"
	s = s.replace(/\bXP-?L\s*HI\b/gi, 'XP-L HI');
	s = s.replace(/\bXP-?L\s*HD\b/gi, 'XP-L HD');
	// "XPL-Hi" → "XP-L HI"
	s = s.replace(/\bXPL[\s-]*HI\b/gi, 'XP-L HI');
	s = s.replace(/\bXPL[\s-]*HD\b/gi, 'XP-L HD');
	// "XPE" → "XP-E"
	s = s.replace(/\bXPE\b/gi, 'XP-E');
	return s;
}

/** Normalize Cree XHP spacing and hyphens */
function normalizeXhpSpacing(s: string): string {
	// "XHP-50" → "XHP50", "XHP-70" → "XHP70", "XHP-35" → "XHP35"
	s = s.replace(/\bXHP-(\d)/gi, 'XHP$1');
	// "XHP 35Hi" → "XHP35 HI", "XHP 70.3 HD" → "XHP70.3 HD"
	s = s.replace(/\bXHP\s+(\d)/gi, 'XHP$1');
	// "XHP35HI" → "XHP35 HI", "XHP35-HI" → "XHP35 HI", "XHP35HD" → "XHP35 HD"
	s = s.replace(/\b(XHP\d+(?:\.\d)?)[\s-]*(HI|HD)\b/gi, (_, base, suffix) => `${base} ${suffix.toUpperCase()}`);
	// "XHP50.3HI" → "XHP50.3 HI"
	s = s.replace(/\b(XHP\d+\.\d)[\s-]*(HI|HD)\b/gi, (_, base, suffix) => `${base} ${suffix.toUpperCase()}`);
	// "XHP50d" → "XHP50" (strip unknown suffixes — 'd' is not a real variant)
	// Actually keep it, could be a real variant we don't know about
	return s;
}

/** Normalize Cree XM-L spacing: "XML3" → "XM-L3" */
function normalizeXmlSpacing(s: string): string {
	s = s.replace(/\bXML(\d)/gi, 'XM-L$1');
	return s;
}

/** Uppercase the LED identifier portion (XP-G3, XHP70.2, SST-40, 519A etc.) */
function uppercaseLedId(s: string): string {
	// Uppercase known LED model patterns — but NOT wavelength values like 660nm, 365nm
	return s.replace(
		/\b(XP-?[GCEL]\d*|XM-?L\d*|XHP\d+(?:\.\d)?|XR-?E\d*|S[BFS]T-?\d+[A-Z]?(?:\.\d)?|LH\d+[A-Z]?|E21A|NTG\d+|SFQ\d+(?:\.\d)?|SSQ\d+(?:\.\d)?|MC-E)\b/gi,
		(m) => m.toUpperCase()
	);
	// Note: removed \d{3}[A-Za-z] pattern — too broad, catches wavelengths (660nm).
	// Nichia 3-digit LEDs (519A, 319A, 219B) are handled by addManufacturerPrefix + case normalization.
}

/**
 * Normalize a single LED string to its canonical form.
 * Returns null if the string is generic/useless (should be filtered out).
 */
export function normalizeLed(raw: string): string | null {
	let s = raw.trim();
	if (!s) return null;

	// 1. Check canonical map for exact match (case-insensitive)
	const mapKey = s.toLowerCase();
	if (mapKey in CANONICAL_LED_MAP) {
		return CANONICAL_LED_MAP[mapKey];
	}

	// 2. Check if generic before any transformation
	if (isGenericLed(s)) return null;

	// 3. Handle multiplier prefix: "8*NTG35 5000K 95CRI+" → process "NTG35 5000K 95CRI+"
	const [mult, remainder] = stripMultiplier(s);
	if (mult !== null) {
		const normalized = normalizeLed(remainder);
		if (!normalized) return null;
		return `${mult}x ${normalized}`;
	}

	// 4. Strip color temp values
	s = stripColorTemp(s);

	// 5. Strip CRI bins
	s = stripCri(s);

	// 6. Strip trailing LED(s) BEFORE brightness bins (so "XP-L2 V6 LED" → "XP-L2 V6" → "XP-L2")
	s = stripTrailingLed(s);

	// 7. Strip brightness bins
	s = stripBrightnessBin(s);

	// 8. Collapse whitespace, trim
	s = s.replace(/\s+/g, ' ').trim();

	// 9. Re-check generic after stripping (may have reduced to "LED", "Cree XP", or empty)
	if (!s || isGenericLed(s)) return null;

	// 10. Re-check canonical map after stripping
	const strippedKey = s.toLowerCase();
	if (strippedKey in CANONICAL_LED_MAP) {
		return CANONICAL_LED_MAP[strippedKey];
	}

	// 11. Normalize manufacturer prefix casing
	s = normalizeManufacturer(s);

	// 12. Add manufacturer prefix for bare emitter names
	if (!/^(?:Cree|Luminus|Nichia|Osram|Samsung|Luxeon|Seoul|NiteLab)\s/i.test(s)) {
		s = addManufacturerPrefix(s);
	}

	// 13. Normalize hyphens (SST40→SST-40)
	s = normalizeHyphens(s);

	// 14. Normalize XP-L HI/HD and XP-E spacing
	s = normalizeXplSpacing(s);

	// 15. Normalize XHP spacing/hyphens
	s = normalizeXhpSpacing(s);

	// 16. Normalize XM-L spacing
	s = normalizeXmlSpacing(s);

	// 17. Uppercase LED model identifiers
	s = uppercaseLedId(s);

	// 18. Uppercase Nichia 3-digit LED suffixes: 519a→519A, 219b→219B, 219c→219C
	s = s.replace(/\b(\d{3})([a-z])\b/g, (_, num, letter) => `${num}${letter.toUpperCase()}`);

	// 19. Ensure "HI"/"HD" after XP-L and XHP35 are uppercase
	s = s.replace(/\bHi\b/, 'HI');
	s = s.replace(/\bHd\b/, 'HD');

	// 20. Final cleanup
	s = s.replace(/\s+/g, ' ').trim();
	// Strip trailing comma/dash artifacts
	s = s.replace(/[\s,\-]+$/, '').trim();

	// 21. Final generic check
	if (!s || isGenericLed(s)) return null;

	return s;
}

/**
 * Normalize an array of LED strings: map each through normalizeLed(),
 * filter nulls, deduplicate, sort alphabetically.
 */
export function normalizeLedArray(leds: string[]): string[] {
	const result = new Set<string>();
	for (const raw of leds) {
		const canonical = normalizeLed(raw);
		if (canonical) result.add(canonical);
	}
	return [...result].sort();
}

// --- Test cases for verification ---

export const LED_TEST_CASES: Array<[string, string | null]> = [
	// Case normalization
	['519A', 'Nichia 519A'],
	['519a', 'Nichia 519A'],
	['Nichia 519A', 'Nichia 519A'],
	['Nichia 519a', 'Nichia 519A'],
	['NICHIA 519A', 'Nichia 519A'],

	// Prefix normalization
	['XP-G3', 'Cree XP-G3'],
	['CREE XP-G3', 'Cree XP-G3'],
	['Cree XP-G3', 'Cree XP-G3'],
	['XHP70', 'Cree XHP70'],
	['CREE XHP70', 'Cree XHP70'],
	['XM-L2', 'Cree XM-L2'],

	// Hyphen normalization
	['SST40', 'Luminus SST-40'],
	['SST-40', 'Luminus SST-40'],
	['Luminus SST40', 'Luminus SST-40'],
	['LUMINUS SST40', 'Luminus SST-40'],
	['SFT40', 'Luminus SFT-40'],
	['Luminus SFT40', 'Luminus SFT-40'],
	['SBT90.2', 'Luminus SBT-90.2'],
	['Luminus SBT90.2', 'Luminus SBT-90.2'],

	// Space normalization (XP-L HI/HD)
	['XP-LHI', 'Cree XP-L HI'],
	['XP-L HI', 'Cree XP-L HI'],
	['Cree XP-L HI', 'Cree XP-L HI'],
	['XPL HI', 'Cree XP-L HI'],
	['CREE XPL-Hi', 'Cree XP-L HI'],
	['XP-L HD', 'Cree XP-L HD'],
	['XP-LHD', 'Cree XP-L HD'],

	// Brightness bin stripping
	['CREE XP-L2 V6', 'Cree XP-L2'],
	['CREE XM-L T6', 'Cree XM-L'],
	['CREE XM-L2 U2', 'Cree XM-L2'],
	['Cree XP-G R5', 'Cree XP-G'],
	['CREE XP-L HI V3', 'Cree XP-L HI'],

	// Color temp / CRI stripping
	['Nichia 519a R9080 4000K', 'Nichia 519A'],
	['Cool White - SST20, 6500K', 'Luminus SST-20'],
	['NTG35 5000K 95CRI+', 'NTG35'],
	['8*NTG35 5000K 95CRI+', '8x NTG35'],
	['8*Cool White - SST20, 6500K', '8x Luminus SST-20'],

	// Generation preservation (MUST NOT merge)
	['XHP70', 'Cree XHP70'],
	['XHP70.2', 'Cree XHP70.2'],
	['XHP70.3', 'Cree XHP70.3'],
	['XHP50', 'Cree XHP50'],
	['XHP50.2', 'Cree XHP50.2'],
	['XHP50.3', 'Cree XHP50.3'],
	['XHP35', 'Cree XHP35'],

	// HD vs HI preservation (MUST NOT merge)
	['XP-L HI', 'Cree XP-L HI'],
	['XP-L HD', 'Cree XP-L HD'],
	['XHP35 HI', 'Cree XHP35 HI'],

	// Die size preservation (MUST NOT merge)
	['SST-20', 'Luminus SST-20'],
	['SST-40', 'Luminus SST-40'],
	['SST-70', 'Luminus SST-70'],

	// -W variant preservation (MUST NOT merge with non-W)
	['Luminus SFT-40-W', 'Luminus SFT-40-W'],
	['Luminus SFT40-W', 'Luminus SFT-40-W'],

	// Family preservation (MUST NOT merge)
	['219B', 'Nichia 219B'],
	['219C', 'Nichia 219C'],
	['319A', 'Nichia 319A'],
	['E21A', 'Nichia E21A'],

	// SBT-90 vs SBT-90.2 (MUST NOT merge)
	['SBT-90', 'Luminus SBT-90'],
	['SBT-90 Gen 2', 'Luminus SBT-90.2'],
	['Luminus SBT-90.2', 'Luminus SBT-90.2'],

	// Samsung LH351D (not Luminus)
	['LH351D', 'Samsung LH351D'],
	['Samsung LH351D', 'Samsung LH351D'],

	// Osram aliases
	['CSLNM1', 'Osram CSLNM1.TG'],
	['KW CSLPM1.TG', 'Osram CSLPM1.TG'],
	['Osram P9', 'Osram P9'],
	['OSRAM P8', 'Osram P8'],

	// Brightness bin stripping after trailing LED strip
	['CREE XP-L2 V6 LED', 'Cree XP-L2'],
	['CREE XP-L HD V6', 'Cree XP-L HD'],

	// Generics → null
	['LED', null],
	['White LED', null],
	['High Performance Cool White LED', null],
	['Cree', null],
	['Nichia', null],
	['unknown', null],
	['red', null],
	['Cool White', null],
	['LED Chip', null],
	['High power LED', null],
	['Cree XP', null],
	['Cree XHP', null],
	['red emitters', null],

	// XHP normalization
	['XHP-50', 'Cree XHP50'],
	['XHP-70', 'Cree XHP70'],
	['XHP-70.2', 'Cree XHP70.2'],
	['XHP35HI', 'Cree XHP35 HI'],
	['XHP35HD', 'Cree XHP35 HD'],
	['XHP50.3HI', 'Cree XHP50.3 HI'],
	['Cree XHP 35Hi', 'Cree XHP35 HI'],
	['Cree XHP 70.3 HD', 'Cree XHP70.3 HD'],
	['Cree XHP35-HI', 'Cree XHP35 HI'],

	// XM-L normalization
	['XML3', 'Cree XM-L3'],
	['XPE', 'Cree XP-E'],

	// Color temp stripping on emitter
	['XP-L Warm', 'Cree XP-L'],

	// Typo corrections
	['Luminux SST-40', 'Luminus SST-40'],
	['MCE', 'Cree MC-E'],
	['COB LED', 'COB'],

	// Wattage/count generics → null
	['3 W LED', null],
	['1 Watt LED bulb', null],
	['24 super bright LED', null],
	['7 LEDs', null],

	// Proprietary — keep as-is
	['C4 LED', 'C4 LED'],
	['LEP', 'LEP'],
	['COB', 'COB'],
	['X-LED', 'X-LED'],
	['5mm', '5mm'],
	['UV LED', 'UV LED'],
	['RGB LED', 'RGB LED'],

	// Non-LED lamp types
	['Xenon', 'Xenon'],
	['Halogen Bulb', 'Halogen'],
];

/** Run built-in self-test. Returns { passed, failed, errors } */
export function runSelfTest(): { passed: number; failed: number; errors: string[] } {
	let passed = 0;
	const errors: string[] = [];

	for (const [input, expected] of LED_TEST_CASES) {
		const actual = normalizeLed(input);
		if (actual === expected) {
			passed++;
		} else {
			errors.push(`  FAIL: "${input}" → "${actual}" (expected "${expected}")`);
		}
	}

	return { passed, failed: errors.length, errors };
}

// CLI self-test mode
if (import.meta.main) {
	console.log('=== LED Normalizer Self-Test ===\n');
	const { passed, failed, errors } = runSelfTest();
	for (const err of errors) console.log(err);
	console.log(`\n${passed} passed, ${failed} failed out of ${LED_TEST_CASES.length} test cases`);
	if (failed > 0) process.exit(1);
}
