import { Film, Music2, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AddPhonkModal } from './components/AddPhonkModal';
import { AddVideoModal } from './components/AddVideoModal';
import { BroadcastPanel } from './components/BroadcastPanel';
import { LiveGlassScreen } from './components/LiveGlassScreen';
import { PlaylistQueue } from './components/PlaylistQueue';
import { VideoLiveStage } from './components/VideoLiveStage';
import { VideoQueue } from './components/VideoQueue';
import { usePhonkPlayer } from './hooks/usePhonkPlayer';
import {
  DEFAULT_YOUTUBE_RTMPS_URL,
  getNextLoopIndex,
  getPreviousLoopIndex,
  reorderTracks,
  type AudioFxSettings,
  type PhonkTrack,
  type StreamConfig,
  type StreamMode,
  type StreamStatus,
  type VideoItem,
  type VisualSettings,
} from './lib/phonkLogic';

const INITIAL_STATUS: StreamStatus = {
  state: 'idle',
  mode: 'video-24-7',
  dryRun: false,
  hasStreamKey: false,
  maskedStreamKey: '',
  rtmpUrl: DEFAULT_YOUTUBE_RTMPS_URL,
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
  rtmpUrl: DEFAULT_YOUTUBE_RTMPS_URL,
  resolution: '1280x720',
  fps: 30,
  videoBitrateKbps: 4500,
  audioBitrateKbps: 192,
  autoReconnect: true,
  mode: 'video-24-7',
  videoEncodeMode: 'safe-encode',
  dryRun: false,
};

export default function App() {
  const [studioMode, setStudioMode] = useState<'video' | 'phonk'>('video');
  const [tracks, setTracks] = useState<PhonkTrack[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(true);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoShuffle, setVideoShuffle] = useState(false);

  const [streamStatus, setStreamStatus] = useState<StreamStatus>(INITIAL_STATUS);
  const [streamConfig, setStreamConfig] = useState<StreamConfig>(INITIAL_CONFIG);
  const [streamActionError, setStreamActionError] = useState<string | null>(null);
  const [addPhonkModalOpen, setAddPhonkModalOpen] = useState(false);
  const [addVideoModalOpen, setAddVideoModalOpen] = useState(false);
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

  // Load initial tracks, videos, and stream status
  useEffect(() => {
    let active = true;
    const loadInitial = async () => {
      try {
        const [tracksRes, videosRes, streamRes] = await Promise.all([
          fetch('/api/tracks'),
          fetch('/api/videos'),
          fetch('/api/stream/status'),
        ]);
        if (!active) return;
        if (tracksRes.ok) {
          const data = await tracksRes.json();
          if (Array.isArray(data.tracks)) setTracks(data.tracks);
        }
        if (videosRes.ok) {
          const vData = await videosRes.json();
          if (Array.isArray(vData.videos)) setVideos(vData.videos);
        }
        if (streamRes.ok) {
          const sData = await streamRes.json();
          if (sData.status) setStreamStatus(sData.status);
          if (sData.config) {
            setStreamConfig(sData.config);
            if (
              sData.status &&
              sData.status.state !== 'idle' &&
              sData.status.state !== 'error'
            ) {
              setStudioMode(sData.status.mode === 'video-24-7' ? 'video' : 'phonk');
            } else {
              setStudioMode(sData.config.mode === 'video-24-7' ? 'video' : 'phonk');
            }
          }
        }
      } catch {
        // ignore startup network error
      } finally {
        if (active) setLoadingMedia(false);
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

  const isBroadcasting =
    streamStatus.state === 'live' ||
    streamStatus.state === 'connecting' ||
    streamStatus.state === 'reconnecting';

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

  const handleSwitchStudioMode = (nextMode: 'video' | 'phonk') => {
    if (isBroadcasting || nextMode === studioMode) return;
    setStudioMode(nextMode);
    if (nextMode === 'video') {
      setPanelTab('broadcast');
      if (player.isPlaying) {
        void player.togglePlay();
      }
      void handleUpdateConfig({ mode: 'video-24-7' });
    } else {
      setIsVideoPlaying(false);
      void handleUpdateConfig({
        mode: streamConfig.mode === 'canvas-relay' ? 'canvas-relay' : 'autonomous-24-7',
      });
    }
  };

  const handleStartBroadcast = async (payload: {
    streamKey: string;
    rtmpUrl: string;
    mode: StreamMode;
    videoEncodeMode?: 'safe-encode' | 'direct-copy';
    dryRun: boolean;
  }) => {
    setStreamActionError(null);
    setStreamConfig((prev) => ({
      ...prev,
      rtmpUrl: payload.rtmpUrl,
      mode: payload.mode,
      ...(payload.videoEncodeMode ? { videoEncodeMode: payload.videoEncodeMode } : {}),
      dryRun: payload.dryRun,
    }));
    try {
      if (payload.mode === 'canvas-relay' && !player.isPlaying && tracks.length > 0) {
        await player.togglePlay();
      }
      const res = await fetch('/api/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, visuals }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStreamActionError(data?.error || 'Could not start broadcast.');
        if (data?.status) setStreamStatus(data.status);
        return;
      }
      if (data.status) {
        setStreamStatus(data.status);
        if (typeof data.status.rtmpUrl === 'string') {
          setStreamConfig((prev) => ({ ...prev, rtmpUrl: data.status.rtmpUrl }));
        }
      }
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

  // Phonk track actions
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

  // Direct Video actions
  const safeVideoIndex = videos.length > 0 ? Math.min(currentVideoIndex, videos.length - 1) : 0;
  const currentVideo = videos.length > 0 ? videos[safeVideoIndex] : null;
  const nextVideoIdx = getNextLoopIndex(safeVideoIndex, videos.length, videoShuffle);
  const nextVideo =
    videos.length > 1 && nextVideoIdx >= 0 && nextVideoIdx < videos.length
      ? videos[nextVideoIdx]
      : null;

  const handleNextVideo = useCallback(() => {
    setCurrentVideoIndex((idx) => {
      const next = getNextLoopIndex(idx, videos.length, videoShuffle);
      return next < 0 ? 0 : next;
    });
  }, [videos.length, videoShuffle]);

  const handlePrevVideo = useCallback(() => {
    setCurrentVideoIndex((idx) => {
      const prev = getPreviousLoopIndex(idx, videos.length);
      return prev < 0 ? 0 : prev;
    });
  }, [videos.length]);

  const handleSelectVideo = useCallback((idx: number) => {
    setCurrentVideoIndex(idx);
    setIsVideoPlaying(true);
  }, []);

  const handleMoveVideo = async (fromIndex: number, toIndex: number) => {
    const nextList = reorderTracks(videos, fromIndex, toIndex);
    setVideos(nextList);
    if (safeVideoIndex === fromIndex) {
      setCurrentVideoIndex(toIndex);
    }
    await fetch('/api/videos/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: nextList.map((v) => v.id) }),
    }).catch(() => undefined);
  };

  const handleRemoveVideo = async (id: string) => {
    const res = await fetch(`/api/videos/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.videos)) {
        setVideos(data.videos);
        if (currentVideoIndex >= data.videos.length) {
          setCurrentVideoIndex(Math.max(0, data.videos.length - 1));
        }
        if (data.videos.length === 0) {
          setIsVideoPlaying(false);
        }
      }
    }
  };

  const handleRenameVideo = async (id: string, title: string) => {
    const res = await fetch(`/api/videos/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.video) {
        setVideos((prev) => prev.map((v) => (v.id === id ? data.video : v)));
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#08090d] text-zinc-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="border-b border-zinc-800/80 bg-[#0b0c12]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-6 px-4 py-3.5 sm:px-6">
          <a
            href="#live-stage"
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            PhonkCast 24/7
          </a>

          <nav
            aria-label="Studio mode and sections"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-400"
          >
            <button
              type="button"
              disabled={isBroadcasting}
              onClick={() => handleSwitchStudioMode('video')}
              aria-pressed={studioMode === 'video'}
              className={`inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 ${
                studioMode === 'video' ? 'text-white font-semibold' : 'hover:text-white'
              }`}
            >
              <Film className="h-3.5 w-3.5" />
              <span>Direct Video Live</span>
            </button>
            <button
              type="button"
              disabled={isBroadcasting}
              onClick={() => handleSwitchStudioMode('phonk')}
              aria-pressed={studioMode === 'phonk'}
              className={`inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 ${
                studioMode === 'phonk' ? 'text-white font-semibold' : 'hover:text-white'
              }`}
            >
              <Music2 className="h-3.5 w-3.5" />
              <span>Phonk Music + Cover</span>
            </button>
            <a
              href="#loop-queue"
              className="transition-colors hover:text-white whitespace-nowrap shrink-0"
            >
              Loop Queue
            </a>
            <button
              type="button"
              onClick={() => setPanelTab('broadcast')}
              className="transition-colors hover:text-white whitespace-nowrap shrink-0"
            >
              YouTube RTMP
            </button>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              data-testid="primary-upload-cta"
              onClick={() => {
                if (studioMode === 'video') {
                  setAddVideoModalOpen(true);
                } else {
                  setAddPhonkModalOpen(true);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-zinc-950 transition-colors hover:bg-zinc-200 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{studioMode === 'video' ? 'Upload Video' : 'Add Phonk'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Broadcast Studio Workspace */}
      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
        {/* Compact Mode Switcher for mobile viewports */}
        <div className="mb-4 flex items-center gap-1.5 rounded-xl border border-zinc-800/80 bg-[#101218] p-1 md:hidden">
          <button
            type="button"
            disabled={isBroadcasting}
            onClick={() => handleSwitchStudioMode('video')}
            aria-pressed={studioMode === 'video'}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-60 ${
              studioMode === 'video' ? 'bg-zinc-800 text-white' : 'text-zinc-400'
            }`}
          >
            <Film className="h-3.5 w-3.5" />
            <span>Direct Video Live</span>
          </button>
          <button
            type="button"
            disabled={isBroadcasting}
            onClick={() => handleSwitchStudioMode('phonk')}
            aria-pressed={studioMode === 'phonk'}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-60 ${
              studioMode === 'phonk' ? 'bg-zinc-800 text-white' : 'text-zinc-400'
            }`}
          >
            <Music2 className="h-3.5 w-3.5" />
            <span>Phonk Music + Cover</span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
          {/* Primary Column: 16:9 Live Screen + Sequential Loop Queue */}
          <div className="space-y-6 lg:col-span-8">
            <div id="live-stage">
              {studioMode === 'video' ? (
                <VideoLiveStage
                  currentVideo={currentVideo}
                  nextVideo={nextVideo}
                  videoIndex={safeVideoIndex}
                  totalVideos={videos.length}
                  isPlaying={isVideoPlaying}
                  streamStatus={streamStatus}
                  onTogglePlay={setIsVideoPlaying}
                  onNext={handleNextVideo}
                  onPrevious={handlePrevVideo}
                  onOpenAddModal={() => setAddVideoModalOpen(true)}
                />
              ) : (
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
              )}
            </div>

            {studioMode === 'phonk' && player.audioError && (
              <div
                role="alert"
                className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200"
              >
                {player.audioError}
              </div>
            )}

            <div id="loop-queue">
              {loadingMedia ? (
                <div className="space-y-3 rounded-2xl border border-zinc-800/80 bg-[#101218] p-5">
                  <div className="h-5 w-44 rounded bg-zinc-800 animate-pulse" />
                  <div className="h-14 w-full rounded-lg bg-zinc-900 animate-pulse" />
                  <div className="h-14 w-full rounded-lg bg-zinc-900 animate-pulse" />
                </div>
              ) : studioMode === 'video' ? (
                <VideoQueue
                  videos={videos}
                  currentIndex={safeVideoIndex}
                  isPlaying={isVideoPlaying}
                  shuffle={videoShuffle}
                  onToggleShuffle={() => setVideoShuffle((s) => !s)}
                  onSelectVideo={handleSelectVideo}
                  onMoveVideo={(from, to) => void handleMoveVideo(from, to)}
                  onRemoveVideo={(id) => void handleRemoveVideo(id)}
                  onRenameVideo={handleRenameVideo}
                  onOpenAddModal={() => setAddVideoModalOpen(true)}
                />
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
                  onOpenAddModal={() => setAddPhonkModalOpen(true)}
                  onRestoreDemos={() => void handleRestoreDemos()}
                />
              )}
            </div>
          </div>

          {/* Control Column: YouTube Direct Stream Key + 24/7 Engine + Phonk Audio FX */}
          <div className="lg:col-span-4 lg:sticky lg:top-6">
            <BroadcastPanel
              studioMode={studioMode}
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
              onChangeVisuals={(nextVisuals) => {
                setVisuals(nextVisuals);
                void handleUpdateConfig({ visuals: nextVisuals });
              }}
              streamActionError={streamActionError}
            />
          </div>
        </div>
      </main>

      <AddVideoModal
        open={addVideoModalOpen}
        onClose={() => setAddVideoModalOpen(false)}
        onVideoAdded={(video) => {
          setVideos((prev) => [...prev, video]);
        }}
      />

      <AddPhonkModal
        open={addPhonkModalOpen}
        onClose={() => setAddPhonkModalOpen(false)}
        onTrackAdded={(track) => {
          setTracks((prev) => [...prev, track]);
        }}
      />
    </div>
  );
}
