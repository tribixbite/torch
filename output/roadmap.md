# Torch Project Roadmap

Last updated: 2026-04-05

Current state: 17,644 entries in DB, ~14,396 flashlights after build-time accessory filter and dedup. 4,172 entries (29.7%) at full 16/16 completeness. 5 normalizers complete. AI parser and vision pipeline fully converged.

---

## Priority 1 — Bugs / Broken

### ~~Lumen slider displays `{si}lm` for min/max labels~~ FIXED
- Fixed in RangeFilter.svelte and FilterPills.svelte — detects `{si}` prefix, uses `smartFixed(value, '{si}')` + suffix

### 146 remaining spec verification issues
- 85 FL1 throw/intensity mismatches — throw and intensity_cd are inconsistent per ANSI FL1 formula `cd = (throw / 2)^2`
- 49 entries with suspiciously low weight for battery type (e.g., 18650-powered light weighing <50g)
- 5 entries with throw >5km — 3 are LEP lights (legitimate), 2 are Skylumen custom builds (needs review)
- 2 entries with weight >5kg — both tripod-mounted lights (legitimate)
- 1 entry with runtime >5,000h (Armytek Barracuda Pro — encoding artifact in runtime array)
- 3 remaining duplicate groups (Nextorch Saint Torch 31, Nitecore MT21C, Nitecore TM28 — LED suffix variants)
- 20 entries with lumens >100k — mostly legitimate (Imalent MS32/SR32) but includes charger/accessory listings that inherit parent product lumens

---

## Priority 2 — Data Enrichment (Structural Gaps)

These gaps are structural — the data does not exist on scraped product pages. New sources are required.

### Coverage gaps (17,644 entries)
| Field | Missing | Coverage | Notes |
|-------|---------|----------|-------|
| LED | 6,600 | 62.6% | Brands like Nightstick, Coast, Pelican, Energizer do not publish LED chip names |
| throw_m | 6,481 | 63.3% | Many products do not publish throw distance |
| runtime | 5,511 | 68.8% | Chinese brands (Lumintop, Mateminco, Emisar) lack ANSI runtime data |
| length_mm | 5,240 | 70.3% | Not typically on product pages, needs review site scraping |
| switch | 4,425 | 74.9% | Often omitted from product listings |
| battery | 4,397 | 75.1% | Some brands list only "rechargeable" |
| lumens | 3,846 | 78.2% | Older/discontinued products |

### New data sources needed
- **Review sites**: zeroair.org, 1lumen.com, candlepowerforums.com for ANSI FL1-tested specs (runtime, throw, lumens measured independently)
- **BLF/Reddit threads**: community-measured specs for enthusiast brands (Convoy, Emisar, Noctigon)

### Blocked scrapers
- **Petzl** (80 entries, 84% valid): Salesforce/Visualforce JS-rendered pages. Needs headless browser via Playwright MCP. Length at 86% is the main gap.
- **Sofirn**: Shoplazza platform, Cloudflare blocks all requests (bun fetch and curl). Needs headless browser or API workaround.
- **Wurkkos**: UeeShop platform, Cloudflare JS challenge blocks product pages (collections page works). 48 products scraped but detail pages inaccessible.
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
- Verify sort is wired up and functional across all columns (lumens, throw, price, weight, runtime, completeness)
- Ensure sort state persists in URL params

### Filter sidebar mobile UX
- Touch targets for filter checkboxes may be too small on mobile
- Sidebar scrolling behavior on long filter lists (e.g., 91 battery options)
- Search box within multi-select filters — verify keyboard behavior on mobile

### Image lazy loading
- Sprite sheet is loaded eagerly — consider intersection observer for off-screen cards
- 314 entries missing images entirely — show a proper placeholder, not a broken image

### ~~Empty labels rendering with no values~~ FIXED
- Fixed in FlashlightCard.svelte — three-layer fix: `shouldShowDetail()` redundant empty array check for Svelte 5 proxied arrays, `formatValue()` returns '?' for empty/filtered arrays, template-level guard prevents rendering labels when formatted value is empty

### Table view
- Verify array fields display correctly after `isArrayLike()` fix (Svelte 5 proxy issue)
- `formatWithUnit()` null-safety guards — same `{si}` prefix bug as range filter may affect table cells

### Search enhancements
- Full-text search across model names
- Consider fuzzy matching for typos

### Completeness score
- Add explanation tooltip showing which of the 16 attributes are present/missing for each entry
- Currently shows `8/16` but user cannot see which fields are filled

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

### Won't Fix / Deprecated
- **Parametrek crossref** — deprecated, validation only. Removed from keepa-cron.sh. Existing data kept as-is (cannot distinguish parametrek-sourced from scraped).
- **AI parser** — exhausted. 0 enrichments from final 125 entries. All extractable data has been captured.
- **Skylumen full coverage** — 127 custom/modded entries, 0% valid. No runtime or length data exists for one-off builds. Low ROI.
- **Keepa raw text scraping** — Keepa pages are empty price tracker widgets with no spec data.
