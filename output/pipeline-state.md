# Pipeline State — 2026-03-17

## Current Status: Vision pipeline + expanded extraction — 27.9% valid

### Coverage (10,775 entries)
| Field | Current | Previous | Δ |
|-------|---------|----------|---|
| lumens | 80.9% | 80.6% | +0.3% |
| throw_m | 69.0% | 63.9% | +5.1% |
| runtime | 63.4% | 63.1% | +0.3% |
| length_mm | 71.8% | 60.1% | +11.7% |
| weight_g | 91.1% | 90.5% | +0.6% |
| led | 66.9% | 54.4% | +12.5% |
| battery | 87.5% | 81.3% | +6.2% |
| switch | 79.7% | 72.5% | +7.2% |
| material | 79.2% | 78.6% | +0.6% |
| color | 80.1% | 56.2% | +23.9% |
| features | 90.8% | 90.6% | +0.2% |
| price | 93.9% | 93.5% | +0.4% |
| purchase_url | 90.8% | 90.8% | — |

Fully valid: **3,006 entries (27.9%)** — up from 1,327 (12.3%)

### Session 3 Work (2026-03-17)

#### Feat: Expanded raw text extraction (Phase 5b)
- LED from raw text: +1,339 entries (XHP50/70, XP-L/G/E, SST-20/40, SFT40, 519A, LH351D)
- Length from raw text: +1,255 entries ("Length: 135mm", dimensions, inch conversion)
- Battery from raw text: +595 entries ("1x21700", "powered by 18650" patterns)
- Throw from raw text: +534 entries ("beam distance: 500m", ANSI FL1 patterns)
- Weight from raw text: +16 entries
- Color expanded patterns: +25 entries (color/finish field patterns)
- Total: 2,245 entries enriched in this phase

#### Feat: Vision pipeline (Gemini 2.0 Flash)
- Built grid composer: 5×5 thumbnail grids (100×100px each) with labels
- Processed 226 grids covering 5,647 entries missing switch or color
- Switch classified: +710 entries (tail, side, dual, rotary, electronic)
- Color classified: +2,536 entries (black, silver, OD green, desert tan, etc.)
- Non-flashlight items: 2,319 identified (accessories, batteries, lanterns)
- Pipeline: vision-grid-builder.ts → vision-classifier.ts → DB update

#### Feat: BLF scraper (BudgetLightForum)
- Ran first BLF enrichment pass: 300 entries processed, 26 enriched
- Uses Discourse API to search for review threads
- Extracts specs from forum posts (LED, switch, runtime, material)
- Rate-limited by BLF at ~1 req/2s with 429 backoff

#### Feat: Wurkkos curl scraper
- Discovered wurkkos.com loads via curl (UeeShop, not Cloudflare-blocked on collections)
- Scraped 48 products with lumens, LED, battery, price, material, throw
- Imported 11 entries with 15 new fields

#### Gemini plan review via PAL MCP
- Submitted full gap analysis to gemini-3-pro-preview for strategic review
- Confirmed attack ordering: quick wins → CFC headless → vision → targeted re-parse
- Identified missed opportunities: model name LED/color, histogram color detection

### Session 2 Work (2026-03-17)

#### Fix: Sprite ID-based mapping
- Rebuilt sprite with `idToSprite` mapping in metadata (10,281 images)
- Fixed image mismatch issue on live site

#### Fix: Enrich CLI signature mismatch
- Removed `applyInference` and `nowValid`/`stillInvalid` from cmdEnrich

#### Feat: Phase 5 enrichment — raw text extraction
- Switch +611, Material +1,058, Runtime +153, Features +860, Color +47

#### Feat: Pelican catalog crawler
- 50 products from www.pelican.com with full FL1 specs
- Uses fetchWithCurl() for Cloudflare bypass

### Previous Session Work (2026-03-16)
(See git history for Phase 1-5 details: brand aliases, dedup, review scraping, AI parse)

### Remaining Gaps / TODO
- **Runtime (36.6% missing)**: Hardest gap — not in raw text for most remaining entries
- **LED (33.1%)**: Most pages don't list LED. Some extractable from product descriptions.
- **Throw (31.0%)**: FL1 testing data, limited to manufacturer spec tables
- **Length (28.2%)**: Need structured spec tables from more manufacturers
- **Material (20.8%)**: Many generic retailer listings don't specify
- **Switch (20.3%)**: Vision pipeline handled most, remaining entries lack images
- **Color (19.9%)**: Vision pipeline handled most, remaining entries lack images
- **Lumens (19.1%)**: Some entries are accessories incorrectly classified
- **CFC headless**: Sofirn (Shoplazza), Petzl (Salesforce) — still need browser scraping
- **PDF spec sheets**: No PDF detection pipeline yet — potential goldmine for missing specs
