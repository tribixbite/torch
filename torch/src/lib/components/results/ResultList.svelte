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

	let displayIndices = $derived(
		starredState.showStarredOnly
			? indices.filter((i) => starredState.isStarred(i))
			: indices
	);
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

	{#each displayIndices as idx (idx)}
		{#if preferences.viewMode === 'card'}
			<FlashlightCard index={idx} {db} {columns} />
		{:else}
			<FlashlightTable index={idx} {db} {columns} />
		{/if}
	{/each}

	{#if displayIndices.length === 0}
		<div class="text-center py-12" style="color: var(--text-muted);">
			<p class="text-lg">No matches</p>
			<p class="text-sm mt-1">Try adjusting your filters</p>
		</div>
	{/if}
</div>
