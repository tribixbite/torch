# Pipeline State — 2026-03-16

## Current Status: Pipeline refactored, reviews scraped, dedup complete

### Coverage (10,725 entries — was 12,650 before dedup)
| Field | Current | Previous | Δ |
|-------|---------|----------|---|
| lumens | 80.3% | 81.2% | -0.9% |
| throw_m | 63.2% | 65.5% | -2.3% |
| runtime | 61.1% | 59.8% | +1.3% |
| length_mm | 59.3% | 60.1% | -0.8% |
| weight_g | 90.8% | 91.1% | -0.3% |
| led | 54.2% | 55.0% | -0.8% |
| battery | 81.4% | 82.5% | -1.1% |
| switch | 66.7% | 66.2% | +0.5% |
| material | 68.8% | 67.2% | +1.6% |
| color | 55.5% | 53.3% | +2.2% |
| features | 82.5% | 83.5% | -1.0% |
| price | 93.9% | 94.5% | -0.6% |

Fully valid: **1,252 entries (11.7%)** — down from 2,497 at 12,650 entries
> Note: dedup removed 1,925 entries (many were retailer duplicates that inflated valid count).
> The valid% is lower but data quality is higher — fewer duplicate/conflicting entries.

### This Session's Work

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

#### Phase 6: Image Pipeline Fix
- Switched from sequential-index to flashlight-ID-based sprite mapping
- Images now stable across DB changes (entries added/removed/reordered)
- Requires image pipeline re-run to regenerate sprite with ID-based naming

#### Phase 7: Accessory Classification
- 324 entries classified as type "accessory" (was: filtered out at build time)
- Accessories now kept in DB and output, filterable in SPA via type column

### Build Output
- 10,725 entries, 36 columns, 6,644 KB JSON
- 324 accessories included (filterable)

### Next Steps
1. **Re-run image pipeline** with new ID-based sprite mapping
2. **CFC headless** for Pelican (193), Wurkkos (32), Sofirn (40)
3. **Deep attribute gaps**: led (45.8%), color (44.5%), length (40.7%)
4. **Deploy SPA update**
5. Continue targeted AI parse for remaining brands
