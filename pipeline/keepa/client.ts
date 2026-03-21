/**
 * Keepa API client with token-aware rate limiting.
 * Uses Bun's native fetch. Auto-waits for token refill when budget is low.
 */

const BASE_URL = 'https://api.keepa.com';
const DOMAIN_US = 1;

interface TokenStatus {
	tokensLeft: number;
	refillIn: number; // ms until next refill
	refillRate: number; // tokens per minute
}

interface KeepaProduct {
	asin: string;
	parentAsin?: string;
	title?: string;
	brand?: string;
	manufacturer?: string;
	model?: string;
	partNumber?: string;
	color?: string;
	size?: string;
	style?: string;
	material?: string; // deprecated — use materials[]
	materials?: string[];
	itemForm?: string;
	itemWeight?: number; // grams (-1 = unavailable)
	itemHeight?: number; // mm (-1 = unavailable)
	itemLength?: number; // mm
	itemWidth?: number; // mm
	packageWeight?: number; // grams (box, not product)
	packageLength?: number; // mm (box, not product)
	features?: string[];
	description?: string;
	shortDescription?: string;
	imagesCSV?: string;
	eanList?: string[];
	upcList?: string[];
	categoryTree?: Array<{ catId: number; name: string }>;
	specialFeatures?: string[];
	specificUsesForProduct?: string[];
	recommendedUsesForProduct?: string;
	includedComponents?: string;
	productBenefit?: string;
	targetAudienceKeyword?: string;
	itemTypeKeyword?: string;
	type?: string; // Amazon product type
	binding?: string; // Amazon category for non-books
	productGroup?: string;
	batteriesRequired?: boolean;
	batteriesIncluded?: boolean;
	monthlySold?: number;
	csv?: (number[] | null)[];
	// Stats object — free with stats=N param
	stats?: {
		current?: number[];
		avg?: number[];
		avg30?: number[];
		avg90?: number[];
		avg180?: number[];
		min?: number[][];
		max?: number[][];
	};
}

export type { KeepaProduct };

export class KeepaClient {
	private apiKey: string;
	private tokensLeft = 60;
	private refillRate = 1; // tokens per minute
	private domain = DOMAIN_US;

	constructor(apiKey?: string) {
		this.apiKey = apiKey ?? process.env.KEEPA_API_KEY ?? '';
		if (!this.apiKey) {
			throw new Error('KEEPA_API_KEY not set in environment or constructor');
		}
	}

	/** Check current token balance (free call) */
	async getTokenStatus(): Promise<TokenStatus> {
		const res = await this.request('/token', {});
		this.tokensLeft = res.tokensLeft;
		this.refillRate = res.refillRate;
		return {
			tokensLeft: res.tokensLeft,
			refillIn: res.refillIn,
			refillRate: res.refillRate,
		};
	}

	/**
	 * Product Finder — discover ASINs matching filters.
	 * Cost: 10 + 1 per 100 ASINs in result.
	 * Returns only ASINs, not full product data.
	 */
	async findProducts(selection: Record<string, unknown>): Promise<{
		asins: string[];
		totalResults: number;
	}> {
		const selectionJson = JSON.stringify(selection);
		await this.ensureTokens(11);

		const res = await this.request('/query', {
			domain: this.domain,
			selection: selectionJson,
		});

		this.tokensLeft = res.tokensLeft ?? 0;
		return {
			asins: res.asinList ?? [],
			totalResults: res.totalResults ?? 0,
		};
	}

	/**
	 * Product Finder for a specific brand.
	 * Uses title keyword search.
	 */
	async findByBrand(brand: string, perPage = 10000): Promise<{
		asins: string[];
		totalResults: number;
	}> {
		return this.findProducts({
			title: `${brand} flashlight`,
			perPage,
			page: 0,
		});
	}

	/**
	 * Fetch full product details for up to 100 ASINs.
	 * Cost: 1 token per ASIN.
	 */
	async getProducts(asins: string[]): Promise<KeepaProduct[]> {
		if (asins.length === 0) return [];
		if (asins.length > 100) {
			throw new Error('Max 100 ASINs per request');
		}

		await this.ensureTokens(asins.length);

		const res = await this.request('/product', {
			domain: this.domain,
			asin: asins.join(','),
			stats: 90, // free: adds current/avg/min/max prices for last 90 days
			// history stays enabled — we store full price history
		});

		this.tokensLeft = res.tokensLeft ?? 0;
		return (res.products ?? []).filter((p: KeepaProduct | null) => p !== null) as KeepaProduct[];
	}

	/**
	 * Extract Amazon price from Keepa's CSV price history.
	 * Prices are in cents; -1 means out of stock.
	 */
	static extractCurrentPrice(product: KeepaProduct): number | undefined {
		const csv = product.csv;
		if (!csv) return undefined;

		// Index 0: Amazon price, Index 1: 3P New, Index 18: Buy Box
		for (const idx of [0, 18, 1]) {
			const series = csv[idx];
			if (series && series.length >= 2) {
				const lastPrice = series[series.length - 1];
				if (lastPrice > 0) {
					return lastPrice / 100; // cents to dollars
				}
			}
		}
		return undefined;
	}

	/**
	 * Extract full price history from Keepa CSV.
	 * Returns array of {timestamp, price} entries.
	 */
	static extractPriceHistory(product: KeepaProduct): Array<{ date: Date; price: number }> {
		const csv = product.csv;
		if (!csv) return [];
		const series = csv[0]; // Amazon price
		if (!series) return [];

		const history: Array<{ date: Date; price: number }> = [];
		for (let i = 0; i < series.length - 1; i += 2) {
			const keepaTime = series[i];
			const price = series[i + 1];
			if (price > 0) {
				// Keepa timestamp: (keepaTime + 21564000) * 60000 = Unix ms
				const unixMs = (keepaTime + 21564000) * 60000;
				history.push({
					date: new Date(unixMs),
					price: price / 100,
				});
			}
		}
		return history;
	}

	/**
	 * Extract image URLs from the imagesCSV field.
	 * Returns full Amazon CDN URLs.
	 */
	static extractImageUrls(product: KeepaProduct): string[] {
		if (!product.imagesCSV) return [];
		return product.imagesCSV
			.split(',')
			.filter(Boolean)
			.map((hash) => `https://images-na.ssl-images-amazon.com/images/I/${hash}`);
	}

	/**
	 * Extract rating from CSV (index 16, value 0-50 = 0.0-5.0)
	 */
	static extractRating(product: KeepaProduct): number | undefined {
		const csv = product.csv;
		if (!csv || !csv[16] || csv[16].length < 2) return undefined;
		const rawRating = csv[16][csv[16].length - 1];
		return rawRating > 0 ? rawRating / 10 : undefined;
	}

	/**
	 * Extract review count from CSV (index 17)
	 */
	static extractReviewCount(product: KeepaProduct): number | undefined {
		const csv = product.csv;
		if (!csv || !csv[17] || csv[17].length < 2) return undefined;
		const count = csv[17][csv[17].length - 1];
		return count > 0 ? count : undefined;
	}

	// --- Internal helpers ---

	/** Wait until we have enough tokens */
	private async ensureTokens(needed: number): Promise<void> {
		if (this.tokensLeft >= needed) return;

		const status = await this.getTokenStatus();
		if (status.tokensLeft >= needed) return;

		// Calculate wait time
		const deficit = needed - status.tokensLeft;
		const waitMs = Math.ceil((deficit / status.refillRate) * 60 * 1000) + 1000;
		console.log(`  Keepa: waiting ${Math.ceil(waitMs / 1000)}s for ${deficit} tokens (have ${status.tokensLeft}, need ${needed})`);
		await Bun.sleep(waitMs);
	}

	/** Make a GET request to the Keepa API */
	private async request(endpoint: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
		const url = new URL(`${BASE_URL}${endpoint}`);
		url.searchParams.set('key', this.apiKey);
		for (const [k, v] of Object.entries(params)) {
			if (v !== undefined && v !== null) {
				url.searchParams.set(k, String(v));
			}
		}

		const res = await fetch(url.toString(), {
			headers: { 'Accept-Encoding': 'gzip' },
		});

		if (!res.ok) {
			throw new Error(`Keepa API error: ${res.status} ${res.statusText}`);
		}

		const data = await res.json() as Record<string, unknown>;

		if (data.error) {
			const err = data.error as { message?: string; type?: string };
			throw new Error(`Keepa API error: ${err.type ?? 'unknown'} — ${err.message ?? ''}`);
		}

		return data;
	}
}
