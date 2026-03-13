/**
 * SI prefix notation encoding/decoding.
 * Exact port of parametrek.js siNotation/smartFixed/parseFloat2.
 */

const prefixes: Record<string, string> = {
	'-18': 'a', '-15': 'f', '-12': 'p', '-9': 'n', '-6': 'μ', '-3': 'm',
	'0': '', '3': 'k', '6': 'M', '9': 'G', '12': 'T', '15': 'P', '18': 'E'
};

const prefixesRev: Record<string, number> = {
	'a': -18, 'f': -15, 'p': -12, 'n': -9, 'μ': -6, 'm': -3,
	'k': 3, 'M': 6, 'G': 9, 'T': 12, 'P': 15, 'E': 18
};

/** Convert number to SI notation with 3 significant figures */
export function siNotation(n: number): string {
	if (n === 0) return '0';
	let scale = 0;
	let val = n;
	while (Math.abs(val) >= 1000) {
		val = val / 1000;
		scale += 3;
	}
	while (Math.abs(val) < 1) {
		val = val * 1000;
		scale -= 3;
	}
	let formatted: string;
	if (Math.abs(val) >= 100) {
		formatted = val.toFixed(0);
	} else if (Math.abs(val) >= 10) {
		formatted = val.toFixed(1);
	} else {
		formatted = val.toFixed(2);
	}
	return formatted + (prefixes[scale.toFixed()] ?? '');
}

/** Smart fixed-point formatting matching parametrek behavior */
export function smartFixed(n: number, decimals: number | string): string {
	if (n === 0) return '0';
	if (decimals === '{si}') return siNotation(n);
	const dec = typeof decimals === 'string' ? parseInt(decimals, 10) : decimals;
	if (dec >= 2) return n.toFixed(dec);
	if (Math.abs(n) < 1) return n.toFixed(2);
	if (Math.abs(n) < 3) return n.toFixed(1);
	return n.toFixed(dec);
}

/** Parse float that understands SI prefixes (e.g. "4.5k" → 4500) */
export function parseFloat2(n: string): number {
	const last = n.slice(-1);
	let scale = 0;
	if (prefixesRev[last] !== undefined) {
		scale = prefixesRev[last];
	}
	return parseFloat(n) * Math.pow(10, scale);
}

/** Format a value using a unit template */
export function formatUnit(value: string | number, unit: string): string {
	return unit.replace('{}', String(value));
}
