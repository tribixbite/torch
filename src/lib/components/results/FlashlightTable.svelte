<script lang="ts">
	import type { ColumnDef, FlashlightDB } from '$lib/schema/columns.js';
	import { starredState } from '$lib/state/starred.svelte.js';
	import SpriteImage from './SpriteImage.svelte';

	interface Props {
		index: number;
		db: FlashlightDB;
		columns: ColumnDef[];
	}

	let { index, db, columns }: Props = $props();

	let data = $derived(db.data[index]);
	let modelCol = $derived(db.head.indexOf('model'));
	let brandCol = $derived(db.head.indexOf('brand'));
	let picCol = $derived(db.head.indexOf('_pic'));
	let priceCol = $derived(db.head.indexOf('price'));
	let lumensCol = $derived(db.head.indexOf('lumens'));
	let weightCol = $derived(db.head.indexOf('weight'));
	let batteryCol = $derived(db.head.indexOf('battery'));

	let picRaw = $derived(picCol >= 0 ? data[picCol] : null);
	let picIsSprite = $derived(picRaw != null && typeof picRaw === 'object' && (picRaw as any).length === 2);
	let pic = $derived(picIsSprite ? [Number((picRaw as any)[0]), Number((picRaw as any)[1])] as [number, number] : [0, 0] as [number, number]);
	let isStarred = $derived(starredState.isStarred(index));

	/** Proxy-safe array check — Svelte 5 $state proxied arrays fail Array.isArray() */
	function isArrayLike(v: unknown): v is unknown[] {
		return Array.isArray(v) || (v !== null && typeof v === 'object' && 'length' in v && typeof (v as any).length === 'number' && !(v instanceof String));
	}

	function formatArray(val: unknown): string {
		if (isArrayLike(val)) return (val as unknown[]).filter((x) => typeof x !== 'string' || !x.startsWith('//')).join(', ');
		return val != null && val !== '' ? String(val) : '?';
	}
</script>

<div
	class="result-item flex items-center gap-2 px-2 py-1 border-b text-xs"
	style="border-color: var(--border);"
>
	<SpriteImage col={pic[0]} row={pic[1]} spriteUrl={picIsSprite ? db.sprite : ''} size={40} />
	<span class="w-[120px] truncate font-medium" style="color: var(--text-primary);">
		{data[modelCol] ?? ''}
	</span>
	<span class="w-[100px] truncate" style="color: var(--text-secondary);">
		{data[brandCol] ?? ''}
	</span>
	<span class="w-[80px] truncate" style="color: var(--text-secondary);">
		{lumensCol >= 0 ? formatArray(data[lumensCol]) : ''}
	</span>
	<span class="w-[80px] truncate" style="color: var(--text-secondary);">
		{weightCol >= 0 ? (data[weightCol] ? data[weightCol] + 'g' : '?') : ''}
	</span>
	<span class="w-[100px] truncate" style="color: var(--text-secondary);">
		{batteryCol >= 0 ? formatArray(data[batteryCol]) : ''}
	</span>
	<span class="w-[60px] text-right" style="color: var(--text-primary);">
		{priceCol >= 0 && data[priceCol] ? '$' + data[priceCol] : ''}
	</span>
	<button
		class="ml-auto cursor-pointer select-none"
		style="color: {isStarred ? 'var(--star)' : 'var(--text-muted)'};"
		onclick={() => starredState.toggle(index)}
	>
		{isStarred ? '★' : '☆'}
	</button>
</div>
