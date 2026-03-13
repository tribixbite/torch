<script lang="ts">
	import { preferences, type Theme } from '$lib/state/preferences.svelte.js';

	const themes: { value: Theme; label: string; icon: string }[] = [
		{ value: 'light', label: 'Light', icon: '☀' },
		{ value: 'dark', label: 'Dark', icon: '☾' },
		{ value: 'system', label: 'System', icon: '◐' }
	];
</script>

<div class="flex rounded-lg border overflow-hidden" style="border-color: var(--border);">
	{#each themes as t}
		<button
			class="px-2 py-1 text-xs cursor-pointer select-none transition-colors"
			style="background: {preferences.theme === t.value ? 'var(--accent)' : 'var(--bg-tertiary)'}; color: {preferences.theme === t.value ? 'var(--bg-primary)' : 'var(--text-secondary)'};"
			onclick={() => preferences.setTheme(t.value)}
			title={t.label}
		>
			{t.icon}
		</button>
	{/each}
</div>
