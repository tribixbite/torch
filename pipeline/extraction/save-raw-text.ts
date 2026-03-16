#!/usr/bin/env bun
/**
 * Helper script to save raw text to the DB from CFC headless scraping.
 * Usage: bun run pipeline/extraction/save-raw-text.ts <flashlight_id> <url> <text_file>
 *
 * text_file is a file containing the extracted page text.
 */
import { getDb, addRawSpecText, closeDb } from '../store/db.js';

const [, , flashlightId, url, textFile] = process.argv;

if (!flashlightId || !url || !textFile) {
	console.error('Usage: bun run save-raw-text.ts <flashlight_id> <url> <text_file>');
	process.exit(1);
}

getDb();
const text = await Bun.file(textFile).text();

if (text.length < 50) {
	console.log(`SKIP: text too short (${text.length} chars)`);
} else {
	// Cap at 15k chars
	addRawSpecText(flashlightId, url, 'full-page', text.slice(0, 15000));
	console.log(`SAVED: ${text.length} chars for ${flashlightId}`);
}

closeDb();
