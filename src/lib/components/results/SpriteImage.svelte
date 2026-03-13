<script lang="ts">
	interface Props {
		col: number;
		row: number;
		spriteUrl: string;
		size?: number;
	}

	let { col, row, spriteUrl, size = 100 }: Props = $props();

	let x = $derived(-col * size);
	let y = $derived(-row * size);
</script>

<div
	class="flex-shrink-0 rounded"
	style="width: {size}px; height: {size}px; background-image: url('{spriteUrl}'); background-position: {x}px {y}px; background-repeat: no-repeat;"
></div>
