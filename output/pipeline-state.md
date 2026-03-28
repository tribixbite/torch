# Pipeline State — 2026-03-27

## Current Status: Parametrek data reverted — honest coverage

### Coverage (11,061 lights after parametrek reversion)
| Field | Count | % Coverage |
|-------|-------|------------|
| features | 9,222 | 83% |
| lumens | 8,705 | 79% |
| weight_g | 8,735 | 79% |
| material | 8,640 | 78% |
| price_usd | 8,237 | 74% |
| battery | 8,078 | 73% |
| length_mm | 7,906 | 71% |
| switch | 7,754 | 70% |
| throw_m | 7,239 | 65% |
| runtime | 7,185 | 65% |
| **led** | **7,012** | **63%** |

Note: 1,065 entries had parametrek-sourced data reverted (8,471 field values cleared).
Brands with own scrapers unaffected. Amazon-sourced entries lost parametrek backfill.

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

### Session Gains (3/27 — current)
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
- **Parametrek data reversion**: 1,065 entries cleared of parametrek-sourced data (8,471 field values)
  - Criteria: no info_urls (Amazon-sourced) + 2+ scalar fields matching parametrek exactly
  - Script: `scripts/revert-parametrek-data.ts`
  - `scripts/parametrek-crossref.ts` deprecated — removed from keepa-cron.sh
  - Parametrek data only for validation, not production enrichment

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
| `pipeline/cli.ts raw-fetch` | Fetch raw text for entries without it |
| `pipeline/cli.ts build` | Rebuild flashlights.now.json |
| `scripts/audit-data-quality.ts` | Comprehensive data quality audit → output/data-audit.md |
| `scripts/verify-specs.ts` | Spec bounds verification → output/data-audit.md |
