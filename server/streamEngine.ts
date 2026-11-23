import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import {
  formatTimeMMSS,
  maskStreamKey,
  validateRtmpTarget,
  type PhonkTrack,
  type StreamConfig,
  type StreamMode,
  type StreamState,
  type StreamStatus,
} from '../src/lib/phonkLogic.ts';
import { resolveSafeAssetPath, type TrackStore } from './trackStore.ts';

const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
];

function findSystemFont(): string | null {
  for (const candidate of FONT_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .slice(0, 80);
}

export class StreamEngine extends EventEmitter {
  private store: TrackStore;
  private streamKey = '';
  private config: StreamConfig = {
    rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
    resolution: '1280x720',
    fps: 30,
    videoBitrateKbps: 4500,
    audioBitrateKbps: 192,
    autoReconnect: true,
    mode: 'autonomous-24-7',
    dryRun: false,
  };

  private state: StreamState = 'idle';
  private startedAt: number | null = null;
  private currentTrackIndex = 0;
  private currentTrackId: string | null = null;
  private currentTrackTitle = '';
  private loopCount = 0;
  private reconnectAttempts = 0;
  private measuredFps = 0;
  private measuredBitrateKbps = 0;
  private lastError: string | null = null;

  private activeProc: ChildProcess | null = null;
  private relayProc: ChildProcess | null = null;
  private stopRequested = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private uptimeInterval: NodeJS.Timeout | null = null;
  private fontPath: string | null;

  constructor(store: TrackStore) {
    super();
    this.store = store;
    this.fontPath = findSystemFont();
  }

  setStreamKey(key: string): void {
    this.streamKey = key.trim();
    this.emitStatus();
  }

  clearStreamKey(): void {
    this.streamKey = '';
    this.emitStatus();
  }

  updateConfig(patch: Partial<StreamConfig>): StreamConfig {
    if (typeof patch.rtmpUrl === 'string') {
      this.config.rtmpUrl = patch.rtmpUrl.trim() || 'rtmp://a.rtmp.youtube.com/live2';
    }
    if (patch.resolution === '1280x720' || patch.resolution === '1920x1080') {
      this.config.resolution = patch.resolution;
    }
    if (patch.fps === 30 || patch.fps === 60) {
      this.config.fps = patch.fps;
    }
    if (typeof patch.videoBitrateKbps === 'number') {
      this.config.videoBitrateKbps = Math.min(9000, Math.max(1500, Math.round(patch.videoBitrateKbps)));
    }
    if (typeof patch.audioBitrateKbps === 'number') {
      this.config.audioBitrateKbps = Math.min(320, Math.max(96, Math.round(patch.audioBitrateKbps)));
    }
    if (typeof patch.autoReconnect === 'boolean') {
      this.config.autoReconnect = patch.autoReconnect;
    }
    if (patch.mode === 'autonomous-24-7' || patch.mode === 'canvas-relay') {
      this.config.mode = patch.mode;
    }
    if (typeof patch.dryRun === 'boolean') {
      this.config.dryRun = patch.dryRun;
    }
    this.emitStatus();
    return { ...this.config };
  }

  getConfig(): StreamConfig {
    return { ...this.config };
  }

  getStatus(): StreamStatus {
    const uptimeSec =
      this.startedAt && (this.state === 'live' || this.state === 'connecting' || this.state === 'reconnecting')
        ? Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000))
        : 0;

    return {
      state: this.state,
      mode: this.config.mode,
      dryRun: this.config.dryRun,
      hasStreamKey: this.streamKey.length > 0,
      maskedStreamKey: maskStreamKey(this.streamKey),
      rtmpUrl: this.config.rtmpUrl,
      startedAt: this.startedAt,
      uptimeSec,
      currentTrackId: this.currentTrackId,
      currentTrackTitle: this.currentTrackTitle,
      loopCount: this.loopCount,
      reconnectAttempts: this.reconnectAttempts,
      fps: this.measuredFps || (this.state === 'live' ? this.config.fps : 0),
      bitrateKbps: this.measuredBitrateKbps || (this.state === 'live' ? this.config.videoBitrateKbps : 0),
      resolution: this.config.resolution,
      lastError: this.lastError,
    };
  }

  private emitStatus(): void {
    this.emit('status', this.getStatus());
  }

  private getOutputTargetArgs(): string[] {
    if (this.config.dryRun) {
      return ['-f', 'null', '-'];
    }
    const baseUrl = this.config.rtmpUrl.replace(/\/+$/, '');
    const targetUrl = `${baseUrl}/${this.streamKey}`;
    return ['-f', 'flv', '-flvflags', 'no_duration_filesize', targetUrl];
  }

  start(modeOverride?: StreamMode): { ok: boolean; error?: string } {
    if (modeOverride) {
      this.config.mode = modeOverride;
    }

    const validation = validateRtmpTarget(this.config.rtmpUrl, this.streamKey, this.config.dryRun);
    if (!validation.valid) {
      this.lastError = validation.error ?? 'Invalid RTMP configuration.';
      this.state = 'error';
      this.emitStatus();
      return { ok: false, error: this.lastError };
    }

    const tracks = this.store.getAll();
    if (this.config.mode === 'autonomous-24-7' && tracks.length === 0) {
      this.lastError = 'Add at least one Phonk track before starting the 24/7 broadcast.';
      this.state = 'error';
      this.emitStatus();
      return { ok: false, error: this.lastError };
    }

    this.stopInternal(false);
    this.stopRequested = false;
    this.lastError = null;
    this.reconnectAttempts = 0;
    this.loopCount = 0;
    this.currentTrackIndex = 0;
    this.startedAt = Date.now();
    this.state = 'connecting';
    this.emitStatus();

    if (this.uptimeInterval) clearInterval(this.uptimeInterval);
    this.uptimeInterval = setInterval(() => {
      if (this.state === 'live' || this.state === 'connecting' || this.state === 'reconnecting') {
        this.emitStatus();
      }
    }, 1000);

    if (this.config.mode === 'autonomous-24-7') {
      this.launchNextAutonomousTrack();
    } else {
      // Canvas Relay waits for WebSocket binary chunks from browser MediaRecorder
      this.startCanvasRelayProcess();
    }

    return { ok: true };
  }

  stop(): void {
    this.stopInternal(true);
  }

  private stopInternal(resetToIdle: boolean): void {
    this.stopRequested = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.uptimeInterval) {
      clearInterval(this.uptimeInterval);
      this.uptimeInterval = null;
    }
    if (this.activeProc) {
      const proc = this.activeProc;
      this.activeProc = null;
      proc.stderr?.removeAllListeners('data');
      proc.removeAllListeners('close');
      try {
        proc.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
    if (this.relayProc) {
      const proc = this.relayProc;
      this.relayProc = null;
      proc.stderr?.removeAllListeners('data');
      proc.removeAllListeners('close');
      try {
        proc.stdin?.end();
        proc.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
    if (resetToIdle) {
      this.state = 'idle';
      this.startedAt = null;
      this.measuredFps = 0;
      this.measuredBitrateKbps = 0;
      this.currentTrackId = null;
      this.currentTrackTitle = '';
      this.emitStatus();
    }
  }

  skipTrack(trackId?: string): void {
    if (this.config.mode !== 'autonomous-24-7' || this.state === 'idle') return;
    const tracks = this.store.getAll();
    if (tracks.length === 0) return;

    if (trackId) {
      const idx = tracks.findIndex((t) => t.id === trackId);
      if (idx !== -1) this.currentTrackIndex = idx;
    } else {
      this.currentTrackIndex = (this.currentTrackIndex + 1) % tracks.length;
    }

    if (this.activeProc) {
      const proc = this.activeProc;
      this.activeProc = null;
      proc.removeAllListeners('close');
      try {
        proc.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
    this.launchNextAutonomousTrack();
  }

  private launchNextAutonomousTrack(): void {
    if (this.stopRequested) return;
    const tracks = this.store.getAll();
    if (tracks.length === 0) {
      this.lastError = 'Playlist is empty. Broadcast stopped.';
      this.state = 'error';
      this.emitStatus();
      return;
    }

    if (this.currentTrackIndex >= tracks.length) {
      this.currentTrackIndex = 0;
      this.loopCount += 1;
    }

    const track = tracks[this.currentTrackIndex];
    const audioPath = resolveSafeAssetPath(track.audioUrl);
    const coverPath = resolveSafeAssetPath(track.coverUrl);

    if (!audioPath || !coverPath) {
      // Skip broken track cleanly and advance loop
      this.currentTrackIndex = (this.currentTrackIndex + 1) % tracks.length;
      if (tracks.length === 1) {
        this.lastError = 'Track audio or cover file missing on server.';
        this.state = 'error';
        this.emitStatus();
        return;
      }
      setTimeout(() => this.launchNextAutonomousTrack(), 250);
      return;
    }

    this.currentTrackId = track.id;
    this.currentTrackTitle = track.title;
    this.emitStatus();

    const args = this.buildAutonomousFfmpegArgs(track, audioPath, coverPath);
    const proc = spawn('ffmpeg', args, { shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    this.activeProc = proc;

    let stderrTail = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-1200);
      this.parseFfmpegTelemetry(text);
    });

    proc.on('close', (code) => {
      if (this.activeProc !== proc) return;
      this.activeProc = null;
      if (this.stopRequested) return;

      if (code === 0) {
        // Track finished normally -> advance sequentially in infinite lifetime loop!
        this.reconnectAttempts = 0;
        const nextIdx = this.currentTrackIndex + 1;
        if (nextIdx >= tracks.length) {
          this.loopCount += 1;
          this.currentTrackIndex = 0;
        } else {
          this.currentTrackIndex = nextIdx;
        }
        this.launchNextAutonomousTrack();
      } else {
        // RTMP drop or encoding interruption
        const sanitizedMsg = this.sanitizeFfmpegError(stderrTail);
        this.lastError = sanitizedMsg;
        if (this.config.autoReconnect) {
          this.state = 'reconnecting';
          this.reconnectAttempts += 1;
          this.emitStatus();
          const delayMs = Math.min(15000, 2000 * Math.min(this.reconnectAttempts, 5));
          this.reconnectTimer = setTimeout(() => {
            if (!this.stopRequested) {
              this.launchNextAutonomousTrack();
            }
          }, delayMs);
        } else {
          this.state = 'error';
          this.emitStatus();
        }
      }
    });
  }

  private buildAutonomousFfmpegArgs(track: PhonkTrack, audioPath: string, coverPath: string): string[] {
    const [w, h] = this.config.resolution === '1920x1080' ? [1920, 1080] : [1280, 720];
    const scaleFactor = w / 1280;
    const cardW = Math.round(920 * scaleFactor);
    const cardH = Math.round(440 * scaleFactor);
    const cardX = Math.round((w - cardW) / 2);
    const cardY = Math.round((h - cardH) / 2 - 16 * scaleFactor);
    const artSize = Math.round(320 * scaleFactor);
    const artX = Math.round(cardX + 48 * scaleFactor);
    const artY = Math.round(cardY + (cardH - artSize) / 2);
    const textX = Math.round(artX + artSize + 44 * scaleFactor);
    const barY = Math.round(h - 76 * scaleFactor);
    const accentHex = track.palette.accent.replace('#', '0x');
    const primaryHex = track.palette.primary.replace('#', '0x');

    const titleEsc = escapeDrawtext(track.title);
    const artistEsc = escapeDrawtext(`${track.artist}  ·  ${track.subgenre}`);
    const totalTimeEsc = escapeDrawtext(formatTimeMMSS(track.durationSec));
    const fontArg = this.fontPath ? `fontfile=${this.fontPath}:` : '';

    // Build glassmorphic FFmpeg filtergraph:
    // 1. Blurred, darkened cover art backdrop
    // 2. Frosted dark glass center panel with subtle cover-tinted hairline border
    // 3. Crisp square cover art inside the glass panel
    // 4. Real-time audio spectrum bar blended inside the glass card
    // 5. Track title, artist, live label, and bottom MM:SS / MM:SS timer
    const filters = [
      `[0:v]scale=320:180:force_original_aspect_ratio=increase,crop=320:180,boxblur=10:2,scale=${w}:${h}:flags=bilinear,eq=brightness=-0.18:saturation=1.25[bg]`,
      `[bg]drawbox=x=${cardX}:y=${cardY}:w=${cardW}:h=${cardH}:color=0x0c0e14@0.58:t=fill,drawbox=x=${cardX}:y=${cardY}:w=${cardW}:h=${cardH}:color=${accentHex}@0.42:t=2[glass]`,
      `[0:v]scale=${artSize}:${artSize}:force_original_aspect_ratio=increase,crop=${artSize}:${artSize}[art]`,
      `[glass][art]overlay=${artX}:${artY}[with_art]`,
      `[1:a]showfreqs=s=${Math.round(460 * scaleFactor)}x${Math.round(90 * scaleFactor)}:mode=bar:fscale=log:colors=${accentHex}|${primaryHex}[spec]`,
      `[with_art][spec]overlay=${textX}:${Math.round(artY + artSize - 102 * scaleFactor)}[with_spec]`,
      `[with_spec]drawbox=x=${cardX}:y=${barY}:w=${cardW}:h=${Math.round(4 * scaleFactor)}:color=0xffffff@0.16:t=fill` +
        `,drawtext=${fontArg}text='PHONK 24/7 LIVE':x=${textX}:y=${artY + 10}:fontsize=${Math.round(16 * scaleFactor)}:fontcolor=${accentHex}` +
        `,drawtext=${fontArg}text='${titleEsc}':x=${textX}:y=${Math.round(artY + 46 * scaleFactor)}:fontsize=${Math.round(38 * scaleFactor)}:fontcolor=0xffffff` +
        `,drawtext=${fontArg}text='${artistEsc}':x=${textX}:y=${Math.round(artY + 100 * scaleFactor)}:fontsize=${Math.round(20 * scaleFactor)}:fontcolor=0xd4d4d8` +
        `,drawtext=${fontArg}text='%{pts\\:hms} / ${totalTimeEsc}':x=${cardX}:y=${Math.round(barY - 34 * scaleFactor)}:fontsize=${Math.round(22 * scaleFactor)}:fontcolor=0xffffff[vout]`,
    ].join(';');

    const gop = this.config.fps * 2;
    return [
      '-re',
      '-framerate',
      String(this.config.fps),
      '-loop',
      '1',
      '-i',
      coverPath,
      '-i',
      audioPath,
      '-filter_complex',
      filters,
      '-map',
      '[vout]',
      '-map',
      '1:a',
      '-c:v',
      'libx264',
      '-preset',
      'superfast',
      '-tune',
      'stillimage',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(this.config.fps),
      '-g',
      String(gop),
      '-b:v',
      `${this.config.videoBitrateKbps}k`,
      '-maxrate',
      `${this.config.videoBitrateKbps}k`,
      '-bufsize',
      `${this.config.videoBitrateKbps * 2}k`,
      '-c:a',
      'aac',
      '-b:a',
      `${this.config.audioBitrateKbps}k`,
      '-ar',
      '44100',
      '-ac',
      '2',
      '-shortest',
      ...this.getOutputTargetArgs(),
    ];
  }

  private startCanvasRelayProcess(): void {
    const gop = this.config.fps * 2;
    const args = [
      '-fflags',
      '+genpts',
      '-i',
      'pipe:0',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-tune',
      'zerolatency',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(this.config.fps),
      '-g',
      String(gop),
      '-b:v',
      `${this.config.videoBitrateKbps}k`,
      '-maxrate',
      `${this.config.videoBitrateKbps}k`,
      '-bufsize',
      `${this.config.videoBitrateKbps * 2}k`,
      '-c:a',
      'aac',
      '-b:a',
      `${this.config.audioBitrateKbps}k`,
      '-ar',
      '44100',
      '-ac',
      '2',
      ...this.getOutputTargetArgs(),
    ];

    const proc = spawn('ffmpeg', args, { shell: false, stdio: ['pipe', 'ignore', 'pipe'] });
    this.relayProc = proc;
    let stderrTail = '';

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-1200);
      this.parseFfmpegTelemetry(text);
    });

    proc.on('close', (code) => {
      if (this.relayProc !== proc) return;
      this.relayProc = null;
      if (this.stopRequested) return;
      if (code !== 0) {
        this.lastError = this.sanitizeFfmpegError(stderrTail);
        this.state = 'error';
        this.emitStatus();
      }
    });
  }

  writeRelayChunk(chunk: Buffer): void {
    if (this.config.mode !== 'canvas-relay' || this.stopRequested) return;
    if (!this.relayProc || !this.relayProc.stdin || this.relayProc.stdin.destroyed) return;
    try {
      this.relayProc.stdin.write(chunk);
    } catch {
      // ignore backpressure closed pipe
    }
  }

  private parseFfmpegTelemetry(text: string): void {
    if (this.stopRequested || this.state === 'idle') return;
    const fpsMatch = text.match(/fps=\s*([\d.]+)/);
    const bitrateMatch = text.match(/bitrate=\s*([\d.]+)kbits\/s/);
    if (fpsMatch || bitrateMatch) {
      if (this.state !== 'live') {
        this.state = 'live';
      }
      if (fpsMatch) this.measuredFps = Math.round(Number.parseFloat(fpsMatch[1]));
      if (bitrateMatch) this.measuredBitrateKbps = Math.round(Number.parseFloat(bitrateMatch[1]));
      this.emitStatus();
    }
  }

  private sanitizeFfmpegError(raw: string): string {
    // Strip any stream key from error text before surfacing to UI
    let cleaned = raw;
    if (this.streamKey) {
      cleaned = cleaned.split(this.streamKey).join('***');
    }
    const lines = cleaned
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const errLine = [...lines].reverse().find((l) => /error|failed|refused|timed out|invalid/i.test(l));
    return errLine ? errLine.slice(0, 180) : 'FFmpeg broadcast stream disconnected.';
  }
}
