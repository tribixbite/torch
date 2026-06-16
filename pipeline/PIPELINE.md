# Torch — Flashlight Data Acquisition Pipeline

The pipeline aggregates flashlight specs from manufacturer stores, review sites, and
the Keepa (Amazon) API into a single canonical SQLite database, then builds the static
`flashlights.now.json` consumed by the SvelteKit SPA at [torch.directory](https://torch.directory).

Entry point: `bun run pipeline/cli.ts <command>` (see [Commands](#commands)).

**Current state** (live counts, 2026-06):

| Metric | Value |
|--------|-------|
| `flashlights` rows in DB | 18,434 |
| Entries in `flashlights.now.json` | 15,186 (after build-time accessory/blog/junk filter + `removed` drop) |
| JSON columns | 43 |
| `discovered_asins` (Keepa) | 19,593 total / 10,666 scraped |
| `raw_spec_text` rows | 36,792 |
| `amazon_price_checks` rows | 6,346 |
| Top brands | Fenix (1,711), Nitecore (1,698), Olight (1,391), Maglite (850), Acebeam (657), Nightstick (649) |

> The dataset is built in-house to replace the original parametrek.com dependency.
> Parametrek is now used **only** as validation ground-truth (`scripts/validate-vision-accuracy.ts`),
> never as a source for new enrichment — see [Data Integrity Policy](#data-integrity-policy).

---

## Data Integrity Policy

**STRICT RULE: NEVER fabricate, infer, estimate, guess, or default a data value.**
A wrong value is worse than no value. If a value is unknown, it is left **empty** — empty is honest.
This rule is enforced in code (see the banner at the top of `extraction/enrich.ts`) and in `CLAUDE.md`.

### Allowed data operations
- **Scraping** real published values from manufacturer/retailer/review pages.
- **ANSI FL1 derivation** — `throw_m = 2·√(intensity_cd)` and `intensity_cd = (throw_m/2)²`.
  This is the definitional relationship, not a guess. Implemented in `enrich.ts:deriveThrowIntensity`.
- **Observable extraction from the product title/model name** — the data is literally in the name,
  e.g. `Fenix PD36R 21700 XHP50 2800lm` → battery `21700`, LED `XHP50`, lumens `2800`. (`enrichFromTitle`)
- **Color keyword detection from model name** — `Rose Gold` → pink (observable fact). (`detectColorFromModelName`)
- **Type classification from product title** — observable fact.

### Forbidden (these produce incorrect data)
- Guessing **weight** from battery type
- Guessing **length** from battery type
- Guessing **lumens** from LED type
- Guessing **price** from brand averages
- Defaulting **material** to `aluminum`, **switch** to `side`, **battery** to `18650`, **features** to `["clip"]`
- Any heuristic, estimate, lookup table, or "reasonable average"

> **Historical note:** earlier revisions of `enrich.ts` did contain battery→weight/length and
> LED→lumens inference. That code was removed; the data-integrity banner now guards against
> reintroducing it. Any prior versions of this doc that described "Inference Rules" were stale.

### Required attributes (parametrek standard — 16 fields)
Defined in `schema/canonical.ts:REQUIRED_ATTRIBUTES`. An entry is "fully valid" when all are populated:

`model`, `brand`, `type`, `led`, `battery`, `lumens`, `throw_m`, `runtime_hours`,
`switch`, `features`, `color`, `material`, `length_mm`, `weight_g`, `price_usd`, `purchase_url`

Special cases in `hasRequiredAttributes()`:
- `throw_m` is **not required** for headlamps, lanterns, or models with "flood" in the name (diffuse/area beam).
- `intensity_cd` is **not** separately required — it is FL1-derivable from `throw_m`.

---

## Architecture

```
                          DISCOVERY / ACQUISITION
   ┌──────────────────────────────────────────────────────────────┐
   │ Shopify stores ───────→ shopify-crawler.ts                     │
   │ WooCommerce stores ───→ woocommerce-crawler.ts                 │
   │ Manufacturer sites ───→ catalog-crawler.ts                     │
   │ Keepa Product Finder ─→ keepa/scraper.ts (discover → scrape)   │
   └──────────────────────────────────────────────────────────────┘
                                  │  upsert
                                  ▼
                       ┌─────────────────────┐
                       │  store/db.ts         │   bun:sqlite
                       │  pipeline-data/db/   │   torch.sqlite (WAL)
                       │  torch.sqlite        │
                       └─────────────────────┘
                                  ▲
                       ENRICHMENT │ (fills only MISSING fields, real sources only)
   ┌──────────────────────────────────────────────────────────────┐
   │ detail-scraper.ts   — full product-page HTML for incomplete    │
   │ raw-text-fetcher.ts — bulk full-page text → raw_spec_text      │
   │ review-scraper.ts   — zakreviews/1lumen/zeroair/tg/sammyshp    │
   │ blf-scraper.ts      — BudgetLightForum threads                 │
   │ enrich.ts           — FL1 derivation + title/raw-text regex    │
   │ enrichment/ai-parser.ts — LLM extraction from raw_spec_text    │
   │ images/scrape-images.ts + vision-classifier.ts (Gemini)        │
   └──────────────────────────────────────────────────────────────┘
                                  │  build
                                  ▼
                  build/build-torch-db.ts
       (normalize → classify accessories/blogs/junk → drop 'removed')
                                  │
                                  ▼
                  static/flashlights.now.json  →  SvelteKit SPA
```

Two data planes share the DB:
1. **Spec data** — the canonical `flashlights` rows (built into the SPA dataset).
2. **Price/deal data** — Keepa price history + Amazon availability stored in `raw_spec_text`
   (categories `price_history`, `amazon_availability`) and `amazon_price_checks`; surfaced as
   sparklines, deal badges, and `static/deals.json`.

---

## Storage (SQLite)

Engine: Bun `bun:sqlite` (no native deps — Termux-safe). File: `pipeline-data/db/torch.sqlite`.
Connection PRAGMAs: `journal_mode = WAL`, `busy_timeout = 30000`, `foreign_keys = ON`.

> **Termux gotcha:** scripts using `better-sqlite3` (tsx/node) need `npm rebuild better-sqlite3`
> first; build scripts use `bun:sqlite` and run under `bun`. The two are **not** interchangeable.

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `flashlights` | Canonical product table (one row per brand+model+primary_led) | `id` PK; array fields stored as JSON TEXT (`type`,`led`,`battery`,`color`,`switch`,`features`,`material`,`lumens`,`runtime_hours`,…); scalars `throw_m`,`intensity_cd`,`length_mm`,`weight_g`,`price_usd`,`cri`,`cct`; `led_options` (configurable dropdowns); generated `primary_led`; `asin`/`ean`/`upc`; `updated_at` |
| `prices` | Per-retailer price snapshots | `flashlight_id`, `retailer`, `price`, `currency`, `url`, `checked_at` |
| `sources` | Provenance for every entry | `flashlight_id`, `source`, `url`, `scraped_at`, `confidence` (0–1) |
| `reviews` | Review refs + measured metrics | `flashlight_id`, `source`, `url`, `rating`, `measured_lumens`, `measured_cri/cct/tint_duv` |
| `discovered_asins` | Keepa ASIN discovery queue | `asin` PK, `brand`, `title`, `scraped` flag, `scraped_at` |
| `raw_spec_text` | Unparsed page text + price/availability blobs | `flashlight_id`, `source_url`, `category` (`full-page`/`specs`/`price_history`/`amazon_availability`/…), `text_content`, `scraped_at` |
| `amazon_price_checks` | Playwright Amazon price-check state | `asin` PK, `price_cents`, `status`, `title`, `checked_at`. **Created by `scripts/amazon-price-scraper.ts`, not by `db.ts`** |

Uniqueness: `idx_unique_entry UNIQUE(brand, model, primary_led)`; `sources` unique on `(flashlight_id, source, url)`.

---

## Data Sources

### Keepa (Amazon) — `keepa/`
- Base `https://api.keepa.com`, US domain id `1`. Key in `.env` as `KEEPA_API_KEY`. Budget ~60 tokens, refill 1/min.
- **Endpoints & cost:** `/token` (free balance); `/query` Product Finder (~11 tokens/query, reserved as `FINDER_TOKEN_COST`); `/product` (1 token/ASIN, `stats=90`); `/tracking` add (1 token; list/remove/notification/webhook = 0).
- Price CSV indices: `0`=Amazon, `1`=3P New, `16`=rating(×10), `17`=review count, `18`=Buy Box. Keepa→Unix: `(t+21564000)·60000`.
- **Flow:** `discoverAllBrands` (Product Finder over `config/brands.ts:BRANDS`) → `discovered_asins`; `scrapeUnscrapedAsins` (5/batch) → `/product` → canonical entry + price history + availability; `refreshStaleDeals` re-prices stale deal candidates (price only, no re-upsert).
- **Token strategy:** discover ASINs for free via scraping; spend Keepa tokens **only** on `/product` enrichment (per-condition prices + 90/180-day history), never `/search`.

### Shopify stores — `extraction/shopify-crawler.ts`
Public `/products.json?limit=250&page=N` (no key). `CRAWL_DELAY` 800 ms, 2 s between stores.
`isRetailer:true` → brand from each product's `vendor` field.

Brand stores: **Fenix, Olight, Nitecore, Rovyvon, Wuben, Imalent, Maglite, Ledlenser, Pelican, Fireflies, Nextorch, PowerTac, Nightstick, Malkoff, ReyLight, Lumintop, FourSevens, Modlite, CloudDefensive, Loop Gear, Coast.**
Retailer stores (`isRetailer`): **Killzone, NealGadgets, GoingGear, BatteryJunction, FlashlightGo, Skylumen, JLHawaii808, FlashlightWorldCA, FenixStore, TorchDirectUK.**
Notes: Fireflies/Coast custom domains block `/products.json` → crawl via myshopify/checkout host; several stores parse structured option tags (`Emitter_`, `Battery_`, Ledlenser `max-light-output-lumens-*`, etc.).

### WooCommerce stores — `extraction/woocommerce-crawler.ts`
Public Store API `/wp-json/wc/store/v1/products?per_page=100&page=N`. `CRAWL_DELAY` 800 ms.

| Brand | baseUrl | apiPath |
|-------|---------|---------|
| Skilhunt | skilhunt.com | default |
| Lumintop | lumintop.com | default |
| EagTac | eagtac.com | `/wp-json/wc/store/products` (no `v1`) |
| JETBeam | jetbeamlight.com | default |

### Manufacturer site crawlers — `extraction/catalog-crawler.ts`
`CRAWL_DELAY` 1500 ms; sitemap-based unless noted; Cloudflare-walled sites use a curl fetch.

| Brand | Platform / strategy |
|-------|---------------------|
| Fenix, Olight, Nitecore, Acebeam, ThruNite, Streamlight, Skilhunt, Lumintop | sitemap.xml + category pages |
| Wurkkos | UeeShop — paginate `/collections/*?page=1..5` (sitemap dead) |
| Sofirn | Shoplazza — paginate `/collections/*?page=1..10` (sitemap CF-blocked) |
| Klarus | Custom PHP — numeric item IDs `/item/{60..160}.html` |
| Emisar / Noctigon | Magento 1.x (intl-outdoor.com) — 5 category pages, `<select>` LED/color dropdowns, brand resolved per-product |
| SureFire | BigCommerce — paginate category pages, `<dl>/<dt>/<dd>` spec tables |
| Armytek | CS-Cart — 2-level: families → product pages |
| Zebralight | Shift4Shop/3dcart — `_p_<id>.html` URLs |
| Pelican | Cloudflare → curl; `product-specs-table` + ANSI FL1 table; purchase URL → shop.pelican.com |

### Review sites — `extraction/review-scraper.ts`
Each only **fills missing fields on existing entries** (never overwrites, never creates). `CRAWL_DELAY` 1500 ms.

| Site key | URL | Provides |
|----------|-----|----------|
| `zakreviews` | zakreviews.com | battery, LED, lumens, throw, candela, length, dia, weight, CRI/CCT, price, charging, IP, switch, material |
| `1lumen` | 1lumen.com | LED, lumens, beam distance/intensity, battery, switch, IP, charging, length, weight, dimensions |
| `zeroair` | zeroair.org | emitter, price, cell, switch, lumens, throw, candela, charge port, dimensions, weight, material |
| `tgreviews` | tgreviews.com | length/bezel/body/weight, lumens/candela/throw, LED, battery, switch, price, material, charging |
| `sammyshp` | sammyshp.de (German) | length/bezel/body/weight, lumens, candela, throw, battery, LED, switch |

### BudgetLightForum — `extraction/blf-scraper.ts`
Discourse JSON API at `budgetlightforum.com` (`/search.json`, `/t/<id>.json`). `CRAWL_DELAY` 3000 ms with 429 backoff (BLF rate-limits ~1 req/2 s). Scores entries by missing-field count, searches `"<brand> <model> review"`, parses first ~10 posts, fills only missing fields (confidence 0.7, source `blf:review`).

### Amazon price scraping — `scripts/amazon-price-scraper.ts` (Playwright)
Standalone Playwright over `amazon.com/dp/{ASIN}`, selector `.a-price .a-offscreen`. Requires `DISPLAY=:1` (Xvfb/VNC), `bun` (reports `linux`), `--no-sandbox`. State in `amazon_price_checks` (shared by cron + manual). ~72% hit rate on available products; 3-consecutive-CAPTCHA abort, 3 s delay.

### Shared utilities
- `extraction/manufacturer-scraper.ts` — `fetchPage` (Android-Chrome UA, 15 s timeout, 2 retries), `htmlToText`, and the regex `extractSpecsFromText` used by the catalog/BLF/review scrapers.
- `extraction/raw-text-fetcher.ts` — bulk full-page text fetcher (cap 15,000 chars) for entries that have a source URL but still fail `hasRequiredAttributes`; groups by domain, 3 s delay, 429 backoff, **skips a domain after 10 consecutive failures** (the only deny behavior, applied dynamically).

---

## Commands

`bun run pipeline/cli.ts <command>`:

| Command | Action |
|---------|--------|
| `discover` | Keepa Product Finder ASIN discovery for all `BRANDS` |
| `scrape [n] [--brand=X]` | Scrape `n` batches (5 ASINs each) of unscraped ASINs via `/product` |
| `refresh [n]` | Re-price `n` stale deal candidates (price/availability only) |
| `tracking [list\|setup [n]\|notifications\|clear]` | Manage Keepa price-drop tracking (0 tokens except `setup`) |
| `shopify [brand]` | Crawl Shopify stores (JSON API) |
| `woocommerce [brand]` | Crawl WooCommerce stores |
| `crawl [brand]` | Crawl manufacturer websites |
| `detail-scrape [n] [--brand=X] [--force]` | Scrape full product pages for incomplete entries |
| `raw-fetch [n] [--domain=X] [--dry-run]` | Bulk-fetch full page text → `raw_spec_text` |
| `reviews [site]` | Scrape review sites |
| `blf [n]` | Enrich from BudgetLightForum (default 200 entries, minMissing 3) |
| `ai-parse [n] [--dry-run] [--brand=X] [--min-missing=N] [--source=reviews\|retailers\|manufacturers]` | LLM extraction from `raw_spec_text` (OpenRouter; needs `OPENROUTER_API_KEY`) |
| `enrich [--scrape]` | FL1 derivation + title/raw-text extraction (+ optional manufacturer scrape) |
| `images` | Download/optimize images + build sprite sheet |
| `cleanup` | Remove duplicates + imageless entries |
| `build` | Build `static/flashlights.now.json` |
| `stats` / `validate` / `verify-all` / `check-dupes` / `search <q>` | Reporting & QA |
| `run` | shopify → woo → detail-scrape → enrich → build → verify |
| `run-full [--shadow]` | shopify → woo → detail → raw-fetch → reviews → ai-parse → enrich → build → stats |

### AI parser — `enrichment/ai-parser.ts`
LLM extraction from `raw_spec_text` via OpenRouter (~$0.80/Mtok in, $4/Mtok out at current settings).
`MAX_INPUT_CHARS` 8,000 (handles boilerplate-heavy pages). Strips platform boilerplate
(WooCommerce nav, CS-Cart, Magento). Fills only missing fields. Source-filterable
(`reviews`/`retailers`/`manufacturers`). **Status: exhausted** — recent passes yield ~0 enrichments;
remaining gaps are structural (brands simply don't publish the data).

---

## Enrichment operations (allowed only)

`enrich.ts` (per [Data Integrity Policy](#data-integrity-policy)):
1. `deriveThrowIntensity` — ANSI FL1 (`throw_m ≥ 2` guard to avoid cd=0 oscillation).
2. `enrichFromTitle` — lumens/LED/battery/throw (m/ft/yd)/switch/material from the model name.
3. `enrichFromRawSpecText` — switch/material/runtime/features/color/LED/length from `raw_spec_text` (regex over real page text).
4. `detectColorFromModelName` — color keywords + suffix codes (`-BK`→black).
5. `enrichFromManufacturer` (opt-in `--scrape`) — fetch known brand URL patterns, merge real specs.

Cross-reference & cleanup scripts (`scripts/`):
- `model-crossref.ts` — propagate fields between same brand+model entries (+ FL1 derivation).
- `extract-missing-fields.ts` — batched regex re-extraction from `raw_spec_text` (`--smol` for Termux OOM).
- `clear-bogus-specs.ts` — clears throw ≤10 m, intensity <25 cd, lengths <10 mm / >1 m, weights >5 kg, lumens model-number artifacts (then FL1-re-derives where possible).
- `fix-fl1-mismatches.ts`, `fix-weight-battery-mismatches.ts`, `verify-specs.ts` — consistency repair/audit.
- `cross-seller-dedup.ts`, `dedup-models.ts`, `dedup-emisar.ts`, `merge-dupes.ts` — dedup.

---

## Normalization layer — `normalization/`

Applied at **build time** (`build-torch-db.ts`) and via one-shot DB migrations (`scripts/normalize-*.ts`).
Never merges meaningfully distinct values (LED generations `.2`/`.3`, `HD` vs `HI`, die sizes, `-W` variants).

| Module | Canonicalization | Tests |
|--------|------------------|-------|
| `led-normalizer.ts` | 904 strings → 401 canonical (Cree/Luminus/Nichia/Osram families standardized) | 107 |
| `battery-normalizer.ts` | 647 → ~94 (strip `1x` prefix, IEC names, chemistry merge, multi-cell expansion `2x18650`→`[18650, 2x18650]`) | 166 |
| `material-normalizer.ts` | 220 → 24 (aluminum/polymer/rubber families) | 79 |
| `switch-normalizer.ts` | 132 → 22 (clicky/twisty/side/tail/sensor) | 70 |
| `features-normalizer.ts` | 259 → 182 (clip/lanyard/IP→IPX/etc.) | 60 |

Brand normalization: `store/brand-aliases.ts` — `BRAND_MAP` (108 aliases, e.g. BAYCO→Nightstick,
led lenser→Ledlenser, 4sevens→FourSevens) + `TYPO_MAP` (38 fuzzy fixes). `normalizeBrandName` →
`BRAND_MAP` → `TYPO_MAP` → title-case fallback. `classifySourceUrl` buckets URLs into
reviews/retailers/manufacturers.

---

## Image & Vision pipeline

- `images/scrape-images.ts` — download → optimize (webp thumbs in `pipeline-data/images/thumbs/`) →
  build sprite sheet + `pipeline-data/sprite-metadata.json` (`--download-only` / `--skip-download` modes).
- Image URL ordering (`scripts/fix-image-ordering.ts`): manufacturer > Shopify CDN > other > Amazon;
  animated GIFs demoted to the end.
- **Vision classification** (`extraction/vision-grid-builder.ts` + `vision-classifier.ts`): 5×5 grids of
  100×100 thumbnails → Gemini 2.0 Flash (`GEMINI_API_KEY`) to fill **color** and **switch** where missing.
  Accuracy vs parametrek ground truth: color 56.5% exact (white-bg bias), switch 21.1% exact (taxonomy mismatch).
  ~41% of classified entries are non-flashlights (accessories/batteries).

---

## Build step — `build/build-torch-db.ts`

Reads `flashlights` → writes `static/flashlights.now.json` (`{head,disp,opts,mode,unit,sort,srch,cvis,link,data,sprite,help,note}`, 43 columns). Steps:
1. **Normalize** every array column (LED/battery/material/switch/features/brand) + colors → ~20 canonical (default `black` only inside the color map's last-resort).
2. **Classify accessories** (`ACCESSORY_PATTERNS`, battery/cell patterns, gated by an `IS_FLASHLIGHT` override) → `type=['accessory']` (kept in DB, filterable).
3. **Classify blogs/non-product pages** (`/blogs/`, `/news/`, category/landing/marketing pages, article-title models) → `type=['blog']`.
4. **Garbage/junk brand filter** (`GARBAGE_BRAND_RE` "lumens lighthouse" artifacts; `JUNK_BRANDS` ~40 charger-seller/spam brands) → `['accessory']`.
5. **Drop** rows whose `type` contains `'removed'` (dedup artifacts). Accessories/blogs are retained and filterable.
6. `completeness` 0–16 score; `has_mfg_url` via `KNOWN_MFG_BRANDS` (~29) + `RETAILER_DOMAINS` regex; filter-option ordering via `BATTERY_PRIORITY`/`SWITCH_PRIORITY`/`MAT_PRIORITY`.

The SPA (SvelteKit adapter-static SPA, Svelte 5 runes, Tailwind v4, Web-Worker filtering) loads this JSON +
the sprite sheet. `scripts/deals-feed.ts` separately writes `static/deals.json` (top 100 deals, OOS/sanity/accessory-filtered).

---

## Continuous automation (cron)

| Script | Schedule (header) | Action |
|--------|-------------------|--------|
| `scripts/keepa-cron.sh` | `*/5 * * * *` | `flock`-guarded. If unscraped ASINs > 0 → `scrape 1`; else → `refresh 5`. Post-scrape: thumbnails, `extract-missing-fields --smol`, `model-crossref`, `deals-feed --smol`, `tracking notifications`. `tracking setup 5` only when fully scraped (token budget). If `$DISPLAY` set → Amazon price scrape 10/cycle. |
| `scripts/vision-cron.sh` | `0 * * * *` | Lockfile (stale > 30 min cleared). Needs `GEMINI_API_KEY`. grid-build → classify → rebuild sprite only if > 50 new thumbnails. |
| `scripts/gpus-keepa-cron.sh` | `*/30 * * * *` | `flock`-guarded GPU-deals seeder (`gpus-seed-keepa.ts`); refreshes seed ASINs + tops up via `/search`. Belongs to the `/gpus` feature. |

> **Current crontab status:** the torch + gpus cron entries are **DISABLED (commented out, dated
> 2026-06-05 "token investigation")**, and `vision-cron.sh` has no live crontab entry (its schedule
> lives only in the script header). In practice **no torch automation is scheduled right now** — run
> the cron scripts manually, or re-enable them in `crontab -e`. The crontab sets `DISPLAY=:1` at the top.

---

## Data quality & known gaps

`scripts/audit-data-quality.ts` → `output/data-audit.md`; `scripts/verify-specs.ts` (bounds + FL1) → same.
Coverage tracker: `output/coverage-tracker.md`. Session-by-session log: `output/pipeline-state.md`.

**Structural gaps** (extraction has converged; these need *new sources*, not more passes):
- **LED** (~1,388 missing) — Nightstick/Coast/Pelican/Energizer don't publish chip names.
- **Runtime** (~1,006) — Chinese brands without ANSI data (Lumintop, Mateminco, Emisar).
- **Length** (~797) — not on product pages; would need review sites / spec sheets.
- **Throw** (~701) — many products don't publish ANSI throw.

**Fields never available from store/Woo APIs (≈0% populated):** `wh`, `efficacy`, `beam_angle`, `year`;
`bezel_mm`/`body_mm` rare (~1%).

**Honesty rules applied:** no real flashlight has ANSI throw ≤10 m (those were parsing artifacts, cleared);
throw coverage is reported *after* clearing bogus values, not inflated.

---

## Platform notes (Termux / Android)

- **Run `bun`, not `npm`/`npx`.** Build scripts use `bun:sqlite`; tsx scripts that use
  `better-sqlite3` need `npm rebuild better-sqlite3` first.
- **Background bun processes: use the harness `run_in_background`, not shell `&`** — piped output is buffered; check the DB directly for progress.
- **Playwright**: must run under `bun` (reports `linux`), needs `DISPLAY=:1`, `--no-sandbox`, `--disable-gpu`;
  `playwright-core` is imported by absolute path from the global Bun install.
- **Vite dev/build** goes through `scripts/vite-cli.ts` to bypass Node's `process.platform === 'android'`
  breaking lightningcss/rollup/esbuild native resolution.
- **`grep` shell wrapper is broken on this device** (injects `-G`) — use ripgrep / the Read tool / dedicated search tools instead.
- **Rate limits:** BLF ~1 req/2 s (use ≥3 s + 429 retry); Shopify stores share IP-level 429 limits;
  Cloudflare-walled sites (Pelican, Sofirn, Wurkkos) need curl or headless browser.

---

## File map

```
pipeline/
├── cli.ts                       # command dispatcher (entry point)
├── schema/canonical.ts          # Zod schema, REQUIRED_ATTRIBUTES, hasRequiredAttributes, generateId
├── config/brands.ts             # Keepa discovery brand list + search terms
├── store/
│   ├── db.ts                    # bun:sqlite schema + CRUD
│   └── brand-aliases.ts         # BRAND_MAP / TYPO_MAP / domain classification
├── keepa/{client.ts,scraper.ts} # Keepa API client + discover/scrape/refresh
├── extraction/
│   ├── shopify-crawler.ts       # SHOPIFY_STORES
│   ├── woocommerce-crawler.ts   # WOOCOMMERCE_STORES
│   ├── catalog-crawler.ts       # manufacturer site CRAWLERS
│   ├── review-scraper.ts        # REVIEW_SITES
│   ├── blf-scraper.ts           # BudgetLightForum
│   ├── detail-scraper.ts        # full product-page HTML
│   ├── raw-text-fetcher.ts      # bulk full-page text → raw_spec_text
│   ├── manufacturer-scraper.ts  # fetchPage / htmlToText / extractSpecsFromText
│   ├── enrich.ts                # FL1 + title/raw-text/color enrichment (data-integrity guarded)
│   └── vision-{grid-builder,classifier}.ts
├── enrichment/ai-parser.ts      # OpenRouter LLM extraction
├── normalization/*-normalizer.ts # led/battery/material/switch/features
├── images/scrape-images.ts      # download/optimize/sprite
└── build/build-torch-db.ts      # → static/flashlights.now.json

scripts/                         # crons, dedup, audit, fixers, Amazon/Keepa helpers
output/                          # pipeline-state.md, data-audit.md, coverage-tracker.md, roadmap.md
pipeline-data/db/torch.sqlite    # canonical DB (WAL)
static/flashlights.now.json      # built SPA dataset
```
