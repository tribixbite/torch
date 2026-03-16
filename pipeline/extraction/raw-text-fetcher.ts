/**
 * Bulk raw text fetcher — fetches product pages and saves ALL text content
 * as raw_spec_text for AI parser processing.
 *
 * Unlike detail-scraper's captureRawSpecText (which only saves sections with
 * "Specifications" headers), this saves the full page text so the AI parser
 * can extract any data from it.
 *
 * Handles 429 rate limiting with exponential backoff and Retry-After headers.
 * Processes one domain at a time to avoid cross-domain Shopify rate limits.
 */
import { getDb, addRawSpecText } from '../store/db.js';
import { hasRequiredAttributes } from '../schema/canonical.js';
import type { FlashlightEntry } from '../schema/canonical.js';
import { htmlToText } from './manufacturer-scraper.js';

/** Retry addRawSpecText on SQLITE_BUSY errors (concurrent writers) */
function addRawSpecTextSafe(id: string, url: string, category: string, text: string): boolean {
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			addRawSpecText(id, url, category, text);
			return true;
		} catch (err: any) {
			if (err?.code === 'SQLITE_BUSY' && attempt < 4) {
				// Wait 2-10s with jitter before retrying
				const waitMs = 2000 + Math.random() * 2000 * (attempt + 1);
				Bun.sleepSync(waitMs);
				continue;
			}
			throw err; // Re-throw non-BUSY errors or final attempt
		}
	}
	return false;
}

const CRAWL_DELAY = 3000; // ms between requests to same domain
const MIN_TEXT_LENGTH = 100; // skip pages with very little content
const MAX_TEXT_LENGTH = 15000; // cap stored text to prevent bloat
const MAX_429_RETRIES = 5; // max retries on 429
const FETCH_TIMEOUT = 15000; // ms

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface RawFetchResult {
	processed: number;
	saved: number;
	tooShort: number;
	errors: number;
	skippedDomains: string[]; // Domains that hit persistent 429s
}

interface EntryWithUrl {
	id: string;
	brand: string;
	model: string;
	url: string;
	missing: string[];
}

/**
 * Get entries that have source URLs but no raw_spec_text, with missing fields.
 */
function getEntriesNeedingRawText(opts: {
	maxItems?: number;
	domain?: string;
}): EntryWithUrl[] {
	const db = getDb();

	const rows = db.prepare(`
		SELECT DISTINCT f.id, f.brand, f.model, s.url,
			f.lumens, f.throw_m, f.intensity_cd, f.runtime_hours,
			f.length_mm, f.weight_g, f.led, f.material, f.switch,
			f.battery, f.color, f.features, f.price_usd
		FROM flashlights f
		JOIN sources s ON s.flashlight_id = f.id
		WHERE f.id NOT IN (SELECT DISTINCT flashlight_id FROM raw_spec_text)
		${opts.domain ? "AND s.url LIKE '%' || $domain || '%'" : ''}
		ORDER BY f.brand, f.model
	`).all(opts.domain ? { $domain: opts.domain } : {}) as any[];

	// Deduplicate by flashlight_id (pick first URL)
	const seen = new Set<string>();
	const entries: EntryWithUrl[] = [];

	for (const row of rows) {
		if (seen.has(row.id)) continue;
		seen.add(row.id);

		const entry = rowToPartialEntry(row);
		const { valid, missing } = hasRequiredAttributes(entry);
		if (valid || missing.length === 0) continue;

		entries.push({
			id: row.id,
			brand: row.brand,
			model: row.model,
			url: row.url,
			missing,
		});

		if (opts.maxItems && entries.length >= opts.maxItems) break;
	}

	return entries;
}

/** Convert a DB row to a partial FlashlightEntry for hasRequiredAttributes check */
function rowToPartialEntry(row: any): FlashlightEntry {
	return {
		id: row.id,
		brand: row.brand,
		model: row.model,
		type: 'handheld',
		lumens: row.lumens ?? null,
		throw_m: row.throw_m ?? null,
		intensity_cd: row.intensity_cd ?? null,
		runtime_hours: row.runtime_hours ?? null,
		length_mm: row.length_mm ?? null,
		weight_g: row.weight_g ?? null,
		led: row.led ? JSON.parse(row.led) : null,
		material: row.material ? JSON.parse(row.material) : null,
		switch: row.switch ? JSON.parse(row.switch) : null,
		battery: row.battery ? JSON.parse(row.battery) : null,
		color: row.color ? JSON.parse(row.color) : null,
		features: row.features ? JSON.parse(row.features) : null,
		price_usd: row.price_usd ?? null,
		purchase_urls: row.url ? [row.url] : null,
	} as FlashlightEntry;
}

/**
 * Fetch a page with 429 retry and exponential backoff.
 * Returns HTML or null on failure.
 */
async function fetchWithRetry(url: string): Promise<string | null> {
	for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

			const res = await fetch(url, {
				headers: {
					'User-Agent': USER_AGENT,
					'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
					'Accept-Language': 'en-US,en;q=0.9',
					'Accept-Encoding': 'gzip, deflate',
				},
				signal: controller.signal,
				redirect: 'follow',
			});

			clearTimeout(timeout);

			if (res.status === 429) {
				// Respect Retry-After header if present
				const retryAfter = res.headers.get('Retry-After');
				const waitMs = retryAfter
					? parseInt(retryAfter, 10) * 1000
					: Math.min(5000 * Math.pow(2, attempt), 60000); // exponential backoff, max 60s
				console.log(`    429 on attempt ${attempt + 1}, waiting ${Math.round(waitMs / 1000)}s...`);
				await Bun.sleep(waitMs);
				continue;
			}

			if (res.status === 404 || res.status === 410) {
				return null; // Page gone, not retryable
			}

			if (!res.ok) {
				// Other errors — retry with backoff
				if (attempt < MAX_429_RETRIES) {
					await Bun.sleep(3000 * (attempt + 1));
					continue;
				}
				return null;
			}

			return await res.text();
		} catch {
			if (attempt < MAX_429_RETRIES) {
				await Bun.sleep(2000 * (attempt + 1));
				continue;
			}
			return null;
		}
	}
	return null;
}

/**
 * Bulk-fetch product pages and save all text as raw_spec_text.
 * Processes ONE domain at a time to avoid shared rate limit issues.
 */
export async function fetchRawTextBatch(opts: {
	maxItems?: number;
	domain?: string;
	dryRun?: boolean;
}): Promise<RawFetchResult> {
	const entries = getEntriesNeedingRawText({
		maxItems: opts.maxItems,
		domain: opts.domain,
	});

	console.log(`  Found ${entries.length} entries needing raw text`);
	if (entries.length === 0) return { processed: 0, saved: 0, tooShort: 0, errors: 0, skippedDomains: [] };

	if (opts.dryRun) {
		const domains: Record<string, number> = {};
		for (const e of entries) {
			try {
				const domain = new URL(e.url).hostname;
				domains[domain] = (domains[domain] ?? 0) + 1;
			} catch {
				domains['invalid-url'] = (domains['invalid-url'] ?? 0) + 1;
			}
		}
		console.log('\n  Domain breakdown:');
		Object.entries(domains)
			.sort((a, b) => b[1] - a[1])
			.forEach(([d, c]) => console.log(`    ${d}: ${c}`));
		return { processed: 0, saved: 0, tooShort: 0, errors: 0, skippedDomains: [] };
	}

	let processed = 0;
	let saved = 0;
	let tooShort = 0;
	let errors = 0;
	const skippedDomains: string[] = [];

	// Group by domain
	const byDomain = new Map<string, EntryWithUrl[]>();
	for (const e of entries) {
		try {
			const domain = new URL(e.url).hostname;
			if (!byDomain.has(domain)) byDomain.set(domain, []);
			byDomain.get(domain)!.push(e);
		} catch {
			errors++;
		}
	}

	console.log(`  Grouped into ${byDomain.size} domains\n`);

	// Process one domain at a time — sequential to avoid cross-domain rate limits
	for (const [domain, domainEntries] of byDomain) {
		console.log(`  --- ${domain} (${domainEntries.length} entries) ---`);
		let consecutive429s = 0;

		for (const entry of domainEntries) {
			const html = await fetchWithRetry(entry.url);

			if (html === null) {
				tooShort++;
				consecutive429s++;

				// If 10+ consecutive failures, skip this domain (likely blocked)
				if (consecutive429s >= 10) {
					console.log(`  !! Skipping ${domain} — ${consecutive429s} consecutive failures`);
					skippedDomains.push(domain);
					break;
				}
			} else {
				const text = htmlToText(html);
				if (text.length >= MIN_TEXT_LENGTH) {
					addRawSpecTextSafe(entry.id, entry.url, 'full-page', text.slice(0, MAX_TEXT_LENGTH));
					saved++;
					consecutive429s = 0; // Reset on success
				} else {
					tooShort++;
				}
			}

			processed++;

			if (processed % 25 === 0) {
				console.log(`  Progress: ${processed}/${entries.length} processed, ${saved} saved, ${tooShort} short/failed, ${errors} errors`);
			}

			await Bun.sleep(CRAWL_DELAY);
		}
	}

	return { processed, saved, tooShort, errors, skippedDomains };
}
