import { Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AddVideoModal } from './components/AddVideoModal';
import { BroadcastPanel } from './components/BroadcastPanel';
import { VideoLiveStage } from './components/VideoLiveStage';
import { VideoQueue } from './components/VideoQueue';
import {
  DEFAULT_VIDEO_SHIELD,
  DEFAULT_YOUTUBE_RTMPS_URL,
  getNextLoopIndex,
  getPreviousLoopIndex,
  reorderTracks,
  type QueueEndBehavior,
  type StreamConfig,
  type StreamMode,
  type StreamStatus,
  type VideoItem,
  type VideoShieldSettings,
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
  queueEndBehavior: 'loop',
  autoStopRemainingSec: null,
  stopReason: null,
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
  queueEndBehavior: 'loop',
  autoStopMinutes: 0,
  videoShield: { ...DEFAULT_VIDEO_SHIELD },
  dryRun: false,
};

export default function App() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoShuffle, setVideoShuffle] = useState(false);

  const [streamStatus, setStreamStatus] = useState<StreamStatus>(INITIAL_STATUS);
  const [streamConfig, setStreamConfig] = useState<StreamConfig>(INITIAL_CONFIG);
  const [streamActionError, setStreamActionError] = useState<string | null>(null);
  const [addVideoModalOpen, setAddVideoModalOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<'broadcast' | 'shield'>('broadcast');

  const wsRef = useRef<WebSocket | null>(null);

  // Load initial videos and stream status
  useEffect(() => {
    let active = true;
    const loadInitial = async () => {
      try {
        const [videosRes, streamRes] = await Promise.all([
          fetch('/api/videos'),
          fetch('/api/stream/status'),
        ]);
        if (!active) return;
        if (videosRes.ok) {
          const vData = await videosRes.json();
          if (Array.isArray(vData.videos)) setVideos(vData.videos);
        }
        if (streamRes.ok) {
          const sData = await streamRes.json();
          if (sData.status) setStreamStatus(sData.status);
          if (sData.config) {
            setStreamConfig({
              ...INITIAL_CONFIG,
              ...sData.config,
              videoShield: sData.config.videoShield || DEFAULT_VIDEO_SHIELD,
            });
          }
        }
      } catch {
        // ignore startup network error
      } finally {
        if (active) setLoadingVideos(false);
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
            const nextStatus = msg.payload as StreamStatus;
            setStreamStatus(nextStatus);
            // Stop local stage preview too when broadcast finishes cleanly in auto-stop mode
            if (
              nextStatus.state === 'idle' &&
              (nextStatus.stopReason === 'queue-completed' ||
                nextStatus.stopReason === 'timer-completed')
            ) {
              setIsVideoPlaying(false);
            }
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

  const handleStartBroadcast = async (payload: {
    streamKey: string;
    rtmpUrl: string;
    mode: StreamMode;
    videoEncodeMode?: 'safe-encode' | 'direct-copy';
    queueEndBehavior?: QueueEndBehavior;
    autoStopMinutes?: number;
    videoShield?: VideoShieldSettings;
    dryRun: boolean;
  }) => {
    setStreamActionError(null);
    setStreamConfig((prev) => ({
      ...prev,
      rtmpUrl: payload.rtmpUrl,
      mode: payload.mode,
      ...(payload.videoEncodeMode ? { videoEncodeMode: payload.videoEncodeMode } : {}),
      ...(payload.queueEndBehavior ? { queueEndBehavior: payload.queueEndBehavior } : {}),
      ...(typeof payload.autoStopMinutes === 'number'
        ? { autoStopMinutes: payload.autoStopMinutes }
        : {}),
      ...(payload.videoShield ? { videoShield: payload.videoShield } : {}),
      dryRun: payload.dryRun,
    }));
    try {
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

  const handleJumpLiveVideo = async (videoId: string) => {
    try {
      const res = await fetch('/api/stream/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.status) setStreamStatus(data.status);
      }
    } catch {
      // ignore network error
    }
  };

  // Direct Video Queue actions
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

  const handleClearAllVideos = async () => {
    const res = await fetch('/api/videos/clear', { method: 'POST' });
    if (res.ok) {
      setVideos([]);
      setCurrentVideoIndex(0);
      setIsVideoPlaying(false);
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
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
          <a
            href="#live-stage"
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            VideoCast 24/7
          </a>

          <nav
            aria-label="Broadcast sections"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-400"
          >
            <a
              href="#live-stage"
              className="transition-colors hover:text-white whitespace-nowrap shrink-0"
            >
              Live Stage
            </a>
            <a
              href="#loop-queue"
              className="transition-colors hover:text-white whitespace-nowrap shrink-0"
            >
              Video Queue
            </a>
            <button
              type="button"
              onClick={() => setPanelTab('shield')}
              className={`transition-colors whitespace-nowrap shrink-0 ${
                panelTab === 'shield' ? 'text-white' : 'hover:text-white'
              }`}
            >
              Shield Filters
            </button>
            <button
              type="button"
              onClick={() => setPanelTab('broadcast')}
              className={`transition-colors whitespace-nowrap shrink-0 ${
                panelTab === 'broadcast' ? 'text-white' : 'hover:text-white'
              }`}
            >
              YouTube RTMP
            </button>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              data-testid="primary-upload-cta"
              onClick={() => setAddVideoModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-zinc-950 transition-colors hover:bg-zinc-200 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Upload Videos</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Broadcast Studio Workspace */}
      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
          {/* Primary Column: 16:9 Live Preview Stage + Video Broadcast Queue */}
          <div className="space-y-6 lg:col-span-8">
            <div id="live-stage">
              <VideoLiveStage
                currentVideo={currentVideo}
                nextVideo={nextVideo}
                videoIndex={safeVideoIndex}
                totalVideos={videos.length}
                isPlaying={isVideoPlaying}
                streamStatus={streamStatus}
                shield={streamConfig.videoShield || DEFAULT_VIDEO_SHIELD}
                onTogglePlay={setIsVideoPlaying}
                onNext={handleNextVideo}
                onPrevious={handlePrevVideo}
                onOpenAddModal={() => setAddVideoModalOpen(true)}
              />
            </div>

            <div id="loop-queue">
              {loadingVideos ? (
                <div className="space-y-3 rounded-2xl border border-zinc-800/80 bg-[#101218] p-5">
                  <div className="h-5 w-44 rounded bg-zinc-800 animate-pulse" />
                  <div className="h-14 w-full rounded-lg bg-zinc-900 animate-pulse" />
                  <div className="h-14 w-full rounded-lg bg-zinc-900 animate-pulse" />
                </div>
              ) : (
                <VideoQueue
                  videos={videos}
                  currentIndex={safeVideoIndex}
                  isPlaying={isVideoPlaying}
                  isBroadcasting={isBroadcasting}
                  activeLiveVideoId={streamStatus.currentTrackId}
                  shuffle={videoShuffle}
                  queueEndBehavior={streamConfig.queueEndBehavior || 'loop'}
                  onToggleShuffle={() => setVideoShuffle((s) => !s)}
                  onSelectVideo={handleSelectVideo}
                  onJumpLiveVideo={(id) => void handleJumpLiveVideo(id)}
                  onMoveVideo={(from, to) => void handleMoveVideo(from, to)}
                  onRemoveVideo={(id) => void handleRemoveVideo(id)}
                  onClearAll={() => void handleClearAllVideos()}
                  onRenameVideo={handleRenameVideo}
                  onOpenAddModal={() => setAddVideoModalOpen(true)}
                />
              )}
            </div>
          </div>

          {/* Control Column: YouTube Direct Stream Key + Auto-Stop + Copyright Shield */}
          <div className="lg:col-span-4 lg:sticky lg:top-6">
            <BroadcastPanel
              streamStatus={streamStatus}
              streamConfig={streamConfig}
              activeTab={panelTab}
              onTabChange={setPanelTab}
              onUpdateConfig={handleUpdateConfig}
              onStartBroadcast={handleStartBroadcast}
              onStopBroadcast={handleStopBroadcast}
              streamActionError={streamActionError}
            />
          </div>
        </div>
      </main>

      <AddVideoModal
        open={addVideoModalOpen}
        onClose={() => setAddVideoModalOpen(false)}
        onVideosAdded={(added) => {
          setVideos((prev) => [...prev, ...added]);
        }}
      />
    </div>
  );
}
