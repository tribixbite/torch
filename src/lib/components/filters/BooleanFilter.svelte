<script lang="ts">
	import type { ColumnDef } from '$lib/schema/columns.js';
	import type { BooleanFilter as BooleanFilterType } from '$lib/schema/filter-schema.js';
	import { urlState } from '$lib/state/url-state.svelte.js';
	import LogicModeButton from './LogicModeButton.svelte';

	interface Props {
		column: ColumnDef;
	}

	let { column }: Props = $props();

	let filter = $derived(urlState.filters.get(column.index) as BooleanFilterType | undefined);
	let yesSet = $derived(filter?.yes ?? new Set<string>());
	let noSet = $derived(filter?.no ?? new Set<string>());
	let mode = $derived(filter?.mode ?? (column.modes[0] as 'all' | 'any'));
	let showUnknown = $derived(filter?.showUnknown ?? false);

	// Get visible boolean options (exclude ~ prefixed ones)
	let visibleOptions = $derived(
		(column.options ?? []).filter((o) => !o.startsWith('~') && o !== '<br>')
	);

	function toggleYes(value: string) {
		const nextYes = new Set(yesSet);
		const nextNo = new Set(noSet);
		if (nextYes.has(value)) {
			nextYes.delete(value);
		} else {
			nextYes.add(value);
			nextNo.delete(value); // NAND: can't be both yes and no
		}
		urlState.setBooleanFilter(column.index, nextYes, nextNo, mode, showUnknown);
	}

	function toggleNo(value: string) {
		const nextYes = new Set(yesSet);
		const nextNo = new Set(noSet);
		if (nextNo.has(value)) {
			nextNo.delete(value);
		} else {
			nextNo.add(value);
			nextYes.delete(value); // NAND
		}
		urlState.setBooleanFilter(column.index, nextYes, nextNo, mode, showUnknown);
	}

	function changeMode(newMode: string) {
		urlState.setBooleanFilter(column.index, yesSet, noSet, newMode as 'all' | 'any', showUnknown);
	}

	function toggleShowUnknown() {
		urlState.setBooleanFilter(column.index, yesSet, noSet, mode, !showUnknown);
	}
</script>

<div class="space-y-1">
	<div class="flex items-center gap-2">
		<LogicModeButton modes={column.modes} current={mode} onchange={changeMode} />
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
	</div>

	<div class="space-y-0.5">
		{#each visibleOptions as opt}
			<div class="flex items-center gap-2 py-0.5">
				<span class="text-xs min-w-[100px] truncate" style="color: var(--text-secondary);">{opt}</span>
				<!-- Yes button -->
				<button
					class="px-2 py-0.5 text-xs rounded border cursor-pointer select-none transition-colors"
					style="background: {yesSet.has(opt) ? 'var(--success)' : 'var(--bg-tertiary)'}; color: {yesSet.has(opt) ? '#fff' : 'var(--text-muted)'}; border-color: {yesSet.has(opt) ? 'var(--success)' : 'var(--border)'};"
					onclick={() => toggleYes(opt)}
				>
					yes
				</button>
				<!-- No button -->
				<button
					class="px-2 py-0.5 text-xs rounded border cursor-pointer select-none transition-colors"
					style="background: {noSet.has(opt) ? 'var(--danger)' : 'var(--bg-tertiary)'}; color: {noSet.has(opt) ? '#fff' : 'var(--text-muted)'}; border-color: {noSet.has(opt) ? 'var(--danger)' : 'var(--border)'};"
					onclick={() => toggleNo(opt)}
				>
					no
				</button>
			</div>
		{/each}
	</div>
</div>
