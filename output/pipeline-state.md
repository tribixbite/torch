# Pipeline State — 2026-03-22

## Current Status: Data honesty audit — 56.2% valid (honest)

### Coverage (6,688 flashlights / 12,568 total DB / 9,252 in JSON)
| Field | Coverage | Missing |
|-------|----------|---------|
| purchase_url | ~100% | ~1 |
| price_usd | 97.3% | 181 |
| color | 97.7% | 156 |
| features | 96.9% | 206 |
| battery | 96.7% | 223 |
| weight_g | 96.6% | 227 |
| lumens | 95.8% | 281 |
| switch | 94.1% | 393 |
| material | 93.8% | 415 |
| throw_m | 88.9% | 744 |
| length_mm | 86.4% | 910 |
| runtime | 85.2% | 992 |
| **led** | **74.3%** | **1,719** |

Fully valid: **3,758 entries (56.2%)**

Note: Valid count dropped from 4,672 (70.8%) after data honesty audit. 1,435 entries
had generic LED placeholders (`["LED"]`, `["CREE"]`, `["unknown"]`) that passed the
"not empty" check but contained zero useful information. Additionally cleared: 121
impossible length values (<20mm), 14 impossible weights (<5g), 248 FL1 throw/cd
mismatches, 51 generic battery values, 84 generic switch values, 52 generic material
values. The previous 70.8% was dishonest — real coverage was always 56.2%.

### Session Gains (3/22)
- **Data quality fixes**: Cleared 9999 lumens placeholders (4 Fenix entries), impossible throw values (Skylumen B01vn 6000m, Olight RN 800 4000m, Olight Seeker 2 5000m), Acebeam E75 155000lm placeholder
- **Raw text fetch**: 101 new entries fetched (Pelican blocked by Cloudflare — curl now also blocked)
- **AI parse**: 7 entries enriched from new raw text (manufacturers + retailers)
- **Enrichment cascade**: +130 total enrichments from parametrek/model crossref
- **Schema: throw_m optional for headlamps/lanterns/floods**: Flood lights and area lights don't have meaningful throw specs. Consistent with parametrek.com showing N/A. +47 newly valid entries.
- **Adapter/junk reclassification**: 67 AC/DC power adapters from generic Amazon brands (KONKIN BOO, PKPOWER, SLLEA, etc.) reclassified as accessories
- **Near-duplicate merging**: 6 more near-duplicates merged (Acebeam E70 MINI/E70mini, EagleTac M30LC2-C/M30LC2C, etc.)
- **Data honesty audit** (100-entry random sanity check):
  - Cleared 1,435 generic LED placeholders (`["LED"]`, `["CREE"]`, `["unknown"]`, `["N/A"]`)
  - Cleared 121 impossible length_mm values (<20mm — stored in wrong units or garbage)
  - Cleared 14 impossible weight_g values (<5g)
  - Cleared 248 FL1 throw/cd mismatches (intensity_cd wildly inconsistent with throw_m, ratio >10x)
  - Cleared 130+ entries with intensity_cd=1 (garbage)
  - Cleared 51 generic battery values (`["built-in"]`, `["rechargeable"]`, `["lithium"]`)
  - Cleared 84 generic switch values (`["mechanical"]`, `["electronic"]`, `["button"]`)
  - Cleared 52 generic material values (`["plastic"]`, `["metal"]`, `["other"]`)
- **Net result**: 4,561→3,758 valid, 68.9%→56.2% (honest)

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

### Single-Field Blocker Analysis (post-honesty audit)
LED is now the dominant blocker — most entries previously had generic `["LED"]` placeholders.

| Field | Count | Top brands |
|-------|-------|------------|
| led | 819 | Nightstick(198), Ledlenser(75), Pelican(60), Coast(47), SureFire(41) |
| runtime_hours | 219 | Lumintop(34), Mateminco(25), Amutorch(13), BLF(12), NightWatch(11) |
| length_mm | 163 | Acebeam(19), Lumintop(13), Rayovac(13), Skilhunt(12), Coast(9) |
| throw_m | 103 | Zebralight(14), Convoy(12), ARCHON(11), Malkoff(9), FourSevens(9) |
| switch | 57 | Nitecore(7), Imalent(6), Sunrei(5), Emisar(4), Olight(4) |
| material | 37 | Wagan(6), Petzl(4), Ledlenser(4), Klarus(4), Lightstar(4) |
| battery | 28 | Fenix(13), Nitecore(8), Rovyvon(3), Olight(2) |
| color | 23 | Petzl(3), Coast(3), ThruNite(2), Princeton Tec(2) |
| weight_g | 17 | Loop Gear(3), Manker(2), ReyLight(2), Imalent(1) |
| price_usd | 16 | Lumintop(14), EagleTac(1), Armytek(1) |
| lumens | 13 | Tank007(4), ReyLight(3), FourSevens(2) |
| features | 2 | Haikelite(1), ARCHON(1) |

### Biggest Gap: LED (1,719 missing = 25.7%)
Top brands missing LED data:
Nightstick(418), Ledlenser(107), Pelican(73), Lumintop(70), SureFire(56), Coast(52), Olight(50), Acebeam(44)

Most of these previously had `["LED"]` or `["CREE"]` placeholders. The real LED model (e.g., "Luminus SFT-40", "Cree XHP70.3") is not on the product pages for many brands. Nightstick and Pelican rarely publish LED specs. Ledlenser uses proprietary naming.

### Diminishing Returns
All cascade scripts (parametrek, model-crossref, extract-missing-fields) yield near-zero.
Major remaining strategies:
1. **LED recovery**: Re-run model-crossref now that generic LED values are cleared — some entries may have real LED data from other sources
2. **Nightstick prices**: 46 single-field blockers, all retailers tried (OpticsPlanet, Amazon, Grainger) — diminishing
3. **Cloudflare-blocked sites**: Pelican, Convoy, Sofirn, Wurkkos need headless browser
4. **Runtime gap**: 992 entries — mostly Chinese brands without ANSI runtime data
5. **LED from review sites**: BLF, Reddit, 1lumen.com may have LED identifications
6. **Configurable products**: intl-outdoor D4V2 Mule fix implemented, LED options schema done
