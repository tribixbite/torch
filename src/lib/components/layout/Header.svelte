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

	let showHelp = $state(false);

	// Global keyboard shortcuts
	function handleGlobalKeydown(e: KeyboardEvent) {
		const isInput = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';

		// "/" or Ctrl+K to focus search
		if (e.key === '/' && !e.ctrlKey && !e.metaKey && !isInput) {
			e.preventDefault();
			searchInput?.focus();
		}
		if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
			e.preventDefault();
			searchInput?.focus();
		}
		// "?" to toggle help
		if (e.key === '?' && !e.ctrlKey && !e.metaKey && !isInput) {
			showHelp = !showHelp;
		}
		// Escape to close sidebar on mobile or help dialog
		if (e.key === 'Escape') {
			if (showHelp) { showHelp = false; return; }
			if (preferences.sidebarOpen) { preferences.sidebarOpen = false; }
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

	<!-- Help button -->
	<button
		class="text-sm cursor-pointer select-none opacity-60 hover:opacity-100 transition-opacity"
		style="color: var(--text-secondary);"
		onclick={() => showHelp = !showHelp}
		title="Keyboard shortcuts (?)"
	>?</button>

	<!-- Theme toggle -->
	<ThemeToggle />
</header>

<!-- Help dialog -->
{#if showHelp}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center"
		style="background: rgba(0,0,0,0.6);"
		onclick={() => showHelp = false}
		onkeydown={(e) => e.key === 'Escape' && (showHelp = false)}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="rounded-lg shadow-xl p-5 max-w-sm w-full mx-4"
			style="background: var(--bg-secondary); border: 1px solid var(--border);"
			onclick={(e) => e.stopPropagation()}
			onkeydown={() => {}}
		>
			<div class="flex justify-between items-center mb-3">
				<h3 class="font-bold text-sm" style="color: var(--text-primary);">Keyboard Shortcuts</h3>
				<button class="cursor-pointer" style="color: var(--text-muted);" onclick={() => showHelp = false}>✕</button>
			</div>
			<div class="space-y-1.5 text-xs" style="color: var(--text-secondary);">
				<div class="flex justify-between"><span><kbd class="px-1.5 py-0.5 rounded" style="background: var(--bg-tertiary); border: 1px solid var(--border);">/</kbd> or <kbd class="px-1.5 py-0.5 rounded" style="background: var(--bg-tertiary); border: 1px solid var(--border);">Ctrl+K</kbd></span><span>Focus search</span></div>
				<div class="flex justify-between"><span><kbd class="px-1.5 py-0.5 rounded" style="background: var(--bg-tertiary); border: 1px solid var(--border);">Esc</kbd></span><span>Clear / close</span></div>
				<div class="flex justify-between"><span><kbd class="px-1.5 py-0.5 rounded" style="background: var(--bg-tertiary); border: 1px solid var(--border);">?</kbd></span><span>Toggle this help</span></div>
			</div>
			<div class="mt-4 pt-3 text-xs" style="color: var(--text-muted); border-top: 1px solid var(--border);">
				Data from <a href="http://flashlights.parametrek.com" target="_blank" rel="noopener" class="underline" style="color: var(--accent);">parametrek.com</a>
			</div>
		</div>
	</div>
{/if}
