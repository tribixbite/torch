# Pipeline State — 2026-03-21

## Current Status: Dedup + Fenix placeholder cleanup — 71.3% valid

### Coverage (10,093 flashlights / 12,451 total)
| Field | Coverage | Missing |
|-------|----------|---------|
| purchase_url | 100.0% | 1 |
| price_usd | 97.9% | 210 |
| color | 97.8% | 220 |
| battery | 97.6% | 243 |
| features | 97.2% | 282 |
| switch | 96.3% | 371 |
| weight_g | 96.7% | 336 |
| lumens | 96.3% | 376 |
| led | 95.8% | 427 |
| material | 95.4% | 464 |
| throw_m | 89.7% | 1,040 |
| length_mm | 87.9% | 1,226 |
| runtime | 87.2% | 1,291 |

Fully valid: **7,195 entries (71.3%)**

### Near-Valid Distribution
| Missing | Count | Cumulative |
|---------|-------|------------|
| 0 | 7,195 | 7,195 (71.3%) |
| 1 | ~1,333 | ~8,528 (~84.5%) |
| 2 | ~500 | ~9,028 (~89.5%) |
| 3+ | ~1,065 | 10,093 (100%) |

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
- **Fenix $79.95 placeholder cleanup**: 240 fenixlighting.com entries with systematic placeholder price. 28 category pages reclassified as blog (Camping Headlamps, Tactical Flashlights, etc.). 200 placeholder prices cleared. 17 real prices recovered via model cross-reference. 14 duplicate entries merged.

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
| runtime_hours | 375 | Lumintop(53), Mateminco(26), Emisar(17), BLF(16), Amutorch(15) |
| length_mm | 317 | Princeton Tec(30), Maglite(19), Armytek(19), Spotlight(19) |
| throw_m | 243 | Zebralight(41), Nightstick(40), Convoy(19), Streamlight(17) |
| led | 99 | Coast(21), Nextorch(15), Olight(10), Fenix(10) |
| price_usd | 95 | Fenix(45), Nightstick(32), Lumintop(13), Armytek(2) |
| color | 54 | Striker(7), UST(4), Fenix(4), Petzl(4) |
| weight_g | 42 | Acebeam(16), Loop Gear(5), Streamlight(4) |
| material | 35 | Wagan(7), Nite Ize(4), UST(3) |
| switch | 30 | Sunrei(7), Olight(5), Knog(3) |
| lumens | 20 | Tank007(8), ReyLight(3), FourSevens(3) |
| battery | 12 | Nitecore(3), Coast(3), Imalent(2) |
| features | 10 | Maxtoch(2), Acebeam(2) |

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
