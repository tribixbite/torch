<script lang="ts">
	import type { ColumnDef } from '$lib/schema/columns.js';
	import MultiFilter from './MultiFilter.svelte';
	import BooleanFilter from './BooleanFilter.svelte';
	import RangeFilter from './RangeFilter.svelte';
	import CompositeFilter from './CompositeFilter.svelte';

	interface Props {
		column: ColumnDef;
		allColumns: ColumnDef[];
	}

	let { column, allColumns }: Props = $props();
</script>

{#if column.filterType === 'multi' || column.filterType === 'mega-multi'}
	<MultiFilter {column} />
{:else if column.filterType === 'boolean'}
	<BooleanFilter {column} />
{:else if column.filterType === 'range'}
	<RangeFilter {column} />
{:else if column.filterType === 'log-range'}
	<RangeFilter {column} isLog={true} />
{:else if column.filterType === 'multiple'}
	<CompositeFilter {column} {allColumns} />
{/if}
