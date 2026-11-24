import { CheckCircle2, Film, Upload, Video, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { formatFileSize, formatTimeMMSS, type VideoItem } from '../lib/phonkLogic';

interface AddVideoModalProps {
  open: boolean;
  onClose: () => void;
  onVideoAdded: (video: VideoItem) => void;
}

export function AddVideoModal({ open, onClose, onVideoAdded }: AddVideoModalProps) {
  const [title, setTitle] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [detectedDuration, setDetectedDuration] = useState(0);
  const [detectedDims, setDetectedDims] = useState<{ w: number; h: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (xhrRef.current) {
        xhrRef.current.abort();
        xhrRef.current = null;
      }
    };
  }, []);

  if (!open) return null;

  const resetForm = () => {
    setTitle('');
    setVideoFile(null);
    setDetectedDuration(0);
    setDetectedDims(null);
    setUploading(false);
    setUploadPct(0);
    setUploadedBytes(0);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClose = () => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    resetForm();
    onClose();
  };

  const handleVideoFileChange = (file: File | null) => {
    setVideoFile(file);
    setError(null);
    setDetectedDuration(0);
    setDetectedDims(null);

    if (!file) return;

    if (!title.trim()) {
      const cleanName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      setTitle(cleanName || 'Live Video');
    }

    const objUrl = URL.createObjectURL(file);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.muted = true;
    probe.onloadedmetadata = () => {
      if (Number.isFinite(probe.duration) && probe.duration > 0) {
        setDetectedDuration(Math.round(probe.duration));
      }
      if (probe.videoWidth > 0 && probe.videoHeight > 0) {
        setDetectedDims({ w: probe.videoWidth, h: probe.videoHeight });
      }
      URL.revokeObjectURL(objUrl);
    };
    probe.onerror = () => {
      URL.revokeObjectURL(objUrl);
    };
    probe.src = objUrl;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!videoFile) {
      setError('Please choose a video file (.mp4, .mkv, .mov, .webm, or .ts).');
      return;
    }

    const finalTitle =
      title.trim() || videoFile.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Live Video';

    const formData = new FormData();
    formData.append('title', finalTitle);
    formData.append('durationSec', String(detectedDuration || 60));
    formData.append('video', videoFile);

    setUploading(true);
    setUploadPct(0);
    setUploadedBytes(0);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0) {
        setUploadedBytes(ev.loaded);
        setUploadPct(Math.min(99, Math.round((ev.loaded / ev.total) * 100)));
      }
    };

    xhr.onload = () => {
      xhrRef.current = null;
      let parsed: { video?: VideoItem; error?: string } | null = null;
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        parsed = null;
      }

      if (xhr.status >= 200 && xhr.status < 300 && parsed?.video) {
        setUploadPct(100);
        setUploading(false);
        onVideoAdded(parsed.video);
        resetForm();
        onClose();
      } else {
        setUploading(false);
        setError(parsed?.error || `Video upload failed (${xhr.status}).`);
      }
    };

    xhr.onerror = () => {
      xhrRef.current = null;
      setUploading(false);
      setError('Network error while uploading video file.');
    };

    xhr.onabort = () => {
      xhrRef.current = null;
      setUploading(false);
    };

    xhr.open('POST', '/api/videos');
    xhr.send(formData);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-video-heading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-xl rounded-2xl border border-zinc-800 bg-[#101218] p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-800 pb-4">
          <div>
            <h2 id="add-video-heading" className="font-display text-xl font-bold text-white">
              Upload Video for YouTube Live
            </h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              Upload large MP4, MKV, MOV, or WEBM videos (up to 2 GB) to stream directly 24/7 on YouTube.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close Upload Video modal"
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

          <div>
            <label htmlFor="video-title-input" className="block text-xs font-medium text-zinc-300">
              Video Stream Title
            </label>
            <input
              id="video-title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={uploading}
              placeholder="e.g. 1 Hour Night Drift Mix Full Video"
              className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none disabled:opacity-60"
            />
          </div>

          <div>
            <label
              htmlFor="video-file-input"
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-5 py-7 text-center transition-colors ${
                videoFile
                  ? 'border-emerald-500/45 bg-emerald-500/[0.06]'
                  : 'border-zinc-700 bg-zinc-950/60 hover:border-zinc-500'
              }`}
            >
              {videoFile ? (
                <CheckCircle2 className="h-7 w-7 text-emerald-400" />
              ) : (
                <Film className="h-7 w-7 text-zinc-400" />
              )}
              <span className="mt-2.5 max-w-full truncate text-sm font-semibold text-zinc-100">
                {videoFile ? videoFile.name : 'Select Big Video File'}
              </span>
              <span className="mt-1 text-xs text-zinc-400">
                MP4, MKV, MOV, WEBM, M4V, TS · Up to 2 GB
              </span>
              <input
                ref={fileInputRef}
                id="video-file-input"
                type="file"
                accept="video/*,.mp4,.mkv,.mov,.webm,.m4v,.ts,.avi,.flv"
                disabled={uploading}
                onChange={(e) => handleVideoFileChange(e.target.files?.[0] || null)}
                className="sr-only"
              />
            </label>
          </div>

          {videoFile && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-xs">
              <div className="flex items-center gap-2 text-zinc-200">
                <Video className="h-4 w-4 text-zinc-400" />
                <span className="font-mono-tabular font-semibold">
                  {formatFileSize(videoFile.size)}
                </span>
                {detectedDims && (
                  <>
                    <span className="text-zinc-600">·</span>
                    <span className="font-mono-tabular text-zinc-300">
                      {detectedDims.w}×{detectedDims.h}
                    </span>
                  </>
                )}
                {detectedDuration > 0 && (
                  <>
                    <span className="text-zinc-600">·</span>
                    <span className="font-mono-tabular text-zinc-300">
                      {formatTimeMMSS(detectedDuration)}
                    </span>
                  </>
                )}
              </div>
              <span className="text-[11px] text-zinc-400">Ready for 24/7 RTMP loop</span>
            </div>
          )}

          {uploading && (
            <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/80 p-3.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-200">
                  {uploadPct >= 99 ? 'Processing video metadata & thumbnail...' : 'Uploading video to broadcast server...'}
                </span>
                <span className="font-mono-tabular font-semibold text-white">{uploadPct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-150"
                  style={{ width: `${uploadPct}%` }}
                />
              </div>
              {videoFile && (
                <p className="font-mono-tabular text-[11px] text-zinc-400">
                  {formatFileSize(uploadedBytes)} / {formatFileSize(videoFile.size)}
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-zinc-800 pt-4">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-300 hover:text-white"
            >
              {uploading ? 'Cancel Upload' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={uploading || !videoFile}
              data-testid="submit-video-upload"
              className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>{uploading ? `Uploading (${uploadPct}%)` : 'Upload & Add to Live'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
