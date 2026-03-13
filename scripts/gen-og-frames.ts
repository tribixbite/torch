/**
 * Generate SVG frames for an animated OG preview.
 * Flashlight beam sweeps right, revealing title + stats.
 * Run: bun scripts/gen-og-frames.ts
 */
const W = 800, H = 420;
const TOTAL_FRAMES = 36;
const OUT = 'output/frames';

function lerp(a: number, b: number, t: number) { return a + (b - a) * Math.min(1, Math.max(0, t)); }
function ease(t: number) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; } // easeInOut
function easeOut(t: number) { return 1 - (1 - t) * (1 - t); }

function frame(i: number): string {
  const t = i / (TOTAL_FRAMES - 1); // 0..1 overall progress

  // Phase timing
  const beamPhase = Math.min(1, t / 0.5);      // 0..1 over first 50% of animation
  const textPhase = Math.max(0, (t - 0.2) / 0.4); // text reveals 20%-60%
  const statsPhase = Math.max(0, (t - 0.45) / 0.3); // stats 45%-75%
  const glowPhase = Math.max(0, (t - 0.7) / 0.3);  // final glow 70%-100%

  // Beam sweep position (tip of beam cone)
  const beamTipX = lerp(-100, 950, ease(beamPhase));
  const beamWidth = 350;
  // Beam fades slowly after sweep, but never fully disappears (subtle ambient)
  const beamOpacity = beamPhase < 1 ? 0.7 : lerp(0.7, 0.05, easeOut(glowPhase));

  // Text reveal via clip-path (must reach full width to show centered text)
  const titleRevealX = lerp(0, W, ease(Math.min(1, textPhase)));
  const statsRevealX = lerp(0, W, ease(Math.min(1, statsPhase)));

  // Glow ring around logo at the end
  const ringOpacity = ease(glowPhase) * 0.6;
  const ringRadius = lerp(0, 60, ease(glowPhase));

  // Particle sparkles in beam path
  const particles = Array.from({ length: 8 }, (_, pi) => {
    const px = beamTipX - 40 - pi * 35 + Math.sin(pi * 2.7 + i * 0.5) * 15;
    const py = H / 2 + Math.cos(pi * 3.1 + i * 0.8) * (40 + pi * 12);
    const po = Math.max(0, 1 - pi * 0.12) * (beamPhase > 0.1 ? 1 : 0) * (beamPhase < 0.95 ? 1 : lerp(1, 0, (beamPhase - 0.95) / 0.05));
    const pr = 1.5 + Math.sin(pi + i * 0.3) * 0.8;
    return `<circle cx="${px}" cy="${py}" r="${pr}" fill="#fbbf24" opacity="${(po * 0.7).toFixed(2)}"/>`;
  }).join('\n    ');

  // Scanline effect
  const scanlines = Array.from({ length: 6 }, (_, si) => {
    const sy = 60 + si * 60;
    const sOp = 0.03 + Math.sin(si + i * 0.4) * 0.015;
    return `<line x1="0" y1="${sy}" x2="800" y2="${sy}" stroke="#f97316" stroke-width="0.5" opacity="${sOp.toFixed(3)}"/>`;
  }).join('\n    ');

  // Counter animation (rolls up from 0 to 3177)
  const counterVal = Math.floor(lerp(0, 3177, ease(Math.min(1, statsPhase * 1.5))));
  const counterStr = counterVal.toLocaleString();

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#050508"/>
      <stop offset="100%" style="stop-color:#0a0a1a"/>
    </linearGradient>
    <linearGradient id="beam" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#f97316;stop-opacity:0"/>
      <stop offset="30%" style="stop-color:#f97316;stop-opacity:0.8"/>
      <stop offset="70%" style="stop-color:#fbbf24;stop-opacity:0.5"/>
      <stop offset="100%" style="stop-color:#fbbf24;stop-opacity:0"/>
    </linearGradient>
    <radialGradient id="glow">
      <stop offset="0%" style="stop-color:#f97316;stop-opacity:0.4"/>
      <stop offset="100%" style="stop-color:#f97316;stop-opacity:0"/>
    </radialGradient>
    <clipPath id="titleClip"><rect x="0" y="0" width="${titleRevealX}" height="${H}"/></clipPath>
    <clipPath id="statsClip"><rect x="0" y="0" width="${statsRevealX}" height="${H}"/></clipPath>
    <filter id="blur"><feGaussianBlur stdDeviation="2"/></filter>
    <filter id="bigblur"><feGaussianBlur stdDeviation="8"/></filter>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- Subtle grid -->
  <g opacity="0.04" stroke="#f97316" stroke-width="0.5">
    ${Array.from({ length: 21 }, (_, gi) => `<line x1="${gi * 40}" y1="0" x2="${gi * 40}" y2="${H}"/>`).join('')}
    ${Array.from({ length: 11 }, (_, gi) => `<line x1="0" y1="${gi * 40}" x2="${W}" y2="${gi * 40}"/>`).join('')}
  </g>

  <!-- Scanlines -->
  ${scanlines}

  <!-- Beam cone -->
  <g opacity="${beamOpacity.toFixed(2)}">
    <polygon points="${beamTipX - beamWidth},${H / 2 - 120} ${beamTipX},${H / 2 - 8} ${beamTipX - beamWidth},${H / 2 + 120}" fill="url(#beam)" filter="url(#blur)"/>
    <!-- Beam core (brighter center line) -->
    <line x1="${beamTipX - beamWidth}" y1="${H / 2}" x2="${beamTipX}" y2="${H / 2}" stroke="#fbbf24" stroke-width="2" opacity="0.4"/>
  </g>

  <!-- Beam tip glow -->
  <circle cx="${beamTipX}" cy="${H / 2}" r="30" fill="url(#glow)" opacity="${(beamOpacity * 0.8).toFixed(2)}" filter="url(#bigblur)"/>

  <!-- Particles -->
  <g>
    ${particles}
  </g>

  <!-- Ambient title glow (builds during glowPhase) -->
  <circle cx="${W / 2}" cy="160" r="120" fill="#f97316" opacity="${(ease(glowPhase) * 0.06).toFixed(3)}" filter="url(#bigblur)"/>

  <!-- TORCH title (revealed by beam) -->
  <g clip-path="url(#titleClip)">
    <!-- Shadow -->
    <text x="${W / 2}" y="170" text-anchor="middle" font-family="system-ui, -apple-system, Helvetica, sans-serif" font-size="80" font-weight="900" fill="#000" letter-spacing="14" opacity="0.6" filter="url(#blur)">TORCH</text>
    <!-- Main text -->
    <text x="${W / 2}" y="170" text-anchor="middle" font-family="system-ui, -apple-system, Helvetica, sans-serif" font-size="80" font-weight="900" fill="#f97316" letter-spacing="14">TORCH</text>
    <!-- Highlight shimmer -->
    <text x="${W / 2}" y="170" text-anchor="middle" font-family="system-ui, -apple-system, Helvetica, sans-serif" font-size="80" font-weight="900" fill="#fbbf24" letter-spacing="14" opacity="${(0.3 + ease(glowPhase) * 0.15).toFixed(2)}" filter="url(#blur)">TORCH</text>
  </g>

  <!-- Tagline -->
  <g clip-path="url(#titleClip)">
    <text x="${W / 2}" y="208" text-anchor="middle" font-family="system-ui, -apple-system, Helvetica, sans-serif" font-size="14" fill="#737373" letter-spacing="6" font-weight="300">FLASHLIGHT SEARCH ENGINE</text>
  </g>

  <!-- Stats bar -->
  <g clip-path="url(#statsClip)">
    <text x="${W / 2}" y="270" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, monospace" font-size="28" fill="#e5e5e5" font-weight="700">${counterStr} flashlights</text>
    <text x="${W / 2}" y="305" text-anchor="middle" font-family="system-ui, -apple-system, Helvetica, sans-serif" font-size="14" fill="#6b6b6b" letter-spacing="1">28 filters &#x2022; real-time search &#x2022; zero latency</text>
  </g>

  <!-- Domain -->
  <g opacity="${ease(glowPhase).toFixed(2)}">
    <text x="${W / 2}" y="365" text-anchor="middle" font-family="ui-monospace, monospace" font-size="14" fill="#f97316" letter-spacing="2" opacity="0.8">torch.directory</text>
  </g>

  <!-- Final glow ring around title -->
  <circle cx="${W / 2}" cy="150" r="${ringRadius}" fill="none" stroke="#f97316" stroke-width="1.5" opacity="${ringOpacity.toFixed(2)}"/>

  <!-- Bottom accent line (mirrors top) -->
  <rect x="0" y="${H - 2}" width="${W}" height="2" fill="#f97316" opacity="${lerp(0, 0.4, ease(glowPhase)).toFixed(2)}"/>

  <!-- Top accent bar -->
  <rect x="0" y="0" width="${W}" height="2" fill="#f97316" opacity="${lerp(0.2, 0.8, ease(beamPhase)).toFixed(2)}"/>
</svg>`;
}

// Generate all frames
import { mkdirSync, writeFileSync } from 'fs';
mkdirSync(OUT, { recursive: true });

for (let i = 0; i < TOTAL_FRAMES; i++) {
  const svg = frame(i);
  const pad = String(i).padStart(2, '0');
  writeFileSync(`${OUT}/f${pad}.svg`, svg);
}
console.log(`Generated ${TOTAL_FRAMES} SVG frames in ${OUT}/`);
