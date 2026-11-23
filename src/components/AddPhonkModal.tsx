import { Disc3, ImagePlus, Music2, Upload, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { extractPaletteFromImage } from '../lib/colorExtractor';
import { buildPaletteFromRGB, type PhonkTrack, type TrackPalette } from '../lib/phonkLogic';

interface AddPhonkModalProps {
  open: boolean;
  onClose: () => void;
  onTrackAdded: (track: PhonkTrack) => void;
}

const SUBGENRES = [
  'Drift Phonk',
  'Brazilian Phonk',
  'Memphis Phonk',
  'Atmospheric Phonk',
  'Aggressive Phonk',
];

export function AddPhonkModal({ open, onClose, onTrackAdded }: AddPhonkModalProps) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [subgenre, setSubgenre] = useState(SUBGENRES[0]);
  const [bpm, setBpm] = useState('138');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [previewPalette, setPreviewPalette] = useState<TrackPalette>(() =>
    buildPaletteFromRGB(214, 34, 54)
  );
  const [detectedDuration, setDetectedDuration] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    };
  }, [coverPreviewUrl]);

  if (!open) return null;

  const handleAudioChange = (file: File | null) => {
    setAudioFile(file);
    setError(null);
    if (!file) {
      setDetectedDuration(0);
      return;
    }
    if (!title.trim()) {
      const cleanName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      setTitle(cleanName);
    }
    // Probe duration in browser
    const objectUrl = URL.createObjectURL(file);
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      if (Number.isFinite(probe.duration) && probe.duration > 0) {
        setDetectedDuration(Math.round(probe.duration));
      }
      URL.revokeObjectURL(objectUrl);
    };
    probe.onerror = () => URL.revokeObjectURL(objectUrl);
    probe.src = objectUrl;
  };

  const handleCoverChange = async (file: File | null) => {
    if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    setCoverFile(file);
    setError(null);
    if (!file) {
      setCoverPreviewUrl(null);
      setPreviewPalette(buildPaletteFromRGB(214, 34, 54));
      return;
    }
    const url = URL.createObjectURL(file);
    setCoverPreviewUrl(url);
    const extracted = await extractPaletteFromImage(url);
    setPreviewPalette(extracted);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Please enter a Phonk track name.');
      return;
    }
    if (!audioFile) {
      setError('Please select an audio file (.mp3, .wav, .ogg, .flac, or .m4a).');
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('title', title.trim());
      formData.append('artist', artist.trim() || 'Phonk Studio');
      formData.append('subgenre', subgenre);
      formData.append('bpm', bpm);
      formData.append('durationSec', String(detectedDuration || 60));
      formData.append('palette', JSON.stringify(previewPalette));
      formData.append('audio', audioFile);
      if (coverFile) {
        formData.append('cover', coverFile);
      }

      const res = await fetch('/api/tracks', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Failed to upload Phonk track.');
        setSubmitting(false);
        return;
      }

      onTrackAdded(data.track);
      setTitle('');
      setArtist('');
      setSubgenre(SUBGENRES[0]);
      setBpm('138');
      setAudioFile(null);
      setCoverFile(null);
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
      setCoverPreviewUrl(null);
      setPreviewPalette(buildPaletteFromRGB(214, 34, 54));
      setDetectedDuration(0);
      setSubmitting(false);
      onClose();
    } catch {
      setError('Network error while uploading track.');
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-phonk-heading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-xl rounded-2xl border border-zinc-800 bg-[#101218] p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-800 pb-4">
          <div>
            <h2 id="add-phonk-heading" className="font-display text-xl font-bold text-white">
              Add Phonk to Live Loop
            </h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              Cover picture colors automatically theme the glassmorphic broadcast screen.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Add Phonk modal"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs font-medium text-red-300"
            >
              {error}
            </div>
          )}

          {/* Cover preview & extracted glass theme preview */}
          <div
            className="flex items-center gap-4 rounded-xl border p-3.5 transition-colors"
            style={{
              backgroundColor: previewPalette.glassBgRgba,
              borderColor: previewPalette.glassBorderRgba,
            }}
          >
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-white/20 bg-zinc-900">
              {coverPreviewUrl ? (
                <img
                  src={coverPreviewUrl}
                  alt="Cover preview"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-zinc-500">
                  <Disc3 className="h-7 w-7" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: previewPalette.accent }}>
                Glass Screen Color Theme
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold text-white">
                {title.trim() || 'Untitled Phonk Track'}
              </p>
              <div className="mt-1.5 flex items-center gap-2 text-xs text-zinc-300 font-mono-tabular">
                <span
                  className="inline-block h-3 w-3 rounded-sm border border-white/25"
                  style={{ backgroundColor: previewPalette.primary }}
                  aria-hidden="true"
                />
                <span>{previewPalette.primary}</span>
                <span aria-hidden="true">·</span>
                <span>{previewPalette.accent}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="phonk-title" className="block text-xs font-medium text-zinc-300">
                Phonk Track Name
              </label>
              <input
                id="phonk-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Tokyo Midnight Drift"
                className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="phonk-artist" className="block text-xs font-medium text-zinc-300">
                Producer / Artist
              </label>
              <input
                id="phonk-artist"
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="e.g. Kurogane 808"
                className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="phonk-subgenre" className="block text-xs font-medium text-zinc-300">
                Phonk Style
              </label>
              <select
                id="phonk-subgenre"
                value={subgenre}
                onChange={(e) => setSubgenre(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none"
              >
                {SUBGENRES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="phonk-bpm" className="block text-xs font-medium text-zinc-300">
                Tempo (BPM)
              </label>
              <input
                id="phonk-bpm"
                type="number"
                min={60}
                max={220}
                value={bpm}
                onChange={(e) => setBpm(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white font-mono-tabular focus:border-zinc-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="phonk-audio-file"
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-zinc-700 bg-zinc-950/60 px-4 py-4 text-center transition-colors hover:border-zinc-500"
              >
                <Music2 className="h-5 w-5 text-zinc-400" />
                <span className="mt-1.5 text-xs font-semibold text-zinc-200">
                  {audioFile ? audioFile.name : 'Select Phonk Audio File'}
                </span>
                <span className="mt-0.5 text-[11px] text-zinc-500">
                  MP3, WAV, OGG, FLAC, M4A
                </span>
                <input
                  id="phonk-audio-file"
                  type="file"
                  accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a"
                  onChange={(e) => handleAudioChange(e.target.files?.[0] || null)}
                  className="sr-only"
                />
              </label>
            </div>

            <div>
              <label
                htmlFor="phonk-cover-file"
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-zinc-700 bg-zinc-950/60 px-4 py-4 text-center transition-colors hover:border-zinc-500"
              >
                <ImagePlus className="h-5 w-5 text-zinc-400" />
                <span className="mt-1.5 text-xs font-semibold text-zinc-200">
                  {coverFile ? coverFile.name : 'Select Cover Picture'}
                </span>
                <span className="mt-0.5 text-[11px] text-zinc-500">
                  JPG, PNG, WEBP (Auto Color Glass)
                </span>
                <input
                  id="phonk-cover-file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => void handleCoverChange(e.target.files?.[0] || null)}
                  className="sr-only"
                />
              </label>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-zinc-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-300 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>{submitting ? 'Uploading...' : 'Add to Loop Queue'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
