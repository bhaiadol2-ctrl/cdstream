import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import net from 'net';
import {
  clamp,
  DEFAULT_VIDEO_SHIELD,
  DEFAULT_VISUAL_SETTINGS,
  DEFAULT_YOUTUBE_RTMPS_URL,
  isVideoShieldActive,
  maskStreamKey,
  sanitizeWatermarkText,
  validateRtmpTarget,
  type PhonkTrack,
  type QueueEndBehavior,
  type StreamConfig,
  type StreamMode,
  type StreamState,
  type StreamStatus,
  type VideoEncodeMode,
  type VideoItem,
  type VideoShieldSettings,
  type VisualSettings,
} from '../src/lib/phonkLogic.ts';
import {
  cleanupGlassRenderBundle,
  generateGlassRenderBundle,
  type GlassRenderBundle,
} from './glassFrameGenerator.ts';
import { resolveSafeAssetPath, type TrackStore } from './trackStore.ts';
import { type VideoStore } from './videoStore.ts';

const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-SemiBold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
];

function findSystemFont(): string | null {
  for (const candidate of FONT_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function probeTcpReachable(host: string, port: number, timeoutMs = 1800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: timeoutMs });
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

export class StreamEngine extends EventEmitter {
  private store: TrackStore;
  private videoStore: VideoStore;
  private streamKey = '';
  private config: StreamConfig = {
    rtmpUrl: DEFAULT_YOUTUBE_RTMPS_URL,
    resolution: '1280x720',
    fps: 30,
    videoBitrateKbps: 4500,
    audioBitrateKbps: 192,
    autoReconnect: true,
    mode: 'video-24-7',
    videoEncodeMode: 'safe-encode',
    queueEndBehavior: 'loop',
    autoStopMinutes: 0,
    videoShield: { ...DEFAULT_VIDEO_SHIELD },
    dryRun: false,
    visuals: { ...DEFAULT_VISUAL_SETTINGS },
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
  private stopReason: 'manual' | 'queue-completed' | 'timer-completed' | 'error' | null = null;
  private lastError: string | null = null;

  private muxerProc: ChildProcess | null = null;
  private workerProc: ChildProcess | null = null;
  private relayProc: ChildProcess | null = null;
  private cumulativeTsOffsetSec = 0;
  private workerStartedAt = 0;
  private consecutiveWorkerFailures = 0;
  private stopRequested = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private uptimeInterval: NodeJS.Timeout | null = null;
  private finishCleanupTimer: NodeJS.Timeout | null = null;
  private fontPath: string | null;

  constructor(store: TrackStore, videoStore: VideoStore) {
    super();
    this.store = store;
    this.videoStore = videoStore;
    this.fontPath = findSystemFont();
  }

  setStreamKey(key: string): void {
    // Allow users who accidentally paste full rtmp(s)://.../live2/<key>
    const trimmed = key.trim();
    const match = trimmed.match(/^rtmps?:\/\/[^/]+\/live2\/([a-zA-Z0-9._-]+)$/i);
    this.streamKey = match ? match[1] : trimmed;
    this.emitStatus();
  }

  clearStreamKey(): void {
    this.streamKey = '';
    this.emitStatus();
  }

  updateConfig(patch: Partial<StreamConfig>): StreamConfig {
    if (typeof patch.rtmpUrl === 'string') {
      this.config.rtmpUrl = patch.rtmpUrl.trim() || DEFAULT_YOUTUBE_RTMPS_URL;
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
    if (patch.mode === 'video-24-7' || patch.mode === 'autonomous-24-7' || patch.mode === 'canvas-relay') {
      this.config.mode = patch.mode;
    }
    if (patch.videoEncodeMode === 'safe-encode' || patch.videoEncodeMode === 'direct-copy') {
      this.config.videoEncodeMode = patch.videoEncodeMode;
    }
    if (patch.queueEndBehavior === 'loop' || patch.queueEndBehavior === 'stop-after-queue') {
      this.config.queueEndBehavior = patch.queueEndBehavior;
    }
    if (typeof patch.autoStopMinutes === 'number') {
      this.config.autoStopMinutes = Math.min(1440, Math.max(0, Math.round(patch.autoStopMinutes)));
    }
    if (patch.videoShield && typeof patch.videoShield === 'object') {
      const s = patch.videoShield as Partial<VideoShieldSettings>;
      const prev = this.config.videoShield || DEFAULT_VIDEO_SHIELD;
      const preset =
        s.preset === 'movie-stealth' ||
        s.preset === 'framed-pip' ||
        s.preset === 'audio-color' ||
        s.preset === 'original'
          ? s.preset
          : prev.preset;
      const watermarkPos =
        s.watermarkPos === 'top-left' ||
        s.watermarkPos === 'top-right' ||
        s.watermarkPos === 'bottom-right'
          ? s.watermarkPos
          : prev.watermarkPos;
      this.config.videoShield = {
        preset,
        mirrorFlip: typeof s.mirrorFlip === 'boolean' ? s.mirrorFlip : prev.mirrorFlip,
        zoomPulse: typeof s.zoomPulse === 'boolean' ? s.zoomPulse : prev.zoomPulse,
        zoomIntensityPct:
          typeof s.zoomIntensityPct === 'number'
            ? clamp(Math.round(s.zoomIntensityPct), 4, 16)
            : prev.zoomIntensityPct,
        ambientPipFrame:
          typeof s.ambientPipFrame === 'boolean' ? s.ambientPipFrame : prev.ambientPipFrame,
        colorShift: typeof s.colorShift === 'boolean' ? s.colorShift : prev.colorShift,
        hueShiftDeg:
          typeof s.hueShiftDeg === 'number'
            ? clamp(Math.round(s.hueShiftDeg), -25, 25)
            : prev.hueShiftDeg,
        speedFactor:
          typeof s.speedFactor === 'number'
            ? clamp(Number(s.speedFactor.toFixed(2)), 0.94, 1.08)
            : prev.speedFactor,
        bassBoomDb:
          typeof s.bassBoomDb === 'number'
            ? clamp(Math.round(s.bassBoomDb), 0, 12)
            : prev.bassBoomDb,
        audioPitchShiftPct:
          typeof s.audioPitchShiftPct === 'number'
            ? clamp(Math.round(s.audioPitchShiftPct), -6, 6)
            : prev.audioPitchShiftPct,
        stereoWiden: typeof s.stereoWiden === 'boolean' ? s.stereoWiden : prev.stereoWiden,
        watermarkText:
          typeof s.watermarkText === 'string'
            ? sanitizeWatermarkText(s.watermarkText)
            : prev.watermarkText,
        watermarkPos,
      };
    }
    if (typeof patch.dryRun === 'boolean') {
      this.config.dryRun = patch.dryRun;
    }
    if (patch.visuals && typeof patch.visuals === 'object') {
      const v = patch.visuals as Partial<VisualSettings>;
      const prev = this.config.visuals || DEFAULT_VISUAL_SETTINGS;
      this.config.visuals = {
        glassBlurPx:
          typeof v.glassBlurPx === 'number'
            ? Math.min(44, Math.max(12, Math.round(v.glassBlurPx)))
            : prev.glassBlurPx,
        glassOpacity:
          typeof v.glassOpacity === 'number'
            ? Math.min(0.75, Math.max(0.25, v.glassOpacity))
            : prev.glassOpacity,
        bassPulse: typeof v.bassPulse === 'boolean' ? v.bassPulse : prev.bassPulse,
        visualizerStyle:
          v.visualizerStyle === 'bars' || v.visualizerStyle === 'mirror' || v.visualizerStyle === 'ring'
            ? v.visualizerStyle
            : prev.visualizerStyle,
        showLiveBadge: typeof v.showLiveBadge === 'boolean' ? v.showLiveBadge : prev.showLiveBadge,
        showUpNext: typeof v.showUpNext === 'boolean' ? v.showUpNext : prev.showUpNext,
        ambientDrift: typeof v.ambientDrift === 'boolean' ? v.ambientDrift : prev.ambientDrift,
      };
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

    const autoStopMin = this.config.autoStopMinutes || 0;
    const autoStopRemainingSec =
      autoStopMin > 0 && this.startedAt && (this.state === 'live' || this.state === 'connecting' || this.state === 'reconnecting')
        ? Math.max(0, autoStopMin * 60 - uptimeSec)
        : null;

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
      queueEndBehavior: (this.config.queueEndBehavior || 'loop') as QueueEndBehavior,
      autoStopRemainingSec,
      stopReason: this.stopReason,
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
    return ['-rw_timeout', '15000000', '-f', 'flv', '-flvflags', 'no_duration_filesize', targetUrl];
  }

  async start(modeOverride?: StreamMode): Promise<{ ok: boolean; error?: string }> {
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
    const videos = this.videoStore.getAll();
    if (this.config.mode === 'video-24-7' && videos.length === 0) {
      this.lastError = 'Upload at least one video file before starting the 24/7 video live stream.';
      this.state = 'error';
      this.emitStatus();
      return { ok: false, error: this.lastError };
    }
    if (this.config.mode === 'autonomous-24-7' && tracks.length === 0) {
      this.lastError = 'Add at least one Phonk track before starting the 24/7 broadcast.';
      this.state = 'error';
      this.emitStatus();
      return { ok: false, error: this.lastError };
    }

    // Auto-upgrade rtmp://a.rtmp.youtube.com/live2 (port 1935) -> rtmps://a.rtmps.youtube.com:443/live2
    // if port 1935 is firewalled by the host network.
    if (!this.config.dryRun) {
      try {
        const parsed = new URL(this.config.rtmpUrl);
        if (parsed.protocol === 'rtmp:' && /youtube\.com$/i.test(parsed.hostname)) {
          const port = parsed.port ? Number(parsed.port) : 1935;
          const reachable = await probeTcpReachable(parsed.hostname, port, 1800);
          if (!reachable) {
            const tlsReachable = await probeTcpReachable('a.rtmps.youtube.com', 443, 2000);
            if (tlsReachable) {
              this.config.rtmpUrl = DEFAULT_YOUTUBE_RTMPS_URL;
            }
          }
        }
      } catch {
        // validation already checked URL
      }
    }

    this.stopInternal(false);
    this.stopRequested = false;
    this.stopReason = null;
    this.lastError = null;
    this.reconnectAttempts = 0;
    this.consecutiveWorkerFailures = 0;
    this.loopCount = 0;
    this.currentTrackIndex = 0;
    this.cumulativeTsOffsetSec = 0;
    this.startedAt = Date.now();
    this.state = 'connecting';
    this.emitStatus();

    if (this.uptimeInterval) clearInterval(this.uptimeInterval);
    this.uptimeInterval = setInterval(() => {
      if (this.state === 'live' || this.state === 'connecting' || this.state === 'reconnecting') {
        const autoStopMin = this.config.autoStopMinutes || 0;
        if (autoStopMin > 0 && this.startedAt) {
          const elapsedSec = Math.floor((Date.now() - this.startedAt) / 1000);
          if (elapsedSec >= autoStopMin * 60) {
            this.finishStreamCleanly('timer-completed');
            return;
          }
        }
        this.emitStatus();
      }
    }, 1000);

    if (this.config.mode === 'autonomous-24-7' || this.config.mode === 'video-24-7') {
      this.startAutonomousPipeline();
    } else {
      this.startCanvasRelayProcess();
    }

    return { ok: true };
  }

  stop(): void {
    this.stopReason = 'manual';
    this.stopInternal(true);
  }

  private finishStreamCleanly(reason: 'queue-completed' | 'timer-completed'): void {
    this.stopRequested = true;
    this.stopReason = reason;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.uptimeInterval) {
      clearInterval(this.uptimeInterval);
      this.uptimeInterval = null;
    }
    if (this.finishCleanupTimer) {
      clearTimeout(this.finishCleanupTimer);
      this.finishCleanupTimer = null;
    }

    const w = this.workerProc;
    this.workerProc = null;
    this.killProc(w);

    const m = this.muxerProc;
    this.muxerProc = null;
    if (m) {
      m.stdout?.removeAllListeners('data');
      m.stderr?.removeAllListeners('data');
      m.removeAllListeners('close');
      try {
        // End stdin cleanly so FLV trailer/RTMP closeStream reaches YouTube Live cleanly
        m.stdin?.end();
      } catch {
        // ignore
      }
      this.finishCleanupTimer = setTimeout(() => {
        try {
          m.kill('SIGTERM');
        } catch {
          // ignore
        }
      }, 2200);
    }

    this.state = 'idle';
    this.startedAt = null;
    this.measuredFps = 0;
    this.measuredBitrateKbps = 0;
    this.currentTrackId = null;
    this.currentTrackTitle = '';
    this.lastError = null;
    this.emitStatus();
  }

  private killProc(proc: ChildProcess | null): void {
    if (!proc) return;
    proc.stdout?.removeAllListeners('data');
    proc.stderr?.removeAllListeners('data');
    proc.removeAllListeners('close');
    try {
      proc.stdin?.end();
    } catch {
      // ignore
    }
    try {
      proc.kill('SIGTERM');
    } catch {
      // ignore
    }
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
    if (this.finishCleanupTimer) {
      clearTimeout(this.finishCleanupTimer);
      this.finishCleanupTimer = null;
    }

    const w = this.workerProc;
    this.workerProc = null;
    this.killProc(w);

    const m = this.muxerProc;
    this.muxerProc = null;
    this.killProc(m);

    const r = this.relayProc;
    this.relayProc = null;
    this.killProc(r);

    if (resetToIdle) {
      this.state = 'idle';
      this.startedAt = null;
      this.measuredFps = 0;
      this.measuredBitrateKbps = 0;
      this.currentTrackId = null;
      this.currentTrackTitle = '';
      this.lastError = null;
      this.emitStatus();
    }
  }

  skipTrack(trackId?: string): void {
    if (
      (this.config.mode !== 'autonomous-24-7' && this.config.mode !== 'video-24-7') ||
      this.state === 'idle'
    ) {
      return;
    }
    const items = this.config.mode === 'video-24-7' ? this.videoStore.getAll() : this.store.getAll();
    if (items.length === 0) return;

    if (trackId) {
      const idx = items.findIndex((t) => t.id === trackId);
      if (idx !== -1) this.currentTrackIndex = idx;
    } else {
      this.currentTrackIndex = (this.currentTrackIndex + 1) % items.length;
    }

    if (this.workerStartedAt > 0) {
      const elapsed = Math.max(0.5, (Date.now() - this.workerStartedAt) / 1000);
      this.cumulativeTsOffsetSec += elapsed + 0.1;
    }

    if (this.workerProc) {
      const proc = this.workerProc;
      this.workerProc = null;
      this.killProc(proc);
    }
    this.launchNextPipelineItem();
  }

  private startAutonomousPipeline(): void {
    if (this.stopRequested) return;

    // Master RTMPS Muxer stays connected to YouTube 24/7 across all songs
    const muxArgs = [
      '-fflags',
      '+genpts',
      '-f',
      'mpegts',
      '-i',
      'pipe:0',
      '-c:v',
      'copy',
      '-c:a',
      'copy',
      '-bsf:a',
      'aac_adtstoasc',
      ...this.getOutputTargetArgs(),
    ];

    const muxer = spawn('ffmpeg', muxArgs, { shell: false, stdio: ['pipe', 'ignore', 'pipe'] });
    this.muxerProc = muxer;

    let stderrTail = '';
    muxer.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-1400);
      this.parseFfmpegTelemetry(text, 'muxer');
    });

    muxer.stdin?.on('error', () => {
      // Handled by muxer close listener
    });

    muxer.on('close', () => {
      if (this.muxerProc !== muxer) return;
      this.muxerProc = null;

      const worker = this.workerProc;
      this.workerProc = null;
      this.killProc(worker);

      if (this.stopRequested) return;

      this.lastError = this.sanitizeFfmpegError(stderrTail);
      if (this.config.autoReconnect) {
        this.state = 'reconnecting';
        this.reconnectAttempts += 1;
        this.cumulativeTsOffsetSec = 0;
        this.emitStatus();
        const delayMs = Math.min(15000, 2500 * Math.min(this.reconnectAttempts, 5));
        this.reconnectTimer = setTimeout(() => {
          if (!this.stopRequested) {
            this.startAutonomousPipeline();
          }
        }, delayMs);
      } else {
        this.state = 'error';
        this.emitStatus();
      }
    });

    this.launchNextPipelineItem();
  }

  private launchNextPipelineItem(): void {
    if (this.config.mode === 'video-24-7') {
      this.launchNextVideoFile();
    } else {
      void this.launchNextAutonomousTrackAsync();
    }
  }

  private launchNextVideoFile(): void {
    if (this.stopRequested || !this.muxerProc) return;
    const videos = this.videoStore.getAll();
    if (videos.length === 0) {
      this.lastError = 'Video queue is empty. Broadcast stopped.';
      this.stopInternal(false);
      this.state = 'error';
      this.emitStatus();
      return;
    }

    if (this.currentTrackIndex >= videos.length) {
      this.currentTrackIndex = 0;
      this.loopCount += 1;
    }

    const video = videos[this.currentTrackIndex];
    const videoPath = resolveSafeAssetPath(video.videoUrl);

    if (!videoPath) {
      this.currentTrackIndex = (this.currentTrackIndex + 1) % videos.length;
      if (videos.length === 1) {
        this.lastError = 'Uploaded video file is missing on server.';
        this.stopInternal(false);
        this.state = 'error';
        this.emitStatus();
        return;
      }
      setTimeout(() => this.launchNextVideoFile(), 250);
      return;
    }

    this.currentTrackId = video.id;
    this.currentTrackTitle = video.title;
    this.workerStartedAt = Date.now();
    this.emitStatus();

    const args = this.buildVideoWorkerMpegTsArgs(video, videoPath, this.cumulativeTsOffsetSec);
    const worker = spawn('ffmpeg', args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    this.workerProc = worker;

    let workerStderr = '';
    let workerProducedBytes = false;
    worker.stdout?.on('data', (chunk: Buffer) => {
      if (!workerProducedBytes && chunk.length > 0) {
        workerProducedBytes = true;
        this.consecutiveWorkerFailures = 0;
      }
      const stdin = this.muxerProc?.stdin;
      if (stdin && !stdin.destroyed && stdin.writable) {
        stdin.write(chunk);
      }
    });

    worker.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      workerStderr = (workerStderr + text).slice(-1200);
      this.parseFfmpegTelemetry(text, 'worker');
    });

    worker.on('close', (code) => {
      if (this.workerProc !== worker) return;
      this.workerProc = null;
      if (this.stopRequested || !this.muxerProc) return;

      const elapsed = Math.max(1, (Date.now() - this.workerStartedAt) / 1000);
      this.cumulativeTsOffsetSec += Math.max(video.durationSec || elapsed, elapsed) + 0.05;

      if (code === 0) {
        this.reconnectAttempts = 0;
        this.consecutiveWorkerFailures = 0;
        const nextIdx = this.currentTrackIndex + 1;
        if (nextIdx >= videos.length) {
          this.loopCount += 1;
          if (this.config.queueEndBehavior === 'stop-after-queue') {
            this.finishStreamCleanly('queue-completed');
            return;
          }
          this.currentTrackIndex = 0;
        } else {
          this.currentTrackIndex = nextIdx;
        }
        this.launchNextVideoFile();
      } else {
        this.consecutiveWorkerFailures += 1;
        this.lastError = this.sanitizeFfmpegError(workerStderr);
        if (this.consecutiveWorkerFailures >= Math.max(3, videos.length)) {
          this.stopInternal(false);
          this.stopReason = 'error';
          this.state = 'error';
          this.emitStatus();
          return;
        }
        if (
          this.config.queueEndBehavior === 'stop-after-queue' &&
          this.currentTrackIndex + 1 >= videos.length
        ) {
          this.finishStreamCleanly('queue-completed');
          return;
        }
        this.currentTrackIndex = (this.currentTrackIndex + 1) % videos.length;
        setTimeout(() => this.launchNextVideoFile(), 300);
      }
    });
  }

  private buildVideoWorkerMpegTsArgs(
    video: VideoItem,
    videoPath: string,
    tsOffsetSec: number
  ): string[] {
    const encodeMode: VideoEncodeMode = this.config.videoEncodeMode || 'safe-encode';
    const shield: VideoShieldSettings = this.config.videoShield || DEFAULT_VIDEO_SHIELD;
    const shieldActive = isVideoShieldActive(shield);
    const fps = this.config.fps;
    const [w, h] = this.config.resolution === '1920x1080' ? [1920, 1080] : [1280, 720];
    const gop = fps * 2;
    const canCopyVideo =
      encodeMode === 'direct-copy' &&
      !shieldActive &&
      video.videoCodec.toLowerCase() === 'h264';

    if (canCopyVideo) {
      if (video.hasAudio) {
        const audioArgs =
          video.audioCodec.toLowerCase() === 'aac'
            ? ['-c:a', 'copy']
            : ['-c:a', 'aac', '-b:a', `${this.config.audioBitrateKbps}k`, '-ar', '44100', '-ac', '2'];
        return [
          '-re',
          '-i',
          videoPath,
          '-map',
          '0:v:0',
          '-map',
          '0:a:0',
          '-c:v',
          'copy',
          '-bsf:v',
          'h264_mp4toannexb',
          ...audioArgs,
          '-output_ts_offset',
          tsOffsetSec.toFixed(2),
          '-f',
          'mpegts',
          'pipe:1',
        ];
      }
      return [
        '-re',
        '-i',
        videoPath,
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=44100:cl=stereo',
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:v',
        'copy',
        '-bsf:v',
        'h264_mp4toannexb',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-ar',
        '44100',
        '-ac',
        '2',
        '-shortest',
        '-output_ts_offset',
        tsOffsetSec.toFixed(2),
        '-f',
        'mpegts',
        'pipe:1',
      ];
    }

    // Build Content-ID / Transform Shield filtergraph
    const speedFactor = clamp(shield.speedFactor || 1.0, 0.94, 1.08);
    const pitchFactor = clamp(1 + (shield.audioPitchShiftPct || 0) / 100, 0.92, 1.08);
    const zoomAmp = clamp((shield.zoomIntensityPct || 10) / 100, 0.04, 0.16);
    const hueDeg = clamp(shield.hueShiftDeg || 0, -25, 25);
    const bassDb = clamp(shield.bassBoomDb || 0, 0, 12);
    const safeWatermark = sanitizeWatermarkText(shield.watermarkText || '');
    const fontArg = this.fontPath ? `fontfile=${this.fontPath}:` : '';

    const baseSteps = [
      'setpts=PTS-STARTPTS',
      ...(shield.mirrorFlip ? ['hflip'] : []),
      `fps=${fps}`,
      `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=#08090d`,
      'setsar=1',
    ];

    const filterParts: string[] = [];
    filterParts.push(`[0:v]${baseSteps.join(',')}[vbase]`);

    if (shield.ambientPipFrame) {
      const fgW = Math.floor((w * 0.88) / 2) * 2;
      const fgH = Math.floor((h * 0.88) / 2) * 2;
      filterParts.push(`[vbase]split[vbg_src][vfg_src]`);
      filterParts.push(
        `[vbg_src]crop=iw*0.86:ih*0.86,scale=${w}:${h}:flags=fast_bilinear,boxblur=16:2,eq=brightness=-0.14:saturation=1.2[vbg]`
      );
      if (shield.zoomPulse) {
        filterParts.push(
          `[vfg_src]zoompan=z='1+${zoomAmp.toFixed(3)}*(0.5-0.5*cos(on*2*PI/(6*${fps})))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${fgW}x${fgH}:fps=${fps}[vfg]`
        );
      } else {
        filterParts.push(`[vfg_src]scale=${fgW}:${fgH}:flags=bilinear[vfg]`);
      }
      filterParts.push(`[vbg][vfg]overlay=(W-w)/2:(H-h)/2[vcomp]`);
    } else if (shield.zoomPulse) {
      filterParts.push(
        `[vbase]zoompan=z='1+${zoomAmp.toFixed(3)}*(0.5-0.5*cos(on*2*PI/(6*${fps})))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}:fps=${fps}[vcomp]`
      );
    } else {
      filterParts.push(`[vbase]null[vcomp]`);
    }

    const postVSteps: string[] = [];
    if (shield.colorShift) {
      postVSteps.push(`eq=contrast=1.06:saturation=1.14`, `hue=h=${hueDeg}`);
    }
    if (safeWatermark) {
      const margin = Math.round((w / 1280) * 24);
      const fontSz = Math.round((w / 1280) * 22);
      const posExpr =
        shield.watermarkPos === 'top-left'
          ? `x=${margin}:y=${margin}`
          : shield.watermarkPos === 'bottom-right'
            ? `x=w-tw-${margin}:y=h-th-${margin}`
            : `x=w-tw-${margin}:y=${margin}`;
      postVSteps.push(
        `drawtext=${fontArg}text='${safeWatermark}':${posExpr}:fontsize=${fontSz}:fontcolor=0xffffff@0.92:box=1:boxcolor=0x000000@0.55:boxborderw=8`
      );
    }
    if (Math.abs(speedFactor - 1) > 0.005) {
      postVSteps.push(`setpts=PTS/${speedFactor.toFixed(2)}`);
    }
    postVSteps.push('format=yuv420p');
    filterParts.push(`[vcomp]${postVSteps.join(',')}[vout]`);

    if (video.hasAudio) {
      const aSteps: string[] = ['aresample=44100'];
      if (Math.abs(pitchFactor - 1) > 0.002) {
        aSteps.push(`asetrate=${Math.round(44100 * pitchFactor)}`, 'aresample=44100');
      }
      const tempoFactor = clamp(speedFactor / pitchFactor, 0.82, 1.25);
      if (Math.abs(tempoFactor - 1) > 0.002) {
        aSteps.push(`atempo=${tempoFactor.toFixed(4)}`);
      }
      if (bassDb > 0) {
        aSteps.push(`bass=g=${bassDb}:f=75:w=0.6`);
      }
      if (shield.stereoWiden) {
        aSteps.push('extrastereo=m=1.35');
      }
      if (bassDb > 0 || shield.stereoWiden) {
        aSteps.push('acompressor=threshold=-14dB:ratio=3');
      }
      filterParts.push(`[0:a]${aSteps.join(',')}[aout]`);

      return [
        '-re',
        '-i',
        videoPath,
        '-filter_complex',
        filterParts.join(';'),
        '-map',
        '[vout]',
        '-map',
        '[aout]',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-r',
        String(fps),
        '-g',
        String(gop),
        '-keyint_min',
        String(gop),
        '-sc_threshold',
        '0',
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
        '-output_ts_offset',
        tsOffsetSec.toFixed(2),
        '-f',
        'mpegts',
        'pipe:1',
      ];
    }

    return [
      '-re',
      '-i',
      videoPath,
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=44100:cl=stereo',
      '-filter_complex',
      filterParts.join(';'),
      '-map',
      '[vout]',
      '-map',
      '1:a:0',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(fps),
      '-g',
      String(gop),
      '-keyint_min',
      String(gop),
      '-sc_threshold',
      '0',
      '-b:v',
      `${this.config.videoBitrateKbps}k`,
      '-maxrate',
      `${this.config.videoBitrateKbps}k`,
      '-bufsize',
      `${this.config.videoBitrateKbps * 2}k`,
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-shortest',
      '-output_ts_offset',
      tsOffsetSec.toFixed(2),
      '-f',
      'mpegts',
      'pipe:1',
    ];
  }

  private launchNextAutonomousTrack(): void {
    void this.launchNextAutonomousTrackAsync();
  }

  private async launchNextAutonomousTrackAsync(): Promise<void> {
    if (this.stopRequested || !this.muxerProc) return;
    const tracks = this.store.getAll();
    if (tracks.length === 0) {
      this.lastError = 'Playlist is empty. Broadcast stopped.';
      this.stopInternal(false);
      this.state = 'error';
      this.emitStatus();
      return;
    }

    if (this.currentTrackIndex >= tracks.length) {
      this.currentTrackIndex = 0;
      this.loopCount += 1;
    }

    const track = tracks[this.currentTrackIndex];
    const nextTrack = tracks.length > 1 ? tracks[(this.currentTrackIndex + 1) % tracks.length] : null;
    const audioPath = resolveSafeAssetPath(track.audioUrl);
    const coverPath = resolveSafeAssetPath(track.coverUrl);

    if (!audioPath || !coverPath) {
      this.currentTrackIndex = (this.currentTrackIndex + 1) % tracks.length;
      if (tracks.length === 1) {
        this.lastError = 'Track audio or cover file missing on server.';
        this.stopInternal(false);
        this.state = 'error';
        this.emitStatus();
        return;
      }
      setTimeout(() => this.launchNextAutonomousTrack(), 250);
      return;
    }

    this.currentTrackId = track.id;
    this.currentTrackTitle = track.title;
    this.workerStartedAt = Date.now();
    this.emitStatus();

    let bundle: GlassRenderBundle | null = null;
    try {
      bundle = await generateGlassRenderBundle({
        track,
        nextTrack,
        trackIndex: this.currentTrackIndex,
        totalTracks: tracks.length,
        coverPath,
        resolution: this.config.resolution,
        visuals: this.config.visuals,
        dryRun: this.config.dryRun,
      });
    } catch (err) {
      console.error('Glass frame generation failed:', err);
      bundle = null;
    }

    if (this.stopRequested || !this.muxerProc) {
      cleanupGlassRenderBundle(bundle?.dir);
      return;
    }

    if (!bundle) {
      this.consecutiveWorkerFailures += 1;
      this.lastError = 'Failed to compose glassmorphic frame for track.';
      if (this.consecutiveWorkerFailures >= Math.max(3, tracks.length)) {
        this.stopInternal(false);
        this.state = 'error';
        this.emitStatus();
        return;
      }
      this.currentTrackIndex = (this.currentTrackIndex + 1) % tracks.length;
      setTimeout(() => this.launchNextAutonomousTrack(), 300);
      return;
    }

    const args = this.buildWorkerMpegTsArgs(track, audioPath, bundle, this.cumulativeTsOffsetSec);
    const worker = spawn('ffmpeg', args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    this.workerProc = worker;

    let workerStderr = '';
    let workerProducedBytes = false;
    worker.stdout?.on('data', (chunk: Buffer) => {
      if (!workerProducedBytes && chunk.length > 0) {
        workerProducedBytes = true;
        this.consecutiveWorkerFailures = 0;
      }
      const stdin = this.muxerProc?.stdin;
      if (stdin && !stdin.destroyed && stdin.writable) {
        stdin.write(chunk);
      }
    });

    worker.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      workerStderr = (workerStderr + text).slice(-1200);
      this.parseFfmpegTelemetry(text, 'worker');
    });

    worker.on('close', (code) => {
      cleanupGlassRenderBundle(bundle?.dir);
      if (this.workerProc !== worker) return;
      this.workerProc = null;
      if (this.stopRequested || !this.muxerProc) return;

      const elapsed = Math.max(1, (Date.now() - this.workerStartedAt) / 1000);
      this.cumulativeTsOffsetSec += Math.max(track.durationSec || elapsed, elapsed) + 0.05;

      if (code === 0) {
        this.reconnectAttempts = 0;
        this.consecutiveWorkerFailures = 0;
        const nextIdx = this.currentTrackIndex + 1;
        if (nextIdx >= tracks.length) {
          this.loopCount += 1;
          this.currentTrackIndex = 0;
        } else {
          this.currentTrackIndex = nextIdx;
        }
        this.launchNextAutonomousTrack();
      } else {
        this.consecutiveWorkerFailures += 1;
        this.lastError = this.sanitizeFfmpegError(workerStderr);
        if (this.consecutiveWorkerFailures >= Math.max(3, tracks.length)) {
          this.stopInternal(false);
          this.state = 'error';
          this.emitStatus();
          return;
        }
        // Track decode failure — skip to next track without dropping YouTube stream!
        this.currentTrackIndex = (this.currentTrackIndex + 1) % tracks.length;
        setTimeout(() => this.launchNextAutonomousTrack(), 300);
      }
    });
  }

  private buildWorkerMpegTsArgs(
    track: PhonkTrack,
    audioPath: string,
    bundle: GlassRenderBundle,
    tsOffsetSec: number
  ): string[] {
    const {
      w,
      specX,
      specY,
      specW,
      specH,
      progX,
      progY,
      progW,
      timeX,
      timeY,
      timeFontSize,
      knobSize,
      knobY,
      visualizerStyle,
    } = bundle.layout;
    const s = w / 1280;
    const maskTop = Math.max(0, progY - Math.round(8 * s));
    const dur = Math.max(1, Math.round(track.durationSec || 60));
    const accentHex = track.palette.accent.replace('#', '0x');
    const primaryHex = track.palette.primary.replace('#', '0x');
    const fontArg = this.fontPath ? `fontfile=${this.fontPath}:` : '';

    const spectrumFilter =
      visualizerStyle === 'mirror'
        ? `[5:a]showfreqs=s=${specW}x${Math.max(20, Math.floor(specH / 2))}:mode=bar:fscale=log:colors=${accentHex}|${primaryHex},fps=${this.config.fps},split[spt][spb];[spb]vflip[spbf];[spt][spbf]vstack[spec_raw]`
        : `[5:a]showfreqs=s=${specW}x${specH}:mode=bar:fscale=log:colors=${accentHex}|${primaryHex},fps=${this.config.fps}[spec_raw]`;

    const knobOffset = Math.round(knobSize / 2);
    const filters = [
      spectrumFilter,
      `[0:v][spec_raw]overlay=${specX}:${specY}[with_spec]`,
      `[with_spec][1:v]overlay=${specX}:${specY}[with_bars]`,
      `[with_bars][2:v]overlay=x='${progX}-${progW}+trunc(${progW}*min(1\\,t/${dur}))':y=${progY}[with_prog]`,
      `[with_prog][3:v]overlay=x=0:y=${maskTop}[with_prog_masked]`,
      `[with_prog_masked][4:v]overlay=x='${progX}+trunc(${progW}*min(1\\,t/${dur}))-${knobOffset}':y=${knobY}[with_knob]`,
      `[with_knob]drawtext=${fontArg}text='%{eif\\:trunc(t/60)\\:d\\:2}\\:%{eif\\:mod(trunc(t)\\,60)\\:d\\:2}':x=${timeX}:y=${timeY}:fontsize=${timeFontSize}:fontcolor=0xffffff,format=yuv420p[vout]`,
    ].join(';');

    const gop = this.config.fps * 2;
    return [
      '-re',
      '-framerate',
      String(this.config.fps),
      '-loop',
      '1',
      '-i',
      bundle.stagePath,
      '-i',
      bundle.specOverlayPath,
      '-i',
      bundle.barFillPath,
      '-i',
      bundle.dockLeftMaskPath,
      '-i',
      bundle.knobPath,
      '-re',
      '-i',
      audioPath,
      '-filter_complex',
      filters,
      '-map',
      '[vout]',
      '-map',
      '5:a',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-tune',
      'stillimage',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(this.config.fps),
      '-g',
      String(gop),
      '-keyint_min',
      String(gop),
      '-sc_threshold',
      '0',
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
      '-output_ts_offset',
      tsOffsetSec.toFixed(2),
      '-f',
      'mpegts',
      'pipe:1',
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
      'superfast',
      '-tune',
      'zerolatency',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(this.config.fps),
      '-g',
      String(gop),
      '-keyint_min',
      String(gop),
      '-sc_threshold',
      '0',
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
      stderrTail = (stderrTail + text).slice(-1400);
      this.parseFfmpegTelemetry(text, 'relay');
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

  private parseFfmpegTelemetry(text: string, source: 'muxer' | 'worker' | 'relay'): void {
    if (this.stopRequested || this.state === 'idle') return;
    const frameMatch = text.match(/frame=\s*(\d+)/);
    const fpsMatch = text.match(/fps=\s*([\d.]+)/);
    const bitrateMatch = text.match(/bitrate=\s*([\d.]+)kbits\/s/);
    if (!frameMatch && !fpsMatch && !bitrateMatch) return;

    let changed = false;
    if (fpsMatch) {
      const parsedFps = Math.round(Number.parseFloat(fpsMatch[1]));
      if (parsedFps > 0 && parsedFps !== this.measuredFps) {
        this.measuredFps = parsedFps;
        changed = true;
      }
    }
    if (bitrateMatch) {
      const parsedBr = Math.round(Number.parseFloat(bitrateMatch[1]));
      if (parsedBr > 0 && parsedBr !== this.measuredBitrateKbps) {
        this.measuredBitrateKbps = parsedBr;
        changed = true;
      }
    }

    const canConfirmLive = this.config.dryRun ? true : source !== 'worker';
    const hasFrames = (frameMatch && Number.parseInt(frameMatch[1], 10) >= 2) || this.measuredBitrateKbps > 0 || this.measuredFps > 0;
    if (canConfirmLive && hasFrames && this.state !== 'live') {
      this.state = 'live';
      this.lastError = null;
      changed = true;
    }

    if (changed) {
      this.emitStatus();
    }
  }

  private sanitizeFfmpegError(raw: string): string {
    let cleaned = raw;
    if (this.streamKey) {
      cleaned = cleaned.split(this.streamKey).join('***');
    }
    if (/Error in the pull function|Input\/output error|End of file|Broken pipe|NetStream\.Publish/i.test(cleaned) && /rtmps?:\/\//i.test(cleaned)) {
      return 'YouTube rejected or closed the RTMPS stream. Make sure YouTube Studio -> Go Live is open and your Stream Key matches.';
    }
    if (/Connection timed out/i.test(cleaned)) {
      return 'RTMP connection timed out. Use rtmps://a.rtmps.youtube.com:443/live2 (Port 443 RTMPS).';
    }
    const lines = cleaned
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const errLine = [...lines].reverse().find((l) => /error|failed|refused|timed out|invalid|not found/i.test(l));
    return errLine ? errLine.slice(0, 180) : 'FFmpeg broadcast stream disconnected.';
  }
}
