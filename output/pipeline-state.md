# Pipeline State — 2026-03-16

## Current Status: AI parse COMPLETE, data rebuilt

### Coverage (12,650 entries)
| Field | Final | Pre-AI | Δ |
|-------|-------|--------|---|
| lumens | 81.2% | 78.7% | +2.5% |
| throw_m | 65.5% | 59.3% | +6.2% |
| runtime | 59.8% | 54.7% | +5.1% |
| length_mm | 60.1% | 50.4% | **+9.7%** |
| weight_g | 91.1% | 89.4% | +1.7% |
| led | 55.0% | 44.0% | **+11.0%** |
| battery | 82.5% | 69.2% | **+13.3%** |
| switch | 66.2% | 55.3% | **+10.9%** |
| material | 67.2% | 60.2% | +7.0% |
| color | 53.3% | 41.6% | **+11.7%** |
| features | 83.5% | 72.8% | **+10.7%** |
| price | 94.5% | 94.5% | — |

Fully valid: **2,497 entries (19.7%)** — was 532 (4.2%), **4.7x improvement**

### AI Parser — COMPLETE
- Processed: 10,428 / 10,911 (483 skipped)
- Enriched: 5,291 entries (50.7% enrichment rate)
- Fields added: 11,573
- Errors: 0
- Tokens: 14.0M input + 418K output (free via healer-alpha)
- Model: `openrouter/healer-alpha` (free, 262K ctx)

### Raw Text Fetcher — COMPLETE
- **12,737 / 12,650** entries have raw_spec_text (100%+ coverage)
- All 3 fetchers finished: main (3,538/3,553), BJ1 (1,769/1,782), BJ2 (2,178/2,191)

### FL1 Enrichment — COMPLETE
- 1,314 entries enriched via FL1 derivation (throw ↔ intensity)

### Data Build — COMPLETE
- 12,317 entries (333 accessories filtered)
- JSON: 7,712 KB
- SPA built successfully

### Shadow Verification Results (12 domains)
| Domain | Entries | Grade | Key Finding |
|--------|---------|-------|-------------|
| batteryjunction | 2,605 | PARTIAL | Retailer spec table — switch extractable, LED/battery absent |
| goinggear | 1,517 | PARTIAL | Clean key:value but missing LED/battery/dimensions |
| nealsgadgets | 1,163 | GOOD | Rich bullets — LED, battery, switch extractable |
| fenixlighting | 640 | GOOD | Structured spec block, nearly complete |
| flashlightgo | 604 | GOOD | Full product descriptions, length only gap |
| killzone | 468 | GOOD | LED model extractable, dimensions absent |
| acebeam | 343 | GOOD | length present but not extracted (parser gap fixed) |
| nitecorestore | 215 | PARTIAL | Short marketing copy only (~1,391 chars avg) |
| nextorch | 156 | PARTIAL | Clean spec block but omits LED/switch/material |
| armytek | 90 | GOOD | length in spec table (parser gap fixed with char increase) |
| intl-outdoor | 58 | GOOD | LED/switch present, multi-variant format |
| skilhunt | 39 | GOOD | 4/5 missing fields in text (boilerplate was hiding them) |

### AI Parser Improvements (this session)
- Switched model: `anthropic/claude-haiku-4-5` → `openrouter/healer-alpha` (free, 262K ctx)
- Increased MAX_INPUT_CHARS: 3000 → 8000 (healer-alpha can handle more context)
- Added `stripBoilerplate()`: removes WooCommerce/CS-Cart/Magento nav/footer
- Added segment priority: 'specs' category before 'full-page' in prompt

### Code Changes (this session)
1. `be495b1` — feat: add bulk raw text fetcher for AI parser input
2. `1eaf7ac` — fix: switch AI parser to healer-alpha, add SQLITE_BUSY retry
3. `240353d` — feat: improve AI parser with boilerplate stripping and 8K char limit

### Next Steps
1. Consider second AI parse pass on entries that weren't enriched
2. CFC headless scraping for JS-rendered pages (Pelican, Olight, Wurkkos, Sofirn)
3. Run `bun run pipeline/cli.ts stats` for detailed per-brand breakdown
4. Deploy SPA update
