import { useState, memo, useCallback } from 'react';
import type { ColumnDef } from '$lib/schema/columns';
import { getVisibleOptions, getOptionGroups } from '$lib/schema/columns';
import type { LogicMode, MultiFilter as MultiFilterType } from '$lib/schema/filter-schema';
import { useUrlState } from '$lib/state/url-state';
import LogicModeButton from './LogicModeButton';

interface Props {
	column: ColumnDef;
}

export default memo(function MultiFilter({ column }: Props) {
	const filters = useUrlState((s) => s.filters);
	const setMultiFilter = useUrlState((s) => s.setMultiFilter);
	const clearFilter = useUrlState((s) => s.clearFilter);

	const filter = filters.get(column.index) as MultiFilterType | undefined;
	const selected = filter?.selected ?? new Set<string>();
	const mode = filter?.mode ?? (column.modes[0] as LogicMode);
	const showUnknown = filter?.showUnknown ?? false;

	const [filterSearch, setFilterSearch] = useState('');

	const isMega = column.filterType === 'mega-multi';
	const groups = isMega && column.options ? getOptionGroups(column.options) : null;
	const flatOptions = column.options ? getVisibleOptions(column.options) : [];
	const filteredOptions = filterSearch
		? flatOptions.filter((o) => !o.hidden && o.display.toLowerCase().includes(filterSearch.toLowerCase()))
		: flatOptions.filter((o) => !o.hidden);

	const toggle = useCallback((value: string) => {
		const next = new Set(selected);
		if (next.has(value)) next.delete(value);
		else next.add(value);
		setMultiFilter(column.index, next, mode, showUnknown);
	}, [selected, mode, showUnknown, column.index, setMultiFilter]);

	const changeMode = useCallback((newMode: LogicMode) => {
		setMultiFilter(column.index, selected, newMode, showUnknown);
	}, [selected, showUnknown, column.index, setMultiFilter]);

	const invertAll = useCallback(() => {
		const next = new Set<string>();
		for (const opt of flatOptions) {
			if (opt.hidden) continue;
			if (!selected.has(opt.value)) next.add(opt.value);
		}
		setMultiFilter(column.index, next, mode, showUnknown);
	}, [flatOptions, selected, mode, showUnknown, column.index, setMultiFilter]);

	const toggleShowUnknown = useCallback(() => {
		setMultiFilter(column.index, selected, mode, !showUnknown);
	}, [selected, mode, showUnknown, column.index, setMultiFilter]);

	return (
		<div className="space-y-2">
			{/* Header row: mode + invert + clear */}
			<div className="flex items-center gap-2 flex-wrap">
				<LogicModeButton modes={column.modes} current={mode} onChange={changeMode} />
				<button
					className="px-2 py-0.5 text-xs rounded border cursor-pointer select-none transition-colors"
					style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
					onClick={invertAll}
				>
					invert
				</button>
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
				{selected.size > 0 && (
					<button
						className="px-2 py-0.5 text-xs rounded border cursor-pointer select-none transition-colors"
						style={{ background: 'var(--bg-elevated)', color: 'var(--danger)', borderColor: 'var(--danger)' }}
						onClick={() => clearFilter(column.index)}
					>
						clear ({selected.size})
					</button>
				)}
			</div>

			{/* In-filter search for large option sets */}
			{flatOptions.length > 15 && (
				<input
					type="text"
					placeholder="Search options..."
					className="w-full px-2 py-1 text-xs rounded border outline-none"
					style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
					value={filterSearch}
					onChange={(e) => setFilterSearch(e.target.value)}
				/>
			)}

			{/* Checkbox grid */}
			{isMega && groups && !filterSearch ? (
				/* Grouped layout for mega-multi */
				groups.map((group, gi) => (
					<div
						key={gi}
						className={`flex flex-wrap gap-1 ${gi > 0 ? 'pt-1 border-t' : ''}`}
						style={{ borderColor: 'var(--border)' }}
					>
						{group.map((optValue) => {
							const isHidden = optValue.startsWith('//') || optValue.startsWith('~');
							const displayValue = optValue.replace(/^\/\//, '').replace(/^~/, '');
							if (isHidden) return null;
							return (
								<label
									key={optValue}
									className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs cursor-pointer select-none transition-colors"
									style={{
										background: selected.has(optValue) ? 'var(--accent-muted)' : 'var(--bg-tertiary)',
										color: selected.has(optValue) ? 'var(--accent)' : 'var(--text-secondary)',
										border: `1px solid ${selected.has(optValue) ? 'var(--accent)' : 'var(--border)'}`,
									}}
								>
									<input
										type="checkbox"
										className="sr-only"
										checked={selected.has(optValue)}
										onChange={() => toggle(optValue)}
									/>
									{displayValue}
								</label>
							);
						})}
					</div>
				))
			) : (
				/* Flat layout */
				<div className="flex flex-wrap gap-1">
					{filteredOptions.map((opt) => (
						<label
							key={opt.value}
							className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs cursor-pointer select-none transition-colors"
							style={{
								background: selected.has(opt.value) ? 'var(--accent-muted)' : 'var(--bg-tertiary)',
								color: selected.has(opt.value) ? 'var(--accent)' : 'var(--text-secondary)',
								border: `1px solid ${selected.has(opt.value) ? 'var(--accent)' : 'var(--border)'}`,
							}}
						>
							<input
								type="checkbox"
								className="sr-only"
								checked={selected.has(opt.value)}
								onChange={() => toggle(opt.value)}
							/>
							{opt.display}
						</label>
					))}
				</div>
			)}
		</div>
	);
});
