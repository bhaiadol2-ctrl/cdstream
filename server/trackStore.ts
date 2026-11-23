import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { buildPaletteFromRGB, type PhonkTrack, type TrackPalette } from '../src/lib/phonkLogic.ts';
import { ensureDemoAudioFiles } from './demoAudio.ts';

const execFileAsync = promisify(execFile);

export const DATA_DIR = path.resolve(process.cwd(), 'data');
export const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
export const DEMO_AUDIO_DIR = path.join(UPLOADS_DIR, 'demo');
const TRACKS_FILE = path.join(DATA_DIR, 'tracks.json');

const SEED_TRACKS: PhonkTrack[] = [
  {
    id: 'demo-tokyo-drift',
    title: 'Tokyo Midnight Drift',
    artist: 'Kurogane 808',
    subgenre: 'Drift Phonk',
    audioUrl: '/uploads/demo/tokyo_drift_808.wav',
    coverUrl: '/src/assets/images/phonk_cover_crimson_1795444574683.jpg',
    durationSec: 48,
    bpm: 136,
    palette: buildPaletteFromRGB(214, 34, 54),
    isDemo: true,
    createdAt: 1700000001000,
  },
  {
    id: 'demo-touge-emerald',
    title: 'Touge Mist Cowbell',
    artist: 'Vortex Tape',
    subgenre: 'Atmospheric Phonk',
    audioUrl: '/uploads/demo/touge_emerald_cowbell.wav',
    coverUrl: '/src/assets/images/phonk_cover_emerald_1795444575644.jpg',
    durationSec: 52,
    bpm: 142,
    palette: buildPaletteFromRGB(18, 198, 114),
    isDemo: true,
    createdAt: 1700000002000,
  },
  {
    id: 'demo-sodium-amber',
    title: 'Sodium Rooftop Session',
    artist: 'Memphis Ghost',
    subgenre: 'Memphis Phonk',
    audioUrl: '/uploads/demo/sodium_midnight_phonk.wav',
    coverUrl: '/src/assets/images/phonk_cover_amber_1795444574909.jpg',
    durationSec: 56,
    bpm: 128,
    palette: buildPaletteFromRGB(224, 146, 38),
    isDemo: true,
    createdAt: 1700000003000,
  },
];

export async function probeAudioDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    const parsed = Number.parseFloat(stdout.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed);
    }
  } catch {
    // Fallback if ffprobe cannot parse
  }
  return 60;
}

export function resolveSafeAssetPath(urlPath: string): string | null {
  if (!urlPath) return null;
  if (urlPath.startsWith('/uploads/')) {
    const rel = urlPath.slice('/uploads/'.length);
    const resolved = path.resolve(UPLOADS_DIR, rel);
    if (!resolved.startsWith(UPLOADS_DIR + path.sep)) return null;
    return fs.existsSync(resolved) ? resolved : null;
  }
  if (urlPath.startsWith('/src/assets/images/')) {
    const assetsDir = path.resolve(process.cwd(), 'src', 'assets', 'images');
    const rel = urlPath.slice('/src/assets/images/'.length);
    const resolved = path.resolve(assetsDir, rel);
    if (!resolved.startsWith(assetsDir + path.sep)) return null;
    if (fs.existsSync(resolved)) return resolved;
    // Also check dist/src/assets/images in production
    const distAssetsDir = path.resolve(process.cwd(), 'dist', 'src', 'assets', 'images');
    const distResolved = path.resolve(distAssetsDir, rel);
    if (distResolved.startsWith(distAssetsDir + path.sep) && fs.existsSync(distResolved)) {
      return distResolved;
    }
    return null;
  }
  return null;
}

export class TrackStore {
  private tracks: PhonkTrack[] = [];

  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    this.load();
  }

  prepareDemoAudio(): void {
    ensureDemoAudioFiles(DEMO_AUDIO_DIR);
  }

  private load(): void {
    if (fs.existsSync(TRACKS_FILE)) {
      try {
        const raw = fs.readFileSync(TRACKS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.tracks = parsed;
          return;
        }
      } catch {
        // Fall through to seed
      }
    }
    this.tracks = [...SEED_TRACKS];
    this.save();
  }

  private save(): void {
    fs.writeFileSync(TRACKS_FILE, JSON.stringify(this.tracks, null, 2), 'utf-8');
  }

  getAll(): PhonkTrack[] {
    return [...this.tracks];
  }

  getById(id: string): PhonkTrack | undefined {
    return this.tracks.find((t) => t.id === id);
  }

  add(track: PhonkTrack): PhonkTrack {
    this.tracks.push(track);
    this.save();
    return track;
  }

  update(
    id: string,
    patch: Partial<Pick<PhonkTrack, 'title' | 'artist' | 'subgenre' | 'bpm' | 'palette' | 'coverUrl'>>
  ): PhonkTrack | null {
    const idx = this.tracks.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    this.tracks[idx] = { ...this.tracks[idx], ...patch };
    this.save();
    return this.tracks[idx];
  }

  reorder(orderedIds: string[]): PhonkTrack[] {
    const map = new Map(this.tracks.map((t) => [t.id, t]));
    const next: PhonkTrack[] = [];
    for (const id of orderedIds) {
      const found = map.get(id);
      if (found) {
        next.push(found);
        map.delete(id);
      }
    }
    for (const leftover of map.values()) {
      next.push(leftover);
    }
    this.tracks = next;
    this.save();
    return this.getAll();
  }

  remove(id: string): boolean {
    const idx = this.tracks.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    const [removed] = this.tracks.splice(idx, 1);
    this.save();

    // Clean up non-demo uploaded files safely within UPLOADS_DIR
    if (!removed.isDemo) {
      for (const assetUrl of [removed.audioUrl, removed.coverUrl]) {
        if (assetUrl.startsWith('/uploads/') && !assetUrl.startsWith('/uploads/demo/')) {
          const safePath = resolveSafeAssetPath(assetUrl);
          if (safePath && safePath.startsWith(UPLOADS_DIR + path.sep)) {
            fs.unlink(safePath, () => undefined);
          }
        }
      }
    }
    return true;
  }

  restoreDemos(): PhonkTrack[] {
    const existingIds = new Set(this.tracks.map((t) => t.id));
    for (const seed of SEED_TRACKS) {
      if (!existingIds.has(seed.id)) {
        this.tracks.push(seed);
      }
    }
    this.save();
    return this.getAll();
  }
}

export function sanitizePaletteInput(input: unknown): TrackPalette {
  if (input && typeof input === 'object') {
    const p = input as Partial<TrackPalette>;
    if (
      typeof p.primary === 'string' &&
      /^#[0-9a-fA-F]{6}$/.test(p.primary) &&
      typeof p.accent === 'string' &&
      /^#[0-9a-fA-F]{6}$/.test(p.accent)
    ) {
      return {
        primary: p.primary,
        secondary: typeof p.secondary === 'string' ? p.secondary : '#11131a',
        accent: p.accent,
        glowRgba: typeof p.glowRgba === 'string' ? p.glowRgba : 'rgba(214, 34, 54, 0.42)',
        glassBgRgba: typeof p.glassBgRgba === 'string' ? p.glassBgRgba : 'rgba(16, 14, 20, 0.54)',
        glassBorderRgba:
          typeof p.glassBorderRgba === 'string' ? p.glassBorderRgba : 'rgba(255, 255, 255, 0.2)',
        textOnAccent: p.textOnAccent === '#090a0f' ? '#090a0f' : '#ffffff',
      };
    }
  }
  return buildPaletteFromRGB(214, 34, 54);
}
