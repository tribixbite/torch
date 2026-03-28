import { useRef, useState, useEffect, useCallback, memo } from 'react';
import type { ColumnDef } from '$lib/schema/columns';
import type { RangeFilter as RangeFilterType } from '$lib/schema/filter-schema';
import { useUrlState } from '$lib/state/url-state';
import { smartFixed } from '$lib/schema/si-prefix';

interface Props {
	column: ColumnDef;
	isLog?: boolean;
}

export default memo(function RangeFilter({ column, isLog = false }: Props) {
	const filters = useUrlState((s) => s.filters);
	const setRangeFilter = useUrlState((s) => s.setRangeFilter);
	const sort = useUrlState((s) => s.sort);
	const setSort = useUrlState((s) => s.setSort);

	const filter = filters.get(column.index) as RangeFilterType | undefined;
	const boundsMin = column.min ?? 0;
	const boundsMax = column.max ?? 100;
	const decimals = column.decimals ?? 0;
	const currentMin = filter?.min ?? boundsMin;
	const currentMax = filter?.max ?? boundsMax;
	const showUnknown = filter?.showUnknown ?? false;

	// Use refs for drag state to avoid render thrashing during pointer moves
	const draggingRef = useRef<'lower' | 'upper' | null>(null);
	const trackRef = useRef<HTMLDivElement>(null);
	const [lowerPerc, setLowerPerc] = useState(0);
	const [upperPerc, setUpperPerc] = useState(1);

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
			setLowerPerc(valueToPerc(currentMin));
			setUpperPerc(valueToPerc(currentMax));
		}
	}, [currentMin, currentMax, valueToPerc]);

	const formatValue = useCallback((value: number): string => {
		const formatted = smartFixed(value, decimals);
		return column.unit.replace('{}', formatted);
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

	const handlePointerMove = useCallback((e: React.PointerEvent) => {
		if (!draggingRef.current || !trackRef.current) return;
		const rect = trackRef.current.getBoundingClientRect();
		let perc = (e.clientX - rect.left) / rect.width;
		perc = Math.max(0, Math.min(1, perc));

		if (draggingRef.current === 'lower') {
			setLowerPerc((prev) => {
				const clamped = Math.min(perc, upperPerc);
				return clamped;
			});
			// Direct update to avoid stale closure
			setUpperPerc((up) => {
				setLowerPerc(Math.min(perc, up));
				return up;
			});
		} else {
			setLowerPerc((lo) => {
				setUpperPerc(Math.max(perc, lo));
				return lo;
			});
		}
	}, []);

	const handlePointerUp = useCallback(() => {
		if (!draggingRef.current) return;
		draggingRef.current = null;
		// Read current values and commit
		setLowerPerc((lp) => {
			setUpperPerc((up) => {
				commitValues(lp, up);
				return up;
			});
			return lp;
		});
	}, [commitValues]);

	const handleTrackClick = useCallback((e: React.MouseEvent) => {
		if (!trackRef.current) return;
		const rect = trackRef.current.getBoundingClientRect();
		const perc = (e.clientX - rect.left) / rect.width;
		// Move whichever thumb is closer
		setLowerPerc((lp) => {
			setUpperPerc((up) => {
				let newLp = lp;
				let newUp = up;
				if (Math.abs(perc - lp) < Math.abs(perc - up)) {
					newLp = perc;
				} else {
					newUp = perc;
				}
				commitValues(newLp, newUp);
				return newUp;
			});
			if (Math.abs(perc - lp) < Math.abs(perc - upperPerc)) {
				return perc;
			}
			return lp;
		});
	}, [commitValues, upperPerc]);

	const toggleShowUnknown = useCallback(() => {
		const minVal = percToValue(lowerPerc);
		const maxVal = percToValue(upperPerc);
		const minActive = lowerPerc > 0.001;
		const maxActive = upperPerc < 0.999;
		setRangeFilter(column.index, minVal, maxVal, minActive, maxActive, !showUnknown);
	}, [percToValue, lowerPerc, upperPerc, showUnknown, column.index, setRangeFilter]);

	const displayMin = formatValue(percToValue(lowerPerc));
	const displayMax = formatValue(percToValue(upperPerc));

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
					style={{ left: `${lowerPerc * 100}%`, width: `${(upperPerc - lowerPerc) * 100}%` }}
				/>
				<div
					className="range-thumb"
					role="slider"
					tabIndex={0}
					aria-label={`${column.display} minimum`}
					aria-valuemin={boundsMin}
					aria-valuemax={boundsMax}
					aria-valuenow={percToValue(lowerPerc)}
					style={{ left: `${lowerPerc * 100}%` }}
					onPointerDown={(e) => handlePointerDown(e, 'lower')}
				/>
				<div
					className="range-thumb"
					role="slider"
					tabIndex={0}
					aria-label={`${column.display} maximum`}
					aria-valuemin={boundsMin}
					aria-valuemax={boundsMax}
					aria-valuenow={percToValue(upperPerc)}
					style={{ left: `${upperPerc * 100}%` }}
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
							style={{ color: sort.column === column.index && sort.direction === 'inc' ? 'var(--accent)' : 'var(--text-muted)' }}
							onClick={() => setSort(column.index, 'inc')}
							title="Sort ascending"
						>
							&#9650;
						</button>
						<button
							className="text-xs cursor-pointer select-none px-1"
							style={{ color: sort.column === column.index && sort.direction === 'dec' ? 'var(--accent)' : 'var(--text-muted)' }}
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
