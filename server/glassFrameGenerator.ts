import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import {
  DEFAULT_VISUAL_SETTINGS,
  formatTimeMMSS,
  type PhonkTrack,
  type VisualSettings,
  type VisualizerStyle,
} from '../src/lib/phonkLogic.ts';

export interface GlassRenderBundle {
  dir: string;
  stagePath: string;
  specOverlayPath: string;
  barFillPath: string;
  dockLeftMaskPath: string;
  knobPath: string;
  layout: {
    w: number;
    h: number;
    specX: number;
    specY: number;
    specW: number;
    specH: number;
    progX: number;
    progY: number;
    progW: number;
    progH: number;
    timeX: number;
    timeY: number;
    timeFontSize: number;
    knobSize: number;
    knobY: number;
    visualizerStyle: VisualizerStyle;
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function splitTitleLines(rawTitle: string, maxChars = 24): string[] {
  const clean = rawTitle.replace(/\s+/g, ' ').trim() || 'Untitled Phonk';
  if (clean.length <= maxChars) return [clean];

  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) {
        lines.push(current);
        current = word;
      } else {
        lines.push(`${word.slice(0, maxChars - 1)}…`);
        current = '';
      }
      if (lines.length === 2) break;
    }
  }

  if (lines.length < 2 && current) {
    lines.push(current);
  }
  if (lines.length === 2 && words.join(' ').length > lines.join(' ').length) {
    const second = lines[1];
    if (!second.endsWith('…')) {
      lines[1] =
        second.length > maxChars - 1
          ? `${second.slice(0, maxChars - 1)}…`
          : `${second}…`;
    }
  }

  return lines.slice(0, 2);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean.padEnd(6, '0');
  const num = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(num)) return { r: 212, g: 38, b: 56 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function buildSpectrumCutoutSvg(
  specW: number,
  specH: number,
  s: number,
  style: VisualizerStyle
): Buffer {
  const bars = 40;
  const padX = Math.round(10 * s);
  const padY = Math.round(8 * s);
  const innerW = specW - padX * 2;
  const innerH = specH - padY * 2;

  let shapes = '';
  if (style === 'ring') {
    // Symmetrical center-weighted equalizer capsules
    const gap = Math.max(3, Math.round(4 * s));
    const barW = Math.max(4, Math.floor((innerW - gap * (bars - 1)) / bars));
    const totalW = bars * barW + (bars - 1) * gap;
    const startX = Math.round((specW - totalW) / 2);
    for (let i = 0; i < bars; i++) {
      const dist = Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2);
      const h = Math.round(innerH * (0.48 + 0.52 * (1 - dist * 0.8)));
      const y = Math.round((specH - h) / 2);
      const x = startX + i * (barW + gap);
      const rx = Math.max(2, Math.floor(barW / 2));
      shapes += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="${rx}" fill="#ffffff"/>`;
    }
  } else {
    const gap = Math.max(3, Math.round(4 * s));
    const barW = Math.max(4, Math.floor((innerW - gap * (bars - 1)) / bars));
    const totalW = bars * barW + (bars - 1) * gap;
    const startX = Math.round((specW - totalW) / 2);
    const rx = Math.max(2, Math.floor(barW / 2));
    for (let i = 0; i < bars; i++) {
      const x = startX + i * (barW + gap);
      shapes += `<rect x="${x}" y="${padY}" width="${barW}" height="${innerH}" rx="${rx}" fill="#ffffff"/>`;
    }
  }

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${specW}" height="${specH}">${shapes}</svg>`
  );
}

export async function generateGlassRenderBundle(opts: {
  track: PhonkTrack;
  nextTrack: PhonkTrack | null;
  trackIndex: number;
  totalTracks: number;
  coverPath: string;
  resolution: '1280x720' | '1920x1080';
  visuals?: VisualSettings;
  dryRun: boolean;
}): Promise<GlassRenderBundle> {
  const visuals: VisualSettings = {
    ...DEFAULT_VISUAL_SETTINGS,
    ...(opts.visuals || {}),
  };
  const safeGlassBlur = Number.isFinite(visuals.glassBlurPx) ? visuals.glassBlurPx : 26;
  const safeGlassOpacity = Number.isFinite(visuals.glassOpacity) ? visuals.glassOpacity : 0.56;
  const [w, h] = opts.resolution === '1920x1080' ? [1920, 1080] : [1280, 720];
  const s = w / 1280;

  const dir = path.join(os.tmpdir(), 'phonkcast-frames', crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });

  const stagePath = path.join(dir, 'stage.png');
  const specOverlayPath = path.join(dir, 'spec-overlay.png');
  const barFillPath = path.join(dir, 'bar-fill.png');
  const dockLeftMaskPath = path.join(dir, 'dock-left-mask.png');
  const knobPath = path.join(dir, 'knob.png');

  const pal = opts.track.palette;
  const primaryRgb = hexToRgb(pal.primary);
  const secondaryRgb = hexToRgb(pal.secondary);
  const accentRgb = hexToRgb(pal.accent);

  // Geometry matching LiveGlassScreen.tsx cleanly in 16:9
  const cardW = Math.round(860 * s);
  const cardH = Math.round(318 * s);
  const cardX = Math.round((w - cardW) / 2);
  const cardY = Math.round(138 * s);
  const cardRx = Math.round(22 * s);

  const artSize = Math.round(238 * s);
  const artX = Math.round(cardX + 36 * s);
  const artY = Math.round(cardY + (cardH - artSize) / 2);
  const artRx = Math.round(16 * s);

  const textX = Math.round(artX + artSize + 36 * s);
  const rightPad = Math.round(36 * s);
  const specW = Math.round(cardX + cardW - rightPad - textX);
  const specH = Math.round(82 * s);
  const specX = textX;
  const specY = Math.round(artY + artSize - specH);
  const specRx = Math.round(12 * s);

  const dockW = Math.round(940 * s);
  const dockH = Math.round(92 * s);
  const dockX = Math.round((w - dockW) / 2);
  const dockY = Math.round(h - 124 * s);
  const dockRx = Math.round(16 * s);

  const progX = Math.round(dockX + 94 * s);
  const progW = Math.round(dockW - 188 * s);
  const progH = Math.max(6, Math.round(6 * s));
  const progY = Math.round(dockY + 24 * s);
  const progRx = Math.round(progH / 2);

  const timeX = Math.round(dockX + 24 * s);
  const timeFontSize = Math.round(16 * s);
  const timeY = Math.round(progY - 2 * s);
  const knobSize = Math.round(14 * s);
  const knobY = Math.round(progY + progH / 2 - knobSize / 2);

  // 1. Layer 1: Blurred ambient cover backdrop
  const blurSigma = Math.max(8, Math.round((safeGlassBlur + 10) * 0.45 * s));
  const smallBackdrop = await sharp(opts.coverPath)
    .resize(Math.round(420 * s), Math.round(236 * s), { fit: 'cover' })
    .blur(blurSigma)
    .modulate({ brightness: 0.46, saturation: 1.45 })
    .toBuffer();

  const backdropBuffer = await sharp(smallBackdrop)
    .resize(w, h, { fit: 'cover' })
    .toBuffer();

  // Layer 2 SVG wash (radial cover glows + dark gradient vignette matching LiveGlassScreen)
  const washSvg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs>
        <radialGradient id="glow1" cx="28%" cy="35%" r="56%">
          <stop offset="0%" stop-color="${pal.primary}" stop-opacity="0.44" />
          <stop offset="100%" stop-color="${pal.primary}" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="glow2" cx="78%" cy="70%" r="58%">
          <stop offset="0%" stop-color="${pal.primary}" stop-opacity="0.22" />
          <stop offset="100%" stop-color="${pal.primary}" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="vig" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#08090d" stop-opacity="0.30" />
          <stop offset="100%" stop-color="#08090d" stop-opacity="0.78" />
        </linearGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#glow1)" />
      <rect width="${w}" height="${h}" fill="url(#glow2)" />
      <rect width="${w}" height="${h}" fill="url(#vig)" />
    </svg>
  `);

  const stageBase = await sharp(backdropBuffer)
    .composite([{ input: washSvg, top: 0, left: 0 }])
    .png()
    .toBuffer();

  // 2. Frosted Glass Card Backdrop Crop (true CSS backdrop-filter: blur + saturate look)
  const cardCropRaw = await sharp(stageBase)
    .extract({ left: cardX, top: cardY, width: cardW, height: cardH })
    .blur(Math.max(4, Math.round(8 * s)))
    .modulate({ brightness: 1.12, saturation: 1.35 })
    .ensureAlpha()
    .toBuffer();

  const cardRoundMask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${cardH}">
      <rect x="0" y="0" width="${cardW}" height="${cardH}" rx="${cardRx}" ry="${cardRx}" fill="#ffffff" />
    </svg>`
  );

  const cardFrostedRounded = await sharp(cardCropRaw)
    .composite([{ input: cardRoundMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 3. Rounded Cover Artwork
  const artRaw = await sharp(opts.coverPath)
    .resize(artSize, artSize, { fit: 'cover' })
    .ensureAlpha()
    .toBuffer();

  const artRoundMask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${artSize}" height="${artSize}">
      <rect x="0" y="0" width="${artSize}" height="${artSize}" rx="${artRx}" ry="${artRx}" fill="#ffffff" />
    </svg>`
  );

  const artRounded = await sharp(artRaw)
    .composite([{ input: artRoundMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 4. Full Glassmorphic UI SVG Layer (Top bar + Glass Card Tint/Sheen/Border + Typography + Bottom Dock)
  const titleLines = splitTitleLines(opts.track.title, 22);
  const titleFontSize = titleLines.length > 1 ? Math.round(30 * s) : Math.round(36 * s);
  const titleLineHeight = Math.round(36 * s);
  const subgenreText = escapeXml(`${opts.track.subgenre.toUpperCase()}  ·  24/7 LOOP`);
  const artistText = escapeXml(opts.track.artist.slice(0, 38));
  const totalTimeText = escapeXml(formatTimeMMSS(opts.track.durationSec));
  const badgeText = opts.dryRun ? 'TEST LIVE' : 'YOUTUBE LIVE';
  const trackCounterText = escapeXml(
    `Track ${opts.trackIndex + 1} of ${Math.max(1, opts.totalTracks)}  ·  ${opts.track.bpm} BPM`
  );
  const upNextClean = opts.nextTrack
    ? opts.nextTrack.title.replace(/\s+/g, ' ').trim().slice(0, 34)
    : '';
  const upNextText =
    visuals.showUpNext && opts.nextTrack
      ? `Up Next: ${escapeXml(upNextClean)}${opts.nextTrack.title.length > 34 ? '…' : ''}`
      : '';

  const glassAlpha = Math.min(0.75, Math.max(0.28, safeGlassOpacity));
  const tintFill = `rgba(${secondaryRgb.r}, ${secondaryRgb.g}, ${secondaryRgb.b}, ${glassAlpha.toFixed(2)})`;
  const borderColor = `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.42)`;

  const titleSvg = titleLines
    .map((line, i) => {
      const y = Math.round(artY + 66 * s + i * titleLineHeight);
      return `<text x="${textX}" y="${y}" font-family="Noto Sans, DejaVu Sans, sans-serif" font-weight="700" font-size="${titleFontSize}" fill="#ffffff">${escapeXml(line)}</text>`;
    })
    .join('\n');

  const artistY = Math.round(
    artY + 66 * s + (titleLines.length - 1) * titleLineHeight + 32 * s
  );

  const badgeHtml = visuals.showLiveBadge
    ? `
      <rect x="${Math.round(36 * s)}" y="${Math.round(24 * s)}" width="${Math.round(148 * s)}" height="${Math.round(32 * s)}" rx="${Math.round(8 * s)}" fill="rgba(0,0,0,0.42)" stroke="rgba(255,255,255,0.18)" stroke-width="1.2" />
      <circle cx="${Math.round(54 * s)}" cy="${Math.round(40 * s)}" r="${Math.round(4.5 * s)}" fill="#ef4444" />
      <text x="${Math.round(67 * s)}" y="${Math.round(45 * s)}" font-family="JetBrains Mono, DejaVu Sans Mono, monospace" font-weight="700" font-size="${Math.round(12.5 * s)}" fill="#f4f4f5" letter-spacing="0.8">${badgeText}</text>
      <text x="${Math.round(202 * s)}" y="${Math.round(45 * s)}" font-family="JetBrains Mono, DejaVu Sans Mono, monospace" font-weight="500" font-size="${Math.round(13 * s)}" fill="rgba(228,228,231,0.85)">${trackCounterText}</text>
    `
    : `
      <text x="${Math.round(36 * s)}" y="${Math.round(45 * s)}" font-family="JetBrains Mono, DejaVu Sans Mono, monospace" font-weight="500" font-size="${Math.round(13 * s)}" fill="rgba(228,228,231,0.85)">${trackCounterText}</text>
    `;

  const uiSvg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs>
        <linearGradient id="sheen" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.14" />
          <stop offset="45%" stop-color="#ffffff" stop-opacity="0.02" />
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0.06" />
        </linearGradient>
      </defs>

      <!-- Top Bar -->
      ${badgeHtml}

      <!-- Center Glass Card Tint + Specular Sheen + Border -->
      <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="${cardRx}" fill="${tintFill}" />
      <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="${cardRx}" fill="url(#sheen)" stroke="${borderColor}" stroke-width="${Math.max(1.5, 1.5 * s)}" />
      <line x1="${cardX + cardRx}" y1="${cardY + 1.5}" x2="${cardX + cardW - cardRx}" y2="${cardY + 1.5}" stroke="rgba(255,255,255,0.25)" stroke-width="1" />

      <!-- Spectrum Tray -->
      <rect x="${specX}" y="${specY}" width="${specW}" height="${specH}" rx="${specRx}" fill="rgba(0,0,0,0.34)" stroke="rgba(255,255,255,0.08)" stroke-width="1" />

      <!-- Typography Inside Card -->
      <text x="${textX}" y="${Math.round(artY + 24 * s)}" font-family="Noto Sans, DejaVu Sans, sans-serif" font-weight="700" font-size="${Math.round(13 * s)}" fill="${pal.accent}" letter-spacing="1.2">${subgenreText}</text>
      ${titleSvg}
      <text x="${textX}" y="${artistY}" font-family="Noto Sans, DejaVu Sans, sans-serif" font-weight="500" font-size="${Math.round(17 * s)}" fill="rgba(244,244,245,0.82)">${artistText}</text>

      <!-- Bottom Glassmorphic Progress Dock -->
      <rect x="${dockX}" y="${dockY}" width="${dockW}" height="${dockH}" rx="${dockRx}" fill="rgba(0,0,0,0.52)" stroke="${borderColor}" stroke-width="1.3" />
      <rect x="${progX}" y="${progY}" width="${progW}" height="${progH}" rx="${progRx}" fill="rgba(255,255,255,0.16)" />
      <text x="${Math.round(dockX + dockW - 24 * s)}" y="${Math.round(progY + 8 * s)}" text-anchor="end" font-family="JetBrains Mono, DejaVu Sans Mono, monospace" font-weight="600" font-size="${Math.round(15 * s)}" fill="rgba(212,212,216,0.92)">${totalTimeText}</text>

      <!-- Bottom Dock Accent Pill + Up Next -->
      <rect x="${Math.round(dockX + 24 * s)}" y="${Math.round(dockY + 48 * s)}" width="${Math.round(102 * s)}" height="${Math.round(28 * s)}" rx="${Math.round(8 * s)}" fill="${pal.accent}" />
      <circle cx="${Math.round(dockX + 41 * s)}" cy="${Math.round(dockY + 62 * s)}" r="${Math.round(4 * s)}" fill="${pal.textOnAccent}" />
      <text x="${Math.round(dockX + 52 * s)}" y="${Math.round(dockY + 67 * s)}" font-family="Noto Sans, DejaVu Sans, sans-serif" font-weight="700" font-size="${Math.round(12.5 * s)}" fill="${pal.textOnAccent}">ON AIR</text>
      ${
        upNextText
          ? `<text x="${Math.round(dockX + dockW - 24 * s)}" y="${Math.round(dockY + 67 * s)}" text-anchor="end" font-family="Noto Sans, DejaVu Sans, sans-serif" font-weight="500" font-size="${Math.round(13.5 * s)}" fill="rgba(228,228,231,0.88)">${upNextText}</text>`
          : ''
      }
    </svg>
  `);

  // Cover art crisp rounded border frame
  const artBorderSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${artSize}" height="${artSize}">
      <rect x="0.75" y="0.75" width="${artSize - 1.5}" height="${artSize - 1.5}" rx="${artRx}" ry="${artRx}" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="1.5" />
    </svg>`
  );

  await sharp(stageBase)
    .composite([
      { input: cardFrostedRounded, left: cardX, top: cardY },
      { input: uiSvg, left: 0, top: 0 },
      { input: artRounded, left: artX, top: artY },
      { input: artBorderSvg, left: artX, top: artY },
    ])
    .png()
    .toFile(stagePath);

  // 5. Spec-Overlay Mask: Exact copy of stage.png's spectrum tray with 40 rounded bar holes punched out!
  const specTrayRaw = await sharp(stagePath)
    .extract({ left: specX, top: specY, width: specW, height: specH })
    .ensureAlpha()
    .toBuffer();

  const cutoutSvg = buildSpectrumCutoutSvg(specW, specH, s, visuals.visualizerStyle);
  await sharp(specTrayRaw)
    .composite([{ input: cutoutSvg, blend: 'dest-out' }])
    .png()
    .toFile(specOverlayPath);

  // 6. Sliding Progress Accent Bar Fill
  const barFillSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${progW}" height="${progH}">
      <rect x="0" y="0" width="${progW}" height="${progH}" rx="${progRx}" ry="${progRx}" fill="${pal.accent}" />
    </svg>`
  );
  await sharp(barFillSvg).png().toFile(barFillPath);

  // 7. Left Dock Mask covering 0..progX over progY band so sliding bar is cleanly masked on the left
  const maskH = progH + Math.round(16 * s);
  const maskTop = Math.max(0, progY - Math.round(8 * s));
  await sharp(stagePath)
    .extract({ left: 0, top: maskTop, width: progX, height: maskH })
    .png()
    .toFile(dockLeftMaskPath);

  // 8. Scrubber White Knob Dot
  const r = Math.round(5.5 * s);
  const c = knobSize / 2;
  const knobSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${knobSize}" height="${knobSize}">
      <circle cx="${c}" cy="${c}" r="${c}" fill="${pal.accent}" fill-opacity="0.45" />
      <circle cx="${c}" cy="${c}" r="${r}" fill="#ffffff" />
    </svg>`
  );
  await sharp(knobSvg).png().toFile(knobPath);

  return {
    dir,
    stagePath,
    specOverlayPath,
    barFillPath,
    dockLeftMaskPath,
    knobPath,
    layout: {
      w,
      h,
      specX,
      specY,
      specW,
      specH,
      progX,
      progY,
      progW,
      progH,
      timeX,
      timeY,
      timeFontSize,
      knobSize,
      knobY,
      visualizerStyle: visuals.visualizerStyle,
    },
  };
}

export function cleanupGlassRenderBundle(dir: string | null | undefined): void {
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup error
  }
}
