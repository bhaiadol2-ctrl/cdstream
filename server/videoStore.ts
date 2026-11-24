import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { type VideoItem } from '../src/lib/phonkLogic.ts';
import { DATA_DIR, resolveSafeAssetPath, UPLOADS_DIR } from './trackStore.ts';

const execFileAsync = promisify(execFile);

export const VIDEOS_DIR = path.join(UPLOADS_DIR, 'videos');
export const VIDEO_THUMBS_DIR = path.join(VIDEOS_DIR, 'thumbs');
export const VIDEO_CHUNKS_DIR = path.join(VIDEOS_DIR, 'chunks');
const VIDEOS_FILE = path.join(DATA_DIR, 'videos.json');

export function cleanupStaleChunks(maxAgeMs = 6 * 60 * 60 * 1000): void {
  try {
    fs.mkdirSync(VIDEO_CHUNKS_DIR, { recursive: true });
    const now = Date.now();
    for (const entry of fs.readdirSync(VIDEO_CHUNKS_DIR)) {
      const fullPath = path.join(VIDEO_CHUNKS_DIR, entry);
      try {
        const st = fs.statSync(fullPath);
        if (st.isFile() && now - st.mtimeMs > maxAgeMs) {
          fs.unlinkSync(fullPath);
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

export interface ProbedVideoMeta {
  durationSec: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string;
  hasAudio: boolean;
}

export async function probeVideoMetadata(filePath: string): Promise<ProbedVideoMeta> {
  const fallback: ProbedVideoMeta = {
    durationSec: 60,
    width: 1280,
    height: 720,
    videoCodec: '',
    audioCodec: '',
    hasAudio: true,
  };

  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        filePath,
      ],
      { timeout: 25_000, maxBuffer: 4 * 1024 * 1024 }
    );
    const parsed = JSON.parse(stdout);
    const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
    const videoStream = streams.find((s: { codec_type?: string }) => s?.codec_type === 'video');
    const audioStream = streams.find((s: { codec_type?: string }) => s?.codec_type === 'audio');

    const rawDur = Number.parseFloat(parsed?.format?.duration || videoStream?.duration || '0');
    const durationSec = Number.isFinite(rawDur) && rawDur > 0 ? Math.round(rawDur) : 60;
    const width =
      typeof videoStream?.width === 'number' && videoStream.width > 0 ? videoStream.width : 1280;
    const height =
      typeof videoStream?.height === 'number' && videoStream.height > 0 ? videoStream.height : 720;
    const videoCodec =
      typeof videoStream?.codec_name === 'string' ? videoStream.codec_name.toLowerCase() : '';
    const audioCodec =
      typeof audioStream?.codec_name === 'string' ? audioStream.codec_name.toLowerCase() : '';

    return {
      durationSec,
      width,
      height,
      videoCodec,
      audioCodec,
      hasAudio: Boolean(audioStream),
    };
  } catch {
    return fallback;
  }
}

export async function extractVideoThumbnail(
  videoPath: string,
  outThumbPath: string,
  durationSec: number
): Promise<boolean> {
  fs.mkdirSync(path.dirname(outThumbPath), { recursive: true });
  const seekSec = durationSec > 3 ? '2' : '0';
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-ss',
        seekSec,
        '-i',
        videoPath,
        '-frames:v',
        '1',
        '-vf',
        'scale=640:-2',
        '-q:v',
        '3',
        outThumbPath,
      ],
      { timeout: 25_000 }
    );
    return fs.existsSync(outThumbPath);
  } catch {
    try {
      await execFileAsync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          videoPath,
          '-frames:v',
          '1',
          '-vf',
          'scale=640:-2',
          '-q:v',
          '3',
          outThumbPath,
        ],
        { timeout: 25_000 }
      );
      return fs.existsSync(outThumbPath);
    } catch {
      return false;
    }
  }
}

export class VideoStore {
  private videos: VideoItem[] = [];

  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(VIDEOS_DIR, { recursive: true });
    fs.mkdirSync(VIDEO_THUMBS_DIR, { recursive: true });
    fs.mkdirSync(VIDEO_CHUNKS_DIR, { recursive: true });
    this.load();
  }

  private load(): void {
    if (fs.existsSync(VIDEOS_FILE)) {
      try {
        const raw = fs.readFileSync(VIDEOS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.videos = parsed;
          return;
        }
      } catch {
        // start empty
      }
    }
    this.videos = [];
  }

  private save(): void {
    fs.writeFileSync(VIDEOS_FILE, JSON.stringify(this.videos, null, 2), 'utf-8');
  }

  getAll(): VideoItem[] {
    return [...this.videos];
  }

  getById(id: string): VideoItem | undefined {
    return this.videos.find((v) => v.id === id);
  }

  add(video: VideoItem): VideoItem {
    this.videos.push(video);
    this.save();
    return video;
  }

  update(id: string, patch: Partial<Pick<VideoItem, 'title'>>): VideoItem | null {
    const idx = this.videos.findIndex((v) => v.id === id);
    if (idx === -1) return null;
    this.videos[idx] = { ...this.videos[idx], ...patch };
    this.save();
    return this.videos[idx];
  }

  reorder(orderedIds: string[]): VideoItem[] {
    const map = new Map(this.videos.map((v) => [v.id, v]));
    const next: VideoItem[] = [];
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
    this.videos = next;
    this.save();
    return this.getAll();
  }

  remove(id: string): boolean {
    const idx = this.videos.findIndex((v) => v.id === id);
    if (idx === -1) return false;
    const [removed] = this.videos.splice(idx, 1);
    this.save();

    for (const assetUrl of [removed.videoUrl, removed.thumbnailUrl]) {
      if (assetUrl && assetUrl.startsWith('/uploads/videos/')) {
        const safePath = resolveSafeAssetPath(assetUrl);
        if (safePath && safePath.startsWith(VIDEOS_DIR + path.sep)) {
          fs.unlink(safePath, () => undefined);
        }
      }
    }
    return true;
  }

  clearAll(): void {
    const items = [...this.videos];
    this.videos = [];
    this.save();
    for (const item of items) {
      for (const assetUrl of [item.videoUrl, item.thumbnailUrl]) {
        if (assetUrl && assetUrl.startsWith('/uploads/videos/')) {
          const safePath = resolveSafeAssetPath(assetUrl);
          if (safePath && safePath.startsWith(VIDEOS_DIR + path.sep)) {
            fs.unlink(safePath, () => undefined);
          }
        }
      }
    }
  }
}
