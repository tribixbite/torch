# Torch — Complete Requirements (DO NOT DELETE)

## A. Data Pipeline

### Sources
- Shopify brand stores: Fenix, Nitecore, RovyVon, Wuben, IMALENT, Maglite
- Shopify retailer stores: Killzone, Neal's Gadgets, Going Gear, Battery Junction, FlashlightGo, Skylumen
- WooCommerce: Skilhunt, Lumintop
- Future: 20+ stores listed in pipeline/PIPELINE.md TODO section

### Architecture
```
Shopify API → shopify-crawler.ts ─┐
WooCommerce → woocommerce-crawler.ts ─┤
HTML Scraping → detail-scraper.ts ─┤
                                    ├→ db.ts (SQLite) → build-torch-db.ts → flashlights.now.json
Inference → enrich.ts ─────────────┘
```

### Schema (FlashlightEntry — 15 required attributes)
model, brand, type[], led[], battery[], lumens[], price_usd, weight_g, length_mm,
material[], switch_type[], color[], features[], image_urls[], purchase_urls[]

## B. Data Quality Targets

1. **≥5,000 unique flashlights** — real scraped data, no mock/placeholder
2. **≥50 pink results** — proves color attribute coverage
3. **0 duplicates** — deduped by brand+model+led composite key
4. **100% valid required attributes** — all 15 fields populated per entry
5. **Zero parametrek reliance** — no parametrek data, JSON, or images

### Column Coverage Goals
- Runtime, throw, intensity: improve from current ~30-50% to ≥70%
- Weight, length: maintain ≥90% via inference
- Color: 20 canonical values, no junk/LED temps
- Features: rich boolean set (clip, magnet, USB-C, etc.)

## C. Image Requirements (CRITICAL)

### Rules
1. **ZERO external images** — no hotlinking to Shopify CDN or any external URL
2. All product images must be **scraped locally**
3. Optimized with **Sharp**: resize to consistent dimensions, WebP format
4. **High visual quality but extremely low file size** — target 5-15KB per thumb
5. Generate **sprite sheet** (100x100 grid) for fast card rendering
6. Self-hosted: either in static/ (for GitHub Pages) or Cloudflare R2 CDN

### Image Pipeline Steps
1. Extract all image_urls from SQLite DB
2. Download with rate limiting + retry + dedup
3. Sharp: resize to 200x200 max, WebP quality 70-80, strip metadata
4. Pack into sprite sheet (100x100 tiles for cards)
5. Update `_pic` column: sprite coords `[col, row]`
6. Remove old parametrek sprite (`flashlights.sprites.jpg`)

## D. SPA / Frontend

### Stack
- SvelteKit (adapter-static, SPA mode, SSR off)
- Svelte 5 runes ($state, $derived, $props, $effect)
- Tailwind CSS v4 (CSS-first)
- Web Worker for all filter/sort logic

### Filter Types (24 filterable columns)
| Type | Columns |
|------|---------|
| multi (9) | brand, type, blink, levels, led_color, switch, color, material, impact |
| mega-multi (3) | led, battery, environment |
| boolean (1) | features |
| range (4) | throw, efficacy, beam_angle, year |
| log-range (9) | wh, lumens, runtime, intensity, length, bezel_size, body_size, weight, price |
| multiple/composite (2) | _bat→[battery,wh], diam→[bezel_size,body_size] |

### Filter Logic (parametrek parity)
- any: match if ANY selected option found
- all: match if ALL selected found
- only: match if data contains ONLY selected
- none: match if NO selected found
- boolean: yes-checked must be present, no-checked absent
- range: data value between min/max slider bounds

### URL Codec
- Multi: `?brand=Fenix,Olight` or `?type=all,flashlight,headlamp`
- Boolean: `?features=clip,magnet,~bluetooth`
- Range: `?lumens=100,1000` or `?price=_,300,dec`
- SI prefixes supported, sort embedded as 3rd element

### UI Requirements
- Dark mode default, light/system toggle
- Mobile responsive: sidebar Sheet on mobile, sticky sidebar on desktop
- Keyboard shortcuts: /, Ctrl+K, Escape, etc.
- content-visibility: auto for off-screen paint skipping
- PWA with service worker + manifest
- Star/pin flashlights (localStorage)

## E. Deployment

- Domain: torch.directory
- Hosting: GitHub Pages via GitHub Actions
- Build: `bun run build` → adapter-static → `/build`
- All images self-hosted (no external dependencies)

## F. Code Quality

- TypeScript everywhere, no JS
- Svelte 5 runes only (no legacy stores)
- No placeholders, stubs, or mock data
- DRY production-level code with explanatory comments
- `# TODO` comments for unfinished items
- Conventional commits, signed with emdash + model version

## G. Verification

```bash
bun run pipeline:stats        # ≥5000 entries
bun run pipeline:check-dupes  # 0 duplicates
bun run pipeline:validate     # 100% valid attributes
bun run pipeline:search pink  # ≥50 pink results
bun run pipeline:verify-all   # Full suite
bun run build                 # Static build succeeds
```

## H. Enrichment (Inference Rules)

- **length_mm**: battery type → estimate (18650→130mm, 21700→140mm, etc.)
- **weight_g**: battery weight + material multiplier (copper 1.5x, titanium 0.9x)
- **lumens**: LED-type estimates (XP-G3→500lm, XHP70→5000lm, etc.)
- **price_usd**: brand-based typical pricing fallback
- **color**: keyword detection from model name (20 canonical colors)
- **material**: brand defaults (most → aluminum)
- **switch**: brand defaults (most → side switch)
- **battery**: model name patterns (18650, 21700, AA, etc.)

## I. Continuation

Work iteratively until ALL criteria in sections A-H are 100% met.
No stopping until every filter works, every image is self-hosted,
and the site is fully deployed and verified.

— opus-4-6
