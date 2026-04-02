# QA Orchestrator — `/qa`

Invoked via `/qa`. Runs a comprehensive quality assessment of the torch app.

## State File
`output/qa-state.md` — read this after context compaction to resume.

## Pipeline

### Phase 1: Data Quality
1. Run `tsx scripts/verify-specs.ts` — bounds checks, FL1 consistency
2. Run `tsx scripts/audit-data-quality.ts` — duplicates, missing images, completeness
3. Run `tsx scripts/clear-bogus-specs.ts` — clear obviously wrong throw/weight/length
4. Report summary of findings

### Phase 2: Build Verification
1. Run `bunx tsc --noEmit` — typecheck
2. Run `bun pipeline/cli.ts build` — rebuild flashlights.now.json
3. Compare entry count with previous build
4. Report any build errors or regressions

### Phase 3: Visual QA (requires ADB)
1. Start dev server: `bun run dev` (background)
2. Open in Chrome via ADB
3. Screenshot default view — verify cards render with values
4. Expand a card — verify all detail fields populated
5. Test search — verify results update
6. Test grid view — verify columns display
7. Test filter — verify filter pills and match count
8. Stop dev server, return to home screen

### Phase 4: Production Verification
1. `git push origin main` and `gh run watch`
2. After deploy, open torch.directory via ADB
3. Screenshot and verify same checks as Phase 3
4. Compare with dev server results

## ADB Screenshot Pattern
```bash
adb shell screencap -p /sdcard/DCIM/Screenshots/qa-PHASE-STEP.png
adb pull /sdcard/DCIM/Screenshots/qa-PHASE-STEP.png ~/qa-screenshot.png
magick ~/qa-screenshot.png -resize 540x1170 ~/qa-screenshot-sm.png
```

## After Each Phase
Update `output/qa-state.md` with:
- Phase completed, timestamp
- Pass/fail for each check
- Any issues found with IDs/details
