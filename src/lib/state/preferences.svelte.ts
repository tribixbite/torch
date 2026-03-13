/**
 * User preferences — theme, view mode. Persisted in localStorage.
 */

const PREFS_KEY = 'torch-prefs';

export type Theme = 'light' | 'dark' | 'system';
export type ViewMode = 'card' | 'table';

class Preferences {
	theme = $state<Theme>('dark');
	viewMode = $state<ViewMode>('card');
	sidebarOpen = $state(false);

	constructor() {
		if (typeof window !== 'undefined') {
			try {
				const stored = localStorage.getItem(PREFS_KEY);
				if (stored) {
					const prefs = JSON.parse(stored);
					if (prefs.theme) this.theme = prefs.theme;
					if (prefs.viewMode) this.viewMode = prefs.viewMode;
				}
			} catch {
				// ignore
			}
			this.applyTheme();
		}
	}

	setTheme(theme: Theme) {
		this.theme = theme;
		this.applyTheme();
		this.persist();
	}

	setViewMode(mode: ViewMode) {
		this.viewMode = mode;
		this.persist();
	}

	toggleSidebar() {
		this.sidebarOpen = !this.sidebarOpen;
	}

	private applyTheme() {
		if (typeof document === 'undefined') return;
		const resolved = this.theme === 'system'
			? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
			: this.theme;
		document.documentElement.setAttribute('data-theme', resolved);
	}

	private persist() {
		try {
			localStorage.setItem(PREFS_KEY, JSON.stringify({
				theme: this.theme,
				viewMode: this.viewMode
			}));
		} catch {
			// storage full
		}
	}
}

export const preferences = new Preferences();
