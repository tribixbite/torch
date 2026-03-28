import { useMemo, memo } from 'react';
import type { ColumnDef } from '$lib/schema/columns';
import type { MultiFilter, BooleanFilter, RangeFilter } from '$lib/schema/filter-schema';
import { useUrlState } from '$lib/state/url-state';
import { smartFixed } from '$lib/schema/si-prefix';

interface PillInfo {
	colIndex: number;
	label: string;
	detail: string;
}

interface Props {
	columns: ColumnDef[];
}

export default memo(function FilterPills({ columns }: Props) {
	const filters = useUrlState((s) => s.filters);
	const clearFilter = useUrlState((s) => s.clearFilter);
	const clearAll = useUrlState((s) => s.clearAll);

	const pills = useMemo(() => {
		const result: PillInfo[] = [];
		for (const [colIdx, filter] of filters) {
			const col = columns[colIdx];
			if (!col) continue;
			const label = col.display.replace(/&nbsp;/g, ' ');

			switch (filter.type) {
				case 'multi': {
					const f = filter as MultiFilter;
					const count = f.selected.size;
					const detail = count <= 3 ? [...f.selected].join(', ') : `${count} selected`;
					result.push({ colIndex: colIdx, label, detail: `${f.mode}: ${detail}` });
					break;
				}
				case 'boolean': {
					const f = filter as BooleanFilter;
					const parts: string[] = [];
					if (f.yes.size > 0) parts.push('with: ' + [...f.yes].join(', '));
					if (f.no.size > 0) parts.push('without: ' + [...f.no].join(', '));
					result.push({ colIndex: colIdx, label, detail: parts.join('; ') });
					break;
				}
				case 'range': {
					const f = filter as RangeFilter;
					const decimals = col.decimals ?? 0;
					const lo = smartFixed(f.min, decimals);
					const hi = smartFixed(f.max, decimals);
					result.push({ colIndex: colIdx, label, detail: `${lo} – ${hi}` });
					break;
				}
			}
		}
		return result;
	}, [filters, columns]);

	if (pills.length === 0) return null;

	return (
		<div className="flex flex-wrap gap-1.5 px-3 py-2" style={{ background: 'var(--bg-secondary)' }}>
			{pills.map((pill) => (
				<span key={pill.colIndex} className="filter-pill">
					<strong>{pill.label}:</strong>
					<span className="truncate max-w-[200px]">{pill.detail}</span>
					<button onClick={() => clearFilter(pill.colIndex)} title="Remove filter">×</button>
				</span>
			))}
			{pills.length > 1 && (
				<button
					className="text-xs px-2 py-0.5 rounded cursor-pointer select-none"
					style={{ color: 'var(--danger)' }}
					onClick={clearAll}
				>
					Clear all
				</button>
			)}
		</div>
	);
});
