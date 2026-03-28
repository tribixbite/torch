import { useRef, useEffect, useMemo, memo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ColumnDef, FlashlightDB } from '$lib/schema/columns';
import { usePreferences } from '$lib/state/preferences';
import { useStarred } from '$lib/state/starred';
import FlashlightCard from './FlashlightCard';
import FlashlightTable from './FlashlightTable';

interface Props {
	indices: number[];
	db: FlashlightDB;
	columns: ColumnDef[];
}

export default memo(function ResultList({ indices, db, columns }: Props) {
	const viewMode = usePreferences((s) => s.viewMode);
	const showStarredOnly = useStarred((s) => s.showStarredOnly);
	const starred = useStarred((s) => s.starred);

	const displayIndices = useMemo(
		() => showStarredOnly ? indices.filter((i) => starred.has(i)) : indices,
		[indices, showStarredOnly, starred]
	);

	const parentRef = useRef<HTMLDivElement>(null);

	const virtualizer = useVirtualizer({
		count: displayIndices.length,
		getScrollElement: () => parentRef.current,
		// Estimated sizes: card ~90px, table ~36px
		estimateSize: () => (viewMode === 'card' ? 90 : 36),
		overscan: 10,
		measureElement: (element) => element.getBoundingClientRect().height,
	});

	// Reset scroll to top when filter results change
	useEffect(() => {
		virtualizer.scrollToOffset(0);
	}, [displayIndices.length, virtualizer]);

	if (displayIndices.length === 0) {
		return (
			<div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
				<p className="text-lg">No matches</p>
				<p className="text-sm mt-1">Try adjusting your filters</p>
			</div>
		);
	}

	return (
		<div ref={parentRef} className="overflow-auto" style={{ height: 'calc(100vh - 130px)' }}>
			{viewMode === 'table' && (
				<div
					className="flex items-center gap-2 px-2 py-1 text-xs font-medium sticky top-0 z-10"
					style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', background: 'var(--bg-primary)' }}
				>
					<span className="w-[40px]" />
					<span className="w-[120px]">Model</span>
					<span className="w-[100px]">Brand</span>
					<span className="w-[80px]">Lumens</span>
					<span className="w-[80px]">Weight</span>
					<span className="w-[100px]">Battery</span>
					<span className="w-[60px] text-right">Price</span>
					<span className="ml-auto" />
				</div>
			)}

			<div
				className="relative w-full p-2"
				style={{ height: virtualizer.getTotalSize() }}
			>
				{virtualizer.getVirtualItems().map((virtualRow) => {
					const idx = displayIndices[virtualRow.index];
					return (
						<div
							key={idx}
							data-index={virtualRow.index}
							ref={(el) => {
								if (el) virtualizer.measureElement(el);
							}}
							className="absolute left-0 right-0 px-2"
							style={{ transform: `translateY(${virtualRow.start}px)` }}
						>
							{viewMode === 'card' ? (
								<FlashlightCard index={idx} db={db} columns={columns} />
							) : (
								<FlashlightTable index={idx} db={db} columns={columns} />
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
});
