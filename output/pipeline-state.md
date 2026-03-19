# Pipeline State — 2026-03-19

## Current Status: Extraction + dedup — 63.8% valid

### Coverage (9,410 flashlights / 12,239 total)
| Field | Coverage | Missing |
|-------|----------|---------|
| purchase_url | 99.0% | 94 |
| color | 99.0% | 94 |
| battery | 97.0% | 282 |
| switch | 97.3% | 252 |
| features | 96.8% | 302 |
| material | 96.4% | 334 |
| led | 96.2% | 357 |
| lumens | 95.0% | 469 |
| price | 94.4% | 526 |
| weight_g | 94.2% | 547 |
| throw_m | 88.3% | 1,105 |
| runtime | 84.3% | 1,479 |
| length_mm | 83.6% | 1,539 |

Fully valid: **6,005 entries (63.8%)**

### Near-Valid Distribution
| Missing | Count | Cumulative |
|---------|-------|------------|
| 0 | 6,005 | 6,005 (63.8%) |
| 1 | ~1,650 | ~7,655 (~81%) |
| 2 | ~1,000 | ~8,655 (~92%) |

### Single-Field Blockers (~1,650 entries missing exactly 1 field)
| Blocker | Count | Fillable? |
|---------|-------|-----------|
| runtime | ~489 | Hard — not in source text for most entries |
| length | ~428 | Hard — mostly headlamps without length specs |
| price | ~258 | Medium — Nightstick (205) B2B, Keepa has no tokens |
| throw | ~249 | Hard — manufacturer specs don't include |
| led | ~108 | Hard — generic "LED" entries |
| weight | ~45 | Hard — not in source text |
| lumens | ~37 | Hard — entries have no lumen data |
| material | ~37 | Hard — not in source text |

### Biggest Brand Gaps (near-valid, missing 1 field)
| Brand | Count | Missing | Fixable? |
|-------|-------|---------|----------|
| Nightstick | 205 | price | Need Keepa/Amazon prices (B2B site $0) |
| Nealsgadgets | 166 | runtime | No runtime on product pages |
| BatteryJunction | 162 | runtime | No runtime in BJ specs |
| Acebeam | 51 | length | Manufacturer site lacks dimensions |
| Lumintop | 42 | runtime | No runtime on lumintop.com |
| Emisar | 32 | runtime | Custom lights, no ANSI runtime |
| Olight | 33 | length | Manufacturer site lacks dimensions |

### Session Gains (3/18-3/19)
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
| `pipeline/cli.ts raw-fetch` | Fetch raw text for entries without it |
| `pipeline/cli.ts build` | Rebuild flashlights.now.json |

### Diminishing Returns
The remaining gaps are genuinely missing data — product pages don't contain the information.
Major remaining strategies:
1. **Keepa price scraping** — 526 entries need price, Keepa at -2 tokens (1/min refill)
2. **Cloudflare-blocked sites** — Pelican (72), Convoy, Sofirn, Wurkkos need headless browser
3. **Parametrek cross-reference** — structured FL1 data from parametrek.com
4. **BLF review posts** — community-measured data, rate-limited
