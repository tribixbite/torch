/**
 * Clean junk entries from the flashlight database.
 * Removes website pages, accessories, and marketing content
 * that were incorrectly scraped as flashlight products.
 */
import { getDb, closeDb } from '../pipeline/store/db.js';

const db = getDb();

// Disable foreign key checks for bulk deletion performance
db.exec('PRAGMA foreign_keys = OFF');

const beforeCount = (db.prepare('SELECT COUNT(*) as c FROM flashlights').get() as { c: number }).c;
console.log(`Starting count: ${beforeCount} flashlights`);

// --- Pattern categories ---

// Website/CMS pages — never valid flashlight models
const websitePages = [
	'login', 'register', 'addresses', 'wishlist', 'shipping',
	'privacy', 'warranty', 'return', 'about', 'contact', 'faq',
	'support', 'terms', 'policy', 'reviews', 'info', 'history',
	'blog', 'news', 'sale', 'gift card', 'affiliate', 'feedback',
	'dealer', 'locator', 'collection',
];

// Accessories — not flashlights themselves
const accessories = [
	'holster', 'filter', 'diffuser', 'charger', 'mount', 'strap',
	'case', 'pouch', 'headband', 'lanyard', 'clip', 'o-ring',
	'gasket', 'battery pack', 'battery holder', 'charging cable',
	'glass', 'lens', 'pcb', 'driver', 'ring', 'button', 'tube',
	'extension', 'screwdriver', 'bits', 'tripod', 'phone holder',
	'mouse pad', 'patch', 'cooling shell',
];

// Marketing/blog pages — not products
const marketingPages = [
	'bundle sale', 'fast shipping', 'custom illumination',
	'personalized', 'engraved', 'constant current', 'mos fet',
	'lumen and lux', 'raising hope', 'new flashlight coming',
];

// Build the WHERE clause with all LIKE conditions OR'd together
const allPatterns = [...websitePages, ...marketingPages, ...accessories];
const likeConditions = allPatterns.map((_, i) => `LOWER(model) LIKE $p${i}`);
const lengthCondition = 'LENGTH(model) > 80';

const whereClause = `WHERE (${likeConditions.join(' OR ')} OR ${lengthCondition})`;

// Bind pattern params with wildcards
const params: Record<string, string> = {};
allPatterns.forEach((pattern, i) => {
	params[`$p${i}`] = `%${pattern}%`;
});

// Preview what will be deleted (sample)
const previewSql = `SELECT brand, model FROM flashlights ${whereClause} ORDER BY brand, model`;
const preview = db.prepare(previewSql).all(params) as { brand: string; model: string }[];
console.log(`\nEntries matching junk patterns: ${preview.length}`);
console.log('\nSample entries to delete (first 40):');
for (const row of preview.slice(0, 40)) {
	console.log(`  [${row.brand}] ${row.model}`);
}
if (preview.length > 40) {
	console.log(`  ... and ${preview.length - 40} more`);
}

// Get IDs to delete
const idSql = `SELECT id FROM flashlights ${whereClause}`;
const idsToDelete = db.prepare(idSql).all(params) as { id: string }[];

// Delete in a transaction for atomicity and speed
db.exec('BEGIN TRANSACTION');

let deletedFlashlights = 0;
for (const { id } of idsToDelete) {
	// Remove related records first
	db.prepare('DELETE FROM raw_spec_text WHERE flashlight_id = ?').run(id);
	db.prepare('DELETE FROM sources WHERE flashlight_id = ?').run(id);
	db.prepare('DELETE FROM prices WHERE flashlight_id = ?').run(id);
	db.prepare('DELETE FROM reviews WHERE flashlight_id = ?').run(id);
	db.prepare('DELETE FROM flashlights WHERE id = ?').run(id);
	deletedFlashlights++;
}

// Clean any remaining orphaned rows (belt-and-suspenders)
const orphanedSources = db.prepare(
	'DELETE FROM sources WHERE flashlight_id NOT IN (SELECT id FROM flashlights)'
).run().changes;
const orphanedPrices = db.prepare(
	'DELETE FROM prices WHERE flashlight_id NOT IN (SELECT id FROM flashlights)'
).run().changes;
const orphanedReviews = db.prepare(
	'DELETE FROM reviews WHERE flashlight_id NOT IN (SELECT id FROM flashlights)'
).run().changes;
const orphanedRawSpec = db.prepare(
	'DELETE FROM raw_spec_text WHERE flashlight_id NOT IN (SELECT id FROM flashlights)'
).run().changes;

db.exec('COMMIT');

// Re-enable foreign keys
db.exec('PRAGMA foreign_keys = ON');

const afterCount = (db.prepare('SELECT COUNT(*) as c FROM flashlights').get() as { c: number }).c;

console.log('\n--- Results ---');
console.log(`Flashlights deleted: ${deletedFlashlights}`);
console.log(`Orphaned sources cleaned: ${orphanedSources}`);
console.log(`Orphaned prices cleaned: ${orphanedPrices}`);
console.log(`Orphaned reviews cleaned: ${orphanedReviews}`);
console.log(`Orphaned raw_spec_text cleaned: ${orphanedRawSpec}`);
console.log(`Remaining flashlights: ${afterCount}`);

closeDb();
