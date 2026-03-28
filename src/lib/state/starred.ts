/**
 * Starred/pinned flashlights store — persisted in localStorage.
 */
import { create } from 'zustand';

const STORAGE_KEY = 'torch-starred';

interface StarredState {
	starred: Set<number>;
	showStarredOnly: boolean;
	toggle: (index: number) => void;
	isStarred: (index: number) => boolean;
	clear: () => void;
	setShowStarredOnly: (show: boolean) => void;
}

/** Load initial state from localStorage */
function loadInitial(): Set<number> {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) return new Set(JSON.parse(stored) as number[]);
	} catch {
		// ignore corrupted localStorage
	}
	return new Set();
}

/** Persist to localStorage */
function persistStarred(starred: Set<number>): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([...starred]));
	} catch {
		// storage full or unavailable
	}
}

const initialStarred = typeof window !== 'undefined' ? loadInitial() : new Set<number>();

export const useStarred = create<StarredState>()((set, get) => ({
	starred: initialStarred,
	showStarredOnly: false,

	toggle: (index) => {
		const next = new Set(get().starred);
		if (next.has(index)) {
			next.delete(index);
		} else {
			next.add(index);
		}
		persistStarred(next);
		set({ starred: next });
	},

	isStarred: (index) => get().starred.has(index),

	clear: () => {
		const empty = new Set<number>();
		persistStarred(empty);
		set({ starred: empty });
	},

	setShowStarredOnly: (show) => set({ showStarredOnly: show }),
}));
