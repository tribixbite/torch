<script lang="ts">
	import type { ColumnDef, FlashlightDB } from '$lib/schema/columns.js';
	import { preferences } from '$lib/state/preferences.svelte.js';
	import { starredState } from '$lib/state/starred.svelte.js';
	import FlashlightCard from './FlashlightCard.svelte';
	import FlashlightTable from './FlashlightTable.svelte';

	interface Props {
		indices: number[];
		db: FlashlightDB;
		columns: ColumnDef[];
	}

	let { indices, db, columns }: Props = $props();

	// Initial render limit for performance — progressively loads more
	const INITIAL_BATCH = 50;
	const LOAD_MORE_BATCH = 100;
	let visibleCount = $state(INITIAL_BATCH);

	let displayIndices = $derived(
		starredState.showStarredOnly
			? indices.filter((i) => starredState.isStarred(i))
			: indices
	);

	// Reset visible count when indices change (new filter result)
	$effect(() => {
		// Track displayIndices length to reset on filter changes
		const _len = displayIndices.length;
		visibleCount = INITIAL_BATCH;
	});

	let visibleItems = $derived(displayIndices.slice(0, visibleCount));
	let remaining = $derived(displayIndices.length - visibleCount);
	let hasMore = $derived(remaining > 0);

	function showMore() {
		visibleCount = Math.min(visibleCount + LOAD_MORE_BATCH, displayIndices.length);
	}

	function showAll() {
		visibleCount = displayIndices.length;
	}

	// Intersection observer for auto-load on scroll
	let sentinelEl: HTMLDivElement | undefined = $state();

	$effect(() => {
		if (!sentinelEl || !hasMore) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) {
					showMore();
				}
			},
			{ rootMargin: '400px' }
		);
		observer.observe(sentinelEl);
		return () => observer.disconnect();
	});
</script>

<div class="space-y-1 p-2">
	{#if preferences.viewMode === 'table'}
		<!-- Table header -->
		<div class="flex items-center gap-2 px-2 py-1 text-xs font-medium" style="color: var(--text-muted); border-bottom: 1px solid var(--border);">
			<span class="w-[40px]"></span>
			<span class="w-[120px]">Model</span>
			<span class="w-[100px]">Brand</span>
			<span class="w-[80px]">Lumens</span>
			<span class="w-[80px]">Weight</span>
			<span class="w-[100px]">Battery</span>
			<span class="w-[60px] text-right">Price</span>
			<span class="ml-auto"></span>
		</div>
	{/if}

	{#each visibleItems as idx (idx)}
		{#if preferences.viewMode === 'card'}
			<FlashlightCard index={idx} {db} {columns} />
		{:else}
			<FlashlightTable index={idx} {db} {columns} />
		{/if}
	{/each}

	{#if hasMore}
		<!-- Scroll sentinel for auto-loading -->
		<div bind:this={sentinelEl}></div>

		<div class="text-center py-4">
			<span class="text-sm mr-2" style="color: var(--text-muted);">
				{remaining} more match{remaining !== 1 ? 'es' : ''}
			</span>
			<button
				class="text-sm px-3 py-1 rounded border cursor-pointer"
				style="background: var(--bg-tertiary); color: var(--accent); border-color: var(--accent);"
				onclick={showMore}
			>
				Show more
			</button>
			<button
				class="text-sm px-3 py-1 rounded border cursor-pointer ml-2"
				style="background: var(--bg-tertiary); color: var(--text-secondary); border-color: var(--border);"
				onclick={showAll}
			>
				Show all
			</button>
		</div>
	{/if}

	{#if displayIndices.length === 0}
		<div class="text-center py-12" style="color: var(--text-muted);">
			<p class="text-lg">No matches</p>
			<p class="text-sm mt-1">Try adjusting your filters</p>
		</div>
	{/if}
</div>
