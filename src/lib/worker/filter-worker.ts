/**
 * Web Worker for all filter/sort/search operations.
 * Runs entirely off the main thread. Receives full dataset on init,
 * then filter messages with serialized filter state.
 */

import type { FlashlightDB } from '../schema/columns.js';
import type { FilterMessage, FilterResult, SerializedFilter, SerializedFilters, SortState } from '../schema/filter-schema.js';

let db: FlashlightDB;
let searchIndex: string[]; // lowercase model+brand for text search

// --- Set operations (exact ports from parametrek.js) ---

/** Returns true if sets intersect (any) */
function arrayIntersect(selected: string[], data: unknown): boolean {
	const ar2 = normalizeToStringArray(data);
	if (selected.length === 0 || ar2.length === 0) return false;
	const b = selected.concat(ar2);
	b.sort();
	for (let i = 1; i < b.length; i++) {
		if (b[i - 1] === b[i]) return true;
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
				if (!fn(filter.selected, data)) return false;
				break;
			}
			case 'boolean': {
				if (filter.mode === 'all') {
					const field = normalizeToStringArray(data);
					// All no-checked: if item found then hide (unless ~item found)
					for (const noItem of filter.no) {
						if (field.indexOf(noItem) !== -1) {
							if (field.indexOf('~' + noItem) !== -1) continue;
							return false;
						}
					}
					// All yes-checked: if item not found then hide
					for (const yesItem of filter.yes) {
						if (field.indexOf(yesItem) === -1) return false;
					}
				} else {
					// any mode
					if (filter.yes.length === 0 && filter.no.length === 0) continue;
					const field = normalizeToStringArray(data);
					let anyFound = false;
					for (const noItem of filter.no) {
						if (field.indexOf(noItem) === -1) { anyFound = true; break; }
						if (field.indexOf('~' + noItem) !== -1) { anyFound = true; break; }
					}
					if (!anyFound) {
						for (const yesItem of filter.yes) {
							if (field.indexOf(yesItem) !== -1) { anyFound = true; break; }
						}
					}
					if (!anyFound) return false;
				}
				break;
			}
			case 'range': {
				if (!arrayWindow(data, filter.min, filter.max)) return false;
				break;
			}
		}
	}
	return true;
}

/** Build text search index from all searchable columns.
 *  Includes model, brand, and all string/array option values so that
 *  searching "Pink" matches flashlights with color=Pink, etc. */
function buildSearchIndex(): void {
	searchIndex = db.data.map((item) => {
		const parts: string[] = [];
		for (let col = 0; col < item.length; col++) {
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
			// Skip numeric-only values — not useful for text search
		}
		return parts.join(' ').toLowerCase();
	});
}

/** Apply search query to filter indices */
function applySearch(indices: number[], query: string): number[] {
	if (!query) return indices;
	const q = query.toLowerCase();
	return indices.filter((i) => searchIndex[i].includes(q));
}

// --- Worker message handler ---

self.onmessage = (e: MessageEvent<FilterMessage>) => {
	const msg = e.data;

	if (msg.type === 'init') {
		db = msg.db as FlashlightDB;
		buildSearchIndex();
		self.postMessage({ id: msg.id, indices: [], count: db.data.length, timing: 0 } as FilterResult);
		return;
	}

	if (msg.type === 'filter') {
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
			// Default: iterate in data order
			iterationOrder = Array.from({ length: db.data.length }, (_, i) => i);
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
