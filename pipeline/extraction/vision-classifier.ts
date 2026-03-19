/**
 * Vision classifier — sends grid images to Gemini for switch/color classification.
 * Uses Gemini 2.0 Flash (free tier, fast) or Gemini 2.5 Pro for accuracy.
 * Processes grids from vision-grid-builder.ts output.
 *
 * Usage: bun run pipeline/extraction/vision-classifier.ts [--start N] [--count N] [--model flash|pro]
 */
import Database from 'bun:sqlite';
import fs from 'fs';

const GRID_DIR = '/data/data/com.termux/files/usr/tmp/vision-grids';
const RESULTS_DIR = '/data/data/com.termux/files/usr/tmp/vision-results';
const API_KEY = process.env.GEMINI_API_KEY;
const CONCURRENCY = 3; // Parallel API calls
const RETRY_DELAY_MS = 5000;
const MAX_RETRIES = 3;

interface VisionResult {
	pos: number;
	switch?: string;
	color?: string;
	type?: string; // "not_flashlight"
}

interface ManifestEntry {
	gridPath: string;
	entries: Array<{
		position: number;
		id: string;
		model: string;
		brand: string;
		needsSwitch: boolean;
		needsColor: boolean;
	}>;
}

const CLASSIFICATION_PROMPT = `You are a flashlight product classifier. This is a 5x5 grid of flashlight product thumbnail images. Each cell has a position number (1-25) and short label.

For each image, classify:
1. **switch**: What kind of switch? Options: "tail", "side", "dual", "rotary", "twisty", "electronic", "unknown"
2. **color**: Primary body color? Options: "black", "silver", "gray", "OD green", "desert tan", "red", "blue", "orange", "yellow", "gold", "copper", "brass", "pink", "camo", "white", or describe briefly.

If the image is NOT a flashlight (battery, accessory, lantern, headlamp strap), set type: "not_flashlight".
If you cannot determine switch or color, use "unknown". Do NOT guess.

Return ONLY a JSON array:
[{"pos":1,"switch":"tail","color":"black"},{"pos":2,"type":"not_flashlight"},...]`;

/** Send a grid image to Gemini for classification */
async function classifyGrid(gridPath: string, modelName: string): Promise<VisionResult[]> {
	if (!API_KEY) throw new Error('GEMINI_API_KEY not set');

	const imageBytes = fs.readFileSync(gridPath);
	const base64Image = imageBytes.toString('base64');

	const apiModel = modelName === 'pro' ? 'gemini-2.5-pro-preview-06-05' : 'gemini-2.0-flash';
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent?key=${API_KEY}`;

	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			const resp = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					contents: [{
						parts: [
							{ text: CLASSIFICATION_PROMPT },
							{
								inline_data: {
									mime_type: 'image/png',
									data: base64Image,
								},
							},
						],
					}],
					generationConfig: {
						temperature: 0,
						maxOutputTokens: 2048,
						responseMimeType: 'application/json',
					},
				}),
			});

			if (resp.status === 429) {
				console.log(`  Rate limited, waiting ${RETRY_DELAY_MS * (attempt + 1)}ms...`);
				await Bun.sleep(RETRY_DELAY_MS * (attempt + 1));
				continue;
			}

			if (!resp.ok) {
				const err = await resp.text();
				throw new Error(`API ${resp.status}: ${err.substring(0, 200)}`);
			}

			const data = await resp.json() as any;
			const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
			if (!text) throw new Error('No text in response');

			// Parse JSON — handle markdown code blocks
			const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
			const results = JSON.parse(jsonStr) as VisionResult[];
			return results;
		} catch (e: any) {
			if (attempt === MAX_RETRIES - 1) throw e;
			console.log(`  Retry ${attempt + 1}: ${e.message?.substring(0, 80)}`);
			await Bun.sleep(RETRY_DELAY_MS);
		}
	}
	return [];
}

/** Apply vision results to the database */
function applyResults(
	db: Database,
	manifestEntry: ManifestEntry,
	results: VisionResult[],
): { switchFilled: number; colorFilled: number; notFlashlight: number } {
	let switchFilled = 0, colorFilled = 0, notFlashlight = 0;

	for (const result of results) {
		const entry = manifestEntry.entries.find(e => e.position === result.pos);
		if (!entry) continue;

		if (result.type === 'not_flashlight') {
			// Persist accessory classification to DB
			db.prepare(`UPDATE flashlights SET type = '["accessory"]' WHERE id = ?`).run(entry.id);
			notFlashlight++;
			continue;
		}

		// Normalize color values
		let color = result.color?.toLowerCase()?.trim();
		if (color) {
			// Map common variants
			const colorMap: Record<string, string> = {
				'od green': 'green', 'olive': 'green', 'olive drab': 'green',
				'desert tan': 'brown', 'coyote': 'brown', 'fde': 'brown', 'tan': 'brown',
				'dark gray': 'gray', 'dark grey': 'gray', 'gunmetal': 'gray',
				'natural': 'silver', 'raw aluminum': 'silver', 'stainless': 'silver',
				'sand': 'brown', 'khaki': 'brown', 'beige': 'brown',
			};
			color = colorMap[color] || color;
		}

		// Normalize switch values
		let switchType = result.switch?.toLowerCase()?.trim();
		if (switchType === 'unknown') switchType = undefined;
		if (color === 'unknown') color = undefined;

		// Only update fields that are missing
		const updates: string[] = [];
		const params: any[] = [];

		if (switchType && entry.needsSwitch) {
			updates.push('switch = ?');
			params.push(JSON.stringify([switchType]));
			switchFilled++;
		}
		if (color && entry.needsColor) {
			updates.push('color = ?');
			params.push(JSON.stringify([color]));
			colorFilled++;
		}

		if (updates.length > 0) {
			updates.push('updated_at = ?');
			params.push(new Date().toISOString());
			params.push(entry.id);
			db.run(`UPDATE flashlights SET ${updates.join(', ')} WHERE id = ?`, ...params);
		}
	}

	return { switchFilled, colorFilled, notFlashlight };
}

/** Process grids with concurrency control */
async function processGrids(
	manifest: ManifestEntry[],
	db: Database,
	modelName: string,
	start: number,
	count: number,
): Promise<void> {
	const end = Math.min(start + count, manifest.length);
	const grids = manifest.slice(start, end);

	let totalSwitch = 0, totalColor = 0, totalNotFlash = 0;
	let processed = 0;

	// Process in chunks of CONCURRENCY
	for (let i = 0; i < grids.length; i += CONCURRENCY) {
		const chunk = grids.slice(i, i + CONCURRENCY);
		const promises = chunk.map(async (entry, j) => {
			const gridIndex = start + i + j;
			try {
				const results = await classifyGrid(entry.gridPath, modelName);

				// Save raw results
				const resultPath = `${RESULTS_DIR}/result-${String(gridIndex).padStart(4, '0')}.json`;
				fs.writeFileSync(resultPath, JSON.stringify({ gridIndex, entries: entry.entries, results }, null, 2));

				// Apply to DB
				const stats = applyResults(db, entry, results);
				totalSwitch += stats.switchFilled;
				totalColor += stats.colorFilled;
				totalNotFlash += stats.notFlashlight;

				processed++;
				if (processed % 10 === 0 || processed === grids.length) {
					console.log(`  Processed ${processed}/${grids.length} grids | switch: +${totalSwitch}, color: +${totalColor}, not_flash: ${totalNotFlash}`);
				}
			} catch (e: any) {
				console.error(`  Grid ${gridIndex} failed: ${e.message?.substring(0, 100)}`);
			}
		});
		await Promise.all(promises);
		// Small delay between chunks to respect rate limits
		if (i + CONCURRENCY < grids.length) await Bun.sleep(1000);
	}

	console.log(`\nDone! switch: +${totalSwitch}, color: +${totalColor}, not_flashlight: ${totalNotFlash}`);
}

// Main
async function main() {
	if (!API_KEY) {
		console.error('Set GEMINI_API_KEY in ~/.secrets or .env');
		process.exit(1);
	}

	const args = process.argv.slice(2);
	const startIdx = args.includes('--start') ? parseInt(args[args.indexOf('--start') + 1]) : 0;
	const count = args.includes('--count') ? parseInt(args[args.indexOf('--count') + 1]) : 999;
	const modelName = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'flash';

	console.log(`=== Vision Classifier ===`);
	console.log(`Model: gemini-2.0-${modelName}, Start: ${startIdx}, Count: ${count}`);

	const manifestPath = `${GRID_DIR}/manifest.json`;
	if (!fs.existsSync(manifestPath)) {
		console.error('No manifest found. Run vision-grid-builder.ts first.');
		process.exit(1);
	}

	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ManifestEntry[];
	console.log(`Manifest: ${manifest.length} grids, ${manifest.reduce((s, g) => s + g.entries.length, 0)} entries`);

	fs.mkdirSync(RESULTS_DIR, { recursive: true });

	const db = new Database('pipeline-data/db/torch.sqlite');
	db.run('PRAGMA busy_timeout = 30000');
	db.run('PRAGMA journal_mode = WAL');

	await processGrids(manifest, db, modelName, startIdx, count);
}

main().catch(console.error);
