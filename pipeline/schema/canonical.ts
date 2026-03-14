/**
 * Canonical flashlight schema — the single source of truth for all pipeline data.
 * Uses Zod for runtime validation and TypeScript for compile-time safety.
 */
import { z } from 'zod';

// --- Zod schemas ---

export const PriceEntrySchema = z.object({
	retailer: z.string(),
	price: z.number(),
	currency: z.string().default('USD'),
	url: z.string().url(),
	affiliate: z.boolean().default(false),
	last_checked: z.string(), // ISO 8601
});

export const ReviewRefSchema = z.object({
	source: z.string(),
	url: z.string().url(),
	rating: z.number().optional(),
});

export const SourceRefSchema = z.object({
	source: z.string(),
	url: z.string(),
	scraped_at: z.string(),
	confidence: z.number().min(0).max(1).default(1),
});

export const PerformanceMetricsSchema = z.object({
	lumens: z.array(z.number()).optional(),
	intensity_cd: z.number().optional(),
	throw_m: z.number().optional(),
	beam_angle: z.number().optional(),
	efficacy: z.number().optional(),
	cri: z.number().optional(),
	cct: z.number().optional(),
	tint_duv: z.number().optional(),
	runtime_hours: z.array(z.number()).optional(),
});

/** Schema for LLM extraction — partial, with optional fields */
export const ExtractionResultSchema = z.object({
	model: z.string().optional(),
	brand: z.string().optional(),
	type: z.array(z.string()).optional(),
	led: z.array(z.string()).optional(),
	led_color: z.array(z.string()).optional(),
	lumens: z.array(z.number()).optional(),
	intensity_cd: z.number().optional(),
	throw_m: z.number().optional(),
	beam_angle: z.number().optional(),
	efficacy: z.number().optional(),
	cri: z.number().optional(),
	cct: z.number().optional(),
	battery: z.array(z.string()).optional(),
	wh: z.number().optional(),
	charging: z.array(z.string()).optional(),
	modes: z.array(z.string()).optional(),
	levels: z.number().optional(),
	blink: z.array(z.string()).optional(),
	runtime_hours: z.array(z.number()).optional(),
	length_mm: z.number().optional(),
	bezel_mm: z.number().optional(),
	body_mm: z.number().optional(),
	weight_g: z.number().optional(),
	material: z.array(z.string()).optional(),
	color: z.array(z.string()).optional(),
	impact: z.array(z.string()).optional(),
	environment: z.array(z.string()).optional(),
	switch: z.array(z.string()).optional(),
	features: z.array(z.string()).optional(),
	price_usd: z.number().optional(),
	year: z.number().optional(),
});

export const FlashlightEntrySchema = z.object({
	// Identity
	id: z.string(),
	family_id: z.string().optional(),
	model: z.string(),
	brand: z.string(),
	type: z.array(z.string()),
	year: z.number().optional(),
	discontinued: z.boolean().default(false),

	// Optics
	led: z.array(z.string()),
	led_color: z.array(z.string()),

	// Performance (namespaced)
	performance: z.object({
		claimed: PerformanceMetricsSchema,
		measured: z.record(z.string(), PerformanceMetricsSchema).default({}),
	}),

	// Power
	battery: z.array(z.string()),
	wh: z.number().optional(),
	charging: z.array(z.string()).default([]),

	// Modes
	modes: z.array(z.string()),
	levels: z.number().optional(),
	blink: z.array(z.string()).default([]),

	// Physical
	length_mm: z.number().optional(),
	bezel_mm: z.number().optional(),
	body_mm: z.number().optional(),
	weight_g: z.number().optional(),
	material: z.array(z.string()),
	color: z.array(z.string()),
	impact: z.array(z.string()).default([]),

	// Environment
	environment: z.array(z.string()).default([]),

	// UI
	switch: z.array(z.string()),
	features: z.array(z.string()),

	// Purchase
	price_usd: z.number().optional(),
	prices: z.array(PriceEntrySchema).default([]),
	purchase_urls: z.array(z.string()).default([]),
	info_urls: z.array(z.string()).default([]),

	// Media
	image_urls: z.array(z.string()).default([]),
	review_refs: z.array(ReviewRefSchema).default([]),

	// Metadata
	sources: z.array(SourceRefSchema).default([]),
	asin: z.string().optional(),
	ean: z.string().optional(),
	upc: z.string().optional(),
	updated_at: z.string(),
});

// --- TypeScript types ---

export type PriceEntry = z.infer<typeof PriceEntrySchema>;
export type ReviewRef = z.infer<typeof ReviewRefSchema>;
export type SourceRef = z.infer<typeof SourceRefSchema>;
export type PerformanceMetrics = z.infer<typeof PerformanceMetricsSchema>;
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
export type FlashlightEntry = z.infer<typeof FlashlightEntrySchema>;

// --- Required attributes — matches parametrek standard ---
// These 16 fields are present for every entry in parametrek's database.
// They define the quality bar for data completeness.
// NOTE: intensity_cd is derivable from throw_m via ANSI FL1, not separately required.

export const REQUIRED_ATTRIBUTES = [
	'model', 'brand', 'type', 'led', 'battery',
	'lumens', 'throw_m', 'runtime_hours',
	'switch', 'features', 'color', 'material',
	'length_mm', 'weight_g', 'price_usd', 'purchase_url',
] as const;

/** Check if an entry has all required attributes populated (parametrek standard) */
export function hasRequiredAttributes(entry: FlashlightEntry): { valid: boolean; missing: string[] } {
	const missing: string[] = [];
	if (!entry.model) missing.push('model');
	if (!entry.brand) missing.push('brand');
	if (!entry.type?.length) missing.push('type');
	if (!entry.led?.length) missing.push('led');
	if (!entry.battery?.length) missing.push('battery');
	if (!entry.performance?.claimed?.lumens?.length) missing.push('lumens');
	if (!entry.performance?.claimed?.throw_m || entry.performance.claimed.throw_m <= 0) missing.push('throw_m');
	if (!entry.performance?.claimed?.runtime_hours?.length) missing.push('runtime_hours');
	if (!entry.switch?.length) missing.push('switch');
	if (!entry.features?.length) missing.push('features');
	if (!entry.color?.length) missing.push('color');
	if (!entry.material?.length) missing.push('material');
	if (entry.length_mm == null || entry.length_mm <= 0) missing.push('length_mm');
	if (entry.weight_g == null || entry.weight_g <= 0) missing.push('weight_g');
	if (entry.price_usd == null || entry.price_usd <= 0) missing.push('price_usd');
	if (!entry.purchase_urls?.length) missing.push('purchase_url');
	return { valid: missing.length === 0, missing };
}

/** Generate a stable ID slug from brand + model + primary LED */
export function generateId(brand: string, model: string, led?: string): string {
	const parts = [brand, model];
	if (led) parts.push(led);
	return parts
		.join('-')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}
