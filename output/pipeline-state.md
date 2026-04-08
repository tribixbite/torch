# Pipeline State — 2026-04-07

## Current Status: 17,644 lights in DB (14,013 active) — 12 spec issues (all known legitimate)

### Coverage (14,013 active lights, excludes removed/blog)
| Field | Missing | % Coverage |
|-------|---------|------------|
| color | 1,334 | 90.5% |
| price_usd | 2,207 | 84.3% |
| weight_g | 2,490 | 82.2% |
| features | 2,788 | 80.1% |
| material | 2,943 | 79.0% |
| lumens | 3,716 | 73.5% |
| battery | 4,275 | 69.5% |
| switch | 4,309 | 69.2% |
| length_mm | 4,706 | 66.4% |
| runtime | 5,087 | 63.7% |
| **led** | **5,874** | **58.1%** |
| throw_m | 5,961 | 57.5% |

Note: parametrek-crossref.ts deprecated — no longer used for enrichment.

### Continuous Enrichment Pipeline
1. **Keepa cron** (`scripts/keepa-cron.sh`): every 5min, 5 ASINs, post-scrape enrichment:
   - `scrape-images.ts --download-only` — thumbnails for new entries
   - ~~`parametrek-crossref.ts`~~ — REMOVED (cannot use parametrek data directly)
   - `model-crossref.ts` — propagate within-brand fields
2. **Vision cron** (`scripts/vision-cron.sh`): hourly grid build → classify → sprite rebuild
3. **Validation** (`scripts/validate-vision-accuracy.ts`): compare vs parametrek ground truth

### Vision Accuracy (vs parametrek ground truth)
| Metric | Color | Switch |
|--------|-------|--------|
| Exact match | 56.5% | 21.1% |
| Partial overlap | 16.3% | 42.2% |
| Mismatch | 27.2% | 36.7% |

Known issues:
- **Color**: White-background bias — product images on white bg classified as "white" body color
- **Switch**: Taxonomy mismatch — parametrek uses "dual tail", "ring", "momentary" vs our simpler categories

### Session Gains (4/7 — current)
- **Spec verification: 135 → 12 issues** (all 12 known legitimate)
  - FL1 mismatches: 82 fixed (trust cd, re-derive throw for 80; trust throw, re-derive cd for 2)
  - Weight/battery mismatches: 49 fixed (32 accessories battery cleared, 17 bogus weights cleared)
  - Nitecore MT21C: 4 entries merged to 1
  - Saint Torch 31 length decimal error: 28.5 → 285mm
- **Brand normalization**: 772 → 733 unique brands, 0 case dupes
  - ~30 new BRAND_MAP aliases (Coast variants, Fenix, Maglite, Manker, Nightstick, etc.)
  - `normalizeBrandAtBuild()` with prefix stripping for mapped brands
  - JSON size: 8.9MB → 7.4MB (-17%, inc sort arrays dropped)
- **Petzl scraping** (petzl.com, server-rendered Salesforce):
  - 59 fields updated across Actik, Tikka, Pixa families (lumens, throw, runtime, weight, battery, price)
  - LED/length/material NOT published by Petzl
- **Sofirn scraping** (sofirnlight.com via Playwright + flashlightgo.com Shopify JSON API):
  - 15 throw values recovered (SC33=327, SP36Pro=423, SK1=479, Q8Plus=554, etc.)
  - Source: Shoplazza rendered DOM text + Shopify `/products/{handle}.json`
- **Wurkkos scraping** (wurkkos.com + flashlightgo.com):
  - 11 throw values (TD07=479, TD04=1000, HD50=1000, TS27=845, FC12C=332, etc.)
  - UeeShop product descriptions + Shopify JSON API fallback
- **FL1 derivation**: 32 intensity_cd values derived from new throw data

### Session Gains (4/2)
- **Bogus throw cleanup**: 1,638 throw values ≤10m cleared (star ratings, model numbers, page positions)
  - No real flashlight has ANSI FL1 throw ≤10m
  - Distribution: throw=2 (424), throw=5 (380), throw=1 (190) — parsing artifacts
  - Also clears co-derived intensity_cd when FL1-consistent with bogus throw
  - Throw coverage: 70.0% → 60.8% (honest)
- **FL1 throw derivation**: 12 entries fixed using FL1 formula from known intensity_cd
  - Maglite model numbers (SP2P017M → 17m → 163m from 6613cd)
  - LEATHERMAN/Lumintop/Fenix parsing artifacts
- **Spec verification improvement**: 327 → 146 issues (FL1 mismatches: 266 → 85)
- **FL1 gap-fill**: 211 throw values derived from valid intensity_cd via FL1 formula
  - Cleared 74 bogus intensity_cd values <25cd (parsing artifacts matching throw cleanup)
  - Throw coverage: 60.7% → 62.0%
- **Dedup**: 8 duplicate brand+model pairs merged, 2 non-flashlight entries removed (MINIWARE hot plate)
  - 14,404 → 14,396 entries in build output
- **Model cross-reference**: 384 fixes (throw +244, FL1 intensity +311, battery +61, length +70)
- **Frontend fixes**: isArrayLike() in FlashlightTable, null-safety in formatWithUnit, NaN guard on reviews
- **Bogus TM12K fix**: nitecore-tm12k-black-rechargeable had 200k lumens → 12k via cross-reference

### Session Gains (4/1)
- **Battery normalization**: 647 → 94 unique values (DB migration: 1,099 entries updated, 614 dropped unknown-only)
  - Module: `pipeline/normalization/battery-normalizer.ts` (166 test cases)
  - DB migration: `scripts/normalize-batteries.ts`
  - Build-time: `normalizeBatteryArray()` applied in build-torch-db.ts
  - 1x prefix stripped: `1x18650` → `18650`, `1xCR123A` → `CR123A`
  - Multi-cell expansion: `2x18650` → `["18650", "2x18650"]` (matches both filters)
  - Chemistry merged: Li-ion/Li-Ion/lithium-ion → `Li-ion`, Li-polymer/Li-Pol → `Li-poly`
  - Built-in merged: 6+ variants (ZITHION, Integrated, mAh-only, Wh strings) → `built-in`
  - Drops: USB, rechargeable (not battery types)
- **Battery filter ordering**: common cells first (18650, 21700, 14500, 18350, 16340, CR123A)
  - `BATTERY_PRIORITY` array in build-torch-db.ts, remaining sorted alphabetically
- **Known manufacturer brands**: 28 brands whitelisted (`KNOWN_MFG_BRANDS` in build-torch-db.ts)
  - Acebeam, Armytek, Convoy, Emisar, Fenix, Lumintop, Olight, Rovyvon, Sofirn, Wurkkos, etc.
  - jlhawaii808 added to RETAILER_DOMAINS
- **Image URL reorder**: generalized `scripts/fix-image-ordering.ts` for all brands
  - Priority: manufacturer > Shopify CDN > other > Amazon
  - GIF demotion: animated GIFs moved to end of URL array
- **Sprite rebuild**: 17,051 tiles, 13,932/14,404 entries mapped (96.7%)
- **Battery filter QA verified on production** (torch.directory):
  - First 6 filter options correctly ordered: 18650, 21700, 14500, 18350, 16340, CR123A
  - 91 total battery options, popularity-weighted ordering works
  - Search box filters options correctly (typing "18650" shows 18650, 2x18650, 3x18650, 4x18650, 8x18650)
  - 18650 filter returns 2309 matches — includes multi-cell entries via normalization expansion
- **Playwright MCP Termux/Android fix** (node_modules patches):
  - Root cause: `os.platform() === "android"` on Termux, not `"linux"`, so headless default was `false`
  - Combined with `DISPLAY=:1` env var (stale Termux X11), Chromium tried headed mode and crashed
  - Fix 1: `config.js` — always force headless on Android platform
  - Fix 2: `browserContextFactory.js` — clean stale SingletonLock files between retry attempts

### Session Gains (3/29)
- **Card display fix**: Array fields (battery, modes, switch, features, color, material) were blank
  - Root cause 1: `Array.isArray()` returns false for Svelte 5 `$state` proxied arrays
  - Root cause 2: `formatWithUnit()` discarded display value when `col.unit` was empty string
  - Fix: `isArrayLike()` helper + empty-unit fallback in FlashlightCard.svelte
- **SI prefix formatting**: Added `{si}` unit handling using `smartFixed()` for lumens, runtime, etc.
- **Data cleanup**: Cleared 572 bogus spec values parsed from model numbers/capacities
  - 14 throw values >5km (Maglite model #s like P32112M → 32112m)
  - 17 weight values >5kg (model #s, part #s parsed as grams)
  - 541 length values <10mm or >1m (accessory dimensions, USB cables)
  - Script: `scripts/clear-bogus-specs.ts`

### Session Gains (3/28)
- **Full 48-brand enrichment sweep**: 3 passes, ~1,900 scraped, ~489 enriched, ~255 FL1 derivations
  - Expanded from 19 → 48 brands (all zakreviews.com + zeroair.org review brands)
  - Script: `scripts/enrich-priority-brands.ts` — loops until enrichment converges
  - Fixed convergence: `passEnriched === 0` (not passScraped — Pelican Cloudflare pages never stop)
  - Fenix: 105 enriched — +46 price, +27 runtime, +25 switch, +23 led, +17 features, +13 throw, +9 lumens, +9 material, +10 battery, +6 length
  - Nextorch: 72 enriched — +12 runtime, +11 switch, +10 price, +3 led
  - Coast: 68 enriched — +6 lumens, +6 length, +5 runtime, +5 led, +6 price
  - Olight: 52 enriched — +2 runtime, +2 led, +1 battery, +1 length
  - Lumintop: 41 enriched — +11 led, +4 runtime, +3 switch
  - Klarus: 37 enriched — +3 led, +2 runtime, +2 price
  - JETBeam: 21 enriched — +2 led, +2 features, +2 price
  - Nitecore: 19 enriched — +5 lumens, +5 throw, +6 runtime, +5 led, +14 price
  - SureFire: 18 enriched — +2 throw, +2 length, +1 runtime
  - 27 brands fully scraped (no remaining URLs)

### Previous Session Gains (3/27)
- **Priority brand enrichment sweep**: 19 brands, 430 scraped, 258 enriched, 127 FL1 derivations
  - Imalent: +18 switch, +15 runtime, +9 led, +6 lumens, +6 price, +5 throw
  - Nitecore: +5 lumens, +5 throw, +5 led, +5 features, +5 battery, +4 runtime, +4 switch
  - Acebeam: +5 runtime, +5 led, +5 length, +1 features, +1 battery
  - Armytek: +8 price, +7 runtime, +7 led, +2 features, +2 material
  - Streamlight: 50 enriched (+1 led, +1 switch)

### Previous Session Gains (3/27)
- **Battery normalization**: 647 unique battery values → 85 canonical (87% reduction)
  - Cell types: strip qty-1 prefix, normalize IEC names (123A → CR123A)
  - Chemistry: Li-ion/Li-Ion/lithium-ion → Li-ion, Li-polymer/Li-Pol → Li-poly
  - Built-in: integrated/ZITHION/capacity-only/Wh strings → built-in
  - Multi-cell expansion: 2x18650 → both 18650 AND 2x18650 in filter
  - 166 test cases, module: `pipeline/normalization/battery-normalizer.ts`
  - DB migration: `scripts/normalize-batteries.ts`
- **Battery filter ordering**: popularity-weighted (18650, 21700, 14500 at top) instead of alphabetical
- **Known manufacturer brands**: 29 r/flashlight-approved brands whitelisted for has_mfg_url=yes
  - Includes Lumintop, Convoy, Sofirn, Wurkkos, Emisar, Noctigon, etc.
- **Image URL reorder**: generalized to all brands (was Emisar/Noctigon only)
  - 41 entries: Amazon/retailer → Shopify/manufacturer first
  - 26 entries: GIF-first URLs demoted
  - Script: `scripts/fix-image-ordering.ts`
- **Retailer domains**: added jlhawaii808
- **Material normalization**: 220 unique material values → 24 canonical (89% reduction)
  - Aluminum variants: Anodized/Aircraft-grade/6061-T6/etc. → aluminum
  - Polymer: Plastic/ABS/Nylon/Polycarbonate/GFRN/Lexan → polymer
  - Rubber: Silicone/Neoprene/EVA → rubber
  - Regex fallbacks for remaining long alloy descriptions
  - 79 test cases, module: `pipeline/normalization/material-normalizer.ts`
- **Switch normalization**: 132 unique switch values → 22 canonical (83% reduction)
  - Push button/click/reverse clicky/forward clicky → clicky
  - Twist/progressive twist → twisty, front → side, rear/bottom/back → tail
  - Motion/gesture/touch/noncontact → sensor
  - 70 test cases, module: `pipeline/normalization/switch-normalizer.ts`
- **Features normalization**: 259 unique feature values → 182 canonical (30% reduction)
  - Pocket clip → clip, lanyard hole → lanyard, battery check → battery indicator
  - IP68 → IPX8, IP67 → IPX7, zoomable → focusable, powerbank → power bank
  - 60 test cases, module: `pipeline/normalization/features-normalizer.ts`
- **Material/switch filter ordering**: popularity-weighted (aluminum, stainless steel, polymer first; tail, side, rotary first)
- **Unified migration**: `scripts/normalize-all.ts` — runs all 3 normalizer self-tests then applies DB migrations
- **Parametrek crossref deprecated**: removed from keepa-cron.sh, guard added to script
  - Existing data kept — can't distinguish parametrek-sourced from scraped data
  - Future enrichment: manufacturer scraping only, no parametrek backfill

### Previous Session Gains (3/27 — earlier)
- **Sprite rendering fix**: `Array.isArray()` fails on Svelte 5 proxied arrays — all thumbnails were rendering tile 0,0
  - Fixed `picIsSprite` detection in `FlashlightCard.svelte` to use `typeof + length` check
  - All 15,696 sprite tiles now render correctly per entry
- **Emisar/Noctigon image URL reorder**: 44 entries had intl-outdoor Magento cache URLs first
  - 6 entries with Shopify CDN alternatives reordered (Shopify first)
  - Thumbnails re-downloaded from higher-quality Shopify CDN source
  - Script: `scripts/fix-intl-images.ts`
- **Sprite rebuild**: 15,696 tiles mapped (12,573/13,021 entries = 96.6% sprite coverage)
- **Junk image cleanup**: 42 entries cleaned of ajax-loader.gif, 120x120 thumbs, placeholders

### Previous Session Gains (3/26)
- **Default quality filters**: Fresh visits auto-apply completeness ≥ 8/16 + no accessories/blogs
  - 12,871 total → ~9,215 shown by default (28% filtered)
  - `completeness` range column: counts non-empty required attributes per entry (0–16)
  - `has_mfg_url` multi column: brand-level manufacturer URL detection (96 brands = "yes")
  - Users can disable/adjust defaults via sidebar — filters visible in URL bar
- **Duplicate cleanup**: 32 duplicate groups merged (33 entries removed)
  - Case-insensitive dedup for EagTac/EagleTac, Fenix PD40R v2.0/V2.0, etc.
- **Data cleanup**: 892 invalid lengths (<10mm) cleared, 32 erroneous weights (>5kg on accessories) cleared, 4 lengths >1m cleared
- **Data audit**: full quality report at `output/data-audit.md`
  - 574 no-name brands (no manufacturer URL, 2,657 entries)
  - 269/12,493 entries missing images
  - 18 entries with lumens > 100k, 48 with weight > 5kg
- **Spec verification**: 1,300 flags across bounds checks + ANSI FL1 consistency
- **LED normalization**: 904 unique strings → 401 canonical filter options (56% reduction)
  - 5,190+ generic entries cleared ("LED", "High Performance Cool White LED", etc.)
  - 519A: 18 variants → 1 filter option
  - All Cree/Luminus/Nichia/Osram families standardized with proper prefixes
  - Module: `pipeline/normalization/led-normalizer.ts` (107 test cases)
  - DB migration: `scripts/normalize-leds.ts`
  - Build-time: normalizeLedArray() applied in build-torch-db.ts
- **Show unknown toggle**: per-filter "? unknown" toggle for all filter types
- **Keepa batch optimization**: 5 ASINs/5min cron with post-scrape enrichment

### Previous Session Gains (3/21)
- **Parametrek crossref**: +166 fixes (12 switches, 20 LEDs, 23 years, 20 beam angles, etc.)
- **Vision classifier (Flash)**: +96 colors, +64 switches, 1262 reclassified as accessories
- **Gap reduction**: color 186→50, switch 377→229

### Diminishing Returns
All cascade scripts converged to zero. AI parser exhausted. Remaining gaps are structural:
1. **LED (1,388)**: Brands don't publish LED chip names (Nightstick, Coast, Pelican, Energizer)
2. **Runtime (1,006)**: Chinese brands without ANSI data (Lumintop, Mateminco, Emisar)
3. **Length (797)**: Not on product pages, would need review sites or spec sheets
4. **Throw (701)**: Many products don't publish throw distance

### Enrichment Tools Available
| Script | Purpose |
|--------|---------|
| `scripts/extract-missing-fields.ts` | Regex extraction from raw_spec_text |
| `scripts/model-crossref.ts` | Cross-reference same-model entries |
| `scripts/dedup-models.ts` | Merge duplicate brand+model entries |
| `scripts/parametrek-crossref.ts` | DEPRECATED — validation only, not for enrichment |
| `scripts/revert-parametrek-data.ts` | Revert parametrek-sourced data from DB |
| `scripts/fetch-asin-prices.ts` | Get prices from Amazon by ASIN |
| `scripts/normalize-leds.ts` | One-shot DB migration for LED canonicalization |
| `scripts/normalize-batteries.ts` | One-shot DB migration for battery canonicalization |
| `scripts/normalize-all.ts` | Unified DB migration for material/switch/features |
| `pipeline/normalization/led-normalizer.ts` | Canonical LED normalizer (107 test cases) |
| `pipeline/normalization/battery-normalizer.ts` | Canonical battery normalizer (166 test cases) |
| `pipeline/normalization/material-normalizer.ts` | Canonical material normalizer (79 test cases) |
| `pipeline/normalization/switch-normalizer.ts` | Canonical switch normalizer (70 test cases) |
| `pipeline/normalization/features-normalizer.ts` | Canonical features normalizer (60 test cases) |
| `scripts/validate-vision-accuracy.ts` | Validate vision results vs parametrek |
| `scripts/vision-cron.sh` | Hourly vision enrichment (grid → classify → sprite) |
| `scripts/enrich-priority-brands.ts` | Auto-sweep 48 brands: scrape + FL1, loop until converged |
| `pipeline/cli.ts raw-fetch` | Fetch raw text for entries without it |
| `pipeline/cli.ts build` | Rebuild flashlights.now.json |
| `scripts/audit-data-quality.ts` | Comprehensive data quality audit → output/data-audit.md |
| `scripts/verify-specs.ts` | Spec bounds verification → output/data-audit.md |
