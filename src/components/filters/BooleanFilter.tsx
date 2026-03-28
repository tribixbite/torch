import { memo, useCallback } from 'react';
import type { ColumnDef } from '$lib/schema/columns';
import type { BooleanFilter as BooleanFilterType } from '$lib/schema/filter-schema';
import { useUrlState } from '$lib/state/url-state';
import LogicModeButton from './LogicModeButton';

interface Props {
	column: ColumnDef;
}

export default memo(function BooleanFilter({ column }: Props) {
	// Granular selector — only re-render when this column's filter changes
	const filter = useUrlState((s) => s.filters.get(column.index)) as BooleanFilterType | undefined;
	const setBooleanFilter = useUrlState((s) => s.setBooleanFilter);
	const yesSet = filter?.yes ?? new Set<string>();
	const noSet = filter?.no ?? new Set<string>();
	const mode = filter?.mode ?? (column.modes[0] as 'all' | 'any');
	const showUnknown = filter?.showUnknown ?? false;

	const visibleOptions = (column.options ?? []).filter((o) => !o.startsWith('~') && o !== '<br>');

	const toggleYes = useCallback((value: string) => {
		const nextYes = new Set(yesSet);
		const nextNo = new Set(noSet);
		if (nextYes.has(value)) {
			nextYes.delete(value);
		} else {
			nextYes.add(value);
			nextNo.delete(value);
		}
		setBooleanFilter(column.index, nextYes, nextNo, mode, showUnknown);
	}, [yesSet, noSet, mode, showUnknown, column.index, setBooleanFilter]);

	const toggleNo = useCallback((value: string) => {
		const nextYes = new Set(yesSet);
		const nextNo = new Set(noSet);
		if (nextNo.has(value)) {
			nextNo.delete(value);
		} else {
			nextNo.add(value);
			nextYes.delete(value);
		}
		setBooleanFilter(column.index, nextYes, nextNo, mode, showUnknown);
	}, [yesSet, noSet, mode, showUnknown, column.index, setBooleanFilter]);

	const changeMode = useCallback((newMode: string) => {
		setBooleanFilter(column.index, yesSet, noSet, newMode as 'all' | 'any', showUnknown);
	}, [yesSet, noSet, showUnknown, column.index, setBooleanFilter]);

	const toggleShowUnknown = useCallback(() => {
		setBooleanFilter(column.index, yesSet, noSet, mode, !showUnknown);
	}, [yesSet, noSet, mode, showUnknown, column.index, setBooleanFilter]);

	return (
		<div className="space-y-1">
			<div className="flex items-center gap-2">
				<LogicModeButton modes={column.modes} current={mode} onChange={changeMode} />
				<button
					className="px-2 py-0.5 text-xs rounded border cursor-pointer select-none transition-colors"
					style={{
						background: showUnknown ? 'var(--accent-muted)' : 'var(--bg-elevated)',
						color: showUnknown ? 'var(--accent)' : 'var(--text-secondary)',
						borderColor: showUnknown ? 'var(--accent)' : 'var(--border)',
					}}
					onClick={toggleShowUnknown}
					title="Include entries with unknown/missing values for this field"
				>
					? unknown
				</button>
			</div>

			<div className="space-y-0.5">
				{visibleOptions.map((opt) => (
					<div key={opt} className="flex items-center gap-2 py-0.5">
						<span className="text-xs min-w-[100px] truncate" style={{ color: 'var(--text-secondary)' }}>{opt}</span>
						<button
							className="px-2 py-0.5 text-xs rounded border cursor-pointer select-none transition-colors"
							style={{
								background: yesSet.has(opt) ? 'var(--success)' : 'var(--bg-tertiary)',
								color: yesSet.has(opt) ? '#fff' : 'var(--text-muted)',
								borderColor: yesSet.has(opt) ? 'var(--success)' : 'var(--border)',
							}}
							onClick={() => toggleYes(opt)}
						>
							yes
						</button>
						<button
							className="px-2 py-0.5 text-xs rounded border cursor-pointer select-none transition-colors"
							style={{
								background: noSet.has(opt) ? 'var(--danger)' : 'var(--bg-tertiary)',
								color: noSet.has(opt) ? '#fff' : 'var(--text-muted)',
								borderColor: noSet.has(opt) ? 'var(--danger)' : 'var(--border)',
							}}
							onClick={() => toggleNo(opt)}
						>
							no
						</button>
					</div>
				))}
			</div>
		</div>
	);
});
