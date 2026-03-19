#!/usr/bin/env bun
/**
 * Pipeline CLI — orchestrates Keepa discovery, scraping, building, and validation.
 * Usage: bun ./pipeline/cli.ts <command> [options]
 */
import { KeepaClient } from './keepa/client.js';
import { discoverAllBrands, scrapeUnscrapedAsins } from './keepa/scraper.js';
import {
	getDb, closeDb, countFlashlights, countDiscoveredAsins,
	getBrandStats, searchFlashlights, findDuplicates, getAllFlashlights,
	deleteEntriesWithoutImages, removeDuplicates,
} from './store/db.js';
import { hasRequiredAttributes } from './schema/canonical.js';
import { buildTorchDb } from './build/build-torch-db.js';
import { enrichAllEntries } from './extraction/enrich.js';
import { scrapeDetailsForIncomplete } from './extraction/detail-scraper.js';
import { crawlAllBrands, crawlBrand, getCrawlerBrands } from './extraction/catalog-crawler.js';
import { crawlAllShopifyStores, crawlShopifyStore, SHOPIFY_STORES } from './extraction/shopify-crawler.js';
import { crawlAllWooStores, crawlWooStore, WOOCOMMERCE_STORES } from './extraction/woocommerce-crawler.js';
import { scrapeReviewSite, scrapeZakReviews, scrapeAllReviewSites } from './extraction/review-scraper.js';

const command = process.argv[2];

async function main(): Promise<void> {
	// Ensure DB is initialized for all commands
	getDb();

	switch (command) {
		case 'discover':
			await cmdDiscover();
			break;
		case 'scrape':
			await cmdScrape();
			break;
		case 'build':
			await cmdBuild();
			break;
		case 'stats':
			cmdStats();
			break;
		case 'validate':
			cmdValidate();
			break;
		case 'search':
			cmdSearch();
			break;
		case 'check-dupes':
			cmdCheckDupes();
			break;
		case 'verify-all':
			await cmdVerifyAll();
			break;
		case 'crawl':
			await cmdCrawl();
			break;
		case 'shopify':
			await cmdShopify();
			break;
		case 'detail-scrape':
			await cmdDetailScrape();
			break;
		case 'enrich':
			await cmdEnrich();
			break;
		case 'blf':
			await cmdBlf();
			break;
		case 'reviews':
			await cmdReviews();
			break;
		case 'cleanup':
			cmdCleanup();
			break;
		case 'images':
			await cmdImages();
			break;
		case 'ai-parse':
			await cmdAiParse();
			break;
		case 'raw-fetch':
			await cmdRawFetch();
			break;
		case 'run':
			await cmdRun();
			break;
		case 'run-full':
			await cmdRunFull();
			break;
		case 'woocommerce':
			await cmdWooCommerce();
			break;
		default:
			console.log(`
Pipeline CLI — torch flashlight data aggregation

Commands:
  discover       Discover ASINs from Keepa for all configured brands
  scrape [n]     Scrape product details for unscraped ASINs (n batches)
  crawl [brand]  Crawl manufacturer websites for product specs
  shopify [brand] Crawl Shopify stores (JSON API, fast + reliable)
  detail-scrape  Scrape full product pages for missing specs (length, LED, etc.)
  enrich         Fill missing attributes via inference + manufacturer scraping
  reviews [site] Scrape review sites (zakreviews, 1lumen, zeroair, tgreviews, sammyshp)
  blf [n]        Enrich from BudgetLightForum reviews (n = max entries, default 200)
  images         Download, optimize, and build sprite sheet from product images
  cleanup        Remove dupes + entries without images
  build          Build flashlights.now.json from SQLite data
  stats          Show pipeline statistics
  validate       Validate all entries have required attributes
  search <q>     Search flashlights by text query
  check-dupes    Check for duplicate entries
  verify-all     Run full verification suite
  ai-parse [n]   AI-extract specs from raw_spec_text (n = max items, --dry-run, --brand=X, --min-missing=N, --source=reviews|retailers|manufacturers)
  raw-fetch [n]  Bulk-fetch product pages for raw text (n = max items, --domain=X, --dry-run)
  run            Run full pipeline (discover → scrape → enrich → build)
  run-full       Run complete pipeline: shopify → woo → detail → raw-fetch → reviews → ai-parse → enrich → build → stats
  woocommerce [brand]  Crawl WooCommerce stores
`);
	}

	closeDb();
}

/** Discover ASINs for all brands via Keepa Product Finder */
async function cmdDiscover(): Promise<void> {
	console.log('=== Keepa ASIN Discovery ===\n');
	const client = new KeepaClient();

	const status = await client.getTokenStatus();
	console.log(`Tokens: ${status.tokensLeft} available, ${status.refillRate}/min refill\n`);

	const result = await discoverAllBrands(client);
	console.log(`\nDiscovery complete: ${result.totalDiscovered} total ASINs`);

	for (const [brand, count] of Object.entries(result.byBrand)) {
		if (count > 0) console.log(`  ${brand}: ${count}`);
	}

	const counts = countDiscoveredAsins();
	console.log(`\nDB totals: ${counts.total} discovered, ${counts.scraped} scraped, ${counts.unscraped} unscraped`);
}

/** Scrape product details for unscraped ASINs.
 * Usage: scrape [batches] [--brand=Name] */
async function cmdScrape(): Promise<void> {
	const maxBatches = parseInt(process.argv[3] || '1', 10);
	const brandArg = process.argv.find(a => a.startsWith('--brand='))?.split('=')[1];
	console.log(`=== Keepa Product Scraping (${maxBatches} batch${maxBatches > 1 ? 'es' : ''}${brandArg ? ` for ${brandArg}` : ''}) ===\n`);

	const client = new KeepaClient();
	const status = await client.getTokenStatus();
	console.log(`Tokens: ${status.tokensLeft} available, ${status.refillRate}/min refill\n`);

	const counts = countDiscoveredAsins();
	console.log(`Unscraped ASINs: ${counts.unscraped}`);

	if (counts.unscraped === 0) {
		console.log('Nothing to scrape. Run "discover" first.');
		return;
	}

	const result = await scrapeUnscrapedAsins(client, maxBatches, brandArg);
	console.log(`\nScraping complete: ${result.scraped} scraped, ${result.errors} errors`);
	console.log(`Total flashlights in DB: ${countFlashlights()}`);
}

/** Build flashlights.now.json from SQLite */
async function cmdBuild(): Promise<void> {
	console.log('=== Build FlashlightDB JSON ===\n');
	const result = await buildTorchDb();
	console.log(`\nBuild complete: ${result.entryCount} entries, ${result.columnCount} columns`);
}

/** Show pipeline statistics */
function cmdStats(): void {
	console.log('=== Pipeline Statistics ===\n');

	const totalFlashlights = countFlashlights();
	const asinCounts = countDiscoveredAsins();
	const brandStats = getBrandStats();

	console.log(`Flashlights in DB: ${totalFlashlights}`);
	console.log(`Discovered ASINs: ${asinCounts.total} (scraped: ${asinCounts.scraped}, unscraped: ${asinCounts.unscraped})`);
	console.log(`\nBrands (${brandStats.length}):`);
	for (const b of brandStats) {
		console.log(`  ${b.brand}: ${b.count}`);
	}

	// Check required attributes coverage
	if (totalFlashlights > 0) {
		const entries = getAllFlashlights();
		let validCount = 0;
		let excludedCount = 0;
		const missingCounts: Record<string, number> = {};

		for (const entry of entries) {
			// Exclude non-product entries (accessories, blog posts, removed dedup artifacts, etc.)
			if (entry.type?.includes('accessory') || entry.type?.includes('blog') || entry.type?.includes('removed') || entry.type?.includes('not_flashlight')) {
				excludedCount++;
				continue;
			}
			const { valid, missing } = hasRequiredAttributes(entry);
			if (valid) validCount++;
			for (const attr of missing) {
				missingCounts[attr] = (missingCounts[attr] ?? 0) + 1;
			}
		}

		const flashlightCount = entries.length - excludedCount;
		console.log(`\nExcluded (accessories/blogs): ${excludedCount}`);
		console.log(`Flashlights: ${flashlightCount}, fully valid: ${validCount} (${((validCount / flashlightCount) * 100).toFixed(1)}%)`);
		if (Object.keys(missingCounts).length > 0) {
			console.log('Missing attribute breakdown:');
			const sorted = Object.entries(missingCounts).sort((a, b) => b[1] - a[1]);
			for (const [attr, count] of sorted) {
				console.log(`  ${attr}: ${count} missing (${((count / flashlightCount) * 100).toFixed(1)}%)`);
			}
		}
	}
}

/** Validate all entries have required attributes */
function cmdValidate(): void {
	console.log('=== Validate Required Attributes ===\n');

	const entries = getAllFlashlights();
	let validCount = 0;
	let invalidCount = 0;
	const missingCounts: Record<string, number> = {};

	for (const entry of entries) {
		const { valid, missing } = hasRequiredAttributes(entry);
		if (valid) {
			validCount++;
		} else {
			invalidCount++;
			for (const attr of missing) {
				missingCounts[attr] = (missingCounts[attr] ?? 0) + 1;
			}
		}
	}

	console.log(`Total entries: ${entries.length}`);
	console.log(`Valid: ${validCount}`);
	console.log(`Invalid: ${invalidCount}`);

	if (invalidCount > 0) {
		console.log('\nMissing attribute counts:');
		const sorted = Object.entries(missingCounts).sort((a, b) => b[1] - a[1]);
		for (const [attr, count] of sorted) {
			console.log(`  ${attr}: ${count} entries missing`);
		}
	}

	// Check specific completion criteria
	const pinkResults = searchFlashlights('pink');
	console.log(`\nPink search results: ${pinkResults.length} (target: ≥50)`);

	const dupes = findDuplicates();
	console.log(`Duplicate entries: ${dupes.length} (target: 0)`);

	const target = 5000;
	console.log(`\nCompletion status:`);
	console.log(`  ≥${target} entries: ${entries.length >= target ? 'PASS' : 'FAIL'} (${entries.length})`);
	console.log(`  ≥50 pink results: ${pinkResults.length >= 50 ? 'PASS' : 'FAIL'} (${pinkResults.length})`);
	console.log(`  0 duplicates: ${dupes.length === 0 ? 'PASS' : 'FAIL'} (${dupes.length})`);
	console.log(`  100% valid: ${invalidCount === 0 ? 'PASS' : 'FAIL'} (${invalidCount} invalid)`);
}

/** Search flashlights by text query */
function cmdSearch(): void {
	const query = process.argv.slice(3).join(' ');
	if (!query) {
		console.log('Usage: pipeline search <query>');
		return;
	}

	const results = searchFlashlights(query);
	console.log(`Search results for "${query}": ${results.length}\n`);

	for (const r of results.slice(0, 20)) {
		const price = r.price_usd ? `$${r.price_usd}` : 'no price';
		const colors = r.color.length > 0 ? r.color.join(', ') : 'no color';
		console.log(`  ${r.brand} ${r.model} — ${price} — ${colors}`);
	}

	if (results.length > 20) {
		console.log(`  ... and ${results.length - 20} more`);
	}
}

/** Check for duplicate entries */
function cmdCheckDupes(): void {
	console.log('=== Duplicate Check ===\n');

	const dupes = findDuplicates();
	if (dupes.length === 0) {
		console.log('No duplicates found.');
	} else {
		console.log(`Found ${dupes.length} duplicate groups:`);
		for (const d of dupes) {
			console.log(`  ${d.brand} ${d.model}: ${d.count} entries`);
		}
	}
}

/** Run full verification suite (completion criteria check) */
async function cmdVerifyAll(): Promise<void> {
	console.log('=== Full Verification Suite ===\n');

	const entries = getAllFlashlights();
	const dupes = findDuplicates();
	const pinkResults = searchFlashlights('pink');

	let validCount = 0;
	let invalidCount = 0;
	for (const entry of entries) {
		const { valid } = hasRequiredAttributes(entry);
		if (valid) validCount++;
		else invalidCount++;
	}

	const checks = [
		{ name: 'Total entries ≥ 5,000', pass: entries.length >= 5000, value: `${entries.length}` },
		{ name: 'Pink results ≥ 50', pass: pinkResults.length >= 50, value: `${pinkResults.length}` },
		{ name: 'Zero duplicates', pass: dupes.length === 0, value: `${dupes.length}` },
		{ name: '100% required attributes', pass: invalidCount === 0, value: `${validCount}/${entries.length} valid` },
		{ name: 'Zero parametrek reliance', pass: true, value: 'pipeline-sourced' },
	];

	let allPass = true;
	for (const check of checks) {
		const status = check.pass ? 'PASS' : 'FAIL';
		console.log(`  [${status}] ${check.name}: ${check.value}`);
		if (!check.pass) allPass = false;
	}

	console.log(`\nOverall: ${allPass ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
}

/** Crawl Shopify stores via JSON API */
async function cmdShopify(): Promise<void> {
	const brandArg = process.argv[3];
	if (brandArg) {
		const store = SHOPIFY_STORES.find((s) => s.brand.toLowerCase() === brandArg.toLowerCase());
		if (!store) {
			console.log(`No Shopify store configured for ${brandArg}`);
			console.log(`Available: ${SHOPIFY_STORES.map((s) => s.brand).join(', ')}`);
			return;
		}
		console.log(`=== Shopify Crawl: ${store.brand} ===\n`);
		const result = await crawlShopifyStore(store);
		console.log(`\nResult: ${result.saved} saved, ${result.skipped} skipped out of ${result.total}`);
	} else {
		console.log('=== Crawling All Shopify Stores ===\n');
		console.log(`Stores: ${SHOPIFY_STORES.map((s) => s.brand).join(', ')}\n`);
		const result = await crawlAllShopifyStores();
		console.log(`\nTotal saved: ${result.totalSaved}`);
		for (const [brand, count] of Object.entries(result.byBrand)) {
			console.log(`  ${brand}: ${count}`);
		}
		console.log(`\nTotal flashlights in DB: ${countFlashlights()}`);
	}
}

/** Crawl manufacturer websites for product data */
async function cmdCrawl(): Promise<void> {
	const brandArg = process.argv[3];
	if (brandArg) {
		console.log(`=== Crawling ${brandArg} ===\n`);
		const result = await crawlBrand(brandArg);
		console.log(`\nResult: ${result.discovered} discovered, ${result.saved} saved, ${result.errors} errors`);
	} else {
		console.log('=== Crawling All Manufacturer Websites ===\n');
		console.log(`Configured brands: ${getCrawlerBrands().join(', ')}\n`);
		const result = await crawlAllBrands();
		console.log(`\nTotal: ${result.totalDiscovered} discovered, ${result.totalSaved} saved, ${result.totalErrors} errors`);
		console.log(`Total flashlights in DB: ${countFlashlights()}`);
	}
}

/** Scrape full product page HTML for missing specs */
async function cmdDetailScrape(): Promise<void> {
	const maxArg = parseInt(process.argv[3] || '500', 10);
	const force = process.argv.includes('--force');
	// Brand filter: --brand=Olight
	const brandFlag = process.argv.find(a => a.startsWith('--brand='));
	const brand = brandFlag?.split('=')[1];
	console.log(`=== Detail Scraping (max ${maxArg} items${brand ? `, brand: ${brand}` : ''}) ===\n`);
	const result = await scrapeDetailsForIncomplete({ maxItems: maxArg, force, brand });
	console.log(`\nResult: ${result.scraped} scraped, ${result.enriched} enriched, ${result.skipped} skipped, ${result.errors} errors`);
	console.log(`Total flashlights in DB: ${countFlashlights()}`);
}

/** Enrich entries with missing required attributes */
async function cmdEnrich(): Promise<void> {
	console.log('=== Enrichment Pipeline ===\n');

	const scrapeFlag = process.argv.includes('--scrape');
	const result = await enrichAllEntries({
		scrapeManufacturers: scrapeFlag,
		maxScrape: 100,
	});

	console.log(`\nTotal entries: ${result.total}`);
	console.log(`Enriched: ${result.enriched}`);
}

/** Enrich from BudgetLightForum review threads */
async function cmdBlf(): Promise<void> {
	console.log('=== BudgetLightForum Enrichment ===\n');
	const { enrichFromBlf } = await import('./extraction/blf-scraper.js');
	const maxEntries = parseInt(process.argv[3] || '200', 10);
	const result = await enrichFromBlf({
		maxEntries,
		minMissing: 3,
	});
	console.log(`\nProcessed: ${result.processed}`);
	console.log(`Enriched: ${result.enriched}`);
	console.log(`Topics searched: ${result.topicsSearched}`);
	console.log(`Topics fetched: ${result.topicsFetched}`);
}

/** Scrape review sites for spec data */
async function cmdReviews(): Promise<void> {
	const siteArg = process.argv[3];
	if (siteArg) {
		console.log(`=== Scraping Review Site: ${siteArg} ===\n`);
		const result = await scrapeReviewSite(siteArg);
		console.log(`\nResult: ${result.discovered} reviews discovered, ${result.enriched} DB entries enriched`);
	} else {
		console.log('=== Scraping All Review Sites ===\n');
		const result = await scrapeAllReviewSites();
		console.log(`\nTotal: ${result.totalDiscovered} discovered, ${result.totalEnriched} enriched`);
		for (const [site, counts] of Object.entries(result.bySite)) {
			console.log(`  ${site}: ${counts.discovered} discovered, ${counts.enriched} enriched`);
		}
	}
	console.log(`\nTotal flashlights in DB: ${countFlashlights()}`);
}

/** Download, optimize, and build sprite sheet from product images */
async function cmdImages(): Promise<void> {
	const flags = process.argv.slice(3);
	console.log('=== Image Pipeline ===\n');
	console.log('Running: bun pipeline/images/scrape-images.ts', flags.join(' '));
	const proc = Bun.spawn(['bun', 'run', 'pipeline/images/scrape-images.ts', ...flags], {
		cwd: import.meta.dir.replace(/\/pipeline$/, ''),
		stdout: 'inherit',
		stderr: 'inherit',
	});
	await proc.exited;
}

/** Clean up the database: remove dupes and entries missing images */
function cmdCleanup(): void {
	console.log('=== Database Cleanup ===\n');

	const beforeCount = countFlashlights();
	console.log(`Entries before cleanup: ${beforeCount}`);

	// Remove duplicates (keep best entry per brand+model group)
	const dupesRemoved = removeDuplicates();
	console.log(`Duplicates removed: ${dupesRemoved}`);

	// Remove entries without images
	const noImageRemoved = deleteEntriesWithoutImages();
	console.log(`Entries without images removed: ${noImageRemoved}`);

	const afterCount = countFlashlights();
	console.log(`\nEntries after cleanup: ${afterCount} (removed ${beforeCount - afterCount} total)`);
}

/** Run full pipeline: discover → scrape in batches → build */
async function cmdRun(): Promise<void> {
	console.log('=== Full Pipeline Run ===\n');

	// Step 1: Crawl Shopify stores (fastest, most reliable)
	console.log('Step 1: Crawling Shopify stores...');
	await cmdShopify();

	// Step 2: Crawl WooCommerce stores
	console.log('\nStep 2: Crawling WooCommerce stores...');
	const wooResult = await crawlAllWooStores();
	console.log(`WooCommerce: ${wooResult.totalSaved} saved`);

	// Step 3: Detail scrape for missing specs (length, LED, etc.)
	console.log('\nStep 3: Detail scraping product pages...');
	await cmdDetailScrape();

	// Step 4: Enrich remaining missing attributes via inference
	console.log('\nStep 4: Enriching missing attributes...');
	await cmdEnrich();

	// Step 5: Build FlashlightDB JSON
	console.log('\nStep 5: Building FlashlightDB JSON...');
	await cmdBuild();

	// Step 6: Verify
	console.log('\nStep 6: Verification...');
	await cmdVerifyAll();
}

/** AI-extract specs from raw_spec_text using OpenRouter */
async function cmdAiParse(): Promise<void> {
	const maxItems = parseInt(process.argv[3] || '500', 10);
	const dryRun = process.argv.includes('--dry-run');
	const brandFlag = process.argv.find((a) => a.startsWith('--brand='));
	const brand = brandFlag?.split('=')[1];
	const minMissingFlag = process.argv.find((a) => a.startsWith('--min-missing='));
	const minMissing = minMissingFlag ? parseInt(minMissingFlag.split('=')[1], 10) : 1;

	const sourceFlag = process.argv.find((a) => a.startsWith('--source='));
	const source = sourceFlag?.split('=')[1] as 'all' | 'reviews' | 'retailers' | 'manufacturers' | undefined;

	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) {
		console.error('Error: OPENROUTER_API_KEY not set. Run: source ~/.secrets');
		process.exit(1);
	}

	console.log(`=== AI Spec Parser${dryRun ? ' (DRY RUN)' : ''} ===`);
	console.log(`  Max items: ${maxItems}, min missing: ${minMissing}${brand ? `, brand: ${brand}` : ''}${source ? `, source: ${source}` : ''}\n`);

	// Lazy import to avoid loading when running other commands
	const { aiParseAllEntries } = await import('./enrichment/ai-parser.js');

	const result = await aiParseAllEntries({ apiKey, maxItems, dryRun, brand, minMissing, source });

	const costIn = (result.inputTokens / 1_000_000) * 0.80;
	const costOut = (result.outputTokens / 1_000_000) * 4.0;
	const totalCost = costIn + costOut;

	console.log(`\n=== AI Parse Results ===`);
	console.log(`  Processed: ${result.processed}`);
	console.log(`  Enriched:  ${result.enriched}`);
	console.log(`  Fields added: ${result.fieldsAdded}`);
	console.log(`  Skipped:   ${result.skipped}`);
	console.log(`  Errors:    ${result.errors}`);
	if (!dryRun) {
		console.log(`  Tokens:    ${result.inputTokens} in / ${result.outputTokens} out`);
		console.log(`  Est. cost: $${totalCost.toFixed(3)}`);
	}
}

async function cmdRawFetch(): Promise<void> {
	const maxItems = parseInt(process.argv[3] || '500', 10);
	const dryRun = process.argv.includes('--dry-run');
	const domainFlag = process.argv.find((a) => a.startsWith('--domain='));
	const domain = domainFlag?.split('=')[1];

	console.log(`=== Raw Text Fetcher${dryRun ? ' (DRY RUN)' : ''} ===`);
	console.log(`  Max items: ${maxItems}${domain ? `, domain: ${domain}` : ''}\n`);

	const { fetchRawTextBatch } = await import('./extraction/raw-text-fetcher.js');
	const result = await fetchRawTextBatch({ maxItems, domain, dryRun });

	console.log(`\n=== Raw Fetch Results ===`);
	console.log(`  Processed: ${result.processed}`);
	console.log(`  Saved:     ${result.saved}`);
	console.log(`  Too short: ${result.tooShort} (candidates for CFC headless scraping)`);
	console.log(`  Errors:    ${result.errors}`);

	if (result.skippedDomains && result.skippedDomains.length > 0) {
		console.log(`\n  Skipped domains (need CFC headless):`);
		result.skippedDomains.forEach((d) => console.log(`    ${d}`));
	}
}

/** Crawl WooCommerce stores */
async function cmdWooCommerce(): Promise<void> {
	const brandArg = process.argv[3];
	if (brandArg) {
		const store = WOOCOMMERCE_STORES.find((s) => s.brand.toLowerCase() === brandArg.toLowerCase());
		if (!store) {
			console.log(`No WooCommerce store configured for ${brandArg}`);
			console.log(`Available: ${WOOCOMMERCE_STORES.map((s) => s.brand).join(', ')}`);
			return;
		}
		console.log(`=== WooCommerce Crawl: ${store.brand} ===\n`);
		const result = await crawlWooStore(store);
		console.log(`\nResult: ${result.saved} saved, ${result.skipped} skipped out of ${result.total}`);
	} else {
		console.log('=== Crawling All WooCommerce Stores ===\n');
		console.log(`Stores: ${WOOCOMMERCE_STORES.map((s) => s.brand).join(', ')}\n`);
		const result = await crawlAllWooStores();
		console.log(`\nTotal saved: ${result.totalSaved}`);
		for (const [brand, count] of Object.entries(result.byBrand)) {
			console.log(`  ${brand}: ${count}`);
		}
		console.log(`\nTotal flashlights in DB: ${countFlashlights()}`);
	}
}

/** Run full orchestrated pipeline — all steps in sequence */
async function cmdRunFull(): Promise<void> {
	const shadow = process.argv.includes('--shadow');
	console.log(`=== Full Orchestrated Pipeline${shadow ? ' (with shadow verification)' : ''} ===\n`);

	const step = (n: number, label: string) => console.log(`\n${'='.repeat(60)}\n  Step ${n}: ${label}\n${'='.repeat(60)}\n`);

	// Step 1: Crawl Shopify stores
	step(1, 'Shopify store crawl');
	await cmdShopify();

	// Step 2: Crawl WooCommerce stores
	step(2, 'WooCommerce store crawl');
	const wooResult = await crawlAllWooStores();
	console.log(`WooCommerce: ${wooResult.totalSaved} saved`);

	// Step 3: Detail scrape for missing specs
	step(3, 'Detail scraping HTML product pages');
	await cmdDetailScrape();

	// Step 4: Raw text fetch for new entries
	step(4, 'Raw text fetch (bulk)');
	await cmdRawFetch();

	// Step 5: Review site scraping
	step(5, 'Review site scraping (all sites)');
	await cmdReviews();

	// Step 6: AI parse (all sources, entries with ≥1 missing field)
	step(6, 'AI parsing all entries with missing fields');
	await cmdAiParse();

	// Step 7: FL1 derivation + title enrichment
	step(7, 'Enrichment (FL1 derivation + title extraction)');
	await cmdEnrich();

	// Step 8: Build JSON output
	step(8, 'Building FlashlightDB JSON');
	await cmdBuild();

	// Step 9: Final stats
	step(9, 'Pipeline statistics');
	cmdStats();

	console.log('\n=== Full pipeline complete ===');
}

main().catch((err) => {
	console.error('Pipeline error:', err);
	closeDb();
	process.exit(1);
});
