# Pipeline State — 2026-03-17

## Current Status: Pattern expansion + review scrapers + AI re-parse — 30.8% valid

### Coverage (10,775 entries)
| Field | Current | Previous | Δ |
|-------|---------|----------|---|
| lumens | 83.3% | 80.9% | +2.4% |
| throw_m | 69.5% | 69.9% | -0.4%* |
| runtime | 64.1% | 64.1% | — |
| length_mm | 71.9% | 71.9% | — |
| weight_g | 91.1% | 91.1% | — |
| led | 67.2% | 67.1% | +0.1% |
| battery | 87.5% | 87.5% | — |
| switch | 82.6% | 82.5% | +0.1% |
| material | 79.3% | 79.3% | — |
| color | 80.1% | 80.1% | — |
| features | 90.8% | 90.8% | — |
| price | 94.0% | 93.9% | +0.1% |
| purchase_url | 99.5% | 90.8% | +8.7% |

*throw recalculated with stricter >0 check

Fully valid: **3,325 entries (30.9%)** — up from 3,172 (29.4%)

### Near-Valid Distribution (entries missing N fields)
| Missing | Count | Cumulative |
|---------|-------|------------|
| 0 | 3,318 | 3,318 (30.8%) |
| 1 | 2,375 | 5,693 (52.8%) |
| 2 | 1,473 | 7,166 (66.5%) |
| 3 | 919 | 8,085 (75.0%) |

### Single-Field Blockers (2,375 entries missing exactly 1 field)
| Blocker | Count | Fillable? |
|---------|-------|-----------|
| runtime | 614 | Hard — not in text for most |
| led | 476 | Hard — brands don't publish emitter |
| color | 363 | Hard — vision pipeline already ran |
| throw | 325 | Medium — FL1 data from reviews |
| length | 196 | Medium — some in structured pages |
| material | 156 | Medium — some in structured pages |
| price | 99 | Medium — need retailer cross-ref |
| switch | 97 | Medium — some in text patterns |

### Session 4 Work (2026-03-17)

#### Feat: Expanded extraction patterns (Phase 5c)
- Switch: +12 new patterns (body/head/rear switch, spec table "Switch: Body/Tail",
  dual-mode, triple-switch, magnetic selector) — 299 new switch values
- Runtime: minute-based patterns with hr conversion, Nightstick "High Runtime (h): X"
  format, full-width colon support — 67 new runtime values
- LED: LUXEON, SFH55, SFT25, Osram W1/W2/CULPM1, Cree LED, UV LED
- Color: body color field patterns, Nightstick "Body Color\nBlack" format,
  titanium/copper/brass material→color inference
- Total: 387 entries enriched, +164 fully valid

#### Feat: Review scrapers (5 sites)
- zakreviews: 31 reviews, 26 matched, 2 enriched
- sammyshp: 100 reviews, 49 matched, 1 enriched
- tgreviews: 161 reviews, 135 matched, 13 enriched
- 1lumen: 941 reviews, 681 matched, 85 enriched
- zeroair: running (~516 raw text entries so far)
- Most review data already present from raw text + AI parser

#### Feat: Purchase URL population (Phase 6)
- 868 entries had store source URLs but empty purchase_urls
- Added isStoreUrl() helper with 40+ manufacturer/retailer domains
- 962 entries enriched, purchase_url gap: 9.2% → 0.5%

#### Feat: Lumens, throw, intensity patterns (Session 5)
- Lumens: Battery Junction "Max Lumens\n100", Nightstick "High Lumens:", simple "N lumens"
- Throw: "Peak Beam Distance" with decimals, feet→meters conversion
- Intensity (candela): "NK Candela", "Peak Beam Intensity: X cd", "Lux at 1m"
  → FL1 derivation computes throw_m from intensity_cd
- 250 new lumens values, 51 new throw values

#### AI re-parse: review text
- 300 entries processed with review text + product text
- Only 7 enriched — most data already extracted in prior passes
- Marginal value from review text for entries already AI-parsed

#### BLF scraper
- 200 entries processed, 0 enriched (heavy 429 rate limiting)

#### Investigation: Nightstick PDF spec sheets
- 71 product pages have "Data Sheet" download links
- Sample PDF (NSP-4607B flyer) contains only marketing info — same data as HTML
- No additional specs beyond what structured extractor already captures
- PDF pipeline not cost-effective for this data source

#### Near-valid analysis (2,300 entries missing 1 field)
| Missing Field | Count | Feasibility |
|---|---|---|
| runtime | 596 | Hard — not in raw text for most |
| led | 430 | Hard — brands don't publish emitter |
| throw | 254 | Medium — FL1 test data |
| switch | 232 | Done — pattern expansion caught most |
| color | 203 | Hard — need vision but no thumbnails |
| length | 179 | Medium — some in structured pages |
| material | 146 | Medium — some in structured pages |
| purchase_url | 121 | Easy — link existing retailer URLs |
| price | 100 | Medium — need retailer prices |

### Brand Coverage Matrix (top 30 by entries)
| Brand | Total | Valid | Valid% | Blockers |
|-------|-------|-------|--------|----------|
| Fenix | 1,065 | 327 | 31% | led(30%), runtime(27%), length(26%) |
| Nitecore | 833 | 394 | 47% | color(22%), material(24%), led(19%) |
| Olight | 741 | 328 | 44% | runtime(30%), led(27%), length(26%) |
| Nightstick | 455 | 0 | 0% | **price(100%)**, led(92%), throw(35%) |
| Acebeam | 432 | 112 | 26% | color(39%), length(42%), weight(35%) |
| Ledlenser | 363 | 72 | 20% | led(64%), runtime(47%), length(45%) |
| Streamlight | 344 | 213 | 62% | switch(1%), length(7%), material(11%) |
| Lumintop | 323 | 90 | 28% | runtime(44%), purchase_url(32%), length(23%) |
| Maglite | 261 | 21 | 8% | lumens(79%), runtime(69%), length(82%) |
| Nextorch | 256 | 71 | 28% | led(62%), runtime(34%), switch(29%) |
| Rovyvon | 250 | 59 | 24% | runtime(58%), throw(46%), length(26%) |
| Klarus | 243 | 99 | 41% | throw(30%), runtime(26%), color(23%) |
| JETBeam | 241 | 158 | 66% | runtime(17%), length(11%), purchase_url(7%) |
| Pelican | 220 | 115 | 52% | led(43%), length(12%), throw(15%) |
| Zebralight | 50 | 0 | 0% | **throw(92%)** — only 4 entries have throw |
| Convoy | 135 | 21 | 16% | runtime(81%), throw(48%), lumens(38%) |
| Emisar | 78 | 3 | 4% | runtime(82%), throw(37%), switch(31%) |
| ReyLight | 81 | 0 | 0% | runtime(96%), throw(74%), lumens(79%) |
| Malkoff | 120 | 0 | 0% | throw(80%), material(36%), led(64%) |
| Skilhunt | 42 | 20 | 48% | runtime(45%), throw(12%) |
| Sofirn | 40 | 19 | 48% | runtime(27%), throw(10%) |

### Session 3 Work (2026-03-17)
(See git log for Phase 5b: raw text extraction, vision pipeline, BLF scraper, Wurkkos/Sofirn)

### Session 2 Work (2026-03-17)
(See git log for sprite fix, enrich CLI fix, Phase 5, Pelican crawler)

### Remaining Gaps / TODO
- **Runtime (35.9% missing)**: Hardest gap — not in raw text for most remaining entries
- **LED (32.9%)**: Most pages don't list LED emitter. Some brands never publish it.
- **Throw (30.1%)**: FL1 testing data, limited to manufacturer spec tables + review sites
- **Length (28.0%)**: Need structured spec tables from more manufacturers
- **Material (20.7%)**: Many generic retailer listings don't specify
- **Lumens (19.1%)**: Some entries are accessories incorrectly classified
- **Color (19.9%)**: Vision pipeline handled most, remaining entries lack images
- **Switch (17.5%)**: Pattern expansion handled most, down from 20.3%
- **Nightstick price gap**: 455 entries × $0 — manufacturer site, no retail pricing
- **Zebralight throw gap**: 50 entries × 0 throw — they don't publish throw specs
- **CFC headless**: Petzl (Salesforce/JS) still needs browser scraping
- **Retailer price cross-ref**: Could fill price/purchase_url for manufacturer-only entries
