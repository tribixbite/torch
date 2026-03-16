/**
 * AI-powered spec parser — extracts structured flashlight specs from raw text
 * using OpenRouter API (healer-alpha). Designed to fill gaps that regex couldn't parse.
 *
 * Reads raw_spec_text entries from DB, sends to LLM with targeted extraction prompt,
 * validates responses, and merges ONLY missing fields into existing entries.
 */
import { ExtractionResultSchema, hasRequiredAttributes } from '../schema/canonical.js';
import type { FlashlightEntry, ExtractionResult } from '../schema/canonical.js';
import { getAllFlashlights, getRawSpecText, upsertFlashlight, getDb } from '../store/db.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openrouter/healer-alpha';
const MAX_INPUT_CHARS = 3000;
const RATE_LIMIT_MS = 600; // ~1.7 req/s

/** System prompt: extraction-focused, no guessing */
const SYSTEM_PROMPT = `You are a flashlight specification extractor. Given raw text from a flashlight product page, extract ONLY explicitly stated values. Return a JSON object.

Field formats:
- lumens: number[] — all listed lumen values, highest first (e.g. [3000, 1200, 400, 5])
- throw_m: number — beam distance in meters
- intensity_cd: number — peak beam intensity in candela
- runtime_hours: number[] — all runtime values in hours (convert "90 min" to 1.5, "2h30m" to 2.5)
- length_mm: number — overall length in mm (convert inches * 25.4, cm * 10)
- weight_g: number — weight in grams (convert oz * 28.35, lb * 453.6)
- led: string[] — LED/emitter names (e.g. ["SST-40"], ["XHP70.3 HI"], ["Osram P9"])
- battery: string[] — battery types (e.g. ["21700"], ["18650"], ["CR123A"], ["AA"])
- material: string[] — body materials: "aluminum", "titanium", "copper", "brass", "stainless steel", "polymer", "nylon"
- switch: string[] — switch types: "side", "tail", "dual", "rotary", "electronic", "mechanical", "magnetic"
- color: string[] — body colors: "black", "dark grey", "silver", "od green", "desert tan", "blue", "red", "orange", etc.
- features: string[] — use ONLY these canonical values: "rechargeable", "clip", "magnet", "lockout", "strobe", "SOS", "battery indicator", "mode memory", "moonlight", "turbo", "aux LED", "Anduril", "ramping", "USB-C charging", "IP68", "IPX8", "momentary", "beacon", "timer", "lanyard"
- cri: number — Color Rendering Index (50-100)
- cct: number — Correlated Color Temperature in Kelvin (1800-10000)
- beam_angle: number — beam angle in degrees
- price_usd: number — price in USD
- type: string[] — product type: "flashlight", "headlamp", "lantern", "keychain", "penlight", "weapon", "right-angle", "dive", "bike"

Rules:
- Extract ONLY values explicitly stated in the text
- Return null for any field not found — NEVER guess, estimate, or default
- Convert all measurements to metric (mm, g, m)
- For runtime, convert all to hours (minutes / 60, days * 24)
- If multiple values exist for lumens/runtime, include all
- Return valid JSON only, no markdown or commentary`;

/** OpenRouter API response types */
interface OpenRouterResponse {
	choices: Array<{
		message: {
			content: string;
		};
	}>;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

/** Result summary from AI parsing run */
export interface AiParseResult {
	processed: number;
	enriched: number;
	fieldsAdded: number;
	errors: number;
	skipped: number;
	inputTokens: number;
	outputTokens: number;
}

/** Call OpenRouter chat completions API with retry logic */
async function callOpenRouter(
	userPrompt: string,
	apiKey: string,
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
	const maxRetries = 3;
	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const res = await fetch(OPENROUTER_URL, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
					'HTTP-Referer': 'https://github.com/nicholasgasior/torch',
				},
				body: JSON.stringify({
					model: MODEL,
					messages: [
						{ role: 'system', content: SYSTEM_PROMPT },
						{ role: 'user', content: userPrompt },
					],
					temperature: 0,
					max_tokens: 1024,
					response_format: { type: 'json_object' },
				}),
			});

			if (res.status === 429) {
				// Rate limited — respect Retry-After header
				const retryAfter = parseInt(res.headers.get('Retry-After') ?? '5', 10);
				console.log(`    Rate limited, waiting ${retryAfter}s...`);
				await Bun.sleep(retryAfter * 1000);
				continue;
			}

			if (!res.ok) {
				const body = await res.text();
				throw new Error(`OpenRouter HTTP ${res.status}: ${body.slice(0, 200)}`);
			}

			const data = (await res.json()) as OpenRouterResponse;
			const content = data.choices?.[0]?.message?.content ?? '';
			return {
				content,
				promptTokens: data.usage?.prompt_tokens ?? 0,
				completionTokens: data.usage?.completion_tokens ?? 0,
			};
		} catch (err) {
			lastError = err as Error;
			if (attempt < maxRetries) {
				const delay = Math.pow(2, attempt) * 1000;
				await Bun.sleep(delay);
			}
		}
	}

	throw lastError ?? new Error('OpenRouter call failed');
}

/** Build user prompt from entry data and raw text segments */
function buildUserPrompt(
	entry: FlashlightEntry,
	rawTexts: { category: string; text_content: string }[],
	missingFields: string[],
): string {
	// Combine raw text segments with category labels
	let combinedText = '';
	for (const segment of rawTexts) {
		combinedText += `[${segment.category.toUpperCase()}]\n${segment.text_content}\n\n`;
	}

	// Truncate to max chars
	if (combinedText.length > MAX_INPUT_CHARS) {
		combinedText = combinedText.slice(0, MAX_INPUT_CHARS) + '\n[TRUNCATED]';
	}

	return `Product: ${entry.brand} ${entry.model}

Extract ONLY these missing fields: ${missingFields.join(', ')}

Raw text from product page:
${combinedText}

Return JSON with only the fields listed above. Use null for anything not found.`;
}

/** Validate and filter AI response to only missing fields */
function parseAiResponse(
	responseText: string,
	missingFields: string[],
): Partial<ExtractionResult> | null {
	try {
		// Strip markdown code fences that some models wrap responses in
		let cleanedText = responseText.trim();
		const fenceMatch = cleanedText.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
		if (fenceMatch) cleanedText = fenceMatch[1].trim();

		const parsed = JSON.parse(cleanedText);
		if (typeof parsed !== 'object' || parsed === null) return null;

		// Filter to only missing fields
		const filtered: Record<string, unknown> = {};
		const missingSet = new Set(missingFields);

		for (const [key, value] of Object.entries(parsed)) {
			if (!missingSet.has(key)) continue;
			if (value === null || value === undefined) continue;
			filtered[key] = value;
		}

		if (Object.keys(filtered).length === 0) return null;

		// Anti-fabrication: reject out-of-range values
		if (typeof filtered.lumens !== 'undefined') {
			const lumens = filtered.lumens as number[];
			if (Array.isArray(lumens)) {
				const valid = lumens.filter((l) => typeof l === 'number' && l > 0 && l < 1_000_000);
				if (valid.length === 0) delete filtered.lumens;
				else filtered.lumens = valid;
			} else {
				delete filtered.lumens;
			}
		}
		if (typeof filtered.throw_m === 'number') {
			if (filtered.throw_m < 5 || filtered.throw_m > 5000) delete filtered.throw_m;
		}
		if (typeof filtered.length_mm === 'number') {
			if (filtered.length_mm < 20 || filtered.length_mm > 800) delete filtered.length_mm;
		}
		if (typeof filtered.weight_g === 'number') {
			if (filtered.weight_g < 5 || filtered.weight_g > 10000) delete filtered.weight_g;
		}
		if (typeof filtered.cri === 'number') {
			if (filtered.cri < 50 || filtered.cri > 100) delete filtered.cri;
		}
		if (typeof filtered.cct === 'number') {
			if (filtered.cct < 1800 || filtered.cct > 10000) delete filtered.cct;
		}
		if (typeof filtered.intensity_cd === 'number') {
			if (filtered.intensity_cd < 1 || filtered.intensity_cd > 10_000_000) delete filtered.intensity_cd;
		}
		if (typeof filtered.price_usd === 'number') {
			if (filtered.price_usd <= 0 || filtered.price_usd > 10000) delete filtered.price_usd;
		}
		if (typeof filtered.beam_angle === 'number') {
			if (filtered.beam_angle < 1 || filtered.beam_angle > 360) delete filtered.beam_angle;
		}

		// Validate arrays — ensure they contain strings
		for (const arrField of ['led', 'battery', 'material', 'switch', 'color', 'features', 'type']) {
			if (filtered[arrField] !== undefined) {
				if (!Array.isArray(filtered[arrField])) {
					delete filtered[arrField];
				} else {
					const arr = (filtered[arrField] as unknown[]).filter(
						(v) => typeof v === 'string' && v.length > 0 && v.length < 100,
					);
					if (arr.length === 0) delete filtered[arrField];
					else filtered[arrField] = arr;
				}
			}
		}

		// Validate runtime_hours array — ensure numbers
		if (filtered.runtime_hours !== undefined) {
			if (!Array.isArray(filtered.runtime_hours)) {
				delete filtered.runtime_hours;
			} else {
				const arr = (filtered.runtime_hours as unknown[]).filter(
					(v) => typeof v === 'number' && v > 0 && v < 100000,
				);
				if (arr.length === 0) delete filtered.runtime_hours;
				else filtered.runtime_hours = arr;
			}
		}

		if (Object.keys(filtered).length === 0) return null;

		// Zod partial validate — use safeParse to avoid throwing
		const result = ExtractionResultSchema.partial().safeParse(filtered);
		if (!result.success) return null;

		return result.data as Partial<ExtractionResult>;
	} catch {
		return null;
	}
}

/** Map hasRequiredAttributes missing field names to ExtractionResult field names */
function mapMissingField(field: string): string | null {
	const map: Record<string, string> = {
		'model': 'model',
		'brand': 'brand',
		'type': 'type',
		'led': 'led',
		'battery': 'battery',
		'lumens': 'lumens',
		'throw_m': 'throw_m',
		'runtime_hours': 'runtime_hours',
		'switch': 'switch',
		'features': 'features',
		'color': 'color',
		'material': 'material',
		'length_mm': 'length_mm',
		'weight_g': 'weight_g',
		'price_usd': 'price_usd',
		// purchase_url can't be extracted from specs text
		'purchase_url': null,
	};
	return map[field] ?? field;
}

/** Merge extracted fields into entry, only filling null/empty values */
function mergeIntoEntry(entry: FlashlightEntry, extracted: Partial<ExtractionResult>): number {
	let fieldsAdded = 0;

	// Scalar performance fields
	if (extracted.throw_m && (!entry.performance?.claimed?.throw_m || entry.performance.claimed.throw_m <= 0)) {
		entry.performance.claimed.throw_m = extracted.throw_m;
		fieldsAdded++;
	}
	if (extracted.intensity_cd && !entry.performance?.claimed?.intensity_cd) {
		entry.performance.claimed.intensity_cd = extracted.intensity_cd;
		fieldsAdded++;
	}
	if (extracted.beam_angle && !entry.performance?.claimed?.beam_angle) {
		entry.performance.claimed.beam_angle = extracted.beam_angle;
		fieldsAdded++;
	}
	if (extracted.cri && !entry.performance?.claimed?.cri) {
		entry.performance.claimed.cri = extracted.cri;
		fieldsAdded++;
	}
	if (extracted.cct && !entry.performance?.claimed?.cct) {
		entry.performance.claimed.cct = extracted.cct;
		fieldsAdded++;
	}

	// Array performance fields
	if (extracted.lumens?.length && !entry.performance?.claimed?.lumens?.length) {
		entry.performance.claimed.lumens = extracted.lumens;
		fieldsAdded++;
	}
	if (extracted.runtime_hours?.length && !entry.performance?.claimed?.runtime_hours?.length) {
		entry.performance.claimed.runtime_hours = extracted.runtime_hours;
		fieldsAdded++;
	}

	// Scalar physical fields
	if (extracted.length_mm && (entry.length_mm == null || entry.length_mm <= 0)) {
		entry.length_mm = extracted.length_mm;
		fieldsAdded++;
	}
	if (extracted.weight_g && (entry.weight_g == null || entry.weight_g <= 0)) {
		entry.weight_g = extracted.weight_g;
		fieldsAdded++;
	}

	// Price
	if (extracted.price_usd && (entry.price_usd == null || entry.price_usd <= 0)) {
		entry.price_usd = extracted.price_usd;
		fieldsAdded++;
	}

	// Array fields — only fill if currently empty
	const arrayMerges: [keyof ExtractionResult, keyof FlashlightEntry][] = [
		['led', 'led'],
		['battery', 'battery'],
		['material', 'material'],
		['switch', 'switch'],
		['color', 'color'],
		['features', 'features'],
		['type', 'type'],
	];

	for (const [extractKey, entryKey] of arrayMerges) {
		const extractedArr = extracted[extractKey] as string[] | undefined;
		const entryArr = entry[entryKey] as string[];
		if (extractedArr?.length && (!entryArr || entryArr.length === 0)) {
			(entry[entryKey] as string[]) = extractedArr;
			fieldsAdded++;
		}
	}

	return fieldsAdded;
}

/** Get flashlight IDs that have raw spec text entries */
function getFlashlightIdsWithRawText(brand?: string): string[] {
	const db = getDb();
	let query = `
		SELECT DISTINCT r.flashlight_id FROM raw_spec_text r
		JOIN flashlights f ON f.id = r.flashlight_id
	`;
	const params: Record<string, unknown> = {};
	if (brand) {
		query += ` WHERE LOWER(f.brand) = LOWER($brand)`;
		params.$brand = brand;
	}
	query += ' ORDER BY r.flashlight_id';
	const rows = db.prepare(query).all(params) as { flashlight_id: string }[];
	return rows.map((r) => r.flashlight_id);
}

/** Get a single flashlight entry by ID */
function getFlashlightById(id: string): FlashlightEntry | null {
	const db = getDb();
	const row = db.prepare('SELECT * FROM flashlights WHERE id = ?').get(id) as Record<string, unknown> | null;
	if (!row) return null;

	// Reuse rowToEntry logic inline (same as db.ts)
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

/** Main AI parsing loop */
export async function aiParseAllEntries(options: {
	apiKey: string;
	maxItems?: number;
	dryRun?: boolean;
	brand?: string;
	minMissing?: number;
}): Promise<AiParseResult> {
	const { apiKey, maxItems = Infinity, dryRun = false, brand, minMissing = 1 } = options;

	const result: AiParseResult = {
		processed: 0,
		enriched: 0,
		fieldsAdded: 0,
		errors: 0,
		skipped: 0,
		inputTokens: 0,
		outputTokens: 0,
	};

	// Get flashlight IDs that have raw spec text
	const flashlightIds = getFlashlightIdsWithRawText(brand);
	console.log(`  Found ${flashlightIds.length} flashlights with raw spec text${brand ? ` (brand: ${brand})` : ''}`);

	let processCount = 0;
	let errorStreak = 0;
	const maxErrorStreak = 10;

	for (const fid of flashlightIds) {
		if (processCount >= maxItems) break;

		// Circuit breaker: abort if too many consecutive errors
		if (errorStreak >= maxErrorStreak) {
			console.log(`  Circuit breaker: ${maxErrorStreak} consecutive errors, aborting`);
			break;
		}

		// Load entry and check missing fields
		const entry = getFlashlightById(fid);
		if (!entry) { result.skipped++; continue; }

		const { missing } = hasRequiredAttributes(entry);
		// Map to extractable fields (filter out purchase_url which AI can't help with)
		const extractableFields = missing
			.map(mapMissingField)
			.filter((f): f is string => f !== null);

		if (extractableFields.length < minMissing) {
			result.skipped++;
			continue;
		}

		// Load raw text segments
		const rawTexts = getRawSpecText(fid);
		if (!rawTexts.length) { result.skipped++; continue; }

		// Build prompt
		const userPrompt = buildUserPrompt(entry, rawTexts, extractableFields);

		if (dryRun) {
			processCount++;
			result.processed++;
			if (processCount <= 3) {
				console.log(`\n  [DRY RUN] ${entry.brand} ${entry.model}`);
				console.log(`    Missing: ${extractableFields.join(', ')}`);
				console.log(`    Raw text chars: ${rawTexts.reduce((s, t) => s + t.text_content.length, 0)}`);
				console.log(`    Prompt length: ${userPrompt.length} chars`);
			}
			continue;
		}

		// Call AI
		try {
			const response = await callOpenRouter(userPrompt, apiKey);
			result.inputTokens += response.promptTokens;
			result.outputTokens += response.completionTokens;

			// Parse and validate response
			const extracted = parseAiResponse(response.content, extractableFields);
			if (extracted && Object.keys(extracted).length > 0) {
				const added = mergeIntoEntry(entry, extracted);
				if (added > 0) {
					entry.updated_at = new Date().toISOString();
					upsertFlashlight(entry);
					result.enriched++;
					result.fieldsAdded += added;
				}
			}

			errorStreak = 0;
			processCount++;
			result.processed++;

			// Progress report every 25 items
			if (processCount % 25 === 0) {
				const costIn = (result.inputTokens / 1_000_000) * 0.80;
				const costOut = (result.outputTokens / 1_000_000) * 4.0;
				const totalCost = costIn + costOut;
				console.log(
					`  Progress: ${processCount}/${Math.min(flashlightIds.length, maxItems)} processed, ` +
					`${result.enriched} enriched (+${result.fieldsAdded} fields), ` +
					`${result.errors} errors, est. cost: $${totalCost.toFixed(3)}`,
				);
			}

			// Rate limit
			await Bun.sleep(RATE_LIMIT_MS);
		} catch (err) {
			result.errors++;
			errorStreak++;
			console.log(`  Error on ${entry.brand} ${entry.model}: ${(err as Error).message}`);
		}
	}

	return result;
}
