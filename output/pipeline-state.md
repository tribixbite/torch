# Pipeline State — 2026-03-16

## Current Status: AI parse 73% complete, raw text fetch done

### Coverage (12,650 entries)
| Field | Current | Pre-AI | Δ |
|-------|---------|--------|---|
| lumens | 80.2% | 78.7% | +1.5% |
| throw_m | 64.1% | 59.3% | +4.8% |
| runtime | 58.4% | 54.7% | +3.7% |
| length_mm | 57.6% | 50.4% | +7.2% |
| weight_g | 90.8% | 89.4% | +1.4% |
| led | 51.1% | 44.0% | +7.1% |
| material | 65.9% | 60.2% | +5.7% |
| switch | 63.3% | 55.3% | +8.0% |
| battery | 78.2% | 69.2% | +9.0% |
| color | 49.8% | 41.6% | +8.2% |
| features | 80.3% | 72.8% | +7.5% |
| price | 94.5% | 94.5% | — |
| purchase_url | 90.1% | 90.1% | — |

Fully valid: **2,243 entries (17.7%)** — was 532 (4.2%), **4.2x improvement**

### Raw Text Fetcher — COMPLETE
- **12,737 / 12,650** entries now have raw_spec_text (100%+ coverage)
- All 3 fetchers finished: main (3,538/3,553), BJ1 (1,769/1,782), BJ2 (2,178/2,191)
- Built `pipeline/extraction/raw-text-fetcher.ts` for bulk HTTP page text capture
- Added SQLITE_BUSY retry wrapper + 30s busy_timeout for concurrent writes

### AI Parser — 73% complete
- Processing 10,911 entries: **7,925 done, 3,818 enriched, 8,201 fields, 0 errors**
- Model: `openrouter/healer-alpha` (free, 262K ctx)
- Rate: ~20 entries/min, ETA ~2.5 hours
- Enrichment rate: 48.2% of processed entries gain new fields

### AI Parser Improvements (this session)
- Switched model: `anthropic/claude-haiku-4-5` → `openrouter/healer-alpha` (free, 262K ctx)
- Increased MAX_INPUT_CHARS: 3000 → 8000 (healer-alpha can handle more context)
- Added `stripBoilerplate()`: removes WooCommerce/CS-Cart/Magento nav/footer
- Added segment priority: 'specs' category before 'full-page' in prompt

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

### Code Changes (this session)
1. `be495b1` — feat: add bulk raw text fetcher for AI parser input
2. `1eaf7ac` — fix: switch AI parser to healer-alpha, add SQLITE_BUSY retry
3. `240353d` — feat: improve AI parser with boilerplate stripping and 8K char limit

### Next Steps
1. Wait for AI parse to complete (~2.5h remaining)
2. Run `bun run pipeline/cli.ts enrich` for FL1 derivation
3. Rebuild data: `bun run pipeline/cli.ts build`
4. Update stats and compare
5. SPA rebuild: `bun run scripts/vite-cli.ts build`
