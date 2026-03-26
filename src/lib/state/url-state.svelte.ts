/**
 * Bidirectional URL ↔ $state sync.
 * URL search params are the single source of truth.
 */

import { replaceState } from '$app/navigation';
import type { ColumnDef } from '../schema/columns.js';
import type { ActiveFilter, SortState, LogicMode } from '../schema/filter-schema.js';
import { deserializeUrl, serializeUrl } from '../schema/url-codec.js';

/** Global app state — synced with URL search params */
class UrlState {
	filters = $state<Map<number, ActiveFilter>>(new Map());
	sort = $state<SortState>({ column: -1, direction: 'inc' });
	searchQuery = $state('');
	columns: ColumnDef[] = [];
	private initialized = false;

	/** Initialize from URL on first load */
	init(columns: ColumnDef[]) {
		this.columns = columns;
		if (this.initialized) return;
		this.initialized = true;

		// Parse current URL
		const url = new URL(window.location.href);
		const hasUrlParams = url.searchParams.toString().length > 0;
		const { filters, sort } = deserializeUrl(url.searchParams, columns);
		this.filters = filters;
		this.sort = sort;

		// Apply default quality filters on fresh visit (no URL params)
		if (!hasUrlParams && filters.size === 0) {
			this.applyDefaults(columns);
		}

		// Listen for popstate (back/forward navigation)
		window.addEventListener('popstate', () => {
			const url = new URL(window.location.href);
			const { filters, sort } = deserializeUrl(url.searchParams, columns);
			this.filters = filters;
			this.sort = sort;
		});
	}

	/** Apply default quality filters — hides low-completeness entries, accessories, blogs, and no-name brands */
	private applyDefaults(columns: ColumnDef[]) {
		// Find column indices by id
		const completenessCol = columns.find(c => c.id === 'completeness');
		const typeCol = columns.find(c => c.id === 'type');
		const mfgCol = columns.find(c => c.id === 'has_mfg_url');

		// Completeness >= 8 (hide entries missing more than 8/16 core attributes)
		if (completenessCol && completenessCol.filterType === 'range') {
			this.filters.set(completenessCol.index, {
				type: 'range',
				min: 8,
				max: completenessCol.max!,
				minActive: true,
				maxActive: false,
			});
		}

		// Exclude accessories and blogs by default
		if (typeCol) {
			this.filters.set(typeCol.index, {
				type: 'multi',
				selected: new Set(['accessory', 'blog']),
				mode: 'none' as LogicMode,
			});
		}

		// Note: has_mfg_url filter available but not default — completeness >= 8 already filters most junk
		// Users can enable the mfg site filter manually to further narrow results

		this.filters = new Map(this.filters); // trigger reactivity
		this.syncToUrl();
	}

	/** Push filter state to URL (replaceState, no navigation) */
	syncToUrl() {
		const urlStr = serializeUrl(this.filters, this.sort, this.columns);
		const newUrl = window.location.pathname + urlStr;
		replaceState(newUrl, {});
	}

	/** Set a multi/mega-multi filter */
	setMultiFilter(colIndex: number, selected: Set<string>, mode: LogicMode, showUnknown = false) {
		if (selected.size === 0) {
			this.filters.delete(colIndex);
		} else {
			this.filters.set(colIndex, { type: 'multi', selected, mode, showUnknown });
		}
		this.filters = new Map(this.filters); // trigger reactivity
		this.syncToUrl();
	}

	/** Set a boolean filter */
	setBooleanFilter(colIndex: number, yes: Set<string>, no: Set<string>, mode: 'all' | 'any', showUnknown = false) {
		if (yes.size === 0 && no.size === 0) {
			this.filters.delete(colIndex);
		} else {
			this.filters.set(colIndex, { type: 'boolean', yes, no, mode, showUnknown });
		}
		this.filters = new Map(this.filters);
		this.syncToUrl();
	}

	/** Set a range filter */
	setRangeFilter(colIndex: number, min: number, max: number, minActive: boolean, maxActive: boolean, showUnknown = false) {
		if (!minActive && !maxActive) {
			this.filters.delete(colIndex);
		} else {
			this.filters.set(colIndex, { type: 'range', min, max, minActive, maxActive, showUnknown });
		}
		this.filters = new Map(this.filters);
		this.syncToUrl();
	}

	/** Set sort state */
	setSort(column: number, direction: 'inc' | 'dec') {
		this.sort = { column, direction };
		this.syncToUrl();
	}

	/** Clear a specific filter */
	clearFilter(colIndex: number) {
		this.filters.delete(colIndex);
		this.filters = new Map(this.filters);
		this.syncToUrl();
	}

	/** Clear all filters */
	clearAll() {
		this.filters = new Map();
		this.sort = { column: -1, direction: 'inc' };
		this.searchQuery = '';
		this.syncToUrl();
	}

	/** Check if any filters are active */
	get hasActiveFilters(): boolean {
		return this.filters.size > 0;
	}
}

export const urlState = new UrlState();
