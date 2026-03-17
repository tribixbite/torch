# Data Audit — Torch Pipeline Source & Coverage

> Auto-generated 2026-03-16. Run `bun run pipeline/cli.ts stats` for live numbers.

## Source Domain Inventory

### Manufacturer Direct (27 domains)

| Domain | Brand | Platform | Detail Extractor | Raw Text | Entries | Valid% |
|--------|-------|----------|------------------|----------|---------|--------|
| fenixlighting.com | Fenix | Shopify | cus-lqd-specs | 640 | 1,538 | 12% |
| nitecorestore.com | Nitecore | Shopify | product-spec-table | 228 | 915 | 16% |
| olightstore.com | Olight | Shopify/Next.js | API+tech-table | — | 906 | 19% |
| acebeam.com | Acebeam | nopCommerce | #features tab | 343 | 727 | 18% |
| lumintop.com | Lumintop | WooCommerce | — | 265 | 481 | 14% |
| nightstick.com | Nightstick | Shopify | product-specs | 816 | 455 | **0%** |
| ledlenserusa.com | Ledlenser | Shopify | technical-data | 150 | 390 | 6% |
| streamlight.com | Streamlight | Custom | productSpecs | — | 344 | 9% |
| klaruslight.com | Klarus | Custom PHP | div.sme/pme | 118 | 332 | 10% |
| maglite.com | Maglite | Shopify | product__block | 276 | 297 | 7% |
| nextorch.com | Nextorch | Shopify | TECH SPECS li | 157 | 264 | 10% |
| rovyvon.com | Rovyvon | Shopify | SPECS br | 129 | 258 | 7% |
| jetbeamlight.com | JETBeam | WooCommerce | — | 16 | 253 | 17% |
| armytek.com | Armytek | CS-Cart | ty-product | 90 | 219 | 11% |
| powertac.com | PowerTac | Shopify | **none** | 134 | 217 | **0%** |
| foursevens.com | FourSevens | Shopify | **none** | 239 | 209 | 2% |
| surefire.com | SureFire | BigCommerce | **none** | 76 | 203 | 1% |
| shop.pelican.com | Pelican | Shopify | **none (JS)** | 98 | 193 | 1% |
| skylumen.com | Skylumen | Shopify | **none** | 194 | 193 | **0%** |
| eagtac.com | EagleTac | WooCommerce | — | 81 | 155 | 5% |
| imalentstore.com | Imalent | Shopify | **none** | 93 | 144 | 8% |
| malkoffdevices.com | Malkoff | Shopify | **none** | 129 | 134 | **0%** |
| wubenlight.com | Wuben | Shopify | **none** | 83 | 128 | 3% |
| intl-outdoor.com | Emisar/Noctigon | Magento 1.x | **none** | 58 | 159 | 1% |
| reylight.net | ReyLight | Shopify | **none** | 38 | 110 | **0%** |
| skilhunt.com | Skilhunt | WooCommerce | — | 39 | 101 | 24% |
| zebralight.com | Zebralight | Shift4Shop | **none** | 46 | 50 | 0% |
| modlite.com | Modlite | Shopify | **none** | 47 | 38 | 0% |
| clouddefensive.com | Cloud Defensive | Shopify | **none** | 38 | 38 | 0% |

### Multi-brand Retailers (10 domains)

| Domain | Raw Text | Entries | Top Brands |
|--------|----------|---------|------------|
| batteryjunction.com | 4,163 | ~2,600 | Olight, Fenix, Streamlight, Nitecore, Ledlenser |
| goinggear.com | 1,517 | ~1,500 | Olight, Nitecore, Acebeam, Lumintop, Armytek |
| nealsgadgets.com | 1,203 | ~1,160 | Lumintop, Nitecore, Convoy, Mateminco |
| torchdirect.co.uk | 630 | ~1,650 | UK multi-brand |
| flashlightgo.com | 604 | ~600 | Fitorch, multi-brand |
| killzoneflashlights.com | 498 | ~470 | Emisar/Noctigon, Weltool, Acebeam |
| jlhawaii808.com | 219 | ~530 | Emisar/Noctigon specialist |
| flashlightworld.ca | 324 | ~860 | Canadian multi-brand |
| fenix-store.com | 158 | ~410 | Fenix authorized dealer |
| skylumen.com | 194 | 193 | Custom/modded |

### Review/Blog Sites (6 configured)

| Site | Raw Text | Has AI Parse? | Notes |
|------|----------|---------------|-------|
| zeroair.org | 550 | **Needs pass** | LED, switch, length, runtime gaps |
| 1lumen.com | 685 | **Needs pass** | LED, switch, runtime gaps |
| tgreviews.com | 135 | **Needs pass** | LED, switch, runtime gaps |
| sammyshp.de | 49 | **Needs pass** | Small but quality data |
| zakreviews.com | 26 | **Needs pass** | Small, curated reviews |
| budgetlightforum.com | — | BLF scraper ran | Separate enrichment path |

## Brand Alias Consolidation

| Canonical | Aliases Merged | Notes |
|-----------|---------------|-------|
| FourSevens | Prometheus Lights (5 entries), DarkSucks, 4Sevens | ✅ Merged |
| Nightstick | Bayco | Same company |
| Emisar | emisar noctigon (shared domain) | Keep separate from Noctigon |
| Noctigon | — | Shared intl-outdoor.com with Emisar |
| Nitecore | Nightcore | Typo normalization |
| EagleTac | EagTac | Abbreviation |
| Malkoff | Malkoff Devices | Full name variant |

## Coverage Summary

**Total entries**: 12,650
**Fully valid**: 1,360 (10.8%)

### Attribute Coverage Gaps (sorted by missing %)

| Attribute | Missing | % Missing | Priority |
|-----------|---------|-----------|----------|
| led | 5,658 | 44.7% | HIGH — review sites have this |
| color | 5,595 | 44.2% | MEDIUM — often in title/variant |
| runtime_hours | 5,084 | 40.2% | HIGH — review sites have this |
| length_mm | 5,062 | 40.0% | HIGH — spec tables |
| throw_m | 4,479 | 35.4% | HIGH — FL1 derivation possible |
| switch | 4,278 | 33.8% | HIGH — review sites have this |
| material | 4,139 | 32.7% | MEDIUM — often aluminum default |
| lumens | 2,351 | 18.6% | MEDIUM — most sources have this |
| battery | 2,202 | 17.4% | MEDIUM — most sources have this |
| features | 2,084 | 16.5% | LOW — harder to standardize |
| purchase_url | 1,248 | 9.9% | LOW — have source URLs |
| weight_g | 1,133 | 9.0% | MEDIUM — spec tables |
| price_usd | 702 | 5.5% | LOW — Shopify has prices |

## Brands Needing Targeted Attention

### 0% Valid (>100 entries)

| Brand | Entries | Raw Text | Action |
|-------|---------|----------|--------|
| Nightstick | 455 | 816 | AI parse raw text — has detail extractor |
| PowerTac | 217 | 134 | Need AI parse, consider detail extractor |
| Skylumen | 193 | 194 | Custom/modded — AI parse raw text |
| Petzl | 138 | 0 | Need raw text fetch + AI parse |
| Malkoff | 134 | 129 | AI parse raw text |
| ReyLight | 110 | 38 | AI parse raw text |
| Rayovac | 97 | 0 | Need raw text fetch + AI parse |
| Zebralight | 50 | 46 | AI parse raw text |

### Blocked by Cloudflare/JS

| Brand | Entries | Issue | Solution |
|-------|---------|-------|----------|
| Pelican | 193 | JS-rendered Shopify | CFC headless browser |
| Wurkkos | 32 | Cloudflare | CFC headless browser |
| Sofirn | 40 | Cloudflare | CFC headless browser |
