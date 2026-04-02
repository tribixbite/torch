import { useRef, useState, useEffect, useCallback, useMemo, memo } from 'react';
import type { ColumnDef } from '$lib/schema/columns';
import type { RangeFilter as RangeFilterType } from '$lib/schema/filter-schema';
import { useUrlState } from '$lib/state/url-state';
import { smartFixed } from '$lib/schema/si-prefix';

interface Props {
	column: ColumnDef;
	isLog?: boolean;
}

interface Thumbs {
	lower: number;
	upper: number;
}

export default memo(function RangeFilter({ column, isLog = false }: Props) {
	// Granular selectors — only re-render when this column's filter or sort changes
	const filter = useUrlState((s) => s.filters.get(column.index)) as RangeFilterType | undefined;
	const setRangeFilter = useUrlState((s) => s.setRangeFilter);
	const isSortedInc = useUrlState((s) => s.sort.column === column.index && s.sort.direction === 'inc');
	const isSortedDec = useUrlState((s) => s.sort.column === column.index && s.sort.direction === 'dec');
	const setSort = useUrlState((s) => s.setSort);

	const boundsMin = column.min ?? 0;
	const boundsMax = column.max ?? 100;
	const decimals = column.decimals ?? 0;
	const currentMin = filter?.min ?? boundsMin;
	const currentMax = filter?.max ?? boundsMax;
	const showUnknown = filter?.showUnknown ?? false;

	// Drag state in ref to avoid render thrashing at 60Hz pointer events
	const draggingRef = useRef<'lower' | 'upper' | null>(null);
	const trackRef = useRef<HTMLDivElement>(null);
	// Thumb percentages — updated atomically to avoid stale closure issues
	const [thumbs, setThumbs] = useState<Thumbs>({ lower: 0, upper: 1 });

	// Log slider math (exact from parametrek.js)
	const percToValue = useCallback((perc: number): number => {
		if (isLog) {
			const b = boundsMin - 1;
			const m = boundsMax - b;
			return Math.pow(m, perc) + b;
		}
		return perc * (boundsMax - boundsMin) + boundsMin;
	}, [isLog, boundsMin, boundsMax]);

	const valueToPerc = useCallback((value: number): number => {
		if (isLog) {
			const b = boundsMin - 1;
			const m = boundsMax - b;
			if (value <= b) return 0;
			return Math.log(value - b) / Math.log(m);
		}
		const range = boundsMax - boundsMin;
		if (range === 0) return 0;
		return (value - boundsMin) / range;
	}, [isLog, boundsMin, boundsMax]);

	// Sync state from filter changes (when not dragging)
	useEffect(() => {
		if (!draggingRef.current) {
			setThumbs({ lower: valueToPerc(currentMin), upper: valueToPerc(currentMax) });
		}
	}, [currentMin, currentMax, valueToPerc]);

	const formatValue = useCallback((value: number): string => {
		// {si} prefix units: apply SI notation regardless of decimals field
		if (column.unit.startsWith('{si}')) {
			const suffix = column.unit.slice(4); // e.g. 'lm', 'h', 'cd'
			return smartFixed(value, '{si}') + suffix;
		}
		const formatted = smartFixed(value, decimals);
		// Normal template: "{} m", "${}", etc.
		if (column.unit.includes('{}')) return column.unit.replace('{}', formatted);
		// No template — return raw formatted value
		return formatted;
	}, [decimals, column.unit]);

	const commitValues = useCallback((lp: number, up: number) => {
		const minVal = percToValue(lp);
		const maxVal = percToValue(up);
		const minActive = lp > 0.001;
		const maxActive = up < 0.999;
		setRangeFilter(column.index, minVal, maxVal, minActive, maxActive, showUnknown);
	}, [percToValue, column.index, showUnknown, setRangeFilter]);

	const handlePointerDown = useCallback((e: React.PointerEvent, which: 'lower' | 'upper') => {
		e.preventDefault();
		draggingRef.current = which;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	}, []);

	// Single atomic state update per pointer move — no nested setState
	const handlePointerMove = useCallback((e: React.PointerEvent) => {
		if (!draggingRef.current || !trackRef.current) return;
		const rect = trackRef.current.getBoundingClientRect();
		const perc = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

		setThumbs((prev) => {
			if (draggingRef.current === 'lower') {
				return { lower: Math.min(perc, prev.upper), upper: prev.upper };
			}
			return { lower: prev.lower, upper: Math.max(perc, prev.lower) };
		});
	}, []);

	const handlePointerUp = useCallback(() => {
		if (!draggingRef.current) return;
		draggingRef.current = null;
		// Read current thumb values atomically and commit
		setThumbs((prev) => {
			commitValues(prev.lower, prev.upper);
			return prev;
		});
	}, [commitValues]);

	const handleTrackClick = useCallback((e: React.MouseEvent) => {
		if (!trackRef.current) return;
		const rect = trackRef.current.getBoundingClientRect();
		const perc = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

		setThumbs((prev) => {
			// Move whichever thumb is closer
			const newThumbs = Math.abs(perc - prev.lower) < Math.abs(perc - prev.upper)
				? { lower: perc, upper: prev.upper }
				: { lower: prev.lower, upper: perc };
			commitValues(newThumbs.lower, newThumbs.upper);
			return newThumbs;
		});
	}, [commitValues]);

	const toggleShowUnknown = useCallback(() => {
		setThumbs((prev) => {
			const minVal = percToValue(prev.lower);
			const maxVal = percToValue(prev.upper);
			const minActive = prev.lower > 0.001;
			const maxActive = prev.upper < 0.999;
			setRangeFilter(column.index, minVal, maxVal, minActive, maxActive, !showUnknown);
			return prev;
		});
	}, [percToValue, showUnknown, column.index, setRangeFilter]);

	const displayMin = useMemo(() => formatValue(percToValue(thumbs.lower)), [formatValue, percToValue, thumbs.lower]);
	const displayMax = useMemo(() => formatValue(percToValue(thumbs.upper)), [formatValue, percToValue, thumbs.upper]);

	return (
		<div className="space-y-2">
			{/* Value labels */}
			<div className="flex justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
				<span>{displayMin}</span>
				<span>{displayMax}</span>
			</div>

			{/* Double-thumb slider */}
			<div
				className="range-track"
				ref={trackRef}
				onClick={handleTrackClick}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
			>
				<div
					className="range-fill"
					style={{ left: `${thumbs.lower * 100}%`, width: `${(thumbs.upper - thumbs.lower) * 100}%` }}
				/>
				<div
					className="range-thumb"
					role="slider"
					tabIndex={0}
					aria-label={`${column.display} minimum`}
					aria-valuemin={boundsMin}
					aria-valuemax={boundsMax}
					aria-valuenow={percToValue(thumbs.lower)}
					style={{ left: `${thumbs.lower * 100}%` }}
					onPointerDown={(e) => handlePointerDown(e, 'lower')}
				/>
				<div
					className="range-thumb"
					role="slider"
					tabIndex={0}
					aria-label={`${column.display} maximum`}
					aria-valuemin={boundsMin}
					aria-valuemax={boundsMax}
					aria-valuenow={percToValue(thumbs.upper)}
					style={{ left: `${thumbs.upper * 100}%` }}
					onPointerDown={(e) => handlePointerDown(e, 'upper')}
				/>
			</div>

			{/* Sort arrows + show unknown toggle */}
			<div className="flex gap-2 justify-between items-center">
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
				{column.sortable && (
					<div className="flex gap-2">
						<button
							className="text-xs cursor-pointer select-none px-1"
							style={{ color: isSortedInc ? 'var(--accent)' : 'var(--text-muted)' }}
							onClick={() => setSort(column.index, 'inc')}
							title="Sort ascending"
						>
							&#9650;
						</button>
						<button
							className="text-xs cursor-pointer select-none px-1"
							style={{ color: isSortedDec ? 'var(--accent)' : 'var(--text-muted)' }}
							onClick={() => setSort(column.index, 'dec')}
							title="Sort descending"
						>
							&#9660;
						</button>
					</div>
				)}
			</div>
		</div>
	);
});
