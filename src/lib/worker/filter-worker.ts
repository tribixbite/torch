/**
 * Web Worker for all filter/sort/search operations.
 * Runs entirely off the main thread. Receives full dataset on init,
 * then filter messages with serialized filter state.
 */

import type { FlashlightDB } from '../schema/columns.js';
import type { FilterMessage, FilterResult, SerializedFilter, SerializedFilters, SortState } from '../schema/filter-schema.js';

let db: FlashlightDB;
let searchIndex: string[]; // lowercase model+brand for text search
let defaultOrder: number[]; // cached [0, 1, 2, ...n] for unsorted iteration
let lastFilterId = 0; // skip stale requests

// --- Set operations (exact ports from parametrek.js) ---

/** Returns true if sets intersect (any) — O(n) via Set lookup */
function arrayIntersect(selected: string[], data: unknown): boolean {
	const dataArr = normalizeToStringArray(data);
	if (selected.length === 0 || dataArr.length === 0) return false;
	// Build Set from smaller array, iterate larger
	const [smaller, larger] =
		selected.length < dataArr.length ? [selected, dataArr] : [dataArr, selected];
	const lookup = new Set(smaller);
	for (const item of larger) {
		if (lookup.has(item)) return true;
	}
	return false;
}

/** Returns true if selected is perfect superset of data (all) */
function arraySuperset(selected: string[], data: unknown): boolean {
	const ar2 = normalizeToStringArray(data);
	if (selected.length === 0 || ar2.length === 0) return false;
	if (selected.length > ar2.length) return false;
	for (const item of selected) {
		if (ar2.indexOf(item) === -1) return false;
	}
	return true;
}

/** Returns true if data is perfect subset of selected (only) */
function arraySubset(selected: string[], data: unknown): boolean {
	const ar2 = normalizeToStringArray(data);
	if (selected.length === 0 || ar2.length === 0) return false;
	if (selected.length < ar2.length) return false;
	for (const item of ar2) {
		if (selected.indexOf(item) === -1) return false;
	}
	return true;
}

/** Returns true if sets don't intersect (none) */
function arrayOpposite(selected: string[], data: unknown): boolean {
	return !arrayIntersect(selected, data);
}

/** Returns true if any element is between min and max */
function arrayWindow(data: unknown, min: number, max: number): boolean {
	if (typeof data === 'number') {
		return min <= data && data <= max;
	}
	if (Array.isArray(data)) {
		for (const item of data) {
			const n = typeof item === 'number' ? item : parseFloat(item as string);
			if (!isNaN(n) && min <= n && n <= max) return true;
		}
	}
	return false;
}

/** Normalize data to string array, stripping // prefixes */
function normalizeToStringArray(data: unknown): string[] {
	if (typeof data === 'string') return data ? [data] : [];
	if (Array.isArray(data)) {
		return (data as string[]).map((x) => (typeof x === 'string' ? x.replace(/^\/\//, '') : String(x)));
	}
	return [];
}

const logicTable: Record<string, (selected: string[], data: unknown) => boolean> = {
	any: arrayIntersect,
	all: arraySuperset,
	only: arraySubset,
	none: arrayOpposite
};

/** Check if data cell is null/empty — entries with no data for a field */
function isEmpty(data: unknown): boolean {
	if (data === null || data === undefined || data === '') return true;
	if (Array.isArray(data) && data.length === 0) return true;
	return false;
}

/** Test a single flashlight item against all active filters */
function testItem(
	itemIndex: number,
	filters: SerializedFilters,
	optsRef: FlashlightDB['opts']
): boolean {
	const itemData = db.data[itemIndex];

	for (const colStr of Object.keys(filters)) {
		const col = parseInt(colStr, 10);
		const filter = filters[col];
		const data = itemData[col];
		const opts = optsRef[col];
		if (!opts) continue;

		switch (filter.type) {
			case 'multi': {
				const fn = logicTable[filter.mode];
				if (!fn(filter.selected, data)) {
					if (filter.showUnknown && isEmpty(data)) break;
					return false;
				}
				break;
			}
			case 'boolean': {
				if (filter.showUnknown && isEmpty(data)) break;
				const field = normalizeToStringArray(data);
				if (filter.mode === 'all') {
					// ALL yes-checked must be present in data
					for (const yesItem of filter.yes) {
						if (field.indexOf(yesItem) === -1) return false;
					}
					// ALL no-checked must be absent from data
					for (const noItem of filter.no) {
						if (field.indexOf(noItem) !== -1) return false;
					}
				} else {
					// any mode: at least one yes found OR at least one no absent
					if (filter.yes.length === 0 && filter.no.length === 0) continue;
					let match = false;
					for (const yesItem of filter.yes) {
						if (field.indexOf(yesItem) !== -1) { match = true; break; }
					}
					if (!match) {
						for (const noItem of filter.no) {
							if (field.indexOf(noItem) === -1) { match = true; break; }
						}
					}
					if (!match) return false;
				}
				break;
			}
			case 'range': {
				if (!arrayWindow(data, filter.min, filter.max)) {
					if (filter.showUnknown && isEmpty(data)) break;
					return false;
				}
				break;
			}
		}
	}
	return true;
}

/** Build text search index from searchable columns only (respects db.srch flags).
 *  Includes model, brand, and string/array option values so that
 *  searching "Pink" matches flashlights with color=Pink, etc. */
function buildSearchIndex(): void {
	searchIndex = db.data.map((item) => {
		const parts: string[] = [];
		for (let col = 0; col < item.length; col++) {
			if (!db.srch[col]) continue; // only index searchable columns
			const val = item[col];
			if (val === null || val === undefined || val === '') continue;
			if (typeof val === 'string') {
				parts.push(val);
			} else if (Array.isArray(val)) {
				for (const v of val) {
					if (typeof v === 'string' && !v.startsWith('//') && !v.startsWith('~') && !v.startsWith('http')) {
						parts.push(v);
					}
				}
			}
		}
		return parts.join(' ').toLowerCase();
	});
}

/** Fuzzy match — allows 1 character skip/mismatch per 4 chars of pattern.
 *  Returns true if pattern approximately matches anywhere in text. */
function fuzzyMatch(text: string, pattern: string): boolean {
	// Exact substring match — fast path
	if (text.includes(pattern)) return true;
	// Short patterns must match exactly
	if (pattern.length < 3) return false;
	// Allow 1 error per 4 chars
	const maxErrors = Math.floor(pattern.length / 4);
	if (maxErrors === 0) return false;
	// Simple sliding window fuzzy: for each starting position in text,
	// count mismatches against pattern — O(n*m) but pattern is short
	const tLen = text.length;
	const pLen = pattern.length;
	for (let start = 0; start <= tLen - pLen + maxErrors; start++) {
		let errors = 0;
		let ti = start;
		let pi = 0;
		while (pi < pLen && ti < tLen && errors <= maxErrors) {
			if (text[ti] === pattern[pi]) {
				pi++;
			} else {
				errors++;
			}
			ti++;
		}
		if (pi === pLen && errors <= maxErrors) return true;
	}
	return false;
}

/** Apply search query to filter indices.
 *  Splits query into words (AND logic), each word can fuzzy-match. */
function applySearch(indices: number[], query: string): number[] {
	if (!query) return indices;
	const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);
	if (words.length === 0) return indices;
	// Single word — use fuzzy
	if (words.length === 1) {
		return indices.filter((i) => fuzzyMatch(searchIndex[i], words[0]));
	}
	// Multi-word — ALL words must match (AND)
	return indices.filter((i) => {
		const text = searchIndex[i];
		return words.every(w => fuzzyMatch(text, w));
	});
}

// --- Worker message handler ---

self.onmessage = (e: MessageEvent<FilterMessage>) => {
	const msg = e.data;

	if (msg.type === 'init') {
		db = msg.db as FlashlightDB;
		defaultOrder = Array.from({ length: db.data.length }, (_, i) => i);
		buildSearchIndex();
		self.postMessage({ id: msg.id, indices: [], count: db.data.length, timing: 0 } as FilterResult);
		return;
	}

	if (msg.type === 'filter') {
		// Skip stale requests — a newer one is already queued
		if (msg.id < lastFilterId) return;
		lastFilterId = msg.id;

		const start = performance.now();
		const filters = msg.filters ?? {};
		const sort = msg.sort;
		const hasFilters = Object.keys(filters).length > 0;

		// Determine iteration order from sort
		let iterationOrder: number[];
		if (sort && db.sort[sort.column] && db.sort[sort.column] !== false) {
			const sortData = db.sort[sort.column] as { dec: number[]; inc?: number[] };
			if (sort.direction === 'dec') {
				iterationOrder = sortData.dec;
			} else {
				iterationOrder = sortData.inc ?? [...sortData.dec].reverse();
			}
		} else {
			// Default: iterate in data order (pre-built on init)
			iterationOrder = defaultOrder;
		}

		// Filter
		let matchedIndices: number[];
		if (hasFilters) {
			matchedIndices = [];
			for (const idx of iterationOrder) {
				if (testItem(idx, filters, db.opts)) {
					matchedIndices.push(idx);
				}
			}
		} else {
			matchedIndices = [...iterationOrder];
		}

		// Text search
		if (msg.searchQuery) {
			matchedIndices = applySearch(matchedIndices, msg.searchQuery);
		}

		const timing = performance.now() - start;
		self.postMessage({
			id: msg.id,
			indices: matchedIndices,
			count: matchedIndices.length,
			timing
		} as FilterResult);
	}
};
