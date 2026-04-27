/**
 * Orchestrates a full /gpus refresh:
 *   1. Discover ASINs for each model + condition family
 *   2. Fetch offers per ASIN (rate-limited)
 *   3. Persist offers + snapshots into IndexedDB
 *
 * `navigator.locks` ensures only one tab refreshes at a time even if the
 * user has multiple /gpus tabs open.
 */
import type { GpuModel } from './types';
import { discoverAsins, fetchProductWithOffers, snapshotsFromOffers } from './scraper';
import { putOffers, putProduct, appendSnapshots } from './db';

export interface RefreshProgress {
	phase: 'idle' | 'discovering' | 'enriching' | 'done' | 'error';
	model?: GpuModel;
	asin?: string;
	asinsTotal?: number;
	asinsDone?: number;
	offersInserted?: number;
	error?: string;
}

const MODELS: GpuModel[] = ['3090', '4090', '5090'];
const PER_REQUEST_DELAY_MS = 3000;
const DISCOVERY_DELAY_MS = 8000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function refreshAll(
	onProgress: (p: RefreshProgress) => void = () => {},
	signal?: AbortSignal
): Promise<RefreshProgress> {
	return await navigator.locks.request('gpus-refresh', async () => {
		try {
			let totalOffers = 0;
			const asinsByModel = new Map<GpuModel, Set<string>>();

			for (const model of MODELS) {
				if (signal?.aborted) throw new Error('aborted');
				onProgress({ phase: 'discovering', model });
				const seen = new Set<string>();
				for (const condition of ['used', 'refurbished'] as const) {
					try {
						const found = await discoverAsins(model, condition, { signal });
						for (const f of found) seen.add(f.asin);
					} catch (e) {
						console.warn(`discover ${model}/${condition} failed`, e);
					}
					await sleep(DISCOVERY_DELAY_MS);
				}
				asinsByModel.set(model, seen);
			}

			let asinsDone = 0;
			const asinsTotal = [...asinsByModel.values()].reduce((s, x) => s + x.size, 0);

			for (const [model, asins] of asinsByModel) {
				for (const asin of asins) {
					if (signal?.aborted) throw new Error('aborted');
					onProgress({ phase: 'enriching', model, asin, asinsTotal, asinsDone, offersInserted: totalOffers });
					try {
						const result = await fetchProductWithOffers(asin, model, { signal });
						if (result && result.offers.length > 0) {
							await putOffers(result.offers);
							await putProduct(result.product);
							await appendSnapshots(snapshotsFromOffers(result.offers));
							totalOffers += result.offers.length;
						}
					} catch (e) {
						console.warn(`fetchProductWithOffers ${asin} failed`, e);
					}
					asinsDone++;
					await sleep(PER_REQUEST_DELAY_MS);
				}
			}

			const final: RefreshProgress = { phase: 'done', asinsTotal, asinsDone, offersInserted: totalOffers };
			onProgress(final);
			return final;
		} catch (e) {
			const final: RefreshProgress = { phase: 'error', error: (e as Error).message };
			onProgress(final);
			return final;
		}
	});
}
