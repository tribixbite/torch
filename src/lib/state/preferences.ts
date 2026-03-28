/**
 * User preferences store — theme, view mode, sidebar. Persisted in localStorage.
 */
import { create } from 'zustand';

export type Theme = 'light' | 'dark' | 'system';
export type ViewMode = 'card' | 'table';

const PREFS_KEY = 'torch-prefs';

interface PreferencesState {
	theme: Theme;
	viewMode: ViewMode;
	sidebarOpen: boolean;
	setTheme: (theme: Theme) => void;
	setViewMode: (mode: ViewMode) => void;
	toggleSidebar: () => void;
	setSidebarOpen: (open: boolean) => void;
}

/** Apply resolved theme to the DOM */
function applyTheme(theme: Theme): void {
	if (typeof document === 'undefined') return;
	const resolved = theme === 'system'
		? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
		: theme;
	document.documentElement.setAttribute('data-theme', resolved);
}

/** Persist to localStorage */
function persist(state: { theme: Theme; viewMode: ViewMode }): void {
	try {
		localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: state.theme, viewMode: state.viewMode }));
	} catch {
		// storage full or unavailable
	}
}

/** Load initial state from localStorage */
function loadInitial(): { theme: Theme; viewMode: ViewMode } {
	try {
		const stored = localStorage.getItem(PREFS_KEY);
		if (stored) {
			const prefs = JSON.parse(stored);
			return {
				theme: prefs.theme ?? 'dark',
				viewMode: prefs.viewMode ?? 'card'
			};
		}
	} catch {
		// ignore
	}
	return { theme: 'dark', viewMode: 'card' };
}

const initial = typeof window !== 'undefined' ? loadInitial() : { theme: 'dark' as Theme, viewMode: 'card' as ViewMode };

// Apply theme on load
if (typeof window !== 'undefined') {
	applyTheme(initial.theme);
}

export const usePreferences = create<PreferencesState>()((set, get) => ({
	theme: initial.theme,
	viewMode: initial.viewMode,
	sidebarOpen: false,

	setTheme: (theme) => {
		applyTheme(theme);
		set({ theme });
		persist({ theme, viewMode: get().viewMode });
	},

	setViewMode: (viewMode) => {
		set({ viewMode });
		persist({ theme: get().theme, viewMode });
	},

	toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
	setSidebarOpen: (open) => set({ sidebarOpen: open }),
}));
