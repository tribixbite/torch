<script lang="ts">
	import { tick } from 'svelte';
	import type { ColumnDef } from '$lib/schema/columns.js';
	import { urlState } from '$lib/state/url-state.svelte.js';
	import { preferences } from '$lib/state/preferences.svelte.js';
	import FilterGroup from './FilterGroup.svelte';
	import FilterSearch from './FilterSearch.svelte';

	interface Props {
		columns: ColumnDef[];
	}

	let { columns }: Props = $props();

	// Filterable columns — show all with a filter type (searchable is for text search, not visibility)
	// Exclude sub-columns that are rendered inside a composite ('multiple') parent
	let compositeSubCols = $derived(
		new Set(columns.filter((c) => c.filterType === 'multiple' && c.subColumns).flatMap((c) => c.subColumns!))
	);
	// Hidden columns: internal duplicates + columns with no usable data
	const HIDDEN_FILTER_IDS = new Set(['trueled', '_pic', '_bat', '_reviews', 'wh', 'efficacy', 'beam_angle', 'year']);
	let filterableColumns = $derived(
		columns.filter((c) => c.filterType !== null && !HIDDEN_FILTER_IDS.has(c.id) && !compositeSubCols.has(c.index))
	);

	// Track which filter sections are expanded
	let openSections = $state<Set<number>>(new Set());

	function toggleSection(colIndex: number) {
		const next = new Set(openSections);
		if (next.has(colIndex)) {
			next.delete(colIndex);
		} else {
			next.add(colIndex);
		}
		openSections = next;
	}

	async function scrollToFilter(colIndex: number) {
		openSections = new Set([...openSections, colIndex]);
		await tick(); // wait for DOM update
		const el = document.getElementById(`filter-${colIndex}`);
		el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}

	function isModified(colIndex: number): boolean {
		return urlState.filters.has(colIndex);
	}

	// Close sidebar on mobile when clicking outside
	function closeMobile() {
		if (window.innerWidth < 768) {
			preferences.sidebarOpen = false;
		}
	}
</script>

<!-- Mobile overlay -->
{#if preferences.sidebarOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 bg-black/50 z-40 md:hidden"
		onclick={closeMobile}
	></div>
{/if}

<!-- Sidebar -->
<aside
	class="sidebar-aside fixed top-0 left-0 h-full z-50 overflow-y-auto transition-transform duration-200"
	class:sidebar-open={preferences.sidebarOpen}
>
	<div class="p-3 space-y-1">
		<!-- Filter search -->
		<FilterSearch {columns} onselect={scrollToFilter} />

		<!-- Filter selector grid -->
		<div class="flex flex-wrap gap-1 py-2">
			{#each filterableColumns as col}
				<button
					class="px-2 py-1 text-xs rounded border cursor-pointer select-none transition-colors"
					style="background: {openSections.has(col.index) ? 'var(--accent-muted)' : isModified(col.index) ? 'var(--accent-muted)' : 'var(--bg-tertiary)'}; color: {openSections.has(col.index) || isModified(col.index) ? 'var(--accent)' : 'var(--text-secondary)'}; border-color: {openSections.has(col.index) || isModified(col.index) ? 'var(--accent)' : 'var(--border)'};"
					onclick={() => toggleSection(col.index)}
				>
					{@html col.display}
				</button>
			{/each}
		</div>

		<!-- Expanded filter sections -->
		{#each filterableColumns as col}
			{#if openSections.has(col.index)}
				<div
					id="filter-{col.index}"
					class="rounded-lg border p-3"
					style="background: var(--bg-primary); border-color: var(--border);"
				>
					<div class="flex items-center justify-between mb-2">
						<h3 class="text-sm font-medium" style="color: var(--text-primary);">
							{@html col.display}
						</h3>
						<button
							class="text-xs cursor-pointer px-1"
							style="color: var(--text-muted);"
							onclick={() => toggleSection(col.index)}
						>
							✕
						</button>
					</div>
					<FilterGroup column={col} allColumns={columns} />
					{#if col.note}
						<p class="text-xs mt-2 italic" style="color: var(--text-muted);">
							{@html col.note}
						</p>
					{/if}
				</div>
			{/if}
		{/each}
	</div>
</aside>

<style>
	.sidebar-aside {
		width: 320px;
		background: var(--bg-secondary);
		border-right: 1px solid var(--border);
		transform: translateX(-100%);
		/* Mobile: start below the sticky header (~45px) */
		top: 45px;
		height: calc(100% - 45px);
	}

	.sidebar-aside.sidebar-open {
		transform: translateX(0);
	}

	/* Desktop: always visible, sticky, full height */
	@media (min-width: 768px) {
		.sidebar-aside {
			position: sticky;
			top: 0;
			z-index: auto;
			transform: translateX(0);
			height: 100vh;
		}
	}
</style>
