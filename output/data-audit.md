# Data Audit -- Torch Pipeline Source & Coverage

> Generated 2026-03-19. Query `pipeline-data/db/torch.sqlite` for live numbers.

## Coverage Summary

| Metric | Value |
|--------|-------|
| Total DB entries | 12,528 |
| Lights (excl accessories/blog/not_flashlight) | 9,696 |
| Accessories | 2,589 |
| Blog posts | 232 |
| Not-flashlight | 11 |
| **Fully valid lights** | **6,848 (70.6%)** |
| Near-valid (missing 1 attr) | 1,392 |
| Unique brands (lights only) | 183 |
| Source URL records | 54,409 |
| Unique source labels | 233 |
| Raw spec text rows | 18,575 (covering 12,514 entries) |

### Completeness Score Distribution

Scores represent how many of the 13 variable required attributes are present
(model/brand/type are always populated).

| Score | Entries | Cumulative |
|-------|---------|------------|
| 13/13 (fully valid) | 6,848 | 6,848 |
| 12/13 (near-valid)  | 1,392 | 8,240 |
| 11/13 | 562 | 8,802 |
| 10/13 | 306 | 9,108 |
| 9/13  | 192 | 9,300 |
| 8/13  | 154 | 9,454 |
| 7/13  | 103 | 9,557 |
| <=6/13 | 139 | 9,696 |

---

## Source Domain Inventory

### Manufacturer Direct Sites

| Domain | Brand | Platform | Entries | Brand Valid% |
|--------|-------|----------|---------|-------------|
| fenixlighting.com | Fenix | Shopify | 615 | 92.0% |
| nightstick.com | Nightstick | Custom | 455 | 24.6% |
| olight (shopify stores) | Olight | Shopify | 871 | 81.7% |
| nitecore (shopify stores) | Nitecore | Shopify | 951 | 92.7% |
| acebeam.com | Acebeam | Shopify | 269 | 72.2% |
| streamlight (shopify stores) | Streamlight | Shopify | 414 | 87.8% |
| coastportland.com | Coast | Astro/SSR (JS) | 206 | 47.8% |
| maglite.com | Maglite | Custom | 236 | 65.8% |
| ledlenserusa.com | Ledlenser | Shopify | 155 | 85.1% |
| skylumen.com | Skylumen | Shopify | 257 | 0.0% |
| nextorch.com | Nextorch | Shopify | 151 | 78.2% |
| pelican.com | Pelican | BigCommerce-like | 153 | 90.1% |
| lumintop.com | Lumintop | WooCommerce | 144 | 51.0% |
| rovyvon.com | Rovyvon | Shopify | 114 | 83.6% |
| malkoffdevices.com | Malkoff | Shopify | 115 | 12.0% |
| foursevens.com | FourSevens | Shopify | 178 | 44.7% |
| powertac.com | PowerTac | Shopify | 128 | 84.2% |
| intl-outdoor.com | Emisar/Noctigon | Magento 1.x | 127 | 46.1% / 65.4% |
| surefire.com | SureFire | BigCommerce | 76 | 85.9% |
| armytek.com | Armytek | CS-Cart | 75 | 75.0% |
| wubenlight.com | Wuben | Shopify | 81 | 76.7% |
| eagtac.com | EagleTac | WooCommerce | 89 | 90.4% |
| klaruslight.com | Klarus | Custom | 54 | 91.3% |
| zebralight.com | Zebralight | Shift4Shop | 53 | 10.0% |
| imalentstore.com | Imalent | Shopify | 63 | 69.4% |
| skilhunt.com | Skilhunt | WooCommerce | 37 | 88.2% |
| reylight.net | ReyLight | Shopify | 34 | 5.0% |
| clouddefensive.com | Cloud Defensive | Shopify | 38 | N/A (weapon lights) |
| modlite.com | Modlite | Shopify | 37 | N/A (weapon lights) |
| loopgear.com | Loop Gear | Shopify | 17 | N/A |

### Multi-brand Retailers

| Domain | Total Entries | Light Entries | Role |
|--------|-------------|--------------|------|
| batteryjunction.com | 4,348 | 3,529 | Largest single source; cross-ref for specs, prices |
| goinggear.com | 956 | 841 | Multi-brand US retailer |
| nealsgadgets.com | 924 | 835 | China-brand specialist (Lumintop, Convoy, Mateminco) |
| flashlightgo.com | 720 | 656 | Multi-brand |
| torchdirect.co.uk | 470 | 421 | UK multi-brand |
| killzoneflashlights.com | 453 | 426 | Emisar/Noctigon, Weltool, Acebeam specialist |
| jlhawaii808.com | 259 | 171 | Emisar/Noctigon specialist + custom builds |
| nitecorestore.com | 254 | 133 | Nitecore authorized dealer |
| flashlightworld.ca | 154 | 114 | Canadian multi-brand |
| fenix-store.com | 68 | -- | Fenix authorized dealer |
| lumintoponline.com | 55 | -- | Lumintop secondary store |

### Review / Blog Sites

| Site | Entries Linked | Notes |
|------|---------------|-------|
| 1lumen.com | 605 | Comprehensive reviews, strong spec data |
| zeroair.org | 453 | Detailed measurements, runtime graphs |
| tgreviews.com | 126 | Good spec coverage |
| budgetlightforum.com | 115 | Community reviews, variable quality |
| sammyshp.de | 48 | German, high-quality beam measurements |
| zakreviews.com | 24 | Curated, small set |

### Price Enrichment (Keepa / Amazon)

| Brand | Keepa Fills | Notes |
|-------|------------|-------|
| Acebeam | 458 | Complete |
| Nightstick | 140 | Partial -- 150 near-valid still missing price |
| Lumintop | 40 | Partial -- 13 near-valid still missing price |
| Other (accessory/battery brands) | 113 | Synergy Digital, Technical Precision, etc. |

---

## Brand Coverage (Top 60 by light count)

| Brand | Lights | Valid | Valid% | Notes |
|-------|--------|-------|--------|-------|
| Fenix | 820 | 754 | 92.0% | |
| Olight | 761 | 622 | 81.7% | |
| Nitecore | 724 | 671 | 92.7% | |
| Acebeam | 632 | 456 | 72.2% | |
| Nightstick | 483 | 119 | 24.6% | 150 near-valid blocked on price, 29 on throw |
| Lumintop | 441 | 225 | 51.0% | 63 near-valid blocked on runtime, 13 on price |
| Streamlight | 296 | 260 | 87.8% | |
| Ledlenser | 255 | 217 | 85.1% | |
| JETBeam | 237 | 214 | 90.3% | |
| Klarus | 207 | 189 | 91.3% | |
| Rovyvon | 201 | 168 | 83.6% | |
| Coast | 186 | 89 | 47.8% | JS-rendered (Astro/SSR) |
| Nextorch | 179 | 140 | 78.2% | |
| Pelican | 171 | 154 | 90.1% | |
| Princeton Tec | 164 | 123 | 75.0% | |
| SureFire | 156 | 134 | 85.9% | |
| Weltool | 152 | 67 | 44.1% | |
| Armytek | 148 | 111 | 75.0% | |
| Convoy | 135 | 109 | 80.7% | |
| EagleTac | 135 | 122 | 90.4% | |
| Skylumen | 127 | 0 | **0.0%** | Custom/modded -- sparse spec data |
| Maglite | 117 | 77 | 65.8% | |
| PowerTac | 114 | 96 | 84.2% | |
| Imalent | 111 | 77 | 69.4% | |
| Sunwayman | 103 | 93 | 90.3% | |
| Emisar | 102 | 47 | 46.1% | Magento, configurable products |
| Wuben | 90 | 69 | 76.7% | |
| Nealsgadgets | 83 | 25 | 30.1% | House-brand rebrands |
| Petzl | 80 | 66 | 82.5% | |
| ReyLight | 80 | 4 | **5.0%** | Sparse specs on product pages |
| Nite Ize | 78 | 66 | 84.6% | |
| Rayovac | 76 | 47 | 61.8% | |
| Fitorch | 74 | 55 | 74.3% | |
| Mateminco | 73 | 37 | 50.7% | |
| Inova | 71 | 63 | 88.7% | |
| Spotlight | 71 | 17 | 23.9% | |
| UST | 70 | 54 | 77.1% | |
| Energizer | 69 | 39 | 56.5% | |
| Manker | 69 | 66 | 95.7% | |
| ThruNite | 69 | 58 | 84.1% | |
| Skilhunt | 68 | 60 | 88.2% | |
| MecArmy | 63 | 56 | 88.9% | |
| Nebo | 56 | 56 | **100%** | |
| Smith & Wesson | 51 | 45 | 88.2% | |
| Tank007 | 51 | 15 | 29.4% | |
| Malkoff | 50 | 6 | 12.0% | |
| Zebralight | 50 | 5 | **10.0%** | 41 near-valid blocked on throw |

---

## Attribute Coverage Gaps

Sorted by % missing among the 9,696 light entries.

| Attribute | Missing | % Missing | Near-valid blocked | Priority |
|-----------|---------|-----------|-------------------|----------|
| runtime_hours | 1,365 | 14.1% | 401 | HIGH |
| length_mm | 1,296 | 13.4% | 333 | HIGH |
| throw_m | 1,034 | 10.7% | 231 | HIGH |
| lumens | 474 | 4.9% | 20 | MEDIUM |
| weight_g | 414 | 4.3% | 44 | MEDIUM |
| led | 380 | 3.9% | 116 | MEDIUM |
| material | 350 | 3.6% | 33 | LOW |
| features | 345 | 3.6% | 10 | LOW |
| switch | 329 | 3.4% | 13 | LOW |
| price_usd | 271 | 2.8% | 164 | HIGH (easy Keepa fill) |
| battery | 248 | 2.6% | 13 | LOW |
| color | 159 | 1.6% | 12 | LOW |
| purchase_url | 4 | 0.0% | 2 | DONE |
| model | 0 | 0.0% | -- | DONE |
| brand | 0 | 0.0% | -- | DONE |
| type | 0 | 0.0% | -- | DONE |

### Near-valid Opportunity (1,392 entries missing exactly 1 attribute)

If each gap were filled, valid count would rise from 6,848 to 8,240 (85.0%).

| Missing Attribute | Near-valid Count | Top Brands |
|-------------------|-----------------|------------|
| runtime_hours | 401 | Lumintop(63), Olight(66), Nightstick(1) |
| length_mm | 333 | Acebeam(62*), Coast(40*), Nextorch(27*) |
| throw_m | 231 | Zebralight(41), Nightstick(29), Emisar(33) |
| price_usd | 164 | Nightstick(150), Lumintop(13) |
| led | 116 | Distributed across many brands |
| weight_g | 44 | Distributed |
| material | 33 | Distributed |
| lumens | 20 | Distributed |
| switch | 13 | Distributed |
| battery | 13 | Distributed |
| color | 12 | Distributed |
| features | 10 | Distributed |
| purchase_url | 2 | -- |

*Approximate; near-valid count by brand includes all missing attributes.

---

## Brand Alias Consolidation

Known aliases that should map to a canonical brand name. Some are already
consolidated in the DB; others remain as separate entries from multi-brand
retailer scrapes.

| Canonical | Alias(es) | Status |
|-----------|-----------|--------|
| EagleTac | EagTac (woocommerce source label) | Consolidated (147 entries) |
| Nightstick | Nightstick (NIGIY) (2 entries), BAYCO/Bayco (6 entries) | Needs merge |
| Loop Gear | LOOP (7 entries) | Needs merge |
| Vapcell | VAPCELL (2), Vapecell (1) | Needs merge |
| Emisar | EMISAR NOCTIGON (shared source label) | Keep Emisar/Noctigon separate |
| Noctigon | -- | Keep separate from Emisar |
| FourSevens | Prometheus Lights | Previously merged |
| Cameron Sino | CS Cameron Sino (1) | Accessory brand, low priority |
| Sunrei | SUNREI (0 remaining) | Already consolidated |
| Tank007 | TANK007 (0 remaining) | Already consolidated |
| Superfire | SUPERFIRE (0 remaining) | Already consolidated |
| Nextorch | NEXTORCH (0 remaining) | Already consolidated |

---

## Brands Needing Attention

### 0% Valid with >10 Entries

| Brand | Lights | Issue | Action |
|-------|--------|-------|--------|
| Skylumen | 127 | Custom/modded builds -- runtime missing on all 127, length on 116, lumens on 64, material on 54 | Low ROI -- these are one-off custom builds with no standardized specs |
| Dawson Machine Craft | 19 | Knife-light hybrids, sparse specs | Low priority |
| BLF | 16 | Community/group-buy lights, specs on forum threads | Niche |
| Niwalker | 11 | Small brand, sparse product pages | Low priority |

### Low Valid% with High Entry Count (>50 lights, <50% valid)

| Brand | Lights | Valid | Valid% | Bottleneck | Fix |
|-------|--------|-------|--------|-----------|-----|
| Nightstick | 483 | 119 | 24.6% | 150 near-valid need price (B2B $0 prices) | Keepa Amazon lookup |
| Coast | 186 | 89 | 47.8% | JS-rendered site (Astro/SSR) | CFC headless scrape |
| Weltool | 152 | 67 | 44.1% | Runtime + length gaps | Re-scrape detail pages |
| Emisar | 102 | 47 | 46.1% | Magento configurable products, throw gaps | Manual spec extraction |
| Nealsgadgets | 83 | 25 | 30.1% | House-brand rebrands, sparse specs | Cross-ref with original brands |
| ReyLight | 80 | 4 | 5.0% | Sparse specs on product pages (no runtime, length, throw) | Limited upstream data |
| Spotlight | 71 | 17 | 23.9% | Missing runtime + throw | Re-scrape or review site data |
| Tank007 | 51 | 15 | 29.4% | Missing runtime + length | Re-scrape detail pages |
| Malkoff | 50 | 6 | 12.0% | Bare-bones Shopify pages | 23 near-valid, likely fixable |
| Zebralight | 50 | 5 | 10.0% | 41 near-valid missing throw only | FL1 derivation if intensity_cd available |

---

## Known Data Quality Issues

### Configurable / Parent Products
Some brands list configurable products (color/LED options as one page) that
get scraped as a single entry with incomplete specs. Affects:
- **Fenix**: ~19 entries with lumens but no throw/runtime/length/weight
- **Acebeam**: ~18 entries
- **Nightstick**: ~6 entries

### JLHawaii808 Custom Builds
jlhawaii808.com sells custom-modded Emisar/Noctigon lights. The 171 light
entries are one-of-a-kind builds with non-standard specs. Currently 19 entries
under brand "JLHawaii808" -- the rest are correctly attributed to Emisar/Noctigon
but may have custom LED swaps that differ from factory specs.

### Nightstick B2B Pricing
Nightstick's website shows $0.00 prices (B2B/distributor model). 150 entries
are near-valid blocked only on price_usd. Keepa Amazon lookup has filled 140
so far but ~150 remain.

### Zebralight Throw Gap
41 of 50 Zebralight entries are near-valid, missing only throw_m. The Shift4Shop
product pages do not list throw distance. Zebralight does provide intensity (cd)
on some pages -- FL1 derivation (throw = 2 * sqrt(cd)) could fill these if
intensity_cd were scraped.

### Coast JS-rendered Site
coastportland.com uses Astro/SSR. Product pages require JavaScript execution
to render specs. The 186 light entries at 47.8% valid are limited by incomplete
scraping. CFC headless browser would improve coverage.

### Array Field Caps
The DB enforces array size limits: led<=2, battery<=4, material<=2, switch<=3.
Values exceeding these caps are dropped to `[]`, which can cause false "missing"
counts for multi-LED or multi-material products.

### Accessory Filtering
2,589 entries classified as `["accessory"]` are excluded from light counts.
These include batteries, chargers, holsters, filters, mounts, and replacement
parts. The vision classifier identified these with reasonable accuracy, but
some edge cases (e.g., light+charger bundles) may be misclassified.

---

## Priority Actions

### 1. Nightstick Keepa Price Fill (high impact)
- 150 near-valid entries blocked only on price
- Keepa has filled 140 so far; continue Amazon ASIN lookup for remaining
- **Potential gain**: +150 valid (6,848 -> 6,998)

### 2. Zebralight Throw Derivation (high impact)
- 41 near-valid entries missing only throw_m
- Scrape intensity_cd from product pages, then derive throw = 2*sqrt(cd)
- **Potential gain**: +41 valid (up to 7,039)

### 3. Lumintop Runtime Gap (medium impact)
- 63 near-valid entries blocked on runtime_hours
- lumintop.com WooCommerce pages have runtime data; re-scrape detail pages
- **Potential gain**: +63 valid (up to 7,102)

### 4. Brand Alias Merge (data hygiene)
- Merge BAYCO/Bayco -> Nightstick (6 entries)
- Merge LOOP -> Loop Gear (7 entries)
- Merge Nightstick (NIGIY) -> Nightstick (2 entries)
- Merge VAPCELL/Vapecell -> Vapcell (3 entries)

### 5. Coast CFC Headless Scrape (medium impact)
- 40 near-valid entries, 186 total lights at 47.8%
- Requires JavaScript execution for spec rendering
- **Potential gain**: +40 near-valid, likely more with full spec extraction

### 6. Malkoff Detail Re-scrape (low-medium impact)
- 23 near-valid out of 50 lights (12% valid)
- Shopify pages may have more data with targeted extraction

### 7. Weltool / Emisar Detail Re-scrape (medium impact)
- Weltool: 36 near-valid, 152 lights at 44.1%
- Emisar: 33 near-valid, 102 lights at 46.1% (Magento configurable products)

### 8. General Runtime + Length Mining
- Runtime (14.1% missing) and length (13.4% missing) are the top two gaps
- Both are commonly available in manufacturer spec tables
- Targeted re-parse of raw_spec_text for these fields could yield incremental gains

### Theoretical Maximum
If all 1,392 near-valid gaps were filled: **8,240 valid / 9,696 lights = 85.0%**
