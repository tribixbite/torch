<script lang="ts">
	import { onMount } from 'svelte';
	import type { FlashlightDB, ColumnDef } from '$lib/schema/columns.js';
	import { buildColumns } from '$lib/schema/columns.js';
	import { serializeFilters } from '$lib/schema/filter-schema.js';
	import { urlState } from '$lib/state/url-state.svelte.js';
	import { preferences } from '$lib/state/preferences.svelte.js';
	import { FilterWorkerClient } from '$lib/worker/worker-client.js';
	import Header from '$lib/components/layout/Header.svelte';
	import FilterSidebar from '$lib/components/filters/FilterSidebar.svelte';
	import FilterPills from '$lib/components/filters/FilterPills.svelte';
	import ResultToolbar from '$lib/components/results/ResultToolbar.svelte';
	import ResultList from '$lib/components/results/ResultList.svelte';

	let db = $state<FlashlightDB | null>(null);
	let columns = $state<ColumnDef[]>([]);
	let resultIndices = $state<number[]>([]);
	let resultCount = $state(0);
	let resultTiming = $state(0);
	let loading = $state(true);
	let loadError = $state('');
	let workerClient: FilterWorkerClient | null = null;
	// Keep a non-reactive reference to the raw DB for worker init
	let plainDb: FlashlightDB | null = null;

	// Debounce timers
	let filterTimeout: ReturnType<typeof setTimeout> | undefined;
	let searchTimeout: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
		(async () => {
			try {
				const res = await fetch('/flashlights.now.json');
				if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
				const rawDb: FlashlightDB = await res.json();
				plainDb = rawDb;
				db = rawDb;
				columns = buildColumns(rawDb);

				// Initialize URL state from current URL
				urlState.init(columns);

				// Initialize web worker — pass plain object, not Svelte proxy
				workerClient = new FilterWorkerClient();
				await workerClient.init(plainDb);

				loading = false;
				runFilter();
			} catch (err) {
				console.error('Failed to load flashlight data:', err);
				loadError = err instanceof Error ? err.message : 'Unknown error';
				loading = false;
			}
		})();

		return () => {
			workerClient?.destroy();
		};
	});

	// React to filter changes
	$effect(() => {
		// Access reactive deps
		const _filters = urlState.filters;
		const _sort = urlState.sort;
		if (!loading && workerClient) {
			clearTimeout(filterTimeout);
			filterTimeout = setTimeout(() => runFilter(), 10);
		}
	});

	// React to search query changes (with debounce)
	$effect(() => {
		const _query = urlState.searchQuery;
		if (!loading && workerClient) {
			clearTimeout(searchTimeout);
			searchTimeout = setTimeout(() => runFilter(), 150);
		}
	});

	async function runFilter() {
		if (!workerClient) return;
		const serialized = serializeFilters(urlState.filters);
		// Unwrap Svelte 5 proxies — postMessage requires plain objects
		const sort = { column: urlState.sort.column, direction: urlState.sort.direction };
		const result = await workerClient.filter(
			JSON.parse(JSON.stringify(serialized)),
			sort,
			urlState.searchQuery || undefined
		);
		resultIndices = result.indices;
		resultCount = result.count;
		resultTiming = result.timing;
	}
</script>

<svelte:head>
	<title>Torch — {resultCount} flashlights</title>
</svelte:head>

{#if loading}
	<div class="flex items-center justify-center h-screen" style="background: var(--bg-primary);">
		<div class="text-center">
			<div class="text-4xl mb-4" style="color: var(--accent);">🔦</div>
			<p style="color: var(--text-secondary);">Loading flashlight data...</p>
		</div>
	</div>
{:else if loadError}
	<div class="flex items-center justify-center h-screen" style="background: var(--bg-primary);">
		<div class="text-center">
			<p class="text-lg mb-2" style="color: var(--danger);">Failed to load data</p>
			<p class="text-sm" style="color: var(--text-muted);">{loadError}</p>
			<button
				class="mt-4 px-4 py-2 rounded border cursor-pointer"
				style="background: var(--bg-tertiary); color: var(--accent); border-color: var(--accent);"
				onclick={() => window.location.reload()}
			>Retry</button>
		</div>
	</div>
{:else if db}
	<div class="min-h-screen" style="background: var(--bg-primary);">
		<Header />

		<!-- Filter pills bar -->
		<FilterPills {columns} />

		<div class="flex">
			<!-- Sidebar -->
			<FilterSidebar {columns} />

			<!-- Main content area -->
			<main class="flex-1 min-w-0">
				<ResultToolbar {columns} count={resultCount} timing={resultTiming} />
				<ResultList indices={resultIndices} {db} {columns} />

				<!-- Attribution footer -->
				<footer class="px-4 py-3 text-center text-xs" style="color: var(--text-muted); border-top: 1px solid var(--border);">
					Inspired by <a href="http://flashlights.parametrek.com" target="_blank" rel="noopener" class="underline" style="color: var(--text-secondary);">parametrek</a>
					&middot; Built by <a href="https://github.com/tribixbite" target="_blank" rel="noopener" class="underline" style="color: var(--text-secondary);">tribixbite</a>
					&middot; <a href="https://github.com/tribixbite/torch" target="_blank" rel="noopener" class="underline" style="color: var(--text-secondary);">Source</a>
				</footer>
			</main>
		</div>
	</div>
{/if}
