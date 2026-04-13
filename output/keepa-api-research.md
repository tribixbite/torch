# Keepa API Research — Endpoints, Extension Internals & Data Extraction

Last updated: 2026-04-13

---

## 1. Official API Base URL & Authentication

All official API calls go through a single base URL:

```
https://api.keepa.com/{path}?key={accessKey}&{params}
```

- **Authentication**: 64-character access key required for ALL endpoints
- **Protocol**: HTTPS only, GZIP responses, JSON format
- **HTTP Methods**: GET (default), POST (when `postData` is present)
- **User-Agent**: `KEEPA-JAVA Framework-{version}`
- **Timeouts**: 30s connect, 120s read

### Token System

- Tokens refill per-minute based on subscription tier
- Unused tokens expire after 60 minutes
- Every response includes: `tokensLeft`, `refillIn` (ms), `refillRate` (tokens/min), `tokensConsumed`
- `/token` endpoint: free check of remaining tokens (no token cost)
- Status 429 = NOT_ENOUGH_TOKEN, 402 = PAYMENT_REQUIRED

### Keepa Time Format

All timestamps use "Keepa Time Minutes" — minutes since January 1, 2011:
```
unix_epoch_ms = (keepa_minutes + 21564000) * 60000
// Alternatively: keepa_minutes = (unix_ms / 60000) - 21564000
```

Constant: `KEEPA_ST_ORDINAL` = January 1, 2011

---

## 2. Complete API Endpoint Catalog

### 2.1 `/product` — Product Data & Price History

**Token cost**: 1 per ASIN (base), +2 per ASIN with offers, +1 for live data

```
GET https://api.keepa.com/product?key={key}&domain={domainId}&asin={asin1,asin2,...}
```

**Parameters**:
- `asin` — 1-100 ASINs (comma-separated), or 1-20 with offers
- `domain` — Integer: 1=US, 2=GB, 3=DE, 4=FR, 5=JP, 6=CA, 8=IT, 9=ES, 10=IN, 11=MX
- `stats` — Days of statistics (integer) or date range (two timestamps)
- `history` — Boolean, include price history CSV data
- `offers` — Number of marketplace offers to include (20-100)
- `update` — Hours since last update threshold
- `rating` — Include rating history
- `buybox` — Include Buy Box data
- `videos` — Include product videos
- `aplus` — Include A+ content
- `stock` — Include stock quantity
- `only-live-offers` — Only active offers
- `days` — Limit price history to last N days

**Price History Data Format** (`csv` field):
```
int[][] csv  // csv[CsvType_index] = [time1, price1, time2, price2, ...]
// Prices in smallest currency unit (cents for USD)
// Price of -1 = out of stock / no offer at that time
```

**CsvType Indices**:
| Index | Type | Description |
|-------|------|-------------|
| 0 | AMAZON | Amazon's own price |
| 1 | NEW | 3rd party New price |
| 2 | USED | 3rd party Used price |
| 3 | SALES | Sales Rank |
| 4 | LISTPRICE | List Price |
| 5 | COLLECTIBLE | Collectible price |
| 6 | REFURBISHED | Refurbished price |
| 7 | NEW_FBM_SHIPPING | New FBM shipping cost |
| 8 | LIGHTNING_DEAL | Lightning Deal price |
| 9 | WAREHOUSE | Amazon Warehouse Deals price |
| 10 | NEW_FBA | Lowest 3rd party FBA price |
| 11 | COUNT_NEW | New offer count |
| 12 | COUNT_USED | Used offer count |
| 13 | COUNT_REFURBISHED | Refurbished offer count |
| 14 | COUNT_COLLECTIBLE | Collectible offer count |
| 15 | EXTRA_INFO_UPDATES | Offer parameter update history |

**Offer history** (`offerCSV` field): flat list of triplets `[time, price, shipping, time, price, shipping, ...]`

### 2.2 `/deal` — Browsing Deals

**Token cost**: Variable

```
POST https://api.keepa.com/deal?key={key}
Content-Type: application/json
Body: { DealRequest JSON }
```

**Returns max 150 deals per request.**

**DealRequest Parameters** (47 fields):
| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | int | Pagination (150 results per page) |
| `domainId` | int | Amazon locale (required) |
| `priceTypes` | int[] | Deal type by CsvType index (single entry only) |
| `dateRange` | int | 0=day, 1=week, 2=month, 3=90 days |
| `deltaRange` | int[] | [min, max] absolute price difference (in cents, e.g. [0, 999] = max $9.99) |
| `deltaPercentRange` | int[] | [min, max] percentage change (min 10%) |
| `deltaLastRange` | int[] | [min, max] last change range |
| `currentRange` | int[] | [min, max] current price/rank |
| `salesRankRange` | int[] | [min, max] sales rank (-1 = open upper bound) |
| `excludeCategories` | long[] | Category IDs to exclude |
| `includeCategories` | long[] | Category IDs to include |
| `titleSearch` | string | Keyword search in product title |
| `isLowest` | bool | Is at all-time lowest |
| `isLowestOffer` | bool\|null | Is lowest offer |
| `isBackInStock` | bool | Back in stock |
| `isOutOfStock` | bool | Currently out of stock |
| `isRangeEnabled` | bool | Enable range filtering |
| `isFilterEnabled` | bool | Enable filters |
| `isPrimeExclusive` | bool\|null | Prime exclusive |
| `mustHaveAmazonOffer` | bool\|null | Must have Amazon offer |
| `mustNotHaveAmazonOffer` | bool\|null | Must NOT have Amazon offer |
| `singleVariation` | bool\|null | Single variation only |
| `hasReviews` | bool | Must have reviews |
| `filterErotic` | bool | Filter adult content |
| `minRating` | int\|null | Min rating (0-50 scale, -1 disables) |
| `sortType` | int | 1=age, 2=delta, 3=rank, 4=percent delta |
| `warehouseConditions` | int[] | 1=New, 2=Like New, 3=Very Good, 24=Good, 5=Acceptable |
| `manufacturer` | string[] | Filter by manufacturer |
| `brand` | string[] | Filter by brand |
| `productGroup` | string[] | Filter by product group |
| `model` | string[] | Filter by model |
| `color` | string[] | Filter by color |
| `size` | string[] | Filter by size |
| `material` | string[] | Filter by material |
| `type` | string[] | Filter by type |
| `unitType` | string[] | Filter by unit type |
| `scent` | string[] | Filter by scent |
| `itemForm` | string[] | Filter by item form |
| `pattern` | string[] | Filter by pattern |
| `style` | string[] | Filter by style |
| `itemTypeKeyword` | string[] | Custom search terms |
| `targetAudienceKeyword` | string[] | Target audience |
| `author` | string[] | Filter by author |
| `binding` | string[] | Filter by binding |
| `languages` | string[] | Filter by language |
| `edition` | string[] | Filter by edition |
| `format` | string[] | Filter by format |

**Deal Response**: Contains `dr` (array of Deal objects), `categoryIds`, `categoryNames`, `categoryCount`

**Deal Object Fields**: `asin`, `parentAsin`, `title`, `delta[][]`, `deltaPercent[][]`, `deltaLast[]`, `avg[][]`, `current[]`, `rootCat`, `creationDate`, `image`, `categories[]`, `lastUpdate`, `lightningEnd`, `minRating`, `warehouseCondition`, `warehouseConditionComment`, `currentSince[]`

**Deal Intervals**: DAY, WEEK, MONTH, _90_DAYS

### 2.3 `/query` — Product Finder

**Token cost**: Variable

```
POST https://api.keepa.com/query?key={key}&domain={domainId}
Body: { ProductFinderRequest JSON }
```

Returns list of ASINs matching criteria. Supports 200+ filter parameters covering dimensions, prices, dates, stock levels, ratings, product attributes.

```python
# Python example
product_parms = {
    "author": "jim butcher",
    "sort": ["current_SALES", "asc"],
}
asins = api.product_finder(product_parms, n_products=100)
```

### 2.4 `/tracking` — Price Drop Alerts (Programmatic)

**Sub-operations via `type` parameter**:

| Operation | Type | Description |
|-----------|------|-------------|
| Add tracking | `add` | Track a product with thresholds |
| Batch add | `add` | Up to 1000 trackings per request |
| Get tracking | `get` | Get tracking for specific ASIN |
| List all | `list` | List all tracked products |
| Get notifications | `notification` | Retrieve triggered notifications |
| Remove tracking | `remove` | Remove tracking for ASIN |
| Remove all | `removeAll` | Remove all trackings |
| Set webhook | `webhook` | Set webhook URL for push notifications |

```
POST https://api.keepa.com/tracking?key={key}&type={type}
Body: { TrackingRequest JSON }
```

**TrackingRequest Fields**:
- `asin` — Product to track
- `ttl` — Time to live in hours (0 = never expires)
- `expireNotify` — Notify on expiration
- `mainDomainId` — Amazon locale
- `thresholdValues[]` — Price thresholds (see below)
- `notifyIf[]` — Meta conditions (IN_STOCK, OUT_OF_STOCK)
- `notificationType[]` — Channels: EMAIL, API, MOBILE_APP, BROWSER
- `individualNotificationInterval` — Rearm timer in minutes (-1=account default, 0=disable repeat)
- `updateInterval` — Hours between updates
- `metaData` — User memo (max 500 chars)

**TrackingThresholdValue**:
- `thresholdValue` — Target price (in cents)
- `domain` — Amazon locale
- `csvType` — CsvType index (what price to track: AMAZON, NEW, USED, etc.)
- `isDrop` — true = price drop, false = price increase

**Webhook Configuration**:
- Set via `type=webhook` with URL parameter
- Push notifications: HTTP POST with single notification object
- Your server must respond 200 to confirm receipt
- Failed delivery retried once after 15 seconds

**Notification causes**: EXPIRED, DESIRED_PRICE, PRICE_CHANGE, PRICE_CHANGE_AFTER_DESIRED_PRICE, OUT_STOCK, IN_STOCK, DESIRED_PRICE_AGAIN

### 2.5 `/graphimage` — Price History Graph Images

**Token cost**: 1 per unique request (cached 90 min, re-requests free)

```
GET https://api.keepa.com/graphimage?key={key}&asin={asin}&domain={domainId}&{params}
```

**Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `asin` | string | Product ASIN (required) |
| `domain` | int | Amazon locale (required) |
| `amazon` | 0\|1 | Show Amazon price line |
| `new` | 0\|1 | Show New price line |
| `used` | 0\|1 | Show Used price line |
| `salesrank` | 0\|1 | Show Sales Rank |
| `bb` | 0\|1 | Show Buy Box price |
| `fba` | 0\|1 | Show FBA price |
| `range` | int | Time range in days (e.g. 365) |
| `width` | int | Image width in pixels (e.g. 800) |
| `height` | int | Image height in pixels (e.g. 400) |
| `cBackground` | hex | Background color (e.g. "ffffff") |
| `cAmazon` | hex | Amazon line color (e.g. "FFA500") |
| `cNew` | hex | New line color |
| `cUsed` | hex | Used line color |
| `cBB` | hex | Buy Box line color |
| `cFBA` | hex | FBA line color |

Returns: PNG image data

### 2.6 `/bestsellers` — Category Best Sellers

```
GET https://api.keepa.com/bestsellers?key={key}&domain={domainId}&category={categoryId}
```
Returns: List of ASINs

### 2.7 `/category` — Category Lookup

```
GET https://api.keepa.com/category?key={key}&domain={domainId}&category={categoryId}&parents={0|1}
```

### 2.8 `/search` — Category or Product Search

```
GET https://api.keepa.com/search?key={key}&domain={domainId}&type={category|product}&term={searchTerm}
```

Product search supports: `stats`, `page` (0-9), `history`, `update`, `asins-only`

### 2.9 `/seller` — Seller Information

```
GET https://api.keepa.com/seller?key={key}&domain={domainId}&seller={sellerId1,sellerId2,...}
```

Supports up to 100 sellers per request, optional `storefront` boolean.

### 2.10 `/topseller` — Most Rated Sellers

```
GET https://api.keepa.com/topseller?key={key}&domain={domainId}
```

### 2.11 `/lightningdeal` — Lightning Deals

```
GET https://api.keepa.com/lightningdeal?key={key}&domain={domainId}&asin={asin}
```

Updated every 10 minutes. Omit `asin` to get ALL current/upcoming lightning deals.

### 2.12 `/token` — Token Status (FREE)

```
GET https://api.keepa.com/token?key={key}
```

Returns: `tokensLeft`, `refillIn`, `refillRate` — **consumes 0 tokens**.

---

## 3. Free/Public Endpoint: graph.keepa.com

This is the most significant finding for token-free data access:

```
https://graph.keepa.com/pricehistory.png?asin={ASIN}&domain={domain}&amazon=1&new=1&used=1&range=365
```

**This endpoint requires NO API key and NO authentication.**

**Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `asin` | string | Product ASIN (required) |
| `domain` | string | Amazon TLD string: com, co.uk, de, fr, co.jp, ca, it, es, in, com.mx, com.br |
| `amazon` | 0\|1 | Show Amazon price |
| `new` | 0\|1 | Show New price |
| `used` | 0\|1 | Show Used price |
| `range` | int | Time range in days |

**Domain ID mapping** (for `api.keepa.com`):
```
com→1, co.uk→2, de→3, fr→4, co.jp→5, ca→6, it→8, es→9, in→10, com.mx→11, com.br→12
```

**Example**:
```
https://graph.keepa.com/pricehistory.png?asin=B09YNQCQKR&domain=com&amazon=1&new=1&used=1&range=365
```

**Limitations**: Returns a PNG image only (no structured data). Cannot extract actual price numbers from the image without OCR or pixel analysis. Useful for embedding in UIs.

---

## 4. Keepa Browser Extension — Internal Architecture

### 4.1 WebSocket Connection

The extension maintains a **persistent WebSocket connection** to:

```
wss://dyn.keepa.com
```

**Protocol Details**:
- Messages are **deflate-compressed JSON** (binary WebSocket frames)
- NOT encrypted beyond TLS — can be decoded with:
  ```javascript
  pako.inflate(atob(base64Message), { to: "string" });
  // Returns JSON like: {"status": 108, "n": 71}
  ```
- Connection includes unique user identifier (survives browser data clears AND extension reinstalls; must do both to reset)
- Identifier stored both in extension storage and as a cookie on keepa.com

### 4.2 Data Collection on Amazon Pages

When you visit an Amazon product page, the extension sends:

```json
{
  "payload": [null],
  "scrapedData": {"tld": "de"},
  "ratings": [{"rating": "4,3", "ratingCount": "2.924", "asin": "B0719M4YZB"}],
  "key": "f1",
  "domainId": 3
}
```

On search result pages, `ratings` contains one entry per search result.

### 4.3 Keepa Box Injection

The extension injects an iframe into Amazon product pages:

**Current URL**: `https://keepa.com/keepaBox.html#{domainId}-{mode}-{ASIN}`
**Legacy URL**: `https://keepa.com/iframe_addon.html#{domainId}-{mode}-{ASIN}`

Example: `https://keepa.com/keepaBox.html#3-0-B07FCMBLV6`

The Keepa Box is "mostly independent of the extension" — the extension merely assists it by handling some messages.

### 4.4 Extension Scraping Mechanism

The content script accepts scraping instructions via `window.postMessage()`:

```javascript
window.addEventListener("message", function(event) {
  if (event.source == window.parent && event.data) {
    var instructions = event.data.value;
    if ("data" == event.data.key && instructions.url == document.location) {
      scrape(instructions, function(scrapeResult) {
        window.parent.postMessage({ sandbox: scrapeResult }, "*");
      });
    }
  }
});
```

The server can send scraping directives containing URLs, CSS selectors, and regex patterns. The extension can:
- Load Amazon pages in background frames
- Modify security headers via `chrome.webRequest.onBeforeSendHeaders.addListener`
- Execute arbitrary JavaScript in Amazon tabs via `chrome.tabs.executeScript`

**Security note**: Keepa 3.88+ checks message origin; only messages from extension pages are accepted.

### 4.5 Key Takeaway for Extension API

The extension does NOT use different API endpoints than the documented API. It uses:
1. `wss://dyn.keepa.com` for real-time coordination/scraping tasks
2. `https://keepa.com/keepaBox.html` for the injected price chart (client-side rendered)
3. Standard ASIN-based lookups through keepa.com infrastructure

The extension's price charts are rendered client-side from data loaded within the keepaBox iframe — not via separate API calls that could be intercepted for structured data.

---

## 5. RSS Feeds

Keepa provides RSS feeds for price watch notifications:

- Available in your Keepa account settings
- Feed URL is per-user (contains your account identifier)
- Can be consumed by feed readers, Zapier, Discord bots, etc.
- Format: Standard RSS/XML with price alert entries
- **Does NOT provide raw price history data** — only triggered alerts

Usage with Zapier:
1. Get your RSS feed URL from Keepa account
2. Create Zapier trigger: "New Item in Feed"
3. Route to Discord/Slack/email

---

## 6. Product Viewer / CSV Export

- **Quota**: 24,000 ASINs/day import+export (with paid subscription)
- **Replenishes**: 5% per hour
- **No separate API endpoint** — this is a website feature, not a programmable API
- Can upload up to 10,000 ASINs via CSV/text file for batch tracking
- Export available as CSV from the website interface
- **Cannot be automated programmatically** without browser automation

---

## 7. Pricing & Token Tiers

| Plan | Price | Tokens/min | Products/hour | Products/day |
|------|-------|------------|---------------|--------------|
| Basic | ~19/mo (with Keepa sub) | 1 | 60 | 1,440 |
| API Starter | ~49/mo | 20 | 1,200 | 28,800 |
| Higher tiers | Up to ~53,500/mo | Higher | Higher | Higher |

Token costs per endpoint:
- `/product` (basic): 1 token per ASIN
- `/product` (with offers): +2 tokens per ASIN
- `/product` (live data): +1 token
- `/deal`: variable (per page)
- `/graphimage`: 1 token (cached 90 min, re-request free)
- `/bestsellers`: 1 token
- `/category`: 1 token
- `/token`: 0 tokens (free)
- `/lightningdeal`: variable

---

## 8. Alternative Data Extraction Approaches

### 8.1 graph.keepa.com (FREE, no auth)

Best option for visual-only price data:
```
https://graph.keepa.com/pricehistory.png?asin=B09YNQCQKR&domain=com&amazon=1&new=1&used=1
```
- No API key needed
- Returns PNG image
- Useful for UI embedding
- Cannot extract structured data without OCR

### 8.2 RSS Feed + Automation

- Set up Keepa price watches via website
- Use RSS feed URL with Zapier/n8n/custom script
- Only provides alert notifications, not price history

### 8.3 Deal Endpoint Abuse Prevention

Keepa explicitly designs their system to "deter extensive data scraping" with:
- Token expiration (1 hour)
- Daily quotas on Product Viewer
- IP-based rate limiting
- Token costs per request

### 8.4 Scraping keepa.com Directly

NOT recommended:
- Website is fully client-side rendered (SPA with WebSocket)
- All data loaded via WebSocket to `dyn.keepa.com`
- Messages are deflate-compressed binary
- Would need to reverse-engineer the full WebSocket protocol

### 8.5 CamelCamelCamel as Free Alternative

- Completely free price history and alerts
- No public API
- Browser extension available
- Less granular than Keepa (no hourly updates, no sales rank)

---

## 9. Practical Recommendations for Torch Pipeline

Given our constraint of limited Keepa tokens (1/min refill):

1. **Use `graph.keepa.com/pricehistory.png`** for visual price history in the torch UI — completely free, no tokens consumed. Embed as `<img>` tags with ASIN.

2. **Use `/deal` endpoint** strategically to find flashlight deals (category-filtered) — but consumes tokens.

3. **Use `/tracking` with webhook** to set up price drop alerts for specific flashlights — one-time token cost to set up tracking.

4. **Batch product queries** — `/product` supports up to 100 ASINs per request at 1 token per ASIN. Combine lookups.

5. **Cache aggressively** — graphimage cached 90 min server-side. Product data should be cached locally.

6. **Use `/token` endpoint** to check balance before expensive queries — costs 0 tokens.

---

## Sources

- [Keepa Official API Backend (Java)](https://github.com/keepacom/api_backend)
- [Keepa PHP API](https://github.com/keepacom/php_api)
- [Python Keepa Library](https://github.com/akaszynski/keepa)
- [Keepa Python Docs](https://keepaapi.readthedocs.io/en/latest/api_methods.html)
- [Data Exfiltration in Keepa (Palant)](https://palant.info/2021/08/02/data-exfiltration-in-keepa-price-tracker/)
- [Abusing Keepa Price Tracker (Palant)](https://palant.info/2021/10/05/abusing-keepa-price-tracker-to-track-users-on-amazon-pages/)
- [Keepa Extension Scraping (Chromium)](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/il9VqQBc8So)
- [Keepa MCP Server](https://github.com/cosjef/Keepa_MCP)
- [Keepa Graph Embed UserScript](https://gist.github.com/gperezmz/9eed8bf96ff5d7f50f00e407f60bf480)
- [Amazon Price Charts UserScript](https://greasyfork.org/en/scripts/416590-amazon-camelcamelcamel-keepa-price-charts/code)
- [CData Keepa Reference](https://docs.datavirtuality.com/connectors/keepa-api-reference)
- [Keepa DeepWiki API Reference](https://deepwiki.com/akaszynski/keepa/3-api-reference)
