<script lang="ts">
	import type { ColumnDef } from '$lib/schema/columns.js';
	import type { ActiveFilter, BooleanFilter, MultiFilter, RangeFilter } from '$lib/schema/filter-schema.js';
	import { urlState } from '$lib/state/url-state.svelte.js';
	import { smartFixed } from '$lib/schema/si-prefix.js';

	interface Props {
		columns: ColumnDef[];
	}

	let { columns }: Props = $props();

	interface PillInfo {
		colIndex: number;
		label: string;
		detail: string;
	}

	let pills = $derived.by(() => {
		const result: PillInfo[] = [];
		for (const [colIdx, filter] of urlState.filters) {
			const col = columns[colIdx];
			if (!col) continue;
			const label = col.display.replace(/&nbsp;/g, ' ');

			switch (filter.type) {
				case 'multi': {
					const f = filter as MultiFilter;
					const count = f.selected.size;
					const detail = count <= 3
						? [...f.selected].join(', ')
						: `${count} selected`;
					result.push({ colIndex: colIdx, label, detail: `${f.mode}: ${detail}` });
					break;
				}
				case 'boolean': {
					const f = filter as BooleanFilter;
					const parts: string[] = [];
					if (f.yes.size > 0) parts.push('with: ' + [...f.yes].join(', '));
					if (f.no.size > 0) parts.push('without: ' + [...f.no].join(', '));
					result.push({ colIndex: colIdx, label, detail: parts.join('; ') });
					break;
				}
				case 'range': {
					const f = filter as RangeFilter;
					const decimals = col.decimals ?? 0;
					const lo = smartFixed(f.min, decimals);
					const hi = smartFixed(f.max, decimals);
					result.push({ colIndex: colIdx, label, detail: `${lo} – ${hi}` });
					break;
				}
			}
		}
		return result;
	});
</script>

{#if pills.length > 0}
	<div class="flex flex-wrap gap-1.5 px-3 py-2" style="background: var(--bg-secondary);">
		{#each pills as pill}
			<span class="filter-pill">
				<strong>{pill.label}:</strong>
				<span class="truncate max-w-[200px]">{pill.detail}</span>
				<button onclick={() => urlState.clearFilter(pill.colIndex)} title="Remove filter">×</button>
			</span>
		{/each}
		{#if pills.length > 1}
			<button
				class="text-xs px-2 py-0.5 rounded cursor-pointer select-none"
				style="color: var(--danger);"
				onclick={() => urlState.clearAll()}
			>
				Clear all
			</button>
		{/if}
	</div>
{/if}
