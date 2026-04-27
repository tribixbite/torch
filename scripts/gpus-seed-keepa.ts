/**
 * Keepa-based GPU seeder — fully API-driven, no Amazon scraping.
 *
 * Sources of ASINs (in priority order):
 *   1. Existing static/gpus-seed.json (refresh known set, 1 token/ASIN)
 *   2. Keepa /search?term=rtx <model> for any models below --min-per-model
 *      (search returns full product objects so it's efficient when needed)
 *
 * Per-ASIN: /product?asin=A,B,...&stats=180 returns current prices for
 * NEW (idx 1), USED (idx 2), REFURBISHED (idx 6), WAREHOUSE (idx 9).
 * Each present price becomes a separate offer for that condition.
 *
 * Token budget (refill 1/min, cap 60, allows overdraft):
 *   - Enriching N existing ASINs: ~N tokens
 *   - Searching 1 model with stats=180: ~50 tokens
 *
 * Output: static/gpus-seed.json
 *
 * Usage:
 *   bun scripts/gpus-seed-keepa.ts                       # refresh existing + top up
 *   bun scripts/gpus-seed-keepa.ts --no-search           # only refresh existing
 *   bun scripts/gpus-seed-keepa.ts --models 5090         # only this model
 *   bun scripts/gpus-seed-keepa.ts --min-per-model 30    # search if existing<30
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

type GpuModel = '3090' | '4090' | '5090';
type GpuCondition = 'new' | 'used-good' | 'refurbished' | 'warehouse';

interface SeedOffer {
	offer_id: string; asin: string; model: GpuModel; title: string;
	condition: GpuCondition; condition_note: string | null;
	price_usd: number; currency: 'USD';
	seller: string | null; seller_id: string | null;
	seller_rating: number | null; seller_rating_count: number | null;
	ships_from: string | null; delivery_text: string | null;
	first_seen: number; last_seen: number; is_buybox: boolean;
}
interface SeedProduct {
	asin: string; model: GpuModel; title: string;
	thumbnail_url: string | null; last_refreshed: number;
}
interface SeedFile {
	generated_at: number; offers: SeedOffer[]; products: SeedProduct[];
}

const KEEPA_KEY = process.env.KEEPA_API_KEY ?? loadKeyFromEnv();
function loadKeyFromEnv(): string {
	const envPath = resolve(process.env.HOME!, 'git/torch/.env');
	if (!existsSync(envPath)) return '';
	return readFileSync(envPath, 'utf8').match(/KEEPA_API_KEY=(\S+)/)?.[1] ?? '';
}
const DOMAIN = 1;
const OUT_PATH = resolve(process.env.HOME!, 'git/torch/static/gpus-seed.json');
const PRODUCT_BATCH = 10; // smaller batches → less waiting at low token counts

const SEARCH_TERMS: Record<GpuModel, string> = {
	'3090': 'rtx 3090', '4090': 'rtx 4090', '5090': 'rtx 5090',
};
const PRICE_IDX = { amazon: 0, new: 1, used: 2, refurbished: 6, warehouse: 9 } as const;
const CONDITION_LABEL: Record<GpuCondition, string> = {
	'new': 'lowest current new (Keepa)',
	'used-good': 'lowest current used (Keepa)',
	'refurbished': 'lowest current refurbished (Keepa)',
	'warehouse': 'lowest current Amazon Warehouse (Keepa)',
};

interface KeepaProduct {
	asin: string;
	title?: string;
	imagesCSV?: string;
	stats?: { current?: number[]; rating?: number; reviewCount?: number };
}

function inferModelFromTitle(title: string): GpuModel | null {
	const t = title.toLowerCase();
	if (/backplate|water\s*block|waterblock|fan only|^cable|riser cable|bracket|mount adapter|cooler\s+(?!master\s+rtx)/i.test(t)) return null;
	if (/\b(rtx|geforce)\s*5090\b/.test(t)) return '5090';
	if (/\b(rtx|geforce)\s*4090\b/.test(t)) return '4090';
	if (/\b(rtx|geforce)\s*3090\b/.test(t)) return '3090';
	return null;
}
function imageUrl(filename: string | null | undefined): string | null {
	if (!filename) return null;
	return `https://m.media-amazon.com/images/I/${filename}`;
}
function firstImage(csv: string | undefined): string | null {
	if (!csv) return null;
	return imageUrl(csv.split(',')[0]);
}

async function getTokens(): Promise<number> {
	const r = await fetch(`https://api.keepa.com/token?key=${KEEPA_KEY}`);
	const d = await r.json() as { tokensLeft: number };
	return d.tokensLeft;
}

async function fetchProducts(asins: string[]): Promise<KeepaProduct[]> {
	const url = `https://api.keepa.com/product?key=${KEEPA_KEY}&domain=${DOMAIN}&asin=${asins.join(',')}&stats=180&rating=1`;
	const r = await fetch(url);
	if (!r.ok) {
		console.warn(`  /product HTTP ${r.status} — body: ${(await r.text()).slice(0, 120)}`);
		return [];
	}
	const d = await r.json() as { tokensLeft: number; products: KeepaProduct[] };
	console.log(`  /product +${asins.length}: returned ${d.products?.length ?? 0}, tokensLeft=${d.tokensLeft}`);
	return d.products ?? [];
}

async function searchModel(model: GpuModel): Promise<KeepaProduct[]> {
	const term = encodeURIComponent(SEARCH_TERMS[model]);
	const url = `https://api.keepa.com/search?key=${KEEPA_KEY}&domain=${DOMAIN}&type=product&term=${term}&page=0&stats=180`;
	const r = await fetch(url);
	if (!r.ok) {
		console.warn(`  /search ${model} HTTP ${r.status}`);
		return [];
	}
	const d = await r.json() as { tokensLeft: number; products?: KeepaProduct[] };
	console.log(`  /search ${model}: ${d.products?.length ?? 0} products, tokensLeft=${d.tokensLeft}`);
	return d.products ?? [];
}

function offersFromProduct(p: KeepaProduct, now: number): { offers: SeedOffer[]; product: SeedProduct | null } {
	const title = p.title ?? '';
	const verifiedModel = inferModelFromTitle(title);
	if (!verifiedModel) return { offers: [], product: null };

	const cur = p.stats?.current ?? [];
	const offers: SeedOffer[] = [];
	const conds: { idx: number; cond: GpuCondition }[] = [
		{ idx: PRICE_IDX.new, cond: 'new' },
		{ idx: PRICE_IDX.used, cond: 'used-good' },
		{ idx: PRICE_IDX.refurbished, cond: 'refurbished' },
		{ idx: PRICE_IDX.warehouse, cond: 'warehouse' },
	];
	// If the dedicated NEW price is missing, fall back to Amazon's own offer.
	if ((!cur[PRICE_IDX.new] || cur[PRICE_IDX.new] <= 0) && cur[PRICE_IDX.amazon] > 0) {
		cur[PRICE_IDX.new] = cur[PRICE_IDX.amazon];
	}

	const stars = p.stats?.rating != null && p.stats.rating > 0 ? p.stats.rating / 10 : null;
	const reviewCount = p.stats?.reviewCount && p.stats.reviewCount > 0 ? p.stats.reviewCount : null;

	let i = 0;
	for (const c of conds) {
		const cents = cur[c.idx];
		if (!cents || cents <= 0) continue;
		offers.push({
			offer_id: `${p.asin}__keepa_${c.cond}_${++i}`,
			asin: p.asin, model: verifiedModel, title,
			condition: c.cond, condition_note: CONDITION_LABEL[c.cond],
			price_usd: cents / 100, currency: 'USD',
			seller: c.cond === 'warehouse' ? 'Amazon Warehouse' : null,
			seller_id: null,
			seller_rating: stars, seller_rating_count: reviewCount,
			ships_from: null, delivery_text: null,
			first_seen: now, last_seen: now,
			is_buybox: c.cond === 'new',
		});
	}
	const product: SeedProduct = {
		asin: p.asin, model: verifiedModel, title,
		thumbnail_url: firstImage(p.imagesCSV), last_refreshed: now,
	};
	return { offers, product };
}

function loadExistingAsinsByModel(): Map<GpuModel, Set<string>> {
	const out = new Map<GpuModel, Set<string>>();
	if (!existsSync(OUT_PATH)) return out;
	try {
		const seed = JSON.parse(readFileSync(OUT_PATH, 'utf8')) as SeedFile;
		for (const p of seed.products ?? []) {
			const set = out.get(p.model) ?? new Set<string>();
			set.add(p.asin);
			out.set(p.model, set);
		}
	} catch (e) {
		console.warn(`could not parse existing seed: ${(e as Error).message}`);
	}
	return out;
}

function writeSeed(now: number, allProducts: KeepaProduct[]) {
	const offers: SeedOffer[] = [];
	const products: SeedProduct[] = [];
	for (const p of allProducts) {
		const { offers: po, product } = offersFromProduct(p, now);
		if (!product) continue;
		offers.push(...po);
		products.push(product);
	}
	// Preserve any prior seed entries we didn't refresh in this run, so a
	// token-limited partial run doesn't shrink the deal list.
	if (existsSync(OUT_PATH)) {
		try {
			const old = JSON.parse(readFileSync(OUT_PATH, 'utf8')) as SeedFile;
			const refreshedAsins = new Set(products.map((p) => p.asin));
			for (const p of old.products ?? []) if (!refreshedAsins.has(p.asin)) products.push(p);
			const refreshedOfferAsins = new Set(offers.map((o) => o.asin));
			for (const o of old.offers ?? []) if (!refreshedOfferAsins.has(o.asin)) offers.push(o);
		} catch {}
	}
	const out: SeedFile = { generated_at: now, offers, products };
	mkdirSync(resolve(OUT_PATH, '..'), { recursive: true });
	writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
	return { offers, products };
}

async function main() {
	const t0 = Date.now();
	const args = process.argv.slice(2);
	const modelsArg = args.indexOf('--models');
	const minArg = args.indexOf('--min-per-model');
	const noSearch = args.includes('--no-search');
	const maxWaitArg = args.indexOf('--max-wait-min');
	const maxWaitMin = maxWaitArg >= 0 ? parseInt(args[maxWaitArg + 1], 10) : 5;
	const models: GpuModel[] = modelsArg >= 0 ? args[modelsArg + 1].split(',') as GpuModel[] : ['3090', '4090', '5090'];
	const minPerModel = minArg >= 0 ? parseInt(args[minArg + 1], 10) : 20;

	if (!KEEPA_KEY) { console.error('KEEPA_API_KEY missing'); process.exit(1); }
	const startTokens = await getTokens();
	console.log(`gpus-seed-keepa: models=${models.join(',')} minPerModel=${minPerModel} noSearch=${noSearch} tokens=${startTokens}`);

	const existingByModel = loadExistingAsinsByModel();
	const allKnownAsins = new Set<string>();
	for (const set of existingByModel.values()) for (const a of set) allKnownAsins.add(a);
	console.log(`  existing seed has ${allKnownAsins.size} ASINs across ${existingByModel.size} models`);

	// Phase A: enrich all known ASINs (cheap, but token-gated; writes incrementally)
	const enrichQueue = [...allKnownAsins];
	const allProducts: KeepaProduct[] = [];
	for (let i = 0; i < enrichQueue.length; i += PRODUCT_BATCH) {
		const batch = enrichQueue.slice(i, i + PRODUCT_BATCH);
		const tok = await getTokens();
		if (tok < batch.length) {
			const need = batch.length - tok;
			const waitMin = Math.ceil(need + 2);
			if (waitMin > maxWaitMin) {
				console.log(`  tokens=${tok}, need ${batch.length} → wait ${waitMin}min > maxWaitMin=${maxWaitMin}, stopping early`);
				break;
			}
			const waitMs = waitMin * 60_000;
			console.log(`  tokens=${tok}, need ${batch.length}, waiting ${(waitMs / 1000).toFixed(0)}s`);
			await new Promise((r) => setTimeout(r, waitMs));
		}
		const got = await fetchProducts(batch);
		allProducts.push(...got);
		// Write seed incrementally so any callers see the freshest data even
		// if we exit early due to token limits.
		const { offers: o, products: pr } = writeSeed(Date.now(), allProducts);
		console.log(`  seed updated: ${pr.length} products, ${o.length} offers`);
	}

	// Phase B: search for models below the floor (skipped if --no-search or token-poor)
	if (!noSearch) {
		for (const m of models) {
			const have = (existingByModel.get(m)?.size ?? 0);
			if (have >= minPerModel) continue;
			const tok = await getTokens();
			if (tok < 50) {
				console.warn(`  skip search ${m}: have=${have}<${minPerModel} but only ${tok} tokens`);
				continue;
			}
			const found = await searchModel(m);
			// Merge in (deduped against allProducts)
			const seen = new Set(allProducts.map((p) => p.asin));
			for (const p of found) if (!seen.has(p.asin)) allProducts.push(p);
		}
	}

	// Phase C: final write (Phase A also writes incrementally per batch)
	const { offers, products } = writeSeed(Date.now(), allProducts);
	let kept = products.length;
	let rejected = allProducts.length - products.length;

	const dt = ((Date.now() - t0) / 1000).toFixed(1);
	const byCond: Record<string, number> = {};
	const byModel: Record<string, number> = {};
	for (const o of offers) {
		byCond[o.condition] = (byCond[o.condition] ?? 0) + 1;
		byModel[o.model] = (byModel[o.model] ?? 0) + 1;
	}
	const endTokens = await getTokens();
	console.log(`\nseed written in ${dt}s — ${products.length} products, ${offers.length} offers`);
	console.log(`  by model: ${Object.entries(byModel).map(([k,v])=>`${k}:${v}`).join(' ')}`);
	console.log(`  by cond:  ${Object.entries(byCond).map(([k,v])=>`${k}:${v}`).join(' ')}`);
	console.log(`  this run: kept ${kept} / rejected ${rejected}`);
	console.log(`  tokens: ${startTokens} → ${endTokens} (used ${startTokens - endTokens})`);
	console.log(`  → ${OUT_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
