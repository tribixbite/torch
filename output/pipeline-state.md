# Pipeline State — 2026-03-17

## Current Status: Sprite fix + enrichment Phase 5 + Pelican scrape complete

### Coverage (10,775 entries)
| Field | Current | Previous (3/16) | Δ |
|-------|---------|-----------------|---|
| lumens | 80.6% | 80.3% | +0.3% |
| throw_m | 63.9% | 63.2% | +0.7% |
| runtime | 63.1% | 61.1% | +2.0% |
| length_mm | 60.1% | 59.3% | +0.8% |
| weight_g | 90.5% | 90.8% | -0.3% |
| led | 54.4% | 54.2% | +0.2% |
| battery | 81.3% | 81.4% | -0.1% |
| switch | 72.5% | 66.7% | +5.8% |
| material | 78.6% | 68.8% | +9.8% |
| color | 56.2% | 55.5% | +0.7% |
| features | 90.6% | 82.5% | +8.1% |
| price | 93.5% | 93.9% | -0.4% |
| purchase_url | 90.8% | n/a | — |

Fully valid: **1,327 entries (12.3%)** — up from 1,252 (11.7%)

### Session 2 Work (2026-03-17)

#### Fix: Sprite ID-based mapping
- Rebuilt sprite with `idToSprite` mapping in metadata (10,281 images)
- Fixed image mismatch issue on live site — images now correctly map by flashlight ID
- Grid: 102×101, 10,200×10,100px, 9.76 MB sprite

#### Fix: Enrich CLI signature mismatch
- Removed `applyInference` and `nowValid`/`stillInvalid` from cmdEnrich
- enrich.ts only returns `{ total, enriched }`

#### Feat: Phase 5 enrichment — raw text extraction
- Switch from raw text: +611 entries (regex: tail/side/rotary/dual/electronic/magnetic)
- Material from raw text: +1,058 entries (aluminum, polycarbonate, stainless steel, etc.)
- Runtime from raw text: +153 entries (from "XX hours runtime" patterns)
- Features from raw text: +860 entries (clip, waterproof, rechargeable, strobe, SOS, lanyard, etc.)
- Color from raw text: +47 entries

#### Feat: Pelican structured specs scrape
- Discovered www.pelican.com serves full FL1 spec tables in static HTML
- Scraped 50 product pages via curl (Cloudflare blocks bun fetch)
- 92 entries enriched, 369 fields added (length, switch, material, battery, FL1 data)
- Also imported 83 products from Shopify JSON API (price, weight, color)

### Previous Session Work (2026-03-16)

#### Phase 1-2: Code Refactoring
- Created `pipeline/store/brand-aliases.ts` — shared brand normalization module
- Refactored `shopify-crawler.ts` to import from brand-aliases (DRY)
- Added `--source` filter to `ai-parser.ts` (reviews|retailers|manufacturers)
- Added `run-full` orchestrated pipeline command to CLI
- Added `woocommerce` CLI command with brand filter
- Created `output/data-audit.md` and `output/coverage-tracker.md`

#### Phase 3: Data Cleanup
- Merged 5 Prometheus Lights → FourSevens
- Fixed CloudDefensive → Cloud Defensive (38 entries)
- Removed 239 exact model duplicates
- Smart-deduped 1,941 near-duplicate models (same brand, prefix matching)
- DB: 12,650 → 10,725 entries

#### Phase 4: Review Site Scraping
| Site | Reviews Found | Entries Enriched |
|------|--------------|-----------------|
| zakreviews | 31 | 6 |
| tgreviews | 161 | 50 |
| sammyshp | 100 | 5 |
| 1lumen | 941 | 311 |
| zeroair | 1,105 | 195 |
| **Total** | **2,338** | **567** |

#### Phase 5: AI Parse (reviews + targeted brands)
- Review sources: 449 processed, 22 enriched (+22 fields)
- Malkoff: 120 processed, 5 enriched
- ReyLight: 81 processed, 5 enriched
- Zebralight: 50 processed, 0 enriched (throw_m not on pages)

### Remaining Gaps / TODO
- **LED (45.6% missing)**: Most pages don't list specific LED emitter. Could use image classification.
- **Color (43.8%)**: User suggested image parsing for switch type — extends to color detection too.
- **Length (39.9%)**: Needs structured spec tables. Most available data already scraped.
- **Runtime (36.9%)**: In marketing text but AI parser already tried. More structured sources needed.
- **Throw (36.1%)**: FL1 derivation from intensity_cd has minimal remaining candidates (28).
- **CFC headless**: Wurkkos (Cloudflare), Sofirn (Cloudflare) — needs browser-based scraping.
- **Petzl**: 137 entries, mostly from Battery Junction. Structured specs on petzl.com behind JS.
