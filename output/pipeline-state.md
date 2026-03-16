# Pipeline State — 2026-03-16

## Current Status: AI parse 64% complete, raw text fetch done

### Coverage (12,650 entries)
| Field | Current | Previous | Δ |
|-------|---------|----------|---|
| lumens | 80.0% | 78.7% | +1.3% |
| throw_m | 63.4% | 59.3% | +4.1% |
| runtime | 58.1% | 54.7% | +3.4% |
| length_mm | 55.6% | 50.4% | +5.2% |
| weight_g | 90.7% | 89.4% | +1.3% |
| led | 48.5% | 44.0% | +4.5% |
| material | 65.1% | 60.2% | +4.9% |
| switch | 61.5% | 55.3% | +6.2% |
| battery | 75.9% | 69.2% | +6.7% |
| color | 48.0% | 41.6% | +6.4% |
| features | 79.4% | 72.8% | +6.6% |
| price | 94.5% | 94.5% | — |
| purchase_url | 90.1% | 90.1% | — |

Fully valid: **2,011 entries (15.9%)** — was 532 (4.2%), **3.8x improvement**

### Raw Text Fetcher — COMPLETE
- **12,737 / 12,650** entries now have raw_spec_text (100%+ coverage)
- All 3 fetchers finished: main (3,538/3,553), BJ1 (1,769/1,782), BJ2 (2,178/2,191)
- Built `pipeline/extraction/raw-text-fetcher.ts` for bulk HTTP page text capture
- Added SQLITE_BUSY retry wrapper + 30s busy_timeout for concurrent writes

### AI Parser — 64% complete
- Processing 10,911 entries: **6,950 done, 3,097 enriched, 6,489 fields, 0 errors**
- Model: `openrouter/healer-alpha` (free, 262K ctx)
- Rate: ~25 entries/min, ETA ~2.5 hours
- Enrichment rate: 44.5% of processed entries gain new fields

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
