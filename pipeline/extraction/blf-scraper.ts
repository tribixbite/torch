/**
 * BudgetLightForum (Discourse) review scraper.
 * Uses the public Discourse JSON API to find review threads
 * and extract spec data from post markdown content.
 *
 * API endpoints:
 *   /search.json?q=<query>          — search topics/posts
 *   /t/<topic-id>.json              — full topic with post stream
 *   /t/<topic-id>/posts.json?post_ids[]=<id> — specific posts
 *
 * No authentication required. Rate limit: ~1 req/sec is polite.
 */
import { extractSpecsFromText, htmlToText } from './manufacturer-scraper.js';
import { getDb } from '../store/db.js';
import type { FlashlightEntry } from '../schema/canonical.js';

const BLF_BASE = 'https://budgetlightforum.com';
const CRAWL_DELAY = 3000; // ms between API requests (BLF rate-limits at ~1req/2s)
const USER_AGENT = 'TorchBot/1.0 (flashlight spec aggregator)';

/** Discourse search result structure */
interface DiscourseSearchResult {
	posts: Array<{
		id: number;
		topic_id: number;
		blurb: string;
		username: string;
		created_at: string;
		like_count: number;
	}>;
	topics: Array<{
		id: number;
		title: string;
		slug: string;
		posts_count: number;
		like_count: number;
		views: number;
		created_at: string;
		tags: string[];
	}>;
}

/** Discourse topic JSON structure */
interface DiscourseTopic {
	id: number;
	title: string;
	slug: string;
	posts_count: number;
	tags: string[];
	post_stream: {
		posts: Array<{
			id: number;
			post_number: number;
			raw?: string;
			cooked: string;
			username: string;
			created_at: string;
			like_count: number;
		}>;
		stream: number[]; // All post IDs in topic
	};
}

/** Fetch JSON from BLF API with 429 retry/backoff */
async function fetchBlfJson<T>(path: string): Promise<T> {
	const url = `${BLF_BASE}${path}`;

	for (let attempt = 0; attempt < 3; attempt++) {
		const res = await fetch(url, {
			headers: {
				'User-Agent': USER_AGENT,
				'Accept': 'application/json',
			},
		});

		if (res.status === 429) {
			// Rate limited — back off exponentially
			const delay = CRAWL_DELAY * (2 ** (attempt + 1));
			console.log(`    Rate limited (429), backing off ${delay / 1000}s...`);
			await Bun.sleep(delay);
			continue;
		}

		if (!res.ok) {
			throw new Error(`BLF API ${res.status}: ${url}`);
		}

		return await res.json() as T;
	}

	throw new Error(`BLF API: max retries exceeded for ${url}`);
}

/**
 * Search BLF for review threads about a specific flashlight model.
 * Returns topic IDs of review/discussion threads.
 */
async function searchReviews(brand: string, model: string): Promise<number[]> {
	const query = encodeURIComponent(`${brand} ${model} review`);
	try {
		const data = await fetchBlfJson<DiscourseSearchResult>(`/search.json?q=${query}&order=relevance`);
		// Deduplicate topic IDs from both topics and posts
		const topicIds = new Set<number>();
		for (const topic of data.topics ?? []) {
			topicIds.add(topic.id);
		}
		for (const post of data.posts ?? []) {
			topicIds.add(post.topic_id);
		}
		return [...topicIds];
	} catch (err) {
		console.log(`    BLF search error for ${brand} ${model}: ${(err as Error).message}`);
		return [];
	}
}

/**
 * Fetch the first N posts from a topic and extract spec data.
 * Returns merged specs from all posts in the thread.
 */
async function extractSpecsFromTopic(topicId: number): Promise<{
	specs: Partial<ReturnType<typeof extractSpecsFromText>>;
	title: string;
	postCount: number;
}> {
	const topic = await fetchBlfJson<DiscourseTopic>(`/t/${topicId}.json`);
	const mergedSpecs: Partial<ReturnType<typeof extractSpecsFromText>> = {};
	let bestSpecCount = 0;

	// Process the first 10 posts (or fewer if topic is shorter)
	const posts = topic.post_stream.posts.slice(0, 10);
	for (const post of posts) {
		// Use raw markdown if available, otherwise strip HTML from cooked
		const text = post.raw ?? htmlToText(post.cooked);
		if (text.length < 50) continue; // Skip very short posts

		const specs = extractSpecsFromText(text);

		// Count how many fields this post extracted
		let specCount = 0;
		if (specs.lumens?.length) specCount++;
		if (specs.throw_m) specCount++;
		if (specs.intensity_cd) specCount++;
		if (specs.runtime_hours?.length) specCount++;
		if (specs.weight_g) specCount++;
		if (specs.length_mm) specCount++;
		if (specs.led?.length) specCount++;
		if (specs.battery?.length) specCount++;
		if (specs.material?.length) specCount++;
		if (specs.switch?.length) specCount++;
		if (specs.cri) specCount++;
		if (specs.cct) specCount++;

		// Merge: only fill missing fields (first-post-wins for each field)
		if (specs.lumens?.length && !mergedSpecs.lumens?.length) mergedSpecs.lumens = specs.lumens;
		if (specs.throw_m && !mergedSpecs.throw_m) mergedSpecs.throw_m = specs.throw_m;
		if (specs.intensity_cd && !mergedSpecs.intensity_cd) mergedSpecs.intensity_cd = specs.intensity_cd;
		if (specs.runtime_hours?.length && !mergedSpecs.runtime_hours?.length) mergedSpecs.runtime_hours = specs.runtime_hours;
		if (specs.weight_g && !mergedSpecs.weight_g) mergedSpecs.weight_g = specs.weight_g;
		if (specs.length_mm && !mergedSpecs.length_mm) mergedSpecs.length_mm = specs.length_mm;
		if (specs.bezel_mm && !mergedSpecs.bezel_mm) mergedSpecs.bezel_mm = specs.bezel_mm;
		if (specs.body_mm && !mergedSpecs.body_mm) mergedSpecs.body_mm = specs.body_mm;
		if (specs.led?.length && !mergedSpecs.led?.length) mergedSpecs.led = specs.led;
		if (specs.battery?.length && !mergedSpecs.battery?.length) mergedSpecs.battery = specs.battery;
		if (specs.material?.length && !mergedSpecs.material?.length) mergedSpecs.material = specs.material;
		if (specs.switch?.length && !mergedSpecs.switch?.length) mergedSpecs.switch = specs.switch;
		if (specs.features?.length && !mergedSpecs.features?.length) mergedSpecs.features = specs.features;
		if (specs.environment?.length && !mergedSpecs.environment?.length) mergedSpecs.environment = specs.environment;
		if (specs.cri && !mergedSpecs.cri) mergedSpecs.cri = specs.cri;
		if (specs.cct && !mergedSpecs.cct) mergedSpecs.cct = specs.cct;
		if (specs.charging?.length && !mergedSpecs.charging?.length) mergedSpecs.charging = specs.charging;

		if (specCount > bestSpecCount) bestSpecCount = specCount;
	}

	return {
		specs: mergedSpecs,
		title: topic.title,
		postCount: posts.length,
	};
}

/**
 * Enrich a single flashlight entry from BLF review data.
 * Only fills MISSING fields — never overwrites existing data.
 * Returns true if any new data was added.
 */
function mergeSpecsIntoEntry(entry: FlashlightEntry, specs: Partial<ReturnType<typeof extractSpecsFromText>>): boolean {
	let enriched = false;

	if (specs.lumens?.length && !entry.performance.claimed.lumens?.length) {
		entry.performance.claimed.lumens = specs.lumens;
		enriched = true;
	}
	if (specs.throw_m && !entry.performance.claimed.throw_m) {
		entry.performance.claimed.throw_m = specs.throw_m;
		enriched = true;
	}
	if (specs.intensity_cd && !entry.performance.claimed.intensity_cd) {
		entry.performance.claimed.intensity_cd = specs.intensity_cd;
		enriched = true;
	}
	if (specs.runtime_hours?.length && !entry.performance.claimed.runtime_hours?.length) {
		entry.performance.claimed.runtime_hours = specs.runtime_hours;
		enriched = true;
	}
	if (specs.cri && !entry.performance.claimed.cri) {
		entry.performance.claimed.cri = specs.cri;
		enriched = true;
	}
	if (specs.cct && !entry.performance.claimed.cct) {
		entry.performance.claimed.cct = specs.cct;
		enriched = true;
	}
	if (specs.weight_g && !entry.weight_g) {
		entry.weight_g = specs.weight_g;
		enriched = true;
	}
	if (specs.length_mm && !entry.length_mm) {
		entry.length_mm = specs.length_mm;
		enriched = true;
	}
	if (specs.bezel_mm && !entry.bezel_mm) {
		entry.bezel_mm = specs.bezel_mm;
		enriched = true;
	}
	if (specs.body_mm && !entry.body_mm) {
		entry.body_mm = specs.body_mm;
		enriched = true;
	}
	if (specs.led?.length && (!entry.led.length || entry.led[0] === 'unknown')) {
		entry.led = specs.led;
		enriched = true;
	}
	if (specs.battery?.length && (!entry.battery.length || entry.battery[0] === 'unknown')) {
		entry.battery = specs.battery;
		enriched = true;
	}
	if (specs.material?.length && !entry.material.length) {
		entry.material = specs.material;
		enriched = true;
	}
	if (specs.switch?.length && !entry.switch.length) {
		entry.switch = specs.switch;
		enriched = true;
	}
	if (specs.features?.length && !entry.features.length) {
		entry.features = specs.features;
		enriched = true;
	}
	if (specs.environment?.length && !entry.environment.length) {
		entry.environment = specs.environment;
		enriched = true;
	}
	if (specs.charging?.length && !entry.charging.length) {
		entry.charging = specs.charging;
		enriched = true;
	}

	return enriched;
}

/**
 * Run BLF enrichment on entries with the most missing fields.
 * Searches BLF for review threads and fills gaps from post content.
 *
 * @param maxEntries Maximum number of entries to process
 * @param minMissing Only process entries missing at least this many fields
 */
export async function enrichFromBlf(options: {
	maxEntries?: number;
	minMissing?: number;
} = {}): Promise<{
	processed: number;
	enriched: number;
	topicsSearched: number;
	topicsFetched: number;
}> {
	const { maxEntries = 200, minMissing = 3 } = options;
	const db = getDb();

	// Get entries with most missing fields (prioritize popular brands)
	const rows = db.query(`
		SELECT id, model, brand, led, battery, lumens, throw_m, runtime_hours,
			switch, features, material, length_mm, weight_g, environment, charging
		FROM flashlights
		ORDER BY brand, model
	`).all() as any[];

	// Score entries by number of missing required fields
	interface ScoredEntry { id: string; brand: string; model: string; missing: number }
	const scored: ScoredEntry[] = [];
	for (const r of rows) {
		let missing = 0;
		if (!JSON.parse(r.led || '[]').length) missing++;
		if (!JSON.parse(r.battery || '[]').length) missing++;
		if (!JSON.parse(r.lumens || '[]').length) missing++;
		if (!r.throw_m) missing++;
		if (!JSON.parse(r.runtime_hours || '[]').length) missing++;
		if (!JSON.parse(r.switch || '[]').length) missing++;
		if (!JSON.parse(r.features || '[]').length) missing++;
		if (!JSON.parse(r.material || '[]').length) missing++;
		if (!r.length_mm) missing++;
		if (!r.weight_g) missing++;
		if (!JSON.parse(r.environment || '[]').length) missing++;
		if (!JSON.parse(r.charging || '[]').length) missing++;
		if (missing >= minMissing) {
			// Skip obvious non-flashlight entries (website page names, accessories, marketing)
			const modelLower = r.model.toLowerCase().trim();

			// Website page names (exact match)
			if (/^(addresses|history|login|register|wishlist|shipping|privacy|warranty|returns?|about|contact|faq|support|terms|custom|gift|sale|blog|news|policy|reviews?|info|all|search|dealer|locator|collection|affiliate|feedback|sitemap|compare)$/i.test(modelLower)) continue;

			// Accessory/component keywords
			if (/\b(holster|filter|diffuser|charger|mount|strap|case|pouch|battery\s*pack|lanyard|clip|headband|replacement|spare|glass|lens|pcb|driver|o-ring|gasket|tube|extension|screwdriver|bits?|tripod|phone\s*holder|mouse\s*pad|patch|cooling\s*shell|charging\s*cable|gift\s*card|sticker|poster|hat|shirt|apparel)\b/i.test(modelLower)) continue;

			// Marketing/page description keywords
			if (/\b(bundle\s*sale|fast\s*shipping|custom\s*illumination|personalized|engraved|constant\s*current|mos\s*fet|lumen\s*and\s*lux|raising\s*hope|new\s*flashlight\s*(?:is\s*)?com|affiliate\s*program|dealer\s*locator|feedback\s*photo|shipping\s*(?:cost|policy))\b/i.test(modelLower)) continue;

			// Model names > 60 chars are usually descriptions, not models
			if (modelLower.length > 60) continue;

			scored.push({ id: r.id, brand: r.brand, model: r.model, missing });
		}
	}

	// Sort by most-missing first, then by brand for batch efficiency
	scored.sort((a, b) => b.missing - a.missing || a.brand.localeCompare(b.brand));
	const toProcess = scored.slice(0, maxEntries);

	console.log(`  BLF enrichment: ${toProcess.length} entries to process (${scored.length} total with ${minMissing}+ missing fields)`);

	let processed = 0;
	let enriched = 0;
	let topicsSearched = 0;
	let topicsFetched = 0;

	// Track already-searched model+brand combos to avoid duplicate searches
	const searched = new Set<string>();

	for (const { id, brand, model } of toProcess) {
		const searchKey = `${brand}|${model}`;
		if (searched.has(searchKey)) continue;
		searched.add(searchKey);

		// Search BLF for this model
		const topicIds = await searchReviews(brand, model);
		topicsSearched++;
		await Bun.sleep(CRAWL_DELAY);

		if (topicIds.length === 0) {
			processed++;
			continue;
		}

		// Fetch top 2 most relevant topics (search returns by relevance)
		const allSpecs: Partial<ReturnType<typeof extractSpecsFromText>>[] = [];
		for (const tid of topicIds.slice(0, 2)) {
			try {
				const { specs, title } = await extractSpecsFromTopic(tid);
				allSpecs.push(specs);
				topicsFetched++;
				console.log(`    [${brand} ${model}] Topic: "${title}" — extracted specs`);
				await Bun.sleep(CRAWL_DELAY);
			} catch (err) {
				console.log(`    Topic ${tid} error: ${(err as Error).message}`);
			}
		}

		if (allSpecs.length === 0) {
			processed++;
			continue;
		}

		// Merge all topic specs (first-wins per field)
		const merged: Partial<ReturnType<typeof extractSpecsFromText>> = {};
		for (const s of allSpecs) {
			for (const [key, val] of Object.entries(s)) {
				if (val !== undefined && val !== null && !(merged as any)[key]) {
					(merged as any)[key] = val;
				}
			}
		}

		// Load the full entry, merge, and save
		const fullRow = db.query('SELECT * FROM flashlights WHERE id = ?').get(id) as any;
		if (!fullRow) { processed++; continue; }

		// Reconstruct entry from DB row
		const entry: FlashlightEntry = {
			id: fullRow.id,
			model: fullRow.model,
			brand: fullRow.brand,
			type: JSON.parse(fullRow.type || '["flashlight"]'),
			led: JSON.parse(fullRow.led || '[]'),
			led_color: JSON.parse(fullRow.led_color || '[]'),
			performance: {
				claimed: {
					lumens: JSON.parse(fullRow.lumens || '[]'),
					intensity_cd: fullRow.intensity_cd || undefined,
					throw_m: fullRow.throw_m || undefined,
					cri: fullRow.cri || undefined,
					cct: fullRow.cct || undefined,
					runtime_hours: JSON.parse(fullRow.runtime_hours || '[]'),
				},
				measured: {},
			},
			battery: JSON.parse(fullRow.battery || '[]'),
			charging: JSON.parse(fullRow.charging || '[]'),
			modes: JSON.parse(fullRow.modes || '[]'),
			blink: JSON.parse(fullRow.blink || '[]'),
			length_mm: fullRow.length_mm || undefined,
			bezel_mm: fullRow.bezel_mm || undefined,
			body_mm: fullRow.body_mm || undefined,
			weight_g: fullRow.weight_g || undefined,
			material: JSON.parse(fullRow.material || '[]'),
			color: JSON.parse(fullRow.color || '[]'),
			impact: JSON.parse(fullRow.impact || '[]'),
			environment: JSON.parse(fullRow.environment || '[]'),
			switch: JSON.parse(fullRow.switch || '[]'),
			features: JSON.parse(fullRow.features || '[]'),
			price_usd: fullRow.price_usd || undefined,
			prices: [],
			purchase_urls: JSON.parse(fullRow.purchase_urls || '[]'),
			info_urls: JSON.parse(fullRow.info_urls || '[]'),
			image_urls: JSON.parse(fullRow.image_urls || '[]'),
			review_refs: JSON.parse(fullRow.review_refs || '[]'),
			sources: [],
			updated_at: new Date().toISOString(),
		};

		if (mergeSpecsIntoEntry(entry, merged)) {
			const { upsertFlashlight, addSource } = await import('../store/db.js');
			upsertFlashlight(entry);
			addSource(entry.id, {
				source: 'blf:review',
				url: `${BLF_BASE}/t/${topicIds[0]}`,
				scraped_at: new Date().toISOString(),
				confidence: 0.7, // Forum data — good but user-reported
			});
			enriched++;
		}

		processed++;
		if (processed % 10 === 0) {
			console.log(`  Progress: ${processed}/${toProcess.length} processed, ${enriched} enriched`);
		}
	}

	return { processed, enriched, topicsSearched, topicsFetched };
}
