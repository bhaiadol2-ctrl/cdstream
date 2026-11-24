import {
  CheckCircle2,
  Film,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Plus,
  Radio,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  computeProgressPercent,
  formatFileSize,
  formatTimeMMSS,
  formatUptimeHHMMSS,
  isVideoShieldActive,
  sanitizeWatermarkText,
  type StreamStatus,
  type VideoItem,
  type VideoShieldSettings,
} from '../lib/phonkLogic';

interface VideoLiveStageProps {
  currentVideo: VideoItem | null;
  nextVideo: VideoItem | null;
  videoIndex: number;
  totalVideos: number;
  isPlaying: boolean;
  streamStatus: StreamStatus;
  shield: VideoShieldSettings;
  onTogglePlay: (playing: boolean) => void;
  onNext: () => void;
  onPrevious: () => void;
  onOpenAddModal: () => void;
}

export function VideoLiveStage({
  currentVideo,
  nextVideo,
  videoIndex,
  totalVideos,
  isPlaying,
  streamStatus,
  shield,
  onTogglePlay,
  onNext,
  onPrevious,
  onOpenAddModal,
}: VideoLiveStageProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    setElapsedSec(0);
    setDurationSec(currentVideo?.durationSec || 0);
  }, [currentVideo?.id, currentVideo?.durationSec]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !currentVideo) return;
    el.playbackRate = shield.speedFactor || 1;
    if (isPlaying) {
      el.play().catch(() => {
        el.muted = true;
        setMuted(true);
        el.play().catch(() => {
          onTogglePlay(false);
        });
      });
    } else {
      el.pause();
    }
  }, [currentVideo?.id, isPlaying, onTogglePlay, shield.speedFactor]);

  const toggleFullscreen = async () => {
    if (!stageRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await stageRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore fullscreen denial in restricted iframes
    }
  };

  const handleSeek = (sec: number) => {
    setElapsedSec(sec);
    if (videoRef.current && Number.isFinite(sec)) {
      videoRef.current.currentTime = sec;
    }
  };

  const handleToggleMute = () => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    if (videoRef.current) {
      videoRef.current.muted = nextMuted;
    }
  };

  const effectiveDuration = Math.max(1, durationSec || currentVideo?.durationSec || 1);
  const progressPct = computeProgressPercent(elapsedSec, effectiveDuration);
  const remainingSec = Math.max(0, effectiveDuration - elapsedSec);
  const isLive = streamStatus.state === 'live';
  const shieldActive = isVideoShieldActive(shield);
  const safeWatermark = sanitizeWatermarkText(shield.watermarkText || '');

  const videoCssFilter = shield.colorShift
    ? `contrast(1.06) saturate(1.14) hue-rotate(${shield.hueShiftDeg}deg)`
    : undefined;

  const zoomPeak = (1 + (shield.zoomIntensityPct || 10) / 100).toFixed(2);
  const videoContainerStyle: CSSProperties = {
    transform: shield.mirrorFlip ? 'scaleX(-1)' : undefined,
    filter: videoCssFilter,
  };
  const zoomStyle: CSSProperties = shield.zoomPulse
    ? ({ '--shield-zoom-peak': zoomPeak } as CSSProperties)
    : {};

  return (
    <section aria-label="Direct Video Live Screen" className="w-full">
      <div
        ref={stageRef}
        data-testid="video-live-stage"
        className="relative flex min-h-[410px] w-full flex-col justify-between overflow-hidden rounded-2xl border border-white/15 bg-[#08090d] shadow-2xl sm:min-h-0 sm:aspect-video"
      >
        {/* Ambient Blur Frame Backdrop when Ambient PIP Frame is enabled */}
        {currentVideo && shield.ambientPipFrame && (
          <img
            src={currentVideo.thumbnailUrl}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-55 blur-2xl saturate-150 brightness-50"
          />
        )}

        {/* Main Video Layer */}
        {currentVideo ? (
          <div
            className={`absolute inset-0 flex items-center justify-center overflow-hidden ${
              shield.ambientPipFrame ? 'p-4 sm:p-7' : ''
            }`}
          >
            <div
              style={videoContainerStyle}
              className={`relative h-full w-full overflow-hidden ${
                shield.ambientPipFrame
                  ? 'rounded-xl border border-white/20 bg-black shadow-2xl'
                  : 'bg-black'
              }`}
            >
              <video
                ref={videoRef}
                key={currentVideo.id}
                src={currentVideo.videoUrl}
                poster={currentVideo.thumbnailUrl}
                playsInline
                muted={muted}
                preload="metadata"
                style={zoomStyle}
                onLoadedMetadata={(e) => {
                  const vid = e.currentTarget;
                  vid.playbackRate = shield.speedFactor || 1;
                  if (Number.isFinite(vid.duration) && vid.duration > 0) {
                    setDurationSec(vid.duration);
                  }
                }}
                onTimeUpdate={(e) => {
                  setElapsedSec(e.currentTarget.currentTime);
                }}
                onEnded={() => {
                  if (totalVideos > 1) {
                    onNext();
                  } else if (streamStatus.queueEndBehavior !== 'stop-after-queue' && videoRef.current) {
                    videoRef.current.currentTime = 0;
                    videoRef.current.play().catch(() => undefined);
                  } else {
                    onTogglePlay(false);
                  }
                }}
                onClick={() => onTogglePlay(!isPlaying)}
                className={`h-full w-full cursor-pointer object-contain ${
                  shield.zoomPulse ? 'shield-zoom-pulse' : ''
                }`}
              />
            </div>

            {/* Optional Custom Channel Watermark Overlay */}
            {safeWatermark && (
              <div
                aria-label="Stream watermark preview"
                className={`pointer-events-none absolute z-10 rounded-md border border-white/15 bg-black/60 px-2.5 py-1 font-display text-xs font-semibold text-white backdrop-blur-md ${
                  shield.watermarkPos === 'top-left'
                    ? 'top-14 left-5 sm:top-16 sm:left-8'
                    : shield.watermarkPos === 'bottom-right'
                      ? 'right-5 bottom-28 sm:right-8 sm:bottom-28'
                      : 'top-14 right-5 sm:top-16 sm:right-8'
                }`}
              >
                {safeWatermark}
              </div>
            )}
          </div>
        ) : (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 28% 35%, rgba(212, 38, 56, 0.22) 0%, transparent 56%), linear-gradient(180deg, #12141c 0%, #08090d 100%)',
            }}
          />
        )}

        {/* Top Status Bar Overlay */}
        <div className="pointer-events-none relative z-20 flex items-center justify-between bg-gradient-to-b from-black/80 via-black/35 to-transparent px-4 pt-3.5 pb-6 sm:px-6 sm:pt-4">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2.5 text-xs font-medium text-zinc-200/95">
            <span className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-black/55 px-2.5 py-1 backdrop-blur-md">
              {isLive && (
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
              )}
              <Radio className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="font-mono-tabular tracking-wide">
                {isLive
                  ? streamStatus.dryRun
                    ? `TEST LIVE · ${formatUptimeHHMMSS(streamStatus.uptimeSec)}`
                    : `YOUTUBE LIVE · ${formatUptimeHHMMSS(streamStatus.uptimeSec)}`
                  : streamStatus.queueEndBehavior === 'stop-after-queue'
                    ? 'PLAY ONCE · AUTO-STOP'
                    : '24/7 VIDEO LOOP'}
              </span>
            </span>

            {shieldActive && (
              <span className="hidden md:inline-flex items-center gap-1.5 text-emerald-300/95 drop-shadow">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Shield Active</span>
              </span>
            )}

            {currentVideo && (
              <span className="hidden sm:inline font-mono-tabular text-zinc-300/90 drop-shadow">
                Video {videoIndex + 1} of {totalVideos} · {currentVideo.width}×{currentVideo.height} ·{' '}
                {formatFileSize(currentVideo.fileSizeBytes)}
              </span>
            )}
          </div>

          <div className="pointer-events-auto flex items-center gap-2">
            {currentVideo && (
              <button
                type="button"
                onClick={handleToggleMute}
                aria-label={muted ? 'Unmute video preview' : 'Mute video preview'}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-black/50 text-zinc-200 backdrop-blur-md transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
              >
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              aria-label={isFullscreen ? 'Exit fullscreen video stage' : 'Expand video stage fullscreen'}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-black/50 text-zinc-200 backdrop-blur-md transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Center Empty State or Queue Completion Notice */}
        {!currentVideo ? (
          <div className="relative z-20 flex flex-1 items-center justify-center px-4 py-4">
            <div className="flex w-full max-w-lg flex-col items-center justify-center rounded-2xl border border-white/15 bg-black/55 p-7 text-center backdrop-blur-xl">
              <Film className="h-10 w-10 text-zinc-300" />
              <h2 className="mt-3 font-display text-xl font-semibold text-white">
                Upload Videos or Movies to Go Live
              </h2>
              <p className="mt-1.5 text-xs text-zinc-300 leading-relaxed">
                Select one or multiple videos at once. Built-in Zoom Pulse, Mirror Flip, Ambient Frame, and Bass Boom filters apply live on YouTube.
              </p>
              <button
                type="button"
                onClick={onOpenAddModal}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-zinc-950 transition-colors hover:bg-zinc-200"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Upload Videos</span>
              </button>
            </div>
          </div>
        ) : (
          (streamStatus.stopReason === 'queue-completed' ||
            streamStatus.stopReason === 'timer-completed') &&
          streamStatus.state === 'idle' && (
            <div className="pointer-events-none relative z-20 flex justify-center px-4">
              <div
                data-testid="stream-auto-stopped-banner"
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-950/80 px-3.5 py-2 text-xs font-medium text-emerald-200 backdrop-blur-md"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span>
                  {streamStatus.stopReason === 'queue-completed'
                    ? 'All videos finished — stream automatically stopped in both App and YouTube.'
                    : 'Scheduled timer reached — stream automatically stopped in both App and YouTube.'}
                </span>
              </div>
            </div>
          )
        )}

        {/* Bottom Transport Dock */}
        <div className="relative z-20 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-4 pt-6 pb-3.5 sm:px-6 sm:pb-4">
          <div className="mx-auto max-w-4xl rounded-xl border border-white/15 bg-black/60 px-3.5 py-2.5 backdrop-blur-xl sm:px-4">
            {currentVideo && (
              <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                <span data-testid="live-video-title" className="truncate font-semibold text-white">
                  {currentVideo.title}
                </span>
                {isLive && streamStatus.currentTrackTitle && (
                  <span className="hidden sm:inline shrink-0 font-mono-tabular text-[11px] text-emerald-400">
                    On Air: {streamStatus.currentTrackTitle}
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center gap-3">
              <span
                data-testid="video-elapsed-time"
                className="font-mono-tabular text-xs font-semibold text-white sm:text-sm"
              >
                {formatTimeMMSS(elapsedSec)}
              </span>

              <div className="relative flex-1">
                <input
                  type="range"
                  aria-label="Seek video position"
                  min={0}
                  max={effectiveDuration}
                  step={0.5}
                  value={Math.min(elapsedSec, effectiveDuration)}
                  onChange={(e) => handleSeek(Number(e.target.value))}
                  disabled={!currentVideo}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-white"
                  style={{
                    background: `linear-gradient(90deg, #ff4d5a ${progressPct}%, rgba(255,255,255,0.16) ${progressPct}%)`,
                  }}
                />
              </div>

              <span
                data-testid="video-total-time"
                className="font-mono-tabular text-xs font-medium text-zinc-300 sm:text-sm"
              >
                {formatTimeMMSS(durationSec)}
              </span>
            </div>

            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onPrevious}
                  disabled={totalVideos === 0}
                  aria-label="Previous video"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-200 transition-colors hover:bg-white/10 disabled:opacity-40"
                >
                  <SkipBack className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onTogglePlay(!isPlaying)}
                  disabled={!currentVideo}
                  aria-label={isPlaying ? 'Pause video preview' : 'Play video preview'}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-zinc-950 transition-transform active:scale-95 disabled:opacity-40"
                >
                  {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  <span>{isPlaying ? 'Pause' : 'Play'}</span>
                </button>
                <button
                  type="button"
                  onClick={onNext}
                  disabled={totalVideos === 0}
                  aria-label="Next video"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-200 transition-colors hover:bg-white/10 disabled:opacity-40"
                >
                  <SkipForward className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center gap-2.5 truncate text-xs text-zinc-300/90">
                {currentVideo && (
                  <span className="font-mono-tabular hidden sm:inline">
                    -{formatTimeMMSS(remainingSec)} left
                  </span>
                )}
                {nextVideo && (
                  <>
                    <span aria-hidden="true" className="hidden sm:inline text-zinc-500">
                      ·
                    </span>
                    <span className="max-w-[160px] truncate sm:max-w-[240px]">
                      Up Next: <strong className="font-medium text-white">{nextVideo.title}</strong>
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
