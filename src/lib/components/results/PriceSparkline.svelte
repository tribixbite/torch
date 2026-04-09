<script lang="ts">
	interface Props {
		path: string;
		atLow?: boolean;
	}

	let { path, atLow = false }: Props = $props();

	// Extract last Y coordinate from SVG path for the end dot
	let lastY = $derived(() => {
		const match = path.match(/[\s,](\d+\.?\d*)$/);
		return match ? parseFloat(match[1]) : 10;
	});
</script>

{#if path}
<svg viewBox="0 0 50 20" class="sparkline" class:at-low={atLow}>
	<path d={path} fill="none" stroke="currentColor" stroke-width="1.2" />
	<circle cx="50" cy={lastY()} r="1.5" fill="currentColor" />
</svg>
{/if}

<style>
	.sparkline {
		width: 60px;
		height: 24px;
		color: var(--text-muted);
		vertical-align: middle;
		flex-shrink: 0;
	}
	.sparkline.at-low {
		color: var(--deal-green, #4ade80);
	}
</style>
