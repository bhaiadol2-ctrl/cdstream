import {
  AlertTriangle,
  Eye,
  EyeOff,
  Radio,
  ShieldCheck,
  Sliders,
  Sparkles,
  Square,
  Volume2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  formatUptimeHHMMSS,
  type AudioFxSettings,
  type StreamConfig,
  type StreamMode,
  type StreamStatus,
  type VisualSettings,
  type VisualizerStyle,
} from '../lib/phonkLogic';

interface BroadcastPanelProps {
  studioMode: 'video' | 'phonk';
  streamStatus: StreamStatus;
  streamConfig: StreamConfig;
  fx: AudioFxSettings;
  visuals: VisualSettings;
  activeTab: 'broadcast' | 'fx';
  onTabChange: (tab: 'broadcast' | 'fx') => void;
  onUpdateConfig: (patch: Partial<StreamConfig> & { streamKey?: string }) => Promise<void>;
  onStartBroadcast: (payload: {
    streamKey: string;
    rtmpUrl: string;
    mode: StreamMode;
    videoEncodeMode?: 'safe-encode' | 'direct-copy';
    dryRun: boolean;
  }) => Promise<void>;
  onStopBroadcast: () => Promise<void>;
  onChangeFx: (next: AudioFxSettings) => void;
  onChangeVisuals: (next: VisualSettings) => void;
  streamActionError: string | null;
}

export function BroadcastPanel({
  studioMode,
  streamStatus,
  streamConfig,
  fx,
  visuals,
  activeTab,
  onTabChange,
  onUpdateConfig,
  onStartBroadcast,
  onStopBroadcast,
  onChangeFx,
  onChangeVisuals,
  streamActionError,
}: BroadcastPanelProps) {
  const [streamKeyInput, setStreamKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [rtmpUrlInput, setRtmpUrlInput] = useState(streamConfig.rtmpUrl);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRtmpUrlInput(streamConfig.rtmpUrl);
  }, [streamConfig.rtmpUrl]);

  const isBroadcasting =
    streamStatus.state === 'live' ||
    streamStatus.state === 'connecting' ||
    streamStatus.state === 'reconnecting';

  const encodeMode = streamConfig.videoEncodeMode || 'safe-encode';

  const handleToggleBroadcast = async () => {
    setBusy(true);
    try {
      if (isBroadcasting) {
        await onStopBroadcast();
      } else {
        const targetMode: StreamMode =
          studioMode === 'video'
            ? 'video-24-7'
            : streamConfig.mode === 'canvas-relay'
              ? 'canvas-relay'
              : 'autonomous-24-7';
        await onStartBroadcast({
          streamKey: streamKeyInput,
          rtmpUrl: rtmpUrlInput,
          mode: targetMode,
          videoEncodeMode: encodeMode,
          dryRun: streamConfig.dryRun,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const stateLabel =
    streamStatus.state === 'live'
      ? streamStatus.dryRun
        ? 'Live (Local Test)'
        : 'Live on YouTube'
      : streamStatus.state === 'connecting'
        ? 'Connecting...'
        : streamStatus.state === 'reconnecting'
          ? `Reconnecting (#${streamStatus.reconnectAttempts})`
          : streamStatus.state === 'error'
            ? 'Stream Error'
            : 'Standby';

  const showBroadcastBody = studioMode === 'video' || activeTab === 'broadcast';

  return (
    <aside
      aria-label="Broadcast and Audio Studio Controls"
      className="flex flex-col rounded-2xl border border-zinc-800/80 bg-[#101218] p-5"
    >
      {/* Header / Mode Tabs */}
      {studioMode === 'video' ? (
        <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Radio className="h-4 w-4 text-red-400" />
            <span>YouTube Direct Video Live</span>
          </div>
          <span className="font-mono-tabular text-[11px] text-zinc-400">24/7 Server Stream</span>
        </div>
      ) : (
        <div className="flex items-center gap-1 rounded-xl border border-zinc-800/80 bg-zinc-950/80 p-1">
          <button
            type="button"
            onClick={() => onTabChange('broadcast')}
            className={`flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'broadcast'
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Radio className="h-3.5 w-3.5" />
            <span>YouTube Live</span>
          </button>
          <button
            type="button"
            onClick={() => onTabChange('fx')}
            className={`flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'fx'
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sliders className="h-3.5 w-3.5" />
            <span>Phonk FX & Glass</span>
          </button>
        </div>
      )}

      {showBroadcastBody ? (
        <div className="mt-5 space-y-4">
          {/* Status Summary Row */}
          <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
            <div>
              <p className="text-xs text-zinc-400">Broadcast State</p>
              <p
                data-testid="broadcast-state-label"
                className={`mt-0.5 text-sm font-semibold ${
                  streamStatus.state === 'live'
                    ? 'text-emerald-400'
                    : streamStatus.state === 'error'
                      ? 'text-red-400'
                      : streamStatus.state === 'reconnecting' || streamStatus.state === 'connecting'
                        ? 'text-amber-400'
                        : 'text-zinc-200'
                }`}
              >
                {stateLabel}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-zinc-400">Uptime</p>
              <p data-testid="broadcast-uptime" className="mt-0.5 font-mono-tabular text-sm font-semibold text-white">
                {formatUptimeHHMMSS(streamStatus.uptimeSec)}
              </p>
            </div>
          </div>

          {isBroadcasting && (
            <div className="grid grid-cols-3 gap-2 rounded-xl border border-zinc-800/80 bg-zinc-950/40 px-3 py-2.5 text-center">
              <div>
                <p className="text-[11px] text-zinc-400">FPS</p>
                <p className="font-mono-tabular text-xs font-semibold text-white">{streamStatus.fps}</p>
              </div>
              <div>
                <p className="text-[11px] text-zinc-400">Bitrate</p>
                <p className="font-mono-tabular text-xs font-semibold text-white">
                  {streamStatus.bitrateKbps} kbps
                </p>
              </div>
              <div>
                <p className="text-[11px] text-zinc-400">Cycles</p>
                <p className="font-mono-tabular text-xs font-semibold text-white">
                  {streamStatus.loopCount}
                </p>
              </div>
            </div>
          )}

          {(streamActionError || streamStatus.lastError) && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-red-500/35 bg-red-500/10 p-3 text-xs text-red-300"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <span>{streamActionError || streamStatus.lastError}</span>
            </div>
          )}

          {/* Direct YouTube Stream Key */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="yt-stream-key" className="block text-xs font-medium text-zinc-300">
                YouTube Stream Key
              </label>
              {streamStatus.hasStreamKey && (
                <div className="flex items-center gap-2">
                  <span className="font-mono-tabular text-[11px] text-emerald-400">
                    Saved ({streamStatus.maskedStreamKey})
                  </span>
                  {!isBroadcasting && (
                    <button
                      type="button"
                      onClick={() => {
                        setStreamKeyInput('');
                        void onUpdateConfig({ streamKey: '' });
                      }}
                      className="text-[11px] text-zinc-400 underline hover:text-white"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="relative mt-1.5">
              <input
                id="yt-stream-key"
                type={showKey ? 'text' : 'password'}
                value={streamKeyInput}
                onChange={(e) => setStreamKeyInput(e.target.value)}
                placeholder={
                  streamStatus.hasStreamKey
                    ? 'Key stored securely on server (enter to replace)'
                    : 'Paste your YouTube Live stream key...'
                }
                disabled={isBroadcasting}
                autoComplete="off"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pl-3 pr-10 text-sm text-white font-mono-tabular placeholder:font-sans placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? 'Hide stream key' : 'Show stream key'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:text-white"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* RTMP Server URL */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="yt-rtmp-url" className="block text-xs font-medium text-zinc-300">
                YouTube Ingest URL (RTMPS / RTMP)
              </label>
              {!isBroadcasting && (
                <button
                  type="button"
                  onClick={() => setRtmpUrlInput('rtmps://a.rtmps.youtube.com:443/live2')}
                  className="text-[11px] text-zinc-400 underline hover:text-white"
                >
                  Use Port 443 RTMPS
                </button>
              )}
            </div>
            <input
              id="yt-rtmp-url"
              type="url"
              value={rtmpUrlInput}
              onChange={(e) => setRtmpUrlInput(e.target.value)}
              disabled={isBroadcasting}
              className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 font-mono-tabular focus:border-zinc-500 focus:outline-none disabled:opacity-60"
            />
          </div>

          {/* Engine / Video Encoding Selector */}
          {studioMode === 'video' ? (
            <div>
              <span className="block text-xs font-medium text-zinc-300">Video Stream Encoding</span>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={isBroadcasting}
                  onClick={() => void onUpdateConfig({ videoEncodeMode: 'safe-encode' })}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${
                    encodeMode === 'safe-encode'
                      ? 'border-white/35 bg-white/10 text-white'
                      : 'border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <p className="text-xs font-semibold">Auto Safe Encode</p>
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    Works with any MP4, MKV, MOV
                  </p>
                </button>
                <button
                  type="button"
                  disabled={isBroadcasting}
                  onClick={() => void onUpdateConfig({ videoEncodeMode: 'direct-copy' })}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${
                    encodeMode === 'direct-copy'
                      ? 'border-white/35 bg-white/10 text-white'
                      : 'border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <p className="text-xs font-semibold">Direct Copy (Zero CPU)</p>
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    Original quality H.264 pass-through
                  </p>
                </button>
              </div>
            </div>
          ) : (
            <div>
              <span className="block text-xs font-medium text-zinc-300">Broadcast Engine Mode</span>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={isBroadcasting}
                  onClick={() => void onUpdateConfig({ mode: 'autonomous-24-7' })}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${
                    streamConfig.mode === 'autonomous-24-7'
                      ? 'border-white/35 bg-white/10 text-white'
                      : 'border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <p className="text-xs font-semibold">24/7 Server Loop</p>
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    Runs lifetime even if tab closes
                  </p>
                </button>
                <button
                  type="button"
                  disabled={isBroadcasting}
                  onClick={() => void onUpdateConfig({ mode: 'canvas-relay' })}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${
                    streamConfig.mode === 'canvas-relay'
                      ? 'border-white/35 bg-white/10 text-white'
                      : 'border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <p className="text-xs font-semibold">Live Canvas Relay</p>
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    Streams browser FX & bass pulse
                  </p>
                </button>
              </div>
            </div>
          )}

          {/* Resolution & Frame Rate */}
          {(studioMode === 'phonk' || encodeMode === 'safe-encode') ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="stream-res" className="block text-xs font-medium text-zinc-300">
                  Resolution
                </label>
                <select
                  id="stream-res"
                  value={streamConfig.resolution}
                  disabled={isBroadcasting}
                  onChange={(e) =>
                    void onUpdateConfig({
                      resolution: e.target.value as '1280x720' | '1920x1080',
                    })
                  }
                  className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-zinc-500 focus:outline-none disabled:opacity-60"
                >
                  <option value="1280x720">720p HD (1280x720)</option>
                  <option value="1920x1080">1080p Full HD (1920x1080)</option>
                </select>
              </div>

              <div>
                <label htmlFor="stream-fps" className="block text-xs font-medium text-zinc-300">
                  Frame Rate
                </label>
                <select
                  id="stream-fps"
                  value={streamConfig.fps}
                  disabled={isBroadcasting}
                  onChange={(e) =>
                    void onUpdateConfig({ fps: Number(e.target.value) as 30 | 60 })
                  }
                  className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-zinc-500 focus:outline-none disabled:opacity-60"
                >
                  <option value={30}>30 FPS (Stable)</option>
                  <option value={60}>60 FPS (Smooth)</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3.5 py-2.5 text-[11px] text-zinc-400">
              Direct Copy streams each uploaded H.264 video at its native resolution and frame rate with near-zero CPU usage.
            </div>
          )}

          {/* Toggles: Auto-Reconnect & Local Test Mode */}
          <div className="space-y-2.5 pt-1">
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3.5 py-2.5">
              <span className="text-xs font-medium text-zinc-200">
                24/7 Auto-Reconnect Watchdog
              </span>
              <input
                type="checkbox"
                checked={streamConfig.autoReconnect}
                onChange={(e) => void onUpdateConfig({ autoReconnect: e.target.checked })}
                className="h-4 w-4 accent-white"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3.5 py-2.5">
              <div>
                <span className="block text-xs font-medium text-zinc-200">
                  Local Pipeline Test (No RTMP)
                </span>
                <span className="block text-[11px] text-zinc-500">
                  Verify FFmpeg 24/7 loop locally without YouTube key
                </span>
              </div>
              <input
                type="checkbox"
                checked={streamConfig.dryRun}
                disabled={isBroadcasting}
                onChange={(e) => void onUpdateConfig({ dryRun: e.target.checked })}
                className="h-4 w-4 accent-white"
              />
            </label>
          </div>

          {/* Primary Go Live CTA */}
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleToggleBroadcast()}
            data-testid="go-live-button"
            className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
              isBroadcasting
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-white text-zinc-950 hover:bg-zinc-200'
            }`}
          >
            {isBroadcasting ? <Square className="h-4 w-4" /> : <Radio className="h-4 w-4" />}
            <span>
              {isBroadcasting
                ? 'Stop 24/7 Broadcast'
                : streamConfig.dryRun
                  ? 'Start Local Pipeline Test'
                  : 'Go Live on YouTube'}
            </span>
          </button>

          <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
            <span>Stream keys stay strictly on the server and are never exposed in logs or client state.</span>
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {/* Audio DSP FX */}
          <div className="space-y-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              <Volume2 className="h-3.5 w-3.5" />
              <span>Phonk Audio DSP</span>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="fx-volume" className="text-zinc-300">
                  Master Preview Volume
                </label>
                <span className="font-mono-tabular text-zinc-400">
                  {Math.round(fx.volume * 100)}%
                </span>
              </div>
              <input
                id="fx-volume"
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={fx.volume}
                onChange={(e) => onChangeFx({ ...fx, volume: Number(e.target.value) })}
                className="mt-1.5 h-1.5 w-full cursor-pointer accent-white"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="fx-bass" className="text-zinc-300">
                  808 Bass Boost (78 Hz)
                </label>
                <span className="font-mono-tabular text-zinc-400">+{fx.bassBoostDb} dB</span>
              </div>
              <input
                id="fx-bass"
                type="range"
                min={0}
                max={12}
                step={1}
                value={fx.bassBoostDb}
                onChange={(e) => onChangeFx({ ...fx, bassBoostDb: Number(e.target.value) })}
                className="mt-1.5 h-1.5 w-full cursor-pointer accent-white"
              />
            </div>

            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3.5 py-2.5">
              <div>
                <span className="block text-xs font-medium text-zinc-200">
                  Slowed + Reverb Mode (0.85x)
                </span>
                <span className="block text-[11px] text-zinc-500">
                  Classic tape pitch-down with hall reverb
                </span>
              </div>
              <input
                type="checkbox"
                checked={fx.slowedReverb}
                onChange={(e) => onChangeFx({ ...fx, slowedReverb: e.target.checked })}
                className="h-4 w-4 accent-white"
              />
            </label>

            {fx.slowedReverb && (
              <div>
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="fx-reverb-mix" className="text-zinc-300">
                    Hall Reverb Wet Mix
                  </label>
                  <span className="font-mono-tabular text-zinc-400">
                    {Math.round(fx.reverbMix * 100)}%
                  </span>
                </div>
                <input
                  id="fx-reverb-mix"
                  type="range"
                  min={0.1}
                  max={0.65}
                  step={0.05}
                  value={fx.reverbMix}
                  onChange={(e) => onChangeFx({ ...fx, reverbMix: Number(e.target.value) })}
                  className="mt-1.5 h-1.5 w-full cursor-pointer accent-white"
                />
              </div>
            )}
          </div>

          <hr className="border-zinc-800/80" />

          {/* Glassmorphic Screen Visual Customizer */}
          <div className="space-y-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Glassmorphic Live Screen</span>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="vis-blur" className="text-zinc-300">
                  Frosted Glass Blur
                </label>
                <span className="font-mono-tabular text-zinc-400">{visuals.glassBlurPx}px</span>
              </div>
              <input
                id="vis-blur"
                type="range"
                min={12}
                max={44}
                step={2}
                value={visuals.glassBlurPx}
                onChange={(e) =>
                  onChangeVisuals({ ...visuals, glassBlurPx: Number(e.target.value) })
                }
                className="mt-1.5 h-1.5 w-full cursor-pointer accent-white"
              />
            </div>

            <div>
              <span className="block text-xs font-medium text-zinc-300">Spectrum Visualizer</span>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5 rounded-lg bg-zinc-950 p-1 border border-zinc-800">
                {(['bars', 'mirror', 'ring'] as VisualizerStyle[]).map((style) => (
                  <button
                    key={style}
                    type="button"
                    onClick={() => onChangeVisuals({ ...visuals, visualizerStyle: style })}
                    className={`rounded-md px-2 py-1.5 text-xs font-medium capitalize transition-colors ${
                      visuals.visualizerStyle === style
                        ? 'bg-zinc-800 text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3.5 py-2.5">
              <span className="text-xs font-medium text-zinc-200">
                Bass-Reactive Cover Pulse
              </span>
              <input
                type="checkbox"
                checked={visuals.bassPulse}
                onChange={(e) =>
                  onChangeVisuals({ ...visuals, bassPulse: e.target.checked })
                }
                className="h-4 w-4 accent-white"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3.5 py-2.5">
              <span className="text-xs font-medium text-zinc-200">
                Show Up Next Track Ticker
              </span>
              <input
                type="checkbox"
                checked={visuals.showUpNext}
                onChange={(e) =>
                  onChangeVisuals({ ...visuals, showUpNext: e.target.checked })
                }
                className="h-4 w-4 accent-white"
              />
            </label>
          </div>
        </div>
      )}
    </aside>
  );
}
