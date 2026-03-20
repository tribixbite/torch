/**
 * URL search parameter codec — Parametrek-compatible format.
 * Bidirectional: parse URL → filters, serialize filters → URL.
 */

import type { ColumnDef } from './columns.js';
import type { ActiveFilter, BooleanFilter, MultiFilter, RangeFilter, SortState, LogicMode } from './filter-schema.js';
import { parseFloat2, smartFixed } from './si-prefix.js';

/** Parse URL search params into active filters + sort state */
export function deserializeUrl(
	params: URLSearchParams,
	columns: ColumnDef[]
): { filters: Map<number, ActiveFilter>; sort: SortState } {
	const filters = new Map<number, ActiveFilter>();
	// Default sort: no sort (data order)
	let sort: SortState = { column: -1, direction: 'inc' };

	for (const col of columns) {
		if (col.filterType === null || col.filterType === 'multiple') continue;

		const raw = params.get(col.id);
		if (!raw) continue;

		const parts = raw.split(',').map(decodeURIComponent);

		// Detect and strip "?" show-unknown marker
		const showUnknownIdx = parts.indexOf('?');
		const showUnknown = showUnknownIdx !== -1;
		if (showUnknown) parts.splice(showUnknownIdx, 1);

		switch (col.filterType) {
			case 'multi':
			case 'mega-multi': {
				const filter: MultiFilter = { type: 'multi', selected: new Set(), mode: col.modes[0] as LogicMode, showUnknown };
				// Check for embedded sort as last element
				const lastPart = parts[parts.length - 1];
				if (lastPart === 'inc' || lastPart === 'dec') {
					sort = { column: col.index, direction: lastPart };
					parts.pop();
				}
				for (const part of parts) {
					if (['any', 'all', 'only', 'none'].includes(part)) {
						filter.mode = part as LogicMode;
					} else if (part !== '' && part !== '_') {
						filter.selected.add(part);
					}
				}
				if (filter.selected.size > 0) {
					filters.set(col.index, filter);
				}
				break;
			}
			case 'boolean': {
				const filter: BooleanFilter = {
					type: 'boolean',
					yes: new Set(),
					no: new Set(),
					mode: col.modes[0] as 'all' | 'any',
					showUnknown
				};
				for (const part of parts) {
					if (['any', 'all'].includes(part)) {
						filter.mode = part as 'all' | 'any';
					} else if (part.startsWith('~')) {
						filter.no.add(part.slice(1));
					} else if (part !== '' && part !== '_') {
						filter.yes.add(part);
					}
				}
				if (filter.yes.size > 0 || filter.no.size > 0) {
					filters.set(col.index, filter);
				}
				break;
			}
			case 'range':
			case 'log-range': {
				const min = col.min!;
				const max = col.max!;
				const lower = parts[0] === '_' || parts[0] === undefined ? min : parseFloat2(parts[0]);
				const upper = parts[1] === '_' || parts[1] === undefined ? max : parseFloat2(parts[1]);
				const minActive = parts[0] !== '_' && parts[0] !== undefined;
				const maxActive = parts[1] !== '_' && parts[1] !== undefined;

				if (minActive || maxActive) {
					const filter: RangeFilter = {
						type: 'range',
						min: lower,
						max: upper,
						minActive,
						maxActive,
						showUnknown
					};
					filters.set(col.index, filter);
				}

				// Sort direction embedded as 3rd element
				if (parts[2] && (parts[2] === 'inc' || parts[2] === 'dec')) {
					sort = { column: col.index, direction: parts[2] };
				}
				break;
			}
		}
	}

	return { filters, sort };
}

/** Serialize filters + sort state into URL search params string */
export function serializeUrl(
	filters: Map<number, ActiveFilter>,
	sort: SortState,
	columns: ColumnDef[]
): string {
	const parts: string[] = [];
	const defaultSort = sort.column === columns.length - 1 && sort.direction === 'inc';

	for (const col of columns) {
		if (col.filterType === null || col.filterType === 'multiple') continue;

		const filter = filters.get(col.index);
		const isSortCol = sort.column === col.index;

		switch (col.filterType) {
			case 'multi':
			case 'mega-multi': {
				const f = filter as MultiFilter | undefined;
				if (!f && isSortCol && !defaultSort) {
					parts.push(`${col.id}=_,_,${sort.direction}`);
					continue;
				}
				if (!f || f.selected.size === 0) continue;

				const encoded = [...f.selected].map(encodeURIComponent);
				const isDefaultMode = f.mode === col.modes[0];
				if (!isDefaultMode) {
					encoded.unshift(encodeURIComponent(f.mode));
				}
				// Embed sort direction as last element when sorting by this column
				if (isSortCol && !defaultSort) {
					encoded.push(sort.direction);
				}
				if (f.showUnknown) encoded.push('?');
				parts.push(`${col.id}=${encoded.join(',')}`);
				break;
			}
			case 'boolean': {
				const f = filter as BooleanFilter | undefined;
				if (!f || (f.yes.size === 0 && f.no.size === 0)) continue;

				let val = `${col.id}=`;
				const isDefaultMode = f.mode === col.modes[0];
				if (!isDefaultMode) {
					val += encodeURIComponent(f.mode) + ',';
				}
				if (f.yes.size > 0) {
					val += [...f.yes].map(encodeURIComponent).join(',');
				}
				if (f.yes.size > 0 && f.no.size > 0) {
					val += ',';
				}
				if (f.no.size > 0) {
					val += [...f.no].map((v) => '~' + encodeURIComponent(v)).join(',');
				}
				if (f.showUnknown) val += ',?';
				parts.push(val);
				break;
			}
			case 'range':
			case 'log-range': {
				const f = filter as RangeFilter | undefined;
				let lower = '_';
				let upper = '_';

				if (f) {
					const lowerStr = smartFixed(f.min, col.decimals === null ? 0 : col.decimals);
					const upperStr = smartFixed(f.max, col.decimals === null ? 0 : col.decimals);
					const lowerEdge = col.decimals !== null && col.decimals.toString() === '{si}'
						? smartFixed(col.min!, '{si}')
						: (col.min!).toFixed();
					const upperEdge = col.decimals !== null && col.decimals.toString() === '{si}'
						? smartFixed(col.max!, '{si}')
						: (col.max!).toFixed();

					if (lowerStr !== lowerEdge) lower = lowerStr;
					if (upperStr !== upperEdge) upper = upperStr;
				}

				if (lower === '_' && upper === '_' && (!isSortCol || defaultSort)) continue;

				let val = `${col.id}=${lower},${upper}`;
				if (isSortCol && !defaultSort) {
					val += ',' + sort.direction;
				}
				if (f?.showUnknown) val += ',?';
				parts.push(val);
				break;
			}
		}
	}

	return parts.length > 0 ? '?' + parts.join('&') : '';
}
