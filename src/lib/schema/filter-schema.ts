/**
 * Filter state type definitions.
 */

export type LogicMode = 'any' | 'all' | 'only' | 'none';

/** Active filter state for a multi/mega-multi column */
export interface MultiFilter {
	type: 'multi';
	selected: Set<string>;
	mode: LogicMode;
	showUnknown?: boolean;
}

/** Active filter state for a boolean column */
export interface BooleanFilter {
	type: 'boolean';
	yes: Set<string>; // items that must be present
	no: Set<string>; // items that must be absent
	mode: 'all' | 'any';
	showUnknown?: boolean;
}

/** Active filter state for a range/log-range column */
export interface RangeFilter {
	type: 'range';
	min: number;
	max: number;
	/** Whether the min was explicitly set (not default) */
	minActive: boolean;
	/** Whether the max was explicitly set (not default) */
	maxActive: boolean;
	showUnknown?: boolean;
}

export type ActiveFilter = MultiFilter | BooleanFilter | RangeFilter;

export interface SortState {
	column: number;
	direction: 'inc' | 'dec';
}

/** Message sent to the filter worker */
export interface FilterMessage {
	type: 'init' | 'filter';
	id: number;
	db?: unknown; // FlashlightDB on init
	filters?: SerializedFilters;
	sort?: SortState;
	searchQuery?: string;
}

/** Serializable version of filters for worker communication */
export interface SerializedFilters {
	[columnIndex: number]: SerializedFilter;
}

export type SerializedFilter =
	| { type: 'multi'; selected: string[]; mode: LogicMode; showUnknown?: boolean }
	| { type: 'boolean'; yes: string[]; no: string[]; mode: 'all' | 'any'; showUnknown?: boolean }
	| { type: 'range'; min: number; max: number; showUnknown?: boolean };

/** Result from the filter worker */
export interface FilterResult {
	id: number;
	indices: number[];
	count: number;
	timing: number;
}

/** Serialize active filters for worker transport */
export function serializeFilters(filters: Map<number, ActiveFilter>): SerializedFilters {
	const result: SerializedFilters = {};
	for (const [col, filter] of filters) {
		switch (filter.type) {
			case 'multi':
				if (filter.selected.size > 0) {
					result[col] = { type: 'multi', selected: [...filter.selected], mode: filter.mode, showUnknown: filter.showUnknown };
				}
				break;
			case 'boolean':
				if (filter.yes.size > 0 || filter.no.size > 0) {
					result[col] = { type: 'boolean', yes: [...filter.yes], no: [...filter.no], mode: filter.mode, showUnknown: filter.showUnknown };
				}
				break;
			case 'range':
				if (filter.minActive || filter.maxActive) {
					result[col] = { type: 'range', min: filter.min, max: filter.max, showUnknown: filter.showUnknown };
				}
				break;
		}
	}
	return result;
}
