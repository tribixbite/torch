# Search/Filter SPA Build Directive — Master Template

For **[X project/dataset]**, build a single-page search, sort, and filter application following this architecture:

## Stack

- **SvelteKit** in SPA mode (`adapter-static` with `fallback: 'index.html'`, SSR disabled) — this is a client-side app, not a content site
- **Svelte 5** — runes only (`$state`, `$derived`, `$props`, `$effect`), no legacy syntax
- **Tailwind CSS v4** — zero-config, CSS-first (`@import "tailwindcss"`), no `tailwind.config.js`
- **shadcn-svelte** + **Bits UI** — headless primitives for selects, popovers, dialogs, checkboxes, sliders, toggles
- **Service Worker** (Workbox or hand-rolled) for offline PWA support

**No Astro** — this is a fully interactive SPA, not a static content site. Every byte of UI is dynamic.

## MCP & Tooling

```
claude mcp add --transport http --scope user svelte-llm https://svelte-llm.stanislav.garden/mcp/mcp
```

Query the Svelte MCP for current Svelte 5 / SvelteKit syntax before generating components. Run all `.svelte` files through `svelte-autofixer`.

## Core UX Principles

### No pagination. No virtualization. All results in the DOM.

Every filtered result must be a real DOM node so the browser's native `Ctrl+F` / `Cmd+F` find-in-page works on the full result set at all times. This is non-negotiable.

**Performance strategy for large result sets (1K–50K+ items):**

- Use CSS `content-visibility: auto` + `contain-intrinsic-size` on each result row/card — the browser skips layout/paint for off-screen items while keeping them in the DOM and searchable
- Svelte 5's fine-grained reactivity means filter changes only touch affected items, not the full list
- Offload filtering/sorting to a **Web Worker** — post the full dataset to the worker, receive filtered indices back, keep the main thread free for UI
- Debounce text search input (150–200ms) but apply checkbox/select filters instantly
- Use `$derived` for filtered/sorted result sets — Svelte's compiler optimizes the dependency graph
- Batch DOM updates — if the dataset is huge (50K+), render in requestAnimationFrame chunks (first 500 instantly, rest in idle frames) while keeping the full filtered set committed to DOM within ~100ms

### Unlimited user control

The user must be able to filter, combine, and customize every parameter the dataset exposes. Take inspiration from Parametrek's approach:

- **Every filterable attribute** gets its own control: dropdowns/selects for enums, range sliders for numerics, checkboxes for boolean/multi-select, text input for free search
- **Filters compose with AND logic** by default (each active filter narrows results)
- **Multi-select within a filter uses OR logic** (e.g., selecting "red" and "blue" for color shows both)
- **Invert toggle** per filter — flip any filter to exclusion mode
- **"Any" reset** per filter — one click clears that filter
- **Active filter summary / pill bar** at top showing all active constraints with individual clear buttons
- **Global clear all filters** button
- **Sort controls** — click column headers or use a sort dropdown, support multi-level sort (primary + secondary)
- **Quick search** — free-text search across all visible fields, highlights matches in results

### URL state is the source of truth

Every filter, sort, and search state must be serialized to URL search params. This means:

- Shareable URLs — copy the URL, paste it, get the exact same view
- Browser back/forward navigates filter history
- Bookmarkable filtered views
- Use `$state` synced to `URLSearchParams` via a reactive store — not `goto()` or page navigation

## Page Layout

```
┌─────────────────────────────────────────────┐
│  Header: Title + Quick Search + Theme Toggle │
├──────────────┬──────────────────────────────┤
│              │  Active filter pills + Clear  │
│   Filters    │  Sort controls + Result count │
│   Sidebar    │──────────────────────────────│
│   (collaps-  │                              │
│   ible on    │  Results                     │
│   mobile)    │  (cards or table,            │
│              │   user-togglable)            │
│              │                              │
├──────────────┴──────────────────────────────┤
│  Footer (minimal)                            │
└─────────────────────────────────────────────┘
```

- **Desktop:** persistent sidebar for filters, results fill remaining width
- **Mobile:** filters collapse into a slide-out drawer or bottom sheet (shadcn-svelte Sheet component), triggered by a sticky filter button. Results stack as cards.
- **View toggle:** let user switch between card grid and compact table/list view. Persist preference in localStorage.

## Keyboard Shortcuts

Implement a global keyboard shortcut system:

| Shortcut | Action |
|---|---|
| `/` or `Ctrl+K` | Focus quick search |
| `Escape` | Clear search / close drawer / deselect |
| `Ctrl+Shift+F` | Toggle filter sidebar (desktop) / open filter drawer (mobile) |
| `Ctrl+Shift+X` | Clear all filters |
| `Ctrl+Shift+V` | Toggle card/table view |
| `?` | Show keyboard shortcuts help dialog |

- Use a `<svelte:window on:keydown>` handler at the app root
- Don't capture shortcuts when user is typing in an input/textarea
- Show a shortcut hint overlay (shadcn-svelte Dialog) on `?`

## Theming

- **System theme detection** via `prefers-color-scheme` media query as default
- **Manual override** with a three-way toggle: Light / Dark / System
- Persist preference in localStorage
- Implement via Tailwind v4's `dark:` variant with a `data-theme` attribute on `<html>`
- Transition smoothly between themes (CSS `transition` on background/color properties)

## Offline / PWA

- **Service Worker** caches the app shell (HTML, JS, CSS) and the dataset (JSON/static asset)
- On first visit, the full dataset is fetched and cached — subsequent visits work fully offline
- **Web App Manifest** with proper `name`, `short_name`, `icons`, `start_url`, `display: standalone`, `theme_color`
- Show an "Available offline" indicator after first cache
- If the dataset has a remote source, implement a **stale-while-revalidate** strategy — serve cached data instantly, fetch updates in background, show a subtle "Updated data available — refresh?" prompt
- Register the service worker in SvelteKit's app entry

## Data Architecture

- Dataset lives as a static JSON file (or multiple sharded JSONs for very large sets) in `static/` or fetched from an API on first load
- On load, the Web Worker indexes the dataset — builds lookup maps for enum fields, min/max for numeric fields, and a search index (simple trigram or prefix index, not a full search engine)
- The worker exposes a `postMessage` API: `{ type: 'filter', filters: {...}, sort: {...}, search: '...' }` → responds with `{ indices: number[], count: number }`
- Main thread holds the full dataset array in memory; uses returned indices to derive the visible list via `$derived`
- Filter definitions should be **data-driven** — define a schema like:

```typescript
type FilterDef =
  | { type: 'enum'; key: string; label: string; options: string[] }
  | { type: 'range'; key: string; label: string; min: number; max: number; unit?: string; step?: number }
  | { type: 'boolean'; key: string; label: string }
  | { type: 'multi'; key: string; label: string; options: string[] }
  | { type: 'text'; key: string; label: string; placeholder?: string }
```

This means adding a new filter is just adding an entry to the schema — no new components needed.

## Pre-Flight

1. **Understand the dataset** — What fields exist? What are their types? What's the cardinality of enum fields? What's the expected row count? This determines filter control types and performance strategy.
2. **Identify the primary use case** — Is this product comparison (Parametrek-style), resource discovery (RepoZen-style), data exploration, or inventory lookup? This shapes the default sort, the card layout, and which fields are most prominent.
3. **Extract visual identity** — Match the aesthetic to the domain. Dark theme for dev tools/tech. Clean neutral for product comparison. Whatever fits the data.

## Architecture Rules

- SvelteKit SPA mode — single `+layout.ts` with `export const ssr = false; export const prerender = false;`
- All filtering/sorting logic in a Web Worker — main thread only handles UI rendering
- URL search params as the canonical state — `$state` synced bidirectionally
- shadcn-svelte / Bits UI for all form controls (Select, Checkbox, Slider, Sheet, Dialog, Toggle, Popover)
- Tailwind v4 utility classes inline — no separate CSS files except the Tailwind import
- `content-visibility: auto` on every result item — this is the key to rendering thousands of DOM nodes without jank
- Responsive: sidebar filters on desktop, drawer/sheet on mobile, card stack on narrow viewports
- No external state management library — Svelte 5 runes + `$derived` are sufficient

## Don't

- **Don't paginate** — all filtered results must be in the DOM for Ctrl+F
- **Don't virtualize** — virtual scrolling breaks find-in-page and accessibility
- **Don't use legacy Svelte syntax** (`$:`, `export let`)
- **Don't use `tailwind.config.js`** — Tailwind v4 is CSS-only
- **Don't fetch data on every filter change** — the full dataset lives client-side, filtering is local
- **Don't block the main thread** — heavy computation goes to the Web Worker
- **Don't hide results behind "Show more" buttons** — if it passes the filter, it's visible
- **Don't use React, Vue, or any framework besides Svelte 5**
- **Don't hardcode filter definitions** — they must be data-driven from a schema
- **Don't forget PWA requirements** — manifest, service worker, offline support are not optional
- **Don't break URL shareability** — every view state must be reconstructable from the URL alone
