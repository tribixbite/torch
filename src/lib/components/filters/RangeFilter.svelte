<script lang="ts">
	import type { ColumnDef } from '$lib/schema/columns.js';
	import type { RangeFilter as RangeFilterType } from '$lib/schema/filter-schema.js';
	import { urlState } from '$lib/state/url-state.svelte.js';
	import { smartFixed } from '$lib/schema/si-prefix.js';

	interface Props {
		column: ColumnDef;
		isLog?: boolean;
	}

	let { column, isLog = false }: Props = $props();

	let filter = $derived(urlState.filters.get(column.index) as RangeFilterType | undefined);

	let boundsMin = $derived(column.min ?? 0);
	let boundsMax = $derived(column.max ?? 100);
	let decimals = $derived(column.decimals ?? 0);

	let currentMin = $derived(filter?.min ?? boundsMin);
	let currentMax = $derived(filter?.max ?? boundsMax);
	let showUnknown = $derived(filter?.showUnknown ?? false);

	// Slider percentages
	let lowerPerc = $state(0);
	let upperPerc = $state(1);
	let dragging = $state<'lower' | 'upper' | null>(null);
	let trackEl: HTMLDivElement | undefined = $state();

	// Sync state from filter changes
	$effect(() => {
		if (!dragging) {
			lowerPerc = valueToPerc(currentMin);
			upperPerc = valueToPerc(currentMax);
		}
	});

	// Log slider math (exact from parametrek.js):
	// b = min - 1; m = max - b
	// forward: value = m^perc + b
	// reverse: perc = log(value - b) / log(m)
	function percToValue(perc: number): number {
		if (isLog) {
			const b = boundsMin - 1;
			const m = boundsMax - b;
			return Math.pow(m, perc) + b;
		}
		return perc * (boundsMax - boundsMin) + boundsMin;
	}

	function valueToPerc(value: number): number {
		if (isLog) {
			const b = boundsMin - 1;
			const m = boundsMax - b;
			if (value <= b) return 0;
			return Math.log(value - b) / Math.log(m);
		}
		const range = boundsMax - boundsMin;
		if (range === 0) return 0;
		return (value - boundsMin) / range;
	}

	function formatValue(value: number): string {
		// Handle {si} prefix units like "{si}lm", "{si}h", "{si}Wh"
		if (column.unit && column.unit.startsWith('{si}')) {
			const suffix = column.unit.slice(4);
			return smartFixed(value, '{si}') + suffix;
		}
		const formatted = smartFixed(value, decimals);
		if (!column.unit || !column.unit.includes('{}')) return formatted;
		return column.unit.replace('{}', formatted);
	}

	function handlePointerDown(e: PointerEvent, which: 'lower' | 'upper') {
		e.preventDefault();
		dragging = which;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!dragging || !trackEl) return;
		const rect = trackEl.getBoundingClientRect();
		let perc = (e.clientX - rect.left) / rect.width;
		perc = Math.max(0, Math.min(1, perc));

		if (dragging === 'lower') {
			lowerPerc = Math.min(perc, upperPerc);
		} else {
			upperPerc = Math.max(perc, lowerPerc);
		}
	}

	function handlePointerUp() {
		if (!dragging) return;
		dragging = null;
		commitValues();
	}

	function handleTrackClick(e: MouseEvent) {
		if (!trackEl) return;
		const rect = trackEl.getBoundingClientRect();
		const perc = (e.clientX - rect.left) / rect.width;
		// Move whichever thumb is closer
		if (Math.abs(perc - lowerPerc) < Math.abs(perc - upperPerc)) {
			lowerPerc = perc;
		} else {
			upperPerc = perc;
		}
		commitValues();
	}

	function commitValues() {
		const minVal = percToValue(lowerPerc);
		const maxVal = percToValue(upperPerc);
		const minActive = lowerPerc > 0.001;
		const maxActive = upperPerc < 0.999;
		urlState.setRangeFilter(column.index, minVal, maxVal, minActive, maxActive, showUnknown);
	}

	function toggleShowUnknown() {
		const minVal = percToValue(lowerPerc);
		const maxVal = percToValue(upperPerc);
		const minActive = lowerPerc > 0.001;
		const maxActive = upperPerc < 0.999;
		urlState.setRangeFilter(column.index, minVal, maxVal, minActive, maxActive, !showUnknown);
	}

	function setSort(direction: 'inc' | 'dec') {
		urlState.setSort(column.index, direction);
	}

	// Display values
	let displayMin = $derived(formatValue(percToValue(lowerPerc)));
	let displayMax = $derived(formatValue(percToValue(upperPerc)));
</script>

<div class="space-y-2">
	<!-- Value labels -->
	<div class="flex justify-between text-xs" style="color: var(--text-secondary);">
		<span>{displayMin}</span>
		<span>{displayMax}</span>
	</div>

	<!-- Double-thumb slider -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="range-track"
		bind:this={trackEl}
		onclick={handleTrackClick}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
	>
		<div
			class="range-fill"
			style="left: {lowerPerc * 100}%; width: {(upperPerc - lowerPerc) * 100}%;"
		></div>
		<div
			class="range-thumb"
			role="slider"
			tabindex="0"
			aria-label="{column.display} minimum"
			aria-valuemin={boundsMin}
			aria-valuemax={boundsMax}
			aria-valuenow={percToValue(lowerPerc)}
			style="left: {lowerPerc * 100}%;"
			onpointerdown={(e) => handlePointerDown(e, 'lower')}
		></div>
		<div
			class="range-thumb"
			role="slider"
			tabindex="0"
			aria-label="{column.display} maximum"
			aria-valuemin={boundsMin}
			aria-valuemax={boundsMax}
			aria-valuenow={percToValue(upperPerc)}
			style="left: {upperPerc * 100}%;"
			onpointerdown={(e) => handlePointerDown(e, 'upper')}
		></div>
	</div>

	<!-- Sort arrows + show unknown toggle -->
	<div class="flex gap-2 justify-between items-center">
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
		{#if column.sortable}
			<div class="flex gap-2">
				<button
					class="text-xs cursor-pointer select-none px-1"
					style="color: {urlState.sort.column === column.index && urlState.sort.direction === 'inc' ? 'var(--accent)' : 'var(--text-muted)'};"
					onclick={() => setSort('inc')}
					title="Sort ascending"
				>&#9650;</button>
				<button
					class="text-xs cursor-pointer select-none px-1"
					style="color: {urlState.sort.column === column.index && urlState.sort.direction === 'dec' ? 'var(--accent)' : 'var(--text-muted)'};"
					onclick={() => setSort('dec')}
					title="Sort descending"
				>&#9660;</button>
			</div>
		{/if}
	</div>
</div>
