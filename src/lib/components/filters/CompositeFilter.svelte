<script lang="ts">
	import type { ColumnDef } from '$lib/schema/columns.js';
	import FilterGroup from './FilterGroup.svelte';

	interface Props {
		column: ColumnDef;
		allColumns: ColumnDef[];
	}

	let { column, allColumns }: Props = $props();

	let subColumns = $derived(
		(column.subColumns ?? []).map((idx) => allColumns[idx]).filter(Boolean)
	);
</script>

<div class="space-y-3">
	{#each subColumns as subCol}
		<div>
			<div class="text-xs font-medium mb-1" style="color: var(--text-secondary);">
				{@html subCol.display}
			</div>
			<FilterGroup column={subCol} allColumns={allColumns} />
		</div>
	{/each}
</div>
