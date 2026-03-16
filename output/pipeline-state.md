# Pipeline State — 2026-03-16

## Current Status: Bulk raw text fetch + AI re-parse in progress

### Coverage (12,650 entries)
| Field | Coverage | Missing | Previous |
|-------|----------|---------|----------|
| lumens | 78.7% | 2,691 | 85.4% (11,805) |
| throw_m | 59.3% | 5,152 | 60.4% |
| runtime | 54.7% | 5,732 | 62.2% |
| length_mm | 50.4% | 6,279 | 48.1% |
| weight_g | 89.4% | 1,346 | 89.9% |
| led | 44.0% | 7,090 | 49.7% |
| material | 60.2% | 5,036 | 65.4% |
| switch | 55.3% | 5,660 | 62.9% |
| battery | 69.2% | 3,890 | 74.5% |
| color | 41.6% | 7,384 | 49.5% |
| features | 72.8% | 3,443 | 81.7% |
| price | 94.5% | 702 | 95.1% |
| purchase_url | 90.1% | 1,248 | — |

Note: Percentages look lower because DB grew from 11,805 to 12,650 entries (raw text bulk fetch added context for many entries that had limited data before).

Fully valid: 532 entries (4.2%)

### Raw Text Fetcher
- **11,002 / 12,650** entries now have raw_spec_text (87% coverage, was 7,434)
- 3 background fetchers still running (main: 1,325/3,553, BJ1: 400/1,782, BJ2: 825/2,191)
- Built `pipeline/extraction/raw-text-fetcher.ts` for bulk HTTP page text capture
- Added SQLITE_BUSY retry wrapper + 30s busy_timeout for concurrent writes

### AI Parser Improvements
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

### AI Parser Run (in progress)
- Full re-parse of 10,911 entries with improved parser
- Previous run: 3,587 processed, 1,816 enriched, 2,945 fields, $4.75 (Haiku)
- Current run: using healer-alpha (free), processing ~25/min

### Code Changes (this session)
1. `be495b1` — feat: add bulk raw text fetcher for AI parser input
2. `1eaf7ac` — fix: switch AI parser to healer-alpha, add SQLITE_BUSY retry
3. `240353d` — feat: improve AI parser with boilerplate stripping and 8K char limit

### Next Steps
1. Wait for raw-fetch and AI parse to complete
2. Run `bun run pipeline/cli.ts enrich` for FL1 derivation
3. Rebuild data: `bun run pipeline/cli.ts build`
4. Update stats and compare
5. SPA rebuild: `bun run scripts/vite-cli.ts build`
