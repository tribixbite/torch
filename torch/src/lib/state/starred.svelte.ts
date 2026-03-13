/**
 * Starred/pinned flashlights — persisted in localStorage.
 */

const STORAGE_KEY = 'torch-starred';

class StarredState {
	starred = $state<Set<number>>(new Set());
	showStarredOnly = $state(false);

	constructor() {
		if (typeof window !== 'undefined') {
			try {
				const stored = localStorage.getItem(STORAGE_KEY);
				if (stored) {
					this.starred = new Set(JSON.parse(stored));
				}
			} catch {
				// ignore corrupted localStorage
			}
		}
	}

	toggle(index: number) {
		const next = new Set(this.starred);
		if (next.has(index)) {
			next.delete(index);
		} else {
			next.add(index);
		}
		this.starred = next;
		this.persist();
	}

	isStarred(index: number): boolean {
		return this.starred.has(index);
	}

	clear() {
		this.starred = new Set();
		this.persist();
	}

	private persist() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.starred]));
		} catch {
			// storage full or unavailable
		}
	}
}

export const starredState = new StarredState();
