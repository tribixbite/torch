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

  // Pattern: "runtime: Xh" / "run time: X hours" / "max runtime X hrs"
  const rtPatterns = [
    /(?:max\s+)?run\s*time\s*[:=]\s*(\d+\.?\d*)\s*(?:h(?:ou)?rs?|h)\b/gi,
    /(?:max\s+)?run\s*time\s*[:=]\s*(\d+)\s*(?:min(?:ute)?s?|m)\b/gi,
    // "XX hours" standalone near runtime context
    /(?:up\s+to\s+|max(?:imum)?\s+|approx\.?\s*)?(\d+\.?\d*)\s*(?:hours?|hrs?)\s+(?:runtime|run\s*time|of\s+runtime)/gi,
    // "runtime XX hours" / "run time XX hrs"
    /(?:run\s*time|runtime)\s+(?:up\s+to\s+|of\s+|approx\.?\s*)?(\d+\.?\d*)\s*(?:hours?|hrs?|h)\b/gi,
    // "Xh runtime" / "X hours run time"
    /(\d+\.?\d*)\s*(?:hours?|hrs?|h)\s+(?:runtime|run\s*time)/gi,
    // "low: Xh" / "high: X hours" / "turbo: X.X hrs" (mode-based)
    /(?:low|med|medium|mid|high|turbo|eco|moonlight|firefly)\s*[:=]\s*\S+\s*\/\s*(\d+\.?\d*)\s*(?:hours?|hrs?|h)\b/gi,
    // Table format: "X hrs" near "Runtime" header
    /Runtime[^]*?(\d+\.?\d*)\s*(?:hours?|hrs?|h)\b/gi,
    // "battery life: X hours"
    /battery\s+life\s*[:=]\s*(?:up\s+to\s+)?(\d+\.?\d*)\s*(?:hours?|hrs?|h)\b/gi,
    // "lasts X hours" / "up to X hours"
    /(?:lasts?|up\s+to)\s+(\d+\.?\d*)\s*(?:hours?|hrs?|h)\b/gi,
    // "Xh (low)" / "X hours on low"
    /(\d+\.?\d*)\s*(?:hours?|hrs?|h)\s+(?:\(?\s*(?:on\s+)?(?:low|eco|moonlight|firefly))/gi,
  ];

  for (const pat of rtPatterns) {
    let m;
    while ((m = pat.exec(text)) !== null) {
      let val = parseFloat(m[1]);
      // Check if matched as minutes
      if (pat.source.includes('min')) {
        val = val / 60;
      }
      // Sanity: runtime should be 0.01h to 5000h
      if (val >= 0.01 && val <= 5000 && !seen.has(val)) {
        // Skip LED lifespan values (50000h etc)
        if (val >= 10000) continue;
        seen.add(val);
        runtimes.push(val);
      }
    }
  }

  return runtimes.sort((a, b) => b - a); // highest first
}

// ===== THROW EXTRACTION =====
function extractThrow(text: string): number | null {
  const patterns = [
    // "beam distance: 210m" / "throw: 300m" / "max beam distance 500m"
    /(?:beam\s+distance|throw(?:\s+distance)?|peak\s+beam\s+distance|max(?:imum)?\s+(?:beam\s+)?distance)\s*[-:=]\s*(?:up\s+to\s+)?(\d+\.?\d*)\s*(?:m(?:eters?)?|ft|yards?)\b/gi,
    // "210m beam distance" / "300m throw"
    /(\d+\.?\d*)\s*(?:m(?:eters?)?)\s+(?:beam\s+distance|throw(?:\s+distance)?|peak\s+beam|max\s+beam)/gi,
    // "distance of 300m" / "range of 200m"
    /(?:distance|range)\s+(?:of\s+)?(\d+\.?\d*)\s*(?:m(?:eters?)?)\b/gi,
    // "XXXm throw" / "XXXm beam"
    /(\d+)\s*m\s+(?:throw|beam)/gi,
    // "beam intensity XXXXX cd" - calculate throw
    /(?:beam\s+)?intensity\s*[-:=]\s*(\d[\d,]*)\s*(?:cd|candela)/gi,
    // "XXX,XXX candela"
    /(\d[\d,]+)\s*(?:cd|candela)/gi,
    // "XXft" / "XXX feet" beam distance
    /(?:beam\s+distance|throw)\s*[-:=]\s*(?:up\s+to\s+)?(\d+\.?\d*)\s*(?:ft|feet|foot)\b/gi,
  ];

  let bestThrow: number | null = null;

  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(text)) !== null) {
      let val = parseFloat(m[1].replace(/,/g, ''));

      // If candela, convert to throw: throw_m = 2 * sqrt(cd)
      if (pat.source.includes('cd|candela') || pat.source.includes('intensity')) {
        if (val > 100) { // Only if > 100 cd (sanity)
          val = 2 * Math.sqrt(val);
        } else {
          continue;
        }
      }

      // If feet, convert to meters
      if (pat.source.includes('ft|feet|foot')) {
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
    // "LxWxH mm" format
    /(\d+\.?\d*)\s*[x×*]\s*(\d+\.?\d*)\s*[x×*]\s*(\d+\.?\d*)\s*mm/gi,
    // "X.XX in (Ymm)" standalone
    /(\d+\.?\d*)\s*(?:in(?:ch(?:es)?)?|")\s*\(?\s*(\d+\.?\d*)\s*mm\s*\)?/gi,
    // "Length Xmm" / "Length X mm" (no separator)
    /(?:overall\s+)?length\s+(\d+\.?\d*)\s*mm/gi,
    // "X.XX in" or "X.XX inches" near length context
    /(?:overall\s+)?length\s*[-:=]\s*(\d+\.?\d*)\s*["″]/gi,
  ];

  let bestLength: number | null = null;

  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(text)) !== null) {
      let val: number;

      // Dimension pattern — take largest
      if (m[3] !== undefined) {
        val = Math.max(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
      } else if (m[2] !== undefined && pat.source.includes('mm\\s*\\)')) {
        // "X.XX in (Ymm)" — use mm value
        val = parseFloat(m[2]);
      } else {
        val = parseFloat(m[1]);
      }

      // Convert inches to mm
      if (pat.source.includes('in(?:ch') && m[2] === undefined) {
        val = val * 25.4;
      }

      // Convert cm to mm
      if (pat.source.includes('cm\\b')) {
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
  const patterns = [
    /(?:net\s+)?weight\s*[-:=]\s*(?:approx\.?\s*)?(\d+\.?\d*)\s*g(?:rams?)?\b/gi,
    /(?:net\s+)?weight\s*[-:=]\s*(?:approx\.?\s*)?(\d+\.?\d*)\s*(?:oz|ounces?)\b/gi,
    /(\d+\.?\d*)\s*g\s*\(?(?:with(?:out)?|excl|incl|including|excluding)/gi,
    /(\d+\.?\d*)\s*(?:oz|ounces?)\s*\(?(?:with(?:out)?|excl|incl)/gi,
    // "Weight Xg" / "Weight - Xg" (no separator or dash)
    /(?:net\s+)?weight\s+(?:approx\.?\s*)?(\d+\.?\d*)\s*g(?:rams?)?\b/gi,
  ];

  let bestWeight: number | null = null;

  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(text)) !== null) {
      let val = parseFloat(m[1]);

      // Convert oz to grams
      if (pat.source.includes('oz|ounce')) {
        val = val * 28.3495;
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

// ===== MAIN =====
const stats = { runtime: 0, throw_m: 0, length: 0, weight: 0, total: 0 };

// Get ALL entries missing at least one of these fields
const entries = db.prepare(`
  SELECT f.id, f.brand, f.model,
    f.runtime_hours, f.throw_m, f.length_mm, f.weight_g,
    f.battery,
    r.text_content
  FROM flashlights f
  JOIN raw_spec_text r ON r.flashlight_id = f.id
  WHERE json_extract(f.type,'$[0]') NOT IN ('accessory','blog','not_flashlight')
  AND (
    (f.runtime_hours IS NULL OR f.runtime_hours = '[]')
    OR (f.throw_m IS NULL OR f.throw_m <= 0)
    OR (f.length_mm IS NULL OR f.length_mm <= 0)
    OR (f.weight_g IS NULL OR f.weight_g <= 0)
  )
  AND r.text_content IS NOT NULL AND length(r.text_content) > 20
`).all() as any[];

console.log(`Processing ${entries.length} entries with missing fields...`);

const updateRuntime = db.prepare(`UPDATE flashlights SET runtime_hours = ? WHERE id = ?`);
const updateThrow = db.prepare(`UPDATE flashlights SET throw_m = ? WHERE id = ?`);
const updateLength = db.prepare(`UPDATE flashlights SET length_mm = ? WHERE id = ?`);
const updateWeight = db.prepare(`UPDATE flashlights SET weight_g = ? WHERE id = ?`);

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
console.log(`  Total entries processed: ${stats.total}`);

db.close();
