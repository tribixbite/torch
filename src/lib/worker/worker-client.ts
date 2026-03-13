/**
 * Promise-based wrapper for the filter Web Worker.
 * Handles message sequencing and cancellation.
 */

import type { FilterMessage, FilterResult, SerializedFilters, SortState } from '../schema/filter-schema.js';

export class FilterWorkerClient {
	private worker: Worker;
	private seq = 0;
	private pending = new Map<number, (result: FilterResult) => void>();

	constructor() {
		this.worker = new Worker(
			new URL('./filter-worker.ts', import.meta.url),
			{ type: 'module' }
		);
		this.worker.onmessage = (e: MessageEvent<FilterResult>) => {
			const { id } = e.data;
			const resolve = this.pending.get(id);
			if (resolve) {
				this.pending.delete(id);
				resolve(e.data);
			}
		};
	}

	/** Send the full DB to the worker for initialization */
	init(db: unknown): Promise<FilterResult> {
		return this.send({ type: 'init', id: 0, db });
	}

	/** Run a filter/sort/search query, cancelling any previous pending */
	filter(
		filters: SerializedFilters,
		sort: SortState,
		searchQuery?: string
	): Promise<FilterResult> {
		// Cancel all pending filter requests — only the latest matters
		for (const [id, resolve] of this.pending) {
			if (id > 0) {
				// Resolve with empty result so promises don't hang
				resolve({ id, indices: [], count: 0, timing: 0 });
				this.pending.delete(id);
			}
		}

		return this.send({
			type: 'filter',
			id: ++this.seq,
			filters,
			sort,
			searchQuery
		});
	}

	private send(msg: FilterMessage): Promise<FilterResult> {
		return new Promise((resolve) => {
			this.pending.set(msg.id, resolve);
			this.worker.postMessage(msg);
		});
	}

	destroy(): void {
		this.worker.terminate();
		this.pending.clear();
	}
}
