/**
 * URL state store — filters, sort, search query synced with URL search params.
 * URL search params are the single source of truth.
 */
import { create } from 'zustand';
import type { ColumnDef } from '../schema/columns.js';
import type { ActiveFilter, SortState, LogicMode } from '../schema/filter-schema.js';
import { deserializeUrl, serializeUrl } from '../schema/url-codec.js';

interface UrlStateStore {
	filters: Map<number, ActiveFilter>;
	sort: SortState;
	searchQuery: string;
	/** Stable reference to columns — set once on init */
	columns: ColumnDef[];
	initialized: boolean;

	init: (columns: ColumnDef[]) => void;
	setSearchQuery: (query: string) => void;
	setMultiFilter: (colIndex: number, selected: Set<string>, mode: LogicMode, showUnknown?: boolean) => void;
	setBooleanFilter: (colIndex: number, yes: Set<string>, no: Set<string>, mode: 'all' | 'any', showUnknown?: boolean) => void;
	setRangeFilter: (colIndex: number, min: number, max: number, minActive: boolean, maxActive: boolean, showUnknown?: boolean) => void;
	setSort: (column: number, direction: 'inc' | 'dec') => void;
	clearFilter: (colIndex: number) => void;
	clearAll: () => void;
}

/** Push current state to URL (replaceState, no navigation) */
function syncToUrl(filters: Map<number, ActiveFilter>, sort: SortState, columns: ColumnDef[]): void {
	const urlStr = serializeUrl(filters, sort, columns);
	const newUrl = window.location.pathname + urlStr;
	window.history.replaceState(null, '', newUrl);
}

export const useUrlState = create<UrlStateStore>()((set, get) => ({
	filters: new Map(),
	sort: { column: -1, direction: 'inc' },
	searchQuery: '',
	columns: [],
	initialized: false,

	init: (columns) => {
		if (get().initialized) return;

		const url = new URL(window.location.href);
		const hasUrlParams = url.searchParams.toString().length > 0;
		const { filters, sort } = deserializeUrl(url.searchParams, columns);

		// Apply default quality filters on fresh visit (no URL params)
		if (!hasUrlParams && filters.size === 0) {
			applyDefaults(filters, columns);
		}

		set({ filters, sort, columns, initialized: true });
		syncToUrl(filters, sort, columns);

		// Listen for popstate (back/forward navigation)
		window.addEventListener('popstate', () => {
			const url = new URL(window.location.href);
			const { filters, sort } = deserializeUrl(url.searchParams, get().columns);
			set({ filters, sort });
		});
	},

	setSearchQuery: (query) => set({ searchQuery: query }),

	setMultiFilter: (colIndex, selected, mode, showUnknown = false) => {
		const filters = new Map(get().filters);
		if (selected.size === 0) {
			filters.delete(colIndex);
		} else {
			filters.set(colIndex, { type: 'multi', selected, mode, showUnknown });
		}
		const sort = get().sort;
		set({ filters });
		syncToUrl(filters, sort, get().columns);
	},

	setBooleanFilter: (colIndex, yes, no, mode, showUnknown = false) => {
		const filters = new Map(get().filters);
		if (yes.size === 0 && no.size === 0) {
			filters.delete(colIndex);
		} else {
			filters.set(colIndex, { type: 'boolean', yes, no, mode, showUnknown });
		}
		const sort = get().sort;
		set({ filters });
		syncToUrl(filters, sort, get().columns);
	},

	setRangeFilter: (colIndex, min, max, minActive, maxActive, showUnknown = false) => {
		const filters = new Map(get().filters);
		if (!minActive && !maxActive) {
			filters.delete(colIndex);
		} else {
			filters.set(colIndex, { type: 'range', min, max, minActive, maxActive, showUnknown });
		}
		const sort = get().sort;
		set({ filters });
		syncToUrl(filters, sort, get().columns);
	},

	setSort: (column, direction) => {
		const sort = { column, direction };
		set({ sort });
		syncToUrl(get().filters, sort, get().columns);
	},

	clearFilter: (colIndex) => {
		const filters = new Map(get().filters);
		filters.delete(colIndex);
		const sort = get().sort;
		set({ filters });
		syncToUrl(filters, sort, get().columns);
	},

	clearAll: () => {
		const filters = new Map<number, ActiveFilter>();
		const sort: SortState = { column: -1, direction: 'inc' };
		set({ filters, sort, searchQuery: '' });
		syncToUrl(filters, sort, get().columns);
	},
}));

/** Apply default quality filters — hides low-completeness entries, accessories, blogs */
function applyDefaults(filters: Map<number, ActiveFilter>, columns: ColumnDef[]): void {
	const completenessCol = columns.find(c => c.id === 'completeness');
	const typeCol = columns.find(c => c.id === 'type');

	// Completeness >= 8
	if (completenessCol && completenessCol.filterType === 'range') {
		filters.set(completenessCol.index, {
			type: 'range',
			min: 8,
			max: completenessCol.max!,
			minActive: true,
			maxActive: false,
		});
	}

	// Exclude accessories and blogs by default
	if (typeCol) {
		filters.set(typeCol.index, {
			type: 'multi',
			selected: new Set(['accessory', 'blog']),
			mode: 'none' as LogicMode,
		});
	}
}
