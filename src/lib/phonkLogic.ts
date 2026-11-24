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

export interface VideoItem {
  id: string;
  title: string;
  videoUrl: string;
  thumbnailUrl: string;
  durationSec: number;
  width: number;
  height: number;
  fileSizeBytes: number;
  videoCodec: string;
  audioCodec: string;
  hasAudio: boolean;
  createdAt: number;
}

export type StreamMode = 'video-24-7' | 'autonomous-24-7' | 'canvas-relay';
export type VideoEncodeMode = 'safe-encode' | 'direct-copy';
export type VisualizerStyle = 'bars' | 'mirror' | 'ring';
export type StreamState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error';
export type ShieldPresetId = 'movie-stealth' | 'framed-pip' | 'audio-color' | 'original';
export type QueueEndBehavior = 'loop' | 'stop-after-queue';
export type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-right';

export interface VideoShieldSettings {
  preset: ShieldPresetId;
  mirrorFlip: boolean;
  zoomPulse: boolean;
  zoomIntensityPct: number; // 4 to 16
  ambientPipFrame: boolean;
  colorShift: boolean;
  hueShiftDeg: number; // -25 to 25
  speedFactor: number; // 0.95 to 1.08
  bassBoomDb: number; // 0 to 12
  audioPitchShiftPct: number; // -6 to 6
  stereoWiden: boolean;
  watermarkText: string;
  watermarkPos: WatermarkPosition;
}

export const DEFAULT_VIDEO_SHIELD: VideoShieldSettings = {
  preset: 'movie-stealth',
  mirrorFlip: true,
  zoomPulse: true,
  zoomIntensityPct: 10,
  ambientPipFrame: true,
  colorShift: true,
  hueShiftDeg: 8,
  speedFactor: 1.03,
  bassBoomDb: 6,
  audioPitchShiftPct: 2,
  stereoWiden: true,
  watermarkText: '',
  watermarkPos: 'top-right',
};

export function buildVideoShieldPreset(
  preset: ShieldPresetId,
  existingWatermarkText = '',
  existingWatermarkPos: WatermarkPosition = 'top-right'
): VideoShieldSettings {
  switch (preset) {
    case 'movie-stealth':
      return {
        preset: 'movie-stealth',
        mirrorFlip: true,
        zoomPulse: true,
        zoomIntensityPct: 10,
        ambientPipFrame: true,
        colorShift: true,
        hueShiftDeg: 8,
        speedFactor: 1.03,
        bassBoomDb: 6,
        audioPitchShiftPct: 2,
        stereoWiden: true,
        watermarkText: existingWatermarkText,
        watermarkPos: existingWatermarkPos,
      };
    case 'framed-pip':
      return {
        preset: 'framed-pip',
        mirrorFlip: false,
        zoomPulse: true,
        zoomIntensityPct: 8,
        ambientPipFrame: true,
        colorShift: true,
        hueShiftDeg: 4,
        speedFactor: 1.0,
        bassBoomDb: 5,
        audioPitchShiftPct: 0,
        stereoWiden: true,
        watermarkText: existingWatermarkText,
        watermarkPos: existingWatermarkPos,
      };
    case 'audio-color':
      return {
        preset: 'audio-color',
        mirrorFlip: false,
        zoomPulse: false,
        zoomIntensityPct: 6,
        ambientPipFrame: false,
        colorShift: true,
        hueShiftDeg: 10,
        speedFactor: 1.03,
        bassBoomDb: 8,
        audioPitchShiftPct: 3,
        stereoWiden: true,
        watermarkText: existingWatermarkText,
        watermarkPos: existingWatermarkPos,
      };
    case 'original':
    default:
      return {
        preset: 'original',
        mirrorFlip: false,
        zoomPulse: false,
        zoomIntensityPct: 6,
        ambientPipFrame: false,
        colorShift: false,
        hueShiftDeg: 0,
        speedFactor: 1.0,
        bassBoomDb: 0,
        audioPitchShiftPct: 0,
        stereoWiden: false,
        watermarkText: '',
        watermarkPos: existingWatermarkPos,
      };
  }
}

export function isVideoShieldActive(shield?: Partial<VideoShieldSettings> | null): boolean {
  if (!shield) return false;
  return Boolean(
    shield.mirrorFlip ||
      shield.zoomPulse ||
      shield.ambientPipFrame ||
      shield.colorShift ||
      (typeof shield.speedFactor === 'number' && Math.abs(shield.speedFactor - 1) > 0.005) ||
      (typeof shield.bassBoomDb === 'number' && shield.bassBoomDb > 0) ||
      (typeof shield.audioPitchShiftPct === 'number' && Math.abs(shield.audioPitchShiftPct) > 0.2) ||
      shield.stereoWiden ||
      (typeof shield.watermarkText === 'string' && shield.watermarkText.trim().length > 0)
  );
}

export function sanitizeWatermarkText(raw: string): string {
  return raw
    .replace(/[\r\n\t\\'":;%[\]{}=]/g, '')
    .trim()
    .slice(0, 36);
}

export interface StreamConfig {
  rtmpUrl: string;
  resolution: '1280x720' | '1920x1080';
  fps: 30 | 60;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  autoReconnect: boolean;
  mode: StreamMode;
  videoEncodeMode?: VideoEncodeMode;
  queueEndBehavior?: QueueEndBehavior;
  autoStopMinutes?: number;
  videoShield?: VideoShieldSettings;
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
  queueEndBehavior?: QueueEndBehavior;
  autoStopRemainingSec?: number | null;
  stopReason?: 'manual' | 'queue-completed' | 'timer-completed' | 'error' | null;
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

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  if (mb >= 10) {
    return `${Math.round(mb)} MB`;
  }
  return `${mb.toFixed(1)} MB`;
}

export function isDirectCopyCompatibleVideo(
  video: Pick<VideoItem, 'videoCodec' | 'audioCodec' | 'hasAudio'>
): boolean {
  const vOk = video.videoCodec.toLowerCase() === 'h264';
  const aOk = video.hasAudio && video.audioCodec.toLowerCase() === 'aac';
  return vOk && aOk;
}

// 5 MiB per chunk keeps every HTTP request well beneath Cloud Run's 32 MiB limit
export const UPLOAD_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;

export interface UploadChunkSlice {
  index: number;
  start: number;
  end: number;
  size: number;
}

export function calculateUploadChunks(
  fileSizeBytes: number,
  chunkSizeBytes: number = UPLOAD_CHUNK_SIZE_BYTES
): UploadChunkSlice[] {
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0 || chunkSizeBytes <= 0) {
    return [];
  }
  const safeChunkSize = Math.max(1, Math.floor(chunkSizeBytes));
  const totalBytes = Math.floor(fileSizeBytes);
  const chunks: UploadChunkSlice[] = [];
  let start = 0;
  let index = 0;
  while (start < totalBytes) {
    const end = Math.min(totalBytes, start + safeChunkSize);
    chunks.push({ index, start, end, size: end - start });
    start = end;
    index += 1;
  }
  return chunks;
}

const VIDEO_FILE_EXT_RE =
  /\.(mp4|mkv|mov|webm|m4v|ts|avi|flv|3gp|3g2|mpeg|mpg|wmv|vob|mts|m2ts|ogv|divx|f4v)$/i;

export function isLikelyVideoFile(filename: string, mimeType = ''): boolean {
  const mime = mimeType.trim().toLowerCase();
  if (mime.startsWith('video/')) return true;
  return VIDEO_FILE_EXT_RE.test(filename.trim());
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
