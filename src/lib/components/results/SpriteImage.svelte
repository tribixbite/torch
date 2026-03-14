<script lang="ts">
	interface Props {
		col: number;
		row: number;
		spriteUrl: string;
		/** Direct image URL (used when sprite sheet is unavailable) */
		imageUrl?: string;
		size?: number;
	}

	let { col, row, spriteUrl, imageUrl, size = 100 }: Props = $props();

	let x = $derived(-col * size);
	let y = $derived(-row * size);
	let useSprite = $derived(spriteUrl && spriteUrl.length > 0);
</script>

{#if useSprite}
	<div
		class="flex-shrink-0 rounded"
		style="width: {size}px; height: {size}px; background-image: url('{spriteUrl}'); background-position: {x}px {y}px; background-repeat: no-repeat;"
	></div>
{:else if imageUrl}
	<img
		src={imageUrl}
		alt=""
		loading="lazy"
		class="flex-shrink-0 rounded object-contain"
		style="width: {size}px; height: {size}px; background: var(--bg-tertiary);"
	/>
{:else}
	<div
		class="flex-shrink-0 rounded flex items-center justify-center text-xs"
		style="width: {size}px; height: {size}px; background: var(--bg-tertiary); color: var(--text-muted);"
	>
		no img
	</div>
{/if}
