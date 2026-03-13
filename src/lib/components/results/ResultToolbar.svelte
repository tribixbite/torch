<script lang="ts">
	import type { ColumnDef } from '$lib/schema/columns.js';
	import { urlState } from '$lib/state/url-state.svelte.js';
	import { preferences } from '$lib/state/preferences.svelte.js';
	import { starredState } from '$lib/state/starred.svelte.js';

	interface Props {
		columns: ColumnDef[];
		count: number;
		timing: number;
	}

	let { columns, count, timing }: Props = $props();

	let sortableColumns = $derived(columns.filter((c) => c.sortable));

	/** Strip HTML entities from display names for use in <option> text */
	function cleanDisplay(html: string): string {
		return html.replace(/&nbsp;/g, ' ').replace(/<[^>]*>/g, '');
	}

	function handleSortChange(e: Event) {
		const select = e.target as HTMLSelectElement;
		const [colIdx, dir] = select.value.split(':');
		urlState.setSort(parseInt(colIdx, 10), dir as 'inc' | 'dec');
	}

	function toggleView() {
		preferences.setViewMode(preferences.viewMode === 'card' ? 'table' : 'card');
	}
</script>

<div class="flex items-center gap-3 px-3 py-2 flex-wrap" style="background: var(--bg-secondary); border-bottom: 1px solid var(--border);">
	<!-- Result count -->
	<span class="text-sm font-medium" style="color: var(--text-primary);">
		{count} match{count !== 1 ? 'es' : ''}
	</span>
	<span class="text-xs" style="color: var(--text-muted);">
		{timing.toFixed(0)}ms
	</span>

	<!-- Spacer -->
	<div class="flex-1"></div>

	<!-- Starred toggle -->
	<button
		class="text-sm cursor-pointer select-none px-2 py-0.5 rounded border transition-colors"
		style="background: {starredState.showStarredOnly ? 'var(--star)' : 'var(--bg-tertiary)'}; color: {starredState.showStarredOnly ? 'var(--bg-primary)' : 'var(--text-secondary)'}; border-color: {starredState.showStarredOnly ? 'var(--star)' : 'var(--border)'};"
		onclick={() => (starredState.showStarredOnly = !starredState.showStarredOnly)}
		title="Show starred only"
	>
		★ {starredState.starred.size}
	</button>

	<!-- Sort dropdown -->
	<select
		class="text-xs px-2 py-1 rounded border outline-none cursor-pointer"
		style="background: var(--bg-tertiary); color: var(--text-primary); border-color: var(--border);"
		value="{urlState.sort.column}:{urlState.sort.direction}"
		onchange={handleSortChange}
	>
		{#each sortableColumns as col}
			<option value="{col.index}:inc">{cleanDisplay(col.display)} ▲</option>
			<option value="{col.index}:dec">{cleanDisplay(col.display)} ▼</option>
		{/each}
	</select>

	<!-- View toggle -->
	<button
		class="text-sm cursor-pointer select-none px-2 py-0.5 rounded border"
		style="background: var(--bg-tertiary); color: var(--text-secondary); border-color: var(--border);"
		onclick={toggleView}
		title="Toggle view mode"
	>
		{preferences.viewMode === 'card' ? '▦' : '▤'}
	</button>
</div>
