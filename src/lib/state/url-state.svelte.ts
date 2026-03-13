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
	sort = $state<SortState>({ column: 35, direction: 'inc' });
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
		const { filters, sort } = deserializeUrl(url.searchParams, columns);
		this.filters = filters;
		this.sort = sort;

		// Listen for popstate (back/forward navigation)
		window.addEventListener('popstate', () => {
			const url = new URL(window.location.href);
			const { filters, sort } = deserializeUrl(url.searchParams, columns);
			this.filters = filters;
			this.sort = sort;
		});
	}

	/** Push filter state to URL (replaceState, no navigation) */
	syncToUrl() {
		const urlStr = serializeUrl(this.filters, this.sort, this.columns);
		const newUrl = window.location.pathname + urlStr;
		replaceState(newUrl, {});
	}

	/** Set a multi/mega-multi filter */
	setMultiFilter(colIndex: number, selected: Set<string>, mode: LogicMode) {
		if (selected.size === 0) {
			this.filters.delete(colIndex);
		} else {
			this.filters.set(colIndex, { type: 'multi', selected, mode });
		}
		this.filters = new Map(this.filters); // trigger reactivity
		this.syncToUrl();
	}

	/** Set a boolean filter */
	setBooleanFilter(colIndex: number, yes: Set<string>, no: Set<string>, mode: 'all' | 'any') {
		if (yes.size === 0 && no.size === 0) {
			this.filters.delete(colIndex);
		} else {
			this.filters.set(colIndex, { type: 'boolean', yes, no, mode });
		}
		this.filters = new Map(this.filters);
		this.syncToUrl();
	}

	/** Set a range filter */
	setRangeFilter(colIndex: number, min: number, max: number, minActive: boolean, maxActive: boolean) {
		if (!minActive && !maxActive) {
			this.filters.delete(colIndex);
		} else {
			this.filters.set(colIndex, { type: 'range', min, max, minActive, maxActive });
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
		this.sort = { column: this.columns.length - 1, direction: 'inc' };
		this.searchQuery = '';
		this.syncToUrl();
	}

	/** Check if any filters are active */
	get hasActiveFilters(): boolean {
		return this.filters.size > 0;
	}
}

export const urlState = new UrlState();
