<script lang="ts">
	import type { LogicMode } from '$lib/schema/filter-schema.js';

	interface Props {
		modes: string[];
		current: LogicMode;
		onchange: (mode: LogicMode) => void;
	}

	let { modes, current, onchange }: Props = $props();

	function cycle() {
		const idx = modes.indexOf(current);
		const next = modes[(idx + 1) % modes.length] as LogicMode;
		onchange(next);
	}
</script>

{#if modes.length > 1}
	<button
		class="px-2 py-0.5 text-xs font-mono rounded border cursor-pointer select-none transition-colors"
		style="background: var(--bg-elevated); color: var(--accent); border-color: var(--accent);"
		onclick={cycle}
		title="Click to cycle filter mode: {modes.join(' → ')}"
	>
		{current}
	</button>
{/if}
