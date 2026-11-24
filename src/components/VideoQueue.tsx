import {
  ArrowDown,
  ArrowUp,
  Film,
  Pencil,
  Play,
  Plus,
  Repeat,
  Shuffle,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { formatFileSize, formatTimeMMSS, type VideoItem } from '../lib/phonkLogic';

interface VideoQueueProps {
  videos: VideoItem[];
  currentIndex: number;
  isPlaying: boolean;
  shuffle: boolean;
  onToggleShuffle: () => void;
  onSelectVideo: (index: number) => void;
  onMoveVideo: (fromIndex: number, toIndex: number) => void;
  onRemoveVideo: (id: string) => void;
  onRenameVideo: (id: string, title: string) => Promise<void>;
  onOpenAddModal: () => void;
}

export function VideoQueue({
  videos,
  currentIndex,
  isPlaying,
  shuffle,
  onToggleShuffle,
  onSelectVideo,
  onMoveVideo,
  onRemoveVideo,
  onRenameVideo,
  onOpenAddModal,
}: VideoQueueProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [search, setSearch] = useState('');

  const totalSec = videos.reduce((acc, v) => acc + (v.durationSec || 0), 0);

  const filtered = videos
    .map((video, originalIndex) => ({ video, originalIndex }))
    .filter(({ video }) => {
      if (!search.trim()) return true;
      return video.title.toLowerCase().includes(search.trim().toLowerCase());
    });

  const commitEdit = async (id: string) => {
    const trimmed = draftTitle.trim();
    if (trimmed) {
      await onRenameVideo(id, trimmed);
    }
    setEditingId(null);
  };

  return (
    <section
      aria-label="Direct Video Loop Queue"
      className="flex flex-col rounded-2xl border border-zinc-800/80 bg-[#101218] p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-white">Video Loop Queue</h2>
          <p className="mt-0.5 font-mono-tabular text-xs text-zinc-400">
            {videos.length} {videos.length === 1 ? 'video' : 'videos'} · {formatTimeMMSS(totalSec)} total cycle
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleShuffle}
            aria-pressed={shuffle}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              shuffle
                ? 'border-white/30 bg-white/15 text-white'
                : 'border-zinc-800 bg-zinc-900/80 text-zinc-300 hover:text-white'
            }`}
          >
            {shuffle ? <Shuffle className="h-3.5 w-3.5" /> : <Repeat className="h-3.5 w-3.5" />}
            <span>{shuffle ? 'Shuffle Loop' : 'Sequential Loop'}</span>
          </button>
        </div>
      </div>

      {videos.length > 0 && (
        <div className="mt-4">
          <label htmlFor="video-playlist-filter" className="sr-only">
            Filter uploaded videos
          </label>
          <input
            id="video-playlist-filter"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search uploaded videos by title..."
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950/70 px-3.5 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
          />
        </div>
      )}

      {videos.length === 0 ? (
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-6 py-12 text-center">
          <Film className="h-9 w-9 text-zinc-500" />
          <p className="mt-3 text-sm font-medium text-zinc-200">No big videos uploaded yet</p>
          <p className="mt-1 max-w-sm text-xs text-zinc-400">
            Upload full MP4, MKV, MOV, or WEBM video files to broadcast directly on YouTube Live 24/7.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onOpenAddModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-zinc-200"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Upload Big Video</span>
            </button>
          </div>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-800/70" data-testid="video-queue-list">
          {filtered.map(({ video, originalIndex }) => {
            const isActive = originalIndex === currentIndex;
            const isEditing = editingId === video.id;

            return (
              <li
                key={video.id}
                data-testid="video-queue-item"
                className={`group flex flex-wrap items-center justify-between gap-2.5 rounded-lg px-2.5 py-3 transition-colors sm:flex-nowrap sm:gap-3 ${
                  isActive ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                }`}
              >
                <div className="flex min-w-0 flex-1 basis-full items-center gap-3 sm:basis-auto">
                  <span
                    className={`font-mono-tabular w-6 shrink-0 text-center text-xs font-medium ${
                      isActive ? 'text-[#ff4d5a]' : 'text-zinc-500'
                    }`}
                  >
                    {String(originalIndex + 1).padStart(2, '0')}
                  </span>

                  <button
                    type="button"
                    onClick={() => onSelectVideo(originalIndex)}
                    aria-label={`Preview ${video.title}`}
                    className="relative h-11 w-16 shrink-0 overflow-hidden rounded-lg border border-white/15 bg-zinc-900 focus-visible:outline-2 focus-visible:outline-white sm:w-20"
                  >
                    <img
                      src={video.thumbnailUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                    {isActive && isPlaying && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 flex items-center justify-center bg-black/50"
                      >
                        <Play className="h-4 w-4 fill-white text-white" />
                      </span>
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void commitEdit(video.id);
                        }}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="text"
                          value={draftTitle}
                          onChange={(e) => setDraftTitle(e.target.value)}
                          onBlur={() => void commitEdit(video.id)}
                          autoFocus
                          aria-label="Edit video title"
                          className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-sm text-white focus:outline-none"
                        />
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelectVideo(originalIndex)}
                        className="block w-full text-left focus-visible:outline-none"
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-white">
                            {video.title}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
                          <span className="font-mono-tabular">
                            {video.width}×{video.height}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-tabular uppercase">
                            {video.videoCodec || 'video'}
                            {video.hasAudio ? `/${video.audioCodec || 'audio'}` : ' (silent)'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-tabular">
                            {formatFileSize(video.fileSizeBytes)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-tabular">
                            {formatTimeMMSS(video.durationSec)}
                          </span>
                        </div>
                      </button>
                    )}
                  </div>
                </div>

                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onMoveVideo(originalIndex, originalIndex - 1)}
                    disabled={originalIndex === 0}
                    aria-label={`Move ${video.title} up`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-25"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveVideo(originalIndex, originalIndex + 1)}
                    disabled={originalIndex === videos.length - 1}
                    aria-label={`Move ${video.title} down`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-25"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(video.id);
                      setDraftTitle(video.title);
                    }}
                    aria-label={`Rename ${video.title}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-white"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveVideo(video.id)}
                    aria-label={`Remove ${video.title}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-red-500/15 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
