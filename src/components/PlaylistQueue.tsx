import {
  ArrowDown,
  ArrowUp,
  Disc3,
  Music,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  Shuffle,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { formatTimeMMSS, type PhonkTrack } from '../lib/phonkLogic';

interface PlaylistQueueProps {
  tracks: PhonkTrack[];
  currentIndex: number;
  isPlaying: boolean;
  shuffle: boolean;
  onToggleShuffle: () => void;
  onSelectTrack: (index: number) => void;
  onMoveTrack: (fromIndex: number, toIndex: number) => void;
  onRemoveTrack: (id: string) => void;
  onRenameTrack: (id: string, title: string) => Promise<void>;
  onOpenAddModal: () => void;
  onRestoreDemos: () => void;
}

export function PlaylistQueue({
  tracks,
  currentIndex,
  isPlaying,
  shuffle,
  onToggleShuffle,
  onSelectTrack,
  onMoveTrack,
  onRemoveTrack,
  onRenameTrack,
  onOpenAddModal,
  onRestoreDemos,
}: PlaylistQueueProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [search, setSearch] = useState('');

  const totalSec = tracks.reduce((acc, t) => acc + (t.durationSec || 0), 0);

  const filtered = tracks
    .map((track, originalIndex) => ({ track, originalIndex }))
    .filter(({ track }) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        track.title.toLowerCase().includes(q) ||
        track.artist.toLowerCase().includes(q) ||
        track.subgenre.toLowerCase().includes(q)
      );
    });

  const commitEdit = async (id: string) => {
    const trimmed = draftTitle.trim();
    if (trimmed) {
      await onRenameTrack(id, trimmed);
    }
    setEditingId(null);
  };

  return (
    <section
      aria-label="Phonk Loop Playlist"
      className="flex flex-col rounded-2xl border border-zinc-800/80 bg-[#101218] p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-white">
            Sequential Loop Queue
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400 font-mono-tabular">
            {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'} · {formatTimeMMSS(totalSec)} total cycle
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

      {tracks.length > 0 && (
        <div className="mt-4">
          <label htmlFor="playlist-filter" className="sr-only">
            Filter Phonk tracks
          </label>
          <input
            id="playlist-filter"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tracks by name, artist, or style..."
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950/70 px-3.5 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
          />
        </div>
      )}

      {tracks.length === 0 ? (
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-6 py-12 text-center">
          <Music className="h-9 w-9 text-zinc-500" />
          <p className="mt-3 text-sm font-medium text-zinc-200">
            Your Phonk loop queue is empty
          </p>
          <p className="mt-1 max-w-sm text-xs text-zinc-400">
            Upload your Phonk audio files with cover pictures and names, or restore the starter Phonk pack.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onOpenAddModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-zinc-200"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add First Phonk</span>
            </button>
            <button
              type="button"
              onClick={onRestoreDemos}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Restore Starter Pack</span>
            </button>
          </div>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-800/70" data-testid="playlist-track-list">
          {filtered.map(({ track, originalIndex }) => {
            const isActive = originalIndex === currentIndex;
            const isEditing = editingId === track.id;

            return (
              <li
                key={track.id}
                data-testid="playlist-track-item"
                className={`group flex flex-wrap items-center justify-between gap-2.5 py-3 px-2.5 rounded-lg transition-colors sm:flex-nowrap sm:gap-3 ${
                  isActive ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3 basis-full sm:basis-auto">
                  <span
                    className="font-mono-tabular w-6 shrink-0 text-center text-xs font-medium"
                    style={{ color: isActive ? track.palette.accent : '#71717a' }}
                  >
                    {String(originalIndex + 1).padStart(2, '0')}
                  </span>

                  <button
                    type="button"
                    onClick={() => onSelectTrack(originalIndex)}
                    aria-label={`Play ${track.title}`}
                    className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-white/15 bg-zinc-900 focus-visible:outline-2 focus-visible:outline-white"
                  >
                    <img
                      src={track.coverUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                    {isActive && isPlaying && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 flex items-center justify-center bg-black/45"
                      >
                        <Disc3 className="h-4 w-4 text-white animate-spin" />
                      </span>
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void commitEdit(track.id);
                        }}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="text"
                          value={draftTitle}
                          onChange={(e) => setDraftTitle(e.target.value)}
                          onBlur={() => void commitEdit(track.id)}
                          autoFocus
                          aria-label="Edit track title"
                          className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-sm text-white focus:outline-none"
                        />
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelectTrack(originalIndex)}
                        className="block w-full text-left focus-visible:outline-none"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: track.palette.accent }}
                            aria-hidden="true"
                          />
                          <span className="truncate text-sm font-semibold text-white">
                            {track.title}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-400 truncate">
                          <span>{track.artist}</span>
                          <span aria-hidden="true">·</span>
                          <span>{track.subgenre}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-tabular">{formatTimeMMSS(track.durationSec)}</span>
                        </div>
                      </button>
                    )}
                  </div>
                </div>

                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onMoveTrack(originalIndex, originalIndex - 1)}
                    disabled={originalIndex === 0}
                    aria-label={`Move ${track.title} up`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-25"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveTrack(originalIndex, originalIndex + 1)}
                    disabled={originalIndex === tracks.length - 1}
                    aria-label={`Move ${track.title} down`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-25"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(track.id);
                      setDraftTitle(track.title);
                    }}
                    aria-label={`Rename ${track.title}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-white"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveTrack(track.id)}
                    aria-label={`Remove ${track.title}`}
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
