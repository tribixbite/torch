<script lang="ts">
	import type { ColumnDef, FlashlightDB } from '$lib/schema/columns.js';
	import { urlState } from '$lib/state/url-state.svelte.js';
	import { starredState } from '$lib/state/starred.svelte.js';
	import SpriteImage from './SpriteImage.svelte';
	import { smartFixed } from '$lib/schema/si-prefix.js';

	/** Proxy-safe array check — Svelte 5 $state proxied arrays fail Array.isArray() */
	function isArrayLike(v: unknown): v is unknown[] {
		return Array.isArray(v) || (v !== null && typeof v === 'object' && 'length' in v && typeof (v as any).length === 'number' && !(v instanceof String));
	}

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
	// _pic can be [col, row] sprite coords OR a direct image URL string
	// Note: Array.isArray() returns false for Svelte 5 proxied arrays, so check typeof + length
	let picRaw = $derived(picCol >= 0 ? data[picCol] : null);
	let picIsSprite = $derived(picRaw != null && typeof picRaw === 'object' && (picRaw as any).length === 2);
	let picCoords = $derived(picIsSprite ? [Number((picRaw as any)[0]), Number((picRaw as any)[1])] as [number, number] : [0, 0] as [number, number]);
	let picUrl = $derived(!picIsSprite && typeof picRaw === 'string' && picRaw ? picRaw : '');
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

		if (isArrayLike(value)) {
			if (col.filterType === 'boolean') {
				const filtered = value.filter(
					(x) => typeof x !== 'string' || (!x.startsWith('~') && !x.startsWith('//'))
				);
				return filtered.length > 0 ? filtered.join('  ') : 'none';
			}
			const filtered = value.filter((x) => typeof x !== 'string' || !x.startsWith('//'));
			return filtered.join('  ');
		}

		return String(value);
	}

	/** Format with unit template */
	function formatWithUnit(col: ColumnDef, value: unknown): string {
		const display = formatValue(col, value);
		if (display === '?') return '?';

		if (col.unit === '{link}') {
			if (isArrayLike(value)) {
				return (value as string[])
					.filter((u) => u && isSafeUrl(u))
					.map((u) => {
						const domain = extractDomain(u);
						return `<a href="${u}" target="_blank" rel="noopener" class="underline" style="color: var(--accent);">${domain}</a>`;
					})
					.join(', ');
			}
			const url = String(value);
			if (!isSafeUrl(url)) return extractDomain(url) || '?';
			const domain = extractDomain(url);
			return `<a href="${url}" target="_blank" rel="noopener" class="underline" style="color: var(--accent);">${domain}</a>`;
		}

		// Handle {si} prefix units like "{si}lm", "{si}h", "{si}Wh"
		if (col.unit && col.unit.startsWith('{si}')) {
			const suffix = col.unit.slice(4); // e.g. "lm", "h", "Wh"
			const num = typeof value === 'number' ? value : parseFloat(String(value));
			if (isNaN(num)) return display + suffix;
			return smartFixed(num, '{si}') + suffix;
		}

		// If unit template is empty or has no {} placeholder, return raw display value
		if (!col.unit || !col.unit.includes('{}')) return display;
		return col.unit.replace('{}', display);
	}

	/** Validate URL uses a safe protocol (no javascript:, data:, etc.) */
	function isSafeUrl(url: string): boolean {
		try {
			const parsed = new URL(url);
			return parsed.protocol === 'http:' || parsed.protocol === 'https:';
		} catch {
			return false;
		}
	}

	function extractDomain(url: string): string {
		try {
			const parsed = new URL(url);
			return parsed.hostname.replace(/^www\./, '');
		} catch {
			return '';
		}
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
		const urls = isArrayLike(data[purchaseCol]) ? data[purchaseCol] as string[] : [String(data[purchaseCol])];
		return urls
			.filter((u) => u && isSafeUrl(u))
			.map((u) => {
				const domain = extractDomain(u);
				return `<a href="${u}" target="_blank" rel="noopener" class="underline" style="color: var(--accent);">${domain}</a>`;
			})
			.join(', ');
	}

	function getInfoLinks(): string {
		if (infoCol < 0 || !data[infoCol]) return '';
		const urls = isArrayLike(data[infoCol]) ? data[infoCol] as string[] : [String(data[infoCol])];
		return urls
			.filter((u) => u && isSafeUrl(u))
			.map((u) => {
				const domain = extractDomain(u);
				return `<a href="${u}" target="_blank" rel="noopener" class="underline text-xs" style="color: var(--accent);">${domain}</a>`;
			})
			.join(', ');
	}
</script>

<div class="result-item-wrap">
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="card-row"
	onclick={(e) => {
		// Don't toggle if user clicked a link, button (star), or interactive element
		const t = e.target as HTMLElement;
		if (t.closest('a') || t.closest('.card-star') || t.closest('.card-purchase')) return;
		expanded = !expanded;
	}}
>
	<!-- Sprite thumbnail -->
	<div class="card-thumb">
		<SpriteImage col={picCoords[0]} row={picCoords[1]} spriteUrl={db.sprite} imageUrl={picUrl} />
	</div>

	<!-- Content -->
	<div class="card-body">
		<!-- Header row: expand toggle, model name, brand, star, price -->
		<div class="card-header">
			<button
				class="card-expand"
				onclick={(e) => { e.stopPropagation(); expanded = !expanded; }}
				title="Toggle details"
			>{expanded ? '−' : '+'}</button>
			<span class="card-model">{model}</span>
			<span class="card-brand">by {brand}</span>
			{#if getInfoLinks()}
				<span class="card-info">({@html getInfoLinks()})</span>
			{/if}
			<span class="card-spacer"></span>
			<button
				class="card-star"
				class:starred={isStarred}
				onclick={() => starredState.toggle(index)}
				title={isStarred ? 'Remove from favorites' : 'Add to favorites'}
			>
				{isStarred ? '★' : '☆'}
			</button>
			{#if getPrice()}
				<span class="card-price">{getPrice()}</span>
			{/if}
		</div>

		<!-- Detail rows -->
		<div class="card-details">
			{#each columns as col}
				{#if shouldShowDetail(col)}
					<span class="card-detail">
						<span class="detail-label">{@html col.display}:</span>
						{@html formatWithUnit(col, data[col.index])}
					</span>
				{/if}
			{/each}
		</div>

		<!-- Purchase links -->
		{#if getPurchaseLinks() || (reviewsCol >= 0 && data[reviewsCol] && !isNaN(Number(data[reviewsCol])) && Number(data[reviewsCol]) > 0)}
			<div class="card-purchase">
				{#if getPurchaseLinks()}
					<span>{@html getPurchaseLinks()}</span>
				{/if}
				{#if reviewsCol >= 0 && data[reviewsCol] && !isNaN(Number(data[reviewsCol])) && Number(data[reviewsCol]) > 0}
					<span class="card-reviews">({data[reviewsCol]} review{Number(data[reviewsCol]) > 1 ? 's' : ''})</span>
				{/if}
			</div>
		{/if}
	</div>
</div>
</div>

<style>
	.card-row {
		display: flex;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		border: 1px solid var(--border);
		background: var(--bg-secondary);
		transition: border-color 0.15s;
		cursor: pointer;
	}
	.card-row:hover {
		border-color: var(--border-hover);
	}

	.card-thumb {
		flex-shrink: 0;
	}

	.card-body {
		flex: 1;
		min-width: 0;
	}

	.card-header {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	.card-expand {
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		color: var(--text-muted);
		background: none;
		border: none;
		padding: 0.25rem;
		min-width: 1.5rem;
		min-height: 1.5rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		user-select: none;
		border-radius: 0.25rem;
	}
	.card-expand:hover {
		color: var(--text-primary);
		background: var(--bg-tertiary, rgba(255,255,255,0.05));
	}

	.card-model {
		font-weight: 600;
		font-size: 0.875rem;
		color: var(--text-primary);
		white-space: nowrap;
	}

	.card-brand {
		font-size: 0.75rem;
		color: var(--text-secondary);
		white-space: nowrap;
	}

	.card-info {
		font-size: 0.7rem;
		color: var(--text-muted);
	}

	.card-spacer {
		flex: 1;
	}

	.card-star {
		font-size: 1rem;
		cursor: pointer;
		color: var(--text-muted);
		background: none;
		border: none;
		padding: 0;
		user-select: none;
		flex-shrink: 0;
	}
	.card-star.starred {
		color: var(--star);
	}

	.card-price {
		font-weight: 600;
		font-size: 0.875rem;
		color: var(--text-primary);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.card-details {
		margin-top: 0.125rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.125rem 0.75rem;
		font-size: 0.75rem;
		color: var(--text-secondary);
		line-height: 1.4;
	}

	.detail-label {
		color: var(--text-muted);
		font-weight: 500;
		margin-right: 0.2rem;
	}

	.card-purchase {
		margin-top: 0.25rem;
		font-size: 0.7rem;
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		flex-wrap: wrap;
	}

	.card-reviews {
		color: var(--text-muted);
	}

	/* Mobile: smaller thumb, tighter spacing */
	@media (max-width: 640px) {
		.card-row {
			padding: 0.375rem 0.5rem;
			gap: 0.5rem;
		}
	}
</style>
