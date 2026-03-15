/**
 * Detail scraper — fetches full product page HTML to extract specs
 * not available from the Shopify JSON API (length, LED, material, etc.).
 * Runs as enrichment pass on existing DB entries.
 */
import { getAllFlashlights, upsertFlashlight, addSource, addRawSpecText, getScrapedUrlSet } from '../store/db.js';
import { hasRequiredAttributes } from '../schema/canonical.js';
import type { FlashlightEntry } from '../schema/canonical.js';
import { fetchPage, htmlToText } from './manufacturer-scraper.js';

const CRAWL_DELAY = 2000; // ms between requests — increased to avoid 429s

/**
 * Scrape the full product page HTML for missing specs.
 * Uses the entry's info_urls or purchase_urls to find the product page.
 */
export async function scrapeDetailForEntry(
	entry: FlashlightEntry,
	scrapedUrls?: Set<string>,
): Promise<{
	enriched: boolean;
	fieldsAdded: string[];
	skipped: boolean;
}> {
	const fieldsAdded: string[] = [];

	// Find a URL to scrape
	const urls = [...(entry.info_urls ?? []), ...(entry.purchase_urls ?? [])];
	if (urls.length === 0) return { enriched: false, fieldsAdded, skipped: false };

	// Skip entries where ALL URLs were already scraped (no new pages to try)
	if (scrapedUrls && urls.every((u) => scrapedUrls.has(u))) {
		return { enriched: false, fieldsAdded, skipped: true };
	}

	for (const url of urls) {
		// Skip individual URLs already scraped
		if (scrapedUrls?.has(url)) continue;

		try {
			// Olight pages need API calls — HTML has no specs
			if (/olight\.com/i.test(url)) {
				await enrichFromOlightApi(entry, url, fieldsAdded);
				if (fieldsAdded.length > 0) {
					entry.updated_at = new Date().toISOString();
					return { enriched: true, fieldsAdded, skipped: false };
				}
				continue;
			}

			const html = await fetchPage(url);
			const text = htmlToText(html);

			// Try structured HTML extraction first (Nitecore, Streamlight)
			enrichFromStructuredHtml(entry, html, fieldsAdded);

			// Then text-based extraction for remaining gaps
			enrichFromFullPage(entry, html, text, fieldsAdded, url);

			if (fieldsAdded.length > 0) {
				entry.updated_at = new Date().toISOString();
				return { enriched: true, fieldsAdded, skipped: false };
			}
		} catch {
			// Try next URL
			continue;
		}
	}

	return { enriched: false, fieldsAdded, skipped: false };
}

/**
 * Extract specs from Olight API — their pages load specs via client-side JS.
 * Fetches HTML to get productId from __NEXT_DATA__, then hits the API.
 */
async function enrichFromOlightApi(
	entry: FlashlightEntry,
	url: string,
	fieldsAdded: string[],
): Promise<void> {
	try {
		const html = await fetchPage(url);

		// Extract productId from __NEXT_DATA__ JSON
		const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
		if (!nextDataMatch) return;

		let productId: string | undefined;
		let skuId: string | undefined;
		try {
			const nextData = JSON.parse(nextDataMatch[1]);
			const data = nextData?.props?.pageProps?.pageProps?.data
				?? nextData?.props?.pageProps?.data;
			if (data?.id) {
				productId = String(data.id);
				// Get first SKU id
				if (data.skuInfo?.[0]?.id) skuId = String(data.skuInfo[0].id);
			}
		} catch { return; }

		if (!productId) return;

		// Call the Olight spec API
		const apiRes = await fetch('https://api.olightstore.com/product/api/detailInfo', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'User-Agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36',
				'Accept': 'application/json',
				'Origin': 'https://www.olight.com',
				'Referer': 'https://www.olight.com/',
			},
			body: JSON.stringify({
				productId,
				productSpecialId: 0,
				blogIds: [],
				home: false,
				...(skuId ? { skuId } : {}),
			}),
		});

		if (!apiRes.ok) return;
		const apiData = await apiRes.json() as any;

		// Parse attributeInfo — array of { name, value, children: [{ name, value }] }
		const attrs = apiData?.data?.attributeInfo;
		if (!Array.isArray(attrs)) return;

		// Flatten all spec entries from group → children hierarchy
		const specs: Record<string, string> = {};
		for (const group of attrs) {
			if (Array.isArray(group.children)) {
				for (const child of group.children) {
					if (child.name && child.value) {
						specs[child.name.toLowerCase().trim()] = child.value.trim();
					}
				}
			}
		}

		// Map Olight spec fields to our schema
		if (!entry.length_mm) {
			const lenVal = specs['length'];
			if (lenVal) {
				// Format: "5.47 in (139 mm)" or just "139 mm"
				const mmMatch = lenVal.match(/(\d+(?:\.\d+)?)\s*mm/i);
				const inMatch = lenVal.match(/(\d+(?:\.\d+)?)\s*in/i);
				if (mmMatch) {
					entry.length_mm = parseFloat(mmMatch[1]);
					fieldsAdded.push('length_mm');
				} else if (inMatch) {
					entry.length_mm = Math.round(parseFloat(inMatch[1]) * 25.4);
					fieldsAdded.push('length_mm');
				}
			}
		}

		if (!entry.body_mm) {
			const bodyVal = specs['body diameter'];
			if (bodyVal) {
				const mmMatch = bodyVal.match(/(\d+(?:\.\d+)?)\s*mm/i);
				if (mmMatch) {
					entry.body_mm = parseFloat(mmMatch[1]);
					fieldsAdded.push('body_mm');
				}
			}
		}

		if (!entry.weight_g) {
			const wVal = specs['weight'];
			if (wVal) {
				// "6.21 oz (176 g)" or "176 g"
				const gMatch = wVal.match(/(\d+(?:\.\d+)?)\s*g\b/i);
				if (gMatch) {
					entry.weight_g = parseFloat(gMatch[1]);
					fieldsAdded.push('weight_g');
				}
			}
		}

		if (!entry.performance.claimed.throw_m) {
			const beamVal = specs['beam distance'];
			if (beamVal) {
				// "984 ft (300 m)" or "300 m"
				const mMatch = beamVal.match(/(\d+(?:\.\d+)?)\s*m\b/i);
				if (mMatch) {
					const tv = parseInt(mMatch[1], 10);
					if (tv >= 5 && tv <= 5000) {
						entry.performance.claimed.throw_m = tv;
						fieldsAdded.push('throw_m');
					}
				}
			}
		}

		if (!entry.performance.claimed.intensity_cd) {
			const intVal = specs['max light intensity'];
			if (intVal) {
				const cdMatch = intVal.match(/([\d,]+)\s*(?:candela|cd)/i);
				if (cdMatch) {
					entry.performance.claimed.intensity_cd = parseInt(cdMatch[1].replace(/,/g, ''), 10);
					fieldsAdded.push('intensity_cd');
				}
			}
		}

		if (!entry.performance.claimed.lumens?.length) {
			const perfVal = specs['max performance'];
			if (perfVal) {
				const lmMatch = perfVal.match(/([\d,]+)\s*lumens?/i);
				if (lmMatch) {
					entry.performance.claimed.lumens = [parseInt(lmMatch[1].replace(/,/g, ''), 10)];
					fieldsAdded.push('lumens');
				}
			}
		}

		if (!entry.material.length) {
			const matVal = specs['body material'];
			if (matVal) {
				const materials: string[] = [];
				if (/aluminum|aluminium/i.test(matVal)) materials.push('aluminum');
				if (/titanium/i.test(matVal)) materials.push('titanium');
				if (/copper/i.test(matVal)) materials.push('copper');
				if (/stainless/i.test(matVal)) materials.push('stainless steel');
				if (/polymer|plastic|nylon/i.test(matVal)) materials.push('polymer');
				if (materials.length > 0) {
					entry.material = materials;
					fieldsAdded.push('material');
				}
			}
		}

		if (!entry.switch.length) {
			const switchVal = specs['mode operation'];
			if (switchVal) {
				const switches: string[] = [];
				if (/dual\s*switch/i.test(switchVal)) switches.push('dual');
				else if (/tail\s*switch/i.test(switchVal)) switches.push('tail');
				else if (/side\s*switch/i.test(switchVal)) switches.push('side');
				else if (/rotary|twist/i.test(switchVal)) switches.push('rotary');
				if (switches.length > 0) {
					entry.switch = switches;
					fieldsAdded.push('switch');
				}
			}
		}

		if (!entry.battery.length || entry.battery[0] === 'unknown') {
			const batVal = specs['compatible batteries'];
			if (batVal) {
				const batteries: string[] = [];
				if (/21700/i.test(batVal)) batteries.push('21700');
				if (/18650/i.test(batVal)) batteries.push('18650');
				if (/18350/i.test(batVal)) batteries.push('18350');
				if (/16340/i.test(batVal)) batteries.push('16340');
				if (/14500/i.test(batVal)) batteries.push('14500');
				if (/CR123/i.test(batVal)) batteries.push('CR123A');
				if (/\bAA\b(?!A)/i.test(batVal)) batteries.push('AA');
				if (/\bAAA\b/i.test(batVal)) batteries.push('AAA');
				if (batteries.length > 0) {
					entry.battery = batteries;
					fieldsAdded.push('battery');
				}
			}
		}

		if (!entry.environment.length) {
			const ipVal = specs['waterproof'];
			if (ipVal) {
				const ipMatch = ipVal.match(/IP[X]?(\d{1,2})/i);
				if (ipMatch) {
					const rating = ipMatch[1].length === 1 ? `IPX${ipMatch[1]}` : `IP${ipMatch[1]}`;
					entry.environment = [rating];
					fieldsAdded.push('environment');
				}
			}
		}

		// Extract runtime from lighting levels
		if (!entry.performance.claimed.runtime_hours?.length) {
			const runtimes: number[] = [];
			for (const [key, val] of Object.entries(specs)) {
				if (/run\s*time/i.test(key) && typeof val === 'string') {
					// Parse formats: "2.5 + 160 + 39 minutes", "13 hours", "130 hours", "55 days"
					const hourMatch = val.match(/(\d+(?:\.\d+)?)\s*hours?/i);
					const dayMatch = val.match(/(\d+(?:\.\d+)?)\s*days?/i);
					const minMatch = val.match(/^(\d+(?:\.\d+)?)\s*minutes?$/i);
					if (hourMatch) runtimes.push(parseFloat(hourMatch[1]));
					else if (dayMatch) runtimes.push(parseFloat(dayMatch[1]) * 24);
					else if (minMatch) runtimes.push(parseFloat(minMatch[1]) / 60);
				}
			}
			if (runtimes.length > 0) {
				entry.performance.claimed.runtime_hours = runtimes;
				fieldsAdded.push('runtime_hours');
			}
		}

		// Extract LED from light source field
		if (!entry.led.length || entry.led[0] === 'unknown') {
			const ledVal = specs['light source'];
			if (ledVal) {
				const leds: string[] = [];
				const ledPatterns: [RegExp, string][] = [
					[/\bXHP[\s-]?50/i, 'XHP50'], [/\bXHP[\s-]?70/i, 'XHP70'],
					[/\bXM[\s-]?L2?/i, 'XM-L2'], [/\bXP[\s-]?L/i, 'XP-L'],
					[/\bSST[\s-]?40/i, 'SST-40'], [/\bSST[\s-]?20/i, 'SST-20'],
					[/\bSFT[\s-]?40/i, 'SFT-40'], [/\bSFT[\s-]?70/i, 'SFT-70'],
					[/\bOsram/i, 'Osram'], [/\bNichia/i, 'Nichia'],
					[/\bCOB/i, 'COB'], [/\bLEP/i, 'LEP'],
				];
				for (const [re, name] of ledPatterns) {
					if (re.test(ledVal) && !leds.includes(name)) leds.push(name);
				}
				if (leds.length > 0) {
					entry.led = leds;
					fieldsAdded.push('led');
				}
			}
		}

		// Features from product data
		if (!entry.features.length) {
			const features: string[] = [];
			if (/rechargeable/i.test(JSON.stringify(specs))) features.push('rechargeable');
			if (/clip/i.test(JSON.stringify(specs)) && !/video/i.test(JSON.stringify(specs))) features.push('clip');
			if (/magnet/i.test(JSON.stringify(specs)) && !/charging/i.test(JSON.stringify(specs))) features.push('magnet');
			if (/holster/i.test(JSON.stringify(specs))) features.push('holster');
			if (features.length > 0) {
				entry.features = features;
				fieldsAdded.push('features');
			}
		}

		// Charging from product data
		if (!entry.charging.length) {
			const chgVal = specs['charging type'] || '';
			const charging: string[] = [];
			if (/usb[\s-]?c|type[\s-]?c/i.test(chgVal)) charging.push('USB-C');
			if (/micro[\s-]?usb/i.test(chgVal)) charging.push('Micro-USB');
			if (/magnetic/i.test(chgVal)) charging.push('magnetic');
			if (/mcc/i.test(chgVal)) charging.push('magnetic'); // Olight MCC = magnetic charging
			if (charging.length > 0) {
				entry.charging = charging;
				fieldsAdded.push('charging');
			}
		}
	} catch {
		// API call failed — skip silently
	}
}

/**
 * Extract specs from structured HTML tables/grids before falling back to text.
 * Handles Fenix cus-lqd-specs, Nitecore product-spec-table, Streamlight productSpecifications,
 * and Olight technical-table (on reseller sites).
 */
function enrichFromStructuredHtml(
	entry: FlashlightEntry,
	html: string,
	fieldsAdded: string[],
): void {
	// === FENIX cus-lqd-specs: <div class="cus-lqd-specs"><strong>Label:</strong> Value</div> ===
	if (/cus-lqd-specs/i.test(html)) {
		const specDivs = html.matchAll(/<div[^>]*class="cus-lqd-specs"[^>]*>\s*<strong>([\s\S]*?)<\/strong>\s*([\s\S]*?)<\/div>/gi);
		for (const div of specDivs) {
			const label = div[1].replace(/<[^>]+>/g, '').replace(/:$/, '').trim().toLowerCase();
			const value = div[2].replace(/<[^>]+>/g, '').trim();

			if (/bulb\s*type|led/i.test(label) && (!entry.led.length || entry.led[0] === 'unknown')) {
				const leds: string[] = [];
				const ledPatterns: [RegExp, string][] = [
					[/\bLuminus\s+SFT[\s-]?70\b/i, 'Luminus SFT70'],
					[/\bLuminus\s+SFT[\s-]?40\b/i, 'Luminus SFT40'],
					[/\bLuminus\s+SST[\s-]?40\b/i, 'SST-40'],
					[/\bLuminus\s+SST[\s-]?70\b/i, 'SST-70'],
					[/\bXHP[\s-]?50/i, 'XHP50'], [/\bXHP[\s-]?70/i, 'XHP70'],
					[/\bXM[\s-]?L2?/i, 'XM-L2'], [/\bXP[\s-]?L\s*(?:HI|HD|V6)?/i, 'XP-L'],
					[/\bXP[\s-]?G[23S]?/i, 'XP-G'], [/\bXP[\s-]?E2?/i, 'XP-E'],
					[/\bSST[\s-]?20/i, 'SST-20'], [/\bSST[\s-]?40/i, 'SST-40'],
					[/\bSFT[\s-]?40/i, 'SFT-40'], [/\bSFT[\s-]?70/i, 'SFT-70'],
					[/\bOsram/i, 'Osram'], [/\bNichia/i, 'Nichia'],
					[/\bCOB/i, 'COB'], [/\bLEP/i, 'LEP'],
					[/\bWhite\s*Laser/i, 'White Laser'],
				];
				for (const [re, name] of ledPatterns) {
					if (re.test(value) && !leds.includes(name)) leds.push(name);
				}
				if (leds.length > 0) {
					entry.led = leds;
					fieldsAdded.push('led');
				}
			}

			if (/^size$/i.test(label)) {
				// Fenix "Size: Length: 5.35" (136mm) Body: 0.91" (23.2mm) Head: 1.00" (25.4mm)"
				if (!entry.length_mm || entry.length_mm <= 0) {
					const lenMatch = value.match(/Length[:\s]*\d+(?:\.\d+)?["\u2033]\s*\((\d+(?:\.\d+)?)\s*mm\)/i);
					if (lenMatch) {
						entry.length_mm = parseFloat(lenMatch[1]);
						fieldsAdded.push('length_mm');
					}
				}
				if (!entry.body_mm || entry.body_mm <= 0) {
					const bodyMatch = value.match(/Body[:\s]*\d+(?:\.\d+)?["\u2033]\s*\((\d+(?:\.\d+)?)\s*mm\)/i);
					if (bodyMatch) {
						entry.body_mm = parseFloat(bodyMatch[1]);
						fieldsAdded.push('body_mm');
					}
				}
				if (!entry.bezel_mm || entry.bezel_mm <= 0) {
					const headMatch = value.match(/Head[:\s]*\d+(?:\.\d+)?["\u2033]\s*\((\d+(?:\.\d+)?)\s*mm\)/i);
					if (headMatch) {
						entry.bezel_mm = parseFloat(headMatch[1]);
						fieldsAdded.push('bezel_mm');
					}
				}
			}

			if (/^weight$/i.test(label) && !entry.weight_g) {
				const gMatch = value.match(/(\d+(?:\.\d+)?)\s*g\b/i);
				if (gMatch) {
					entry.weight_g = parseFloat(gMatch[1]);
					fieldsAdded.push('weight_g');
				}
			}

			if (/max\s*(?:beam\s*)?distance/i.test(label) && !entry.performance.claimed.throw_m) {
				// "1158 feet (353 meters)"
				const mMatch = value.match(/(\d[\d,]*)\s*m(?:eters?)?\)?/i);
				if (mMatch) {
					const tv = parseInt(mMatch[1].replace(/,/g, ''), 10);
					if (tv >= 5 && tv <= 5000) {
						entry.performance.claimed.throw_m = tv;
						fieldsAdded.push('throw_m');
					}
				}
			}

			if (/max\s*lumens/i.test(label) && !entry.performance.claimed.lumens?.length) {
				const lm = parseInt(value.replace(/,/g, ''), 10);
				if (lm > 0 && lm < 1000000) {
					entry.performance.claimed.lumens = [lm];
					fieldsAdded.push('lumens');
				}
			}

			if (/color\s*temp/i.test(label) && !entry.performance.claimed.cct) {
				const cctMatch = value.match(/(\d{4,5})\s*K/i);
				if (cctMatch) {
					const cct = parseInt(cctMatch[1], 10);
					if (cct >= 1800 && cct <= 10000) {
						entry.performance.claimed.cct = cct;
						fieldsAdded.push('cct');
					}
				}
			}

			if (/^battery$/i.test(label) && (!entry.battery.length || entry.battery[0] === 'unknown')) {
				const batteries: string[] = [];
				if (/21700/i.test(value)) batteries.push('21700');
				if (/18650/i.test(value)) batteries.push('18650');
				if (/CR123/i.test(value)) batteries.push('CR123A');
				if (/14500/i.test(value)) batteries.push('14500');
				if (/16340/i.test(value)) batteries.push('16340');
				if (/\bAA\b(?!A)/i.test(value)) batteries.push('AA');
				if (/\bAAA\b/i.test(value)) batteries.push('AAA');
				// Built-in battery patterns (Fenix, Olight)
				if (batteries.length === 0 && /built[\s-]?in\b/i.test(value)) {
					if (/li[\s-]?(?:ion|polymer)/i.test(value)) batteries.push('built-in Li-ion');
				}
				if (batteries.length > 0) {
					entry.battery = batteries;
					fieldsAdded.push('battery');
				}
			}

			if (/^max\s*runtime$/i.test(label) && !entry.performance.claimed.runtime_hours?.length) {
				const hrMatch = value.match(/(\d+(?:\.\d+)?)\s*hours?/i);
				if (hrMatch) {
					entry.performance.claimed.runtime_hours = [parseFloat(hrMatch[1])];
					fieldsAdded.push('runtime_hours');
				}
			}
		}
	}

	// === NITECORE product-spec-table: <th>Label</th><td>Value</td> rows ===
	if (/product-spec-table/i.test(html)) {
		const tableMatch = html.match(/<table[^>]*class="[^"]*product-spec-table[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
		if (tableMatch) {
			const rows = tableMatch[1].matchAll(/<tr[^>]*>\s*<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi);
			for (const row of rows) {
				const label = row[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
				const value = row[2].replace(/<[^>]+>/g, '').trim();

				if (/^led$/i.test(label) && (!entry.led.length || entry.led[0] === 'unknown')) {
					// Try to extract standard LED names from Nitecore values
					const leds: string[] = [];
					const ledPatterns: [RegExp, string][] = [
						[/\bXHP[\s-]?50/i, 'XHP50'], [/\bXHP[\s-]?70/i, 'XHP70'],
						[/\bXM[\s-]?L2?/i, 'XM-L2'], [/\bXP[\s-]?L\s*(?:HI|HD|V6)?/i, 'XP-L'],
						[/\bXP[\s-]?G[23]?/i, 'XP-G'], [/\bXP[\s-]?E2?/i, 'XP-E'],
						[/\bSST[\s-]?\d+/i, 'SST-40'], [/\bSFT[\s-]?\d+/i, 'SFT-40'],
						[/\bOsram/i, 'Osram'], [/\bNichia/i, 'Nichia'],
						[/\bCOB/i, 'COB'], [/\bLEP/i, 'LEP'],
						[/\bUV/i, 'UV LED'], [/\bRGB/i, 'RGB LED'],
					];
					for (const [re, name] of ledPatterns) {
						if (re.test(value) && !leds.includes(name)) leds.push(name);
					}
					if (leds.length > 0) {
						entry.led = leds;
						fieldsAdded.push('led');
					}
				}

				if (/dimensions?/i.test(label) && (!entry.length_mm || entry.length_mm <= 0)) {
					// Nitecore format: "L-4.72" x W-1.22" x H-0.83""
					const lwh = value.match(/L[\s-]*(\d+(?:\.\d+)?)["\u2033]/i);
					if (lwh) {
						entry.length_mm = Math.round(parseFloat(lwh[1]) * 25.4);
						fieldsAdded.push('length_mm');
					}
				}

				if (/peak\s*beam\s*distance/i.test(label) && !entry.performance.claimed.throw_m) {
					// Nitecore often uses yards: "144 yards"
					const yMatch = value.match(/(\d[\d,]*)\s*(?:yards?|yds?)/i);
					if (yMatch) {
						const tv = Math.round(parseInt(yMatch[1].replace(/,/g, ''), 10) * 0.9144);
						if (tv >= 5 && tv <= 5000) {
							entry.performance.claimed.throw_m = tv;
							fieldsAdded.push('throw_m');
						}
					}
					const mMatch = value.match(/(\d[\d,]*)\s*m(?:eters?)?/i);
					if (!entry.performance.claimed.throw_m && mMatch) {
						const tv = parseInt(mMatch[1].replace(/,/g, ''), 10);
						if (tv >= 5 && tv <= 5000) {
							entry.performance.claimed.throw_m = tv;
							fieldsAdded.push('throw_m');
						}
					}
				}

				if (/peak\s*beam\s*intensity/i.test(label) && !entry.performance.claimed.intensity_cd) {
					const cdMatch = value.match(/([\d,]+)/);
					if (cdMatch) {
						entry.performance.claimed.intensity_cd = parseInt(cdMatch[1].replace(/,/g, ''), 10);
						fieldsAdded.push('intensity_cd');
					}
				}

				if (/max(?:imum)?\s*(?:brightness|output)/i.test(label) && !entry.performance.claimed.lumens?.length) {
					const lmMatch = value.match(/([\d,]+)\s*(?:lumens?|lm)?/i);
					if (lmMatch) {
						entry.performance.claimed.lumens = [parseInt(lmMatch[1].replace(/,/g, ''), 10)];
						fieldsAdded.push('lumens');
					}
				}

				if (/^weight$/i.test(label) && !entry.weight_g) {
					const gMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:g\b|grams?)/i);
					const ozMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:oz\.?|ounces?)/i);
					if (gMatch) {
						entry.weight_g = parseFloat(gMatch[1]);
						fieldsAdded.push('weight_g');
					} else if (ozMatch) {
						entry.weight_g = Math.round(parseFloat(ozMatch[1]) * 28.35);
						fieldsAdded.push('weight_g');
					}
				}

				if (/^ip\s*rating$/i.test(label) && !entry.environment.length) {
					const ipMatch = value.match(/IP[X]?(\d{1,2})/i);
					if (ipMatch) {
						const rating = ipMatch[1].length === 1 ? `IPX${ipMatch[1]}` : `IP${ipMatch[1]}`;
						entry.environment = [rating];
						fieldsAdded.push('environment');
					}
				}
			}
		}
	}

	// === OLIGHT technical-table on reseller sites (nealsgadgets, etc): <td>Label</td><td>Value</td> ===
	if (/technical-table/i.test(html)) {
		const tables = html.matchAll(/<table[^>]*class="[^"]*technical-table[^"]*"[^>]*>([\s\S]*?)<\/table>/gi);
		for (const table of tables) {
			const rows = table[1].matchAll(/<tr[^>]*>\s*<td[^>]*class="technical-td"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class="technical-td"[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi);
			for (const row of rows) {
				const label = row[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
				const value = row[2].replace(/<[^>]+>/g, '').trim();

				if (/beam\s*distance/i.test(label) && !entry.performance.claimed.throw_m) {
					const mMatch = value.match(/(\d[\d,]*)\s*m\b/i);
					if (mMatch) {
						const tv = parseInt(mMatch[1].replace(/,/g, ''), 10);
						if (tv >= 5 && tv <= 5000) {
							entry.performance.claimed.throw_m = tv;
							fieldsAdded.push('throw_m');
						}
					}
				}

				if (/max\s*performance/i.test(label) && !entry.performance.claimed.lumens?.length) {
					const lmMatch = value.match(/([\d,]+)\s*lumens?/i);
					if (lmMatch) {
						entry.performance.claimed.lumens = [parseInt(lmMatch[1].replace(/,/g, ''), 10)];
						fieldsAdded.push('lumens');
					}
				}

				if (/max\s*light\s*intensity/i.test(label) && !entry.performance.claimed.intensity_cd) {
					const cdMatch = value.match(/([\d,]+)\s*(?:candela|cd)?/i);
					if (cdMatch) {
						const cd = parseInt(cdMatch[1].replace(/,/g, ''), 10);
						if (cd > 0) {
							entry.performance.claimed.intensity_cd = cd;
							fieldsAdded.push('intensity_cd');
						}
					}
				}

				if (/^weight$/i.test(label) && !entry.weight_g) {
					const gMatch = value.match(/(\d+(?:\.\d+)?)\s*g\b/i);
					if (gMatch) {
						entry.weight_g = parseFloat(gMatch[1]);
						fieldsAdded.push('weight_g');
					}
				}

				if (/mode\s*operation/i.test(label) && !entry.switch.length) {
					const switches: string[] = [];
					if (/dual\s*switch/i.test(value)) switches.push('dual');
					else if (/tail/i.test(value)) switches.push('tail');
					else if (/side\s*switch/i.test(value)) switches.push('side');
					else if (/central\s*button.*selector/i.test(value)) switches.push('dual');
					if (/rotary|twist/i.test(value)) switches.push('rotary');
					if (switches.length > 0) {
						entry.switch = switches;
						fieldsAdded.push('switch');
					}
				}

				if (/charging\s*type/i.test(label) && !entry.charging.length) {
					const charging: string[] = [];
					if (/usb[\s-]?c|type[\s-]?c/i.test(value)) charging.push('USB-C');
					if (/micro[\s-]?usb/i.test(value)) charging.push('Micro-USB');
					if (/mcc|magnetic/i.test(value)) charging.push('magnetic');
					if (charging.length > 0) {
						entry.charging = charging;
						fieldsAdded.push('charging');
					}
				}

				if (/waterproof/i.test(label) && !entry.environment.length) {
					const ipMatch = value.match(/IP[X]?(\d{1,2})/i);
					if (ipMatch) {
						const rating = ipMatch[1].length === 1 ? `IPX${ipMatch[1]}` : `IP${ipMatch[1]}`;
						entry.environment = [rating];
						fieldsAdded.push('environment');
					}
				}
			}
		}

		// Check for material in MATERIALS section
		if (!entry.material.length) {
			const matSection = html.match(/MATERIALS[\s\S]*?<td[^>]*class="technical-td"[^>]*>([\s\S]*?)<\/td>/i);
			if (matSection) {
				const matText = matSection[1].replace(/<[^>]+>/g, '').trim();
				const materials: string[] = [];
				if (/aluminum|aluminium/i.test(matText)) materials.push('aluminum');
				if (/titanium/i.test(matText)) materials.push('titanium');
				if (/stainless/i.test(matText)) materials.push('stainless steel');
				if (/polymer|plastic|nylon|polycarbonate/i.test(matText)) materials.push('polymer');
				if (materials.length > 0) {
					entry.material = materials;
					fieldsAdded.push('material');
				}
			}
		}
	}

	// === BATTERY JUNCTION accordion spec tables: <collapsible-row> with <details>/<summary> ===
	// Also handles Going Gear data-col-size tables and generic Shopify spec tables in <div class="rte">
	if (/batteryjunction\.com|goinggear\.com|collapsible-content/i.test(html) || /data-col-size/i.test(html)) {
		// Parse all 2-column spec tables within accordion/collapsible sections or rte description
		const specPairs = new Map<string, string>();

		// Pattern 1: Battery Junction accordion tables — <td>Label</td><td>Value</td> inside <details>
		const accordionTables = html.matchAll(/<(?:details|div)[^>]*(?:id="(?:Accordion|Details)-\d|class="[^"]*(?:collapsible|accordion))[^>]*>([\s\S]*?)<\/(?:details|div)>/gi);
		for (const section of accordionTables) {
			const rows = section[1].matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi);
			for (const row of rows) {
				const label = row[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
				const value = row[2].replace(/<[^>]+>/g, '').trim();
				if (label && value && value.length < 500) specPairs.set(label, value);
			}
		}

		// Pattern 2: Going Gear data-col-size tables — <td data-col-size="sm"><strong>Label</strong></td><td data-col-size="md">Value</td>
		const colSizeRows = html.matchAll(/<tr[^>]*>\s*<td[^>]*data-col-size="sm"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*data-col-size="md"[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi);
		for (const row of colSizeRows) {
			const label = row[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
			const value = row[2].replace(/<[^>]+>/g, '').trim();
			if (label && value && value.length < 500) specPairs.set(label, value);
		}

		// Pattern 3: Generic <thead>Feature/Details</thead> + <tbody> tables in Shopify rte
		const theadTables = html.matchAll(/<table[^>]*>[\s\S]*?<thead>[\s\S]*?<\/thead>\s*<tbody>([\s\S]*?)<\/tbody>[\s\S]*?<\/table>/gi);
		for (const table of theadTables) {
			const rows = table[1].matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi);
			for (const row of rows) {
				const label = row[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
				const value = row[2].replace(/<[^>]+>/g, '').trim();
				if (label && value && value.length < 500) specPairs.set(label, value);
			}
		}

		// Battery Junction outputTable — modes with lumens/runtime/distance/intensity per mode
		const outputTable = html.match(/<div[^>]*class=['"]outputTable-data['"][^>]*>([\s\S]*?)<\/div>/i);
		if (outputTable) {
			// Parse header row for mode names, then data rows for values
			const headerRow = outputTable[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
			const dataRows = [...outputTable[1].matchAll(/<tr[^>]*>\s*<th[^>]*>([\s\S]*?)<\/th>([\s\S]*?)<\/tr>/gi)];
			if (dataRows.length > 0) {
				for (const dRow of dataRows) {
					const rowLabel = dRow[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
					// Extract all <td> values with their unitID spans
					const cells = [...dRow[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
						.map(c => c[1].replace(/<[^>]+>/g, '').trim())
						.filter(c => /\d/.test(c));

					if (rowLabel === 'brightness' && cells.length > 0) {
						// First cell with largest number = max lumens
						const maxLm = cells.map(c => parseInt(c.replace(/[,\s]/g, ''), 10)).filter(n => n > 0).sort((a, b) => b - a);
						if (maxLm.length > 0 && !entry.performance.claimed.lumens?.length) {
							specPairs.set('max lumens (lm)', String(maxLm[0]));
						}
					}
					if (rowLabel === 'distance' && cells.length > 0) {
						const maxDist = cells.map(c => parseInt(c.replace(/[,\s]/g, ''), 10)).filter(n => n > 0).sort((a, b) => b - a);
						if (maxDist.length > 0 && !entry.performance.claimed.throw_m) {
							specPairs.set('max throw (m)', String(maxDist[0]));
						}
					}
					if (rowLabel === 'intensity' && cells.length > 0) {
						const maxCd = cells.map(c => parseInt(c.replace(/[,\s]/g, ''), 10)).filter(n => n > 0).sort((a, b) => b - a);
						if (maxCd.length > 0 && !entry.performance.claimed.intensity_cd) {
							specPairs.set('max candela', String(maxCd[0]));
						}
					}
					if (rowLabel === 'runtime' && cells.length > 0) {
						// Get the longest runtime value for the highest mode
						for (const c of cells) {
							const hrMatch = c.match(/(\d+(?:\.\d+)?)\s*hours?/i);
							if (hrMatch) {
								specPairs.set('runtime on high', `${hrMatch[1]} hours`);
								break;
							}
						}
					}
				}
			}
		}

		// Now map the collected spec pairs to entry fields
		for (const [label, value] of specPairs) {
			// LED
			if (/^(?:led|emitter|bulb\s*type|light\s*source)$/i.test(label) && (!entry.led.length || entry.led[0] === 'unknown')) {
				const leds: string[] = [];
				const ledPatterns: [RegExp, string][] = [
					[/\bLuminus\s+SFT[\s-]?70\b/i, 'Luminus SFT70'], [/\bLuminus\s+SFT[\s-]?40\b/i, 'Luminus SFT40'],
					[/\bXHP[\s-]?50/i, 'XHP50'], [/\bXHP[\s-]?70/i, 'XHP70'],
					[/\bXM[\s-]?L2?\b/i, 'XM-L2'], [/\bXP[\s-]?L\s*(?:HI|HD|V6)?\b/i, 'XP-L'],
					[/\bXP[\s-]?G[23S]?\b/i, 'XP-G'], [/\bXP[\s-]?E2?\b/i, 'XP-E'],
					[/\bSST[\s-]?20\b/i, 'SST-20'], [/\bSST[\s-]?40\b/i, 'SST-40'], [/\bSST[\s-]?70\b/i, 'SST-70'],
					[/\bSFT[\s-]?40\b/i, 'SFT-40'], [/\bSFT[\s-]?70\b/i, 'SFT-70'], [/\bSFT[\s-]?90\b/i, 'SFT-90'],
					[/\bSBT[\s-]?90\b/i, 'SBT-90'], [/\b519A\b/, '519A'], [/\b219[BCF]\b/, '219B'],
					[/\bLH351D\b/i, 'LH351D'], [/\bGT[\s-]?FC40\b/i, 'GT-FC40'],
					[/\bOsram\b/i, 'Osram'], [/\bNichia\b/i, 'Nichia'],
					[/\bCOB\b/, 'COB'], [/\bLEP\b/, 'LEP'],
					[/\bUhi[\s-]?\d+\b/i, 'Luminus'], [/\bC4\s*LED\b/i, 'C4 LED'],
					[/\bUV\s*LED\b/i, 'UV LED'], [/\bRGB\b/i, 'RGB LED'],
				];
				for (const [re, name] of ledPatterns) {
					if (re.test(value) && !leds.includes(name)) leds.push(name);
				}
				if (leds.length > 0) { entry.led = leds; fieldsAdded.push('led'); }
			}

			// Lumens
			if (/max\s*lumens?|max\s*output|max\s*brightness/i.test(label) && !entry.performance.claimed.lumens?.length) {
				const lmMatch = value.match(/([\d,]+)\s*(?:lumens?|lm)?/i);
				if (lmMatch) {
					const lm = parseInt(lmMatch[1].replace(/,/g, ''), 10);
					if (lm > 0 && lm < 1_000_000) {
						entry.performance.claimed.lumens = [lm];
						fieldsAdded.push('lumens');
					}
				}
			}

			// Throw
			if (/max\s*throw|beam\s*distance/i.test(label) && !entry.performance.claimed.throw_m) {
				const mMatch = value.match(/(\d[\d,]*)\s*m(?:eters?)?\b/i);
				const ftMatch = value.match(/(\d[\d,]*)\s*(?:ft|feet)\s*\(?\s*(\d[\d,]*)\s*m/i);
				if (ftMatch) {
					const tv = parseInt(ftMatch[2].replace(/,/g, ''), 10);
					if (tv >= 5 && tv <= 5000) { entry.performance.claimed.throw_m = tv; fieldsAdded.push('throw_m'); }
				} else if (mMatch) {
					const tv = parseInt(mMatch[1].replace(/,/g, ''), 10);
					if (tv >= 5 && tv <= 5000) { entry.performance.claimed.throw_m = tv; fieldsAdded.push('throw_m'); }
				}
			}

			// Intensity / Candela
			if (/max\s*candela|intensity|candela/i.test(label) && !entry.performance.claimed.intensity_cd) {
				const cd = parseInt(value.replace(/,/g, ''), 10);
				if (cd > 0) { entry.performance.claimed.intensity_cd = cd; fieldsAdded.push('intensity_cd'); }
			}

			// Length — "5.45 in (138 mm)" or "138 mm" or "5.45 inches"
			if (/^length$/i.test(label) && !entry.length_mm) {
				const mmMatch = value.match(/(\d+(?:\.\d+)?)\s*mm/i);
				const cmMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:cm|centimeters?)/i);
				const inMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:in\b|inch)/i);
				if (mmMatch) { entry.length_mm = parseFloat(mmMatch[1]); fieldsAdded.push('length_mm'); }
				else if (cmMatch) { entry.length_mm = Math.round(parseFloat(cmMatch[1]) * 10); fieldsAdded.push('length_mm'); }
				else if (inMatch) { entry.length_mm = Math.round(parseFloat(inMatch[1]) * 25.4); fieldsAdded.push('length_mm'); }
			}

			// Body diameter
			if (/body\s*diameter|tube\s*diameter/i.test(label) && (!entry.body_mm || entry.body_mm <= 0)) {
				const mmMatch = value.match(/(\d+(?:\.\d+)?)\s*mm/i);
				const inMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:in\b|inch)/i);
				if (mmMatch) { entry.body_mm = parseFloat(mmMatch[1]); fieldsAdded.push('body_mm'); }
				else if (inMatch) { entry.body_mm = Math.round(parseFloat(inMatch[1]) * 25.4 * 10) / 10; fieldsAdded.push('body_mm'); }
			}

			// Dimensions — "Length: 5.54" / Diameter: 1.04""
			if (/^dimensions?$/i.test(label) && !entry.length_mm) {
				const lenMatch = value.match(/Length[:\s]*(\d+(?:\.\d+)?)["\u2033]?/i);
				if (lenMatch) {
					entry.length_mm = Math.round(parseFloat(lenMatch[1]) * 25.4);
					fieldsAdded.push('length_mm');
				}
				const diaMatch = value.match(/Diameter[:\s]*(\d+(?:\.\d+)?)["\u2033]?/i);
				if (diaMatch && (!entry.body_mm || entry.body_mm <= 0)) {
					entry.body_mm = Math.round(parseFloat(diaMatch[1]) * 25.4 * 10) / 10;
					fieldsAdded.push('body_mm');
				}
			}

			// Weight — "2.89 oz (82 g)" or "82 g" or "82 grams"
			if (/^weight$/i.test(label) && !entry.weight_g) {
				const gMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:g\b|grams?)/i);
				const ozMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:oz\.?|ounces?)/i);
				if (gMatch) { entry.weight_g = parseFloat(gMatch[1]); fieldsAdded.push('weight_g'); }
				else if (ozMatch) { entry.weight_g = Math.round(parseFloat(ozMatch[1]) * 28.35); fieldsAdded.push('weight_g'); }
			}

			// Material
			if (/(?:primary\s*)?material|body\s*material/i.test(label) && !entry.material.length) {
				const materials: string[] = [];
				if (/aluminum|aluminium/i.test(value)) materials.push('aluminum');
				if (/titanium/i.test(value)) materials.push('titanium');
				if (/copper/i.test(value)) materials.push('copper');
				if (/brass/i.test(value)) materials.push('brass');
				if (/stainless/i.test(value)) materials.push('stainless steel');
				if (/polymer|plastic|nylon|polycarbonate/i.test(value)) materials.push('polymer');
				if (materials.length > 0) { entry.material = materials; fieldsAdded.push('material'); }
			}

			// Switch
			if (/^switch$/i.test(label) && !entry.switch.length) {
				const switches: string[] = [];
				if (/tail\s*(?:and\s*side|switch|cap)/i.test(value)) { switches.push('tail'); switches.push('side'); }
				else if (/dual\s*switch/i.test(value)) switches.push('dual');
				else if (/tail/i.test(value)) switches.push('tail');
				else if (/side/i.test(value)) switches.push('side');
				if (/rotary|twist/i.test(value)) switches.push('rotary');
				if (switches.length > 0) { entry.switch = switches; fieldsAdded.push('switch'); }
			}

			// Battery
			if (/battery|batteries|power\s*source/i.test(label) && (!entry.battery.length || entry.battery[0] === 'unknown')) {
				const batteries: string[] = [];
				const batPatterns: [RegExp, string][] = [
					[/\b21700\b/, '21700'], [/\b18650\b/, '18650'], [/\b18350\b/, '18350'],
					[/\b16340\b/, '16340'], [/\b14500\b/, '14500'], [/\bCR123A?\b/i, 'CR123A'],
					[/\b26650\b/, '26650'], [/\b26800\b/, '26800'],
					[/\bAA\b(?!\w)/, 'AA'], [/\bAAA\b/, 'AAA'],
					[/\bSL-B26\b/i, 'SL-B26'], [/\bSL-B50\b/i, 'SL-B50'],
				];
				for (const [re, name] of batPatterns) {
					if (re.test(value) && !batteries.includes(name)) batteries.push(name);
				}
				if (batteries.length === 0 && /built[\s-]?in\b/i.test(value) && /li[\s-]?(?:ion|polymer)/i.test(value)) {
					batteries.push('built-in Li-ion');
				}
				if (batteries.length > 0) { entry.battery = batteries; fieldsAdded.push('battery'); }
			}

			// IP Rating
			if (/^ip\s*rating$/i.test(label) && !entry.environment.length) {
				const ipMatch = value.match(/IP[X]?(\d{1,2})/i);
				if (ipMatch) {
					const rating = ipMatch[1].length === 1 ? `IPX${ipMatch[1]}` : `IP${ipMatch[1]}`;
					entry.environment = [rating];
					fieldsAdded.push('environment');
				}
			}

			// Waterproof Rating — Going Gear style
			if (/waterproof\s*rating/i.test(label) && !entry.environment.length) {
				const ipMatch = value.match(/IP[X]?(\d{1,2})/i);
				if (ipMatch) {
					const rating = ipMatch[1].length === 1 ? `IPX${ipMatch[1]}` : `IP${ipMatch[1]}`;
					entry.environment = [rating];
					fieldsAdded.push('environment');
				}
			}

			// Runtime
			if (/run\s*time/i.test(label) && !entry.performance.claimed.runtime_hours?.length) {
				const hrMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)/i);
				if (hrMatch) {
					entry.performance.claimed.runtime_hours = [parseFloat(hrMatch[1])];
					fieldsAdded.push('runtime_hours');
				}
			}

			// Charging
			if (/^(?:charge|charging|rechargeable)$/i.test(label) && !entry.charging.length) {
				const charging: string[] = [];
				if (/usb[\s-]?c|type[\s-]?c/i.test(value)) charging.push('USB-C');
				if (/micro[\s-]?usb/i.test(value)) charging.push('Micro-USB');
				if (/magnetic/i.test(value)) charging.push('magnetic');
				if (charging.length > 0) { entry.charging = charging; fieldsAdded.push('charging'); }
			}
		}

		// Also try extracting LED from Battery Junction title: "Nitecore MH12 Pro ... - Uhi 40 LED - Includes 1 x 21700"
		if (!entry.led.length || entry.led[0] === 'unknown') {
			const titleMatch = html.match(/<h1[^>]*class="[^"]*product-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
			if (titleMatch) {
				const title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
				const leds: string[] = [];
				const titleLedPatterns: [RegExp, string][] = [
					[/\bXHP[\s-]?50/i, 'XHP50'], [/\bXHP[\s-]?70/i, 'XHP70'],
					[/\bXM[\s-]?L2?\b/i, 'XM-L2'], [/\bXP[\s-]?L/i, 'XP-L'],
					[/\bSST[\s-]?40\b/i, 'SST-40'], [/\bSST[\s-]?20\b/i, 'SST-20'],
					[/\bSFT[\s-]?40\b/i, 'SFT-40'], [/\bSFT[\s-]?70\b/i, 'SFT-70'],
					[/\bOsram\b/i, 'Osram'], [/\bNichia\b/i, 'Nichia'],
					[/\bUhi[\s-]?\d+\b/i, 'Luminus'], [/\bC4\s*LED\b/i, 'C4 LED'],
				];
				for (const [re, name] of titleLedPatterns) {
					if (re.test(title) && !leds.includes(name)) leds.push(name);
				}
				if (leds.length > 0) { entry.led = leds; fieldsAdded.push('led'); }
			}
		}
	}

	// === NIGHTSTICK product-specifications: <ul class="product-specifications"><li><strong>Label</strong>: Value</li></ul> ===
	if (/product-specifications/i.test(html)) {
		const specLists = html.matchAll(/<ul[^>]*class="[^"]*product-specifications[^"]*"[^>]*>([\s\S]*?)<\/ul>/gi);
		for (const list of specLists) {
			const items = list[1].matchAll(/<li[^>]*>\s*<strong>([\s\S]*?)<\/strong>[:\s]*([\s\S]*?)<\/li>/gi);
			for (const item of items) {
				const label = item[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
				const value = item[2].replace(/<[^>]+>/g, '').trim();

				// High Lumens / Floodlight Lumens
				if (/^(?:high\s*lumens?|floodlight\s*lumens?|max\s*lumens?)$/i.test(label) && !entry.performance.claimed.lumens?.length) {
					const lm = parseInt(value.replace(/,/g, ''), 10);
					if (lm > 0 && lm < 1_000_000) {
						entry.performance.claimed.lumens = [lm];
						fieldsAdded.push('lumens');
					}
				}

				// High Beam Distance (m)
				if (/beam\s*distance\s*\(?m\)?/i.test(label) && !entry.performance.claimed.throw_m) {
					const tv = parseInt(value.replace(/,/g, ''), 10);
					if (tv >= 5 && tv <= 5000) {
						entry.performance.claimed.throw_m = tv;
						fieldsAdded.push('throw_m');
					}
				}

				// High Candela
				if (/^(?:high\s*)?candela$/i.test(label) && !entry.performance.claimed.intensity_cd) {
					const cd = parseInt(value.replace(/,/g, ''), 10);
					if (cd > 0) {
						entry.performance.claimed.intensity_cd = cd;
						fieldsAdded.push('intensity_cd');
					}
				}

				// Runtime — "High Flood Runtime (h)" or "High Runtime (h)"
				if (/runtime\s*\(?h\)?/i.test(label) && !entry.performance.claimed.runtime_hours?.length) {
					const hrs = parseFloat(value);
					if (hrs > 0 && hrs < 5000) {
						entry.performance.claimed.runtime_hours = [hrs];
						fieldsAdded.push('runtime_hours');
					}
				}

				// Length — "7 in (178 mm)"
				if (/^length$/i.test(label) && !entry.length_mm) {
					const mmMatch = value.match(/(\d+(?:\.\d+)?)\s*mm/i);
					const inMatch = value.match(/(\d+(?:\.\d+)?)\s*in\b/i);
					if (mmMatch) { entry.length_mm = parseFloat(mmMatch[1]); fieldsAdded.push('length_mm'); }
					else if (inMatch) { entry.length_mm = Math.round(parseFloat(inMatch[1]) * 25.4); fieldsAdded.push('length_mm'); }
				}

				// Weight — "10.2 oz (with battery)"
				if (/^weight$/i.test(label) && !entry.weight_g) {
					const gMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:g\b|grams?)/i);
					const ozMatch = value.match(/(\d+(?:\.\d+)?)\s*oz/i);
					if (gMatch) { entry.weight_g = parseFloat(gMatch[1]); fieldsAdded.push('weight_g'); }
					else if (ozMatch) { entry.weight_g = Math.round(parseFloat(ozMatch[1]) * 28.35); fieldsAdded.push('weight_g'); }
				}

				// Case Material — "6061-T6 Aluminum"
				if (/(?:case\s*)?material/i.test(label) && !entry.material.length) {
					const materials: string[] = [];
					if (/aluminum|aluminium/i.test(value)) materials.push('aluminum');
					if (/polymer|plastic|nylon/i.test(value)) materials.push('polymer');
					if (/stainless/i.test(value)) materials.push('stainless steel');
					if (materials.length > 0) { entry.material = materials; fieldsAdded.push('material'); }
				}

				// Switch Function — "Single Side Switch - H/M/L/SOS STROBE"
				if (/switch\s*function/i.test(label) && !entry.switch.length) {
					const switches: string[] = [];
					if (/tail/i.test(value)) switches.push('tail');
					if (/side/i.test(value)) switches.push('side');
					if (/dual/i.test(value)) switches.push('dual');
					if (/rotary|twist/i.test(value)) switches.push('rotary');
					if (switches.length === 0 && /single/i.test(value)) switches.push('side');
					if (switches.length > 0) { entry.switch = switches; fieldsAdded.push('switch'); }
				}

				// Water Rating — "IP-X7 Waterproof"
				if (/water\s*rating/i.test(label) && !entry.environment.length) {
					const ipMatch = value.match(/IP[\s-]?X?(\d{1,2})/i);
					if (ipMatch) {
						const rating = ipMatch[1].length === 1 ? `IPX${ipMatch[1]}` : `IP${ipMatch[1]}`;
						entry.environment = [rating];
						fieldsAdded.push('environment');
					}
				}

				// Body Color
				if (/body\s*color/i.test(label) && !entry.color.length) {
					const colors = value.split(/[,/]/).map(c => c.trim().toLowerCase()).filter(c => c && c !== 'white');
					if (colors.length > 0) { entry.color = colors; fieldsAdded.push('color'); }
				}

				// Power Source — "Li-ion Rechargeable"
				if (/power\s*source/i.test(label) && (!entry.battery.length || entry.battery[0] === 'unknown')) {
					const batteries: string[] = [];
					if (/21700/i.test(value)) batteries.push('21700');
					if (/18650/i.test(value)) batteries.push('18650');
					if (/CR123/i.test(value)) batteries.push('CR123A');
					if (/\bAA\b(?!\w)/i.test(value)) batteries.push('AA');
					if (/\bAAA\b/i.test(value)) batteries.push('AAA');
					if (batteries.length === 0 && /li[\s-]?ion/i.test(value)) batteries.push('built-in Li-ion');
					if (batteries.length > 0) { entry.battery = batteries; fieldsAdded.push('battery'); }
				}

				// Handle Diameter — "1 x 1.3 in (25 x 33 mm)" → body_mm
				if (/handle\s*diameter|body\s*diameter/i.test(label) && (!entry.body_mm || entry.body_mm <= 0)) {
					const mmMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:x\s*(\d+(?:\.\d+)?)\s*)?mm/i);
					if (mmMatch) {
						// Take the first dimension as body diameter
						entry.body_mm = parseFloat(mmMatch[1]);
						fieldsAdded.push('body_mm');
					}
				}
			}
		}
	}

	// === STREAMLIGHT productSpecifications: <div class="row"><div class="col-4">Label</div><div class="col-8">Value</div></div> ===
	if (/productSpecifications/i.test(html)) {
		const specSection = html.match(/<div[^>]*id="productSpecifications"[^>]*>([\s\S]*?)(?:<br\s*\/?>|<\/div>\s*<\/div>\s*$)/i);
		if (specSection) {
			const rows = specSection[1].matchAll(/<div\s+class="row">\s*<div\s+class="col-4">([\s\S]*?)<\/div>\s*<div\s+class="col-8">([\s\S]*?)<\/div>\s*<\/div>/gi);
			for (const row of rows) {
				const label = row[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
				const value = row[2].replace(/<[^>]+>/g, '').trim();

				if (/high\s*lumens/i.test(label) && !entry.performance.claimed.lumens?.length) {
					const lm = parseInt(value.replace(/,/g, ''), 10);
					if (lm > 0) {
						entry.performance.claimed.lumens = [lm];
						fieldsAdded.push('lumens');
					}
				}

				if (/beam\s*distance/i.test(label) && !entry.performance.claimed.throw_m) {
					const mMatch = value.match(/(\d[\d,]*)\s*m(?:eters?)?/i);
					if (mMatch) {
						const tv = parseInt(mMatch[1].replace(/,/g, ''), 10);
						if (tv >= 5 && tv <= 5000) {
							entry.performance.claimed.throw_m = tv;
							fieldsAdded.push('throw_m');
						}
					}
				}

				if (/max\s*candela/i.test(label) && !entry.performance.claimed.intensity_cd) {
					const cd = parseInt(value.replace(/,/g, ''), 10);
					if (cd > 0) {
						entry.performance.claimed.intensity_cd = cd;
						fieldsAdded.push('intensity_cd');
					}
				}

				if (/^length$/i.test(label) && !entry.length_mm) {
					// "7.67 inches (19.48 centimeters)" or "7.67 inches"
					const cmMatch = value.match(/(\d+(?:\.\d+)?)\s*centimeters?/i);
					const inMatch = value.match(/(\d+(?:\.\d+)?)\s*inch/i);
					if (cmMatch) {
						entry.length_mm = Math.round(parseFloat(cmMatch[1]) * 10);
						fieldsAdded.push('length_mm');
					} else if (inMatch) {
						entry.length_mm = Math.round(parseFloat(inMatch[1]) * 25.4);
						fieldsAdded.push('length_mm');
					}
				}

				if (/^weight$/i.test(label) && !entry.weight_g) {
					const gMatch = value.match(/(\d+(?:\.\d+)?)\s*grams?/i);
					const ozMatch = value.match(/(\d+(?:\.\d+)?)\s*ounces?/i);
					if (gMatch) {
						entry.weight_g = parseFloat(gMatch[1]);
						fieldsAdded.push('weight_g');
					} else if (ozMatch) {
						entry.weight_g = Math.round(parseFloat(ozMatch[1]) * 28.35);
						fieldsAdded.push('weight_g');
					}
				}

				if (/battery\s*type/i.test(label) && (!entry.battery.length || entry.battery[0] === 'unknown')) {
					const batteries: string[] = [];
					if (/21700/i.test(value)) batteries.push('21700');
					if (/18650/i.test(value)) batteries.push('18650');
					if (/CR123/i.test(value)) batteries.push('CR123A');
					if (/\bAA\b(?!A)/i.test(value)) batteries.push('AA');
					if (/\bAAA\b/i.test(value)) batteries.push('AAA');
					// Streamlight proprietary batteries
					if (/SL-B26/i.test(value)) batteries.push('SL-B26');
					if (/SL-B50/i.test(value)) batteries.push('SL-B50');
					if (batteries.length > 0) {
						entry.battery = batteries;
						fieldsAdded.push('battery');
					}
				}

				if (/run\s*time\s*on\s*high/i.test(label) && !entry.performance.claimed.runtime_hours?.length) {
					const hrMatch = value.match(/(\d+(?:\.\d+)?)\s*hours?/i);
					if (hrMatch) {
						entry.performance.claimed.runtime_hours = [parseFloat(hrMatch[1])];
						fieldsAdded.push('runtime_hours');
					}
				}

				if (/^colors?$/i.test(label) && !entry.color.length) {
					const colors = value.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
					if (colors.length > 0) {
						entry.color = colors;
						fieldsAdded.push('color');
					}
				}
			}
		}

		// Extract material and switch from Streamlight feature list
		const longDesc = html.match(/<div[^>]*id="productLongDescription"[^>]*>([\s\S]*?)<\/div>/i);
		if (longDesc) {
			const descText = longDesc[1].replace(/<[^>]+>/g, ' ');

			if (!entry.material.length) {
				const materials: string[] = [];
				if (/aluminum\s*alloy|aluminum|aluminium/i.test(descText)) materials.push('aluminum');
				if (/polymer|nylon|plastic/i.test(descText)) materials.push('polymer');
				if (materials.length > 0) {
					entry.material = materials;
					fieldsAdded.push('material');
				}
			}

			if (!entry.switch.length) {
				const switches: string[] = [];
				if (/tail\s*(?:switch|cap)|rear\s*switch/i.test(descText)) switches.push('tail');
				if (/head\s*(?:switch|and\s*tail)/i.test(descText)) switches.push('dual');
				if (/side\s*switch/i.test(descText)) switches.push('side');
				if (/push[\s-]?button/i.test(descText)) switches.push('side');
				if (switches.length > 0) {
					entry.switch = switches;
					fieldsAdded.push('switch');
				}
			}

			if (!entry.environment.length) {
				const ipMatch = descText.match(/\bIPX?(\d{1,2})\b/i);
				if (ipMatch) {
					const rating = ipMatch[1].length === 1 ? `IPX${ipMatch[1]}` : `IP${ipMatch[1]}`;
					entry.environment = [rating];
					fieldsAdded.push('environment');
				}
			}
		}
	}
}

/**
 * Extract detailed specs from full product page HTML.
 * Handles Shopify cus-lqd-specs format, generic spec tables, and text patterns.
 */
function enrichFromFullPage(
	entry: FlashlightEntry,
	html: string,
	_text: string,
	fieldsAdded: string[],
	url: string = '',
): void {
	// Normalize smart quotes and special chars for reliable regex matching
	const text = _text
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'") // Smart single quotes → '
		.replace(/[\u2033\u2036]/g, '"')  // Double prime → "
		.replace(/[\u201C\u201D\u201E\u201F\u2034\u2037]/g, '"') // Smart double quotes → "
		.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-') // Various dashes → -
		.replace(/\u00A0/g, ' '); // Non-breaking space → space

	// === LENGTH / DIMENSIONS ===
	if (!entry.length_mm || entry.length_mm <= 0) {
		// Fenix format: 'Length: 5.74" (145.8mm)' — with smart quotes normalized
		let m = text.match(/length[:\s]*(\d+(?:\.\d+)?)["\s]*(?:inch(?:es)?|in\.?)?\s*\(?\s*(\d+(?:\.\d+)?)\s*mm\)?/i);
		if (m) {
			entry.length_mm = parseFloat(m[2]);
			fieldsAdded.push('length_mm');
		} else {
			// Direct mm format: "Length: 145.8 mm"
			m = text.match(/(?:length|overall\s*length|total\s*length)[:\s]*(\d+(?:\.\d+)?)\s*mm/i);
			if (m) {
				entry.length_mm = parseFloat(m[1]);
				fieldsAdded.push('length_mm');
			} else {
				// Reversed format: "114mm(length)" or "72.6mm (length)"
				m = text.match(/(\d+(?:\.\d+)?)\s*mm\s*\(?length\)?/i);
				if (m) {
					entry.length_mm = parseFloat(m[1]);
					fieldsAdded.push('length_mm');
				} else {
					// Centimeters format: "Length: 10.8 cm" or "10.8 centimeters"
					m = text.match(/(?:length|overall\s*length)[:\s]*(?:\d+(?:\.\d+)?\s*(?:in\.?|inch(?:es)?|")?\s*\(?\s*)?(\d+(?:\.\d+)?)\s*(?:cm|centimeters?)\)?/i);
					if (m) {
						entry.length_mm = Math.round(parseFloat(m[1]) * 10);
						fieldsAdded.push('length_mm');
					} else {
						// Inches only: "Length: 5.74 inches"
						m = text.match(/(?:length|overall\s*length)[:\s]*(\d+(?:\.\d+)?)\s*(?:inch(?:es)?|in\b|")/i);
						if (m) {
							entry.length_mm = Math.round(parseFloat(m[1]) * 25.4);
							fieldsAdded.push('length_mm');
						} else {
							// Generic "NNNmm" near dimension words
							m = text.match(/(?:dimension|size|measure)[^.]*?(\d{2,4}(?:\.\d+)?)\s*mm/i);
							if (m) {
								const val = parseFloat(m[1]);
								if (val >= 20 && val <= 800) {
									entry.length_mm = val;
									fieldsAdded.push('length_mm');
								}
							} else {
								// Fenix-style: "5.91" x 1.57" x 1.02" / 150 x 40 x 26 mm" — first value is length
								m = text.match(/(\d+(?:\.\d+)?)["\u2033']{1,2}\s*x\s*\d+(?:\.\d+)?["\u2033']{1,2}\s*x\s*\d+(?:\.\d+)?["\u2033']{1,2}\s*\/?\s*(\d{2,4}(?:\.\d+)?)\s*x\s*(\d{2,4}(?:\.\d+)?)\s*x\s*(\d{2,4}(?:\.\d+)?)\s*mm/i);
								if (m) {
									entry.length_mm = parseFloat(m[2]);
									if (!entry.bezel_mm) entry.bezel_mm = parseFloat(m[3]);
									if (!entry.body_mm) entry.body_mm = parseFloat(m[4]);
									fieldsAdded.push('length_mm');
								} else {
									// Plain "NNN x NN x NN mm" where first is longest (length)
									m = text.match(/(\d{2,4}(?:\.\d+)?)\s*x\s*(\d{2,4}(?:\.\d+)?)\s*x\s*(\d{2,4}(?:\.\d+)?)\s*mm/i);
									if (m) {
										const dims = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])].sort((a, b) => b - a);
										if (dims[0] >= 20 && dims[0] <= 800) {
											entry.length_mm = dims[0];
											fieldsAdded.push('length_mm');
										}
									} else {
										// Nitecore "L-4.72" x W-1.22" x H-0.83"" format
										m = text.match(/L[\s-]*(\d+(?:\.\d+)?)["\u2033]\s*x\s*W[\s-]*(\d+(?:\.\d+)?)["\u2033]\s*x\s*H[\s-]*(\d+(?:\.\d+)?)["\u2033]/i);
										if (m) {
											entry.length_mm = Math.round(parseFloat(m[1]) * 25.4);
											fieldsAdded.push('length_mm');
										}
									}
								}
							}
						}
					}
				}
			}
		}
	}

	// Validate extracted length — reject clearly wrong values
	if (fieldsAdded.includes('length_mm') && entry.length_mm != null) {
		if (entry.length_mm < 15 || entry.length_mm > 1000) {
			entry.length_mm = 0; // Reset to invalid; will be ignored by downstream
			fieldsAdded.splice(fieldsAdded.indexOf('length_mm'), 1);
		}
	}

	// === BEZEL/HEAD DIAMETER ===
	if (!entry.bezel_mm || entry.bezel_mm <= 0) {
		const m = text.match(/(?:head|bezel)[:\s]*(?:\d+(?:\.\d+)?\s*(?:"|in\.?)\s*\(?\s*)?(\d+(?:\.\d+)?)\s*mm/i);
		if (m) {
			entry.bezel_mm = parseFloat(m[1]);
			fieldsAdded.push('bezel_mm');
		}
	}

	// === BODY DIAMETER ===
	if (!entry.body_mm || entry.body_mm <= 0) {
		const m = text.match(/(?:body|tube|barrel)[:\s]*(?:\d+(?:\.\d+)?\s*(?:"|in\.?)\s*\(?\s*)?(\d+(?:\.\d+)?)\s*mm/i);
		if (m) {
			entry.body_mm = parseFloat(m[1]);
			fieldsAdded.push('body_mm');
		}
	}

	// === WEIGHT ===
	if (!entry.weight_g || entry.weight_g <= 0) {
		// "5.96 oz. (169g)" format
		let m = text.match(/weight[:\s]*(\d+(?:\.\d+)?)\s*(?:oz\.?|ounces?)?\s*\(?\s*(\d+(?:\.\d+)?)\s*g(?:rams?)?\)?/i);
		if (m) {
			entry.weight_g = parseFloat(m[2]);
			fieldsAdded.push('weight_g');
		} else {
			// Slash format: "1.64 oz. / 46.9 g"
			m = text.match(/(\d+(?:\.\d+)?)\s*(?:oz\.?|ounces?)\s*[/|]\s*(\d+(?:\.\d+)?)\s*g\b/i);
			if (m) {
				entry.weight_g = parseFloat(m[2]);
				fieldsAdded.push('weight_g');
			} else {
				m = text.match(/weight[:\s]*(\d+(?:\.\d+)?)\s*g(?:rams?)?\b/i);
				if (m) {
					entry.weight_g = parseFloat(m[1]);
					fieldsAdded.push('weight_g');
				} else {
					m = text.match(/weight[:\s]*(\d+(?:\.\d+)?)\s*(?:oz\.?|ounces?)\b/i);
					if (m) {
						entry.weight_g = Math.round(parseFloat(m[1]) * 28.35);
						fieldsAdded.push('weight_g');
					}
				}
			}
		}
	}

	// === LUMENS ===
	if (!entry.performance.claimed.lumens?.length) {
		const lumens: number[] = [];
		const re = /(\d[\d,]*)\s*(?:lumens?|lm)\b/gi;
		let m;
		while ((m = re.exec(text)) !== null) {
			const val = parseInt(m[1].replace(/,/g, ''), 10);
			if (val > 0 && val < 1_000_000 && !lumens.includes(val)) lumens.push(val);
		}
		if (lumens.length > 0) {
			entry.performance.claimed.lumens = lumens.sort((a, b) => b - a);
			fieldsAdded.push('lumens');
		}
	}

	// === LED TYPE ===
	if (!entry.led.length || entry.led[0] === 'unknown') {
		const leds: string[] = [];
		const ledPatterns: [RegExp, string][] = [
			[/\bLuminus\s+SFT[\s-]?70\b/i, 'Luminus SFT70'],
			[/\bLuminus\s+SFT[\s-]?40\b/i, 'Luminus SFT40'],
			[/\bSST[\s-]?20\b/i, 'SST-20'], [/\bSST[\s-]?40\b/i, 'SST-40'],
			[/\bSST[\s-]?70\b/i, 'SST-70'], [/\bSFT[\s-]?40\b/i, 'SFT-40'],
			[/\bSFT[\s-]?70\b/i, 'SFT-70'],
			[/\bXHP[\s-]?50(?:\.2|\.3)?\b/i, 'XHP50'], [/\bXHP[\s-]?70(?:\.2|\.3)?\b/i, 'XHP70'],
			[/\bXM[\s-]?L2?\b/i, 'XM-L2'], [/\bXP[\s-]?L\s*(?:HI|HD|V6)?\b/i, 'XP-L'],
			[/\bXP[\s-]?G[23]?\b/i, 'XP-G'], [/\bXP[\s-]?E2?\b/i, 'XP-E'],
			[/\b519A\b/, '519A'], [/\b219[BCF]\b/, '219B'],
			[/\bLH351D\b/i, 'LH351D'], [/\bE21A\b/, 'E21A'],
			[/\bCree\s+XHP\b/i, 'Cree XHP'], [/\bCree\s+XP\b/i, 'Cree XP'],
			[/\bOSRAM\b/i, 'Osram'], [/\bCOB\b/, 'COB'], [/\bLEP\b/, 'LEP'],
			[/\b319A\b/, '319A'], [/\bSST[\s-]?10\b/i, 'SST-10'],
			[/\bSFT[\s-]?42\b/i, 'SFT-42'], [/\bSFT[\s-]?70\b/i, 'SFT-70'],
			[/\bSFT[\s-]?90\b/i, 'SFT-90'], [/\bSBT[\s-]?90\b/i, 'SBT-90'],
			[/\bSFT[\s-]?25\b/i, 'SFT-25'], [/\b7070\b/, '7070'],
			[/\bLuminus\s+\w+/i, 'Luminus'], [/\bSamsung\s+LH/i, 'Samsung LH'],
			[/\b2835\s*LED/i, '2835'], [/\b5050\s*LED/i, '5050'],
			[/\bGT[\s-]?FC40\b/i, 'GT-FC40'], [/\bFC40\b/, 'FC40'],
			[/\bNichia\b/i, 'Nichia'],
			[/\bC4\s*LED\b/i, 'C4 LED'], [/\bUV\s*LED\b/i, 'UV LED'],
			[/\bRGB\s*LED\b/i, 'RGB LED'],
		];
		for (const [re, name] of ledPatterns) {
			if (re.test(text) && !leds.includes(name)) leds.push(name);
		}
		if (leds.length > 0) {
			entry.led = leds;
			fieldsAdded.push('led');
		}
	}

	// === BEAM DISTANCE / THROW ===
	if (!entry.performance.claimed.throw_m) {
		// Priority 1: labeled "throw|beam distance: NNNm" format
		let m = text.match(/(?:throw|beam\s*distance|peak\s*beam\s*distance|max(?:imum)?\s*(?:beam\s*)?distance|range)[:\s]*(\d[\d,]*)\s*m(?:eters?)?(?!Ah)\b/i);
		if (m) {
			const throwVal = parseInt(m[1].replace(/,/g, ''), 10);
			// Reject values that look like years (2000-2030) or are unreasonably small (<5m)
			if (throwVal >= 5 && throwVal <= 5000 && !(throwVal >= 2000 && throwVal <= 2030)) {
				entry.performance.claimed.throw_m = throwVal;
				fieldsAdded.push('throw_m');
			}
		} else {
			// Priority 2: compound "NNN feet (NNN meters)" — require explicit feet/ft label
			m = text.match(/(\d[\d,]*)\s*(?:feet|ft)\s*\(?\s*(\d[\d,]*)\s*m(?:eters?)?\s*\)?/i);
			if (m) {
				const tv = parseInt(m[2].replace(/,/g, ''), 10);
				if (tv >= 5 && tv <= 5000) {
					entry.performance.claimed.throw_m = tv;
					fieldsAdded.push('throw_m');
				}
			} else {
				// Priority 3: reverse "NNNm throw|beam"
				m = text.match(/(\d[\d,]*)\s*m(?:eters?)?\s*(?:throw|beam\s*distance|beam)(?!Ah)\b/i);
				if (m) {
					const tv = parseInt(m[1].replace(/,/g, ''), 10);
					if (tv >= 5 && tv <= 5000 && !(tv >= 2000 && tv <= 2030)) {
						entry.performance.claimed.throw_m = tv;
						fieldsAdded.push('throw_m');
					}
				} else {
					// Priority 4: yards with conversion
					m = text.match(/(?:throw|beam\s*distance)[:\s]*(\d[\d,]*)\s*(?:yards?|yds?)\b/i);
					if (m) {
						const tv = Math.round(parseInt(m[1].replace(/,/g, ''), 10) * 0.9144);
						if (tv >= 5 && tv <= 5000) {
							entry.performance.claimed.throw_m = tv;
							fieldsAdded.push('throw_m');
						}
					}
				}
			}
		}
	}

	// === INTENSITY ===
	if (!entry.performance.claimed.intensity_cd) {
		const m = text.match(/(\d[\d,]*)\s*(?:cd|candela)\b/i);
		if (m) {
			entry.performance.claimed.intensity_cd = parseInt(m[1].replace(/,/g, ''), 10);
			fieldsAdded.push('intensity_cd');
		}
	}

	// === CRI ===
	if (!entry.performance.claimed.cri) {
		const m = text.match(/CRI[:\s>]*(\d+)/i);
		if (m) {
			const cri = parseInt(m[1], 10);
			if (cri >= 50 && cri <= 100) {
				entry.performance.claimed.cri = cri;
				fieldsAdded.push('cri');
			}
		}
	}

	// === CCT ===
	if (!entry.performance.claimed.cct) {
		const m = text.match(/(\d{4,5})\s*K\b/);
		if (m) {
			const cct = parseInt(m[1], 10);
			if (cct >= 1800 && cct <= 10000) {
				entry.performance.claimed.cct = cct;
				fieldsAdded.push('cct');
			}
		}
	}

	// === MATERIAL (from full page HTML) ===
	if (!entry.material.length) {
		const materials: string[] = [];
		if (/A6061|aluminum|aluminium/i.test(text)) materials.push('aluminum');
		if (/titanium/i.test(text)) materials.push('titanium');
		if (/copper/i.test(text)) materials.push('copper');
		if (/brass/i.test(text)) materials.push('brass');
		if (/stainless/i.test(text)) materials.push('stainless steel');
		if (/polymer|plastic|nylon|polycarbonate|polyamide|abs\b/i.test(text)) materials.push('polymer');
		if (materials.length > 0) {
			entry.material = materials;
			fieldsAdded.push('material');
		}
	}

	// === SWITCH (from full page HTML) ===
	if (!entry.switch.length) {
		const switches: string[] = [];
		if (/tail[\s-]?switch|tail[\s-]?cap|tail\s*click|rear\s*switch|tactical\s*button|forward\s*clicky|reverse\s*clicky/i.test(text)) switches.push('tail');
		if (/side[\s-]?switch|side\s*button|e[\s-]?switch|electronic\s*switch|soft[\s-]?touch\s*switch/i.test(text)) switches.push('side');
		if (/dual[\s-]?switch|two\s*switch|two\s*button/i.test(text)) switches.push('dual');
		if (/rotary\b|twist|magnetic\s*(?:control\s*)?ring|selector\s*ring/i.test(text)) switches.push('rotary');
		// Fallbacks — only if nothing matched above
		if (switches.length === 0 && /push[\s-]?button|momentary|single\s*switch/i.test(text)) switches.push('side');
		if (switches.length === 0 && /\bclicky\b/i.test(text)) switches.push('tail');
		if (switches.length > 0) {
			entry.switch = switches;
			fieldsAdded.push('switch');
		}
	}

	// === BATTERY (from full page HTML) ===
	if (!entry.battery.length || entry.battery[0] === 'unknown') {
		const batteries: string[] = [];
		const patterns: [RegExp, string][] = [
			[/\b21700[iI]?\b/, '21700'], [/\b18650[iI]?\b/, '18650'], [/\b18350\b/, '18350'],
			[/\b16340\b/, '16340'], [/\b14500\b/, '14500'], [/\bCR123A?\b/i, 'CR123A'],
			[/\b26650\b/, '26650'], [/\b26800\b/, '26800'],
			[/\bAA\b(?!\w)/, 'AA'], [/\bAAA\b/, 'AAA'],
		];
		for (const [re, name] of patterns) {
			if (re.test(text) && !batteries.includes(name)) batteries.push(name);
		}
		if (batteries.length > 0) {
			entry.battery = batteries;
			fieldsAdded.push('battery');
		}
	}

	// === IP RATING ===
	if (!entry.environment.length) {
		const env: string[] = [];
		const ipMatch = text.match(/\bIP[X]?(\d{1,2})\b/i);
		if (ipMatch) {
			const rating = ipMatch[1].length === 1 ? `IPX${ipMatch[1]}` : `IP${ipMatch[1]}`;
			env.push(rating);
		}
		if (env.length > 0) {
			entry.environment = env;
			fieldsAdded.push('environment');
		}
	}

	// === RUNTIME — was completely missing from detail-scraper ===
	if (!entry.performance.claimed.runtime_hours?.length) {
		const runtimes: number[] = [];
		const rtRe = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/gi;
		let rtm;
		while ((rtm = rtRe.exec(text)) !== null) {
			const val = parseFloat(rtm[1]);
			if (val > 0 && val < 5000 && !runtimes.includes(val)) runtimes.push(val);
		}
		if (runtimes.length > 0) {
			entry.performance.claimed.runtime_hours = runtimes;
			fieldsAdded.push('runtime_hours');
		}
	}

	// === FEATURES — was completely missing from detail-scraper ===
	if (!entry.features.length) {
		const features: string[] = [];
		if (/\bclip\b/i.test(text) && !/video\s*clip/i.test(text)) features.push('clip');
		if (/\bmagnet(?:ic)?\b/i.test(text) && !/magnetic\s*charg/i.test(text)) features.push('magnet');
		if (/\blanyard\b/i.test(text)) features.push('lanyard');
		if (/\blockout\b/i.test(text)) features.push('lockout');
		if (/\bmemory\b/i.test(text) && !/card|flash\s*memory|storage/i.test(text)) features.push('mode memory');
		if (/\banduril\b/i.test(text)) features.push('Anduril');
		if (/\brechargeable\b/i.test(text)) features.push('rechargeable');
		if (/\bpower\s*bank\b/i.test(text)) features.push('power bank');
		if (/\banti[\s-]?roll\b/i.test(text)) features.push('anti-roll');
		if (/\bthermal\s*(?:regulation|management|step)/i.test(text)) features.push('thermal stepdown');
		if (/\bstrike\s*bezel\b|\bglass\s*break/i.test(text)) features.push('strike bezel');
		if (features.length > 0) {
			entry.features = features;
			fieldsAdded.push('features');
		}
	}

	// === BLINK MODES — was missing from detail-scraper ===
	if (!entry.blink?.length) {
		const blink: string[] = [];
		if (/\bstrobe\b/i.test(text)) blink.push('strobe');
		if (/\bsos\b/i.test(text)) blink.push('SOS');
		if (/\bbeacon\b/i.test(text)) blink.push('beacon');
		if (blink.length > 0) {
			entry.blink = blink;
			fieldsAdded.push('blink');
		}
	}

	// === IMPACT RESISTANCE — was missing from detail-scraper ===
	if (!entry.impact?.length) {
		const impactMatch = text.match(/(\d+(?:\.\d+)?)\s*m(?:eter)?s?\s*(?:impact|drop)/i);
		if (impactMatch) {
			entry.impact = [`${impactMatch[1]}m`];
			fieldsAdded.push('impact');
		}
	}

	// === CHARGING — was completely missing from detail-scraper ===
	if (!entry.charging.length) {
		const charging: string[] = [];
		if (/usb[\s-]?c\b|type[\s-]?c\b/i.test(text)) charging.push('USB-C');
		if (/micro[\s-]?usb/i.test(text)) charging.push('Micro-USB');
		if (/magnetic\s*charg/i.test(text)) charging.push('magnetic');
		if (charging.length > 0) {
			entry.charging = charging;
			fieldsAdded.push('charging');
		}
	}

	// === RAW SPEC TEXT CAPTURE for future AI parsing ===
	// Extract text segments that look like spec data but weren't fully parsed by regex.
	// These get stored in raw_spec_text table for batch AI processing later.
	captureRawSpecText(entry, text, url);
}

/**
 * Identify and store spec-like text segments that regex couldn't parse.
 * Categories: specs (tables/lists), modes (output levels), runtime, features.
 */
function captureRawSpecText(entry: FlashlightEntry, text: string, url: string): void {
	const { valid, missing } = hasRequiredAttributes(entry);
	if (valid || missing.length === 0) return; // Nothing to parse

	// Extract spec table/list sections — look for "Specifications" headers and structured data
	const specSections = extractSpecSections(text);

	for (const section of specSections) {
		// Determine category based on content
		let category = 'specs';
		if (/\b(?:mode|output|turbo|high|med|low|moonlight|eco)\b/i.test(section) &&
			/\blumen|lm\b/i.test(section)) {
			category = 'modes';
		} else if (/\bruntime|run\s*time|battery\s*life|hours?\s*(?:of|per)\b/i.test(section)) {
			category = 'runtime';
		} else if (/\b(?:dimension|size|measurement|length|width|height|diameter)\b/i.test(section)) {
			category = 'dimensions';
		} else if (/\b(?:feature|include|package|accessory|compatible)\b/i.test(section)) {
			category = 'features';
		}

		// Only store if it contains data relevant to missing fields
		const relevant = missing.some((field) => {
			switch (field) {
				case 'lumens': return /\blumen|lm\b/i.test(section);
				case 'throw_m': return /\bthrow|distance|beam|range|meter|yard|feet\b/i.test(section);
				case 'runtime_hours': return /\bruntime|run\s*time|hour|battery\s*life\b/i.test(section);
				case 'length_mm': return /\blength|dimension|size|mm\b|inch(?:es)?\b|cm\b/i.test(section);
				case 'weight_g': return /\bweight|mass|gram|oz\b|ounce/i.test(section);
				case 'led': return /\bled|emitter|cree|luminus|nichia|osram|sst|xhp/i.test(section);
				case 'battery': return /\bbattery|cell|18650|21700|cr123|14500/i.test(section);
				case 'switch': return /\bswitch|button|click|tail|side\b/i.test(section);
				case 'material': return /\bmaterial|body|alloy|aluminum|titanium|steel/i.test(section);
				case 'features': return /\bfeature|waterproof|magnetic|pocket\s*clip|usb|charging/i.test(section);
				default: return true;
			}
		});

		if (relevant && section.length >= 30 && section.length <= 5000) {
			addRawSpecText(entry.id, url, category, section.trim());
		}
	}
}

/** Extract structured spec sections from page text */
function extractSpecSections(text: string): string[] {
	const sections: string[] = [];

	// Match spec table sections: "Specifications", "Technical Data", "Features" headers
	const sectionPattern = /(?:^|\n)\s*(?:specification|technical\s*(?:data|detail|spec)|feature|performance|detail|key\s*spec)[s:]?\s*\n([\s\S]{30,2000}?)(?=\n\s*(?:specification|technical|feature|review|related|share|add\s*to\s*cart|description|about)|$)/gi;
	let m;
	while ((m = sectionPattern.exec(text)) !== null) {
		sections.push(m[1].trim());
	}

	// Also capture mode tables — lines with lumen values paired with runtime
	const modeLines: string[] = [];
	const lines = text.split('\n');
	for (const line of lines) {
		// Lines like "Turbo: 2500 lumens (1.5 hours)" or "High\t1200lm\t3h"
		if (/\b(?:turbo|high|med|low|moon|eco|strobe|sos)\b/i.test(line) &&
			/\d+\s*(?:lumen|lm|hour|hr|min)\b/i.test(line)) {
			modeLines.push(line.trim());
		}
	}
	if (modeLines.length >= 2) {
		sections.push(modeLines.join('\n'));
	}

	return sections;
}

/**
 * Run detail scraping on all entries missing required attributes.
 * Fetches full product page HTML for each entry.
 */
export async function scrapeDetailsForIncomplete(options: {
	maxItems?: number;
	onlyMissing?: string[];
	force?: boolean;
	brand?: string;
} = {}): Promise<{
	total: number;
	scraped: number;
	enriched: number;
	errors: number;
	skipped: number;
}> {
	const { maxItems = 500, onlyMissing, force = false, brand } = options;
	let entries = getAllFlashlights();
	if (brand) {
		entries = entries.filter((e) => e.brand.toLowerCase() === brand.toLowerCase());
		console.log(`  Filtering to brand: ${brand} (${entries.length} entries)`);
	}

	// Load set of already-scraped URLs to skip (unless --force)
	const scrapedUrls = force ? undefined : getScrapedUrlSet();
	if (scrapedUrls) {
		console.log(`  Loaded ${scrapedUrls.size} already-scraped URLs (use --force to re-scrape)`);
	}

	let scraped = 0;
	let enriched = 0;
	let errors = 0;
	let skipped = 0;

	for (const entry of entries) {
		if (scraped >= maxItems) break;

		const { valid, missing } = hasRequiredAttributes(entry);
		if (valid) continue;

		// If onlyMissing is specified, only scrape entries missing those specific fields
		if (onlyMissing && !missing.some((m) => onlyMissing.includes(m))) continue;

		try {
			const result = await scrapeDetailForEntry(entry, scrapedUrls);

			if (result.skipped) {
				skipped++;
				continue; // Don't count toward scraped limit, don't delay
			}

			scraped++;

			if (result.enriched) {
				upsertFlashlight(entry);
				enriched++;
			}

			if (scraped % 25 === 0) {
				console.log(`  Progress: ${scraped} scraped, ${enriched} enriched, ${skipped} skipped${result.fieldsAdded.length > 0 ? ` (${result.fieldsAdded.join(', ')})` : ''}`);
			}
		} catch {
			errors++;
		}

		await Bun.sleep(CRAWL_DELAY);
	}

	return { total: entries.length, scraped, enriched, errors, skipped };
}
