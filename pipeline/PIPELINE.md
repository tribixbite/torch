# Torch Data Pipeline

## Architecture

```
Shopify API ──→ shopify-crawler.ts ──┐
WooCommerce API → woocommerce-crawler.ts ─┤
HTML Scraping ──→ detail-scraper.ts ──┤
                                     ├──→ db.ts (SQLite) ──→ build-torch-db.ts ──→ flashlights.now.json
Inference ──────→ enrich.ts ──────────┘
```

## Current Sources (Active)

### Shopify Brand Stores
| Brand | Domain | Products |
|-------|--------|----------|
| Fenix | fenixlighting.com | ~300 |
| Nitecore | nitecorestore.com | ~900 |
| RovyVon | rovyvon.com | ~100 |
| Wuben | wubenlight.com | ~100 |
| IMALENT | imalentstore.com | ~60 |
| Maglite | maglite.com | ~300 |

### Shopify Retailer Stores
| Retailer | Domain | Products | Notes |
|----------|--------|----------|-------|
| Killzone | killzoneflashlights.com | ~600 | Multi-brand, Emisar/ReyLight |
| Neal's Gadgets | nealsgadgets.com | ~1200 | JetBeam, Lumintop, Fireflies |
| Going Gear | goinggear.com | ~17000 | Major EDC retailer |
| Battery Junction | batteryjunction.com | ~15000 | Battery + flashlight retailer |
| FlashlightGo | flashlightgo.com | ~800 | Fitorch and others |
| Skylumen | skylumen.com | ~250 | Vinh's custom/modded lights |

### WooCommerce Stores
| Brand | Domain | Products |
|-------|--------|----------|
| Skilhunt | skilhunt.com | ~30 |
| Lumintop | lumintop.com | ~170 |

## TODO: New Sources to Add

### Shopify Brand Stores (Verified Working)
- [ ] Klarus — klarustore.com (~88 products)
- [ ] Nextorch — nextorch.com (~154 products)
- [ ] PowerTac — powertac.com (~129 products)
- [ ] Nightstick — nightstick.com (250+ products)
- [ ] Malkoff Devices — malkoffdevices.com (~129 products)
- [ ] ReyLight — reylight.net (~39 products)
- [ ] FourSevens/Prometheus — foursevens.com / darksucks.com (~201 products)
- [ ] Modlite — modlite.com (~124 products, weapon lights)
- [ ] Cloud Defensive — clouddefensive.com (~104 products, REIN lights)
- [ ] Ledlenser USA — ledlenserusa.com (brand store)
- [ ] Pelican — shop.pelican.com (brand store)

### Shopify Retailer Stores (Verified Working)
- [ ] JLHawaii808 — jlhawaii808.com (250+ Emisar/Noctigon builds)
- [ ] Flashlight World CA — flashlightworld.ca (250+ Canadian dealer)
- [ ] J2 LED Flashlight — j2ledflashlight.com (~246 Canadian dealer)
- [ ] Fenix Store — fenix-store.com (~219 US authorized dealer)
- [ ] Torch Direct UK — torchdirect.co.uk (UK retailer)
- [ ] Lupine Lights — lupinelights.com (German headlamps, EUR)
- [ ] Thyrm — thyrm.com (accessories, SwitchBack rings)

### WooCommerce Stores (Verified Working)
- [ ] EagTac — eagtac.com (~80+ products, use `/wp-json/wc/store/products` without v1!)
- [ ] Oveready — oveready.com (~100+ premium custom BOSS flashlights)

### BigCommerce (Requires Token)
- [ ] SureFire — surefire.com (GraphQL with JWT, token expires)

### Not Accessible (No Public API)
- Olight — olight.com (custom/proprietary platform)
- Sofirn — sofirnlight.com (Shoplazza, Cloudflare protected)
- Wurkkos — wurkkos.com (UeeShop, no API)
- Acebeam — acebeam.com (nopCommerce, no API)
- Armytek — armytek.com (CS-Cart, no API)
- Zebralight — zebralight.com (Shift4Shop, no API)
- Streamlight — streamlight.com (custom, no API)
- Coast — coastportland.com (Shopify behind Vercel, 429)

## Data Quality Notes

### Known Issues
- `wh` (capacity), `efficacy`, `beam_angle`, `year` — 0% populated (not available from Shopify/WooCommerce APIs)
- `bezel_size` (~1.5%), `body_size` (~1.0%) — rarely available from product listings
- `runtime` (~46%), `throw` (~34%), `intensity` (~28%) — partially available
- `impact` (~5.5%) — rarely listed in product data
- `environment` (~33%) — IP ratings sometimes available

### Inference Rules (enrich.ts)
- **length_mm**: Inferred from battery type (18650 → ~130mm, 21700 → ~140mm, etc.)
- **weight_g**: Battery weight + material multiplier (copper 1.5x, titanium 0.9x, etc.)
- **lumens**: LED-type-based estimates (XP-G3 → 500lm, XHP70 → 5000lm, etc.)
- **price_usd**: Brand-based typical pricing when not available
- **color**: Detected from model name keywords (Pink, Rose, OD Green, etc.)
- **material**: Brand defaults (most → aluminum)
- **switch**: Brand defaults (most → side switch)
- **battery**: Model name patterns (18650, 21700, AA, etc.)

### Color Normalization
All colors are normalized to a 20-value canonical set:
black, blue, brass, bronze, brown, camo, clear, copper, gray, green,
orange, pink, purple, rainbow, red, silver, tan, teal, white, yellow

## Pipeline Commands

```bash
bun run pipeline/cli.ts discover     # Keepa ASIN discovery
bun run pipeline/cli.ts scrape [n]   # Keepa product scraping
bun run pipeline/cli.ts shopify [brand]  # Shopify store crawl
bun run pipeline/cli.ts crawl [brand]    # Manufacturer website crawl
bun run pipeline/cli.ts detail-scrape    # HTML page scraping
bun run pipeline/cli.ts enrich       # Inference enrichment
bun run pipeline/cli.ts cleanup      # Remove dupes + imageless
bun run pipeline/cli.ts build        # Generate flashlights.now.json
bun run pipeline/cli.ts stats        # Show statistics
bun run pipeline/cli.ts validate     # Check required attributes
bun run pipeline/cli.ts verify-all   # Full verification suite
bun run pipeline/cli.ts run          # Full pipeline
```
