# Data Quality Audit — 2026-03-26

## 1. Duplicates (5 groups)

| Brand | Model | Count | IDs |
|-------|-------|-------|-----|
| eagletac | sx30l2-dr | 2 | eagtac-sx30l2-dr-xp-l | eagletac-sx30l2-dr |
| fenix | pd40r v2.0 | 2 | fenix-pd40r-v2-0-sst-70 | fenix-pd40r-v2-0 |
| jlhawaii808 | hybrid mule optic quad/triple | 2 | jlhawaii808-hybrid-mule-optic-quad-triple | jlhawaii808-hybrid-mule-optic-quad-triple-nichia |
| jlhawaii808 | mod service and repair | 2 | jlhawaii808-mod-service-and-repair | jlhawaii808-mod-service-and-repair-nichia |
| miniware | mhp30 mini hot plate reflow station | 2 | miniware-mhp30-mini-hot-plate-reflow-station | miniware-mhp30-mini-hot-plate-reflow-station-nichia |

## 2. Suspicious Specs

### weight_g > 5000 (>5kg) — 48 entries
- **GYDEHUTJ Triple Extended MP5 MP7 Mag Pouch, 3 Molle Long 9mm Tactical Magazine Holster Quick Pull** (gydehutj-triple-extended-mp5-mp7-mag-pouch-3-molle-long-9mm-tactical-magazine-holster-quick-pull): 200000
- **Coast HP7 360 lm Focusing** (coast-hp7-360-lm-focusing): 163293
- **Coast (COS19265) PX45 Twist Focus** (coast-cos19265-px45-twist-focus): 140614
- **JETBeam Mini ONE USB Charge Cree XP-G3 500 Lumens 5 Color** (jetbeam-mini-one-usb-charge-cree-xp-g3-500-lumens-5-color): 68039
- **IProtec t Pro 100 Lite** (iprotec-t-pro-100-lite): 45359
- **Explore Scientific FirstLight 8" Dobsonian Telescope Package Includes ReflexSight, Astro R-Lite Red** (explore-scientific-firstlight-8-dobsonian-telescope-package-includes-reflexsight-astro-r-lite-red): 28576
- **Streamlight Portable Scene Light Rechargeable Lantern with 120V AC/DC Charger - 6 x C4 LEDs - 3600 Lumens - Uses 2 x 12V SLAs (45670)** (streamlight-portable-scene-light-rechargeable-lantern-with-120v-ac-dc-charger-6-x-c4-leds-3600-lumens-uses-2-x-12v-slas-45670): 11340
- **Streamlight 85179 CR123A 1400mAh 3V Lithium Primary (LiMnO2) Button Top Photo/Flashlight Battery - Box of 400** (streamlight-85179-cr123a-1400mah-3v-lithium-primary-limno2-button-top-photo-flashlight-battery-box-of-400): 7144
- **Mag-Lite Promotional ST3 Mag-Lite LED 3D** (mag-lite-promotional-st3-mag-lite-led-3d): 6804
- **Coast Cutlery COB** (coast-cutlery-cob): 6577
- **Maglite Flashlight Aircraft Aluminum D Cell Black** (maglite-flashlight-aircraft-aluminum-d-cell-black): 6468
- **Maglite ML25LT-S3036 Ml25lt 3c** (maglite-ml25lt-s3036-ml25lt-3c): 6010
- **NightSearcher TwinStar Connect LED Tripod** (nightsearcher-twinstar-connect-led-tripod): 6000
- **Wuben A1** (wuben-a1): 5897
- **Core Lighting WL-T006 LED Tripod** (core-lighting-wl-t006-led-tripod): 5816
- **Kircuit 12V AC/DC Adapter Compatible** (kircuit-12v-ac-dc-adapter-compatible): 5580
- **onerbl 12V AC/DC Adapter Compatible** (onerbl-12v-ac-dc-adapter-compatible): 5580
- **XMHEIRD Car DC Adapter Compatible** (xmheird-car-dc-adapter-compatible): 5580
- **Dapkbel Car DC Adapter Compatible** (dapkbel-car-dc-adapter-compatible): 5580
- **Kircuit Car DC Adapter Compatible** (kircuit-car-dc-adapter-compatible): 5580
- ... and 28 more

### length_mm > 1000 (>1m) — 4 entries
- **PowerTac USB Magnetic Charging Cable (M5/M6 GEN3)** (powertac-usb-magnetic-charging-cable-m5-m6-gen3): 1118
- **PowerTac USB Magnetic Charging Cable (See Compatibility Below)** (powertac-usb-magnetic-charging-cable-see-compatibility-below): 1118
- **Emisar DA1** (emisar-da1k-21700): 1111
- **PowerTac Magnetic USB Charging Cable, 3 in 1 Nylon Cord, Compatible with Micro USB, Type C, and Apple Products** (powertac-magnetic-usb-charging-cable-3-in-1-nylon-cord-compatible-with-micro-usb-type-c-and-apple-products): 1016

### price_usd > 3000 — 3 entries
- **Pelican 9470M** (pelican-9470m-led): 5455.95
- **Pelican 9470** (pelican-9470-led): 5244.95
- **Pelican 9460M** (pelican-9460m-led): 3111.95

### throw_m > 5000 — 17 entries
- **Maglite P32112M LED AAA Mini Mag** (maglite-p32112m-led-aaa-mini-mag): 32112
- **Maglite P32102M LED AAA Mini Mag** (maglite-p32102m-led-aaa-mini-mag): 32102
- **Maglite P32092M LED AAA Mini Mag** (maglite-p32092m-led-aaa-mini-mag): 32092
- **Maglite P32032M LED AAA Mini Mag** (maglite-p32032m-led-aaa-mini-mag): 32032
- **Maglite P32012M LED AAA Mini Mag** (maglite-p32012m-led-aaa-mini-mag): 32012
- **Maglite SP22117M 2AA Mini** (maglite-sp22117m-2aa-mini): 22117
- **Maglite SP22107M 2AA Mini** (maglite-sp22107m-2aa-mini): 22107
- **Maglite SP22097M 2AA Mini** (maglite-sp22097m-2aa-mini): 22097
- **Maglite SP22037M 2AA Mini** (maglite-sp22037m-2aa-mini): 22037
- **Maglite SP22017M 2AA Mini** (maglite-sp22017m-2aa-mini): 22017
- **Energizer Eveready Super Heavy Duty 1209 11000mAh 6V Zinc Carbon Lantern Battery** (energizer-eveready-super-heavy-duty-1209-11000mah-6v-zinc-carbon-lantern-battery): 11000
- **Skylumen Lumintop B01vn Bicycle** (sky-lumen-lumintop-b01vn-bicycle): 6000
- **NlightD X1 3000lm 5786m LEP** (nlightd-x1-3000lm-5786m-lep): 5786
- **Skylumen ONE-OFF Abandoned Prototype** (sky-lumen-one-off-abandoned-prototype): 5600
- **FourSevens 26650** (foursevens-26650): 5500
- **Acebeam W10 Gen II Ultra-Throw LEP Flashlight - 450 Lumens - Includes 1 x 21700** (acebeam-w10-gen-ii-ultra-throw-lep-flashlight-450-lumens-includes-1-x-21700): 5100
- **Acebeam W50 20 Zoomable Lep Flashlight** (acebeam-w50-20-zoomable-lep-flashlight): 5062

### lumens > 100,000 — 18 entries
- **Imalent SR32 Longest Throw** (imalent-sr32-longest-throw): [120000]
- **Haikelite AK24 230000lm High-Power** (haikelite-ak24-230000lm-high-power): [230000,180000,30000,11000,7500,6500,3500,2000]
- **Imalent MS32** (imalent-ms32-20w-lumens-powerful-xhp70): [200000,40000,18000,9000,4000,2000,80]
- **Imalent SR32** (imalent-sr32-120000-lumen-xhp50): [120000,25000,9000,4500,1500,30]
- **Skylumen HaikeLite HK24 230,000Lumen** (sky-lumen-haikelite-hk24-230-000lumen): [230000,200000]
- **Imalent SR32W** (imalent-sr32w-120-000-lumen-rechargeable-longest-throw-led-flashlight-warm-white-xhp50): [120000,25000,9000,4500,1500,30]
- **Imalent MS32W** (imalent-ms32w-200-000-lumen-rechargeable-warm-led-flashlight-brightest-handheld-flashlight-in-the-world-xhp70): [200000,40000,18000,9000,4000,2000,80]
- **TEXAS ACE BLF Calibrated Lumen Tube Flashlight Lumen Tester** (texas-ace-blf-calibrated-lumen-tube-flashlight-lumen-tester): [200000,5000]
- **Imalent MS32 Brightest** (imalent-ms32-brightest): [200000]
- **Imalent SR32 Brightest** (imalent-sr32-brightest): [120000]
- **Imalent SR32 120000 Lumens** (imalent-sr32-120000-lumens): [120000]
- **Imalent MS32W Brightest** (imalent-ms32w-brightest): [200000,80]
- **Imalent Flashlight Accessories Battery Pack for SR32 Brightest** (imalent-flashlight-accessories-battery-pack-for-sr32-brightest): [120000]
- **Bgojot USBC Charger for IMALENT MS32 Brightest** (bgojot-usbc-charger-for-imalent-ms32-brightest): [200000]
- **EeTao PD18W+USBC Charger for IMALENT MS32 Brightest** (eetao-pd18w-usbc-charger-for-imalent-ms32-brightest): [200000]
- **Imalent SR32 Rechargeable Bright** (imalent-sr32-rechargeable-bright): [120000]
- **Mamstcd USBC Charger for IMALENT MS32 Brightest** (mamstcd-usbc-charger-for-imalent-ms32-brightest): [200000]
- **Saschedross PD18W+USBC Charger for Charging IMALENT MS32 Brightest** (saschedross-pd18w-usbc-charger-for-charging-imalent-ms32-brightest): [200000]

### runtime_hours > 5,000h — 1 entries
- **Armytek Barracuda Pro / XHP35 HI White LED / 1500 lumens / 5Ã‚Â°:40Ã‚Â°** (armytek-barracuda-pro-xhp35-hi-white-led-1500-lumens-5-40): [1,12000]

## 3. Image Coverage

- Total entries: 12493
- Missing images: 269 (2.2%)
- With images: 12224 (97.8%)
- Sprite tiles: 11444
- Sprite ID mappings: 11444

## 4. No-Name Brands (no manufacturer URL) — 574 brands, 2657 entries

| Brand | Entries | Avg Completeness |
|-------|---------|------------------|
| BAULBOUGH | 1 | 5 |
| CHAPCHAIR | 1 | 5 |
| CNC2Lighting | 1 | 5 |
| FLIR | 1 | 5 |
| Fram | 1 | 5 |
| Lion Claws Mil Sim | 1 | 5 |
| RKH | 1 | 5 |
| RYHTHYHTJUYQSD | 4 | 5.5 |
| Accessory USA | 4 | 6 |
| AhulR Apps | 1 | 6 |
| Android App Developer | 1 | 6 |
| Bacharach | 1 | 6 |
| CEMENTEX | 1 | 6 |
| CVLIFE | 1 | 6 |
| Despicable Me | 1 | 6 |
| ERA LTDA | 1 | 6 |
| Essential Gear | 1 | 6 |
| Fenleihu | 1 | 6 |
| H.ROLET | 1 | 6 |
| JADSOrBoBi | 1 | 6 |
| Mag Instrument | 24 | 6 |
| Nessagro | 1 | 6 |
| Ocimocylo | 1 | 6 |
| PEETPEN | 1 | 6 |
| PZHANGZVH | 1 | 6 |
| ProMag | 1 | 6 |
| Prollery Apps | 1 | 6 |
| RGD | 1 | 6 |
| RUMINER | 1 | 6 |
| Reisener | 1 | 6 |
| Rothco | 1 | 6 |
| SHAOYI | 1 | 6 |
| SXZFTYHB | 1 | 6 |
| SafeBay | 1 | 6 |
| Simply Green Solutions | 1 | 6 |
| Sportsman Supply Inc. | 1 | 6 |
| THE PETOSKEY STONE | 1 | 6 |
| TableTop King | 1 | 6 |
| UnknownALSTEN | 1 | 6 |
| Welironly | 1 | 6 |
| XUYUAN | 1 | 6 |
| YJan | 1 | 6 |
| オーム（OHM） | 1 | 6 |
| East Face | 2 | 6.5 |
| LT Easiyl | 2 | 6.5 |
| MPKKE | 2 | 6.5 |
| MRRIEKSEFEN | 2 | 6.5 |
| KONKIN BOO | 5 | 6.6 |
| ABLEGRID | 5 | 6.7 |
| 416 LUMENS LIGHT HOUSE | 1 | 7 |
| ... | 2566 more | ... |

## 5. Completeness Distribution

| Score | Count | % | Bar |
|-------|-------|---|-----|
| 4/16 | 3 | 0.0% | █ |
| 5/16 | 93 | 0.7% | █ |
| 6/16 | 298 | 2.4% | ███ |
| 7/16 | 688 | 5.5% | ███████ |
| 8/16 | 790 | 6.3% | ████████ |
| 9/16 | 675 | 5.4% | ███████ |
| 10/16 | 672 | 5.4% | ███████ |
| 11/16 | 700 | 5.6% | ███████ |
| 12/16 | 595 | 4.8% | ██████ |
| 13/16 | 662 | 5.3% | ███████ |
| 14/16 | 862 | 6.9% | █████████ |
| 15/16 | 2015 | 16.1% | █████████████████████ |
| 16/16 | 4440 | 35.5% | █████████████████████████████████████████████ |

## 6. Lowest Quality Brands (≥3 entries)

| Brand | Entries | Avg Completeness |
|-------|---------|------------------|
| RYHTHYHTJUYQSD | 4 | 5.5 |
| Accessory USA | 4 | 6 |
| Mag Instrument | 24 | 6.1 |
| ABLEGRID | 5 | 6.2 |
| KONKIN BOO | 5 | 6.4 |
| Saschedross | 4 | 6.8 |
| Xzrucst | 4 | 6.8 |
| BestCH | 8 | 7 |
| CHZTYANG | 4 | 7 |
| FASPKOW | 6 | 7 |
| Haliniose | 3 | 7 |
| J-ZMQER | 5 | 7 |
| UPBRIGHT | 3 | 7 |
| HISPD | 6 | 7.2 |
| Aickar | 3 | 7.3 |
| Catapult | 3 | 7.3 |
| Holdmygear | 4 | 7.3 |
| Kircuit | 9 | 7.3 |
| Marg | 7 | 7.3 |
| SLLEA | 11 | 7.3 |
| Technical Precision | 146 | 7.3 |
| YUSTDA | 3 | 7.3 |
| Digipartspower | 6 | 7.5 |
| PKPOWER | 9 | 7.6 |
| HWZ | 3 | 7.7 |
| Kyz Kuv | 3 | 7.7 |
| GUY-TECH | 4 | 7.8 |
| LEATHERMAN | 5 | 7.8 |
| Mag-Lite | 10 | 7.9 |
| OMNIHIL | 7 | 7.9 |


## 7. Spec Verification Flags

1300 issues found across 12493 entries.

| Issue | Count |
|-------|-------|
| length <10mm | 890 |
| FL1 mismatch (throw vs intensity) | 290 |
| weight >5kg | 48 |
| weight too low for battery type | 46 |
| throw >5km | 17 |
| length >1m | 4 |
| lumens >200k | 2 |
| price >$5000 | 2 |
| runtime >10,000h | 1 |

### length <10mm
- **Acebeam 18650 3300mAh Rechargeable Battery** (acebeam-18650-3300mah-rechargeable-battery): 0.6mm
- **Acebeam Remote Pressure Switch (Compatible** (acebeam-remote-pressure-switch-compatible): 2.5mm
- **Acebeam FR20 2.0 Red Filter Compatible** (acebeam-fr20-2-0-red-filter-compatible): 4mm
- **Aimkon HiLight True Quick Release QR QD 1"** (aimkon-hilight-true-quick-release-qr-qd-1): 6.4mm
- **American Bench Craft Tactical Leather** (american-bench-craft-tactical-leather): 9.5mm
- **Armytek Crystal Red / White & Red / 150 lm & 30 lm / headband / bicycle mount / built-in Li-Pol battery** (armytek-crystal-red-white-red-150-lm-30-lm-headband-bicycle-mount-built-in-li-pol-battery): 3mm
- **Armytek Crystal Grey / White & Red / 150 lm & 30 lm / headband / bicycle mount / built-in Li-Pol battery** (armytek-crystal-grey-white-red-150-lm-30-lm-headband-bicycle-mount-built-in-li-pol-battery): 3mm
- **Armytek Crystal Green / White & Red LEDs 150 lumens & 30 lumens / headband / bicycle mount / built-in Li-Pol battery** (armytek-crystal-green-white-red-leds-150-lumens-30-lumens-headband-bicycle-mount-built-in-li-pol-battery): 3mm
- **Armytek Crystal Blue / White & Red LEDs 150 lumen & 30 lumen / headband / bicycle mount / built-in Li-Pol battery** (armytek-crystal-blue-white-red-leds-150-lumen-30-lumen-headband-bicycle-mount-built-in-li-pol-battery): 3mm
- **Armytek New Wizard C2 WR White-Red 1100 lm LED** (armytek-new-wizard-c2-wr-white-red-1100-lm-led): 6mm
- **Armytek New Elf C1 White Light 1000 lm LED** (armytek-new-elf-c1-white-light-1000-lm-led): 1mm
- **Armytek Wizard C2 Pro Max Magnet USB Olive Cool White 4000 Lumen** (armytek-wizard-c2-pro-max-magnet-usb-olive-cool-white-4000-lumen): 4.5mm
- **Armytek New Wizard C2 Warm Light 1120 lm LED** (armytek-new-wizard-c2-warm-light-1120-lm-led): 1mm
- **Armytek Keychain** (armytek-keychain): 0.9mm
- **Armytek New Elf C2 Warm Light 1023 lm LED** (armytek-new-elf-c2-warm-light-1023-lm-led): 1mm
- **Armytek New Elf C1 Warm Light 930 lm LED** (armytek-new-elf-c1-warm-light-930-lm-led): 7.6mm
- **Armytek New Wizard C2 Pro v4 Warm Light 2330 lm LED** (armytek-new-wizard-c2-pro-v4-warm-light-2330-lm-led): 1mm
- **BAILIY P13.5s E10 Ba9s Base 5w Led Upgrade Bulbs White Maglite Torches Dc6v-24v Work 6500k Bulbs** (bailiy-p13-5s-e10-ba9s-base-5w-led-upgrade-bulbs-white-maglite-torches-dc6v-24v-work-6500k-bulbs): 9mm
- **BAILIY 1PC P13.5S Mag Light LED Bulb 3-6 C&D Cells Torch** (bailiy-1pc-p13-5s-mag-light-led-bulb-3-6-c-d-cells-torch): 9mm
- **BAZEITFLOW Mag Flashlight Props Old Style Classic Metal Torch Portable Torch for Outdoor Activities** (bazeitflow-mag-flashlight-props-old-style-classic-metal-torch-portable-torch-for-outdoor-activities): 4.8mm
- **BBInfinite Olive Fenix E01** (bbinfinite-olive-fenix-e01): 8.9mm
- **Beileshi Series Offset Mount M Series** (beileshi-series-offset-mount-m-series): 7.6mm
- **BephaMart Convoy S2/S2+/M1/C8** (bephamart-convoy-s2-s2-m1-c8): 5.1mm
- **BOBBYBEE Rechargable** (bobbybee-rechargable): 8.9mm
- **BWESOO 1PC P13.5S Mag Light LED Bulb 3-6 C&D Cells Torch** (bwesoo-1pc-p13-5s-mag-light-led-bulb-3-6-c-d-cells-torch): 2.5mm
- **Cameron Sino CS Cameron Sino 700mAh / 2.59Wh Replacement Battery for Nightstick XPR-5554G** (cameron-sino-cs-cameron-sino-700mah-2-59wh-replacement-battery-for-nightstick-xpr-5554g): 7.2mm
- **Cameron Sino New 700mAh Replacement Battery for Nightstick XPR-5554G** (cameron-sino-new-700mah-replacement-battery-for-nightstick-xpr-5554g): 7.5mm
- **Catapult Sport Slingshot Kit Hunting Fishing Slingshots Powerful Catapult Sling Shot Wrist Sling Bow Archery Arrows** (catapult-sport-slingshot-kit-hunting-fishing-slingshots-powerful-catapult-sling-shot-wrist-sling-bow-archery-arrows): 2mm
- **Certified Brands Garmin Fenix 7S Pro Sapphire Solar Edition, 42mm, Carbon Gray DLC Titanium** (certified-brands-garmin-fenix-7s-pro-sapphire-solar-edition-42mm-carbon-gray-dlc-titanium): 4.2mm
- **Certified Brands Garmin Fenix 7S Pro Solar Edition, 42mm, Silver/Graphite** (certified-brands-garmin-fenix-7s-pro-solar-edition-42mm-silver-graphite): 4.2mm
- ... and 860 more

### FL1 mismatch (throw vs intensity)
- **909 LUMENS LIGHT HOUSE Fenix LD41 CREE XM-L2 U2 960LM 4Modes** (909-lumens-light-house-fenix-ld41-cree-xm-l2-u2-960lm-4modes): throw=1m → expected 0cd, got 22500cd (ratio: 90000.00)
- **948 LUMENS LIGHT HOUSE Fenix E99 TI Titanium Cree XP-E2 100LM AAA Waterproof Mini** (948-lumens-light-house-fenix-e99-ti-titanium-cree-xp-e2-100lm-aaa-waterproof-mini): throw=1m → expected 0cd, got 420cd (ratio: 1680.00)
- **Acebeam H17 2000 Lumen Lightweight Right Angle Headlamp 1 x 18350 Battery** (acebeam-h17-2000-lumen-lightweight-right-angle-headlamp-1-x-18350-battery-219b): throw=134m → expected 4489cd, got 79cd (ratio: 0.02)
- **Acebeam D20 2.0 Dive** (acebeam-d20-2-0-dive-sst-40): throw=500m → expected 62500cd, got 14280cd (ratio: 0.23)
- **Acebeam D20 V2** (acebeam-d20-v2-sst-40): throw=500m → expected 62500cd, got 14280cd (ratio: 0.23)
- **Acebeam Nichia 519a** (acebeam-nichia-519a-519a): throw=270m → expected 18225cd, got 6358cd (ratio: 0.35)
- **Acebeam Combo L19 Green** (acebeam-combo-l19-green): throw=1520m → expected 577600cd, got 26896cd (ratio: 0.05)
- **Acebeam Combo L19 PM1 White** (acebeam-combo-l19-pm1-white): throw=1300m → expected 422500cd, got 13188cd (ratio: 0.03)
- **AE Light Dual Switch LED Police Flashlight - CREE XM-L T6 LED - 480 Lumens - Uses 2 x CR123A, 2 x 16340 or 1 x 18650** (ae-light-dual-switch-led-police-flashlight-cree-xm-l-t6-led-480-lumens-uses-2-x-cr123a-2-x-16340-or-1-x-18650-xm-l2): throw=300m → expected 22500cd, got 4860cd (ratio: 0.22)
- **Armytek Value Bundle: Armytek Wizard C2 Pro Nichia (Warm) LED Multi** (armytek-value-bundle-armytek-wizard-c2-pro-nichia-warm-led-multi): throw=10m → expected 25cd, got 7560cd (ratio: 302.40)
- **Armytek New Elf C1 White Light 1000 lm LED** (armytek-new-elf-c1-white-light-1000-lm-led): throw=10m → expected 25cd, got 4320cd (ratio: 172.80)
- **Armytek New Wizard C2 Warm Light 1120 lm LED** (armytek-new-wizard-c2-warm-light-1120-lm-led): throw=106m → expected 2809cd, got 7560cd (ratio: 2.69)
- **Armytek Prime C2 Pro Xm-L2 Cool White** (armytek-prime-c2-pro-xm-l2-cool-white): throw=10m → expected 25cd, got 7560cd (ratio: 302.40)
- **Armytek Viking Pro v3 Cree XP-L Warm Turbo 1150 LED Lumens 360 Meters 10 Years Warranty Tactical Hunting Military** (armytek-viking-pro-v3-cree-xp-l-warm-turbo-1150-led-lumens-360-meters-10-years-warranty-tactical-hunting-military): throw=360m → expected 32400cd, got 3560cd (ratio: 0.11)
- **Armytek Keychain** (armytek-keychain): throw=15m → expected 56cd, got 1cd (ratio: 0.02)
- **Armytek Prime A2 Pro XM-L2** (armytek-prime-a2-pro-xm-l2): throw=10m → expected 25cd, got 5080cd (ratio: 203.20)
- **Armytek Dobermann Pro v2 Cree XHP35 High Intensity WARM TURBO 1580 LED Lumens up to 383 Meters 10 YEARS WARRANTY Tactical Hunting Military** (armytek-dobermann-pro-v2-cree-xhp35-high-intensity-warm-turbo-1580-led-lumens-up-to-383-meters-10-years-warranty-tactical-hunting-military): throw=383m → expected 36672cd, got 150000cd (ratio: 4.09)
- **Armytek Predator v3 Cree XP-E2** (armytek-predator-v3-cree-xp-e2): throw=250m → expected 15625cd, got 3560cd (ratio: 0.23)
- **Armytek Combo: Armytek Predator Pro v3 XHP35 Hi** (armytek-combo-armytek-predator-pro-v3-xhp35-hi): throw=50m → expected 625cd, got 50750cd (ratio: 81.20)
- **Armytek New Elf C2 Warm Light 1023 lm LED** (armytek-new-elf-c2-warm-light-1023-lm-led): throw=10m → expected 25cd, got 7560cd (ratio: 302.40)
- **Armytek Viking Pro v3 XHP50 Cool White LED** (armytek-viking-pro-v3-xhp50-cool-white-led): throw=50m → expected 625cd, got 3560cd (ratio: 5.70)
- **Armytek Prime C1 XP-L Cool White** (armytek-prime-c1-xp-l-cool-white): throw=10m → expected 25cd, got 4320cd (ratio: 172.80)
- **Armytek Tiara A1 v2 Cree XM-L2 WHITE** (armytek-tiara-a1-v2-cree-xm-l2-white): throw=63m → expected 992cd, got 3280cd (ratio: 3.31)
- **Armytek Dobermann Pro v2 Cree XHP35 High Intensity WHITE TURBO 1700 LED Lumens up to 390 Meters 10 YEARS WARRANTY Tactical Hunting Military** (armytek-dobermann-pro-v2-cree-xhp35-high-intensity-white-turbo-1700-led-lumens-up-to-390-meters-10-years-warranty-tactical-hunting-military): throw=390m → expected 38025cd, got 150000cd (ratio: 3.94)
- **Armytek Predator Pro v3 Cree XP-L HI Warm 1116 LED lm 424 m 10 Years Warranty Tactical Hunting Military** (armytek-predator-pro-v3-cree-xp-l-hi-warm-1116-led-lm-424-m-10-years-warranty-tactical-hunting-military): throw=424m → expected 44944cd, got 3560cd (ratio: 0.08)
- **Armytek New Elf C1 Warm Light 930 lm LED** (armytek-new-elf-c1-warm-light-930-lm-led): throw=10m → expected 25cd, got 4320cd (ratio: 172.80)
- **Armytek Viking v3 XP-L 1250 lm** (armytek-viking-v3-xp-l-1250-lm): throw=50m → expected 625cd, got 34200cd (ratio: 54.72)
- **Armytek Partner A1 Pro V3 XP-L** (armytek-partner-a1-pro-v3-xp-l): throw=10m → expected 25cd, got 3280cd (ratio: 131.20)
- **Coast XP6R Rechargeable** (coast-xp6r-rechargeable): throw=55m → expected 756cd, got 8100cd (ratio: 10.71)
- **Coast HX5 410 Lumen** (coast-hx5-410-lumen): throw=130m → expected 4225cd, got 1482cd (ratio: 0.35)
- ... and 260 more

### weight >5kg
- **Cameron Sino CS Cameron Sino 700mAh / 2.59Wh Replacement Battery for Nightstick XPR-5554G** (cameron-sino-cs-cameron-sino-700mah-2-59wh-replacement-battery-for-nightstick-xpr-5554g): 5554g
- **Cameron Sino New 700mAh Replacement Battery for Nightstick XPR-5554G** (cameron-sino-new-700mah-replacement-battery-for-nightstick-xpr-5554g): 5554g
- **Cazxooy 12V AC/DC Adapter Compatible** (cazxooy-12v-ac-dc-adapter-compatible): 5580g
- **Coast Cutlery COB** (coast-cutlery-cob): 6577g
- **Coast HP7R 300 lm Rechargeable Focusing** (coast-hp7r-300-lm-rechargeable-focusing): 5312g
- **Coast (COS19265) PX45 Twist Focus** (coast-cos19265-px45-twist-focus): 140614g
- **Coast HP7 360 lm Focusing** (coast-hp7-360-lm-focusing): 163293g
- **Core Lighting WL-T006 LED Tripod** (core-lighting-wl-t006-led-tripod): 5816g
- **Dapkbel Car DC Adapter Compatible** (dapkbel-car-dc-adapter-compatible): 5580g
- **Dmoizka 12V AC/DC Adapter for NightStick XPR-5586 XPR-5584 XPR-5582 XPR-5581 XPR-5580 XPR-5586GX 5584GMX 5582RX 5582GX 5581RX 5580G 5580R XPR Bayco** (dmoizka-12v-ac-dc-adapter-for-nightstick-xpr-5586-xpr-5584-xpr-5582-xpr-5581-xpr-5580-xpr-5586gx-5584gmx-5582rx-5582gx-5581rx-5580g-5580r-xpr-bayco): 5580g
- **Dmoizka Car DC Adapter for NightStick XPR-5586 XPR-5584 XPR-5582 XPR-5581 XPR-5580 XPR-5586GX 5584GMX 5582RX 5582GX 5581RX 5580G 5580R XPR Bayco** (dmoizka-car-dc-adapter-for-nightstick-xpr-5586-xpr-5584-xpr-5582-xpr-5581-xpr-5580-xpr-5586gx-5584gmx-5582rx-5582gx-5581rx-5580g-5580r-xpr-bayco): 5580g
- **Explore Scientific FirstLight 8" Dobsonian Telescope Package Includes ReflexSight, Astro R-Lite Red** (explore-scientific-firstlight-8-dobsonian-telescope-package-includes-reflexsight-astro-r-lite-red): 28576g
- **Fenleihu 3.7V Battery Replacement for Nightstick XPR-5554G** (fenleihu-3-7v-battery-replacement-for-nightstick-xpr-5554g): 5554g
- **FYIOGXG Cameron Sino Battery for Nightstick XPR-5554G** (fyiogxg-cameron-sino-battery-for-nightstick-xpr-5554g): 5554g
- **Generic 800mAh 3.7V Replacement Battery for Nightstick XPR-5554G** (generic-800mah-3-7v-replacement-battery-for-nightstick-xpr-5554g): 5554g
- **GYDEHUTJ Triple Extended MP5 MP7 Mag Pouch, 3 Molle Long 9mm Tactical Magazine Holster Quick Pull** (gydehutj-triple-extended-mp5-mp7-mag-pouch-3-molle-long-9mm-tactical-magazine-holster-quick-pull): 200000g
- **IProtec t Pro 100 Lite** (iprotec-t-pro-100-lite): 45359g
- **JETBeam Mini ONE USB Charge Cree XP-G3 500 Lumens 5 Color** (jetbeam-mini-one-usb-charge-cree-xp-g3-500-lumens-5-color): 68039g
- **JIAJIESHI Replacement Battery Fit for Nightstick XPR-5554G** (jiajieshi-replacement-battery-fit-for-nightstick-xpr-5554g): 5554g
- **K-MAINS Car DC Adapter Compatible** (k-mains-car-dc-adapter-compatible): 5580g
- **Kircuit 12V AC/DC Adapter Compatible** (kircuit-12v-ac-dc-adapter-compatible): 5580g
- **Kircuit Car DC Adapter Compatible** (kircuit-car-dc-adapter-compatible): 5580g
- **KONKIN BOO 12V AC Adapter Compatible** (konkin-boo-12v-ac-adapter-compatible): 5580g
- **Mag-Lite Promotional ST3 Mag-Lite LED 3D** (mag-lite-promotional-st3-mag-lite-led-3d): 6804g
- **Maglite Flashlight Aircraft Aluminum D Cell Black** (maglite-flashlight-aircraft-aluminum-d-cell-black): 6468g
- **Maglite ML25LT-S3036 Ml25lt 3c** (maglite-ml25lt-s3036-ml25lt-3c): 6010g
- **Metasources Car DC Adapter Compatible** (metasources-car-dc-adapter-compatible): 5580g
- **NightSearcher TwinStar Connect LED Tripod** (nightsearcher-twinstar-connect-led-tripod): 6000g
- **Nightstick XPP-5452G Intrinsically Safe Permissible Dual-Function** (nightstick-xpp-5452g-intrinsically-safe-permissible-dual-function): 5452g
- **Nightstick XPP-5450G Intrinsically Safe Permissible Dual-Function** (nightstick-xpp-5450g-intrinsically-safe-permissible-dual-function): 5450g
- ... and 18 more

### weight too low for battery type
- **Acebeam E70-TI** (acebeam-e70-ti-xhp70): 6g with 21700, 18650, CR123A
- **Acebeam Led Keychain Flashlight** (acebeam-led-keychain-flashlight): 18.9945g with 21700, 18650
- **Armytek Zippy Pink** (armytek-zippy-pink): 12g with 21700, 18650, 18350, CR123A
- **Exell A28PX 28A 6V Alkaline Industrial Battery for Pet Collars, Headlamps, Cameras - Equivalent to 4LR44, PX28, 544 - Tear Strip** (exell-a28px-28a-6v-alkaline-industrial-battery-for-pet-collars-headlamps-cameras-equivalent-to-4lr44-px28-544-tear-strip): 14g with 21700
- **Fenix Red Filter for TK Series LED Flashlights - Works with TK10, TK11, and TK20** (fenix-red-filter-for-tk-series-led-flashlights-works-with-tk10-tk11-and-tk20): 14g with 21700
- **Fenix FX-WD Diffuser Wand for most L and P series flashlights (AD101-W)** (fenix-fx-wd-diffuser-wand-for-most-l-and-p-series-flashlights-ad101-w): 9g with 21700
- **Fenix BTFL Blue Filter for TK Series LED Flashlights - Works with TK10, TK11, and TK20** (fenix-btfl-blue-filter-for-tk-series-led-flashlights-works-with-tk10-tk11-and-tk20): 14g with 21700
- **Fenix ALL-01 Flashlight Lanyard** (fenix-all-01-flashlight-lanyard): 18g with 21700
- **Fenix AD401 Diffuser Lens for LD/PD Series LED Flashlights - works with the LD10/20, PD20/30, and HP10** (fenix-ad401-diffuser-lens-for-ld-pd-series-led-flashlights-works-with-the-ld10-20-pd20-30-and-hp10): 9g with 21700
- **Fitorch ET25 Extender Tube for the P25 - Available in Black, Red or Blue** (fitorch-et25-extender-tube-for-the-p25-available-in-black-red-or-blue): 18g with 26650
- **Imalent MS03 rechargeable lithium battery** (imalent-ms03-rechargeable-lithium-battery): 8g with 21700
- **Inova LED Squeeze Light Keychain Flashlight with Black Body - White LED** (inova-led-squeeze-light-keychain-flashlight-with-black-body-white-led): 9g with 21700
- **JETBeam Color Filter - 1.46 Inches - Fits 3M Pro Flashlight - Red, Blue or Green** (jetbeam-color-filter-1-46-inches-fits-3m-pro-flashlight-red-blue-or-green): 18g with 21700
- **Klarus 16GT-70UR** (klarus-16gt-70ur): 18g with 21700, 18650, AAA
- **Klarus 14GT-80UR** (klarus-14gt-80ur): 19g with 21700, 18650, AAA
- **Klarus BZ-2 Flashlight Strike Bezel - Crenelated, 304 Stainless Steel - Fits 1.01-inch (25.6 mm) XT2CR** (klarus-bz-2-flashlight-strike-bezel-crenelated-304-stainless-steel-fits-1-01-inch-25-6-mm-xt2cr): 14g with 21700
- **Lumintop Type-C Rechargeable 21700** (lumintop-type-c-rechargeable-21700): 9g with 21700, built-in
- **Manchest TF DF008** (manchest-tf-df008): 18g with 18650, 26650
- **March C8 SST40/XHP35 HI 2000lm** (nealsgadgets-march-c8-sst40-xhp35-hi-2000lm-21700-ss-bezel-sst-40): 6g with 21700, 18650
- **MecArmy Replacement Belt Clip for the SGN3 Flashlight - Black or Polished** (mecarmy-replacement-belt-clip-for-the-sgn3-flashlight-black-or-polished): 5g with 21700
- **Nitecore ML21 High CRI Magnetic Flashlight - 80 Lumens** (nitecore-ml21-high-cri-magnetic-flashlight-80-lumens): 11g with 21700
- **Nitecore NF20 Filters for Flashlights with 19.7mm Head Diameters - Red, Blue, or Green** (nitecore-nf20-filters-for-flashlights-with-19-7mm-head-diameters-red-blue-or-green): 9g with 21700
- **Nitecore Nitecore NU05 LE Rechargeable Mini Signal Headlamp - Red, Green, Blue and White LEDs - Uses Built-In 120mAh Li-Ion Battery** (sysmax-industry-nite-core-nitecore-nu05-le-rechargeable-mini-signal-headlamp-red-green-blue-and-white-leds-uses-built-in-120mah-li-ion-battery): 10.4g with 21700, 18650
- **Nitecore NU05 Headband Accessory for the NU05 Headlamp Mate** (nitecore-nu05-headband-accessory-for-the-nu05-headlamp-mate): 10.4g with 21700
- **Nitecore NU05 Bike Mount Accessory for the NU05 Headlamp Mate** (nitecore-nu05-bike-mount-accessory-for-the-nu05-headlamp-mate): 5g with 21700
- **Nitecore Tactical Ring for** (nitecore-tactical-ring-for): 18g with 21700
- **Nitecore Pocket Clip for EX11** (nitecore-pocket-clip-for-ex11): 9g with 21700
- **Olight Replacement Pocket Clip for the M2R Pro and M2R Warrior Flashlights - Black** (olight-replacement-pocket-clip-for-the-m2r-pro-and-m2r-warrior-flashlights-black): 9g with 21700
- **Olight Red Filter - Fits the M10 and M18 LED Flashlights (FM10-R)** (olight-red-filter-fits-the-m10-and-m18-led-flashlights-fm10-r): 18g with 21700
- **Olight Green Filter - Fits the M10 and M18 LED Flashlights (FM10-G)** (olight-green-filter-fits-the-m10-and-m18-led-flashlights-fm10-g): 18g with 21700
- ... and 16 more

### throw >5km
- **Acebeam W10 Gen II Ultra-Throw LEP Flashlight - 450 Lumens - Includes 1 x 21700** (acebeam-w10-gen-ii-ultra-throw-lep-flashlight-450-lumens-includes-1-x-21700): 5100m
- **Acebeam W50 20 Zoomable Lep Flashlight** (acebeam-w50-20-zoomable-lep-flashlight): 5062m
- **Energizer Eveready Super Heavy Duty 1209 11000mAh 6V Zinc Carbon Lantern Battery** (energizer-eveready-super-heavy-duty-1209-11000mah-6v-zinc-carbon-lantern-battery): 11000m
- **FourSevens 26650** (foursevens-26650): 5500m
- **Maglite P32112M LED AAA Mini Mag** (maglite-p32112m-led-aaa-mini-mag): 32112m
- **Maglite SP22117M 2AA Mini** (maglite-sp22117m-2aa-mini): 22117m
- **Maglite SP22097M 2AA Mini** (maglite-sp22097m-2aa-mini): 22097m
- **Maglite SP22037M 2AA Mini** (maglite-sp22037m-2aa-mini): 22037m
- **Maglite P32102M LED AAA Mini Mag** (maglite-p32102m-led-aaa-mini-mag): 32102m
- **Maglite P32032M LED AAA Mini Mag** (maglite-p32032m-led-aaa-mini-mag): 32032m
- **Maglite SP22017M 2AA Mini** (maglite-sp22017m-2aa-mini): 22017m
- **Maglite SP22107M 2AA Mini** (maglite-sp22107m-2aa-mini): 22107m
- **Maglite P32012M LED AAA Mini Mag** (maglite-p32012m-led-aaa-mini-mag): 32012m
- **Maglite P32092M LED AAA Mini Mag** (maglite-p32092m-led-aaa-mini-mag): 32092m
- **NlightD X1 3000lm 5786m LEP** (nlightd-x1-3000lm-5786m-lep): 5786m
- **Skylumen Lumintop B01vn Bicycle** (sky-lumen-lumintop-b01vn-bicycle): 6000m
- **Skylumen ONE-OFF Abandoned Prototype** (sky-lumen-one-off-abandoned-prototype): 5600m

### length >1m
- **Emisar DA1** (emisar-da1k-21700): 1111mm
- **PowerTac USB Magnetic Charging Cable (M5/M6 GEN3)** (powertac-usb-magnetic-charging-cable-m5-m6-gen3): 1118mm
- **PowerTac USB Magnetic Charging Cable (See Compatibility Below)** (powertac-usb-magnetic-charging-cable-see-compatibility-below): 1118mm
- **PowerTac Magnetic USB Charging Cable, 3 in 1 Nylon Cord, Compatible with Micro USB, Type C, and Apple Products** (powertac-magnetic-usb-charging-cable-3-in-1-nylon-cord-compatible-with-micro-usb-type-c-and-apple-products): 1016mm

### lumens >200k
- **Haikelite AK24 230000lm High-Power** (haikelite-ak24-230000lm-high-power): 230000lm
- **Skylumen HaikeLite HK24 230,000Lumen** (sky-lumen-haikelite-hk24-230-000lumen): 230000lm

### price >$5000
- **Pelican 9470** (pelican-9470-led): $5244.95
- **Pelican 9470M** (pelican-9470m-led): $5455.95

### runtime >10,000h
- **Armytek Barracuda Pro / XHP35 HI White LED / 1500 lumens / 5Ã‚Â°:40Ã‚Â°** (armytek-barracuda-pro-xhp35-hi-white-led-1500-lumens-5-40): 12000h
