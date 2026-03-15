# Pipeline State — 2026-03-15

## Current Status: Detail scraping in progress

### Coverage (11,805 entries, after pollution cleanup)
| Field | Coverage | Notes |
|-------|----------|-------|
| lumens | 81.2% | |
| throw_m | 58.9% | |
| intensity_cd | 58.4% | |
| runtime | 58.7% | |
| length_mm | 44.7% | biggest gap |
| weight_g | 89.2% | good |
| led | 47.4% | cleaned 3+ LED pollution |
| material | 60.3% | cleaned 3+ material pollution |
| switch | 58.2% | cleaned 3+ switch pollution |
| battery | 70.9% | cleaned 5+ battery pollution |
| color | 45.9% | |
| features | 78.4% | good |
| price | 95.1% | excellent |

Fully valid: 335 entries (2.8%)

### Completed Scraper Runs
| Brand | Entries | Enriched | Notes |
|-------|---------|----------|-------|
| Fenix | 1100/1485 | 581 | Previous session, no --force |
| Maglite | 233/233 | 20 | Complete |
| Klarus | 317/327 | 45 | Complete |
| Ledlenser | 326/331 | 64 | Complete |
| Armytek | 200/200 | ~30 | Previous session |
| Nitecore | 225/859 | 65 | Previous session |

### Active Scrapers (with --force)
| Brand | Progress | Enriched | Notes |
|-------|----------|----------|-------|
| Nightstick | 225/337 | 71 | Good enrichment rate |
| Lumintop | 200/454 | 55 | Good enrichment rate |
| Nextorch | 75/237 | 17 | Using generic regex |
| Fenix | 375/1485 | 11 | Mostly retailer URLs, low yield |
| Nitecore | 100/859 | 10 | matchAll fix helping |
| Rovyvon | 0/231 | 0 | Just started with new extractor |

### Data Quality Fixes Applied
1. Cleaned 654 entries with 4+ materials (page-level pollution)
2. Cleaned 498 entries with 3+ materials (page-level pollution)
3. Cleaned 457 entries with 5+ battery types (page-level pollution)
4. Cleaned 388 entries with 3+ LEDs (page-level pollution)
5. Cleaned 310 entries with 3+ switch types (page-level pollution)
6. Fixed Olight Baton 3 Pro lumens concatenation bug (600120 → [1500,600,120,15,5])
7. Fixed Acebeam H17 lumens concatenation bug (750400 → [2000,750,400,300,110,20,1])
8. Cleaned false throw values from year/mAh parsing (Fenix E05, FourSevens, Malkoff)

### Code Changes This Session
1. `6aba512` — Nitecore matchAll for mode tables, hyphenated throw/impact, days runtime
2. `6c5e814` — Nextorch/RovyVon extractors, DB array size caps
3. `bef0ba5` — Allow 2000m+ throw on labeled patterns, fix mAh lookahead

### Remaining Work
1. Wait for active scrapers to finish
2. Re-run Nextorch/Rovyvon with new extractors (if 0 enrichment from old code)
3. Run `bun run pipeline/cli.ts enrich` for FL1 derivation
4. Run `bun run pipeline/cli.ts build && bun run pipeline/cli.ts stats`
5. Build SPA: `bun run scripts/vite-cli.ts build`
6. Commit rebuilt data
