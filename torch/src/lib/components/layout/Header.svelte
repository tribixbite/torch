<script lang="ts">
	import { preferences } from '$lib/state/preferences.svelte.js';
	import { urlState } from '$lib/state/url-state.svelte.js';
	import ThemeToggle from './ThemeToggle.svelte';

	let searchInput: HTMLInputElement | undefined = $state();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			urlState.searchQuery = '';
			searchInput?.blur();
		}
	}

	// Global keyboard shortcuts
	function handleGlobalKeydown(e: KeyboardEvent) {
		// "/" to focus search
		if (e.key === '/' && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== 'INPUT') {
			e.preventDefault();
			searchInput?.focus();
		}
		// Escape to close sidebar on mobile
		if (e.key === 'Escape' && preferences.sidebarOpen) {
			preferences.sidebarOpen = false;
		}
	}
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<header
	class="sticky top-0 z-30 flex items-center gap-3 px-3 py-2 border-b"
	style="background: var(--bg-primary); border-color: var(--border);"
>
	<!-- Mobile menu toggle -->
	<button
		class="md:hidden text-lg cursor-pointer select-none"
		style="color: var(--text-primary);"
		onclick={() => preferences.toggleSidebar()}
		title="Toggle filters"
	>
		☰
	</button>

	<!-- Logo / Title -->
	<h1 class="text-lg font-bold whitespace-nowrap" style="color: var(--accent);">
		Torch
	</h1>

	<!-- Global text search -->
	<div class="flex-1 max-w-md">
		<input
			bind:this={searchInput}
			type="text"
			placeholder="Search flashlights... (/)"
			class="w-full px-3 py-1.5 text-sm rounded-lg border outline-none"
			style="background: var(--bg-tertiary); color: var(--text-primary); border-color: var(--border);"
			bind:value={urlState.searchQuery}
			onkeydown={handleKeydown}
		/>
	</div>

	<!-- Theme toggle -->
	<ThemeToggle />
</header>
