export interface TrackPalette {
  primary: string;
  secondary: string;
  accent: string;
  glowRgba: string;
  glassBgRgba: string;
  glassBorderRgba: string;
  textOnAccent: string;
}

export interface PhonkTrack {
  id: string;
  title: string;
  artist: string;
  subgenre: string;
  audioUrl: string;
  coverUrl: string;
  durationSec: number;
  bpm: number;
  palette: TrackPalette;
  isDemo?: boolean;
  createdAt: number;
}

export type StreamMode = 'autonomous-24-7' | 'canvas-relay';
export type VisualizerStyle = 'bars' | 'mirror' | 'ring';
export type StreamState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error';

export interface StreamConfig {
  rtmpUrl: string;
  resolution: '1280x720' | '1920x1080';
  fps: 30 | 60;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  autoReconnect: boolean;
  mode: StreamMode;
  dryRun: boolean;
  visuals?: VisualSettings;
}

export interface StreamStatus {
  state: StreamState;
  mode: StreamMode;
  dryRun: boolean;
  hasStreamKey: boolean;
  maskedStreamKey: string;
  rtmpUrl: string;
  startedAt: number | null;
  uptimeSec: number;
  currentTrackId: string | null;
  currentTrackTitle: string;
  loopCount: number;
  reconnectAttempts: number;
  fps: number;
  bitrateKbps: number;
  resolution: '1280x720' | '1920x1080';
  lastError: string | null;
}

export interface AudioFxSettings {
  bassBoostDb: number; // 0 to 12
  slowedReverb: boolean;
  reverbMix: number; // 0 to 0.65
  crossfadeSec: number; // 0 to 6
  normalize: boolean;
  volume: number; // 0 to 1
}

export interface VisualSettings {
  glassBlurPx: number; // 12 to 44
  glassOpacity: number; // 0.25 to 0.75
  bassPulse: boolean;
  visualizerStyle: VisualizerStyle;
  showLiveBadge: boolean;
  showUpNext: boolean;
  ambientDrift: boolean;
}

export const DEFAULT_VISUAL_SETTINGS: VisualSettings = {
  glassBlurPx: 26,
  glassOpacity: 0.56,
  bassPulse: true,
  visualizerStyle: 'bars',
  showLiveBadge: true,
  showUpNext: true,
  ambientDrift: true,
};

export function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.min(max, Math.max(min, val));
}

export function formatTimeMMSS(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '00:00';
  }
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export function formatUptimeHHMMSS(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '00:00:00';
  }
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function computeProgressPercent(elapsedSec: number, durationSec: number): number {
  if (!Number.isFinite(elapsedSec) || !Number.isFinite(durationSec) || durationSec <= 0) {
    return 0;
  }
  return clamp((elapsedSec / durationSec) * 100, 0, 100);
}

export function getNextLoopIndex(
  currentIndex: number,
  total: number,
  shuffle: boolean,
  rng: () => number = Math.random
): number {
  if (total <= 0) return -1;
  if (total === 1) return 0;
  if (!shuffle) {
    const safeCurrent = currentIndex < 0 ? -1 : currentIndex % total;
    return (safeCurrent + 1) % total;
  }
  const candidate = Math.floor(clamp(rng(), 0, 0.999999) * total);
  if (candidate === currentIndex) {
    return (candidate + 1) % total;
  }
  return candidate;
}

export function getPreviousLoopIndex(currentIndex: number, total: number): number {
  if (total <= 0) return -1;
  if (total === 1) return 0;
  const safeCurrent = currentIndex < 0 ? 0 : currentIndex % total;
  return (safeCurrent - 1 + total) % total;
}

export function reorderTracks<T>(tracks: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= tracks.length ||
    toIndex >= tracks.length ||
    fromIndex === toIndex
  ) {
    return [...tracks];
  }
  const copy = [...tracks];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  return copy;
}

function toHexByte(n: number): string {
  return Math.round(clamp(n, 0, 255))
    .toString(16)
    .padStart(2, '0');
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = clamp(r, 0, 255) / 255;
  const gn = clamp(g, 0, 255) / 255;
  const bn = clamp(b, 0, 255) / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function relativeLuminance(r: number, g: number, b: number): number {
  const srgb = [r, g, b].map((c) => {
    const v = clamp(c, 0, 255) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

export function buildPaletteFromRGB(r: number, g: number, b: number): TrackPalette {
  const [h, s, l] = rgbToHsl(r, g, b);
  // Ensure vivid primary & luminous accent while preserving the cover's authentic hue
  const satPrimary = clamp(s < 0.25 ? s + 0.25 : s, 0.32, 0.88);
  const lumPrimary = clamp(l, 0.36, 0.56);
  const [pr, pg, pb] = hslToRgb(h, satPrimary, lumPrimary);

  const satAccent = clamp(satPrimary + 0.12, 0.45, 0.95);
  const lumAccent = clamp(lumPrimary + 0.14, 0.52, 0.72);
  const [ar, ag, ab] = hslToRgb(h, satAccent, lumAccent);

  const [sr, sg, sb] = hslToRgb(h, clamp(satPrimary * 0.65, 0.15, 0.6), 0.11);
  const [gr, gg, gb] = hslToRgb(h, clamp(satPrimary * 0.5, 0.1, 0.5), 0.08);

  const lum = relativeLuminance(ar, ag, ab);
  const textOnAccent = lum > 0.42 ? '#090a0f' : '#ffffff';

  return {
    primary: rgbToHex(pr, pg, pb),
    secondary: rgbToHex(sr, sg, sb),
    accent: rgbToHex(ar, ag, ab),
    glowRgba: `rgba(${pr}, ${pg}, ${pb}, 0.44)`,
    glassBgRgba: `rgba(${gr}, ${gg}, ${gb}, 0.54)`,
    glassBorderRgba: `rgba(${ar}, ${ag}, ${ab}, 0.34)`,
    textOnAccent,
  };
}

export function maskStreamKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 4) return '••••';
  const tail = trimmed.slice(-4);
  return `••••-••••-${tail}`;
}

const PRIVATE_HOST_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?|0\.0\.0\.0)$/i;

export const DEFAULT_YOUTUBE_RTMPS_URL = 'rtmps://a.rtmps.youtube.com:443/live2';

export function validateRtmpTarget(
  rtmpUrl: string,
  streamKey: string,
  dryRun: boolean
): { valid: boolean; error?: string; sanitizedHost?: string } {
  const trimmedKey = streamKey.trim();
  if (!dryRun && !trimmedKey) {
    return { valid: false, error: 'YouTube Stream Key is required to broadcast live.' };
  }
  if (trimmedKey && !/^[a-zA-Z0-9._-]{4,128}$/.test(trimmedKey)) {
    return {
      valid: false,
      error: 'Stream Key contains invalid characters. Paste only the Stream Key (not the full URL).',
    };
  }

  const trimmedUrl = rtmpUrl.trim() || DEFAULT_YOUTUBE_RTMPS_URL;
  let parsed: URL;
  try {
    parsed = new URL(trimmedUrl);
  } catch {
    return { valid: false, error: 'RTMP Server URL is not a valid URL.' };
  }

  if (parsed.protocol !== 'rtmp:' && parsed.protocol !== 'rtmps:') {
    return { valid: false, error: 'RTMP URL must start with rtmps:// or rtmp://.' };
  }

  if (!dryRun && PRIVATE_HOST_RE.test(parsed.hostname)) {
    return { valid: false, error: 'Private or loopback RTMP hosts are not allowed.' };
  }

  return { valid: true, sanitizedHost: parsed.hostname };
}
