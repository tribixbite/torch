# Pipeline State — 2026-03-20

## Current Status: "Show Unknown" filter toggle shipped — 60.1% valid

### Coverage (6,493 lights / 12,545 total DB / 9,254 in JSON / 1,298 near-valid)
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

Fully valid: **3,907 entries (60.2%)**

Note: Valid count decreased from 4,002 to 3,907 due to duplicate deletion (not data loss).
Duplicate entries that happened to be "valid" were removed during dedup passes.
Near-valid (missing 1 attribute): 1,298 — if all were filled: 5,205 valid (80.2%).

### Single-Field Blocker Analysis (updated 3/22)
| Field | Count | Top brands |
|-------|-------|------------|
| led | 691 | Nightstick, Coast, Ledlenser, Pelican, SureFire |
| runtime | 249 | Lumintop, Mateminco, Emisar, Olight |
| throw_m | 154 (105 non-exempt) | Zebralight(39), Streamlight(14), Convoy(13), ARCHON(12) |
| length_mm | 121 (68 non-exempt) | Rayovac(12), Coast(9), Ledlenser(7), Malkoff(7) |
| switch | 29 | Sunrei, Nitecore, Olight, Knog |
| color | 27 | various |
| weight_g | 17 | various |
| material | 19 | various |
| price_usd | 17 | Lumintop (discontinued) |
| lumens | 12 | Tank007, ReyLight, UV lights |

### Session Gains (3/20 — current)
- **Bug fix**: `rowToPartialEntry()` in raw-text-fetcher.ts — type was hardcoded 'handheld' string instead of parsed JSON array, lumens/runtime nested incorrectly
- **Bug fix**: `hasRequiredAttributes()` defensive JSON parse for entry.type string
- **Dedup Acebeam**: ~30 duplicate entries merged (L19 CAMO 6→1, L19 3→1, G15 2→1, E10 2.0, H17 2.0, H40, Terminator M1 9→1, L16 2.0, Rider RX 2.0 6→1, E75 7→1)
- **Dedup Emisar**: 88→43 entries — cleaned all model names, merged D18/D1/KC1/DW3AA/DT8K duplicates, reclassified 9 junk entries
- **Dedup Lumintop**: ~15 retailer-description duplicates, reclassified MCPCB/optics/lanyard as accessories
- **Smart dedup all brands**: 52 short-model+retailer-description duplicates across all brands
- **Reclassification**: 13 combo packs/bundles, 12 Streamlight battery/module accessories, 4 filters/bezels
- **Parametrek cross-reference**: +72 fixes
- **Switch extraction**: +3 from raw text (Manker ML02, UST PICO/30-Day)
- **Generic LED cleanup**: 240 more generic elements cleared (LED light chip, white LED, etc.)
- **Lumen contamination fixes**: Acebeam E75/M2-X/T35 had 155000 from cross-pollution
- **Raw text cleanup**: Deleted 654 useless Keepa boilerplate entries
- **AI parser confirmed exhausted**: 0 enrichments from 125 entries — all extractable data already captured
- **Dedup Imalent**: 55→36 entries — merged BL50(8→1), LD35(5→1), MS12(→1), R90TS(3→1), cleaned 16 retailer-description names, deleted 3 dupes, reclassified junk/accessories
- **Zebralight throw investigated**: 40 missing throw, but 27 are exempt (headlamps/lanterns). 13 flashlights need throw — not on product pages, no review data. Structural gap.
- **Single-field blocker re-analysis**: 1,298 near-valid. All extractable data exhausted from raw text, model names, and cross-references.

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
