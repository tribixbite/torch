#!/usr/bin/env bun
/**
 * Generalized image URL reorder — all brands, not just Emisar/Noctigon.
 *
 * Priority order:
 * 1. Brand-direct URLs (manufacturer domains, not retailers/Amazon)
 * 2. Shopify CDN (cdn.shopify.com)
 * 3. Other domains (review sites etc.)
 * 4. Amazon product images (last resort — white-background product shots)
 *
 * Also: skip .gif as first URL (animated GIFs don't thumbnail well)
 */
import { Database } from 'bun:sqlite';
import { resolve } from 'path';
import { existsSync, unlinkSync } from 'fs';

const dbPath = resolve(import.meta.dir, '../pipeline-data/db/torch.sqlite');
const db = new Database(dbPath);
db.exec('PRAGMA busy_timeout = 30000');

const DRY_RUN = process.argv.includes('--dry-run');

/** Amazon image domains */
const AMAZON_RE = /(?:images-na\.ssl-images-amazon\.com|m\.media-amazon\.com|images-eu\.ssl-images-amazon\.com|ecx\.images-amazon\.com)/i;

/** Retailer domains — not manufacturer, not Amazon (Amazon checked separately) */
const RETAILER_RE = /(?:ebay\.|walmart\.|bestbuy\.|bhphoto\.|batteryjunction\.|goinggear\.|nealsgadgets\.|illumn\.|killzoneflashlights\.|knifecenter\.|bladehq\.|opticsplanet\.|cabelas\.|basspro\.|rei\.com|homedepot\.|lowes\.|target\.com|aliexpress\.|banggood\.|gearbest\.|jlhawaii808\.|jlhawaii\.)/i;

/** Shopify CDN */
const SHOPIFY_RE = /cdn\.shopify\.com/i;

interface Row { id: string; image_urls: string; brand: string; model: string; }

// Find all entries with image URLs
const entries = db.prepare(`
  SELECT id, image_urls, brand, model FROM flashlights
  WHERE image_urls IS NOT NULL AND image_urls != '[]' AND image_urls != ''
`).all() as Row[];

console.log(`Scanning ${entries.length} entries for image URL reordering...`);

const update = db.prepare('UPDATE flashlights SET image_urls = ? WHERE id = ?');
let fixed = 0;
let gifFixed = 0;

/** Classify URL into priority tier (lower = better) */
function urlPriority(url: string): number {
	if (AMAZON_RE.test(url)) return 4;         // Amazon last
	if (RETAILER_RE.test(url)) return 3;        // Other retailers
	// intl-outdoor Magento cache URLs — lower quality than Shopify CDN
	if (/intl-outdoor\.com/.test(url)) {
		return /\/cache\//.test(url) ? 2.5 : 2; // cache variants slightly worse
	}
	if (SHOPIFY_RE.test(url)) return 1.5;       // Shopify CDN — high quality, reliable
	return 1;                                    // Brand-direct / manufacturer
}

for (const e of entries) {
	try {
		const urls: string[] = JSON.parse(e.image_urls);
		if (urls.length < 2) continue; // Nothing to reorder with a single URL

		// Stable sort by priority (preserves relative order within same tier)
		const sorted = [...urls].sort((a, b) => urlPriority(a) - urlPriority(b));

		// Skip .gif as first URL (animated GIFs don't thumbnail well)
		if (sorted.length > 1 && sorted[0].toLowerCase().endsWith('.gif')) {
			const gif = sorted.shift()!;
			sorted.push(gif);
			gifFixed++;
		}

		const newJson = JSON.stringify(sorted);
		if (newJson !== e.image_urls) {
			if (!DRY_RUN) {
				update.run(newJson, e.id);
			}
			fixed++;
			const oldFirst = urls[0].replace(/.*\/\/[^/]+/, '').slice(0, 60);
			const newFirst = sorted[0].replace(/.*\/\/[^/]+/, '').slice(0, 60);
			if (urlPriority(urls[0]) > urlPriority(sorted[0])) {
				console.log(`  ${e.brand} ${e.model}: ${oldFirst} → ${newFirst}`);
			}
		}
	} catch (err) {
		console.error(`  Error on ${e.id}: ${err}`);
	}
}

console.log(`\n=== Summary${DRY_RUN ? ' (DRY RUN)' : ''} ===`);
console.log(`Reordered: ${fixed} entries`);
console.log(`GIF demoted: ${gifFixed} entries`);

// Remove stale thumbnails for reordered entries so they get re-downloaded
if (!DRY_RUN && fixed > 0) {
	const thumbDir = resolve(import.meta.dir, '../pipeline-data/thumbnails');
	const reordered = db.prepare(`
		SELECT id FROM flashlights
		WHERE image_urls IS NOT NULL AND image_urls != '[]'
		AND updated_at >= ?
	`).all(now()) as { id: string }[];

	let thumbsRemoved = 0;
	for (const { id } of reordered) {
		// Thumbnail files are named by entry ID with various extensions
		for (const ext of ['.webp', '.jpg', '.png']) {
			const thumbPath = resolve(thumbDir, `${id}${ext}`);
			if (existsSync(thumbPath)) {
				unlinkSync(thumbPath);
				thumbsRemoved++;
			}
		}
	}
	if (thumbsRemoved > 0) {
		console.log(`Removed ${thumbsRemoved} stale thumbnails (will re-download)`);
	}
}

function now(): string {
	return new Date().toISOString().slice(0, 10);
}
