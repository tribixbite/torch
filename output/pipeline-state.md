# Pipeline State — 2026-03-19

## Current Status: Parametrek enrichment + Amazon prices — 71.0% valid

### Coverage (9,416 flashlights / 12,233 total)
| Field | Coverage | Missing |
|-------|----------|---------|
| purchase_url | 99.0% | ~94 |
| color | 99.1% | 85 |
| battery | 97.8% | 204 |
| switch | 97.6% | 228 |
| features | 97.2% | 263 |
| material | 96.8% | 306 |
| led | 96.6% | 317 |
| lumens | 95.9% | 384 |
| price_usd | 96.0% | 377 |
| weight_g | 95.6% | 413 |
| throw_m | 90.1% | 932 |
| length_mm | 87.2% | 1,209 |
| runtime | 86.9% | 1,236 |

Fully valid: **6,683 entries (71.0%)**

### Near-Valid Distribution
| Missing | Count | Cumulative |
|---------|-------|------------|
| 0 | 6,683 | 6,683 (71.0%) |
| 1 | ~1,170 | ~7,853 (~83%) |
| 2 | ~560 | ~8,413 (~89%) |
| 3 | ~380 | ~8,793 (~93%) |

### Single-Field Blockers (~1,170 entries missing exactly 1 field)
| Blocker | Count | Fillable? |
|---------|-------|-----------|
| runtime | ~392 | Hard — custom/budget lights without ANSI runtime |
| length | ~330 | Hard — mostly headlamps without length specs |
| price | ~210 | Hard — Nightstick B2B ($0), Amazon has 30 ASINs |
| throw | ~209 | Hard — floody/headlamp lights without throw data |
| led | ~110 | Hard — generic "LED" entries |
| weight | ~45 | Hard — not in source text |
| material | ~33 | Hard — not in source text |

### Biggest Brand Gaps (near-valid, missing 1 field)
| Brand | Count | Missing | Fixable? |
|-------|-------|---------|----------|
| Nightstick | 205 | price | B2B site $0; only 30 ASINs available |
| Lumintop | 51 | runtime | No runtime on lumintop.com |
| Olight | 68 | runtime/length | Manufacturer site incomplete |
| Acebeam | 56 | length/runtime | Manufacturer site incomplete |
| Zebralight | 41 | throw | Floody lights, no throw spec (parametrek also empty) |
| Coast | 40 | length | Limited specs on coast.com |
| Princeton Tec | 36 | length | Headlamps without length specs |
| Mateminco | 26 | runtime | Chinese brand, no ANSI data |

### Session Gains (3/19)
- **Parametrek cross-reference**: +8,291 fixes across 3,583 matched entries
  - beam_angle +3,388, year +3,335, length +336, runtime +254
  - intensity +186, throw +185, weight +140, price +111
  - lumens +96, battery +78, features +52, led +40, material +36, switch +43, color +12
- Brand aliases (Led Lenser→Ledlenser, Mag Instrument→Maglite, Intl Outdoor→Emisar/Noctigon)
- Spec-stripped fuzzy matching for model names with embedded specs
- Amazon ASIN price lookup: ~50 prices filled from Amazon product pages
- Dedup cleanup + bad ASIN reversal

### Previous Session Gains (3/18-3/19)
- Core model cross-ref: +891 fixes (initial run)
- Data quality cleanup: ~800 bad values cleared
- Pattern extraction: +60 length, +7 runtime, +27 material, +14 LED
- Dedup: 117 entries merged (103 groups)
- Emisar/Noctigon re-crawl: +40 entries with LED options
- Raw text: 328 new entries fetched (keepa, intl-outdoor)

### Enrichment Tools Available
| Script | Purpose |
|--------|---------|
| `scripts/extract-missing-fields.ts` | Regex extraction from raw_spec_text |
| `scripts/model-crossref.ts` | Cross-reference same-model entries |
| `scripts/dedup-models.ts` | Merge duplicate brand+model entries |
| `scripts/parametrek-crossref.ts` | Cross-reference with parametrek.com data |
| `scripts/amazon-price-lookup.ts` | Get prices from Amazon by ASIN |
| `pipeline/cli.ts raw-fetch` | Fetch raw text for entries without it |
| `pipeline/cli.ts build` | Rebuild flashlights.now.json |

### Diminishing Returns
The remaining gaps are genuinely missing data — product pages don't contain the information.
Major remaining strategies:
1. **Keepa price scraping** — 377 entries need price, Keepa at -1 tokens (1/min refill)
2. **Cloudflare-blocked sites** — Pelican (72), Convoy, Sofirn, Wurkkos need headless browser
3. **BLF review posts** — community-measured data, rate-limited
4. **Additional parametrek matching** — ~5,800 of our entries have no parametrek equivalent
