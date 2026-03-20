# Pipeline State — 2026-03-20

## Current Status: Data cleanup converged — 60.5% valid

### Coverage (6,611 flashlights / 12,688 total DB / 9,363 in JSON)
| Field | Coverage | Missing |
|-------|----------|---------|
| purchase_url | ~100% | ~1 |
| color | 97.6% | 159 |
| battery | 97.6% | 158 |
| features | 97.5% | 162 |
| price_usd | 97.1% | 194 |
| weight_g | 97.1% | 194 |
| lumens | 95.8% | 275 |
| material | 94.8% | 347 |
| switch | 94.7% | 352 |
| throw_m | 89.4% | 701 |
| length_mm | 87.9% | 797 |
| runtime | 84.8% | 1,006 |
| **led** | **79.0%** | **1,388** |

Fully valid: **4,002 entries (60.5%)**

### Spec Completeness Distribution
| Specs filled | Count | Cumulative | % of total |
|-------------|-------|------------|------------|
| 16/16 | 4,002 | 4,002 | 60.5% |
| 15/16 | 1,298 | 5,300 | 80.2% |
| 14/16 | 527 | 5,827 | 88.1% |
| 13/16 | 314 | 6,141 | 92.9% |
| <=12/16 | 470 | 6,611 | 100.0% |

### Single-Field Blocker Analysis
| Field | Count | Top brands |
|-------|-------|------------|
| led | 657 | Nightstick, Coast, Ledlenser, Pelican, SureFire |
| runtime_hours | 263 | Lumintop(75), Mateminco(50), Emisar(31), NightWatch(22) |
| length_mm | 132 | Rayovac(39), Petzl(17), Ledlenser(14), Olight(12) |
| throw_m | 106 | Zebralight(14), Convoy(12), ARCHON(11), Malkoff(9) |
| switch | 40 | Nitecore, Imalent, Sunrei, Emisar |
| color | 25 | various |
| weight_g | 23 | various |
| material | 19 | various |
| price_usd | 17 | Lumintop (discontinued) |
| lumens | 13 | Tank007, ReyLight, FourSevens |
| features | 2 | Haikelite, ARCHON |
| battery | 1 | — |

### Session Gains (3/20 — current)
- **Bug fix**: `rowToPartialEntry()` in raw-text-fetcher.ts — type was hardcoded 'handheld' string instead of parsed JSON array, lumens/runtime nested incorrectly
- **Bug fix**: `hasRequiredAttributes()` defensive JSON parse for entry.type string
- **Dedup Acebeam**: ~30 duplicate entries merged (L19 CAMO 6 color variants→1, L19 3 LED variants→1, G15 2 dupes, E10 2.0, H17 2.0, H40, Terminator M1 8 dupes→1, L16 2.0, Rider RX 2.0)
- **Reclassification**: 13 combo packs/bundles → accessory, 4 filters/bezels → accessory
- **Parametrek cross-reference**: +72 fixes
- **Switch extraction**: +3 from raw text (Manker ML02, UST PICO/30-Day)
- **Raw text cleanup**: Deleted 654 useless Keepa boilerplate entries
- **AI parser confirmed exhausted**: 0 enrichments from 125 entries — all extractable data already captured

### Diminishing Returns
All cascade scripts converged to zero. AI parser exhausted. Remaining gaps are structural:
1. **LED (1,388)**: Brands don't publish LED chip names (Nightstick, Coast, Pelican, Energizer)
2. **Runtime (1,006)**: Chinese brands without ANSI data (Lumintop, Mateminco, Emisar)
3. **Length (797)**: Not on product pages, would need review sites or spec sheets
4. **Throw (701)**: Many products don't publish throw distance

### Session Gains (3/22)
- **Data honesty audit** (100-entry random sanity check): Cleared 1,435 generic LED placeholders, 121 impossible lengths, 14 impossible weights, 248 FL1 mismatches
- **Multi-round cleanup**: Generic placeholders in all array fields (LED/switch/material/battery)
- **Type fixes**: 133 headlamps + 37 lanterns reclassified, throw_m exemption added
- **Feature/switch/battery extraction**: +62 features, +18 switches, +29 batteries from raw text
- **Adapter reclassification**: 101 AC/DC adapters from generic Amazon brands
- **Near-duplicate merging**: 7 groups merged, charging systems → accessories
- **Net result**: 70.8%→60.5% honest valid rate (prior was inflated by placeholders)

### Previous Session Gains (3/21)
- **Cross-retailer smart dedup**: 601 entries merged
- **Olight color variant dedup**: 126 entries merged
- **Fenix $79.95 placeholder cleanup**: 240 entries fixed
- **Deep product-code dedup**: 1,378 entries merged
- **Build script fix**: Excluded removed entries (6.9MB→6.1MB)
- See full details in git log

### Enrichment Tools Available
| Script | Purpose |
|--------|---------|
| `scripts/extract-missing-fields.ts` | Regex extraction from raw_spec_text |
| `scripts/model-crossref.ts` | Cross-reference same-model entries |
| `scripts/dedup-models.ts` | Merge duplicate brand+model entries |
| `scripts/parametrek-crossref.ts` | Cross-reference with parametrek.com data |
| `scripts/fetch-asin-prices.ts` | Get prices from Amazon by ASIN |
| `pipeline/cli.ts raw-fetch` | Fetch raw text for entries without it |
| `pipeline/cli.ts build` | Rebuild flashlights.now.json |
