# Torch SvelteKit SPA Patterns

## Stack
- SvelteKit with adapter-static (SPA mode)
- Svelte 5 with runes ($state, $derived, $props, $effect)
- Tailwind v4 CSS-first (`@theme` in app.css, not tailwind.config)
- Web Worker for off-thread filtering
- TypeScript strict mode

## Key Architecture
```
+page.svelte          → loads flashlights.now.json, creates FlashlightDB
  ├─ FilterSidebar    → URL-based filter state (urlState)
  ├─ ResultsList      → virtualised card/grid rendering
  │   ├─ FlashlightCard → individual card with expand toggle
  │   └─ SpriteImage    → sprite sheet thumbnail renderer
  └─ Web Worker       → off-thread filter/sort/search
```

## Svelte 5 Proxy Gotchas

### Array.isArray() fails on $state arrays
```typescript
// BAD: returns false for proxied arrays
if (Array.isArray(value)) { ... }

// GOOD: proxy-safe check
function isArrayLike(v: unknown): v is unknown[] {
    return Array.isArray(v) ||
        (v !== null && typeof v === 'object' &&
         'length' in v && typeof (v as any).length === 'number' &&
         !(v instanceof String));
}
```

### Can't postMessage proxied objects
```typescript
// BAD: proxy can't be cloned
worker.postMessage(db);

// GOOD: unwrap first
worker.postMessage(JSON.parse(JSON.stringify(db)));
```

## Data Flow
1. `flashlights.now.json` → columnar format: `{ head, data[][], opts, unit, ... }`
2. `FlashlightDB` type: `{ head: string[], data: unknown[][], sprite: string, ... }`
3. `ColumnDef` built from JSON metadata: `{ id, index, display, unit, filterType, cvis, ... }`
4. Filters stored in URL params via `urlState` (reactive Svelte 5 state)

## Unit Formatting
- `col.unit = "{} m"` → `"203 m"` (template replacement)
- `col.unit = "{si}lm"` → `"1.6k lm"` (SI prefix via smartFixed)
- `col.unit = "{link}"` → rendered as `<a>` tag
- `col.unit = ""` → raw display value (no template)

## Dev Server
```bash
bun run dev    # Uses scripts/vite-cli.ts (bun shebang bypass)
```

## Typecheck
```bash
bunx tsc --noEmit    # or: bunx svelte-check
```

## Build + Deploy
```bash
bun run build        # adapter-static → build/
git push origin main # GitHub Pages auto-deploy
```
