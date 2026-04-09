# Torch Project Roadmap

Last updated: 2026-04-07

Current state: 17,644 entries in DB, ~14,393 flashlights after build-time accessory filter and dedup. 733 unique brands (0 case dupes). 5 normalizers complete. AI parser and vision pipeline fully converged. Spec verification: 12 known legitimate issues (was 146).

---

## Priority 1 — Bugs / Broken

### ~~Lumen slider displays `{si}lm` for min/max labels~~ FIXED
- Fixed in RangeFilter.svelte and FilterPills.svelte — detects `{si}` prefix, uses `smartFixed(value, '{si}')` + suffix

### ~~Empty field labels in expanded cards~~ FIXED
- "LED color:", "switch:" etc rendered with no value when data was null/empty array
- 3-layer fix: shouldShowDetail() hasValue check, formatValue() empty-array guard, template `{#if formatted.trim()}` guard

### ~~146 remaining spec verification issues~~ RESOLVED → 12 known legitimate
- ~~85 FL1 throw/intensity mismatches~~ FIXED — 82 re-derived via FL1 formula (trust cd → derive throw for 80, trust throw → derive cd for 2)
- ~~49 entries with suspiciously low weight for battery type~~ FIXED — 32 accessories battery cleared, 17 bogus weights cleared
- ~~3 remaining duplicate groups~~ FIXED — MT21C merged (4→1), Saint Torch 31 length fixed (28.5→285mm)
- 5 entries with throw >5km — 3 LEP lights + 2 Skylumen custom (all legitimate)
- 2 entries with weight >5kg — tripod-mounted lights (legitimate)
- 1 entry with runtime >10,000h, 2 entries with lumens >200k, 2 with price >$5000 — all legitimate

---

## Priority 2 — Data Enrichment (Structural Gaps)

These gaps are structural — the data does not exist on scraped product pages. New sources are required.

### Coverage gaps (14,013 active entries)
| Field | Missing | Coverage | Notes |
|-------|---------|----------|-------|
| LED | 5,874 | 58.1% | Brands like Nightstick, Coast, Pelican, Energizer do not publish LED chip names |
| throw_m | 5,961 | 57.5% | Many products do not publish throw distance |
| runtime | 5,087 | 63.7% | Chinese brands (Lumintop, Mateminco, Emisar) lack ANSI runtime data |
| length_mm | 4,706 | 66.4% | Not typically on product pages, needs review site scraping |
| switch | 4,309 | 69.2% | Often omitted from product listings |
| battery | 4,275 | 69.5% | Some brands list only "rechargeable" |
| lumens | 3,716 | 73.5% | Older/discontinued products |
| material | 2,943 | 79.0% | |
| features | 2,788 | 80.1% | |
| weight_g | 2,490 | 82.2% | |
| price_usd | 2,207 | 84.3% | |
| color | 1,334 | 90.5% | |

### New data sources needed
- **Review sites**: zeroair.org, 1lumen.com, candlepowerforums.com for ANSI FL1-tested specs (runtime, throw, lumens measured independently)
- **BLF/Reddit threads**: community-measured specs for enthusiast brands (Convoy, Emisar, Noctigon)

### Blocked scrapers
- ~~**Petzl**~~ SCRAPED — petzl.com is server-rendered Salesforce (no Cloudflare). 59 fields updated. LED/length/material NOT published by Petzl.
- ~~**Sofirn**~~ PARTIALLY SCRAPED — sofirnlight.com accessible via Playwright (Shoplazza, JS-rendered). 15 throw values recovered. Many products still don't publish throw.
- ~~**Wurkkos**~~ PARTIALLY SCRAPED — wurkkos.com accessible via plain fetch. 11 throw values. flashlightgo.com Shopify JSON API as fallback.
- **Pelican** (169 entries): Cloudflare blocks bun fetch. Curl workaround via `Bun.spawnSync(['curl', ...])` works but is fragile.

### Brand-specific gaps
- **Nightstick** (403 entries, 38% valid): 83 entries need only price. B2B pricing model means Amazon is the only price source. Keepa API token-limited (60/hour, 1/min refill).
- **ReyLight** (64 entries, 6% valid): Sparse specs across the board — lumens 31%, throw 38%, runtime 44%, length 52%. Needs full re-scrape from manufacturer site.
- **Zebralight** (50 entries, 10% valid): throw_m at 10% despite all other fields >94%. FL1 derivation from intensity_cd should recover most.
- **Skylumen** (127 entries, 0% valid): Custom/modded lights with no runtime or length published. Low ROI — these are one-off builds.
- **Coast** (186 entries, 48% valid): LED at 65% — JS-rendered pages need headless extraction.
- **Tank007** (51 entries, 29% valid): Lumens at 49%, throw at 59%. Manufacturer site needs scraping.

### Near-valid bottleneck (entries missing exactly 1 attribute)
| Missing Attr | Count | % of Near-Valid |
|-------------|-------|-----------------|
| runtime | 407 | 31.8% |
| length | 358 | 28.0% |
| throw | 235 | 18.4% |
| color | 151 | 11.8% |
| led | 125 | 9.8% |
| price | 97 | 7.6% |

---

## Priority 3 — UI/UX Improvements

### Sort dropdown
- Sort is wired up and functional — persists in URL params via `urlState.syncToUrl()`
- All sortable columns work: lumens, throw, price, weight, runtime, completeness, length, etc.

### ~~Filter sidebar mobile UX~~ IMPROVED
- Added min 36px touch targets for filter chips, boolean yes/no buttons, and close buttons on mobile
- Filter option lists now scroll smoothly with `-webkit-overflow-scrolling: touch` and max-height cap
- Search box within multi-select filters already works — in-filter search shows for >15 options

### Image lazy loading
- Sprite sheet is loaded eagerly — single 18MB WebP transfer, cached by service worker
- ~~314 entries missing images entirely~~ FIXED — SVG flashlight silhouette placeholder replaces "no img" text

### ~~Empty labels rendering with no values~~ FIXED
- Fixed in FlashlightCard.svelte — three-layer fix: `shouldShowDetail()` redundant empty array check for Svelte 5 proxied arrays, `formatValue()` returns '?' for empty/filtered arrays, template-level guard prevents rendering labels when formatted value is empty

### Table view
- Verify array fields display correctly after `isArrayLike()` fix (Svelte 5 proxy issue)
- `formatWithUnit()` null-safety guards — same `{si}` prefix bug as range filter may affect table cells

### ~~Search enhancements~~ IMPROVED
- Full-text search across all searchable columns (model, brand, LED, battery, switch, features, color, material)
- Fuzzy matching added: multi-word AND logic, 1 typo tolerance per 4 characters (e.g., "fenx pd36" finds Fenix PD36R)

### ~~Completeness score~~ DONE
- Expanded card view now shows completeness breakdown: `data quality: 12/16 missing: runtime, length, throw, switch`
- Lists exactly which of the 16 required attributes are missing per entry

---

## Priority 4 — Data Quality

### Aggressive dedup
- TM12K-style problem: multiple seller listings of the same product creating duplicate entries (e.g., 9 entries for Nitecore TM12K from different Amazon sellers)
- 3 known duplicate groups still in DB (Nextorch Saint Torch 31, Nitecore MT21C, Nitecore TM28)
- Charger/accessory listings that inherit parent product specs (Imalent MS32 charger showing 200k lumens)

### No-name brands
- 616 brands (3,079 entries) with no manufacturer URL — many are Amazon-only white-label brands
- Average completeness 5-7/16 for these brands
- Options: filter out by default (already partially done via completeness >= 8 default), or bulk-remove the worst offenders

### Missing images
- 314 entries (2.2%) without any image URL
- Some may have images available on manufacturer sites that were not captured during scraping

### FL1 mismatches
- 85 entries where throw and intensity_cd are inconsistent per ANSI FL1 formula
- Needs manual review — either throw or intensity is wrong, cannot determine which programmatically

### Suspiciously low weight
- 49 entries with weight values too low for their battery type
- Likely parsing artifacts (e.g., weight in oz parsed as grams, or partial weight values)

---

## Priority 5 — Infrastructure

### GitHub Actions Node.js deprecation
- Node.js 20 deprecation warning in CI — upgrade to Node.js 24

### Price freshness
- Keepa cron running (`scripts/keepa-cron.sh`) at 5 ASINs per 5-minute interval
- Token-limited: 60 tokens/hour, 1/min refill rate
- Consider alternative price sources for non-Amazon products

### Vision pipeline accuracy
- Color: 56.5% exact match vs parametrek ground truth
- Switch: 21.1% exact match (taxonomy mismatch — parametrek uses finer-grained categories)
- Known bias: white-background product images classified as "white" body color
- Diminishing returns — further vision improvements require training data or better taxonomy alignment

### Build system
- `better-sqlite3` vs `bun:sqlite` split: pipeline scripts use `better-sqlite3` (need `tsx`), build scripts use `bun:sqlite` (need `bun`). The two are not interchangeable.
- `npm rebuild better-sqlite3` required before `tsx` scripts work on Termux
- Termux/Android platform quirks: esbuild/rollup/lightningcss symlink workarounds in `postinstall.sh`

### Monitoring
- No alerting for scraper failures or data quality regressions
- `scripts/verify-specs.ts` and `scripts/audit-data-quality.ts` run manually — could be automated in CI

---

## Done / Won't Fix

### Completed
- **5 normalizers** — all complete with test suites:
  - LED: 904 unique strings to 401 canonical (107 test cases)
  - Battery: 647 to 94 unique values (166 test cases)
  - Material: 220 to 24 canonical (79 test cases)
  - Switch: 132 to 22 canonical (70 test cases)
  - Features: 259 to 182 canonical (60 test cases)
- **48-brand enrichment sweep** — 3 passes, ~1,900 scraped, ~489 enriched, ~255 FL1 derivations
- **Vision classifier** — Gemini 2.0 Flash, 5x5 grids, color + switch detection
- **Sprite system** — 17,051 tiles, 96.7% coverage
- **Cross-seller dedup** — zero remaining brand+model duplicates
- **Bogus spec cleanup** — 1,638 bogus throw values, 572 bogus lengths/weights cleared
- **Default quality filters** — completeness >= 8/16 and no accessories shown by default
- **Battery filter ordering** — popularity-weighted (18650, 21700, 14500 first)
- **Svelte 5 proxy fixes** — `isArrayLike()` for `Array.isArray()` failures, `formatWithUnit()` null-safety
- **Playwright MCP Termux fix** — forced headless on Android, stale lock cleanup
- **Brand dedup** — ~30 brand alias mappings, LUMENS LIGHT HOUSE garbage removed, prefix stripping. 772→~700 unique brands
- **JSON size reduction** — dropped redundant `inc` sort arrays (15% savings), removed eager inc generation from columns.ts
- **Performance optimizations** — `structuredClone()` instead of JSON round-trip, cached `defaultOrder` array in worker, lazy inc sort derivation
- **P3 UI/UX batch** — completeness tooltip, SVG image placeholder, mobile touch targets, fuzzy multi-word search

### Won't Fix / Deprecated
- **Parametrek crossref** — deprecated, validation only. Removed from keepa-cron.sh. Existing data kept as-is (cannot distinguish parametrek-sourced from scraped).
- **AI parser** — exhausted. 0 enrichments from final 125 entries. All extractable data has been captured.
- **Skylumen full coverage** — 127 custom/modded entries, 0% valid. No runtime or length data exists for one-off builds. Low ROI.
- **Keepa raw text scraping** — Keepa pages are empty price tracker widgets with no spec data.
