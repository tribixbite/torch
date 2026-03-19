# Data Audit -- Torch Pipeline Source & Coverage

> Generated 2026-03-19. Query `pipeline-data/db/torch.sqlite` for live numbers.

## Coverage Summary

| Metric | Value |
|--------|-------|
| Total DB entries | 12,437 |
| Lights (excl accessories/blog/not_flashlight) | 10,199 |
| Accessories | 1,859 |
| Batteries | 12 |
| Blog posts | 256 |
| Not-flashlight | 111 |
| **Fully valid lights** | **6,909 (67.7%)** |
| Near-valid (missing 1 attr) | 1,540 |
| Unique brands (lights only) | 143 |
| Source URL records | 54,409 |
| Unique source labels | 233 |
| Raw spec text rows | 18,575 (covering 12,428 entries) |

### Completeness Score Distribution

Scores represent how many of the 13 variable required attributes are present
(model/brand/type are always populated).

| Score | Entries | Cumulative |
|-------|---------|------------|
| 13/13 (fully valid) | 6,909 | 6,909 |
| 12/13 (near-valid)  | 1,540 | 8,449 |
| 11/13 | 699 | 9,148 |
| 10/13 | 406 | 9,554 |
| 9/13  | 242 | 9,796 |
| 8/13  | 207 | 10,003 |
| 7/13  | 109 | 10,112 |
| <=6/13 | 87 | 10,199 |

### Session Changes (2026-03-18 / 03-19)

Key data quality improvements applied this session:

- **Brand merges**: BAYCO/Bayco -> Nightstick, LOOP -> Loop Gear,
  Nightstick (NIGIY) -> Nightstick, VAPCELL/Vapecell -> Vapcell (all complete)
- **D4V2 dedup**: Emisar D4V2 configurable products deduplicated by material
  variant (Al, Ti, Brass, Copper, Mule). LED options preserved in `led_options`
  column (65 entries now have led_options populated)
- **Accessory cleanup**: Reclassified non-light entries; accessory count dropped
  from ~2,589 to 1,859 via improved type filtering and cross-seller dedup
- **Cross-seller dedup**: Removed duplicate entries created by multi-brand
  retailers (batteryjunction, goinggear, nealsgadgets, etc.) listing the same
  product under slightly different model names
- **LED options column**: `led_options` schema added for configurable products
  (Emisar/Noctigon) -- stores full LED choice list without hitting led[] cap of 2
- **FL1 derivation**: throw_m derived from intensity_cd where available
- **Material fill**: Cross-referenced material from retailer spec tables
- **OpticsPlanet prices**: Additional price data from OpticsPlanet retailer
- **Emisar model normalization**: Case-insensitive dedup, standardized model names

---

## Source Domain Inventory

### Manufacturer Direct Sites

| Domain | Brand | Platform | Entries | Brand Valid% |
|--------|-------|----------|---------|-------------|
| fenixlighting.com | Fenix | Shopify | 615 | 89.1% |
| nightstick.com | Nightstick | Custom | 455 | 37.6% |
| olight (shopify stores) | Olight | Shopify | 871 | 79.5% |
| nitecore (shopify stores) | Nitecore | Shopify | 951 | 90.7% |
| acebeam.com | Acebeam | Shopify | 269 | 71.9% |
| streamlight (shopify stores) | Streamlight | Shopify | 414 | 83.8% |
| coastportland.com | Coast | Astro/SSR (JS) | 206 | 41.2% |
| maglite.com | Maglite | Custom | 236 | 60.4% |
| ledlenserusa.com | Ledlenser | Shopify | 155 | 81.2% |
| skylumen.com | Skylumen | Shopify | 257 | 0.0% |
| nextorch.com | Nextorch | Shopify | 151 | 65.8% |
| pelican.com | Pelican | BigCommerce-like | 153 | 90.1% |
| lumintop.com | Lumintop | WooCommerce | 144 | 55.2% |
| rovyvon.com | Rovyvon | Shopify | 114 | 83.7% |
| malkoffdevices.com | Malkoff | Shopify | 115 | 25.0% |
| foursevens.com | FourSevens | Shopify | 178 | 36.2% |
| powertac.com | PowerTac | Shopify | 128 | 84.1% |
| intl-outdoor.com | Emisar/Noctigon | Magento 1.x | 127 | 55.8% |
| surefire.com | SureFire | BigCommerce | 76 | 84.2% |
| armytek.com | Armytek | CS-Cart | 75 | 75.7% |
| wubenlight.com | Wuben | Shopify | 81 | 77.2% |
| eagtac.com | EagleTac | WooCommerce | 89 | 90.2% |
| klaruslight.com | Klarus | Custom | 54 | 82.4% |
| zebralight.com | Zebralight | Shift4Shop | 53 | 10.0% |
| imalentstore.com | Imalent | Shopify | 63 | 70.8% |
| skilhunt.com | Skilhunt | WooCommerce | 37 | 87.0% |
| reylight.net | ReyLight | Shopify | 34 | 6.3% |
| clouddefensive.com | Cloud Defensive | Shopify | 38 | N/A (weapon lights) |
| modlite.com | Modlite | Shopify | 37 | N/A (weapon lights) |
| loopgear.com | Loop Gear | Shopify | 17 | 42.4% |

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

| Brand | Amazon Fills | Notes |
|-------|------------|-------|
| Nightstick | 82 | Partial -- 83 near-valid still missing price |
| Acebeam | 76 | Good coverage |
| Lumintop | 17 | Partial -- 13 near-valid still missing price |
| Other (accessory/battery brands) | 86 | Technical Precision, onerbl, PKPOWER, etc. |

---

## Brand Coverage (Top 60 by light count)

| Brand | Lights | Valid | Valid% | Notes |
|-------|--------|-------|--------|-------|
| Fenix | 916 | 816 | 89.1% | |
| Nitecore | 794 | 720 | 90.7% | |
| Olight | 790 | 628 | 79.5% | |
| Acebeam | 638 | 459 | 71.9% | |
| Lumintop | 426 | 235 | 55.2% | 54 near-valid blocked on runtime, 13 on price |
| Nightstick | 407 | 153 | 37.6% | 83 near-valid blocked on price, 31 on throw |
| Streamlight | 315 | 264 | 83.8% | |
| Ledlenser | 293 | 238 | 81.2% | |
| Klarus | 262 | 216 | 82.4% | |
| Coast | 257 | 106 | 41.2% | JS-rendered (Astro/SSR); 21 near-valid need led |
| JETBeam | 241 | 216 | 89.6% | |
| Nextorch | 222 | 146 | 65.8% | 20 near-valid blocked on led |
| Rovyvon | 203 | 170 | 83.7% | |
| Pelican | 172 | 155 | 90.1% | |
| Princeton Tec | 170 | 125 | 73.5% | 29 near-valid blocked on length |
| SureFire | 165 | 139 | 84.2% | |
| Armytek | 152 | 115 | 75.7% | 20 near-valid blocked on length |
| Maglite | 149 | 90 | 60.4% | |
| Convoy | 135 | 109 | 80.7% | 19 near-valid blocked on throw |
| EagleTac | 133 | 120 | 90.2% | |
| Skylumen | 133 | 0 | **0.0%** | Custom/modded -- sparse spec data |
| Weltool | 132 | 63 | 47.7% | 17 near-valid blocked on length |
| Imalent | 113 | 80 | 70.8% | |
| PowerTac | 113 | 95 | 84.1% | |
| Petzl | 104 | 79 | 76.0% | |
| Sunwayman | 103 | 93 | 90.3% | |
| Ultimate Survival Technologies | 96 | 64 | 66.7% | |
| Emisar | 95 | 53 | 55.8% | Magento configurable products; led_options populated |
| Wuben | 92 | 71 | 77.2% | |
| Nite Ize | 90 | 70 | 77.8% | |
| Nealsgadgets | 84 | 26 | 31.0% | House-brand rebrands |
| Rayovac | 79 | 47 | 59.5% | |
| Energizer | 77 | 39 | 50.6% | |
| Fitorch | 77 | 56 | 72.7% | |
| ThruNite | 75 | 61 | 81.3% | |
| Inova | 72 | 64 | 88.9% | |
| Mateminco | 71 | 37 | 52.1% | 26 near-valid blocked on runtime |
| Skilhunt | 69 | 60 | 87.0% | |
| Manker | 68 | 65 | 95.6% | |
| Spotlight | 68 | 17 | 25.0% | |
| ReyLight | 64 | 4 | **6.3%** | Sparse specs on product pages |
| MecArmy | 63 | 56 | 88.9% | |
| Malkoff | 60 | 15 | 25.0% | 11 near-valid blocked on length, 9 on throw |
| Nebo | 59 | 58 | 98.3% | |
| Smith And Wesson | 54 | 45 | 83.3% | |
| Tank007 | 51 | 15 | 29.4% | |
| Zebralight | 50 | 5 | **10.0%** | 41 near-valid blocked on throw |
| Lightstar | 49 | 38 | 77.6% | |
| FourSevens | 47 | 17 | 36.2% | |
| Sofirn | 40 | 26 | 65.0% | |
| Fireflies | 39 | 24 | 61.5% | |
| Lumapower | 39 | 31 | 79.5% | |
| Speras | 37 | 24 | 64.9% | |
| ASP | 36 | 35 | 97.2% | |
| Niteye | 36 | 35 | 97.2% | |
| Amutorch | 34 | 18 | 52.9% | |
| Loop Gear | 33 | 14 | 42.4% | Merged from LOOP alias |
| Underwater Kinetics | 33 | 31 | 93.9% | |
| Wurkkos | 32 | 25 | 78.1% | |
| Wagan | 28 | 10 | 35.7% | |

---

## Attribute Coverage Gaps

Sorted by % missing among the 10,199 light entries.

| Attribute | Missing | % Missing | Near-valid blocked | Priority |
|-----------|---------|-----------|-------------------|----------|
| length_mm | 1,364 | 13.4% | 351 | HIGH |
| runtime_hours | 1,346 | 13.2% | 403 | HIGH |
| throw_m | 1,098 | 10.8% | 238 | HIGH |
| led | 507 | 5.0% | 125 | MEDIUM |
| material | 501 | 4.9% | 46 | LOW |
| switch | 389 | 3.8% | 44 | LOW |
| weight_g | 380 | 3.7% | 43 | MEDIUM |
| lumens | 363 | 3.6% | 20 | MEDIUM |
| color | 321 | 3.1% | 149 | MEDIUM |
| battery | 308 | 3.0% | 13 | LOW |
| features | 253 | 2.5% | 10 | LOW |
| price_usd | 193 | 1.9% | 97 | HIGH (easy Keepa fill) |
| purchase_url | 3 | 0.0% | 1 | DONE |
| model | 0 | 0.0% | -- | DONE |
| brand | 0 | 0.0% | -- | DONE |
| type | 0 | 0.0% | -- | DONE |

### Near-valid Opportunity (1,540 entries missing exactly 1 attribute)

If each gap were filled, valid count would rise from 6,909 to 8,449 (82.8%).

| Missing Attribute | Near-valid Count | Top Brands |
|-------------------|-----------------|------------|
| runtime_hours | 403 | Lumintop(54), Mateminco(26), Emisar(18), Nealsgadgets(18), Olight(18) |
| length_mm | 351 | Olight(30), Princeton Tec(29), Acebeam(21), Armytek(20), Ledlenser(20) |
| throw_m | 238 | Zebralight(41), Nightstick(31), Convoy(19), Streamlight(17), ARCHON(13) |
| color | 149 | Fenix(8), Striker(7), Coast(6), Nite Ize(4), Petzl(4) |
| led | 125 | Olight(23), Coast(21), Nextorch(20), Fenix(12), Cloud Defensive(10) |
| price_usd | 97 | Nightstick(83), Lumintop(13), EagleTac(1) |
| material | 46 | Distributed |
| switch | 44 | Distributed |
| weight_g | 43 | Distributed |
| lumens | 20 | Distributed |
| battery | 13 | Distributed |
| features | 10 | Distributed |
| purchase_url | 1 | -- |

---

## Brand Alias Consolidation

Known aliases that should map to a canonical brand name.

| Canonical | Alias(es) | Status |
|-----------|-----------|--------|
| EagleTac | EagTac (woocommerce source label) | Consolidated |
| Nightstick | Nightstick (NIGIY), BAYCO/Bayco | **Merged** (this session) |
| Loop Gear | LOOP | **Merged** (this session) |
| Vapcell | VAPCELL, Vapecell | **Merged** (this session) |
| Emisar | EMISAR NOCTIGON (shared source label) | Keep Emisar/Noctigon separate |
| Noctigon | -- | Keep separate from Emisar |
| FourSevens | Prometheus Lights | Previously merged |
| Cameron Sino | CS Cameron Sino (1) | Accessory brand, low priority |
| Sunrei | SUNREI | Already consolidated |
| Tank007 | TANK007 | Already consolidated |
| Superfire | SUPERFIRE | Already consolidated |
| Nextorch | NEXTORCH | Already consolidated |

---

## Brands Needing Attention

### 0% Valid with >10 Entries

| Brand | Lights | Issue | Action |
|-------|--------|-------|--------|
| Skylumen | 133 | Custom/modded builds -- runtime missing on all, length/lumens/material sparse | Low ROI -- one-off custom builds with no standardized specs |
| Dawson Machine Craft | 19 | Knife-light hybrids, sparse specs | Low priority |
| BLF | 16 | Community/group-buy lights, specs on forum threads | Niche |
| Cloud Defensive | 13 | Weapon lights, 10 near-valid need led | Medium -- scrape detail pages |
| Knog | 12 | Bike lights, sparse specs | Low priority |
| Bust-A-Cap | 11 | Tailcap accessories often miscategorized | Reclassify as accessory |
| Niwalker | 11 | Small brand, sparse product pages | Low priority |

### Low Valid% with High Entry Count (>50 lights, <50% valid)

| Brand | Lights | Valid | Valid% | Bottleneck | Fix |
|-------|--------|-------|--------|-----------|-----|
| Nightstick | 407 | 153 | 37.6% | 83 near-valid need price (B2B $0), 31 need throw | Keepa Amazon lookup |
| Coast | 257 | 106 | 41.2% | JS-rendered site (Astro/SSR), 21 near-valid need led | CFC headless scrape |
| Skylumen | 133 | 0 | 0.0% | Custom/modded -- sparse spec data | Low ROI |
| Weltool | 132 | 63 | 47.7% | 17 near-valid need length | Re-scrape detail pages |
| Emisar | 95 | 53 | 55.8% | Magento configurable products, throw+runtime gaps | led_options approach working |
| Nealsgadgets | 84 | 26 | 31.0% | House-brand rebrands, sparse specs | Cross-ref with original brands |
| Spotlight | 68 | 17 | 25.0% | 19 near-valid need length | Re-scrape detail pages |
| ReyLight | 64 | 4 | 6.3% | Sparse specs on product pages (no runtime, length, throw) | Limited upstream data |
| Malkoff | 60 | 15 | 25.0% | 11 near-valid need length, 9 need throw | Re-scrape Shopify pages |
| Tank007 | 51 | 15 | 29.4% | Missing runtime + length | Re-scrape detail pages |
| Zebralight | 50 | 5 | 10.0% | 41 near-valid missing throw only | FL1 derivation if intensity_cd available |

---

## Known Data Quality Issues

### Configurable / Parent Products
Some brands list configurable products (color/LED options as one page) that
get scraped as a single entry with incomplete specs. Affects:
- **Emisar/Noctigon**: Addressed with `led_options` column (65 entries populated).
  D4V2 variants deduplicated by material (Al, Ti, Brass, Copper) with full LED
  option lists preserved.
- **Fenix**: ~19 entries with lumens but no throw/runtime/length/weight
- **Acebeam**: ~18 entries
- **Nightstick**: ~6 entries

### JLHawaii808 Custom Builds
jlhawaii808.com sells custom-modded Emisar/Noctigon lights. The 171 light
entries are one-of-a-kind builds with non-standard specs. Currently 19 entries
under brand "JLHawaii808" -- the rest are correctly attributed to Emisar/Noctigon
but may have custom LED swaps that differ from factory specs.

### Nightstick B2B Pricing
Nightstick's website shows $0.00 prices (B2B/distributor model). 83 entries
are near-valid blocked only on price_usd. Keepa Amazon lookup has filled 82
so far but ~83 remain without Amazon listings.

### Zebralight Throw Gap
41 of 50 Zebralight entries are near-valid, missing only throw_m. The Shift4Shop
product pages do not list throw distance. Zebralight does provide intensity (cd)
on some pages -- FL1 derivation (throw = 2 * sqrt(cd)) could fill these if
intensity_cd were scraped.

### Coast JS-rendered Site
coastportland.com uses Astro/SSR. Product pages require JavaScript execution
to render specs. The 257 light entries at 41.2% valid are limited by incomplete
scraping. CFC headless browser would improve coverage. 21 near-valid need led.

### Array Field Caps
The DB enforces array size limits: led<=2, battery<=4, material<=2, switch<=3.
Values exceeding these caps are dropped to `[]`, which can cause false "missing"
counts for multi-LED or multi-material products.

### Accessory Filtering
1,859 entries classified as `["accessory"]` are excluded from light counts.
These include batteries, chargers, holsters, filters, mounts, and replacement
parts. The vision classifier identified these with reasonable accuracy, but
some edge cases (e.g., light+charger bundles) may be misclassified.

### Cross-seller Dedup
Multi-brand retailers (batteryjunction, goinggear, nealsgadgets, etc.) often
list the same product under slightly different model names (e.g., extra
suffixes, color codes). This session applied case-insensitive dedup and model
normalization to merge these, reducing total entries from ~12,528 to 12,437.

---

## Priority Actions

### 1. Nightstick Keepa Price Fill (high impact)
- 83 near-valid entries blocked only on price
- Keepa has filled 82 so far; continue Amazon ASIN lookup for remaining
- **Potential gain**: +83 valid (6,909 -> 6,992)

### 2. Zebralight Throw Derivation (high impact per entry)
- 41 near-valid entries missing only throw_m
- Scrape intensity_cd from product pages, then derive throw = 2*sqrt(cd)
- **Potential gain**: +41 valid (up to 7,033)

### 3. Runtime Gap Fill (high impact)
- 403 near-valid entries blocked on runtime_hours
- Top brands: Lumintop(54), Mateminco(26), Emisar(18), Olight(18)
- Re-scrape detail pages or mine raw_spec_text for runtime patterns
- **Potential gain**: +403 valid (up to 7,436)

### 4. Length Gap Fill (high impact)
- 351 near-valid entries blocked on length_mm
- Top brands: Olight(30), Princeton Tec(29), Acebeam(21), Armytek(20)
- Re-scrape detail pages for dimension specs
- **Potential gain**: +351 valid (up to 7,787)

### 5. Color Gap Fill (medium impact, new opportunity)
- 149 near-valid entries blocked on color
- Top brands: Fenix(8), Striker(7), Coast(6)
- Mostly extractable from product titles or image analysis
- **Potential gain**: +149 valid (up to 7,936)

### 6. LED Gap Fill (medium impact)
- 125 near-valid entries blocked on led
- Top brands: Olight(23), Coast(21), Nextorch(20), Fenix(12)
- LED keyword extraction from product descriptions
- **Potential gain**: +125 valid (up to 8,061)

### 7. Coast CFC Headless Scrape (medium impact)
- 257 total lights at 41.2% valid, 41 near-valid
- Requires JavaScript execution for spec rendering
- **Potential gain**: +41 near-valid, likely more with full spec extraction

### 8. Malkoff / Weltool / Spotlight Re-scrape (low-medium impact)
- Malkoff: 20 near-valid out of 60 lights (25% valid)
- Weltool: 29 near-valid, 132 lights at 47.7%
- Spotlight: 19 near-valid, 68 lights at 25.0%

### Theoretical Maximum
If all 1,540 near-valid gaps were filled: **8,449 valid / 10,199 lights = 82.8%**
