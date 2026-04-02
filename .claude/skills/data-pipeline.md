# Torch Data Pipeline Operations

Common pipeline operations for the torch flashlight database.

## Database
- **Path**: `pipeline-data/db/torch.sqlite`
- **Table**: `flashlights`
- **Runtime**: `tsx` for better-sqlite3 scripts, `bun` for bun:sqlite scripts

## Quick Commands

### Build JSON for frontend
```bash
bun pipeline/cli.ts build
```
Reads from SQLite, applies build-time filters (accessory exclusion, normalizers), writes `static/flashlights.now.json`.

### Run data quality audit
```bash
tsx scripts/audit-data-quality.ts    # → output/data-audit.md
tsx scripts/verify-specs.ts          # appends to output/data-audit.md
```

### Clear bogus specs
```bash
tsx scripts/clear-bogus-specs.ts     # Clears throw>5km, weight>5kg, length<10mm/>1m
```

### Enrich from manufacturer pages
```bash
tsx scripts/enrich-priority-brands.ts  # 48 brands, loops until converged
```

### Normalize fields
```bash
tsx scripts/normalize-all.ts         # material + switch + features (runs self-tests first)
tsx scripts/normalize-leds.ts        # LED canonicalization
tsx scripts/normalize-batteries.ts   # Battery canonicalization
```

### Cross-reference within brand
```bash
tsx scripts/model-crossref.ts        # Propagate specs between same-model entries
```

### Rebuild sprites
```bash
bun pipeline/cli.ts sprites          # Grid build → classify → sprite sheet
```

## Normalizer Modules
All in `pipeline/normalization/`:
| Module | Test Cases | Reduction |
|--------|-----------|-----------|
| `led-normalizer.ts` | 107 | 904 → 401 (56%) |
| `battery-normalizer.ts` | 166 | 647 → 94 (85%) |
| `material-normalizer.ts` | 79 | 220 → 24 (89%) |
| `switch-normalizer.ts` | 70 | 132 → 22 (83%) |
| `features-normalizer.ts` | 60 | 259 → 182 (30%) |

## Runtime Notes
- **tsx scripts**: Use `tsx scripts/foo.ts` — these import `better-sqlite3` (native node module)
- **bun scripts**: Use `bun pipeline/cli.ts <cmd>` — these import `bun:sqlite`
- **Never mix**: `bun` can't load better-sqlite3, `tsx` can't load bun:sqlite
- **Rebuild native**: `npm rebuild better-sqlite3` after node version changes
- **PRAGMA**: Always set `busy_timeout = 30000` and `journal_mode = WAL`

## Deploy
```bash
bun pipeline/cli.ts build            # Rebuild JSON
git add static/flashlights.now.json
git commit -m "data: <description>"
git push origin main                  # Triggers GitHub Pages deploy
gh run watch $(gh run list -L1 --json databaseId -q '.[0].databaseId')
```
