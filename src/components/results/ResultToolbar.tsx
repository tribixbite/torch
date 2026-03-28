import { useMemo, memo, useCallback } from 'react';
import type { ColumnDef } from '$lib/schema/columns';
import { useUrlState } from '$lib/state/url-state';
import { usePreferences } from '$lib/state/preferences';
import { useStarred } from '$lib/state/starred';

interface Props {
	columns: ColumnDef[];
	count: number;
	timing: number;
}

export default memo(function ResultToolbar({ columns, count, timing }: Props) {
	const sort = useUrlState((s) => s.sort);
	const setSort = useUrlState((s) => s.setSort);
	const viewMode = usePreferences((s) => s.viewMode);
	const setViewMode = usePreferences((s) => s.setViewMode);
	const starred = useStarred((s) => s.starred);
	const showStarredOnly = useStarred((s) => s.showStarredOnly);
	const setShowStarredOnly = useStarred((s) => s.setShowStarredOnly);

	const sortableColumns = useMemo(() => columns.filter((c) => c.sortable), [columns]);

	const cleanDisplay = useCallback((html: string): string => {
		return html.replace(/&nbsp;/g, ' ').replace(/<[^>]*>/g, '');
	}, []);

	const handleSortChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
		const [colIdx, dir] = e.target.value.split(':');
		setSort(parseInt(colIdx, 10), dir as 'inc' | 'dec');
	}, [setSort]);

	const toggleView = useCallback(() => {
		setViewMode(viewMode === 'card' ? 'table' : 'card');
	}, [viewMode, setViewMode]);

	return (
		<div
			className="flex items-center gap-3 px-3 py-2 flex-wrap"
			style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}
		>
			{/* Result count */}
			<span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
				{count} match{count !== 1 ? 'es' : ''}
			</span>
			<span className="text-xs" style={{ color: 'var(--text-muted)' }}>
				{timing.toFixed(0)}ms
			</span>

			{/* Spacer */}
			<div className="flex-1" />

			{/* Starred toggle */}
			<button
				className="text-sm cursor-pointer select-none px-2 py-0.5 rounded border transition-colors"
				style={{
					background: showStarredOnly ? 'var(--star)' : 'var(--bg-tertiary)',
					color: showStarredOnly ? 'var(--bg-primary)' : 'var(--text-secondary)',
					borderColor: showStarredOnly ? 'var(--star)' : 'var(--border)',
				}}
				onClick={() => setShowStarredOnly(!showStarredOnly)}
				title="Show starred only"
			>
				★ {starred.size}
			</button>

			{/* Sort dropdown */}
			<select
				className="text-xs px-2 py-1 rounded border outline-none cursor-pointer"
				style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
				value={`${sort.column}:${sort.direction}`}
				onChange={handleSortChange}
			>
				{sortableColumns.map((col) => (
					<optgroup key={col.index} label={cleanDisplay(col.display)}>
						<option value={`${col.index}:inc`}>{cleanDisplay(col.display)} ▲</option>
						<option value={`${col.index}:dec`}>{cleanDisplay(col.display)} ▼</option>
					</optgroup>
				))}
			</select>

			{/* View toggle */}
			<button
				className="text-sm cursor-pointer select-none px-2 py-0.5 rounded border"
				style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
				onClick={toggleView}
				title="Toggle view mode"
			>
				{viewMode === 'card' ? '▦' : '▤'}
			</button>
		</div>
	);
});
