# Pipeline State — 2026-03-21

## Current Status: Continuous enrichment pipeline active — vision + Keepa cron

### Coverage (9,589 lights / ~12.7K total DB)
| Field | Missing | % Coverage |
|-------|---------|------------|
| purchase_url | ~1 | ~100% |
| color | 50 | 99.5% |
| battery | ~158 | 98.4% |
| features | ~162 | 98.3% |
| price_usd | ~194 | 98.0% |
| weight_g | ~194 | 98.0% |
| lumens | ~275 | 97.1% |
| material | ~347 | 96.4% |
| switch | 229 | 97.6% |
| throw_m | ~701 | 92.7% |
| length_mm | ~797 | 91.7% |
| runtime | ~1,006 | 89.5% |
| **led** | **~1,388** | **85.5%** |

### Continuous Enrichment Pipeline
1. **Keepa cron** (`scripts/keepa-cron.sh`): every 5min, 5 ASINs, post-scrape enrichment:
   - `scrape-images.ts --download-only` — thumbnails for new entries
   - `parametrek-crossref.ts` — fill from ground truth
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

### Session Gains (3/21 — current)
- **Parametrek crossref**: +166 fixes (12 switches, 20 LEDs, 23 years, 20 beam angles, etc.)
- **Vision classifier (Flash)**: +96 colors, +64 switches, 1262 reclassified as accessories
- **Gap reduction**: color 186→50, switch 377→229
- **New scripts**: `validate-vision-accuracy.ts`, `vision-cron.sh`
- **Code changes**: `--download-only` flag for scrape-images, flexible model IDs in vision-classifier
- **Keepa cron enhanced**: post-scrape enrichment chain (images + parametrek + model crossref)
- **Keepa weight documented**: itemWeight excludes battery — comment-only, no logic change

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
| `scripts/parametrek-crossref.ts` | Cross-reference with parametrek.com data |
| `scripts/fetch-asin-prices.ts` | Get prices from Amazon by ASIN |
| `scripts/validate-vision-accuracy.ts` | Validate vision results vs parametrek |
| `scripts/vision-cron.sh` | Hourly vision enrichment (grid → classify → sprite) |
| `pipeline/cli.ts raw-fetch` | Fetch raw text for entries without it |
| `pipeline/cli.ts build` | Rebuild flashlights.now.json |
