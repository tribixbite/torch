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
		class="flex-shrink-0 rounded flex items-center justify-center"
		style="width: {size}px; height: {size}px; background: var(--bg-tertiary);"
	>
		<!-- Minimal flashlight silhouette placeholder -->
		<svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path d="M9 2h6v3l2 3v4a2 2 0 0 1-2 2h-2v8a1 1 0 0 1-2 0v-8H9a2 2 0 0 1-2-2V8l2-3V2z" fill="var(--text-muted)" opacity="0.3"/>
			<circle cx="12" cy="3" r="1" fill="var(--text-muted)" opacity="0.5"/>
		</svg>
	</div>
{/if}
