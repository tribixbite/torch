/**
 * Canonical switch normalizer — consolidates ~132 unique switch strings into ~25 canonical values.
 *
 * Taxonomy follows parametrek.com conventions:
 * - Position: tail, side, top, body, head
 * - Type: clicky, electronic, rotary, twisty, momentary, toggle, magnetic ring
 * - Compound: "dual" (side+tail), "dual side", "dual tail", etc.
 *
 * Usage:
 *   import { normalizeSwitch, normalizeSwitchArray } from './switch-normalizer.js';
 *   normalizeSwitch("push button")    // → "clicky"
 *   normalizeSwitch("twist")          // → "twisty"
 */

// --- Canonical map: lowercase key → canonical value (null = drop) ---

const CANONICAL_MAP: Record<string, string | null> = {
	// Core types — pass through
	'tail': 'tail',
	'side': 'side',
	'rotary': 'rotary',
	'electronic': 'electronic',
	'twisty': 'twisty',
	'momentary': 'momentary',
	'toggle': 'toggle',
	'body': 'body',
	'top': 'top',
	'front': 'side',  // front = side position
	'head': 'top',    // head switch = top
	'rear': 'tail',   // rear = tail position
	'bottom': 'tail',
	'back': 'tail',
	'central': 'body',

	// Dual variants
	'dual': 'dual',
	'dual side': 'dual side',
	'dual tail': 'dual tail',
	'dual top': 'dual top',
	'dual push button': 'dual',
	'dual button': 'dual',
	'dual-button': 'dual',
	'dual tailcap': 'dual tail',
	'dual tail buttons': 'dual tail',
	'dual body switch': 'dual body',
	'dual metal e-switches': 'dual electronic',
	'dual-stage power button': 'electronic',
	'dual-stage mode button': 'electronic',
	'dual-stage tactical button': 'electronic',
	'dual switches': 'dual',
	'3-switch': 'dual',
	'3-way operation toggle switch': 'toggle',
	'3-way side and tail switches': 'dual',
	'dual-stage tactical switch': 'electronic',
	'magnetic dual-stage tactical switch': 'electronic',

	// Clicky / push button variants → clicky
	'push button': 'clicky',
	'push-button': 'clicky',
	'pushbutton': 'clicky',
	'push': 'clicky',
	'clicky': 'clicky',
	'click': 'clicky',
	'button': 'clicky',
	'reverse clicky': 'clicky',
	'forward clicky': 'clicky',
	'clicky switch': 'clicky',
	'end click switch': 'clicky',
	'mcclicky': 'clicky',
	'rubber push button': 'clicky',
	'momentary push button': 'momentary',
	'push button tail': 'tail',
	'momentary tail button': 'momentary',
	'trigger button': 'clicky',

	// Twist variants → twisty
	'twist': 'twisty',
	'progressive twist': 'twisty',
	'twisting lens shroud': 'twisty',
	'one-handed rotary switch': 'rotary',
	'rotary tail': 'rotary',
	'rotary magnetic': 'magnetic ring',

	// Magnetic ring
	'magnetic ring': 'magnetic ring',
	'magnetic': 'magnetic ring',
	'magnetic press button': 'electronic',
	'variable ring': 'magnetic ring',
	'ring': 'magnetic ring',

	// Tail variants
	'tail switch': 'tail',
	'tailcap': 'tail',
	'tail tactical': 'tail',
	'tactical': 'tail',  // "tactical" usually means tactical tail switch
	'tactical forward-click': 'tail',
	'forward momentary': 'momentary',

	// Electronic / e-switch
	'electronic switch': 'electronic',
	'electronic side switch': 'electronic',
	'pcb controlled switch': 'electronic',

	// Mechanical
	'mechanical': 'mechanical',
	'mechanical revolving head switch': 'rotary',

	// Selector / dial
	'selector': 'selector',
	'selector dial': 'selector',
	'selector ring': 'selector',
	'dial': 'selector',
	'brightness': 'selector',  // brightness selector
	'icontrol keypad': 'electronic',
	'silicone rubber keypad': 'electronic',
	'central button & selector': 'selector',

	// Remote
	'remote': 'remote',
	'wireless': 'remote',
	'wireless remote switch': 'remote',
	'remote control': 'remote',
	'remote pressure': 'remote',

	// Slide / flip
	'slide': 'slide',
	'slider': 'slide',
	'flip': 'slide',
	'locking switch': 'slide',

	// Motion / gesture / sensor
	'motion': 'sensor',
	'motion sensor': 'sensor',
	'gesture sensor': 'sensor',
	'gesture-sensing': 'sensor',
	'guesture activation control': 'sensor',  // typo
	'noncontact': 'sensor',
	'swipe activated': 'sensor',
	'touch': 'sensor',
	'gravity sensor': 'sensor',

	// Ambidextrous — normalize to specific type
	'ambidextrous': 'side',
	'ambidextrous push/toggle': 'side',
	'ambidextrous push / toggle': 'side',
	'ambidextrous push': 'side',
	'ambidextrous toggle': 'side',
	'ambidextrous rear': 'tail',

	// Various
	'on/off switch': 'clicky',
	'contact switch': 'clicky',
	'reverse switch': 'clicky',
	'reverse': 'clicky',
	'forward': 'momentary',
	'constant-on': 'clicky',
	'momentary switch': 'momentary',
	'dome': 'clicky',
	'bolt action': 'mechanical',
	'wheel': 'rotary',
	'trigger': 'clicky',
	'push/toggle': 'side',

	// Junk / descriptors
	'single': null,
	'single body switch': 'body',
	'single power switch': 'electronic',
	'single-hand': null,
	'single-handed control': null,
	'neck-mounted': null,
	'one-handed safety switch': null,
	'multifunctional': null,
	'stainless steel': null,  // material, not switch type
	'metal': null,
	'tactile': null,  // descriptor, not type
	'm': null,  // abbreviation, unclear
};

/**
 * Normalize a single switch string to its canonical form.
 * Returns null if the string should be dropped.
 */
export function normalizeSwitch(raw: string): string | null {
	const s = raw.trim();
	if (!s || s === 'unknown') return null;

	// Check canonical map (case-insensitive)
	const key = s.toLowerCase();
	if (key in CANONICAL_MAP) {
		return CANONICAL_MAP[key];
	}

	// Remaining short values — pass through lowercase
	if (s.length < 30) return s.toLowerCase();

	// Long descriptions are junk
	return null;
}

/**
 * Normalize an array of switch strings:
 * normalize each, filter nulls, deduplicate, sort.
 */
export function normalizeSwitchArray(arr: string[]): string[] {
	const result = new Set<string>();
	for (const raw of arr) {
		const canonical = normalizeSwitch(raw);
		if (canonical) result.add(canonical);
	}
	return [...result].sort();
}

// --- Test cases ---

export const SWITCH_TEST_CASES: Array<[string, string | null]> = [
	// Core types
	['tail', 'tail'],
	['side', 'side'],
	['rotary', 'rotary'],
	['electronic', 'electronic'],
	['twisty', 'twisty'],
	['momentary', 'momentary'],
	['toggle', 'toggle'],
	['body', 'body'],
	['top', 'top'],

	// Position aliases
	['front', 'side'],
	['rear', 'tail'],
	['head', 'top'],
	['bottom', 'tail'],
	['back', 'tail'],

	// Push button → clicky
	['push button', 'clicky'],
	['Push button', 'clicky'],
	['push-button', 'clicky'],
	['pushbutton', 'clicky'],
	['clicky', 'clicky'],
	['click', 'clicky'],
	['button', 'clicky'],
	['reverse clicky', 'clicky'],
	['forward clicky', 'clicky'],
	['McClicky', 'clicky'],
	['Clicky Switch', 'clicky'],

	// Twist → twisty
	['twist', 'twisty'],
	['progressive twist', 'twisty'],

	// Dual
	['dual', 'dual'],
	['dual side', 'dual side'],
	['dual tail', 'dual tail'],
	['dual top', 'dual top'],
	['dual push button', 'dual'],
	['dual tailcap', 'dual tail'],
	['dual button', 'dual'],

	// Magnetic ring
	['magnetic ring', 'magnetic ring'],
	['magnetic', 'magnetic ring'],
	['ring', 'magnetic ring'],

	// Selector
	['selector', 'selector'],
	['selector dial', 'selector'],
	['brightness', 'selector'],
	['dial', 'selector'],
	['Central Button & Selector', 'selector'],

	// Remote
	['remote', 'remote'],
	['wireless', 'remote'],
	['Remote Control', 'remote'],

	// Sensor
	['motion', 'sensor'],
	['motion sensor', 'sensor'],
	['gesture sensor', 'sensor'],
	['touch', 'sensor'],
	['noncontact', 'sensor'],

	// Ambidextrous → position
	['ambidextrous', 'side'],
	['ambidextrous push/toggle', 'side'],
	['Ambidextrous push/toggle', 'side'],
	['ambidextrous rear', 'tail'],

	// Tail variants
	['tail switch', 'tail'],
	['tailcap', 'tail'],
	['Tailcap', 'tail'],
	['tactical', 'tail'],

	// Electronic variants
	['electronic switch', 'electronic'],
	['electronic side switch', 'electronic'],
	['icontrol keypad', 'electronic'],

	// Mechanical
	['mechanical', 'mechanical'],
	['bolt action', 'mechanical'],

	// Slide
	['slide', 'slide'],
	['slider', 'slide'],
	['flip', 'slide'],

	// Junk → null
	['stainless steel', null],
	['metal', null],
	['single', null],
	['M', null],
];

/** Run built-in self-test */
export function runSelfTest(): { passed: number; failed: number; errors: string[] } {
	let passed = 0;
	const errors: string[] = [];
	for (const [input, expected] of SWITCH_TEST_CASES) {
		const actual = normalizeSwitch(input);
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
	console.log('=== Switch Normalizer Self-Test ===\n');
	const { passed, failed, errors } = runSelfTest();
	for (const err of errors) console.log(err);
	console.log(`\n${passed} passed, ${failed} failed out of ${SWITCH_TEST_CASES.length} test cases`);
	if (failed > 0) process.exit(1);
}
