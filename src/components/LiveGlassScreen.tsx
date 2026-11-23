import {
  Disc3,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Radio,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  computeProgressPercent,
  formatTimeMMSS,
  formatUptimeHHMMSS,
  type PhonkTrack,
  type StreamStatus,
  type VisualSettings,
} from '../lib/phonkLogic';

interface LiveGlassScreenProps {
  currentTrack: PhonkTrack | null;
  nextTrack: PhonkTrack | null;
  trackIndex: number;
  totalTracks: number;
  isPlaying: boolean;
  elapsedSec: number;
  durationSec: number;
  bassEnergy: number;
  streamStatus: StreamStatus;
  visuals: VisualSettings;
  getFrequencyData: () => Uint8Array;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (sec: number) => void;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
}

export function LiveGlassScreen({
  currentTrack,
  nextTrack,
  trackIndex,
  totalTracks,
  isPlaying,
  elapsedSec,
  durationSec,
  bassEnergy,
  streamStatus,
  visuals,
  getFrequencyData,
  onTogglePlay,
  onNext,
  onPrevious,
  onSeek,
  onCanvasReady,
}: LiveGlassScreenProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const specCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const broadcastCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const coverImgRef = useRef<HTMLImageElement | null>(null);
  const [imgError, setImgError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Reset image error state when track changes
  useEffect(() => {
    setImgError(false);
    if (!currentTrack?.coverUrl) {
      coverImgRef.current = null;
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      coverImgRef.current = img;
    };
    img.onerror = () => {
      coverImgRef.current = null;
    };
    img.src = currentTrack.coverUrl;
  }, [currentTrack?.coverUrl]);

  useEffect(() => {
    onCanvasReady?.(broadcastCanvasRef.current);
    return () => onCanvasReady?.(null);
  }, [onCanvasReady]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

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

  // Draw live reactive spectrum visualizer + mirrored 1280x720 broadcast canvas
  useEffect(() => {
    let raf = 0;
    let phase = 0;

    const renderFrame = () => {
      phase += 0.02;
      const freq = getFrequencyData();

      // 1. Draw compact UI spectrum inside the glass card
      const uiCanvas = specCanvasRef.current;
      if (uiCanvas) {
        const ctx = uiCanvas.getContext('2d');
        if (ctx) {
          const w = uiCanvas.width;
          const h = uiCanvas.height;
          ctx.clearRect(0, 0, w, h);

          const accent = currentTrack?.palette.accent || '#ff4d5a';
          const primary = currentTrack?.palette.primary || '#d42638';
          const grad = ctx.createLinearGradient(0, h, 0, 0);
          grad.addColorStop(0, primary);
          grad.addColorStop(1, accent);
          ctx.fillStyle = grad;
          ctx.strokeStyle = accent;

          const bars = 40;
          if (visuals.visualizerStyle === 'ring') {
            const cx = w / 2;
            const cy = h / 2;
            const baseR = Math.min(w, h) * 0.28;
            ctx.lineWidth = 3;
            for (let i = 0; i < bars; i++) {
              const raw = isPlaying ? freq[i % freq.length] / 255 : 0.12 + 0.08 * Math.sin(phase * 2 + i * 0.4);
              const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
              const len = 6 + raw * (Math.min(w, h) * 0.2);
              ctx.beginPath();
              ctx.moveTo(cx + Math.cos(angle) * baseR, cy + Math.sin(angle) * baseR);
              ctx.lineTo(cx + Math.cos(angle) * (baseR + len), cy + Math.sin(angle) * (baseR + len));
              ctx.stroke();
            }
          } else {
            const gap = 4;
            const barW = Math.max(3, (w - gap * (bars - 1)) / bars);
            for (let i = 0; i < bars; i++) {
              const binIdx = Math.min(freq.length - 1, Math.floor((i / bars) * 38));
              const norm = isPlaying
                ? (freq[binIdx] || 0) / 255
                : 0.08 + 0.06 * Math.sin(phase * 1.8 + i * 0.35);
              const barH = Math.max(4, norm * (h - 6));
              const x = i * (barW + gap);
              if (visuals.visualizerStyle === 'mirror') {
                const y = (h - barH) / 2;
                ctx.beginPath();
                ctx.roundRect(x, y, barW, barH, 3);
                ctx.fill();
              } else {
                const y = h - barH;
                ctx.beginPath();
                ctx.roundRect(x, y, barW, barH, [3, 3, 0, 0]);
                ctx.fill();
              }
            }
          }
        }
      }

      // 2. Render 1280x720 offscreen broadcast canvas for Canvas Relay streaming mode
      const bCanvas = broadcastCanvasRef.current;
      if (bCanvas && streamStatus.mode === 'canvas-relay' && streamStatus.state !== 'idle') {
        const bctx = bCanvas.getContext('2d');
        if (bctx) {
          const bw = bCanvas.width;
          const bh = bCanvas.height;
          const pal = currentTrack?.palette;
          const accent = pal?.accent || '#ff4d5a';
          const primary = pal?.primary || '#d42638';
          bctx.fillStyle = pal?.secondary || '#0b0c12';
          bctx.fillRect(0, 0, bw, bh);

          // Blurred cover backdrop
          if (coverImgRef.current) {
            bctx.save();
            bctx.filter = `blur(${Math.max(18, visuals.glassBlurPx)}px) brightness(0.46) saturate(1.45)`;
            const scale = 1.12 + (visuals.bassPulse ? bassEnergy * 0.06 : 0);
            const dw = bw * scale;
            const dh = bh * scale;
            bctx.drawImage(coverImgRef.current, (bw - dw) / 2, (bh - dh) / 2, dw, dh);
            bctx.restore();
          }

          // Radial ambient glows + vignette matching DOM
          const g1 = bctx.createRadialGradient(bw * 0.28, bh * 0.35, 10, bw * 0.28, bh * 0.35, bw * 0.52);
          g1.addColorStop(0, pal?.glowRgba || 'rgba(212, 38, 56, 0.44)');
          g1.addColorStop(1, 'rgba(0,0,0,0)');
          bctx.fillStyle = g1;
          bctx.fillRect(0, 0, bw, bh);

          const vig = bctx.createLinearGradient(0, 0, 0, bh);
          vig.addColorStop(0, 'rgba(8,9,13,0.30)');
          vig.addColorStop(1, 'rgba(8,9,13,0.78)');
          bctx.fillStyle = vig;
          bctx.fillRect(0, 0, bw, bh);

          bctx.save();

          // Top Broadcast Badge + Track Counter
          if (visuals.showLiveBadge) {
            bctx.fillStyle = 'rgba(0,0,0,0.42)';
            bctx.strokeStyle = 'rgba(255,255,255,0.18)';
            bctx.lineWidth = 1.2;
            bctx.beginPath();
            bctx.roundRect(36, 24, 218, 32, 8);
            bctx.fill();
            bctx.stroke();

            bctx.fillStyle = '#ef4444';
            bctx.beginPath();
            bctx.arc(54, 40, 4.5, 0, Math.PI * 2);
            bctx.fill();

            bctx.fillStyle = '#f4f4f5';
            bctx.font = '700 13px "JetBrains Mono", monospace';
            const liveLabel = streamStatus.dryRun ? 'TEST LIVE' : 'YOUTUBE LIVE';
            bctx.fillText(`${liveLabel} · ${formatUptimeHHMMSS(streamStatus.uptimeSec)}`, 67, 45);
          }

          bctx.fillStyle = 'rgba(228,228,231,0.85)';
          bctx.font = '500 13px "JetBrains Mono", monospace';
          bctx.fillText(
            `Track ${trackIndex + 1} of ${Math.max(1, totalTracks)} · ${currentTrack?.bpm || 136} BPM`,
            visuals.showLiveBadge ? 270 : 36,
            45
          );

          // Frosted Glass Center Panel
          const cardW = 860;
          const cardH = 318;
          const cardX = (bw - cardW) / 2;
          const cardY = 138;

          bctx.fillStyle = pal?.glassBgRgba || 'rgba(12, 14, 20, 0.56)';
          bctx.strokeStyle = pal?.glassBorderRgba || 'rgba(255, 255, 255, 0.22)';
          bctx.lineWidth = 1.5;
          bctx.beginPath();
          bctx.roundRect(cardX, cardY, cardW, cardH, 22);
          bctx.fill();
          bctx.stroke();

          // Diagonal specular highlight sheen
          const sheen = bctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
          sheen.addColorStop(0, 'rgba(255,255,255,0.12)');
          sheen.addColorStop(0.45, 'rgba(255,255,255,0.02)');
          sheen.addColorStop(1, 'rgba(255,255,255,0.05)');
          bctx.fillStyle = sheen;
          bctx.beginPath();
          bctx.roundRect(cardX, cardY, cardW, cardH, 22);
          bctx.fill();

          // Rounded Album Artwork inside Glass Card
          const artSize = 238;
          const artX = cardX + 36;
          const artY = cardY + (cardH - artSize) / 2;
          const pulseScale = visuals.bassPulse ? 1 + bassEnergy * 0.04 : 1;
          const pulsedSize = artSize * pulseScale;
          const pArtX = artX - (pulsedSize - artSize) / 2;
          const pArtY = artY - (pulsedSize - artSize) / 2;

          bctx.save();
          bctx.beginPath();
          bctx.roundRect(pArtX, pArtY, pulsedSize, pulsedSize, 16);
          bctx.clip();
          if (coverImgRef.current) {
            bctx.drawImage(coverImgRef.current, pArtX, pArtY, pulsedSize, pulsedSize);
          } else {
            bctx.fillStyle = primary;
            bctx.fillRect(pArtX, pArtY, pulsedSize, pulsedSize);
          }
          bctx.restore();

          bctx.strokeStyle = 'rgba(255,255,255,0.26)';
          bctx.lineWidth = 1.5;
          bctx.beginPath();
          bctx.roundRect(pArtX, pArtY, pulsedSize, pulsedSize, 16);
          bctx.stroke();

          // Typography & spectrum inside glass card
          const tx = artX + artSize + 36;
          bctx.fillStyle = accent;
          bctx.font = '700 13px Outfit, sans-serif';
          bctx.fillText(`${(currentTrack?.subgenre || 'PHONK').toUpperCase()}  ·  24/7 LOOP`, tx, artY + 24);

          bctx.fillStyle = '#ffffff';
          bctx.font = '700 36px Outfit, sans-serif';
          bctx.fillText((currentTrack?.title || 'Waiting for Phonk Track').slice(0, 26), tx, artY + 68);

          bctx.fillStyle = 'rgba(244, 244, 245, 0.82)';
          bctx.font = '500 18px "Plus Jakarta Sans", sans-serif';
          bctx.fillText(currentTrack?.artist || 'Phonk Studio', tx, artY + 100);

          // Rounded dark spectrum tray matching DOM
          const specW = cardX + cardW - 36 - tx;
          const specH = 82;
          const specX = tx;
          const specY = artY + artSize - specH;
          bctx.fillStyle = 'rgba(0,0,0,0.34)';
          bctx.beginPath();
          bctx.roundRect(specX, specY, specW, specH, 12);
          bctx.fill();

          const bGrad = bctx.createLinearGradient(0, specY + specH, 0, specY);
          bGrad.addColorStop(0, primary);
          bGrad.addColorStop(1, accent);
          bctx.fillStyle = bGrad;
          bctx.strokeStyle = accent;

          const bBars = 40;
          if (visuals.visualizerStyle === 'ring') {
            const cx = specX + specW / 2;
            const cy = specY + specH / 2;
            const baseR = specH * 0.28;
            bctx.lineWidth = 3;
            for (let i = 0; i < bBars; i++) {
              const raw = isPlaying ? (freq[i % freq.length] || 0) / 255 : 0.14;
              const angle = (i / bBars) * Math.PI * 2 - Math.PI / 2;
              const len = 5 + raw * (specH * 0.22);
              bctx.beginPath();
              bctx.moveTo(cx + Math.cos(angle) * baseR, cy + Math.sin(angle) * baseR);
              bctx.lineTo(cx + Math.cos(angle) * (baseR + len), cy + Math.sin(angle) * (baseR + len));
              bctx.stroke();
            }
          } else {
            const bGap = 4;
            const bPad = 10;
            const innerW = specW - bPad * 2;
            const innerH = specH - 16;
            const bBarW = Math.max(3, (innerW - bGap * (bBars - 1)) / bBars);
            for (let i = 0; i < bBars; i++) {
              const binIdx = Math.min(freq.length - 1, Math.floor((i / bBars) * 38));
              const norm = isPlaying
                ? (freq[binIdx] || 0) / 255
                : 0.08 + 0.06 * Math.sin(phase * 1.8 + i * 0.35);
              const hBar = Math.max(4, norm * innerH);
              const bx = specX + bPad + i * (bBarW + bGap);
              const by =
                visuals.visualizerStyle === 'mirror'
                  ? specY + (specH - hBar) / 2
                  : specY + specH - 8 - hBar;
              bctx.beginPath();
              bctx.roundRect(bx, by, bBarW, hBar, 3);
              bctx.fill();
            }
          }

          // Bottom Glassmorphic Progress Dock
          const dockW = 940;
          const dockH = 92;
          const dockX = (bw - dockW) / 2;
          const dockY = bh - 124;
          const progX = dockX + 94;
          const progW = dockW - 188;
          const progY = dockY + 24;
          const pct = computeProgressPercent(elapsedSec, durationSec) / 100;

          bctx.fillStyle = 'rgba(0,0,0,0.52)';
          bctx.strokeStyle = pal?.glassBorderRgba || 'rgba(255,255,255,0.18)';
          bctx.lineWidth = 1.3;
          bctx.beginPath();
          bctx.roundRect(dockX, dockY, dockW, dockH, 16);
          bctx.fill();
          bctx.stroke();

          bctx.fillStyle = '#ffffff';
          bctx.font = '600 16px "JetBrains Mono", monospace';
          bctx.fillText(formatTimeMMSS(elapsedSec), dockX + 24, progY + 8);

          const totalTxt = formatTimeMMSS(durationSec);
          bctx.fillStyle = 'rgba(212,212,216,0.92)';
          const tm = bctx.measureText(totalTxt);
          bctx.fillText(totalTxt, dockX + dockW - 24 - tm.width, progY + 8);

          bctx.fillStyle = 'rgba(255,255,255,0.16)';
          bctx.beginPath();
          bctx.roundRect(progX, progY, progW, 6, 3);
          bctx.fill();

          const fillW = Math.max(6, progW * pct);
          bctx.fillStyle = accent;
          bctx.beginPath();
          bctx.roundRect(progX, progY, fillW, 6, 3);
          bctx.fill();

          bctx.fillStyle = '#ffffff';
          bctx.beginPath();
          bctx.arc(progX + fillW, progY + 3, 5.5, 0, Math.PI * 2);
          bctx.fill();

          // ON AIR Pill + Up Next
          bctx.fillStyle = accent;
          bctx.beginPath();
          bctx.roundRect(dockX + 24, dockY + 48, 102, 28, 8);
          bctx.fill();

          bctx.fillStyle = pal?.textOnAccent || '#090a0f';
          bctx.beginPath();
          bctx.arc(dockX + 41, dockY + 62, 4, 0, Math.PI * 2);
          bctx.fill();
          bctx.font = '700 12.5px "Plus Jakarta Sans", sans-serif';
          bctx.fillText('ON AIR', dockX + 52, dockY + 67);

          if (visuals.showUpNext && nextTrack) {
            bctx.fillStyle = 'rgba(228,228,231,0.88)';
            bctx.font = '500 13.5px "Plus Jakarta Sans", sans-serif';
            const nextTxt = `Up Next: ${nextTrack.title.slice(0, 34)}`;
            const nm = bctx.measureText(nextTxt);
            bctx.fillText(nextTxt, dockX + dockW - 24 - nm.width, dockY + 67);
          }

          bctx.restore();
        }
      }

      raf = requestAnimationFrame(renderFrame);
    };

    raf = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(raf);
  }, [
    bassEnergy,
    currentTrack,
    durationSec,
    elapsedSec,
    getFrequencyData,
    isPlaying,
    nextTrack,
    streamStatus.mode,
    streamStatus.state,
    totalTracks,
    trackIndex,
    visuals,
  ]);

  const palette = currentTrack?.palette;
  const progressPct = computeProgressPercent(elapsedSec, durationSec);
  const remainingSec = Math.max(0, durationSec - elapsedSec);
  const bassScale = visuals.bassPulse ? 1 + bassEnergy * 0.045 : 1;
  const ambientScale = visuals.ambientDrift ? 1.12 + bassEnergy * 0.06 : 1.08;
  const isLive = streamStatus.state === 'live';

  return (
    <section aria-label="Live Broadcast Screen" className="w-full">
      <div
        ref={stageRef}
        data-testid="live-glass-screen"
        data-track-color={palette?.primary || '#d42638'}
        className="relative flex min-h-[410px] w-full flex-col justify-between overflow-hidden rounded-2xl border border-white/15 bg-[#0a0b10] shadow-2xl sm:min-h-0 sm:aspect-video"
        style={{
          boxShadow: palette ? `0 24px 80px -20px ${palette.glowRgba}` : undefined,
        }}
      >
        {/* Offscreen 1280x720 broadcast canvas for Canvas Relay mode */}
        <canvas
          ref={broadcastCanvasRef}
          data-testid="broadcast-canvas"
          width={1280}
          height={720}
          className="pointer-events-none absolute opacity-0"
          aria-hidden="true"
        />

        {/* Layer 1: Cover-derived blurred ambient photo backdrop */}
        {currentTrack && !imgError && (
          <img
            src={currentTrack.coverUrl}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover transition-transform duration-300 ease-out"
            style={{
              transform: `scale(${ambientScale})`,
              filter: `blur(${visuals.glassBlurPx + 14}px) saturate(1.45) brightness(0.46)`,
            }}
          />
        )}

        {/* Layer 2: Dynamic cover-color radial ambient gradient wash */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 transition-colors duration-700"
          style={{
            background: palette
              ? `radial-gradient(circle at 28% 35%, ${palette.glowRgba} 0%, transparent 56%), radial-gradient(circle at 78% 70%, ${palette.primary}38 0%, transparent 58%), linear-gradient(180deg, rgba(8,9,13,0.32) 0%, rgba(8,9,13,0.78) 100%)`
              : 'linear-gradient(180deg, #12141c 0%, #08090d 100%)',
          }}
        />

        {/* Layer 3: Top Minimal Broadcast Bar */}
        <div className="relative z-10 flex items-center justify-between px-4 pt-3.5 sm:px-6 sm:pt-4">
          <div className="flex items-center gap-3 text-xs font-medium text-zinc-200/90">
            {visuals.showLiveBadge && (
              <span className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-black/35 px-2.5 py-1 backdrop-blur-md">
                {isLive && (
                  <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
                )}
                <Radio className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="font-mono-tabular tracking-wide">
                  {isLive
                    ? streamStatus.dryRun
                      ? `TEST LIVE · ${formatUptimeHHMMSS(streamStatus.uptimeSec)}`
                      : `YOUTUBE LIVE · ${formatUptimeHHMMSS(streamStatus.uptimeSec)}`
                    : '24/7 LOOP PREVIEW'}
                </span>
              </span>
            )}
            {currentTrack && (
              <span className="hidden sm:inline text-zinc-300/80 font-mono-tabular">
                Track {trackIndex + 1} of {totalTracks} · {currentTrack.bpm} BPM
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen live screen' : 'Expand live screen fullscreen'}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-black/35 text-zinc-200 backdrop-blur-md transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Layer 4: Center Glassmorphic Stage Card */}
        <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-4 py-3 sm:px-7">
          {currentTrack ? (
            <div
              className="relative flex w-full max-w-3xl flex-col items-center gap-4 overflow-hidden rounded-2xl border p-4 shadow-2xl transition-all duration-500 sm:flex-row sm:items-stretch sm:gap-6 sm:p-5"
              style={{
                backgroundColor: palette
                  ? `color-mix(in srgb, ${palette.secondary} ${Math.round(visuals.glassOpacity * 100)}%, rgba(12,14,20,0.45))`
                  : 'rgba(14, 16, 24, 0.56)',
                borderColor: palette?.glassBorderRgba || 'rgba(255, 255, 255, 0.22)',
                backdropFilter: `blur(${visuals.glassBlurPx}px) saturate(165%)`,
                WebkitBackdropFilter: `blur(${visuals.glassBlurPx}px) saturate(165%)`,
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.22), 0 24px 60px -16px ${palette?.glowRgba || 'rgba(0,0,0,0.6)'}`,
              }}
            >
              {/* Subtle glassmorphic specular highlight sheen */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.02) 45%, rgba(255,255,255,0.05) 100%)',
                }}
              />

              {/* Cover Artwork */}
              <div
                className="relative z-10 h-32 w-32 shrink-0 overflow-hidden rounded-xl border border-white/25 shadow-lg transition-transform duration-150 sm:h-40 sm:w-40 lg:h-44 lg:w-44"
                style={{ transform: `scale(${bassScale})` }}
              >
                {!imgError ? (
                  <img
                    src={currentTrack.coverUrl}
                    alt={`${currentTrack.title} cover art`}
                    referrerPolicy="no-referrer"
                    onError={() => setImgError(true)}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div
                    className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center"
                    style={{
                      background: `linear-gradient(135deg, ${palette?.primary || '#d42638'}, ${palette?.secondary || '#12131a'})`,
                    }}
                  >
                    <Disc3 className="h-10 w-10 text-white/80" />
                    <span className="text-xs font-medium text-white/90 line-clamp-2">
                      {currentTrack.title}
                    </span>
                  </div>
                )}
              </div>

              {/* Track Title, Metadata, & Reactive Spectrum */}
              <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-between text-center sm:text-left">
                <div>
                  <p
                    className="text-xs font-semibold tracking-wider uppercase"
                    style={{ color: palette?.accent || '#ff4d5a' }}
                  >
                    {currentTrack.subgenre} · 24/7 Loop
                  </p>
                  <h2
                    data-testid="live-track-title"
                    className="mt-1 font-display text-xl font-bold tracking-tight text-white truncate sm:text-3xl"
                  >
                    {currentTrack.title}
                  </h2>
                  <p className="mt-0.5 text-sm font-medium text-zinc-200/80">
                    {currentTrack.artist}
                  </p>
                </div>

                {/* Live Audio Spectrum Canvas */}
                <div className="mt-3 flex items-end gap-3">
                  <canvas
                    ref={specCanvasRef}
                    width={420}
                    height={64}
                    className="h-12 w-full rounded-lg bg-black/25 px-2 py-1 sm:h-14"
                    aria-label="Audio frequency spectrum"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex w-full max-w-lg flex-col items-center justify-center rounded-2xl border border-white/15 bg-black/45 p-8 text-center backdrop-blur-xl">
              <Disc3 className="h-10 w-10 text-zinc-400" />
              <h2 className="mt-3 font-display text-xl font-semibold text-white">
                No Phonk Tracks in Queue
              </h2>
              <p className="mt-1 text-sm text-zinc-300">
                Add a Phonk audio file with cover artwork to activate the glassmorphic live screen.
              </p>
            </div>
          )}
        </div>

        {/* Layer 5: Bottom Glassmorphic Minutes:Seconds Progress Dock */}
        <div className="relative z-10 px-4 pb-3.5 sm:px-6 sm:pb-4">
          <div
            className="mx-auto max-w-4xl rounded-xl border border-white/15 bg-black/45 px-3.5 py-2.5 backdrop-blur-xl sm:px-4"
            style={{
              borderColor: palette?.glassBorderRgba || 'rgba(255,255,255,0.16)',
            }}
          >
            {/* Interactive Progress Scrubber */}
            <div className="flex items-center gap-3">
              <span
                data-testid="track-elapsed-time"
                className="font-mono-tabular text-xs font-semibold text-white sm:text-sm"
              >
                {formatTimeMMSS(elapsedSec)}
              </span>

              <div className="relative flex-1">
                <input
                  type="range"
                  aria-label="Seek track position"
                  min={0}
                  max={Math.max(1, durationSec)}
                  step={0.5}
                  value={Math.min(elapsedSec, Math.max(1, durationSec))}
                  onChange={(e) => onSeek(Number(e.target.value))}
                  disabled={!currentTrack}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-white"
                  style={{
                    background: `linear-gradient(90deg, ${palette?.accent || '#ff4d5a'} ${progressPct}%, rgba(255,255,255,0.16) ${progressPct}%)`,
                  }}
                />
              </div>

              <span
                data-testid="track-total-time"
                className="font-mono-tabular text-xs font-medium text-zinc-300 sm:text-sm"
              >
                {formatTimeMMSS(durationSec)}
              </span>
            </div>

            {/* Bottom Controls + Remaining Time + Up Next */}
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onPrevious}
                  disabled={totalTracks === 0}
                  aria-label="Previous Phonk track"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-200 transition-colors hover:bg-white/10 disabled:opacity-40"
                >
                  <SkipBack className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onTogglePlay}
                  disabled={!currentTrack}
                  aria-label={isPlaying ? 'Pause preview audio' : 'Play preview audio'}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-transform active:scale-95 disabled:opacity-40"
                  style={{
                    backgroundColor: palette?.accent || '#ffffff',
                    color: palette?.textOnAccent || '#090a0f',
                  }}
                >
                  {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  <span>{isPlaying ? 'Pause' : 'Play'}</span>
                </button>
                <button
                  type="button"
                  onClick={onNext}
                  disabled={totalTracks === 0}
                  aria-label="Next Phonk track"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-200 transition-colors hover:bg-white/10 disabled:opacity-40"
                >
                  <SkipForward className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center gap-2.5 text-xs text-zinc-300/90 truncate">
                <span className="font-mono-tabular hidden sm:inline">
                  -{formatTimeMMSS(remainingSec)} left
                </span>
                {visuals.showUpNext && nextTrack && (
                  <>
                    <span aria-hidden="true" className="hidden sm:inline text-zinc-500">
                      ·
                    </span>
                    <span className="truncate max-w-[160px] sm:max-w-[240px]">
                      Up Next: <strong className="font-medium text-white">{nextTrack.title}</strong>
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
