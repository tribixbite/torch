import { useState, useMemo, useCallback, memo } from 'react';
import type { ColumnDef } from '$lib/schema/columns';
import { useUrlState } from '$lib/state/url-state';
import { usePreferences } from '$lib/state/preferences';
import FilterGroup from './FilterGroup';
import FilterSearch from './FilterSearch';

interface Props {
	columns: ColumnDef[];
}

/** Columns hidden from filter sidebar — internal duplicates + no usable data */
const HIDDEN_FILTER_IDS = new Set(['trueled', '_pic', '_bat', '_reviews', 'wh', 'efficacy', 'beam_angle', 'year']);

export default memo(function FilterSidebar({ columns }: Props) {
	// Granular selector — stable string of active filter column indices for button highlighting
	const activeFilterKeys = useUrlState((s) => [...s.filters.keys()].join(','));
	const activeFilterSet = useMemo(() => new Set(activeFilterKeys ? activeFilterKeys.split(',').map(Number) : []), [activeFilterKeys]);
	const sidebarOpen = usePreferences((s) => s.sidebarOpen);
	const setSidebarOpen = usePreferences((s) => s.setSidebarOpen);

	const [openSections, setOpenSections] = useState<Set<number>>(new Set());

	// Compute filterable columns — exclude sub-columns rendered inside composite parents
	const filterableColumns = useMemo(() => {
		const compositeSubCols = new Set(
			columns.filter((c) => c.filterType === 'multiple' && c.subColumns).flatMap((c) => c.subColumns!)
		);
		return columns.filter(
			(c) => c.filterType !== null && !HIDDEN_FILTER_IDS.has(c.id) && !compositeSubCols.has(c.index)
		);
	}, [columns]);

	const toggleSection = useCallback((colIndex: number) => {
		setOpenSections((prev) => {
			const next = new Set(prev);
			if (next.has(colIndex)) next.delete(colIndex);
			else next.add(colIndex);
			return next;
		});
	}, []);

	const scrollToFilter = useCallback((colIndex: number) => {
		setOpenSections((prev) => {
			const next = new Set(prev);
			next.add(colIndex);
			return next;
		});
		// Wait for DOM update then scroll
		requestAnimationFrame(() => {
			const el = document.getElementById(`filter-${colIndex}`);
			el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		});
	}, []);

	const closeMobile = useCallback(() => {
		if (window.innerWidth < 768) {
			setSidebarOpen(false);
		}
	}, [setSidebarOpen]);

	return (
		<>
			{/* Mobile overlay */}
			{sidebarOpen && (
				<div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={closeMobile} />
			)}

			{/* Sidebar */}
			<aside className={`sidebar-aside ${sidebarOpen ? 'sidebar-open' : ''}`}>
				<div className="p-3 space-y-1">
					{/* Filter search */}
					<FilterSearch columns={columns} onSelect={scrollToFilter} />

					{/* Filter selector grid */}
					<div className="flex flex-wrap gap-1 py-2">
						{filterableColumns.map((col) => {
							const isOpen = openSections.has(col.index);
							const isModified = activeFilterSet.has(col.index);
							return (
								<button
									key={col.index}
									className="px-2 py-1 text-xs rounded border cursor-pointer select-none transition-colors"
									style={{
										background: isOpen ? 'var(--accent-muted)' : isModified ? 'var(--accent-muted)' : 'var(--bg-tertiary)',
										color: isOpen || isModified ? 'var(--accent)' : 'var(--text-secondary)',
										borderColor: isOpen || isModified ? 'var(--accent)' : 'var(--border)',
									}}
									onClick={() => toggleSection(col.index)}
									dangerouslySetInnerHTML={{ __html: col.display }}
								/>
							);
						})}
					</div>

					{/* Expanded filter sections */}
					{filterableColumns.map((col) => {
						if (!openSections.has(col.index)) return null;
						return (
							<div
								key={col.index}
								id={`filter-${col.index}`}
								className="rounded-lg border p-3"
								style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)' }}
							>
								<div className="flex items-center justify-between mb-2">
									<h3
										className="text-sm font-medium"
										style={{ color: 'var(--text-primary)' }}
										dangerouslySetInnerHTML={{ __html: col.display }}
									/>
									<button
										className="text-xs cursor-pointer px-1"
										style={{ color: 'var(--text-muted)' }}
										onClick={() => toggleSection(col.index)}
									>
										✕
									</button>
								</div>
								<FilterGroup column={col} allColumns={columns} />
								{col.note && (
									<p
										className="text-xs mt-2 italic"
										style={{ color: 'var(--text-muted)' }}
										dangerouslySetInnerHTML={{ __html: col.note }}
									/>
								)}
							</div>
						);
					})}
				</div>
			</aside>
		</>
	);
});
