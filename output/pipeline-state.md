# Pipeline State — 2026-03-16

## Current Status: AI parser complete, data rebuilt

### Coverage (11,805 entries)
| Field | Coverage | Delta (AI parser) | Delta (total) |
|-------|----------|-------------------|---------------|
| lumens | 85.4% | +0.5% | +4.2% |
| throw_m | 60.4% | +1.4% | +1.5% |
| intensity_cd | 58.9% | — | +0.5% |
| runtime | 62.2% | +2.2% | +3.5% |
| length_mm | 48.1% | +2.0% | +3.4% |
| weight_g | 89.9% | +0.9% | +0.7% |
| led | 49.7% | +2.2% | +2.3% |
| material | 65.4% | +4.3% | +5.1% |
| switch | 62.9% | +2.6% | +4.7% |
| battery | 74.5% | +3.5% | +3.6% |
| color | 49.5% | +2.9% | +3.6% |
| features | 81.7% | +2.2% | +3.3% |
| price | 95.1% | 0.0% | 0.0% |

Fully valid: 579 entries (4.9%) — was 360 (3.0%)

### AI Parser Results
- **3,587 entries processed** (all with raw_spec_text + missing fields)
- **1,816 enriched** (51% hit rate)
- **2,945 fields added** (~1.6 fields per enriched entry)
- **0 errors**, $4.75 total cost via OpenRouter/Haiku
- Shopify body_html now saved as raw_spec_text for all stores (including Pelican)

### Completed Scraper Runs (all brands)
| Brand | Scraped | Enriched | Rate | Notes |
|-------|---------|----------|------|-------|
| Fenix | 1100/1485 | 581 | 53% | Previous session |
| Streamlight | 342/344 | 259 | 76% | Best rate, structured extractor |
| Nightstick | 337/337 | 123 | 37% | Complete |
| Lumintop | 439/454 | 101 | 23% | Complete |
| Nextorch | 229/237 | 92 | 40% | New structured extractor |
| Nitecore | 225/859 | 65 | 29% | Partial, retailer URLs only |
| Ledlenser | 326/331 | 64 | 20% | Complete |
| Klarus | 317/327 | 45 | 14% | Complete |
| FourSevens | 171/173 | 36 | 21% | Many accessories in data |
| Skilhunt | 85/101 | 33 | 39% | Complete |
| Armytek | 200/200 | ~30 | 15% | Previous session |
| Maglite | 233/233 | 20 | 9% | Complete |
| Pelican | 84/855 | via AI | — | Shopify JSON + AI parser |

### Data Quality Fixes Applied
1. Cleaned 654 entries with 4+ materials (page-level pollution)
2. Cleaned 498 entries with 3+ materials (page-level pollution)
3. Cleaned 457 entries with 5+ battery types (page-level pollution)
4. Cleaned 388 entries with 3+ LEDs (page-level pollution)
5. Cleaned 310 entries with 3+ switch types (page-level pollution)
6. Fixed lumens concatenation bugs (Olight Baton 3 Pro, Acebeam H17)
7. Cleaned false throw values from year/mAh parsing
8. DB array size caps: led≤2, battery≤4, material≤2, switch≤2

### Code Changes
1. `6aba512` — Nitecore matchAll for mode tables, hyphenated throw/impact, days runtime
2. `6c5e814` — Nextorch/RovyVon extractors, DB array size caps
3. `bef0ba5` — Allow 2000m+ throw on labeled patterns, fix mAh lookahead
4. `c51dae6` — Extract lumens from product titles in enrichment pipeline
5. `37d7894` — Data rebuild with cleaned pollution + title lumens + scraper gains
6. `7eb90ff` — Data rebuild with Streamlight/Skilhunt/Lumintop/FourSevens gains
7. `815d636` — AI parser implementation (OpenRouter/Haiku)
8. `8228e4e` — Data rebuild with AI parser gains

### Remaining Coverage Gaps (structural)
- length_mm (51.9% missing): Most retailer pages don't list dimensions
- color (50.5% missing): Body color rarely in structured specs
- led (50.3% missing): LED model names scattered in descriptions
- throw_m (39.6% missing): Only on manufacturer spec sheets
- switch (37.1% missing): Rarely in structured data
- material (34.6% missing): Usually in descriptions, not spec tables

### Next Steps
1. Re-run AI parser after future scraper runs (new raw_spec_text entries)
2. Headless browser for JS-rendered detail pages (Pelican individual products)
3. More brand-specific extractors for remaining 0% brands
4. SPA is built and deployed
