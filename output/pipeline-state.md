# Pipeline State — 2026-03-21

## Current Status: Massive cross-retailer dedup + data quality — 71.4% valid

### Coverage (10,122 flashlights / 12,452 total)
| Field | Coverage | Missing |
|-------|----------|---------|
| purchase_url | 100.0% | 1 |
| price_usd | 98.4% | 157 |
| color | 97.7% | 235 |
| battery | 97.6% | 243 |
| features | 97.2% | 282 |
| switch | 96.3% | 375 |
| weight_g | 96.5% | 353 |
| lumens | 96.3% | 376 |
| led | 95.7% | 432 |
| material | 95.4% | 465 |
| throw_m | 89.6% | 1,052 |
| length_mm | 87.8% | 1,239 |
| runtime | 87.2% | 1,297 |

Fully valid: **7,231 entries (71.4%)**

### Near-Valid Distribution
| Missing | Count | Cumulative |
|---------|-------|------------|
| 0 | 7,231 | 7,231 (71.4%) |
| 1 | ~1,282 | ~8,513 (~84.1%) |
| 2 | ~500 | ~9,013 (~89.0%) |
| 3+ | ~1,109 | 10,122 (100%) |

### Session Gains (3/21)
- **Cross-retailer smart dedup**: 601 entries merged across all brands — same model from different retailers (goinggear, batteryjunction, nealsgadgets, flashlightgo, torchdirect, flashlightworld) consolidated into single entries with best-quality data from each source. 822 fields recovered/upgraded during merge.
- **Olight color variant dedup**: 126 entries merged — Baton 3 (30+ colors/editions→1), Marauder Mini (12→1), i5R EOS (14→1), Arkfeld Ultra Comic Book (8→1), Warrior Mini 3 (6→1), Oclip Pro (8→1), ArkPro (7→1), etc.
- **Nextorch dedup**: 26 entries merged — Artorch (3→1), P91 (3→1), TA22 (2→1), TA30C MAX (4→1), TA30D MAX (3→1), Saint Torch 31 (3→1), etc.
- **Cloud Defensive BLEM→regular**: 5 blemished variants merged into regular product entries
- **Nightstick OpticsPlanet prices**: ~35 prices recovered via background agent scraping OpticsPlanet listings
- **Non-flashlight reclassification**: Nextorch batons, package openers, Cloud Defensive warranty, Olight red dot sight, product bundles
- **Modlite model cleanup**: Fixed 6 entries with `<br><br>` HTML artifacts in model names
- **Diffuser filter fix**: 4 Olight Diffuser Filter accessories wrongly merged into Diffuse flashlight — restored as accessories
- **Marauder Mini restoration**: Restored Marauder Mini (7000lm) as distinct from Marauder Mini 2 (10000lm)

### Previous Session Gains (3/20 continued)
- **Placeholder price cleanup**: 57 fake prices cleared (Armytek $1-$6, SureFire $1, Acebeam $2, Skylumen $9999, Armytek $6500)
- **Armytek price recovery**: 42 prices restored via model family matching (Wizard/Crystal/Dobermann/Zippy variants)
- **Nightstick variant pricing**: 25 prices from DC/color/base model matching
- **Brand reattribution**: 54 Nealsgadgets entries rebranded to correct manufacturers (Acebeam, Convoy, Fenix, etc.)
- **Lumintop dedup**: 15 Amazon generic entries merged into manufacturer entries (FW3A, Pimi, Tool AA, GTA, etc.)
- **Accessory sweep**: 39 accessories reclassified (sheaths, clips, grease, dummy cells, etc.)
- **Junk cleanup**: 57 entries reclassified (Fenix category pages, Nextorch cuffs/gloves, Nitecore knife, etc.)
- **Model crossref cascade**: +16 fixes after rebranding
- **Parametrek crossref**: +8 fixes (2 price, 2 runtime)

### Previous Session Gains (3/20)
- **Type JSON fixes**: 190 entries with bare string types, 3 malformed JSON
- **Accessory restoration**: 954 real flashlights incorrectly classified as accessories restored
- **OpticsPlanet Nightstick prices**: 180 model+price pairs, 64 new prices
- **Amazon Nightstick prices**: 7 prices from 118 ASINs
- **Parametrek cascade on restored entries**: +949 fixes
- **Model cross-ref cascade**: +212 fixes
- **Data quality cleanup**: 225+ junk entries reclassified, 60 dups merged

### Previous Session Gains (3/19)
- **Parametrek cross-reference**: +8,291 fixes across 3,583 matched entries
- Brand aliases + spec-stripped fuzzy matching
- OpticsPlanet initial run: 92 Nightstick prices

### Enrichment Tools Available
| Script | Purpose |
|--------|---------|
| `scripts/extract-missing-fields.ts` | Regex extraction from raw_spec_text |
| `scripts/model-crossref.ts` | Cross-reference same-model entries |
| `scripts/dedup-models.ts` | Merge duplicate brand+model entries |
| `scripts/parametrek-crossref.ts` | Cross-reference with parametrek.com data |
| `scripts/fetch-asin-prices.ts` | Get prices from Amazon by ASIN |
| `scripts/opticsplanet-nightstick-prices.ts` | Nightstick prices from OpticsPlanet |
| `scripts/amazon-nightstick-prices.ts` | Nightstick prices from Amazon search |
| `scripts/grainger-nightstick-prices.ts` | Nightstick prices from Grainger |
| `pipeline/cli.ts raw-fetch` | Fetch raw text for entries without it |
| `pipeline/cli.ts build` | Rebuild flashlights.now.json |

### Single-Field Blocker Analysis
| Field | Count | Top brands |
|-------|-------|------------|
| length_mm | 442 | Princeton Tec(30), Skylumen(28), Olight(26), Maglite(25) |
| throw_m | 338 | Zebralight(44), Nightstick(31), Convoy(20) |
| led | 151 | Coast(29), Olight(23), Nextorch(20) |
| price_usd | 99 | Nightstick(60), Lumintop(22), EagleTac(1) |
| material | 80 | Wagan(12), Energizer(9), Titanium(9) |
| color | 69 | Fenix(7), Striker(7), Coast(6) |
| weight_g | 47 | Acebeam(16), Loop Gear(5) |
| switch | 39 | Sunrei(7), Olight(5) |
| battery | 31 | Imalent(8), Lumintop(8) |
| features | 22 | Maxtoch(4), Skylumen(3) |

### Diminishing Returns
The remaining gaps are genuinely missing data — product pages don't contain the information.
All cascade scripts (parametrek, model-crossref, extract-missing-fields) yield near-zero.
Major remaining strategies:
1. **Nightstick prices**: 60 single-field blockers, all retailers tried (OpticsPlanet, Amazon, Grainger) — diminishing
2. **Cloudflare-blocked sites**: Pelican, Convoy, Sofirn, Wurkkos need headless browser
3. **Runtime gap**: 1,314 entries — mostly Chinese brands without ANSI runtime data
4. **Length/throw gaps**: headlamps, floody lights that genuinely don't spec these
5. **Raw text fetch**: ~108 entries without raw_spec_text
6. **Configurable products plan**: intl-outdoor D4V2 Mule fix, LED options schema (approved plan exists)
