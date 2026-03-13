<script lang="ts">
	import type { ColumnDef } from '$lib/schema/columns.js';

	interface Props {
		columns: ColumnDef[];
		onselect: (colIndex: number) => void;
	}

	let { columns, onselect }: Props = $props();

	let query = $state('');
	let open = $state(false);

	interface Match {
		colIndex: number;
		label: string;
		matchType: 'column' | 'option';
		optionValue?: string;
	}

	let matches = $derived.by(() => {
		if (!query || query.length < 1) return [];
		const q = query.toLowerCase();
		const result: Match[] = [];

		for (const col of columns) {
			if (!col.filterType || col.filterType === 'multiple') continue;
			if (!col.searchable) continue;

			// Match column name
			const display = col.display.replace(/&nbsp;/g, ' ');
			if (display.toLowerCase().includes(q)) {
				result.push({ colIndex: col.index, label: display, matchType: 'column' });
			}

			// Match option values
			if (col.options) {
				for (const opt of col.options) {
					if (opt === '<br>' || opt.startsWith('~')) continue;
					const cleanOpt = opt.replace(/^\/\//, '');
					if (cleanOpt.toLowerCase().includes(q)) {
						result.push({
							colIndex: col.index,
							label: display,
							matchType: 'option',
							optionValue: cleanOpt
						});
					}
				}
			}

			if (result.length >= 20) break;
		}

		return result;
	});

	function select(match: Match) {
		onselect(match.colIndex);
		query = '';
		open = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			query = '';
			open = false;
		}
	}
</script>

<div class="relative">
	<input
		type="text"
		placeholder="Search filters..."
		class="w-full px-3 py-1.5 text-sm rounded-lg border outline-none"
		style="background: var(--bg-tertiary); color: var(--text-primary); border-color: var(--border);"
		bind:value={query}
		onfocus={() => (open = true)}
		onblur={() => setTimeout(() => (open = false), 200)}
		onkeydown={handleKeydown}
	/>

	{#if open && matches.length > 0}
		<div
			class="absolute top-full left-0 right-0 mt-1 rounded-lg border shadow-lg max-h-64 overflow-y-auto z-50"
			style="background: var(--bg-elevated); border-color: var(--border);"
		>
			{#each matches as match}
				<button
					class="w-full text-left px-3 py-1.5 text-sm hover:opacity-80 cursor-pointer flex items-center gap-2"
					style="color: var(--text-primary);"
					onmousedown={() => select(match)}
				>
					<span class="text-xs px-1 rounded" style="background: var(--accent-muted); color: var(--accent);">
						{match.label}
					</span>
					{#if match.matchType === 'option'}
						<span style="color: var(--text-secondary);">{match.optionValue}</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
