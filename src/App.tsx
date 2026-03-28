/**
 * App shell — fetches JSON data, initializes worker, orchestrates filter/sort/search.
 * Debounces filter calls at ~100ms and search at ~150ms to avoid flooding the worker.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import type { FlashlightDB, ColumnDef } from '$lib/schema/columns';
import { buildColumns } from '$lib/schema/columns';
import { serializeFilters } from '$lib/schema/filter-schema';
import { useUrlState } from '$lib/state/url-state';
import { FilterWorkerClient } from '$lib/worker/worker-client';
import Header from './components/layout/Header';
import FilterSidebar from './components/filters/FilterSidebar';
import FilterPills from './components/filters/FilterPills';
import ResultToolbar from './components/results/ResultToolbar';
import ResultList from './components/results/ResultList';

export default function App() {
	const [db, setDb] = useState<FlashlightDB | null>(null);
	const [columns, setColumns] = useState<ColumnDef[]>([]);
	const [resultIndices, setResultIndices] = useState<number[]>([]);
	const [resultCount, setResultCount] = useState(0);
	const [resultTiming, setResultTiming] = useState(0);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState('');

	const workerRef = useRef<FilterWorkerClient | null>(null);
	const filterTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const readyRef = useRef(false);

	const initUrlState = useUrlState((s) => s.init);

	/** Run filter/sort/search on the worker — reads from store directly, no stale closures */
	const runFilter = useCallback(async () => {
		const worker = workerRef.current;
		if (!worker) return;
		const state = useUrlState.getState();
		const serialized = serializeFilters(state.filters);
		const sortPlain = { column: state.sort.column, direction: state.sort.direction };
		const result = await worker.filter(serialized, sortPlain, state.searchQuery || undefined);
		setResultIndices(result.indices);
		setResultCount(result.count);
		setResultTiming(result.timing);
	}, []);

	// Fetch data and initialize worker on mount
	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				const res = await fetch('/flashlights.now.json');
				if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
				const rawDb: FlashlightDB = await res.json();
				if (cancelled) return;

				const cols = buildColumns(rawDb);
				setDb(rawDb);
				setColumns(cols);

				// Initialize URL state from current URL
				initUrlState(cols);

				// Initialize web worker
				const client = new FilterWorkerClient();
				await client.init(rawDb);
				workerRef.current = client;
				readyRef.current = true;

				setLoading(false);

				// Run initial filter immediately (once)
				const state = useUrlState.getState();
				const serialized = serializeFilters(state.filters);
				const sortPlain = { column: state.sort.column, direction: state.sort.direction };
				const result = await client.filter(serialized, sortPlain, state.searchQuery || undefined);
				if (!cancelled) {
					setResultIndices(result.indices);
					setResultCount(result.count);
					setResultTiming(result.timing);
				}
			} catch (err) {
				if (cancelled) return;
				console.error('Failed to load flashlight data:', err);
				setLoadError(err instanceof Error ? err.message : 'Unknown error');
				setLoading(false);
			}
		})();

		return () => {
			cancelled = true;
			workerRef.current?.destroy();
		};
	}, [initUrlState]);

	// Subscribe to store changes directly to trigger debounced worker calls.
	// Tracks previous state to distinguish filter/sort vs search changes.
	useEffect(() => {
		let prevFilters = useUrlState.getState().filters;
		let prevSort = useUrlState.getState().sort;
		let prevSearch = useUrlState.getState().searchQuery;

		const unsub = useUrlState.subscribe((state) => {
			if (!readyRef.current) return;

			// Filter/sort changed — debounce 100ms
			if (state.filters !== prevFilters || state.sort !== prevSort) {
				prevFilters = state.filters;
				prevSort = state.sort;
				clearTimeout(filterTimeoutRef.current);
				filterTimeoutRef.current = setTimeout(runFilter, 100);
			}

			// Search changed — debounce 150ms
			if (state.searchQuery !== prevSearch) {
				prevSearch = state.searchQuery;
				clearTimeout(searchTimeoutRef.current);
				searchTimeoutRef.current = setTimeout(runFilter, 150);
			}
		});

		return () => {
			unsub();
			clearTimeout(filterTimeoutRef.current);
			clearTimeout(searchTimeoutRef.current);
		};
	}, [runFilter]);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg-primary)' }}>
				<div className="text-center">
					<div className="text-4xl mb-4" style={{ color: 'var(--accent)' }}>🔦</div>
					<p style={{ color: 'var(--text-secondary)' }}>Loading flashlight data...</p>
				</div>
			</div>
		);
	}

	if (loadError) {
		return (
			<div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg-primary)' }}>
				<div className="text-center">
					<p className="text-lg mb-2" style={{ color: 'var(--danger)' }}>Failed to load data</p>
					<p className="text-sm" style={{ color: 'var(--text-muted)' }}>{loadError}</p>
					<button
						className="mt-4 px-4 py-2 rounded border cursor-pointer"
						style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)', borderColor: 'var(--accent)' }}
						onClick={() => window.location.reload()}
					>
						Retry
					</button>
				</div>
			</div>
		);
	}

	if (!db) return null;

	return (
		<div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
			<Header />

			{/* Filter pills bar */}
			<FilterPills columns={columns} />

			<div className="flex">
				{/* Sidebar */}
				<FilterSidebar columns={columns} />

				{/* Main content area */}
				<main className="flex-1 min-w-0">
					<ResultToolbar columns={columns} count={resultCount} timing={resultTiming} />
					<ResultList indices={resultIndices} db={db} columns={columns} />

					{/* Attribution footer */}
					<footer
						className="px-4 py-3 text-center text-xs"
						style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}
					>
						Inspired by{' '}
						<a href="http://flashlights.parametrek.com" target="_blank" rel="noopener" className="underline" style={{ color: 'var(--text-secondary)' }}>
							parametrek
						</a>
						{' · Built by '}
						<a href="https://github.com/tribixbite" target="_blank" rel="noopener" className="underline" style={{ color: 'var(--text-secondary)' }}>
							tribixbite
						</a>
						{' · '}
						<a href="https://github.com/tribixbite/torch" target="_blank" rel="noopener" className="underline" style={{ color: 'var(--text-secondary)' }}>
							Source
						</a>
					</footer>
				</main>
			</div>
		</div>
	);
}
