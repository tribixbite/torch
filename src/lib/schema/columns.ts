/**
 * Type definitions and column schema extraction from the raw parametrek JSON.
 * Mirrors the structure of flashlights.now.json exactly.
 */

// --- Raw JSON shape ---

export type FilterType = 'multi' | 'mega-multi' | 'boolean' | 'range' | 'log-range' | 'multiple';

/** Raw opts entry: null for non-filterable, or [type, ...args] */
export type RawOpts =
	| null
	| [type: 'multi', options: string[]]
	| [type: 'mega-multi', options: string[]]
	| [type: 'boolean', options: string[]]
	| [type: 'range', min: number, max: number, decimals?: number]
	| [type: 'log-range', min: number, max: number, decimals?: number]
	| [type: 'multiple', subColumns: number[]];

export type SortEntry = false | { dec: number[]; inc?: number[] };

export interface FlashlightDB {
	head: string[];
	disp: string[];
	opts: RawOpts[];
	mode: string[][];
	unit: string[];
	sort: SortEntry[];
	srch: boolean[];
	cvis: string[];
	link: string[];
	data: unknown[][];
	sprite: string;
	help?: (string | null)[];
	note?: (string | null)[];
	sprite_x?: number;
	sprite_y?: number;
}

// --- Processed column definitions ---

export interface ColumnDef {
	index: number;
	id: string;
	display: string;
	filterType: FilterType | null;
	options: string[] | null; // for multi/mega-multi/boolean
	subColumns: number[] | null; // for 'multiple' type
	min: number | null; // for range/log-range
	max: number | null;
	decimals: number | null;
	modes: string[];
	unit: string;
	sortable: boolean;
	sortData: SortEntry;
	searchable: boolean;
	cvis: string; // 'always', 'never', or ''
	link: string; // linked column group id
	help: string | null;
	note: string | null;
}

/** Build typed ColumnDef array from raw DB */
export function buildColumns(db: FlashlightDB): ColumnDef[] {
	return db.head.map((id, i) => {
		const raw = db.opts[i];
		let filterType: FilterType | null = null;
		let options: string[] | null = null;
		let subColumns: number[] | null = null;
		let min: number | null = null;
		let max: number | null = null;
		let decimals: number | null = null;

		if (raw !== null) {
			filterType = raw[0];
			switch (raw[0]) {
				case 'multi':
				case 'mega-multi':
				case 'boolean':
					options = raw[1] as string[];
					break;
				case 'range':
				case 'log-range':
					min = raw[1] as number;
					max = raw[2] as number;
					decimals = (raw as unknown[])[3] as number ?? 0;
					break;
				case 'multiple':
					subColumns = raw[1] as number[];
					break;
			}
		}

		// Sort data — inc arrays are derived lazily in the worker via
		// `sortData.inc ?? [...sortData.dec].reverse()`, so no need to
		// pre-compute them here (saves ~14k * 18 array reversals on init)
		const sortData: SortEntry = db.sort[i];

		return {
			index: i,
			id,
			display: db.disp[i],
			filterType,
			options,
			subColumns,
			min,
			max,
			decimals,
			modes: db.mode[i],
			unit: db.unit[i],
			sortable: db.sort[i] !== false,
			sortData,
			searchable: db.srch[i],
			cvis: db.cvis[i],
			link: db.link[i],
			help: db.help?.[i] ?? null,
			note: db.note?.[i] ?? null
		};
	});
}

/** Get visible filter options (strip // prefix, exclude <br> markers) */
export function getVisibleOptions(options: string[]): { value: string; display: string; hidden: boolean }[] {
	return options
		.filter((o) => o !== '<br>')
		.map((o) => {
			const hidden = o.startsWith('//');
			const isTilde = o.startsWith('~');
			const display = hidden ? o.slice(2) : isTilde ? o.slice(1) : o;
			return { value: o, display, hidden: hidden || isTilde };
		});
}

/** Get option groups from mega-multi (split by <br>) */
export function getOptionGroups(options: string[]): string[][] {
	const groups: string[][] = [[]];
	for (const o of options) {
		if (o === '<br>') {
			groups.push([]);
		} else {
			groups[groups.length - 1].push(o);
		}
	}
	return groups.filter((g) => g.length > 0);
}
