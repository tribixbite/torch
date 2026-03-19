# Pipeline Catalog — Scrapers, Sources & Outputs

> Auto-generated 2026-03-19. Current DB: 12,452 entries, 9,990 flashlights, 7,631 fully valid (76.4%).
> 141 brands across 48 source domains.

---

## Table of Contents

1. [Automated Pipelines](#1-automated-pipelines)
   - [Catalog Crawlers](#a-catalog-crawlers) — 16 manufacturer sites
   - [Shopify API](#b-shopify-api) — 30 stores
   - [WooCommerce API](#c-woocommerce-api) — 4 stores
   - [Keepa / Amazon](#d-keepa--amazon) — ASIN discovery + product detail
   - [Detail Scraper](#e-detail-scraper) — per-entry enrichment
   - [Raw Text Fetcher](#f-raw-text-fetcher) — bulk page text capture
   - [AI Spec Parser](#g-ai-spec-parser) — LLM extraction from raw text
   - [Review Sites](#h-review-site-scrapers) — 5 sites configured
   - [BudgetLightForum](#i-budgetlightforum-scraper) — community specs
   - [Vision Pipeline](#j-vision-pipeline) — image classification
   - [Cross-Referencing](#k-cross-referencing--enrichment) — model-prefix matching
2. [One-Off Scripts](#2-one-off-scripts)
3. [Build Pipeline & Outputs](#3-build-pipeline--outputs)
4. [Source Domain Index](#4-source-domain-index)

---

## 1. Automated Pipelines

### A. Catalog Crawlers

**File**: `pipeline/extraction/catalog-crawler.ts`
**CLI**: `bun ./pipeline/cli.ts crawl [brand]`
**Delay**: 1500ms between requests

Each brand has a custom extractor for its site structure. All extract to the canonical `FlashlightEntry` schema.

| Brand | Domain | Platform | Discovery | Specs Extracted | Notes |
|-------|--------|----------|-----------|----------------|-------|
| Fenix | fenixlighting.com | Shopify | Sitemap + /collections/ | lumens, throw, led, battery, runtime, length, weight, material, switch, features, price, color, IP rating | Best coverage (91% valid) |
| Olight | olightstore.com | Next.js/Shopify | Sitemap + category pages | lumens, throw, led, battery, runtime, length, weight, material, switch, features, price | Uses `__NEXT_DATA__` JSON + Olight API for full specs |
| Nitecore | nitecore.com | Custom PHP | Sitemap + /category/ | lumens, throw, led, battery, runtime, length, weight, material, switch, features, price, IP | Structured spec tables |
| Acebeam | acebeam.com | Shopify | Sitemap + /all-products | lumens, throw, led, battery, runtime, length, weight, price | 72% valid |
| ThruNite | thrunite.com | Custom PHP | Sitemap | lumens, throw, led, battery, runtime, length, weight, material, price | Direct product page parsing |
| Wurkkos | wurkkos.com | UeeShop | Paginated /collections/ | lumens, throw, led, battery, runtime, length, weight, price | Cloudflare blocks fetch — uses `curl` |
| Sofirn | sofirnlight.com | Shoplazza | Paginated category pages | lumens, throw, led, battery, runtime, length, weight, price | Cloudflare blocks fetch — uses `curl` |
| Streamlight | streamlight.com | Custom | Sitemap /sitemap.xml | lumens, throw, led, battery, runtime, length, weight, material, switch, features, price, IP | Structured HTML spec tables |
| Skilhunt | skilhunt.com | WooCommerce | Sitemap /sitemap.xml | lumens, throw, led, battery, runtime, length, weight, material, price | /product/ URL pattern |
| Lumintop | lumintop.com | WooCommerce | Sitemap + flashlight/headlamp patterns | lumens, throw, led, battery, runtime, length, weight, price | 55% valid, prices often $0 |
| Klarus | klaruslight.com | Custom PHP | Numeric item IDs (60-160) | lumens, throw, led, battery, runtime, length, weight, material, switch, price | `div.sme`/`div.pme` spec pairs |
| Emisar/Noctigon | intl-outdoor.com | Magento 1.x | Category page discovery | lumens, throw, led, battery, led_options, price (from dropdown adders), features | Configurable products with LED/tint dropdowns |
| SureFire | surefire.com | BigCommerce | 4 paginated categories | lumens, throw, led, battery, runtime, length, weight, material, switch, price | Categories: flashlights, weapon-lights, hands-free, helmet-lights |
| Armytek | armytek.com | CS-Cart | 2-level pagination (families → products) | lumens, throw, led, battery, runtime, length, weight, material, switch, features, IP | 76% valid |
| Zebralight | zebralight.com | Shift4Shop/3dcart | Sitemap `_p_ID.html` pattern | lumens, led, battery, runtime, length, weight, material, switch, price | throw_m at 10% — FL1 derivation needed |
| Pelican | pelican.com | Custom | Category pages | lumens, throw, led, battery, runtime, length, weight, material, switch, features, price, IP | Uses `curl` (Cloudflare TLS fingerprint) |

---

### B. Shopify API

**File**: `pipeline/extraction/shopify-crawler.ts`
**CLI**: `bun ./pipeline/cli.ts shopify [brand]`
**Delay**: 800ms between requests
**API**: `/products.json?limit=250&page=N` (public, no auth)

**Specs from Shopify product JSON**: model, price, images, variants, tags, body_html (parsed for specs)
**Enrichment from description HTML**: lumens, throw, led, battery, runtime, length, weight, material, switch, features, color, IP rating

#### Manufacturer Stores (fixed brand)

| Store | Domain | Brand | Notes |
|-------|--------|-------|-------|
| Fenix | fenixlighting.com | Fenix | |
| Olight | olightstore.com | Olight | Filters: !accessories, !adapter, !patch |
| Nitecore | nitecorestore.com | Nitecore | |
| Rovyvon | rovyvon.com | Rovyvon | |
| Wuben | wubenlight.com | Wuben | |
| Imalent | imalentstore.com | Imalent | |
| Maglite | maglite.com | Maglite | Filters: PD Custom Products |
| Ledlenser | ledlenserusa.com | Ledlenser | |
| Pelican | shop.pelican.com | Pelican | |
| Fireflies | ff-light.myshopify.com | Fireflies | publicUrl: firefly-outdoor.com |
| Nextorch | nextorch.com | Nextorch | |
| PowerTac | powertac.com | PowerTac | |
| Nightstick | nightstick.com | Nightstick | |
| Malkoff | malkoffdevices.com | Malkoff | |
| ReyLight | reylight.net | ReyLight | |
| Lumintop | lumintoponline.com | Lumintop | |
| FourSevens | foursevens.com | FourSevens | |
| Modlite | modlite.com | Modlite | |
| CloudDefensive | clouddefensive.com | CloudDefensive | |
| Loop Gear | loopgear.com | Loop Gear | Shopify: loop-universe-6044.myshopify.com |
| Coast | coastportland.com | Coast | JS-rendered main site; Shopify API provides base data |

#### Retailer Stores (brand extracted from `vendor` field)

| Store | Domain | Entries | Notes |
|-------|--------|---------|-------|
| Killzone | killzoneflashlights.com | 2,743 | Emisar/Noctigon reseller, emitterSpecOption for LED variants |
| NealGadgets | nealsgadgets.com | 4,273 | Multi-brand retailer |
| GoingGear | goinggear.com | 3,535 | Multi-brand retailer |
| BatteryJunction | batteryjunction.com | 12,007 | Largest source (many duplicates with manufacturers) |
| FlashlightGo | flashlightgo.com | 1,738 | Multi-brand retailer |
| Skylumen | skylumen.com | 693 | Custom/modded lights — 0% valid |
| JLHawaii808 | jlhawaii808.com | 783 | Emisar/Noctigon reseller — mostly accessories |
| FlashlightWorldCA | flashlightworld.ca | 608 | Canadian retailer |
| FenixStore | fenixstore.ca | 247 | Canadian Fenix retailer |
| TorchDirectUK | torchdirect.co.uk | 1,624 | UK multi-brand retailer |

---

### C. WooCommerce API

**File**: `pipeline/extraction/woocommerce-crawler.ts`
**CLI**: `bun ./pipeline/cli.ts woocommerce [brand]`
**Delay**: 800ms between requests
**API**: `/wp-json/wc/store/v1/products?per_page=100&page=N` (public Store API)

**Specs from WooCommerce JSON**: name, description, price, images, attributes, tags, dimensions, weight

| Store | Domain | Brand | Notes |
|-------|--------|-------|-------|
| Skilhunt | skilhunt.com | Skilhunt | 88% valid |
| Lumintop | lumintop.com | Lumintop | Alternate WooCommerce instance |
| EagTac | eagtac.com | EagTac | 91% valid |
| JETBeam | jetbeamlight.com | JETBeam | 90% valid |

---

### D. Keepa / Amazon

**Files**: `pipeline/keepa/client.ts`, `pipeline/keepa/scraper.ts`
**CLI**: `bun ./pipeline/cli.ts discover` / `bun ./pipeline/cli.ts scrape [n] [--brand=X]`
**Cron**: `scripts/keepa-cron.sh` — runs every 20 min, 1 batch (20 ASINs)
**Token budget**: 60/hr (1/min refill)

#### Phase 1: ASIN Discovery (Product Finder API)
- Cost: 11 tokens per query (10 base + 1 per 100 results)
- Searches each brand from `pipeline/config/brands.ts` (38 brands configured)
- Current state: **8,731 ASINs discovered**

#### Phase 2: Product Detail Scraping
- Cost: 1 token per ASIN, batch size 20
- Current state: **796 scraped**, 7,935 remaining

#### Specs Extracted from Keepa
| Field | Source |
|-------|--------|
| brand | Amazon brand field |
| model | Title parsing |
| price_usd | CSV price history (Amazon, BuyBox, 3rd-party New) |
| weight_g | packageWeight / itemWeight |
| length_mm | packageLength or itemLength |
| images | imagesCSV |
| purchase_url | Amazon ASIN URL |
| ean/upc | eanList / upcList |

#### Brands Configured for Discovery
Acebeam, Armytek, Catapult, Coast, CloudDefensive, Convoy, Eagletac, Emisar/Noctigon, Fenix, Fireflies, FourSevens, Haikelite, Imalent, JETBeam, Klarus, Ledlenser, Lumintop, Maglite, Malkoff, Manker, Modlite, Nextorch, Nightstick, Nitecore, Olight, Pelican, PowerTac, Princeton Tec, ReyLight, Rovyvon, Skilhunt, Sofirn/Wurkkos, Streamlight, SureFire, ThruNite, Wuben, YLP, Zebralight

---

### E. Detail Scraper

**File**: `pipeline/extraction/detail-scraper.ts`
**CLI**: `bun ./pipeline/cli.ts detail-scrape [max] [--force] [--brand=X]`
**Delay**: 2000ms between requests

Visits individual product pages (from `info_urls` or `purchase_urls`) to extract missing specs. Has brand-specific extractors for structured HTML on ~20 manufacturer sites plus generic fallback regex extraction.

**Fields targeted**: led, length_mm, weight_g, material, switch, features, environment (IP rating), runtime_hours, throw_m, lumens, battery

**Special handling**:
- Olight: fetches `__NEXT_DATA__` JSON → calls product API with productId
- Nitecore: parses `div.product-spec` tables
- Streamlight: parses structured spec sections
- Generic: regex patterns for spec-value pairs in page text

---

### F. Raw Text Fetcher

**File**: `pipeline/extraction/raw-text-fetcher.ts`
**CLI**: `bun ./pipeline/cli.ts raw-fetch [max] [--domain=X] [--dry-run]`
**Delay**: 3000ms per request

Bulk downloads product page text, strips HTML, stores in `raw_spec_text` table for AI parsing. Processes one domain at a time to respect Shopify's shared IP rate limits.

---

### G. AI Spec Parser

**File**: `pipeline/enrichment/ai-parser.ts`
**CLI**: `bun ./pipeline/cli.ts ai-parse [max] [--dry-run] [--brand=X] [--min-missing=N]`
**Delay**: 600ms per request
**Model**: xiaomi/mimo-v2-omni via OpenRouter API
**Max input**: 8000 chars of raw_spec_text

Sends raw page text to LLM with structured extraction prompt. Returns JSON matching `ExtractionResultSchema`. Only fills missing fields, never overwrites.

**Fields extracted**: All canonical fields — lumens, throw_m, runtime_hours, length_mm, weight_g, led, battery, switch, material, features, color, price_usd, environment, CRI, CCT, beam_angle

---

### H. Review Site Scrapers

**File**: `pipeline/extraction/review-scraper.ts`
**CLI**: `bun ./pipeline/cli.ts reviews [site]`
**Delay**: 1500ms between requests

| Site | Domain | Entries | Status | Specs Extracted |
|------|--------|---------|--------|----------------|
| zakreviews | zakreviews.com | 72 | Complete | lumens, throw, weight, runtime, led, battery, material, switch, CRI, CCT, IP |
| 1lumen | 1lumen.com | 1,911 | Complete | lumens, throw, runtime, led, battery, length, weight, material, switch |
| zeroair | zeroair.org | 1,997 | Complete | lumens, throw, runtime, led, battery, length, weight, material, switch, CRI |
| tgreviews | tgreviews.com | 385 | Complete | lumens, throw, runtime, led, battery, length, weight, material |
| sammyshp | sammyshp.de | 137 | Complete | lumens, throw, runtime, led, battery, length, weight |

Only updates EXISTING entries, only fills MISSING fields. Never overwrites manufacturer data.

---

### I. BudgetLightForum Scraper

**File**: `pipeline/extraction/blf-scraper.ts`
**CLI**: `bun ./pipeline/cli.ts blf [max] [--dry-run]`
**Delay**: 3000ms per API call
**API**: Discourse JSON API (`budgetlightforum.com`)

Searches for review threads, extracts specs from first 10 posts per topic. 127 source entries.

**Specs extracted**: lumens, throw, intensity_cd, runtime, weight, length, bezel/body diameter, led, battery, material, switch, features, CRI, CCT, charging, IP rating

---

### J. Vision Pipeline

**Files**: `pipeline/extraction/vision-grid-builder.ts`, `pipeline/extraction/vision-classifier.ts`
**CLI**: `bun ./pipeline/cli.ts images`
**API**: Gemini 2.0 Flash via REST (GEMINI_API_KEY)

Builds 5×5 grids of 100×100px product thumbnails, sends to Gemini for visual classification:
- **Color**: dominant body color from product image
- **Switch type**: side, tail, dual, etc.
- **Type classification**: flashlight vs accessory/battery/charger
- **Results**: ~41% of visually inspected entries classified as non-flashlight

---

### K. Cross-Referencing & Enrichment

**File**: `pipeline/extraction/enrich.ts` + `scripts/model-crossref.ts`
**CLI**: `bun ./pipeline/cli.ts enrich`

#### Model-Prefix Cross-Reference (`scripts/model-crossref.ts`)
Groups entries by `brand + model_prefix` (first word of model). If one entry in the group has a field and another doesn't, copies the value. Cascades all 12 required fields.

#### FL1 ANSI Derivation (`pipeline/extraction/enrich.ts`)
- `throw_m = 2 × √(intensity_cd)` — derives throw from candela
- `intensity_cd = (throw_m / 2)²` — derives candela from throw

#### Regex Extraction (`scripts/extract-missing-fields.ts`)
Mines `raw_spec_text` for patterns:
- **Runtime**: `(\d+\.?\d*)\s*(hours?|hrs?|h)\b`
- **Length**: `(\d{2,3}(?:\.\d+)?)\s*mm\b.*(?:length|long|overall)`
- **Weight**: `(\d{1,3}(?:\.\d+)?)\s*(?:g|grams?)\b`
- **Throw**: `(\d{2,4})\s*(?:m|meters?)\b.*(?:throw|beam\s*distance)`

---

## 2. One-Off Scripts

Scripts in `scripts/` — ran for specific data acquisition campaigns.

### Price Acquisition

| Script | Target | Domain | Method | Result |
|--------|--------|--------|--------|--------|
| `amazon-asin-search.ts` | Nightstick ASINs | amazon.com | Search results scraping via curl | Found ASINs for model matching |
| `amazon-nightstick-prices.ts` | Nightstick prices | amazon.com | Product page scraping via curl + JSON-LD | Updated price_usd for Nightstick entries |
| `amazon-price-lookup.ts` | Single ASIN prices | amazon.com | Product page fetch | Price lookup utility |
| `opticsplanet-nightstick-prices.ts` | Nightstick prices | opticsplanet.com | Listing pagination + product JSON-LD via curl | Extracted model+price pairs, matched to DB |
| `grainger-nightstick-prices.ts` | Nightstick prices | grainger.com | Product pages via curl | Blocked by DataDome — yielded minimal data |
| `fetch-asin-prices.ts` | Multi-brand prices | Keepa API | Keepa product detail for discovered ASINs | Price fill for entries missing only price |

### Data Quality & Deduplication

| Script | Purpose | Result |
|--------|---------|--------|
| `cross-seller-dedup.ts` | Remove cross-retailer duplicates (same brand+model from multiple Shopify stores) | Normalized models, merged best data, transferred sources |
| `dedup-emisar.ts` | Normalize Emisar/Noctigon model names (D4V2 variants, killzone vs intl-outdoor) | D4V2/D4V2 Mule/D4V2 Ti/D4V2 Copper/D4V2 Brass all distinct; cross-seller dupes merged |
| `dedup-models.ts` | Case-insensitive brand+model dedup across entire DB | Merged 20+ pairs (Fenix PD36R PRO/Pro, etc.) |
| `clean-junk-models.ts` | Remove accessory/non-product entries by pattern matching | Reclassified 120+ entries (t-shirts, batteries, cables, mounts) |
| `analyze-gaps.ts` | Report missing field percentages per brand | Console output for prioritization |
| `extract-missing-fields.ts` | Regex extraction from raw_spec_text for runtime, length, weight, throw | Fully converged — yields 0 new results |
| `model-crossref.ts` | Cross-reference by brand+model prefix to fill missing fields | Fully converged — yields 0 new results |
| `parametrek-crossref.ts` | Fill missing fields from parametrek.com JSON export | One-time cross-reference for legacy data |

### Utilities

| Script | Purpose |
|--------|---------|
| `gen-og-frames.ts` | Generate Open Graph social preview images |
| `vite-cli.ts` | Bun wrapper for Vite dev server (Termux `process.platform` workaround) |
| `keepa-cron.sh` | Cron wrapper — lockfile + process guard, skips if another scraper running |

---

## 3. Build Pipeline & Outputs

### Build Process

**File**: `pipeline/build/build-torch-db.ts`
**CLI**: `bun ./pipeline/cli.ts build`

1. Load all flashlights from SQLite
2. Filter: exclude accessories, blogs, non-flashlights, batteries, chargers
3. Normalize colors to 20 canonical values
4. Extract 36 columns per entry
5. Build filter metadata (range, log-range, multi-select, mega-multi-select, boolean)
6. Compute sort indices
7. Map sprite sheet positions
8. Write `static/flashlights.now.json`

### Output Files

| File | Size | Description |
|------|------|-------------|
| `static/flashlights.now.json` | 8.0 MB | SPA dataset — 36 columns, all flashlight entries |
| `static/flashlights.sprites.webp` | 11 MB | Sprite sheet — 100×100px product thumbnails |
| `output/coverage-tracker.md` | 9.2 KB | Per-brand coverage matrix (top 50 brands) |
| `output/data-audit.md` | 18 KB | Full data quality audit |
| `output/pipeline-state.md` | 4.6 KB | Current pipeline progress state |
| `output/crawler-research.md` | 12 KB | Platform research notes per manufacturer |

### 36 Data Columns

| Column | Display | Unit | Type | Filterable |
|--------|---------|------|------|------------|
| model | Model | — | string | search |
| _pic | — | — | sprite | — |
| info | Info URLs | — | links | — |
| brand | Brand | — | mega-multi | any |
| type | Type | — | multi | any |
| led | LED | — | mega-multi | any |
| trueled | True LED | — | string | search |
| led_options | LED Options | — | multi | any |
| battery | Battery | — | mega-multi | any/all |
| wh | Watt-hours | Wh | range | — |
| _bat | — | — | computed | — |
| lumens | Lumens | lm | log-range | — |
| runtime | Runtime | h | log-range | — |
| blink | Strobe | — | boolean | — |
| levels | Levels | — | range | — |
| modes | Modes | — | multi | any |
| features | Features | — | multi | any/all |
| intensity | Intensity | cd | log-range | — |
| throw | Throw | m | log-range | — |
| led_color | LED Color | K | range | — |
| switch | Switch | — | multi | any |
| color | Color | — | multi | any |
| length | Length | mm | range | — |
| bezel_size | Bezel | mm | range | — |
| body_size | Body | mm | range | — |
| diam | Head Ø | mm | range | — |
| measurements | Dimensions | — | string | — |
| weight | Weight | g | range | — |
| material | Material | — | multi | any |
| impact | Impact | m | range | — |
| environment | IP Rating | — | multi | any |
| efficacy | Efficacy | lm/W | range | — |
| beam_angle | Beam Angle | ° | range | — |
| year | Year | — | range | — |
| _reviews | Reviews | — | links | — |
| purchase | Purchase | — | links | — |
| price | Price | $ | range | — |

---

## 4. Source Domain Index

All domains we have automated or one-off scraping for, sorted by entry count.

| # | Domain | Entries | Scraper Type | Data Acquired |
|---|--------|---------|-------------|---------------|
| 1 | batteryjunction.com | 12,007 | Shopify API (retailer) | price, model, images, description specs |
| 2 | maglite.com | 6,006 | Shopify API (manufacturer) | price, full specs from description |
| 3 | nealsgadgets.com | 4,273 | Shopify API (retailer) | price, model, images, description specs |
| 4 | goinggear.com | 3,535 | Shopify API (retailer) | price, model, images, description specs |
| 5 | killzoneflashlights.com | 2,743 | Shopify API (retailer) | price, LED variants, images |
| 6 | fenixlighting.com | 2,292 | Catalog crawler + Shopify | full specs, price, images |
| 7 | zeroair.org | 1,997 | Review scraper | lumens, throw, runtime, led, battery, length, weight, material, switch, CRI |
| 8 | 1lumen.com | 1,911 | Review scraper | lumens, throw, runtime, led, battery, length, weight, material, switch |
| 9 | flashlightgo.com | 1,738 | Shopify API (retailer) | price, model, images |
| 10 | nightstick.com | 1,635 | Shopify API + catalog crawler | price, specs, images |
| 11 | torchdirect.co.uk | 1,624 | Shopify API (retailer) | price, model, images |
| 12 | nitecorestore.com | 1,345 | Shopify API (manufacturer) | price, full specs |
| 13 | foursevens.com | 830 | Shopify API (manufacturer) | price, specs, images |
| 14 | keepa.com | 813 | Keepa API (Amazon data) | price, weight, dimensions, EAN/UPC, images |
| 15 | rovyvon.com | 807 | Shopify API (manufacturer) | price, specs, images |
| 16 | jlhawaii808.com | 783 | Shopify API (retailer) | price, LED variants (mostly accessories) |
| 17 | nextorch.com | 780 | Shopify API + catalog | price, specs, images |
| 18 | ledlenserusa.com | 734 | Shopify API (manufacturer) | price, specs, images |
| 19 | skylumen.com | 693 | Shopify API (retailer) | price, model (custom/modded — sparse specs) |
| 20 | wubenlight.com | 672 | Shopify API (manufacturer) | price, specs, images |
| 21 | acebeam.com | 640 | Catalog crawler | full specs, images |
| 22 | flashlightworld.ca | 608 | Shopify API (retailer) | price, model, images |
| 23 | malkoffdevices.com | 555 | Shopify API (manufacturer) | price, specs (sparse) |
| 24 | coastportland.com | 409 | Shopify API (manufacturer) | price, specs (JS-rendered main site) |
| 25 | shop.pelican.com | 390 | Shopify API (manufacturer) | price, specs, images |
| 26 | imalentstore.com | 386 | Shopify API (manufacturer) | price, specs, images |
| 27 | tgreviews.com | 385 | Review scraper | lumens, throw, runtime, led, battery, length, weight, material |
| 28 | intl-outdoor.com | 376 | Catalog crawler (Magento) | specs, LED options, configurable pricing |
| 29 | powertac.com | 362 | Shopify API (manufacturer) | price, specs, images |
| 30 | lumintop.com | 362 | Catalog + WooCommerce | specs, images (prices often $0) |
| 31 | eagtac.com | 327 | WooCommerce API | price, specs, images, attributes |
| 32 | fenix-store.com | 247 | Shopify API (retailer) | price, model, images |
| 33 | zebralight.com | 238 | Catalog crawler (Shift4Shop) | specs, images (throw at 10%) |
| 34 | pelican.com | 222 | Catalog crawler | full specs, JSON-LD, images |
| 35 | modlite.com | 201 | Shopify API (manufacturer) | price, specs, images |
| 36 | clouddefensive.com | 196 | Shopify API (manufacturer) | price, specs, images |
| 37 | armytek.com | 184 | Catalog crawler (CS-Cart) | full specs, IP rating, images |
| 38 | surefire.com | 167 | Catalog crawler (BigCommerce) | full specs, price, images |
| 39 | reylight.net | 161 | Shopify API (manufacturer) | price, specs (sparse — 6% valid) |
| 40 | klaruslight.com | 144 | Catalog crawler | full specs via structured divs |
| 41 | sammyshp.de | 137 | Review scraper | lumens, throw, runtime, led, battery, length, weight |
| 42 | budgetlightforum.com | 127 | BLF Discourse API | community-sourced specs from review threads |
| 43 | skilhunt.com | 89 | Catalog + WooCommerce | full specs, images |
| 44 | loopgear.com | 79 | Shopify API (manufacturer) | price, specs, images |
| 45 | zakreviews.com | 72 | Review scraper | lumens, throw, weight, runtime, led, battery, material, switch, CRI, CCT |
| 46 | lumintoponline.com | 55 | Shopify API (manufacturer) | price, specs, images |
| 47 | firefly-outdoor.com | 50 | Shopify API (manufacturer) | price, specs, images |
| 48 | jetbeamlight.com | 41 | WooCommerce API | price, specs, images |
| 49 | amazon.com | 1+ | One-off curl scripts | ASIN, price (Nightstick campaign) |
| 50 | opticsplanet.com | — | One-off script | Nightstick prices via JSON-LD |
| 51 | sofirnlight.com | — | Catalog crawler | specs (Cloudflare — uses curl) |
| 52 | wurkkos.com | — | Catalog crawler | specs (Cloudflare — uses curl) |
| 53 | thrunite.com | — | Catalog crawler | full specs from sitemap |

---

## Appendix: CLI Quick Reference

```bash
# Full pipeline
bun ./pipeline/cli.ts run-full          # shopify → woo → detail → raw-fetch → reviews → ai-parse → enrich → build → stats

# Individual stages
bun ./pipeline/cli.ts crawl [brand]     # Manufacturer website crawlers (16 brands)
bun ./pipeline/cli.ts shopify [brand]   # Shopify API crawlers (30 stores)
bun ./pipeline/cli.ts woocommerce [brand] # WooCommerce API crawlers (4 stores)
bun ./pipeline/cli.ts discover          # Keepa ASIN discovery
bun ./pipeline/cli.ts scrape [n]        # Keepa product detail (n batches of 20)
bun ./pipeline/cli.ts detail-scrape     # Per-entry page enrichment
bun ./pipeline/cli.ts raw-fetch         # Bulk page text for AI parsing
bun ./pipeline/cli.ts ai-parse [n]      # LLM spec extraction
bun ./pipeline/cli.ts reviews [site]    # Review site scraping
bun ./pipeline/cli.ts blf [n]           # BudgetLightForum enrichment
bun ./pipeline/cli.ts enrich            # Cross-ref + FL1 derivation
bun ./pipeline/cli.ts images            # Vision classification
bun ./pipeline/cli.ts build             # Build flashlights.now.json
bun ./pipeline/cli.ts stats             # Pipeline statistics
bun ./pipeline/cli.ts validate          # Validate required attributes

# One-off scripts
bun scripts/model-crossref.ts           # Brand+model prefix cross-reference
bun scripts/extract-missing-fields.ts   # Regex extraction from raw text
bun scripts/cross-seller-dedup.ts       # Cross-retailer dedup
bun scripts/dedup-emisar.ts             # Emisar/Noctigon model normalization
bun scripts/dedup-models.ts             # Case-insensitive dedup
bun scripts/clean-junk-models.ts        # Accessory reclassification
bun scripts/parametrek-crossref.ts      # Parametrek data cross-reference
```
