import {
  AlertTriangle,
  Eye,
  EyeOff,
  Radio,
  ShieldCheck,
  Sparkles,
  Square,
  Volume2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  buildVideoShieldPreset,
  DEFAULT_VIDEO_SHIELD,
  formatTimeMMSS,
  formatUptimeHHMMSS,
  isVideoShieldActive,
  type QueueEndBehavior,
  type ShieldPresetId,
  type StreamConfig,
  type StreamMode,
  type StreamStatus,
  type VideoShieldSettings,
  type WatermarkPosition,
} from '../lib/phonkLogic';

interface BroadcastPanelProps {
  streamStatus: StreamStatus;
  streamConfig: StreamConfig;
  activeTab: 'broadcast' | 'shield';
  onTabChange: (tab: 'broadcast' | 'shield') => void;
  onUpdateConfig: (patch: Partial<StreamConfig> & { streamKey?: string }) => Promise<void>;
  onStartBroadcast: (payload: {
    streamKey: string;
    rtmpUrl: string;
    mode: StreamMode;
    videoEncodeMode?: 'safe-encode' | 'direct-copy';
    queueEndBehavior?: QueueEndBehavior;
    autoStopMinutes?: number;
    videoShield?: VideoShieldSettings;
    dryRun: boolean;
  }) => Promise<void>;
  onStopBroadcast: () => Promise<void>;
  streamActionError: string | null;
}

const SHIELD_PRESET_OPTIONS: { id: ShieldPresetId; label: string; sub: string }[] = [
  { id: 'movie-stealth', label: 'Movie Stealth', sub: 'Zoom + Mirror + PIP + Bass' },
  { id: 'framed-pip', label: 'Cinema PIP', sub: 'Blur Frame + Zoom + Wide' },
  { id: 'audio-color', label: 'Audio & Color', sub: 'Color + Pitch + Bass Boom' },
  { id: 'original', label: 'Original Raw', sub: 'Zero filters (Direct pass)' },
];

export function BroadcastPanel({
  streamStatus,
  streamConfig,
  activeTab,
  onTabChange,
  onUpdateConfig,
  onStartBroadcast,
  onStopBroadcast,
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
  const queueEndBehavior: QueueEndBehavior = streamConfig.queueEndBehavior || 'loop';
  const shield: VideoShieldSettings = streamConfig.videoShield || DEFAULT_VIDEO_SHIELD;
  const shieldActive = isVideoShieldActive(shield);

  const updateShield = (patch: Partial<VideoShieldSettings>) => {
    const next: VideoShieldSettings = { ...shield, ...patch };
    void onUpdateConfig({
      videoShield: next,
      ...(isVideoShieldActive(next) ? { videoEncodeMode: 'safe-encode' } : {}),
    });
  };

  const applyPreset = (presetId: ShieldPresetId) => {
    const next = buildVideoShieldPreset(presetId, shield.watermarkText, shield.watermarkPos);
    void onUpdateConfig({
      videoShield: next,
      videoEncodeMode: presetId === 'original' ? encodeMode : 'safe-encode',
    });
  };

  const handleToggleBroadcast = async () => {
    setBusy(true);
    try {
      if (isBroadcasting) {
        await onStopBroadcast();
      } else {
        await onStartBroadcast({
          streamKey: streamKeyInput,
          rtmpUrl: rtmpUrlInput,
          mode: 'video-24-7',
          videoEncodeMode: shieldActive ? 'safe-encode' : encodeMode,
          queueEndBehavior,
          autoStopMinutes: streamConfig.autoStopMinutes || 0,
          videoShield: shield,
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
            : streamStatus.stopReason === 'queue-completed'
              ? 'Finished · Auto-Stopped'
              : streamStatus.stopReason === 'timer-completed'
                ? 'Timer Ended · Stopped'
                : 'Standby';

  return (
    <aside
      aria-label="Broadcast and Copyright Shield Controls"
      className="flex flex-col rounded-2xl border border-zinc-800/80 bg-[#101218] p-5"
    >
      {/* 2-Tab Segmented Control */}
      <div className="flex items-center gap-1 rounded-xl border border-zinc-800/80 bg-zinc-950/80 p-1">
        <button
          type="button"
          onClick={() => onTabChange('broadcast')}
          data-testid="tab-youtube-live"
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
          onClick={() => onTabChange('shield')}
          data-testid="tab-copyright-shield"
          className={`flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'shield'
              ? 'bg-zinc-800 text-white'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Copyright Shield</span>
        </button>
      </div>

      {activeTab === 'broadcast' ? (
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
              <p className="text-xs text-zinc-400">
                {streamStatus.autoStopRemainingSec != null ? 'Auto-Stop In' : 'Uptime'}
              </p>
              <p
                data-testid="broadcast-uptime"
                className="mt-0.5 font-mono-tabular text-sm font-semibold text-white"
              >
                {streamStatus.autoStopRemainingSec != null
                  ? formatTimeMMSS(streamStatus.autoStopRemainingSec)
                  : formatUptimeHHMMSS(streamStatus.uptimeSec)}
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
                <p className="text-[11px] text-zinc-400">Shield</p>
                <p className="font-mono-tabular text-xs font-semibold text-emerald-400">
                  {shieldActive ? 'Active' : 'Raw'}
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

          {/* When Videos Finish: Loop vs Auto-Stop Both App & YouTube */}
          <div>
            <span className="block text-xs font-medium text-zinc-300">
              When Uploaded Videos Finish
            </span>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isBroadcasting}
                onClick={() => void onUpdateConfig({ queueEndBehavior: 'loop' })}
                data-testid="queue-end-loop"
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${
                  queueEndBehavior === 'loop'
                    ? 'border-white/35 bg-white/10 text-white'
                    : 'border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <p className="text-xs font-semibold">Loop 24/7 Forever</p>
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  Repeats queue continuously
                </p>
              </button>
              <button
                type="button"
                disabled={isBroadcasting}
                onClick={() => void onUpdateConfig({ queueEndBehavior: 'stop-after-queue' })}
                data-testid="queue-end-auto-stop"
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${
                  queueEndBehavior === 'stop-after-queue'
                    ? 'border-white/35 bg-white/10 text-white'
                    : 'border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <p className="text-xs font-semibold">Play Once &amp; Auto-Stop</p>
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  Ends YouTube &amp; App together
                </p>
              </button>
            </div>
          </div>

          {/* Quality, Bitrate, and Auto-Stop Timer */}
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
                <option value="1280x720">720p HD (Fastest)</option>
                <option value="1920x1080">1080p Full HD</option>
              </select>
            </div>

            <div>
              <label htmlFor="stream-bitrate" className="block text-xs font-medium text-zinc-300">
                Bitrate &amp; Timer
              </label>
              <select
                id="stream-bitrate"
                value={streamConfig.videoBitrateKbps}
                disabled={isBroadcasting}
                onChange={(e) =>
                  void onUpdateConfig({ videoBitrateKbps: Number(e.target.value) })
                }
                className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-zinc-500 focus:outline-none disabled:opacity-60"
              >
                <option value={2500}>2500 kbps (Data Saver)</option>
                <option value={4500}>4500 kbps (HD Balanced)</option>
                <option value={6500}>6500 kbps (1080p High)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
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

            <div>
              <label htmlFor="auto-stop-timer" className="block text-xs font-medium text-zinc-300">
                Auto-Stop Timer
              </label>
              <select
                id="auto-stop-timer"
                value={streamConfig.autoStopMinutes || 0}
                disabled={isBroadcasting}
                onChange={(e) =>
                  void onUpdateConfig({ autoStopMinutes: Number(e.target.value) })
                }
                className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-zinc-500 focus:outline-none disabled:opacity-60"
              >
                <option value={0}>Off (Manual / Queue End)</option>
                <option value={30}>Stop after 30 min</option>
                <option value={60}>Stop after 1 hour</option>
                <option value={120}>Stop after 2 hours</option>
                <option value={240}>Stop after 4 hours</option>
              </select>
            </div>
          </div>

          {/* Toggles: Auto-Reconnect & Local Test Mode */}
          <div className="space-y-2.5 pt-1">
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3.5 py-2.5">
              <span className="text-xs font-medium text-zinc-200">
                Auto-Reconnect Watchdog
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
                  Verify FFmpeg Shield transforms locally without YouTube key
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
                ? 'Stop Live Broadcast'
                : streamConfig.dryRun
                  ? 'Start Local Pipeline Test'
                  : 'Go Live on YouTube'}
            </span>
          </button>

          <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
            <span>
              {shieldActive
                ? `Copyright Shield (${shield.preset}) will transform video & audio live on YouTube.`
                : 'Raw mode active. Switch to Copyright Shield tab to enable visual & bass transforms.'}
            </span>
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <p className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 px-3 py-2 text-[11px] text-zinc-300 leading-relaxed">
            Real-time FFmpeg visual + audio transforms applied directly to your YouTube Live stream to break automated fingerprint matching.
          </p>

          {/* 1-Click Presets */}
          <div>
            <span className="block text-xs font-medium text-zinc-300">Shield Presets</span>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {SHIELD_PRESET_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={isBroadcasting}
                  onClick={() => applyPreset(opt.id)}
                  data-testid={`shield-preset-${opt.id}`}
                  className={`rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-60 ${
                    shield.preset === opt.id
                      ? 'border-white/35 bg-white/10 text-white'
                      : 'border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <p className="text-xs font-semibold">{opt.label}</p>
                  <p className="mt-0.5 text-[10px] text-zinc-400">{opt.sub}</p>
                </button>
              ))}
            </div>
          </div>

          <hr className="border-zinc-800/80" />

          {/* Visual Shield Toggles */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Visual Frame Transform</span>
            </div>

            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3.5 py-2.5">
              <div>
                <span className="block text-xs font-medium text-zinc-200">
                  Dynamic Zoom Pulse (Big ↔ Small)
                </span>
                <span className="block text-[11px] text-zinc-500">
                  Smoothly zooms in and out every 6s
                </span>
              </div>
              <input
                type="checkbox"
                checked={shield.zoomPulse}
                disabled={isBroadcasting}
                onChange={(e) => updateShield({ zoomPulse: e.target.checked })}
                className="h-4 w-4 accent-white"
              />
            </label>

            {shield.zoomPulse && (
              <div className="px-1">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="shield-zoom-pct" className="text-zinc-300">
                    Zoom Pulse Amplitude
                  </label>
                  <span className="font-mono-tabular text-zinc-400">
                    +{shield.zoomIntensityPct}%
                  </span>
                </div>
                <input
                  id="shield-zoom-pct"
                  type="range"
                  min={4}
                  max={16}
                  step={2}
                  disabled={isBroadcasting}
                  value={shield.zoomIntensityPct}
                  onChange={(e) => updateShield({ zoomIntensityPct: Number(e.target.value) })}
                  className="mt-1 h-1.5 w-full cursor-pointer accent-white"
                />
              </div>
            )}

            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3.5 py-2.5">
              <span className="text-xs font-medium text-zinc-200">
                Horizontal Mirror Flip
              </span>
              <input
                type="checkbox"
                checked={shield.mirrorFlip}
                disabled={isBroadcasting}
                onChange={(e) => updateShield({ mirrorFlip: e.target.checked })}
                className="h-4 w-4 accent-white"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3.5 py-2.5">
              <div>
                <span className="block text-xs font-medium text-zinc-200">
                  Blurred Ambient Cinema Frame
                </span>
                <span className="block text-[11px] text-zinc-500">
                  88% inset video over blurred motion backdrop
                </span>
              </div>
              <input
                type="checkbox"
                checked={shield.ambientPipFrame}
                disabled={isBroadcasting}
                onChange={(e) => updateShield({ ambientPipFrame: e.target.checked })}
                className="h-4 w-4 accent-white"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3.5 py-2.5">
              <span className="text-xs font-medium text-zinc-200">
                Color Contrast &amp; Hue Shift
              </span>
              <input
                type="checkbox"
                checked={shield.colorShift}
                disabled={isBroadcasting}
                onChange={(e) => updateShield({ colorShift: e.target.checked })}
                className="h-4 w-4 accent-white"
              />
            </label>

            {shield.colorShift && (
              <div className="px-1">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="shield-hue" className="text-zinc-300">
                    Color Hue Angle
                  </label>
                  <span className="font-mono-tabular text-zinc-400">{shield.hueShiftDeg}°</span>
                </div>
                <input
                  id="shield-hue"
                  type="range"
                  min={-25}
                  max={25}
                  step={1}
                  disabled={isBroadcasting}
                  value={shield.hueShiftDeg}
                  onChange={(e) => updateShield({ hueShiftDeg: Number(e.target.value) })}
                  className="mt-1 h-1.5 w-full cursor-pointer accent-white"
                />
              </div>
            )}

            <div>
              <span className="block text-xs font-medium text-zinc-300">Stream Playback Speed</span>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
                {[0.96, 1.0, 1.03, 1.05].map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    disabled={isBroadcasting}
                    onClick={() => updateShield({ speedFactor: spd })}
                    className={`rounded-md py-1.5 font-mono-tabular text-xs font-medium transition-colors ${
                      Math.abs(shield.speedFactor - spd) < 0.005
                        ? 'bg-zinc-800 text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {spd.toFixed(2)}x
                  </button>
                ))}
              </div>
            </div>
          </div>

          <hr className="border-zinc-800/80" />

          {/* Audio "Boom Boom" & Pitch Shield */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              <Volume2 className="h-3.5 w-3.5" />
              <span>Audio Boom &amp; Pitch Shield</span>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="shield-bass-boom" className="text-zinc-300">
                  Bass Boom Punch (75 Hz)
                </label>
                <span className="font-mono-tabular text-zinc-400">+{shield.bassBoomDb} dB</span>
              </div>
              <input
                id="shield-bass-boom"
                type="range"
                min={0}
                max={12}
                step={1}
                disabled={isBroadcasting}
                value={shield.bassBoomDb}
                onChange={(e) => updateShield({ bassBoomDb: Number(e.target.value) })}
                className="mt-1 h-1.5 w-full cursor-pointer accent-white"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="shield-pitch" className="text-zinc-300">
                  Audio Pitch Shift
                </label>
                <span className="font-mono-tabular text-zinc-400">
                  {shield.audioPitchShiftPct >= 0 ? `+${shield.audioPitchShiftPct}%` : `${shield.audioPitchShiftPct}%`}
                </span>
              </div>
              <input
                id="shield-pitch"
                type="range"
                min={-5}
                max={5}
                step={1}
                disabled={isBroadcasting}
                value={shield.audioPitchShiftPct}
                onChange={(e) => updateShield({ audioPitchShiftPct: Number(e.target.value) })}
                className="mt-1 h-1.5 w-full cursor-pointer accent-white"
              />
            </div>

            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3.5 py-2.5">
              <span className="text-xs font-medium text-zinc-200">
                Stereo Wide + Anti-Clip Compressor
              </span>
              <input
                type="checkbox"
                checked={shield.stereoWiden}
                disabled={isBroadcasting}
                onChange={(e) => updateShield({ stereoWiden: e.target.checked })}
                className="h-4 w-4 accent-white"
              />
            </label>
          </div>

          <hr className="border-zinc-800/80" />

          {/* Custom Channel Watermark Overlay */}
          <div className="space-y-2.5">
            <label htmlFor="shield-watermark" className="block text-xs font-medium text-zinc-300">
              Channel Watermark on Stream (Optional)
            </label>
            <div className="flex gap-2">
              <input
                id="shield-watermark"
                type="text"
                maxLength={36}
                disabled={isBroadcasting}
                value={shield.watermarkText}
                onChange={(e) => updateShield({ watermarkText: e.target.value })}
                placeholder="e.g. @CinemaLive24"
                className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none disabled:opacity-60"
              />
              <select
                aria-label="Watermark corner position"
                value={shield.watermarkPos}
                disabled={isBroadcasting}
                onChange={(e) =>
                  updateShield({ watermarkPos: e.target.value as WatermarkPosition })
                }
                className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-xs text-white focus:border-zinc-500 focus:outline-none disabled:opacity-60"
              >
                <option value="top-right">Top Right</option>
                <option value="top-left">Top Left</option>
                <option value="bottom-right">Bottom Right</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
