#!/usr/bin/env bun
/**
 * Targeted extraction of runtime, throw, and length from raw_spec_text
 * for entries missing those fields. Uses regex patterns more aggressive
 * than the standard AI parser, validated with sanity checks.
 */
import { Database } from 'bun:sqlite';

const dbPath = `${import.meta.dir}/../pipeline-data/db/torch.sqlite`;
const db = new Database(dbPath, { strict: true });
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 30000');

// ===== RUNTIME EXTRACTION =====
function extractRuntime(text: string): number[] {
  const runtimes: number[] = [];
  const seen = new Set<number>();

  // Strip zero-width spaces and other invisible unicode before matching
  const clean = text.replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, '');

  // Pattern: "runtime: Xh" / "run time: X hours" / "max runtime X hrs"
  // Note: also handle "run-time" with hyphen
  const rtPatterns = [
    /(?:max\s+)?run[\s-]*time\s*[-:=]\s*(\d+\.?\d*)\s*(?:h(?:ou)?rs?|h)\b/gi,
    /(?:max\s+)?run[\s-]*time\s*[-:=]\s*(\d+)\s*(?:min(?:ute)?s?|m)\b/gi,
    // "XX hours" standalone near runtime context (handles "of" between)
    /(?:up\s+to\s+|max(?:imum)?\s+|approx\.?\s*)?(\d+\.?\d*)\s*(?:hours?|hrs?)\s+(?:of\s+)?(?:runtime|run[\s-]*time)/gi,
    // "runtime XX hours" / "run time XX hrs"
    /(?:run[\s-]*time|runtime)\s+(?:up\s+to\s+|of\s+|approx\.?\s*)?(\d+\.?\d*)\s*(?:hours?|hrs?|h)\b/gi,
    // "Xh runtime" / "X hours run time"
    /(\d+\.?\d*)\s*(?:hours?|hrs?|h)\s+(?:of\s+)?(?:runtime|run[\s-]*time)/gi,
    // "low: Xh" / "high: X hours" / "turbo: X.X hrs" (mode-based with lumens/slash)
    /(?:low|med|medium|mid|high|turbo|eco|moonlight|firefly)\s*[:=]\s*\S+\s*\/\s*(\d+\.?\d*)\s*(?:hours?|hrs?|h)\b/gi,
    // Mode-based: "High: 2 hours, 45 minutes" / "Low: 10 hours"
    /(?:low|med|medium|mid|high|turbo|eco|moonlight|firefly|strobe)\s*[-:=]\s*(?:\d+\s*(?:lumens?|lm)\s*[;,]\s*)?(\d+\.?\d*)\s*(?:hours?|hrs?|h)\b/gi,
    // Table format: "X hrs" near "Runtime" header
    /Runtime[^]*?(\d+\.?\d*)\s*(?:hours?|hrs?|h)\b/gi,
    // "battery life: X hours"
    /battery\s+life\s*[-:=]\s*(?:up\s+to\s+)?(\d+\.?\d*)\s*(?:hours?|hrs?|h)\b/gi,
    // "lasts X hours" / "up to X hours"
    /(?:lasts?|up\s+to)\s+(\d+\.?\d*)\s*(?:hours?|hrs?|h)\b/gi,
    // "Xh (low)" / "X hours on low"
    /(\d+\.?\d*)\s*(?:hours?|hrs?|h)\s+(?:\(?\s*(?:on\s+)?(?:low|eco|moonlight|firefly))/gi,
    // "X hours Y minutes" combined → convert to decimal hours
    /(\d+)\s*(?:hours?|hrs?|h)\s*,?\s*(\d+)\s*(?:min(?:ute)?s?|m)\b/gi,
    // Standalone "X h" on its own line (table format) — requires line boundary
    /(?:^|\n)\s*(\d+\.?\d*)\s*h\s*(?:\n|$)/gim,
    // Nightstick-style: "Runtime (h): X.X" / "High Runtime (h): 3.0"
    /(?:(?:high|med|low|turbo)\s+)?runtime\s*\(h\)\s*[-:=]\s*(\d+\.?\d*)/gi,
    // Nightstick-style: "Runtime (min): X" → convert to hours
    /(?:(?:high|med|low|turbo)\s+)?runtime\s*\(min\)\s*[-:=]\s*(\d+\.?\d*)/gi,
    // "Xlm Xhours" / "Xlm Xhrs" (mode table like "180lm 15hours")
    /\d+\s*(?:lumens?|lm)\s*[;,]?\s*(\d+\.?\d*)\s*(?:hours?|hrs?)\b/gi,
    // "Xhours" next to lumens with semicolon: "1lm 900hours;"
    /(\d+)\s*(?:hours?|hrs?)\s*[;,]/gi,
  ];

  for (const pat of rtPatterns) {
    let m;
    while ((m = pat.exec(clean)) !== null) {
      let val: number;
      // Combined "X hours Y minutes" pattern — has two capture groups
      if (m[2] !== undefined && pat.source.includes('hours?|hrs?|h)\\s*,?\\s*(\\d+)')) {
        val = parseFloat(m[1]) + parseFloat(m[2]) / 60;
      } else {
        val = parseFloat(m[1]);
        // Check if matched as minutes-only pattern
        if ((pat.source.includes('min(?:ute)?') || pat.source.includes('\\(min\\)')) && !pat.source.includes('hours?')) {
          val = val / 60;
        }
      }
      // Round to 2 decimal places
      val = Math.round(val * 100) / 100;
      // Sanity: runtime should be 0.01h to 5000h, skip LED lifespan (>10000h)
      if (val >= 0.01 && val <= 5000 && !seen.has(val)) {
        seen.add(val);
        runtimes.push(val);
      }
    }
  }

  return runtimes.sort((a, b) => b - a); // highest first
}

// ===== THROW EXTRACTION =====
function extractThrow(text: string): number | null {
  const clean = text.replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, '');
  const patterns = [
    // "beam distance: 210m" / "throw: 300m" / "max beam distance 500m"
    /(?:beam\s+distance|throw(?:\s+distance)?|peak\s+beam\s+distance|max(?:imum)?\s+(?:beam\s+)?distance)\s*[-:=]\s*(?:up\s+to\s+)?(\d+\.?\d*)\s*(?:m(?:eters?)?|ft|yards?)\b/gi,
    // "210m beam distance" / "300m throw"
    /(\d+\.?\d*)\s*(?:m(?:eters?)?)\s+(?:beam\s+distance|throw(?:\s+distance)?|peak\s+beam|max\s+beam)/gi,
    // "beam range: XXm" / "XXm beam range"
    /(?:beam\s+range)\s*[-:=]\s*(?:up\s+to\s+)?(\d+\.?\d*)\s*(?:m(?:eters?)?)\b/gi,
    /(\d+\.?\d*)\s*(?:m(?:eters?)?)\s+(?:beam\s+range)/gi,
    // "distance of 300m" / "range of 200m"
    /(?:distance|range)\s+(?:of\s+)?(\d+\.?\d*)\s*(?:m(?:eters?)?)\b/gi,
    // "XXXm throw" / "XXXm beam"
    /(\d+)\s*m\s+(?:throw|beam)/gi,
    // "beam intensity XXXXX cd" - calculate throw
    /(?:beam\s+)?intensity\s*[-:=]\s*(\d[\d,]*)\s*(?:cd|candela)/gi,
    // "peak beam intensity XXXXXcd" / "XXXXX cd"
    /(?:peak\s+beam\s+)?intensity\s*[-:=]?\s*(\d[\d,]+)\s*(?:cd|candela)/gi,
    // "XXX,XXX candela"
    /(\d[\d,]+)\s*(?:cd|candela)/gi,
    // "XXft" / "XXX feet" beam distance
    /(?:beam\s+distance|throw|beam\s+range)\s*[-:=]\s*(?:up\s+to\s+)?(\d+\.?\d*)\s*(?:ft|feet|foot)\b/gi,
    // Nightstick-style: "Beam Distance (m): X" / "High Beam Distance (m): 190"
    /(?:(?:high|med|low|turbo)\s+)?beam\s+distance\s*\(m\)\s*[-:=]\s*(\d+\.?\d*)/gi,
    // "Beam Distance (ft): X" / "High Beam Distance (ft): 620"
    /(?:(?:high|med|low|turbo)\s+)?beam\s+distance\s*\(ft\)\s*[-:=]\s*(\d+\.?\d*)/gi,
    // Nightstick-style: "Candela: XXXX" / "High Candela: 9150"
    /(?:(?:high|med|low|turbo)\s+)?candela\s*[-:=]\s*(\d[\d,]*)/gi,
  ];

  let bestThrow: number | null = null;

  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(clean)) !== null) {
      let val = parseFloat(m[1].replace(/,/g, ''));

      // If candela, convert to throw: throw_m = 2 * sqrt(cd)
      if (pat.source.includes('cd|candela') || pat.source.includes('intensity') || pat.source.includes('candela\\s*[-:=]')) {
        if (val > 100) { // Only if > 100 cd (sanity)
          val = 2 * Math.sqrt(val);
        } else {
          continue;
        }
      }

      // If feet, convert to meters
      if (pat.source.includes('ft|feet|foot') || pat.source.includes('\\(ft\\)')) {
        val = val * 0.3048;
      }

      // Sanity: throw should be 1m to 3000m
      if (val >= 1 && val <= 3000) {
        if (bestThrow === null || val > bestThrow) {
          bestThrow = Math.round(val * 10) / 10;
        }
      }
    }
  }

  return bestThrow;
}

// ===== LENGTH EXTRACTION =====
function extractLength(text: string): number | null {
  const clean = text.replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, '');
  const patterns = [
    // "length: 132.5mm" / "length - 120mm" / "overall length: 5.21 in"
    /(?:overall\s+)?length\s*[-:=]\s*(\d+\.?\d*)\s*mm/gi,
    /(?:overall\s+)?length\s*[-:=]\s*(\d+\.?\d*)\s*(?:in(?:ch(?:es)?)?|")\b/gi,
    /(?:overall\s+)?length\s*[-:=]\s*(\d+\.?\d*)\s*cm\b/gi,
    // "X.XX in (Ymm)" — "5.21 in (132mm)"
    /(?:overall\s+)?length\s*[-:=]\s*(\d+\.?\d*)\s*(?:in(?:ch(?:es)?)?|")\s*\((\d+\.?\d*)\s*mm\)/gi,
    // "132.5mm (length)" / "132.5mm overall"
    /(\d+\.?\d*)\s*mm\s*(?:\(?\s*(?:overall\s+)?length)/gi,
    // "size: AxBxCmm" — take largest value as length
    /(?:size|dimensions?)\s*[-:=]\s*(\d+\.?\d*)\s*[x×*]\s*(\d+\.?\d*)\s*[x×*]\s*(\d+\.?\d*)\s*mm/gi,
    // "LxWxH mm" format (with mm on each or at end)
    /(\d+\.?\d*)\s*(?:mm\s*)?[x×*]\s*(\d+\.?\d*)\s*(?:mm\s*)?[x×*]\s*(\d+\.?\d*)\s*mm/gi,
    // "X.XX in (Ymm)" standalone
    /(\d+\.?\d*)\s*(?:in(?:ch(?:es)?)?|")\s*\(?\s*(\d+\.?\d*)\s*mm\s*\)?/gi,
    // "Length Xmm" / "Length X mm" (no separator)
    /(?:overall\s+)?length\s+(\d+\.?\d*)\s*mm/gi,
    // "X.XX in" or "X.XX inches" near length context
    /(?:overall\s+)?length\s*[-:=]\s*(\d+\.?\d*)\s*["″]/gi,
    // "L-X.XX"" / "L:X.XX in" format (abbreviated)
    /\bL\s*[-:=]\s*(\d+\.?\d*)\s*["″]\b/gi,
    /\bL\s*[-:=]\s*(\d+\.?\d*)\s*(?:in(?:ch(?:es)?)?)\b/gi,
    /\bL\s*[-:=]\s*(\d+\.?\d*)\s*mm\b/gi,
    // "AxBxC inches" — dimension in inches, take largest
    /(\d+\.?\d*)\s*[x×*]\s*(\d+\.?\d*)\s*[x×*]\s*(\d+\.?\d*)\s*(?:in(?:ch(?:es)?)?|["″])/gi,
    // "dimensions: X.X x Y.Y x Z.Z cm"
    /(?:size|dimensions?)\s*[-:=]\s*(\d+\.?\d*)\s*[x×*]\s*(\d+\.?\d*)\s*[x×*]\s*(\d+\.?\d*)\s*cm/gi,
    // "X.X x Y.Y cm" (2D)
    /(\d+\.?\d*)\s*[x×*]\s*(\d+\.?\d*)\s*cm\b/gi,
  ];

  let bestLength: number | null = null;

  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(clean)) !== null) {
      let val: number;
      const src = pat.source;

      // Dimension pattern (3 values) — take largest
      if (m[3] !== undefined) {
        val = Math.max(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
      } else if (m[2] !== undefined && src.includes('mm\\s*\\)')) {
        // "X.XX in (Ymm)" — use mm value
        val = parseFloat(m[2]);
      } else if (m[2] !== undefined && !src.includes('mm\\s*\\)')) {
        // 2D "X.X x Y.Y cm" — take largest
        val = Math.max(parseFloat(m[1]), parseFloat(m[2]));
      } else {
        val = parseFloat(m[1]);
      }

      // Convert inches to mm (patterns with "in" or quote marks)
      const isInchPattern = (src.includes('in(?:ch') || src.includes('["″]'));
      if (isInchPattern && m[2] === undefined) {
        val = val * 25.4;
      }
      // Convert inches for dimension-in-inches pattern (3D inches)
      if (m[3] !== undefined && src.includes('in(?:ch(?:es)?)?|["″]')) {
        val = val * 25.4;
      }

      // Convert cm to mm
      if (src.includes('cm') && !src.includes('mm')) {
        val = val * 10;
      }

      // Sanity: flashlight length 15mm to 800mm
      if (val >= 15 && val <= 800) {
        if (bestLength === null || val > bestLength) {
          bestLength = Math.round(val * 10) / 10;
        }
      }
    }
  }

  return bestLength;
}

// ===== WEIGHT EXTRACTION =====
function extractWeight(text: string): number | null {
  const clean = text.replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, '');
  const patterns = [
    /(?:net\s+)?weight\s*[-:=]\s*(?:approx\.?\s*)?(\d+\.?\d*)\s*g(?:rams?)?\b/gi,
    /(?:net\s+)?weight\s*[-:=]\s*(?:approx\.?\s*)?(\d+\.?\d*)\s*(?:oz|ounces?)\b/gi,
    /(\d+\.?\d*)\s*g\s*\(?(?:with(?:out)?|excl|incl|including|excluding)/gi,
    /(\d+\.?\d*)\s*(?:oz|ounces?)\s*\(?(?:with(?:out)?|excl|incl)/gi,
    // "Weight Xg" / "Weight - Xg" (no separator or dash)
    /(?:net\s+)?weight\s+(?:approx\.?\s*)?(\d+\.?\d*)\s*g(?:rams?)?\b/gi,
    // "weighs X grams" / "weighs Xg" / "weighing X oz"
    /weigh(?:s|ing)\s+(?:about\s+|approx\.?\s*)?(\d+\.?\d*)\s*g(?:rams?)?\b/gi,
    /weigh(?:s|ing)\s+(?:about\s+|approx\.?\s*)?(\d+\.?\d*)\s*(?:oz|ounces?)\b/gi,
    // "X.XX oz (Yg)" — oz with grams in parens
    /(\d+\.?\d*)\s*(?:oz|ounces?)\s*\(\s*(\d+\.?\d*)\s*g(?:rams?)?\s*\)/gi,
    // "Xg (Y oz)" — grams with oz in parens
    /(\d+\.?\d*)\s*g(?:rams?)?\s*\(\s*\d+\.?\d*\s*(?:oz|ounces?)\s*\)/gi,
    // "Weight X.X oz" with space
    /(?:net\s+)?weight\s+(?:approx\.?\s*)?(\d+\.?\d*)\s*(?:oz|ounces?)\b/gi,
  ];

  let bestWeight: number | null = null;

  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(clean)) !== null) {
      let val: number;

      // "X.XX oz (Yg)" — use grams value from parens if available
      if (m[2] !== undefined && pat.source.includes('oz|ounce') && pat.source.includes('g(?:ram')) {
        val = parseFloat(m[2]);
      } else {
        val = parseFloat(m[1]);
        // Convert oz to grams
        if (pat.source.includes('oz|ounce')) {
          val = val * 28.3495;
        }
      }

      // Sanity: 5g to 5000g
      if (val >= 5 && val <= 5000) {
        if (bestWeight === null) {
          bestWeight = Math.round(val * 10) / 10;
        }
      }
    }
  }

  return bestWeight;
}

// ===== LUMENS EXTRACTION =====
function extractLumens(text: string): number[] {
  const clean = text.replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, '');
  const lumens: number[] = [];
  const seen = new Set<number>();

  const patterns = [
    // "max output: 2300 lumens" / "maximum output: 1000 lm"
    /(?:max(?:imum)?\s+)?(?:output|brightness)\s*[-:=]\s*(?:up\s+to\s+)?(\d[\d,]*)\s*(?:lumens?|lm)\b/gi,
    // "2300 lumens" / "1000 lm" standalone
    /(\d[\d,]*)\s*(?:lumens?|lm)\b/gi,
    // "turbo: 2300 lumens" / "high: 800 lm"
    /(?:turbo|high|max)\s*[-:=]\s*(\d[\d,]*)\s*(?:lumens?|lm)\b/gi,
  ];

  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(clean)) !== null) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      // Sanity: 0.1 to 200000 lumens, skip LED lifespan-like numbers
      if (val >= 0.1 && val <= 200000 && !seen.has(val)) {
        seen.add(val);
        lumens.push(val);
      }
    }
  }

  // Return top 5, highest first
  return lumens.sort((a, b) => b - a).slice(0, 5);
}

// ===== MATERIAL EXTRACTION =====
function extractMaterial(text: string): string[] {
  const clean = text.replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, '').toLowerCase();
  const materials: string[] = [];
  const seen = new Set<string>();

  // Check for known material keywords in context
  const matPatterns: [RegExp, string][] = [
    [/(?:aircraft[- ]?grade\s+)?(?:anodized\s+)?alumin[iu]m(?:\s+alloy)?/i, 'aluminum'],
    [/(?:type\s+(?:ii|iii|2|3)\s+)?(?:hard[- ]?coat(?:ed)?\s+)?anodiz(?:ed|ing)/i, 'aluminum'],
    [/\btitanium\b/i, 'titanium'],
    [/\bcopper\b/i, 'copper'],
    [/\bbrass\b/i, 'brass'],
    [/\bstainless\s+steel\b/i, 'stainless steel'],
    [/\bpolymer\b/i, 'polymer'],
    [/\bnylon\b/i, 'polymer'],
    [/\bpolycarbonate\b/i, 'polymer'],
    [/\bABS\b/, 'polymer'],
  ];

  for (const [pat, mat] of matPatterns) {
    if (pat.test(clean) && !seen.has(mat)) {
      // Skip if "stainless steel" is only in bezel/clip context
      if (mat === 'stainless steel') {
        const ctx = clean.match(/stainless\s+steel\s+(\w+)/i);
        if (ctx && /^(bezel|clip|ring|crown|strike)/.test(ctx[1])) continue;
      }
      seen.add(mat);
      materials.push(mat);
    }
  }

  return materials.slice(0, 2);
}

// ===== SWITCH EXTRACTION =====
function extractSwitch(text: string): string[] {
  const clean = text.replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, '').toLowerCase();
  const switches: string[] = [];
  const seen = new Set<string>();

  const switchPatterns: [RegExp, string][] = [
    [/\b(?:tail(?:cap)?\s+(?:click|switch|button)|tail\s+switch|rear\s+(?:click|switch))\b/i, 'tail'],
    [/\bside\s+(?:switch|button|click)\b/i, 'side'],
    [/\be-switch\b/i, 'electronic'],
    [/\belectronic\s+switch\b/i, 'electronic'],
    [/\brotary\s+(?:switch|selector|ring)\b/i, 'rotary'],
    [/\btwist(?:y)?\s+(?:switch|head|interface)\b/i, 'twisty'],
    [/\bmagnetic\s+(?:control|ring|selector)\b/i, 'magnetic'],
    [/\bdual[\s-]?switch\b/i, 'dual'],
  ];

  for (const [pat, sw] of switchPatterns) {
    if (pat.test(clean) && !seen.has(sw)) {
      seen.add(sw);
      switches.push(sw);
    }
  }

  return switches.slice(0, 3);
}

// ===== LED EXTRACTION =====
function extractLed(text: string): string[] {
  const clean = text.replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, '');
  const leds: string[] = [];
  const seen = new Set<string>();

  // Common LED identifiers
  const ledPatterns = [
    // Cree LEDs
    /\b((?:CREE\s+)?X[PM]L?[2-9]?(?:\s*[-.]?\s*(?:HI|HD|P2|V[2-6]|R[2-5]))?\b)/gi,
    /\b((?:CREE\s+)?XP-?[GEHL][2-4]?(?:\s*[-.]?\s*(?:HI|HD|R[2-5]|V[2-6]))?\b)/gi,
    /\b((?:CREE\s+)?XHP[0-9]+(?:\.\d)?(?:\s*[-.]?\s*(?:HI|HD))?)\b/gi,
    // Luminus LEDs
    /\b((?:Luminus\s+)?SFT[- ]?[0-9]+)\b/gi,
    /\b((?:Luminus\s+)?SST[- ]?[0-9]+(?:[-.]?\w*)?)\b/gi,
    /\b((?:Luminus\s+)?SBT[- ]?[0-9]+(?:\.\d)?)\b/gi,
    // Samsung LEDs
    /\b((?:Samsung\s+)?LH351[A-D])\b/gi,
    // Nichia LEDs
    /\b((?:Nichia\s+)?(?:219[A-C]|519A|E21A|B35A[MR]?))\b/gi,
    /\b((?:Nichia\s+)?NVSW[0-9]+[A-Z]*)\b/gi,
    // Osram LEDs
    /\b((?:Osram\s+)?(?:W[12]\s*(?:\.1|\.2)?|CSLNM1|CSLPM1|CULNM1|KW\s*CSLNM))\b/gi,
    // Everlight/generic
    /\b(GT[-.]?FC40)\b/gi,
  ];

  for (const pat of ledPatterns) {
    let m;
    while ((m = pat.exec(clean)) !== null) {
      const led = m[1].trim().replace(/\s+/g, ' ');
      const norm = led.toUpperCase();
      if (!seen.has(norm) && led.length > 2) {
        seen.add(norm);
        leds.push(led);
      }
    }
  }

  return leds.slice(0, 2);
}

// ===== MAIN =====
const stats = { runtime: 0, throw_m: 0, length: 0, weight: 0, lumens: 0, material: 0, switch_t: 0, led: 0, total: 0 };

// Get ALL entries missing at least one of these fields
const entries = db.prepare(`
  SELECT f.id, f.brand, f.model,
    f.runtime_hours, f.throw_m, f.length_mm, f.weight_g, f.lumens,
    f.battery, f.material, f.switch, f.led,
    r.text_content
  FROM flashlights f
  JOIN raw_spec_text r ON r.flashlight_id = f.id
  WHERE json_extract(f.type,'$[0]') NOT IN ('accessory','blog','not_flashlight')
  AND (
    (f.runtime_hours IS NULL OR f.runtime_hours = '[]')
    OR (f.throw_m IS NULL OR f.throw_m <= 0)
    OR (f.length_mm IS NULL OR f.length_mm <= 0)
    OR (f.weight_g IS NULL OR f.weight_g <= 0)
    OR (f.lumens IS NULL OR f.lumens = '[]')
    OR (f.material IS NULL OR f.material = '[]')
    OR (f.switch IS NULL OR f.switch = '[]')
    OR (f.led IS NULL OR f.led = '[]')
  )
  AND r.text_content IS NOT NULL AND length(r.text_content) > 20
`).all() as any[];

console.log(`Processing ${entries.length} entries with missing fields...`);

const updateRuntime = db.prepare(`UPDATE flashlights SET runtime_hours = ? WHERE id = ?`);
const updateThrow = db.prepare(`UPDATE flashlights SET throw_m = ? WHERE id = ?`);
const updateLength = db.prepare(`UPDATE flashlights SET length_mm = ? WHERE id = ?`);
const updateWeight = db.prepare(`UPDATE flashlights SET weight_g = ? WHERE id = ?`);
const updateLumens = db.prepare(`UPDATE flashlights SET lumens = ? WHERE id = ?`);
const updateMaterial = db.prepare(`UPDATE flashlights SET material = ? WHERE id = ?`);
const updateSwitch = db.prepare(`UPDATE flashlights SET switch = ? WHERE id = ?`);
const updateLed = db.prepare(`UPDATE flashlights SET led = ? WHERE id = ?`);

const tx = db.transaction(() => {
  for (const entry of entries) {
    const text = entry.text_content as string;

    // Runtime
    if (!entry.runtime_hours || entry.runtime_hours === '[]') {
      const runtimes = extractRuntime(text);
      if (runtimes.length > 0) {
        updateRuntime.run(JSON.stringify(runtimes), entry.id);
        stats.runtime++;
      }
    }

    // Throw
    if (!entry.throw_m || entry.throw_m <= 0) {
      const throwVal = extractThrow(text);
      if (throwVal !== null) {
        updateThrow.run(throwVal, entry.id);
        stats.throw_m++;
      }
    }

    // Length — with battery-based minimum validation
    if (!entry.length_mm || entry.length_mm <= 0) {
      const lengthVal = extractLength(text);
      if (lengthVal !== null) {
        // Validate: length must be > battery length + headroom
        const bat = (entry.battery as string) || '';
        let minLength = 20; // absolute minimum for any light
        if (bat.includes('18650')) minLength = 55;
        else if (bat.includes('21700')) minLength = 55;
        else if (bat.includes('26650')) minLength = 55;
        else if (bat.includes('18350')) minLength = 45;
        else if (bat.includes('16340')) minLength = 40;

        if (lengthVal >= minLength) {
          updateLength.run(lengthVal, entry.id);
          stats.length++;
        }
      }
    }

    // Lumens
    if (!entry.lumens || entry.lumens === '[]') {
      const lumenVals = extractLumens(text);
      if (lumenVals.length > 0) {
        updateLumens.run(JSON.stringify(lumenVals), entry.id);
        stats.lumens++;
      }
    }

    // Material
    if (!entry.material || entry.material === '[]') {
      const mats = extractMaterial(text);
      if (mats.length > 0) {
        updateMaterial.run(JSON.stringify(mats), entry.id);
        stats.material++;
      }
    }

    // Switch
    if (!entry.switch || entry.switch === '[]') {
      const sw = extractSwitch(text);
      if (sw.length > 0) {
        updateSwitch.run(JSON.stringify(sw), entry.id);
        stats.switch_t++;
      }
    }

    // LED
    if (!entry.led || entry.led === '[]') {
      const leds = extractLed(text);
      if (leds.length > 0) {
        updateLed.run(JSON.stringify(leds), entry.id);
        stats.led++;
      }
    }

    // Weight — with battery-based minimum validation
    if (!entry.weight_g || entry.weight_g <= 0) {
      const weightVal = extractWeight(text);
      if (weightVal !== null) {
        // Validate: large battery lights should weigh > 30g
        const bat = (entry.battery as string) || '';
        let minWeight = 5; // absolute minimum
        if (bat.includes('18650') || bat.includes('21700') || bat.includes('26650')) {
          minWeight = 30;
        }
        if (weightVal >= minWeight && weightVal <= 5000) {
          updateWeight.run(weightVal, entry.id);
          stats.weight++;
        }
      }
    }

    stats.total++;
  }
});

tx();

console.log(`\nResults:`);
console.log(`  Runtime: +${stats.runtime}`);
console.log(`  Throw: +${stats.throw_m}`);
console.log(`  Length: +${stats.length}`);
console.log(`  Weight: +${stats.weight}`);
console.log(`  Lumens: +${stats.lumens}`);
console.log(`  Material: +${stats.material}`);
console.log(`  Switch: +${stats.switch_t}`);
console.log(`  LED: +${stats.led}`);
console.log(`  Total entries processed: ${stats.total}`);

db.close();
