import {
  Film,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Plus,
  Radio,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  computeProgressPercent,
  formatFileSize,
  formatTimeMMSS,
  formatUptimeHHMMSS,
  type StreamStatus,
  type VideoItem,
} from '../lib/phonkLogic';

interface VideoLiveStageProps {
  currentVideo: VideoItem | null;
  nextVideo: VideoItem | null;
  videoIndex: number;
  totalVideos: number;
  isPlaying: boolean;
  streamStatus: StreamStatus;
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
    if (isPlaying) {
      el.play().catch(() => {
        // Browser autoplay policy may block unmuted play prior to user interaction
        el.muted = true;
        setMuted(true);
        el.play().catch(() => {
          onTogglePlay(false);
        });
      });
    } else {
      el.pause();
    }
  }, [currentVideo?.id, isPlaying, onTogglePlay]);

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

  return (
    <section aria-label="Direct Video Live Screen" className="w-full">
      <div
        ref={stageRef}
        data-testid="video-live-stage"
        className="relative flex min-h-[410px] w-full flex-col justify-between overflow-hidden rounded-2xl border border-white/15 bg-[#08090d] shadow-2xl sm:min-h-0 sm:aspect-video"
      >
        {/* Real Video Backdrop / Player */}
        {currentVideo ? (
          <video
            ref={videoRef}
            key={currentVideo.id}
            src={currentVideo.videoUrl}
            poster={currentVideo.thumbnailUrl}
            playsInline
            muted={muted}
            preload="metadata"
            onLoadedMetadata={(e) => {
              const vid = e.currentTarget;
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
              } else if (videoRef.current) {
                videoRef.current.currentTime = 0;
                videoRef.current.play().catch(() => undefined);
              }
            }}
            onClick={() => onTogglePlay(!isPlaying)}
            className="absolute inset-0 h-full w-full cursor-pointer bg-black object-contain"
          />
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

        {/* Top Bar Overlay */}
        <div className="pointer-events-none relative z-10 flex items-center justify-between bg-gradient-to-b from-black/75 via-black/35 to-transparent px-4 pt-3.5 pb-6 sm:px-6 sm:pt-4">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2.5 text-xs font-medium text-zinc-200/95">
            <span className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-black/50 px-2.5 py-1 backdrop-blur-md">
              {isLive && (
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
              )}
              <Radio className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="font-mono-tabular tracking-wide">
                {isLive
                  ? streamStatus.dryRun
                    ? `TEST LIVE · ${formatUptimeHHMMSS(streamStatus.uptimeSec)}`
                    : `YOUTUBE LIVE · ${formatUptimeHHMMSS(streamStatus.uptimeSec)}`
                  : 'VIDEO LOOP PREVIEW'}
              </span>
            </span>

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
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-black/45 text-zinc-200 backdrop-blur-md transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
              >
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              aria-label={isFullscreen ? 'Exit fullscreen video stage' : 'Expand video stage fullscreen'}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-black/45 text-zinc-200 backdrop-blur-md transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Center Empty State or Play Hint */}
        {!currentVideo && (
          <div className="relative z-10 flex flex-1 items-center justify-center px-4 py-4">
            <div className="flex w-full max-w-lg flex-col items-center justify-center rounded-2xl border border-white/15 bg-black/50 p-7 text-center backdrop-blur-xl">
              <Film className="h-10 w-10 text-zinc-400" />
              <h2 className="mt-3 font-display text-xl font-semibold text-white">
                Upload a Big Video to Stream Live
              </h2>
              <p className="mt-1.5 text-xs text-zinc-300 leading-relaxed">
                Upload MP4, MKV, MOV, or WEBM videos directly. The broadcast server streams your exact video 24/7 to YouTube Live.
              </p>
              <button
                type="button"
                onClick={onOpenAddModal}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-zinc-950 transition-colors hover:bg-zinc-200"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Upload Big Video</span>
              </button>
            </div>
          </div>
        )}

        {/* Bottom Glassmorphic Progress & Transport Dock */}
        <div className="relative z-10 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-4 pt-6 pb-3.5 sm:px-6 sm:pb-4">
          <div className="mx-auto max-w-4xl rounded-xl border border-white/15 bg-black/55 px-3.5 py-2.5 backdrop-blur-xl sm:px-4">
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
