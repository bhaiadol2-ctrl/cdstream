import { Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AddPhonkModal } from './components/AddPhonkModal';
import { BroadcastPanel } from './components/BroadcastPanel';
import { LiveGlassScreen } from './components/LiveGlassScreen';
import { PlaylistQueue } from './components/PlaylistQueue';
import { usePhonkPlayer } from './hooks/usePhonkPlayer';
import {
  reorderTracks,
  type AudioFxSettings,
  type PhonkTrack,
  type StreamConfig,
  type StreamMode,
  type StreamStatus,
  type VisualSettings,
} from './lib/phonkLogic';

const INITIAL_STATUS: StreamStatus = {
  state: 'idle',
  mode: 'autonomous-24-7',
  dryRun: false,
  hasStreamKey: false,
  maskedStreamKey: '',
  rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
  startedAt: null,
  uptimeSec: 0,
  currentTrackId: null,
  currentTrackTitle: '',
  loopCount: 0,
  reconnectAttempts: 0,
  fps: 0,
  bitrateKbps: 0,
  resolution: '1280x720',
  lastError: null,
};

const INITIAL_CONFIG: StreamConfig = {
  rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
  resolution: '1280x720',
  fps: 30,
  videoBitrateKbps: 4500,
  audioBitrateKbps: 192,
  autoReconnect: true,
  mode: 'autonomous-24-7',
  dryRun: false,
};

export default function App() {
  const [tracks, setTracks] = useState<PhonkTrack[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(true);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>(INITIAL_STATUS);
  const [streamConfig, setStreamConfig] = useState<StreamConfig>(INITIAL_CONFIG);
  const [streamActionError, setStreamActionError] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<'broadcast' | 'fx'>('broadcast');

  const [fx, setFx] = useState<AudioFxSettings>({
    bassBoostDb: 4,
    slowedReverb: false,
    reverbMix: 0.35,
    crossfadeSec: 2,
    normalize: true,
    volume: 0.85,
  });

  const [visuals, setVisuals] = useState<VisualSettings>({
    glassBlurPx: 26,
    glassOpacity: 0.56,
    bassPulse: true,
    visualizerStyle: 'bars',
    showLiveBadge: true,
    showUpNext: true,
    ambientDrift: true,
  });

  const player = usePhonkPlayer(tracks, fx);
  const wsRef = useRef<WebSocket | null>(null);
  const broadcastCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  const handleCanvasReady = useCallback((canvas: HTMLCanvasElement | null) => {
    broadcastCanvasRef.current = canvas;
  }, []);

  // Load initial tracks and stream status
  useEffect(() => {
    let active = true;
    const loadInitial = async () => {
      try {
        const [tracksRes, streamRes] = await Promise.all([
          fetch('/api/tracks'),
          fetch('/api/stream/status'),
        ]);
        if (!active) return;
        if (tracksRes.ok) {
          const data = await tracksRes.json();
          if (Array.isArray(data.tracks)) setTracks(data.tracks);
        }
        if (streamRes.ok) {
          const sData = await streamRes.json();
          if (sData.status) setStreamStatus(sData.status);
          if (sData.config) setStreamConfig(sData.config);
        }
      } catch {
        // ignore startup network error
      } finally {
        if (active) setLoadingTracks(false);
      }
    };
    void loadInitial();
    return () => {
      active = false;
    };
  }, []);

  // Live WebSocket telemetry channel
  useEffect(() => {
    let closed = false;
    let reconnectTimer: number | undefined;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/stream`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        try {
          const msg = JSON.parse(event.data);
          if (msg?.type === 'status' && msg.payload) {
            setStreamStatus(msg.payload);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (!closed) {
          reconnectTimer = window.setTimeout(connect, 2500);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const isRelayActive =
    streamStatus.mode === 'canvas-relay' &&
    (streamStatus.state === 'connecting' ||
      streamStatus.state === 'live' ||
      streamStatus.state === 'reconnecting');

  // Start / Stop MediaRecorder when in Canvas Relay live mode
  useEffect(() => {
    if (!isRelayActive) {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      recorderRef.current = null;
      return;
    }

    const canvas = broadcastCanvasRef.current;
    if (!canvas || typeof MediaRecorder === 'undefined') return;

    const videoStream = canvas.captureStream(streamConfig.fps);
    const audioStream = player.getRelayAudioStream();
    const combinedTracks = [...videoStream.getVideoTracks()];
    if (audioStream) {
      combinedTracks.push(...audioStream.getAudioTracks());
    }
    const combined = new MediaStream(combinedTracks);

    const mimeCandidates = [
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm',
    ];
    const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';

    try {
      const recorder = new MediaRecorder(combined, {
        mimeType,
        videoBitsPerSecond: streamConfig.videoBitrateKbps * 1000,
        audioBitsPerSecond: streamConfig.audioBitrateKbps * 1000,
      });

      recorder.ondataavailable = async (ev) => {
        if (ev.data && ev.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
          const buf = await ev.data.arrayBuffer();
          wsRef.current.send(buf);
        }
      };

      recorder.start(500);
      recorderRef.current = recorder;
    } catch {
      // ignore if headless browser restricts MediaRecorder
    }

    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      recorderRef.current = null;
    };
  }, [
    isRelayActive,
    streamConfig.fps,
    streamConfig.videoBitrateKbps,
    streamConfig.audioBitrateKbps,
    player.getRelayAudioStream,
  ]);

  const handleUpdateConfig = async (patch: Partial<StreamConfig> & { streamKey?: string }) => {
    setStreamActionError(null);
    setStreamConfig((prev) => ({ ...prev, ...patch }));
    try {
      const res = await fetch('/api/stream/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status) setStreamStatus(data.status);
        if (data.config) setStreamConfig(data.config);
      }
    } catch {
      setStreamActionError('Failed to save stream configuration.');
    }
  };

  const handleStartBroadcast = async (payload: {
    streamKey: string;
    rtmpUrl: string;
    mode: StreamMode;
    dryRun: boolean;
  }) => {
    setStreamActionError(null);
    try {
      // Ensure audio preview plays in Canvas Relay mode
      if (payload.mode === 'canvas-relay' && !player.isPlaying && tracks.length > 0) {
        await player.togglePlay();
      }
      const res = await fetch('/api/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setStreamActionError(data?.error || 'Could not start broadcast.');
        if (data?.status) setStreamStatus(data.status);
        return;
      }
      if (data.status) setStreamStatus(data.status);
    } catch {
      setStreamActionError('Network error starting broadcast.');
    }
  };

  const handleStopBroadcast = async () => {
    setStreamActionError(null);
    try {
      const res = await fetch('/api/stream/stop', { method: 'POST' });
      const data = await res.json();
      if (data?.status) setStreamStatus(data.status);
    } catch {
      setStreamActionError('Network error stopping broadcast.');
    }
  };

  const handleMoveTrack = async (fromIndex: number, toIndex: number) => {
    const nextList = reorderTracks(tracks, fromIndex, toIndex);
    setTracks(nextList);
    await fetch('/api/tracks/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: nextList.map((t) => t.id) }),
    }).catch(() => undefined);
  };

  const handleRemoveTrack = async (id: string) => {
    const res = await fetch(`/api/tracks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.tracks)) setTracks(data.tracks);
    }
  };

  const handleRenameTrack = async (id: string, title: string) => {
    const res = await fetch(`/api/tracks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.track) {
        setTracks((prev) => prev.map((t) => (t.id === id ? data.track : t)));
      }
    }
  };

  const handleRestoreDemos = async () => {
    const res = await fetch('/api/tracks/restore-demos', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.tracks)) setTracks(data.tracks);
    }
  };

  return (
    <div className="min-h-screen bg-[#08090d] text-zinc-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="border-b border-zinc-800/80 bg-[#0b0c12]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
          <a
            href="#live-stage"
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            PhonkCast 24/7
          </a>

          <nav
            aria-label="Studio sections"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-400"
          >
            <a
              href="#live-stage"
              className="transition-colors hover:text-white whitespace-nowrap shrink-0"
            >
              Live Screen
            </a>
            <a
              href="#loop-queue"
              className="transition-colors hover:text-white whitespace-nowrap shrink-0"
            >
              Loop Playlist
            </a>
            <button
              type="button"
              onClick={() => setPanelTab('broadcast')}
              className="transition-colors hover:text-white whitespace-nowrap shrink-0"
            >
              YouTube RTMP
            </button>
            <button
              type="button"
              onClick={() => setPanelTab('fx')}
              className="transition-colors hover:text-white whitespace-nowrap shrink-0"
            >
              Audio FX & Glass
            </button>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setAddModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-zinc-950 transition-colors hover:bg-zinc-200 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Phonk</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Broadcast Studio Workspace */}
      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
          {/* Primary Column: 16:9 Glassmorphic Live Screen + Sequential Loop Queue */}
          <div className="space-y-6 lg:col-span-8">
            <div id="live-stage">
              <LiveGlassScreen
                currentTrack={player.currentTrack}
                nextTrack={player.nextTrack}
                trackIndex={player.currentIndex}
                totalTracks={tracks.length}
                isPlaying={player.isPlaying}
                elapsedSec={player.elapsedSec}
                durationSec={player.durationSec}
                bassEnergy={player.bassEnergy}
                streamStatus={streamStatus}
                visuals={visuals}
                getFrequencyData={player.getFrequencyData}
                onTogglePlay={() => void player.togglePlay()}
                onNext={player.next}
                onPrevious={player.previous}
                onSeek={player.seekTo}
                onCanvasReady={handleCanvasReady}
              />
            </div>

            {player.audioError && (
              <div
                role="alert"
                className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200"
              >
                {player.audioError}
              </div>
            )}

            <div id="loop-queue">
              {loadingTracks ? (
                <div className="rounded-2xl border border-zinc-800/80 bg-[#101218] p-5 space-y-3">
                  <div className="h-5 w-44 rounded bg-zinc-800 animate-pulse" />
                  <div className="h-14 w-full rounded-lg bg-zinc-900 animate-pulse" />
                  <div className="h-14 w-full rounded-lg bg-zinc-900 animate-pulse" />
                </div>
              ) : (
                <PlaylistQueue
                  tracks={tracks}
                  currentIndex={player.currentIndex}
                  isPlaying={player.isPlaying}
                  shuffle={player.shuffle}
                  onToggleShuffle={() => player.setShuffle((s) => !s)}
                  onSelectTrack={(idx) => void player.playTrackAt(idx)}
                  onMoveTrack={(from, to) => void handleMoveTrack(from, to)}
                  onRemoveTrack={(id) => void handleRemoveTrack(id)}
                  onRenameTrack={handleRenameTrack}
                  onOpenAddModal={() => setAddModalOpen(true)}
                  onRestoreDemos={() => void handleRestoreDemos()}
                />
              )}
            </div>
          </div>

          {/* Control Column: YouTube Direct Stream Key + 24/7 Engine + Phonk Audio FX */}
          <div className="lg:col-span-4 lg:sticky lg:top-6">
            <BroadcastPanel
              streamStatus={streamStatus}
              streamConfig={streamConfig}
              fx={fx}
              visuals={visuals}
              activeTab={panelTab}
              onTabChange={setPanelTab}
              onUpdateConfig={handleUpdateConfig}
              onStartBroadcast={handleStartBroadcast}
              onStopBroadcast={handleStopBroadcast}
              onChangeFx={setFx}
              onChangeVisuals={setVisuals}
              streamActionError={streamActionError}
            />
          </div>
        </div>
      </main>

      <AddPhonkModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onTrackAdded={(track) => {
          setTracks((prev) => [...prev, track]);
        }}
      />
    </div>
  );
}
