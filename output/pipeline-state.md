# Pipeline State — 2026-03-20

## Current Status: OpticsPlanet prices + data cleanup — 71.7% valid

### Coverage (9,546 flashlights / 12,454 total)
| Field | Coverage | Missing |
|-------|----------|---------|
| purchase_url | 100.0% | 4 |
| color | 98.2% | 172 |
| battery | 97.1% | 273 |
| switch | 96.1% | 371 |
| features | 96.1% | 370 |
| material | 96.0% | 380 |
| lumens | 94.7% | 514 |
| led | 95.7% | 411 |
| weight_g | 95.7% | 409 |
| price_usd | 97.9% | 197 |
| throw_m | 88.7% | 1,078 |
| length_mm | 86.5% | 1,286 |
| runtime | 85.6% | 1,380 |

Fully valid: **6,848 entries (71.7%)**

### Near-Valid Distribution
| Missing | Count | Cumulative |
|---------|-------|------------|
| 0 | 6,848 | 6,848 (71.7%) |
| 1 | ~1,340 | ~8,188 (~85.8%) |
| 2 | ~530 | ~8,718 (~91.3%) |
| 3 | ~290 | ~9,008 (~94.3%) |

### Single-Field Blockers (~1,340 entries missing exactly 1 field)
| Blocker | Count | Fillable? |
|---------|-------|-----------|
| runtime | ~390 | Hard — custom/budget lights without ANSI runtime |
| length | ~320 | Hard — mostly headlamps without length specs |
| throw | ~220 | Hard — floody/headlamp lights without throw data |
| price | ~120 | Partially — 80+ Nightstick still B2B, Lumintop manufacturer-only |
| led | ~110 | Hard — generic "LED" entries |
| weight | ~40 | Hard — not in source text |
| material | ~30 | Hard — not in source text |

### Session Gains (3/20)
- **OpticsPlanet Nightstick prices**: 180 model+price pairs, 156 prices updated (2 scraper runs)
- **Data quality cleanup**: 225+ junk entries reclassified (chargers, adapters, mounts, batteries, multi-packs, category pages)
- **Malformed type JSON fix**: 187 entries had bare string types instead of JSON arrays
- **Dedup**: 60 duplicate groups merged (61 entries removed)
- **Model cross-ref cascade**: +20 fixes from post-cleanup cross-referencing

### Previous Session Gains (3/19)
- **Parametrek cross-reference**: +8,291 fixes across 3,583 matched entries
- Brand aliases (Led Lenser→Ledlenser, Mag Instrument→Maglite, Intl Outdoor→Emisar/Noctigon)
- Spec-stripped fuzzy matching for model names with embedded specs
- Amazon ASIN price lookup: ~50 prices filled from Amazon product pages
- Model-crossref UNIQUE constraint fix: unlocked LED/switch/material/color cross-references
- OpticsPlanet initial run: 92 Nightstick prices

### Enrichment Tools Available
| Script | Purpose |
|--------|---------|
| `scripts/extract-missing-fields.ts` | Regex extraction from raw_spec_text |
| `scripts/model-crossref.ts` | Cross-reference same-model entries |
| `scripts/dedup-models.ts` | Merge duplicate brand+model entries |
| `scripts/parametrek-crossref.ts` | Cross-reference with parametrek.com data |
| `scripts/amazon-price-lookup.ts` | Get prices from Amazon by ASIN |
| `scripts/opticsplanet-nightstick-prices.ts` | Nightstick prices from OpticsPlanet |
| `pipeline/cli.ts raw-fetch` | Fetch raw text for entries without it |
| `pipeline/cli.ts build` | Rebuild flashlights.now.json |

### Diminishing Returns
The remaining gaps are genuinely missing data — product pages don't contain the information.
Major remaining strategies:
1. **Keepa price scraping** — 197 entries need price, Keepa token refill rate 1/min
2. **Cloudflare-blocked sites** — Pelican (72), Convoy, Sofirn, Wurkkos need headless browser
3. **BLF review posts** — community-measured data, rate-limited
4. **Runtime gap**: 1,380 entries — mostly Chinese brands without ANSI runtime
5. **Length/throw gaps**: headlamps, floody lights without these specs
