/**
 * scrape-images.ts — Download + optimize all flashlight product images
 *
 * Downloads the first image URL for each entry, resizes to 100x100 WebP
 * thumbnails, and packs them into a sprite sheet for the SPA.
 *
 * Usage: bun run pipeline/images/scrape-images.ts [--skip-download] [--sprite-only]
 */

import { Database } from 'bun:sqlite';
import sharp from 'sharp';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

const DB_PATH = 'pipeline-data/db/torch.sqlite';
const THUMBS_DIR = 'pipeline-data/images/thumbs';
const SPRITE_OUTPUT = 'static/flashlights.sprites.webp';
const TILE_SIZE = 100;
const CONCURRENCY = 20; // parallel downloads
const DOWNLOAD_TIMEOUT = 15_000; // 15s per image
const MAX_RETRIES = 2;

// --- CLI flags ---
const args = new Set(process.argv.slice(2));
const skipDownload = args.has('--skip-download');
const spriteOnly = args.has('--sprite-only');

interface ImageJob {
	/** Row index in the flashlights table (0-based order) */
	idx: number;
	/** Primary key from DB */
	id: number;
	/** First image URL */
	url: string;
}

/** Extract all image jobs from the database */
function getImageJobs(): ImageJob[] {
	const db = new Database(DB_PATH, { readonly: true });
	const rows = db.query(
		'SELECT rowid as id, image_urls FROM flashlights ORDER BY rowid'
	).all() as { id: number; image_urls: string }[];

	const jobs: ImageJob[] = [];
	for (let i = 0; i < rows.length; i++) {
		const urls = JSON.parse(rows[i].image_urls) as string[];
		if (urls.length > 0 && urls[0]) {
			jobs.push({ idx: i, id: rows[i].id, url: urls[0] });
		}
	}
	db.close();
	return jobs;
}

/** Download a single image with retry */
async function downloadImage(url: string, retries = MAX_RETRIES): Promise<Buffer | null> {
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);

			const res = await fetch(url, {
				signal: controller.signal,
				headers: {
					'User-Agent': 'Mozilla/5.0 (compatible; TorchBot/1.0)',
					'Accept': 'image/*',
				},
			});

			clearTimeout(timeout);

			if (!res.ok) {
				if (attempt < retries) continue;
				return null;
			}

			const arrayBuf = await res.arrayBuffer();
			return Buffer.from(arrayBuf);
		} catch (err) {
			if (attempt < retries) {
				// Brief backoff
				await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
				continue;
			}
			return null;
		}
	}
	return null;
}

/** Process a single image: download → resize → save as WebP thumb */
async function processImage(job: ImageJob): Promise<boolean> {
	const thumbPath = join(THUMBS_DIR, `${job.idx}.webp`);

	// Skip if already processed
	if (existsSync(thumbPath)) return true;

	const rawData = await downloadImage(job.url);
	if (!rawData || rawData.length === 0) return false;

	try {
		await sharp(rawData)
			.resize(TILE_SIZE, TILE_SIZE, {
				fit: 'contain',
				background: { r: 0, g: 0, b: 0, alpha: 0 },
			})
			.webp({ quality: 75, effort: 4 })
			.toFile(thumbPath);
		return true;
	} catch (err) {
		// Corrupted image or unsupported format
		return false;
	}
}

/** Run download + processing with concurrency limit */
async function downloadAll(jobs: ImageJob[]): Promise<{ ok: number; fail: number }> {
	let ok = 0;
	let fail = 0;
	let completed = 0;

	// Check how many already exist
	const existing = jobs.filter((j) => existsSync(join(THUMBS_DIR, `${j.idx}.webp`))).length;
	if (existing > 0) {
		console.log(`  ${existing} thumbnails already cached, skipping those`);
		ok += existing;
		completed += existing;
	}

	const pending = jobs.filter((j) => !existsSync(join(THUMBS_DIR, `${j.idx}.webp`)));
	if (pending.length === 0) {
		console.log('  All thumbnails already downloaded');
		return { ok, fail };
	}

	console.log(`  Downloading ${pending.length} images (${CONCURRENCY} concurrent)...`);

	// Process in batches
	for (let i = 0; i < pending.length; i += CONCURRENCY) {
		const batch = pending.slice(i, i + CONCURRENCY);
		const results = await Promise.all(batch.map((j) => processImage(j)));

		for (const success of results) {
			completed++;
			if (success) ok++;
			else fail++;
		}

		// Progress log every 100
		if (completed % 100 < CONCURRENCY || i + CONCURRENCY >= pending.length) {
			const pct = ((completed / jobs.length) * 100).toFixed(1);
			process.stdout.write(`\r  Progress: ${completed}/${jobs.length} (${pct}%) — ${ok} ok, ${fail} failed`);
		}
	}

	console.log(''); // newline after progress
	return { ok, fail };
}

/** Build sprite sheet from individual thumbnails using row-by-row chunking */
async function buildSprite(totalImages: number): Promise<void> {
	console.log('\nBuilding sprite sheet...');

	// Calculate grid dimensions (aim for roughly square)
	const cols = Math.ceil(Math.sqrt(totalImages));
	const rows = Math.ceil(totalImages / cols);
	const width = cols * TILE_SIZE;
	const height = rows * TILE_SIZE;

	console.log(`  Grid: ${cols}x${rows} (${width}x${height}px)`);

	// Build row-by-row to avoid OOM on large datasets
	// Each row is cols * TILE_SIZE wide, TILE_SIZE tall
	const rowBuffers: Buffer[] = [];
	let found = 0;

	for (let r = 0; r < rows; r++) {
		const rowComposites: sharp.OverlayOptions[] = [];
		const startIdx = r * cols;
		const endIdx = Math.min(startIdx + cols, totalImages);

		for (let i = startIdx; i < endIdx; i++) {
			const thumbPath = join(THUMBS_DIR, `${i}.webp`);
			if (!existsSync(thumbPath)) continue;

			const col = i % cols;
			rowComposites.push({
				input: thumbPath,
				left: col * TILE_SIZE,
				top: 0,
			});
			found++;
		}

		// Create row canvas and composite thumbnails for this row
		const rowBuf = await sharp({
			create: {
				width,
				height: TILE_SIZE,
				channels: 4,
				background: { r: 0, g: 0, b: 0, alpha: 0 },
			},
		})
			.composite(rowComposites.length > 0 ? rowComposites : [])
			.raw()
			.toBuffer();

		rowBuffers.push(rowBuf);

		if ((r + 1) % 10 === 0 || r === rows - 1) {
			process.stdout.write(`\r  Building rows: ${r + 1}/${rows} (${found} thumbs)`);
		}
	}

	console.log('');
	console.log(`  Stitching ${rows} rows into final sprite...`);

	// Concatenate all raw row buffers into one image
	const fullRaw = Buffer.concat(rowBuffers);
	await sharp(fullRaw, {
		raw: {
			width,
			height,
			channels: 4,
		},
	})
		.webp({ quality: 72, effort: 4 })
		.toFile(SPRITE_OUTPUT);

	const stat = Bun.file(SPRITE_OUTPUT);
	const sizeMB = ((await stat.size) / 1024 / 1024).toFixed(2);
	console.log(`  Sprite saved: ${SPRITE_OUTPUT} (${sizeMB} MB)`);
	console.log(`  Grid cols: ${cols}`);
}

/** Write sprite metadata for build-torch-db.ts to consume */
async function writeSpriteMetadata(totalImages: number): Promise<void> {
	const cols = Math.ceil(Math.sqrt(totalImages));
	const metadata = {
		cols,
		tileSize: TILE_SIZE,
		totalImages,
		spriteFile: 'flashlights.sprites.webp',
	};
	await Bun.write('pipeline-data/sprite-metadata.json', JSON.stringify(metadata, null, 2));
	console.log('  Sprite metadata written to pipeline-data/sprite-metadata.json');
}

// --- Main ---
async function main() {
	console.log('=== Torch Image Pipeline ===\n');

	mkdirSync(THUMBS_DIR, { recursive: true });

	const jobs = getImageJobs();
	console.log(`Found ${jobs.length} entries with image URLs`);

	if (!skipDownload && !spriteOnly) {
		const start = Date.now();
		const { ok, fail } = await downloadAll(jobs);
		const elapsed = ((Date.now() - start) / 1000).toFixed(1);
		console.log(`\nDownload complete in ${elapsed}s — ${ok} ok, ${fail} failed`);
	}

	// Build sprite
	const start2 = Date.now();
	await buildSprite(jobs.length);
	await writeSpriteMetadata(jobs.length);
	const elapsed2 = ((Date.now() - start2) / 1000).toFixed(1);
	console.log(`Sprite built in ${elapsed2}s`);

	console.log('\nDone!');
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});
