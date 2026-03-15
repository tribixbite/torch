# Crawler Research: High-Missing-Data Brands (2026-03-14)

## Current Data Gap Summary

| Brand | Entries | Lumens | Throw | Length | Weight | LED | Battery | Runtime | Material | Price |
|-------|---------|--------|-------|--------|--------|-----|---------|---------|----------|-------|
| Pelican | 185 | 72% | 44% | 27% | 94% | 0% | 64% | 51% | 32% | 97% |
| Princeton Tec | 171 | 84% | 30% | 8% | 100% | 0% | 80% | 79% | 48% | 100% |
| Petzl | 151 | 58% | 39% | 12% | 98% | 0% | 57% | 56% | 7% | 100% |
| Convoy | 139 | 56% | 43% | 73% | 84% | 79% | 98% | 0% | 93% | 100% |
| SureFire | 118 | 84% | 72% | 82% | 89% | 10% | 75% | 70% | 83% | 100% |
| Armytek | 126 | 82% | 46% | 31% | 53% | 31% | 65% | 29% | 76% | 99% |

**Key universal gaps**: LED type (0% for Pelican/Princeton Tec/Petzl), throw/intensity, length, runtime.

## Source URL Coverage

All entries already have info_urls pointing to retailer sites:
- **Pelican**: batteryjunction.com (190), shop.pelican.com (180)
- **Princeton Tec**: batteryjunction.com (340)
- **Petzl**: batteryjunction.com (302)
- **Convoy**: flashlightgo.com (174), nealsgadgets.com (102)
- **SureFire**: batteryjunction.com (178), goinggear.com (58)
- **Armytek**: goinggear.com (136), killzoneflashlights.com (66), flashlightgo.com (48)

---

## 1. Pelican (185 entries)

**Website**: https://www.pelican.com/us/en/products/flashlights
**Shopify Store**: https://shop.pelican.com (only ~14 lights, mostly phone cases)
**Platform**: Custom/proprietary (main site), Shopify (shop subdomain)
**Cloudflare**: YES - aggressive bot protection, returns 403 to crawlers

### Spec Availability
The main pelican.com site has ANSI FL1 specs per product:
- Lumens (multi-mode), beam distance (m), runtime (hours), candela
- Weight (oz/g), length (inches/cm), battery type
- IPX rating, material (anodized aluminum)
- Structured definition-list HTML format

### Scraping Feasibility
- **BLOCKED**: Cloudflare challenge page on all pelican.com URLs
- **Shopify store**: Only 14 lights, no detailed specs in body_html (product descriptions are minimal)
- **Sitemap**: robots.txt references sitemap.xml but it's also behind Cloudflare
- **Product count**: ~87 lighting products on brightguy.com dealer site, ~40-50 flashlights on pelican.com

### Recommendation: NOT WORTH dedicated crawler
- Cloudflare protection makes direct HTTP scraping impossible without headless browser + challenge solving
- The Shopify store has almost no flashlights and no specs
- Existing entries already source from batteryjunction.com and shop.pelican.com
- **Better approach**: Enhance detail-scraper to parse batteryjunction.com product pages more aggressively for Pelican specs, or scrape brightguy.com (no bot protection) which carries full Pelican spec sheets
- **Complexity**: HIGH (Cloudflare bypass required)
- **ROI**: LOW (most data already captured, gaps are in throw/length/LED which Pelican doesn't always publish)

---

## 2. Princeton Tec (171 entries)

**Website**: https://www.princetontec.com
**Platform**: WordPress + WooCommerce
**Cloudflare**: No

### Spec Availability
WooCommerce with WordPress REST API exposed at `/wp-json/wp/v2/product`:
- **Structured fields**: `brightness` (lumens), `distance_metres`, `weight`, `batteries`, `water_resistant`
- **Additional fields**: `ir_intensity`, `wavelength`, `dimmable`, `regulated_led`
- Specs also rendered as HTML tables on product pages (key-value table format)
- Performance tables with per-mode lumens/runtime/beam-pattern breakdowns

### Critical Limitation
- **Only 6 current lights on the site** (Ghost X, Ghost X MPLS, Charge X, Charge X IR Max, Refuel Industrial, Axis Li Industrial)
- Most of our 171 entries are legacy/discontinued models NOT on the current website
- Product sitemap is empty (0 URLs)

### Recommendation: LOW PRIORITY crawler
- Only 6 products available = minimal new data
- The WP REST API is trivially scrapable (structured JSON, no auth needed)
- **Better approach**: Quick one-off script to pull the 6 products via WP API, not a full crawler
- Could add those 6 entries as high-quality data points with LED, throw, runtime, length
- **Complexity**: VERY LOW (REST API with structured fields)
- **ROI**: LOW (only 6 products, but easy to grab)

---

## 3. Petzl (151 entries)

**Website**: https://www.petzl.com/US/en/Sport/Headlamps
**Platform**: Salesforce Commerce Cloud (Visualforce)
**Cloudflare**: No

### Spec Availability
Excellent ANSI FL1 data per product:
- **Brightness** (lumens, ANSI FL1 standard)
- **Weight** (g), **beam distance** (m), **burn time** (h)
- **Battery** type and capacity (e.g., "Lithium-ion 2250 mAh")
- **IPX rating**, **certifications** (CE)
- **Lighting performance matrix**: multi-mode table with lumens + distance + runtime per mode
- Two technology modes: "Reactive Lighting" and "Standard Lighting" with separate specs

### Product Count
- ~16 current headlamp models on the Sport/Headlamps page
- Additional models under Professional (climbing, industrial)
- Total estimated: 25-35 current products

### Scraping Feasibility
- Static HTML with some JavaScript-rendered elements
- URL pattern: `/US/en/Sport/Headlamps/{MODEL-NAME}`
- No sitemap (returns 404/redirect to error page)
- Product discovery requires scraping category pages
- Specs are in hybrid HTML+JSON format (some in JS variables, some in HTML tables)

### Recommendation: MEDIUM PRIORITY
- Good spec data quality (ANSI FL1 standard)
- 25-35 products vs 151 entries = would only cover current lineup
- Salesforce pages can be tricky (JS-rendered specs, Visualforce remoting)
- **Better approach**: Scrape the category pages to discover URLs, then fetch individual product pages
- Need to handle the Reactive Lighting performance matrix format
- **Complexity**: MEDIUM (Salesforce/Visualforce, hybrid HTML/JS rendering)
- **ROI**: MEDIUM (good data quality but limited to current products, most entries are legacy)

---

## 4. Convoy (139 entries)

**Website**: https://convoylight.com
**AliExpress Store**: https://convoy.aliexpress.com/store/330416
**Platform**: Shoplazza (Chinese ecommerce platform, NOT Shopify)
**Cloudflare**: No

### Spec Availability
- convoylight.com is heavily JS-rendered (Shoplazza platform)
- No products.json API endpoint (404)
- Product pages are template-rendered with `{{}}` Liquid-like syntax
- No sitemap accessible
- Product data requires full JS rendering to access

### Key Challenge
- Shoplazza has NO public JSON API like Shopify
- All product data is rendered client-side
- AliExpress product pages have specs but AliExpress blocks crawlers aggressively
- Convoy products are already well-covered via flashlightgo.com and nealsgadgets.com (both Shopify stores)

### Data Gap Analysis
- **Runtime: 0%** -- biggest gap, Convoy rarely publishes runtime data (they focus on LED specs)
- LED: 79% already covered (from retailer sites)
- Battery: 98% already covered
- Main gaps: lumens (56%), throw (43%), runtime (0%)

### Recommendation: NOT WORTH dedicated crawler
- Shoplazza requires headless browser (Playwright/Puppeteer) for rendering
- AliExpress blocks automated scraping
- Convoy's own site has minimal spec data compared to retailers
- Existing retailer sources (flashlightgo, nealsgadgets) already provide most available data
- Runtime data simply doesn't exist for most Convoy products (manufacturer doesn't test/publish it)
- **Complexity**: HIGH (Shoplazza JS rendering, no API)
- **ROI**: VERY LOW (limited incremental data, runtime gap is unfillable)

---

## 5. SureFire (118 entries)

**Website**: https://www.surefire.com
**Platform**: BigCommerce
**Cloudflare**: No

### Spec Availability
Excellent ANSI FL1 data in structured `<dl>/<dt>/<dd>` format:
- **Multi-mode output**: lumens per mode (high/medium/low)
- **Peak candela**: e.g., "35,000 candela"
- **Beam distance**: meters
- **Runtime**: per mode (hours)
- **Physical**: length (in/cm), weight (oz/g), bezel diameter
- **Material**: aluminum, finish type (Mil-Spec hard anodized)
- **Battery**: type and charging info
- **IPX rating**: water resistance
- **Switch type**: identifiable from description

### Product Count
- **253 total product URLs** in sitemap (xmlsitemap.php?type=products)
- Includes suppressors, earplugs, apparel, accessories
- Estimated ~21 flashlights (from category page), ~30 weapon lights
- ~50 total lighting products

### Scraping Feasibility
- BigCommerce has standard sitemap at `/xmlsitemap.php`
- Product pages load specs as static HTML (definition lists)
- Clean URL structure: `/product-slug/`
- No bot protection detected
- Need to filter non-flashlight products (suppressors, accessories, apparel)

### Recommendation: HIGH PRIORITY
- Best spec data quality of all researched brands (candela, multi-mode lumens, weight in both units)
- Static HTML, standard BigCommerce sitemap, no bot protection
- Current data already has 84% lumens, 72% throw -- but LED (10%), runtime gaps remain
- ~50 lighting products to scrape
- **Complexity**: LOW-MEDIUM (BigCommerce sitemap, structured dl/dt/dd specs, need product filtering)
- **ROI**: HIGH (fills LED, candela, and runtime gaps; structured data is reliable)

---

## 6. Armytek (126 entries)

**Website**: https://www.armytek.com
**Platform**: CS-Cart (custom/proprietary, "Tygh" framework references)
**Cloudflare**: No

### Spec Availability
Detailed specs in responsive HTML table (`#tc-table`):
- **Lumens**: multi-mode (e.g., 2500/1300/350/100/15/0.15)
- **Beam distance**: meters
- **Runtime**: per mode (detailed, e.g., "2h 40min" down to "200 days")
- **Battery**: type (e.g., "1x 18650 Li-Ion")
- **Dimensions**: length (mm), head diameter (mm), body diameter (mm)
- **Weight**: both with and without battery
- **IP rating**: "IP68. Depth up to 10 m"
- **Optics**: TIR/reflector type
- **Hotspot/Spill**: beam angle (e.g., "70:120")

### Notable Gaps
- LED type not in the spec table (sometimes in product title, e.g., "XHP50.2")
- No candela in spec table (beam distance only)
- Material not explicitly stated (always aluminum but not listed)

### Product Count
- ~96 flashlight products (24 per page, 4+ pages)
- Plus headlamps and accessories
- Estimated 80-100 unique flashlight models

### Scraping Feasibility
- No sitemap found (404 on /sitemap.xml)
- Product discovery via category pagination (`/flashlights/?page=N`)
- URL pattern: `/flashlights/models/{series}/{full-product-slug}/`
- Specs in `data-label` responsive table (mobile-friendly, easy to parse)
- Static HTML rendering, no bot protection
- 404 errors possible for discontinued product URLs

### Recommendation: HIGH PRIORITY
- Rich spec data including multi-mode runtime (our biggest gap at 29%)
- Fills length (31%), weight (53%), LED (31%), battery (65%) gaps
- Static HTML, no bot protection, structured table format
- ~80-100 products to discover
- Product discovery needs pagination crawling (no sitemap)
- **Complexity**: MEDIUM (no sitemap, need pagination discovery, CS-Cart table parsing)
- **ROI**: HIGH (fills runtime, weight, length, and throw gaps; structured data)

---

## Priority Ranking

| Rank | Brand | Complexity | ROI | Action |
|------|-------|-----------|-----|--------|
| 1 | **SureFire** | LOW-MED | HIGH | Add BigCommerce crawler to catalog-crawler.ts |
| 2 | **Armytek** | MEDIUM | HIGH | Add CS-Cart crawler to catalog-crawler.ts |
| 3 | **Petzl** | MEDIUM | MEDIUM | Add Salesforce scraper (may need Playwright for JS) |
| 4 | **Princeton Tec** | VERY LOW | LOW | Quick WP REST API script (6 products only) |
| 5 | **Pelican** | HIGH | LOW | Scrape brightguy.com dealer pages instead |
| 6 | **Convoy** | HIGH | VERY LOW | Skip -- retailer data already maximal |

## Immediate Next Steps

1. **SureFire crawler**: Parse BigCommerce sitemap, filter flashlight/weaponlight URLs, extract dl/dt/dd spec tables
2. **Armytek crawler**: Paginate `/flashlights/?page=N`, extract `#tc-table` specs, parse model names from titles
3. **Princeton Tec**: One-off WP API call for 6 current products
4. **Petzl**: Test if product pages render specs without JS; if so, add static scraper
