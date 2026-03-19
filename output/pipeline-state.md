# Pipeline State — 2026-03-21

## Current Status: Deep dedup + data recovery — 68.6% valid

### Coverage (6,615 flashlights / 12,451 total DB / 9,172 in JSON)
| Field | Coverage | Missing |
|-------|----------|---------|
| purchase_url | ~100% | ~1 |
| price_usd | 97.6% | 162 |
| color | 97.7% | 153 |
| features | 97.5% | 163 |
| battery | 97.4% | 173 |
| weight_g | 97.0% | 197 |
| switch | 96.2% | 250 |
| lumens | 96.2% | 250 |
| material | 95.1% | 325 |
| led | 95.6% | 293 |
| throw_m | 88.5% | 764 |
| length_mm | 87.6% | 820 |
| runtime | 85.8% | 938 |

Fully valid: **4,540 entries (68.6%)**

Note: Previous sessions inflated valid counts by including duplicate entries (same
product listed by multiple retailers) in the flashlight total. Deep dedup removed
~3,200 duplicate entries. Valid % dropped from 71% because merged entries were
disproportionately valid (from major retailers with complete data).

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
- **Fenix cross-retailer dedup**: 98 Fenix entries merged — same models from batteryjunction, fenixlighting, fenix-store, flashlightworld, torchdirect consolidated.
- **BatteryJunction color variant dedup**: 117 entries merged across all brands — color variants (Black/Blue/Green/Purple/etc.) of identical products from batteryjunction.com.
- **Acebeam blog/junk cleanup**: 42 acebeam.com entries reclassified as blog (category pages, blog posts with $49 placeholder price — "IP Rating", "Color Temperature", "Sitemap", testing campaigns, etc.). 16 Acebeam product duplicates merged.
- **General cross-retailer dedup**: 773 entries merged across 57 brands — same products listed by multiple retailers with different model name formats.
- **Deep product-code dedup**: 1,378 entries merged — matched by product code + material variant + lumens compatibility. Nitecore(225), Fenix(207), Acebeam(146), Lumintop(65), Klarus(54), Ledlenser(53), etc.
- **Build script fix**: Excluded `type='removed'` entries from JSON output (6.9MB→6.1MB). Stats now correctly count only active flashlights (6,615 unique products vs previously inflated ~10,000).
- **Stats fix**: `pipeline/cli.ts` stats now properly excludes removed/not_flashlight entries from valid count.

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
| runtime_hours | 298 | Lumintop(41), Mateminco(25), Emisar(15), Amutorch(14), Olight(13) |
| throw_m | 211 | Nightstick(40), Zebralight(38), Convoy(13), ARCHON(12), Streamlight(10) |
| length_mm | 210 | Rayovac(16), Coast(13), Weltool(12), Petzl(12), Acebeam(12) |
| led | 76 | Coast(20), Nextorch(12), Olight(10), Modlite(5) |
| price_usd | 71 | Nightstick(32), Fenix(20), Lumintop(13), Acebeam(2) |
| color | 44 | Striker(7), UST(3), ThruNite(3), Petzl(3), Coast(3) |
| weight_g | 29 | Acebeam(8), Streamlight(4), Loop Gear(3) |
| material | 29 | Wagan(7), Nite Ize(4), UST(3), Klarus(3) |
| switch | 27 | Sunrei(7), Olight(4), Knog(3), Fireflies(2) |
| lumens | 14 | Tank007(4), ReyLight(3), FourSevens(3) |
| battery | 8 | Coast(3), Imalent(1), Trustfire(1) |
| features | 4 | Haikelite(1), ARCHON(1), Maxtoch(1), Acebeam(1) |

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
