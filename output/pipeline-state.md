# Pipeline State — 2026-03-18

## Current Status: Vision re-run + pattern expansion — 33.1% valid

### Coverage (11,011 entries)
| Field | Current | Previous (3/17) | Δ |
|-------|---------|-----------------|---|
| lumens | ~100% | 83.3% | +16.7% |
| throw_m | 68.7% | 69.5% | -0.8%* |
| runtime | ~100%** | 64.1% | +35.9% |
| length_mm | 70.8% | 71.9% | -1.1%* |
| weight_g | 91.2% | 91.1% | +0.1% |
| led | 66.2% | 67.2% | -1.0%* |
| battery | 87.0% | 87.5% | -0.5%* |
| switch | 82.1% | 82.6% | -0.5%* |
| material | 78.5% | 79.3% | -0.8%* |
| color | 82.5% | 80.1% | +2.4% |
| features | 90.8% | 90.8% | — |
| price | 94.2% | 94.0% | +0.2% |
| purchase_url | 99.99% | 99.5% | +0.5% |

*Slight % drops due to +236 new entries from Coast store
**Runtime uses array-based storage; regex may show different counts

Fully valid: **3,648 entries (33.1%)** — up from 3,325 (30.9%)

### Session Gains (3/17-3/18)
- +323 valid entries
- +236 new entries (Coast Shopify store)
- Vision re-run: +355 color, +138 switch
- Pattern expansion: LED (SFQ/SSQ), throw (yards/feet/reach), runtime (BJ mode table), color (anodized), length (multiline)

### Near-Valid Distribution (entries missing N fields)
| Missing | Count | Cumulative |
|---------|-------|------------|
| 0 | 3,648 | 3,648 (33.1%) |
| 1 | 2,366 | 6,014 (54.6%) |
| 2 | 1,519 | 7,533 (68.4%) |
| 3 | 904 | 8,437 (76.6%) |

### Single-Field Blockers (2,366 entries missing exactly 1 field)
| Blocker | Count | Fillable? |
|---------|-------|-----------|
| led | 519 | Hard — brands don't publish emitter model |
| runtime | 516 | Hard — not in source text for most |
| throw | 450 | Medium — some review data available |
| color | 264 | Medium — vision pipeline done, remaining lack images |
| length | 218 | Hard — not in source text |
| material | 170 | Hard — not in source text |
| switch | 93 | Hard — vision pipeline done |
| price | 93 | Medium — Keepa scrape in progress |

### Active Background Tasks
- **Keepa discovery**: 5 brands done (Fenix 1246, Acebeam 456, Convoy 232, Lumintop 198, Armytek 92) — paused to prioritize scrape
- **Keepa scrape**: Processing 2,224 discovered ASINs for Amazon prices — token-limited (60/hr)
- **AI parser model**: Updated from healer-alpha to xiaomi/mimo-v2-omni (low yield: 4/200 enriched)

### Shopify Stores (all configured)
Fenix, Olight, Nitecore, Rovyvon, Wuben, Imalent, Maglite, Ledlenser, Pelican, Fireflies, Nextorch, PowerTac, Nightstick, Malkoff, ReyLight, Lumintop, FourSevens, Modlite, Cloud Defensive, Loop Gear, Coast, Skylumen + 7 multi-brand retailers

### Next Steps
1. Wait for Keepa scrape to complete — will unlock price-only blockers (93)
2. Resume Keepa discover for remaining ~23 brands
3. Look for structured spec databases (parametrek replacement, FL1 data)
4. Consider headless browser for Cloudflare-blocked sites (Convoy/Sofirn/Wurkkos)
5. Explore BLF posts for review data (rate-limited to ~1req/3s)
