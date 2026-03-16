# Pipeline State — 2026-03-15

## Current Status: Detail scraping complete, data rebuilt

### Coverage (11,805 entries)
| Field | Coverage | Delta vs start |
|-------|----------|----------------|
| lumens | 84.9% | +3.7% |
| throw_m | 59.0% | +0.1% |
| intensity_cd | 58.9% | +0.5% |
| runtime | 60.0% | +1.3% |
| length_mm | 46.1% | +1.4% |
| weight_g | 89.0% | -0.2% |
| led | 47.5% | +0.1% |
| material | 61.1% | +0.8% |
| switch | 60.3% | +2.1% |
| battery | 71.0% | +0.1% |
| color | 46.6% | +0.7% |
| features | 79.5% | +1.1% |
| price | 95.1% | 0.0% |

Fully valid: 360 entries (3.0%)

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

### Brands with 0 enrichment (killed early)
Pelican (JS-rendered), Weltool, Princeton Tec, EagleTac, SureFire, Wuben,
Imalent, Emisar, PowerTac, Convoy, Malkoff, JETBeam, Olight, Acebeam

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

### Remaining Coverage Gaps (structural)
- length_mm (53.9% missing): Most retailer pages don't list dimensions
- color (53.4% missing): Body color rarely in structured specs
- led (52.5% missing): LED model names scattered in descriptions
- throw_m (41.0% missing): Only on manufacturer spec sheets
- switch (39.7% missing): Rarely in structured data
- material (38.9% missing): Usually in descriptions, not spec tables

### Next Steps
1. Consider headless browser for JS-rendered sites (Pelican, Olight store)
2. Build more brand-specific structured extractors for high-value targets
3. Evaluate AI-assisted extraction from raw_spec_text table
4. SPA is built and deployed
