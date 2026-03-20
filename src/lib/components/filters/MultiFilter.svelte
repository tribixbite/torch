<script lang="ts">
	import type { ColumnDef } from '$lib/schema/columns.js';
	import { getVisibleOptions, getOptionGroups } from '$lib/schema/columns.js';
	import type { LogicMode, MultiFilter as MultiFilterType } from '$lib/schema/filter-schema.js';
	import { urlState } from '$lib/state/url-state.svelte.js';
	import LogicModeButton from './LogicModeButton.svelte';

	interface Props {
		column: ColumnDef;
	}

	let { column }: Props = $props();

	// Get current filter state for this column
	let filter = $derived(urlState.filters.get(column.index) as MultiFilterType | undefined);
	let selected = $derived(filter?.selected ?? new Set<string>());
	let mode = $derived(filter?.mode ?? (column.modes[0] as LogicMode));
	let showUnknown = $derived(filter?.showUnknown ?? false);

	let filterSearch = $state('');

	// Options display
	let isMega = $derived(column.filterType === 'mega-multi');
	let groups = $derived(isMega && column.options ? getOptionGroups(column.options) : null);
	let flatOptions = $derived(column.options ? getVisibleOptions(column.options) : []);

	let filteredOptions = $derived(
		filterSearch
			? flatOptions.filter((o) => !o.hidden && o.display.toLowerCase().includes(filterSearch.toLowerCase()))
			: flatOptions.filter((o) => !o.hidden)
	);

	function toggle(value: string) {
		const next = new Set(selected);
		if (next.has(value)) {
			next.delete(value);
		} else {
			next.add(value);
		}
		urlState.setMultiFilter(column.index, next, mode, showUnknown);
	}

	function changeMode(newMode: LogicMode) {
		urlState.setMultiFilter(column.index, selected, newMode, showUnknown);
	}

	function invertAll() {
		const next = new Set<string>();
		for (const opt of flatOptions) {
			if (opt.hidden) continue;
			if (!selected.has(opt.value)) {
				next.add(opt.value);
			}
		}
		urlState.setMultiFilter(column.index, next, mode, showUnknown);
	}

	function toggleShowUnknown() {
		urlState.setMultiFilter(column.index, selected, mode, !showUnknown);
	}

	function clearAll() {
		urlState.clearFilter(column.index);
	}
</script>

<div class="space-y-2">
	<!-- Header row: mode + invert + clear -->
	<div class="flex items-center gap-2 flex-wrap">
		<LogicModeButton modes={column.modes} current={mode} onchange={changeMode} />
		<button
			class="px-2 py-0.5 text-xs rounded border cursor-pointer select-none transition-colors"
			style="background: var(--bg-elevated); color: var(--text-secondary); border-color: var(--border);"
			onclick={invertAll}
		>
			invert
		</button>
		<button
			class="px-2 py-0.5 text-xs rounded border cursor-pointer select-none transition-colors"
			style="background: {showUnknown ? 'var(--accent-muted)' : 'var(--bg-elevated)'};
						 color: {showUnknown ? 'var(--accent)' : 'var(--text-secondary)'};
						 border-color: {showUnknown ? 'var(--accent)' : 'var(--border)'};"
			onclick={toggleShowUnknown}
			title="Include entries with unknown/missing values for this field"
		>
			? unknown
		</button>
		{#if selected.size > 0}
			<button
				class="px-2 py-0.5 text-xs rounded border cursor-pointer select-none transition-colors"
				style="background: var(--bg-elevated); color: var(--danger); border-color: var(--danger);"
				onclick={clearAll}
			>
				clear ({selected.size})
			</button>
		{/if}
	</div>

	<!-- In-filter search for large option sets -->
	{#if flatOptions.length > 15}
		<input
			type="text"
			placeholder="Search options..."
			class="w-full px-2 py-1 text-xs rounded border outline-none"
			style="background: var(--bg-tertiary); color: var(--text-primary); border-color: var(--border);"
			bind:value={filterSearch}
		/>
	{/if}

	<!-- Checkbox grid -->
	{#if isMega && groups && !filterSearch}
		<!-- Grouped layout for mega-multi -->
		{#each groups as group, gi}
			<div class="flex flex-wrap gap-1 {gi > 0 ? 'pt-1 border-t' : ''}" style="border-color: var(--border);">
				{#each group as optValue}
					{@const isHidden = optValue.startsWith('//') || optValue.startsWith('~')}
					{@const displayValue = optValue.replace(/^\/\//, '').replace(/^~/, '')}
					{#if !isHidden}
						<label
							class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs cursor-pointer select-none transition-colors"
							style="background: {selected.has(optValue) ? 'var(--accent-muted)' : 'var(--bg-tertiary)'}; color: {selected.has(optValue) ? 'var(--accent)' : 'var(--text-secondary)'}; border: 1px solid {selected.has(optValue) ? 'var(--accent)' : 'var(--border)'};"
						>
							<input
								type="checkbox"
								class="sr-only"
								checked={selected.has(optValue)}
								onchange={() => toggle(optValue)}
							/>
							{displayValue}
						</label>
					{/if}
				{/each}
			</div>
		{/each}
	{:else}
		<!-- Flat layout -->
		<div class="flex flex-wrap gap-1">
			{#each filteredOptions as opt}
				<label
					class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs cursor-pointer select-none transition-colors"
					style="background: {selected.has(opt.value) ? 'var(--accent-muted)' : 'var(--bg-tertiary)'}; color: {selected.has(opt.value) ? 'var(--accent)' : 'var(--text-secondary)'}; border: 1px solid {selected.has(opt.value) ? 'var(--accent)' : 'var(--border)'};"
				>
					<input
						type="checkbox"
						class="sr-only"
						checked={selected.has(opt.value)}
						onchange={() => toggle(opt.value)}
					/>
					{opt.display}
				</label>
			{/each}
		</div>
	{/if}
</div>
