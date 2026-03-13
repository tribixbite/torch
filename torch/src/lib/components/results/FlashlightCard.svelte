<script lang="ts">
	import type { ColumnDef, FlashlightDB } from '$lib/schema/columns.js';
	import { urlState } from '$lib/state/url-state.svelte.js';
	import { starredState } from '$lib/state/starred.svelte.js';
	import SpriteImage from './SpriteImage.svelte';
	import { smartFixed } from '$lib/schema/si-prefix.js';

	interface Props {
		index: number;
		db: FlashlightDB;
		columns: ColumnDef[];
	}

	let { index, db, columns }: Props = $props();

	let data = $derived(db.data[index]);
	let expanded = $state(false);

	// Column indices
	let modelCol = $derived(db.head.indexOf('model'));
	let brandCol = $derived(db.head.indexOf('brand'));
	let picCol = $derived(db.head.indexOf('_pic'));
	let infoCol = $derived(db.head.indexOf('info'));
	let priceCol = $derived(db.head.indexOf('price'));
	let purchaseCol = $derived(db.head.indexOf('purchase'));
	let reviewsCol = $derived(db.head.indexOf('_reviews'));

	let model = $derived(modelCol >= 0 ? String(data[modelCol] ?? '') : '');
	let brand = $derived(brandCol >= 0 ? String(data[brandCol] ?? '') : '');
	let pic = $derived(picCol >= 0 ? data[picCol] as [number, number] : [0, 0]);
	let isStarred = $derived(starredState.isStarred(index));

	// Avoid list for detail display (same as parametrek.js)
	const avoidIds = new Set(['model', 'brand', 'info', 'purchase', 'price']);

	/** Should this column's detail row be visible? */
	function shouldShowDetail(col: ColumnDef): boolean {
		if (col.cvis === 'never') return false;
		if (avoidIds.has(col.id)) return false;
		if (col.cvis === 'always') return true;
		if (expanded) return true;
		// Show if filter is active for this column
		if (urlState.filters.has(col.index)) return true;
		// Show if linked column has active filter
		const linkCol = columns.find((c) => c.id === col.link);
		if (linkCol && urlState.filters.has(linkCol.index)) return true;
		return false;
	}

	/** Format a data value for display */
	function formatValue(col: ColumnDef, value: unknown): string {
		if (value === '' || value === null || value === undefined) return '?';

		if (Array.isArray(value)) {
			if (col.filterType === 'boolean') {
				const filtered = (value as string[]).filter(
					(x) => !x.startsWith('~') && !x.startsWith('//')
				);
				return filtered.length > 0 ? filtered.join('  ') : 'none';
			}
			const filtered = (value as string[]).filter((x) => !x.startsWith('//'));
			return filtered.join('  ');
		}

		return String(value);
	}

	/** Format with unit template */
	function formatWithUnit(col: ColumnDef, value: unknown): string {
		const display = formatValue(col, value);
		if (display === '?') return '?';

		if (col.unit === '{link}') {
			if (Array.isArray(value)) {
				return (value as string[])
					.filter((u) => u)
					.map((u) => {
						const domain = extractDomain(u);
						return `<a href="${u}" target="_blank" rel="noopener" class="underline" style="color: var(--accent);">${domain}</a>`;
					})
					.join(', ');
			}
			const url = String(value);
			const domain = extractDomain(url);
			return `<a href="${url}" target="_blank" rel="noopener" class="underline" style="color: var(--accent);">${domain}</a>`;
		}

		return col.unit.replace('{}', display);
	}

	function extractDomain(url: string): string {
		const match = url.match(/\/([a-zA-Z0-9_.-]+)\//);
		if (!match) return '';
		return match[1].replace(/^www\./, '');
	}

	function getPrice(): string {
		if (priceCol < 0) return '';
		const amount = data[priceCol];
		if (!amount && amount !== 0) return '';
		const num = Number(amount);
		const formatted = num % 1 !== 0 ? num.toFixed(2) : String(num);
		return columns[priceCol].unit.replace('{}', formatted);
	}

	function getPurchaseLinks(): string {
		if (purchaseCol < 0 || !data[purchaseCol]) return '';
		const urls = Array.isArray(data[purchaseCol]) ? data[purchaseCol] as string[] : [String(data[purchaseCol])];
		return urls
			.filter((u) => u)
			.map((u) => {
				const domain = extractDomain(u);
				return `<a href="${u}" target="_blank" rel="noopener" class="underline" style="color: var(--accent);">${domain}</a>`;
			})
			.join(', ');
	}

	function getInfoLinks(): string {
		if (infoCol < 0 || !data[infoCol]) return '';
		const urls = Array.isArray(data[infoCol]) ? data[infoCol] as string[] : [String(data[infoCol])];
		return urls
			.filter((u) => u)
			.map((u) => {
				const domain = extractDomain(u);
				return `<a href="${u}" target="_blank" rel="noopener" class="underline text-xs" style="color: var(--accent);">${domain}</a>`;
			})
			.join(', ');
	}
</script>

<div
	class="result-item flex gap-3 p-3 rounded-lg border transition-colors"
	style="background: var(--bg-secondary); border-color: var(--border);"
>
	<!-- Sprite thumbnail -->
	<SpriteImage col={pic[0]} row={pic[1]} spriteUrl={db.sprite} />

	<!-- Content -->
	<div class="flex-1 min-w-0">
		<!-- Header: model, brand, info links -->
		<div class="flex items-start gap-2">
			<div class="flex-1 min-w-0">
				<div class="flex items-center gap-1 flex-wrap">
					<button
						class="text-sm cursor-pointer select-none"
						style="color: var(--text-muted);"
						onclick={() => (expanded = !expanded)}
						title="Toggle details"
					>±</button>
					<span class="font-medium text-sm truncate" style="color: var(--text-primary);">{model}</span>
					<span class="text-xs" style="color: var(--text-secondary);">by&nbsp;{brand}</span>
					{#if getInfoLinks()}
						<span class="text-xs">({@html getInfoLinks()})</span>
					{/if}
				</div>
			</div>
			<!-- Star button -->
			<button
				class="flex-shrink-0 text-lg cursor-pointer select-none"
				style="color: {isStarred ? 'var(--star)' : 'var(--text-muted)'};"
				onclick={() => starredState.toggle(index)}
				title={isStarred ? 'Remove from favorites' : 'Add to favorites'}
			>
				{isStarred ? '★' : '☆'}
			</button>
		</div>

		<!-- Detail rows -->
		<ul class="mt-1 space-y-0">
			{#each columns as col}
				{#if shouldShowDetail(col)}
					<li class="text-xs flex gap-1" style="color: var(--text-secondary);">
						<span class="font-medium flex-shrink-0" style="color: var(--text-muted);">
							{@html col.display}:
						</span>
						<span>{@html formatWithUnit(col, data[col.index])}</span>
					</li>
				{/if}
			{/each}
		</ul>
	</div>

	<!-- Price & purchase (right column) -->
	<div class="flex-shrink-0 text-right">
		{#if getPrice()}
			<div class="font-medium text-sm" style="color: var(--text-primary);">{getPrice()}</div>
		{/if}
		{#if getPurchaseLinks()}
			<div class="text-xs mt-0.5">{@html getPurchaseLinks()}</div>
		{/if}
		{#if reviewsCol >= 0 && data[reviewsCol] && Number(data[reviewsCol]) > 0}
			<div class="text-xs mt-0.5" style="color: var(--text-muted);">
				({data[reviewsCol]} review{Number(data[reviewsCol]) > 1 ? 's' : ''})
			</div>
		{/if}
	</div>
</div>
