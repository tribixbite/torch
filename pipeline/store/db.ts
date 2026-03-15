/**
 * SQLite store using Bun's built-in bun:sqlite module.
 * No native dependencies needed — works on Termux/Android.
 */
import { Database } from 'bun:sqlite';
import { resolve } from 'path';
import type { FlashlightEntry, PriceEntry, SourceRef } from '../schema/canonical.js';

const DB_PATH = resolve(import.meta.dir, '../../pipeline-data/db/torch.sqlite');

let _db: Database | null = null;

/** Get or create the SQLite database connection */
export function getDb(): Database {
	if (!_db) {
		// Ensure directory exists
		const dir = resolve(DB_PATH, '..');
		Bun.spawnSync(['mkdir', '-p', dir]);
		_db = new Database(DB_PATH, { create: true });
		_db.exec('PRAGMA journal_mode = WAL');
		_db.exec('PRAGMA foreign_keys = ON');
		initSchema(_db);
	}
	return _db;
}

/** Close database connection */
export function closeDb(): void {
	if (_db) {
		_db.close();
		_db = null;
	}
}

/** Initialize database schema */
function initSchema(db: Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS flashlights (
			id TEXT PRIMARY KEY,
			family_id TEXT,
			model TEXT NOT NULL,
			brand TEXT NOT NULL,
			type TEXT NOT NULL DEFAULT '[]',          -- JSON array
			year INTEGER,
			discontinued INTEGER DEFAULT 0,

			-- Optics
			led TEXT NOT NULL DEFAULT '[]',            -- JSON array
			led_color TEXT NOT NULL DEFAULT '[]',

			-- Performance (claimed)
			lumens TEXT DEFAULT '[]',                   -- JSON array of numbers
			intensity_cd REAL,
			throw_m REAL,
			beam_angle REAL,
			efficacy REAL,
			cri REAL,
			cct REAL,
			tint_duv REAL,
			runtime_hours TEXT DEFAULT '[]',

			-- Performance (measured) — JSON keyed by source
			measured_performance TEXT DEFAULT '{}',

			-- Power
			battery TEXT NOT NULL DEFAULT '[]',
			wh REAL,
			charging TEXT DEFAULT '[]',

			-- Modes
			modes TEXT DEFAULT '[]',
			levels INTEGER,
			blink TEXT DEFAULT '[]',

			-- Physical
			length_mm REAL,
			bezel_mm REAL,
			body_mm REAL,
			weight_g REAL,
			material TEXT NOT NULL DEFAULT '[]',
			color TEXT NOT NULL DEFAULT '[]',
			impact TEXT DEFAULT '[]',

			-- Environment
			environment TEXT DEFAULT '[]',

			-- UI
			switch TEXT NOT NULL DEFAULT '[]',
			features TEXT NOT NULL DEFAULT '[]',

			-- Purchase
			price_usd REAL,
			purchase_urls TEXT DEFAULT '[]',
			info_urls TEXT DEFAULT '[]',

			-- Media
			image_urls TEXT DEFAULT '[]',

			-- Identifiers
			asin TEXT,
			ean TEXT,
			upc TEXT,

			-- Metadata
			updated_at TEXT NOT NULL,

			-- Metadata
			primary_led TEXT GENERATED ALWAYS AS (COALESCE(json_extract(led, '$[0]'), '')) STORED
		);

		CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_entry ON flashlights(brand, model, primary_led);
		CREATE INDEX IF NOT EXISTS idx_brand ON flashlights(brand);
		CREATE INDEX IF NOT EXISTS idx_asin ON flashlights(asin);
		CREATE INDEX IF NOT EXISTS idx_updated ON flashlights(updated_at);

		CREATE TABLE IF NOT EXISTS prices (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			flashlight_id TEXT NOT NULL REFERENCES flashlights(id),
			retailer TEXT NOT NULL,
			price REAL NOT NULL,
			currency TEXT DEFAULT 'USD',
			url TEXT,
			affiliate INTEGER DEFAULT 0,
			checked_at TEXT NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_prices_flash ON prices(flashlight_id);

		CREATE TABLE IF NOT EXISTS sources (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			flashlight_id TEXT NOT NULL REFERENCES flashlights(id),
			source TEXT NOT NULL,
			url TEXT NOT NULL,
			scraped_at TEXT NOT NULL,
			confidence REAL DEFAULT 1.0
		);

		CREATE INDEX IF NOT EXISTS idx_sources_flash ON sources(flashlight_id);

		CREATE TABLE IF NOT EXISTS reviews (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			flashlight_id TEXT NOT NULL REFERENCES flashlights(id),
			source TEXT NOT NULL,
			url TEXT NOT NULL,
			rating REAL,
			measured_lumens TEXT,      -- JSON array
			measured_cri REAL,
			measured_cct REAL,
			measured_tint_duv REAL
		);

		CREATE INDEX IF NOT EXISTS idx_reviews_flash ON reviews(flashlight_id);

		-- Track discovered ASINs for incremental scraping
		CREATE TABLE IF NOT EXISTS discovered_asins (
			asin TEXT PRIMARY KEY,
			brand TEXT NOT NULL,
			title TEXT,
			discovered_at TEXT NOT NULL,
			scraped INTEGER DEFAULT 0,
			scraped_at TEXT
		);

		CREATE INDEX IF NOT EXISTS idx_disc_brand ON discovered_asins(brand);
		CREATE INDEX IF NOT EXISTS idx_disc_scraped ON discovered_asins(scraped);

		-- Raw spec text segments that couldn't be parsed by regex.
		-- Stored for future AI-assisted parsing.
		CREATE TABLE IF NOT EXISTS raw_spec_text (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			flashlight_id TEXT NOT NULL REFERENCES flashlights(id),
			source_url TEXT NOT NULL,
			-- Category of unparsed content: 'specs', 'modes', 'features', 'runtime', 'dimensions'
			category TEXT NOT NULL DEFAULT 'specs',
			-- Raw text content (cleaned HTML-to-text, trimmed to relevant section)
			text_content TEXT NOT NULL,
			scraped_at TEXT NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_raw_spec_flash ON raw_spec_text(flashlight_id);
		CREATE INDEX IF NOT EXISTS idx_raw_spec_cat ON raw_spec_text(category);
	`);
}

// --- CRUD operations ---

/** Insert or update a flashlight entry */
export function upsertFlashlight(entry: FlashlightEntry): void {
	const db = getDb();
	const stmt = db.prepare(`
		INSERT INTO flashlights (
			id, family_id, model, brand, type, year, discontinued,
			led, led_color, lumens, intensity_cd, throw_m, beam_angle,
			efficacy, cri, cct, tint_duv, runtime_hours, measured_performance,
			battery, wh, charging, modes, levels, blink,
			length_mm, bezel_mm, body_mm, weight_g, material, color, impact,
			environment, switch, features, price_usd, purchase_urls, info_urls,
			image_urls, asin, ean, upc, updated_at
		) VALUES (
			$id, $family_id, $model, $brand, $type, $year, $discontinued,
			$led, $led_color, $lumens, $intensity_cd, $throw_m, $beam_angle,
			$efficacy, $cri, $cct, $tint_duv, $runtime_hours, $measured_performance,
			$battery, $wh, $charging, $modes, $levels, $blink,
			$length_mm, $bezel_mm, $body_mm, $weight_g, $material, $color, $impact,
			$environment, $switch, $features, $price_usd, $purchase_urls, $info_urls,
			$image_urls, $asin, $ean, $upc, $updated_at
		) ON CONFLICT(id) DO UPDATE SET
			family_id = COALESCE(excluded.family_id, family_id),
			type = excluded.type,
			year = COALESCE(excluded.year, year),
			led = excluded.led, led_color = excluded.led_color,
			lumens = excluded.lumens, intensity_cd = COALESCE(excluded.intensity_cd, intensity_cd),
			throw_m = COALESCE(excluded.throw_m, throw_m),
			beam_angle = COALESCE(excluded.beam_angle, beam_angle),
			efficacy = COALESCE(excluded.efficacy, efficacy),
			cri = COALESCE(excluded.cri, cri),
			cct = COALESCE(excluded.cct, cct),
			tint_duv = COALESCE(excluded.tint_duv, tint_duv),
			runtime_hours = excluded.runtime_hours,
			measured_performance = excluded.measured_performance,
			battery = excluded.battery, wh = COALESCE(excluded.wh, wh),
			charging = excluded.charging,
			modes = excluded.modes, levels = COALESCE(excluded.levels, levels),
			blink = excluded.blink,
			length_mm = COALESCE(excluded.length_mm, length_mm),
			bezel_mm = COALESCE(excluded.bezel_mm, bezel_mm),
			body_mm = COALESCE(excluded.body_mm, body_mm),
			weight_g = COALESCE(excluded.weight_g, weight_g),
			material = excluded.material, color = excluded.color,
			impact = excluded.impact, environment = excluded.environment,
			switch = excluded.switch, features = excluded.features,
			price_usd = COALESCE(excluded.price_usd, price_usd),
			purchase_urls = excluded.purchase_urls, info_urls = excluded.info_urls,
			image_urls = excluded.image_urls,
			asin = COALESCE(excluded.asin, asin),
			ean = COALESCE(excluded.ean, ean),
			upc = COALESCE(excluded.upc, upc),
			updated_at = excluded.updated_at
	`);

	const claimed = entry.performance?.claimed ?? {};
	stmt.run({
		$id: entry.id,
		$family_id: entry.family_id ?? null,
		$model: entry.model,
		$brand: entry.brand,
		$type: JSON.stringify(entry.type),
		$year: entry.year ?? null,
		$discontinued: entry.discontinued ? 1 : 0,
		$led: JSON.stringify(entry.led),
		$led_color: JSON.stringify(entry.led_color),
		$lumens: JSON.stringify(claimed.lumens ?? []),
		$intensity_cd: claimed.intensity_cd ?? null,
		$throw_m: claimed.throw_m ?? null,
		$beam_angle: claimed.beam_angle ?? null,
		$efficacy: claimed.efficacy ?? null,
		$cri: claimed.cri ?? null,
		$cct: claimed.cct ?? null,
		$tint_duv: claimed.tint_duv ?? null,
		$runtime_hours: JSON.stringify(claimed.runtime_hours ?? []),
		$measured_performance: JSON.stringify(entry.performance?.measured ?? {}),
		$battery: JSON.stringify(entry.battery),
		$wh: entry.wh ?? null,
		$charging: JSON.stringify(entry.charging),
		$modes: JSON.stringify(entry.modes),
		$levels: entry.levels ?? null,
		$blink: JSON.stringify(entry.blink),
		$length_mm: entry.length_mm ?? null,
		$bezel_mm: entry.bezel_mm ?? null,
		$body_mm: entry.body_mm ?? null,
		$weight_g: entry.weight_g ?? null,
		$material: JSON.stringify(entry.material),
		$color: JSON.stringify(entry.color),
		$impact: JSON.stringify(entry.impact),
		$environment: JSON.stringify(entry.environment),
		$switch: JSON.stringify(entry.switch),
		$features: JSON.stringify(entry.features),
		$price_usd: entry.price_usd ?? null,
		$purchase_urls: JSON.stringify(entry.purchase_urls),
		$info_urls: JSON.stringify(entry.info_urls),
		$image_urls: JSON.stringify(entry.image_urls),
		$asin: entry.asin ?? null,
		$ean: entry.ean ?? null,
		$upc: entry.upc ?? null,
		$updated_at: entry.updated_at,
	});
}

/** Add a price record */
export function addPrice(flashlightId: string, price: PriceEntry): void {
	const db = getDb();
	db.prepare(`
		INSERT INTO prices (flashlight_id, retailer, price, currency, url, affiliate, checked_at)
		VALUES ($fid, $retailer, $price, $currency, $url, $affiliate, $checked_at)
	`).run({
		$fid: flashlightId,
		$retailer: price.retailer,
		$price: price.price,
		$currency: price.currency,
		$url: price.url,
		$affiliate: price.affiliate ? 1 : 0,
		$checked_at: price.last_checked,
	});
}

/** Add a source record */
export function addSource(flashlightId: string, source: SourceRef): void {
	const db = getDb();
	db.prepare(`
		INSERT INTO sources (flashlight_id, source, url, scraped_at, confidence)
		VALUES ($fid, $source, $url, $scraped_at, $confidence)
	`).run({
		$fid: flashlightId,
		$source: source.source,
		$url: source.url,
		$scraped_at: source.scraped_at,
		$confidence: source.confidence,
	});
}

/** Store a discovered ASIN (for incremental scraping) */
export function upsertDiscoveredAsin(asin: string, brand: string, title?: string): void {
	const db = getDb();
	db.prepare(`
		INSERT INTO discovered_asins (asin, brand, title, discovered_at)
		VALUES ($asin, $brand, $title, $now)
		ON CONFLICT(asin) DO UPDATE SET
			title = COALESCE(excluded.title, title)
	`).run({
		$asin: asin,
		$brand: brand,
		$title: title ?? null,
		$now: new Date().toISOString(),
	});
}

/** Store raw spec text for future AI parsing */
export function addRawSpecText(
	flashlightId: string,
	sourceUrl: string,
	category: string,
	textContent: string,
): void {
	const db = getDb();
	// Avoid duplicate entries for same flashlight+url+category
	const existing = db.prepare(`
		SELECT id FROM raw_spec_text
		WHERE flashlight_id = $fid AND source_url = $url AND category = $cat
	`).get({ $fid: flashlightId, $url: sourceUrl, $cat: category });
	if (existing) return;

	db.prepare(`
		INSERT INTO raw_spec_text (flashlight_id, source_url, category, text_content, scraped_at)
		VALUES ($fid, $url, $cat, $text, $now)
	`).run({
		$fid: flashlightId,
		$url: sourceUrl,
		$cat: category,
		$text: textContent,
		$now: new Date().toISOString(),
	});
}

/** Get raw spec text entries for a flashlight */
export function getRawSpecText(flashlightId: string): {
	category: string;
	text_content: string;
	source_url: string;
}[] {
	const db = getDb();
	return db.prepare(`
		SELECT category, text_content, source_url FROM raw_spec_text
		WHERE flashlight_id = $fid
	`).all({ $fid: flashlightId }) as { category: string; text_content: string; source_url: string }[];
}

/** Count raw spec text entries by category */
export function countRawSpecText(): { category: string; count: number }[] {
	const db = getDb();
	return db.prepare(`
		SELECT category, COUNT(*) as count FROM raw_spec_text GROUP BY category ORDER BY count DESC
	`).all() as { category: string; count: number }[];
}

/** Get set of all source URLs already scraped (for skip-cache in detail scraper) */
export function getScrapedUrlSet(): Set<string> {
	const db = getDb();
	const rows = db.prepare(`SELECT DISTINCT source_url FROM raw_spec_text`).all() as { source_url: string }[];
	return new Set(rows.map((r) => r.source_url));
}

/** Mark an ASIN as scraped */
export function markAsinScraped(asin: string): void {
	const db = getDb();
	db.prepare(`
		UPDATE discovered_asins SET scraped = 1, scraped_at = $now WHERE asin = $asin
	`).run({ $asin: asin, $now: new Date().toISOString() });
}

/** Get unscraped ASINs for a brand (or all) */
export function getUnscrapedAsins(brand?: string, limit = 100): { asin: string; brand: string }[] {
	const db = getDb();
	if (brand) {
		return db.prepare(`
			SELECT asin, brand FROM discovered_asins WHERE scraped = 0 AND brand = $brand LIMIT $limit
		`).all({ $brand: brand, $limit: limit }) as { asin: string; brand: string }[];
	}
	return db.prepare(`
		SELECT asin, brand FROM discovered_asins WHERE scraped = 0 LIMIT $limit
	`).all({ $limit: limit }) as { asin: string; brand: string }[];
}

/** Get all flashlights from the database */
export function getAllFlashlights(): FlashlightEntry[] {
	const db = getDb();
	const rows = db.prepare('SELECT * FROM flashlights').all() as Record<string, unknown>[];
	return rows.map(rowToEntry);
}

/** Count total flashlights */
export function countFlashlights(): number {
	const db = getDb();
	return (db.prepare('SELECT COUNT(*) as cnt FROM flashlights').get() as { cnt: number }).cnt;
}

/** Count discovered ASINs */
export function countDiscoveredAsins(): { total: number; scraped: number; unscraped: number } {
	const db = getDb();
	const total = (db.prepare('SELECT COUNT(*) as cnt FROM discovered_asins').get() as { cnt: number }).cnt;
	const scraped = (db.prepare('SELECT COUNT(*) as cnt FROM discovered_asins WHERE scraped = 1').get() as { cnt: number }).cnt;
	return { total, scraped, unscraped: total - scraped };
}

/** Get brand stats */
export function getBrandStats(): { brand: string; count: number }[] {
	const db = getDb();
	return db.prepare(`
		SELECT brand, COUNT(*) as count FROM flashlights GROUP BY brand ORDER BY count DESC
	`).all() as { brand: string; count: number }[];
}

/** Search flashlights by text query */
export function searchFlashlights(query: string): FlashlightEntry[] {
	const db = getDb();
	const q = `%${query.toLowerCase()}%`;
	const rows = db.prepare(`
		SELECT * FROM flashlights
		WHERE LOWER(model) LIKE $q OR LOWER(brand) LIKE $q
		   OR LOWER(color) LIKE $q OR LOWER(features) LIKE $q
		   OR LOWER(type) LIKE $q OR LOWER(led) LIKE $q
		   OR LOWER(material) LIKE $q
		ORDER BY brand, model
	`).all({ $q: q }) as Record<string, unknown>[];
	return rows.map(rowToEntry);
}

/** Find duplicate entries */
export function findDuplicates(): { brand: string; model: string; count: number }[] {
	const db = getDb();
	return db.prepare(`
		SELECT brand, model, COUNT(*) as count
		FROM flashlights
		GROUP BY LOWER(brand), LOWER(model)
		HAVING count > 1
		ORDER BY count DESC
	`).all() as { brand: string; model: string; count: number }[];
}

/** Delete entries that have no images (useless without visual) */
export function deleteEntriesWithoutImages(): number {
	const db = getDb();
	// First get IDs to delete, then cascade
	const ids = db.prepare(`
		SELECT id FROM flashlights
		WHERE image_urls IS NULL OR image_urls = '[]' OR image_urls = ''
	`).all() as { id: string }[];

	for (const { id } of ids) {
		db.prepare('DELETE FROM sources WHERE flashlight_id = ?').run(id);
		db.prepare('DELETE FROM prices WHERE flashlight_id = ?').run(id);
		db.prepare('DELETE FROM flashlights WHERE id = ?').run(id);
	}
	return ids.length;
}

/** Remove duplicate entries (keep the one with more data) */
export function removeDuplicates(): number {
	const db = getDb();
	// Find duplicate groups by lowercase brand+model
	const dupes = db.prepare(`
		SELECT GROUP_CONCAT(id) as ids, LOWER(brand) as lb, LOWER(model) as lm, COUNT(*) as cnt
		FROM flashlights
		GROUP BY LOWER(brand), LOWER(model)
		HAVING cnt > 1
	`).all() as { ids: string; lb: string; lm: string; cnt: number }[];

	let removed = 0;
	for (const group of dupes) {
		const ids = group.ids.split(',');
		// Keep the entry with the most non-null fields
		const entries = ids.map((id) => {
			const row = db.prepare('SELECT * FROM flashlights WHERE id = ?').get(id) as Record<string, unknown>;
			let score = 0;
			for (const v of Object.values(row)) {
				if (v != null && v !== '' && v !== '[]' && v !== '{}') score++;
			}
			return { id, score };
		});
		entries.sort((a, b) => b.score - a.score);

		// Delete all but the best entry (cascade related records)
		for (let i = 1; i < entries.length; i++) {
			const id = entries[i].id;
			db.prepare('DELETE FROM sources WHERE flashlight_id = ?').run(id);
			db.prepare('DELETE FROM prices WHERE flashlight_id = ?').run(id);
			db.prepare('DELETE FROM flashlights WHERE id = ?').run(id);
			removed++;
		}
	}
	return removed;
}

/** Delete a flashlight entry by ID */
export function deleteFlashlight(id: string): boolean {
	const db = getDb();
	const result = db.prepare('DELETE FROM flashlights WHERE id = ?').run(id);
	return result.changes > 0;
}

/** Convert a database row to a FlashlightEntry */
function rowToEntry(row: Record<string, unknown>): FlashlightEntry {
	const parseJson = (v: unknown, fallback: unknown = []) => {
		if (typeof v === 'string') {
			try { return JSON.parse(v); } catch { return fallback; }
		}
		return fallback;
	};

	const measured = parseJson(row.measured_performance, {});

	return {
		id: row.id as string,
		family_id: row.family_id as string | undefined,
		model: row.model as string,
		brand: row.brand as string,
		type: parseJson(row.type),
		year: row.year as number | undefined,
		discontinued: row.discontinued === 1,
		led: parseJson(row.led),
		led_color: parseJson(row.led_color),
		performance: {
			claimed: {
				lumens: parseJson(row.lumens),
				intensity_cd: row.intensity_cd as number | undefined,
				throw_m: row.throw_m as number | undefined,
				beam_angle: row.beam_angle as number | undefined,
				efficacy: row.efficacy as number | undefined,
				cri: row.cri as number | undefined,
				cct: row.cct as number | undefined,
				tint_duv: row.tint_duv as number | undefined,
				runtime_hours: parseJson(row.runtime_hours),
			},
			measured,
		},
		battery: parseJson(row.battery),
		wh: row.wh as number | undefined,
		charging: parseJson(row.charging),
		modes: parseJson(row.modes),
		levels: row.levels as number | undefined,
		blink: parseJson(row.blink),
		length_mm: row.length_mm as number | undefined,
		bezel_mm: row.bezel_mm as number | undefined,
		body_mm: row.body_mm as number | undefined,
		weight_g: row.weight_g as number | undefined,
		material: parseJson(row.material),
		color: parseJson(row.color),
		impact: parseJson(row.impact),
		environment: parseJson(row.environment),
		switch: parseJson(row.switch),
		features: parseJson(row.features),
		price_usd: row.price_usd as number | undefined,
		prices: [],
		purchase_urls: parseJson(row.purchase_urls),
		info_urls: parseJson(row.info_urls),
		image_urls: parseJson(row.image_urls),
		review_refs: [],
		sources: [],
		asin: row.asin as string | undefined,
		ean: row.ean as string | undefined,
		upc: row.upc as string | undefined,
		updated_at: row.updated_at as string,
	};
}
