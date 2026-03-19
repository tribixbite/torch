# Pipeline State — 2026-03-20

## Current Status: Type cleanup + parametrek cascade — 69.6% valid

### Coverage (10,322 flashlights / 12,437 total)
| Field | Coverage | Missing |
|-------|----------|---------|
| purchase_url | 99.4% | 58 |
| color | 97.3% | 278 |
| battery | 95.7% | 449 |
| switch | 94.2% | 600 |
| features | 93.8% | 636 |
| material | 93.5% | 674 |
| lumens | 92.2% | 804 |
| led | 93.1% | 714 |
| price_usd | 96.3% | 381 |
| weight_g | 93.3% | 688 |
| throw_m | 85.4% | 1,508 |
| length_mm | 83.2% | 1,733 |
| runtime | 82.8% | 1,779 |

Fully valid: **7,181 entries (69.6%)**

### Near-Valid Distribution
| Missing | Count | Cumulative |
|---------|-------|------------|
| 0 | 7,181 | 7,181 (69.6%) |
| 1 | ~1,530 | ~8,711 (~84.4%) |
| 2 | ~640 | ~9,351 (~90.6%) |
| 3 | ~350 | ~9,701 (~94.0%) |

### Session Gains (3/20)
- **Type JSON fixes**: 190 entries with bare string types, 3 malformed JSON
- **Accessory restoration**: 954 real flashlights incorrectly classified as accessories restored
- **OpticsPlanet Nightstick prices**: 180 model+price pairs, 64 new prices (expanded pagination)
- **Amazon Nightstick prices**: scraping in progress (118 ASINs)
- **Parametrek cascade on restored entries**: +949 fixes
- **Model cross-ref cascade**: +212 fixes (24 throw, 43 length, 30 color, 29 material, 28 switch)
- **Extract cascade**: +4 length
- **Data quality cleanup**: 225+ junk entries reclassified, 60 dups merged

### Previous Session Gains (3/19)
- **Parametrek cross-reference**: +8,291 fixes across 3,583 matched entries
- Brand aliases + spec-stripped fuzzy matching
- Model-crossref UNIQUE constraint fix
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
| `scripts/amazon-nightstick-prices.ts` | Nightstick prices from Amazon search |
| `pipeline/cli.ts raw-fetch` | Fetch raw text for entries without it |
| `pipeline/cli.ts build` | Rebuild flashlights.now.json |

### Diminishing Returns
The remaining gaps are genuinely missing data — product pages don't contain the information.
Major remaining strategies:
1. **Keepa price scraping** — 381 entries need price, Keepa token refill rate 1/min
2. **Cloudflare-blocked sites** — Pelican (72), Convoy, Sofirn, Wurkkos need headless browser
3. **BLF review posts** — community-measured data, rate-limited
4. **Runtime gap**: 1,779 entries — mostly Chinese brands without ANSI runtime
5. **Length/throw gaps**: headlamps, floody lights without these specs
6. **Raw text fetch**: ~600 entries without raw_spec_text that could yield data
