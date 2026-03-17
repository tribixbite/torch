/**
 * Vision grid builder — composes thumbnail grids for batch AI classification.
 * Creates 5x5 grids of 100x100 thumbnails with labeled positions.
 * Used for switch type and color detection via Gemini vision.
 */
import Database from 'bun:sqlite';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const THUMB_DIR = 'pipeline-data/images/thumbs';
const GRID_DIR = '/data/data/com.termux/files/usr/tmp/vision-grids';
const THUMB_SIZE = 100;
const GRID_COLS = 5;
const GRID_ROWS = 5;
const BATCH_SIZE = GRID_COLS * GRID_ROWS; // 25 per grid
// Add label space below each thumbnail
const LABEL_HEIGHT = 16;
const CELL_HEIGHT = THUMB_SIZE + LABEL_HEIGHT;

interface EntryForVision {
	id: string;
	model: string;
	brand: string;
	needsSwitch: boolean;
	needsColor: boolean;
}

/** Get entries that need switch or color classification */
function getEntriesNeedingVision(db: Database): EntryForVision[] {
	const rows = db.query(`
		SELECT id, model, brand,
			CASE WHEN switch IS NULL OR length(switch) <= 2 THEN 1 ELSE 0 END as needs_switch,
			CASE WHEN color IS NULL OR length(color) <= 2 THEN 1 ELSE 0 END as needs_color
		FROM flashlights
		WHERE (switch IS NULL OR length(switch) <= 2 OR color IS NULL OR length(color) <= 2)
		ORDER BY brand, model
	`).all() as any[];

	// Filter to entries that actually have thumbnail files
	return rows
		.filter(r => fs.existsSync(path.join(THUMB_DIR, `${r.id}.webp`)))
		.map(r => ({
			id: r.id,
			model: r.model,
			brand: r.brand,
			needsSwitch: r.needs_switch === 1,
			needsColor: r.needs_color === 1,
		}));
}

/** Build a single grid image from a batch of entries */
async function buildGrid(entries: EntryForVision[], gridIndex: number): Promise<string> {
	const width = GRID_COLS * THUMB_SIZE;
	const height = GRID_ROWS * CELL_HEIGHT;

	// Create base canvas (dark background)
	const composites: sharp.OverlayOptions[] = [];

	for (let i = 0; i < entries.length; i++) {
		const col = i % GRID_COLS;
		const row = Math.floor(i / GRID_COLS);
		const x = col * THUMB_SIZE;
		const y = row * CELL_HEIGHT;

		const thumbPath = path.join(THUMB_DIR, `${entries[i].id}.webp`);
		try {
			const thumbBuf = await sharp(thumbPath)
				.resize(THUMB_SIZE, THUMB_SIZE, { fit: 'contain', background: { r: 30, g: 30, b: 30, alpha: 1 } })
				.toBuffer();

			composites.push({ input: thumbBuf, left: x, top: y });
		} catch {
			// Skip broken images
		}

		// Add position label as SVG text — escape XML entities
		const label = `${i + 1}`;
		const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
		const labelText = escXml(`${label}: ${entries[i].brand.substring(0, 3)} ${entries[i].model.substring(0, 12)}`);
		const svgLabel = Buffer.from(`<svg width="${THUMB_SIZE}" height="${LABEL_HEIGHT}">
			<rect width="${THUMB_SIZE}" height="${LABEL_HEIGHT}" fill="#1a1a1a"/>
			<text x="4" y="12" font-size="11" fill="#aaa" font-family="monospace">${labelText}</text>
		</svg>`);
		composites.push({ input: svgLabel, left: x, top: y + THUMB_SIZE });
	}

	const outputPath = path.join(GRID_DIR, `grid-${String(gridIndex).padStart(4, '0')}.png`);
	await sharp({
		create: {
			width,
			height,
			channels: 4,
			background: { r: 30, g: 30, b: 30, alpha: 1 },
		},
	})
		.composite(composites)
		.png({ quality: 90 })
		.toFile(outputPath);

	return outputPath;
}

/** Main: build all grids and output manifest */
async function main() {
	const db = new Database('pipeline-data/db/torch.sqlite');
	const entries = getEntriesNeedingVision(db);
	console.log(`Found ${entries.length} entries needing vision classification`);

	// Create output directory
	fs.mkdirSync(GRID_DIR, { recursive: true });

	// Build grids
	const totalGrids = Math.ceil(entries.length / BATCH_SIZE);
	console.log(`Building ${totalGrids} grids (${BATCH_SIZE} per grid)`);

	const manifest: Array<{
		gridPath: string;
		entries: Array<{ position: number; id: string; model: string; brand: string; needsSwitch: boolean; needsColor: boolean }>;
	}> = [];

	for (let g = 0; g < totalGrids; g++) {
		const batch = entries.slice(g * BATCH_SIZE, (g + 1) * BATCH_SIZE);
		const gridPath = await buildGrid(batch, g);
		manifest.push({
			gridPath,
			entries: batch.map((e, i) => ({
				position: i + 1,
				id: e.id,
				model: e.model,
				brand: e.brand,
				needsSwitch: e.needsSwitch,
				needsColor: e.needsColor,
			})),
		});

		if ((g + 1) % 50 === 0 || g === totalGrids - 1) {
			console.log(`  Built ${g + 1}/${totalGrids} grids`);
		}
	}

	// Write manifest
	const manifestPath = path.join(GRID_DIR, 'manifest.json');
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
	console.log(`Manifest written to ${manifestPath}`);
	console.log(`Grid images in ${GRID_DIR}/`);
}

main().catch(console.error);
