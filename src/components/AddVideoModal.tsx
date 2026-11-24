import { CheckCircle2, Film, Plus, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import {
  calculateUploadChunks,
  formatFileSize,
  isLikelyVideoFile,
  UPLOAD_CHUNK_SIZE_BYTES,
  type VideoItem,
} from '../lib/phonkLogic';

interface AddVideoModalProps {
  open: boolean;
  onClose: () => void;
  onVideosAdded: (videos: VideoItem[]) => void;
}

interface PendingFile {
  id: string;
  file: File;
  title: string;
  status: 'queued' | 'uploading' | 'processing' | 'done' | 'error';
  progressPct: number;
  uploadedBytes: number;
  error?: string;
}

export function AddVideoModal({ open, onClose, onVideosAdded }: AddVideoModalProps) {
  const [queue, setQueue] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const activeUploadIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (xhrRef.current) {
        xhrRef.current.abort();
        xhrRef.current = null;
      }
      if (activeUploadIdRef.current) {
        void fetch(`/api/videos/upload/${encodeURIComponent(activeUploadIdRef.current)}`, {
          method: 'DELETE',
        }).catch(() => undefined);
        activeUploadIdRef.current = null;
      }
    };
  }, []);

  if (!open) return null;

  const resetModal = () => {
    setQueue([]);
    setUploading(false);
    setDragOver(false);
    setError(null);
    cancelledRef.current = false;
    activeUploadIdRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClose = () => {
    cancelledRef.current = true;
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    if (activeUploadIdRef.current) {
      void fetch(`/api/videos/upload/${encodeURIComponent(activeUploadIdRef.current)}`, {
        method: 'DELETE',
      }).catch(() => undefined);
      activeUploadIdRef.current = null;
    }
    resetModal();
    onClose();
  };

  const addFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    const picked = Array.from(fileList);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    const items: PendingFile[] = [];
    const rejectedNames: string[] = [];

    for (let i = 0; i < picked.length; i += 1) {
      const f = picked[i];
      if (f.size <= 0) {
        rejectedNames.push(`${f.name} (empty file)`);
        continue;
      }
      if (!isLikelyVideoFile(f.name, f.type)) {
        rejectedNames.push(`${f.name} (not a supported video)`);
        continue;
      }
      const cleanName = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Live Video';
      items.push({
        id: `${Date.now()}-${i}-${f.name}`,
        file: f,
        title: cleanName,
        status: 'queued',
        progressPct: 0,
        uploadedBytes: 0,
      });
    }

    if (rejectedNames.length > 0) {
      setError(`Skipped unsupported file(s): ${rejectedNames.join(', ')}`);
    }
    if (items.length > 0) {
      setQueue((prev) => [...prev, ...items]);
    }
  };

  const handleDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (!uploading) {
      addFiles(e.dataTransfer.files);
    }
  };

  const sendChunkOnce = (
    uploadId: string,
    offset: number,
    chunkBlob: Blob,
    onByteProgress: (loadedInChunk: number) => void
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          onByteProgress(Math.min(chunkBlob.size, ev.loaded));
        }
      };

      xhr.onload = () => {
        xhrRef.current = null;
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        let errMsg = `Chunk upload failed (${xhr.status})`;
        try {
          const parsed = JSON.parse(xhr.responseText);
          if (parsed?.error) errMsg = parsed.error;
        } catch {
          // keep HTTP status fallback
        }
        reject(new Error(errMsg));
      };

      xhr.onerror = () => {
        xhrRef.current = null;
        reject(new Error('Network error while uploading video chunk.'));
      };

      xhr.onabort = () => {
        xhrRef.current = null;
        reject(new Error('Upload cancelled.'));
      };

      xhr.open('POST', '/api/videos/upload/chunk');
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('X-Upload-Id', uploadId);
      xhr.setRequestHeader('X-Chunk-Offset', String(offset));
      xhr.send(chunkBlob);
    });
  };

  const uploadSingleFile = async (item: PendingFile): Promise<VideoItem> => {
    const initRes = await fetch('/api/videos/upload/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: item.file.name,
        mimeType: item.file.type,
        fileSize: item.file.size,
        title: item.title.trim() || 'Live Video',
      }),
    });

    const initData = await initRes.json().catch(() => null);
    if (!initRes.ok || !initData?.uploadId) {
      throw new Error(initData?.error || `Could not start upload (${initRes.status})`);
    }

    const uploadId = String(initData.uploadId);
    activeUploadIdRef.current = uploadId;
    const chunkSize = Number(initData.chunkSize) || UPLOAD_CHUNK_SIZE_BYTES;
    const slices = calculateUploadChunks(item.file.size, chunkSize);

    try {
      for (const slice of slices) {
        if (cancelledRef.current) {
          throw new Error('Upload cancelled.');
        }

        const chunkBlob = item.file.slice(slice.start, slice.end);
        let attempt = 0;
        const maxAttempts = 3;
        while (attempt < maxAttempts) {
          try {
            await sendChunkOnce(uploadId, slice.start, chunkBlob, (loadedInChunk) => {
              const totalUploaded = Math.min(item.file.size, slice.start + loadedInChunk);
              const pct = Math.min(99, Math.round((totalUploaded / item.file.size) * 100));
              setQueue((prev) =>
                prev.map((q) =>
                  q.id === item.id
                    ? { ...q, uploadedBytes: totalUploaded, progressPct: pct }
                    : q
                )
              );
            });
            break;
          } catch (chunkErr) {
            if (cancelledRef.current) {
              throw chunkErr;
            }
            attempt += 1;
            if (attempt >= maxAttempts) {
              throw chunkErr;
            }
            await new Promise((r) => window.setTimeout(r, 600 * attempt));
          }
        }
      }

      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id
            ? { ...q, status: 'processing', uploadedBytes: item.file.size, progressPct: 99 }
            : q
        )
      );

      const completeRes = await fetch('/api/videos/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          title: item.title.trim() || 'Live Video',
        }),
      });
      const completeData = await completeRes.json().catch(() => null);
      const saved: VideoItem | undefined = completeData?.video || completeData?.videos?.[0];
      if (!completeRes.ok || !saved) {
        throw new Error(completeData?.error || `Failed to finalize video (${completeRes.status})`);
      }
      activeUploadIdRef.current = null;
      return saved;
    } catch (err) {
      if (activeUploadIdRef.current === uploadId) {
        activeUploadIdRef.current = null;
        void fetch(`/api/videos/upload/${encodeURIComponent(uploadId)}`, {
          method: 'DELETE',
        }).catch(() => undefined);
      }
      throw err;
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const pendingItems = queue.filter((q) => q.status === 'queued' || q.status === 'error');
    if (pendingItems.length === 0) {
      setError('Select at least one video or movie file (.mp4, .mkv, .mov, .webm, .3gp).');
      return;
    }

    setUploading(true);
    cancelledRef.current = false;
    const uploadedBatch: VideoItem[] = [];
    let anyFailed = false;
    let firstErrorMsg = '';

    for (const item of pendingItems) {
      if (cancelledRef.current) break;

      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id
            ? { ...q, status: 'uploading', progressPct: 0, uploadedBytes: 0, error: undefined }
            : q
        )
      );

      try {
        const saved = await uploadSingleFile(item);
        uploadedBatch.push(saved);
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? { ...q, status: 'done', uploadedBytes: item.file.size, progressPct: 100 }
              : q
          )
        );
      } catch (err) {
        anyFailed = true;
        const msg = err instanceof Error ? err.message : 'Upload failed';
        if (!firstErrorMsg) firstErrorMsg = msg;
        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, status: 'error', error: msg } : q))
        );
      }
    }

    if (uploadedBatch.length > 0) {
      onVideosAdded(uploadedBatch);
    }

    setUploading(false);
    if (!anyFailed && !cancelledRef.current) {
      resetModal();
      onClose();
    } else if (anyFailed && !cancelledRef.current) {
      setError(firstErrorMsg || 'Some files failed to upload. Retry or remove failed items.');
    }
  };

  const totalBytes = queue.reduce((acc, q) => acc + q.file.size, 0);
  const doneCount = queue.filter((q) => q.status === 'done').length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-video-heading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-zinc-800 bg-[#101218] p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-800 pb-4">
          <div>
            <h2 id="add-video-heading" className="font-display text-xl font-bold text-white">
              Upload Videos &amp; Movies for Live Stream
            </h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              Select 1 or multiple large video files (MP4, MKV, MOV, WEBM, TS, 3GP — chunked upload up to 2.5 GB each).
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close Upload Videos modal"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 flex min-h-0 flex-1 flex-col gap-4">
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs font-medium text-red-300"
            >
              {error}
            </div>
          )}

          <label
            htmlFor="video-file-input"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-5 py-6 text-center transition-colors ${
              dragOver
                ? 'border-white bg-white/5'
                : 'border-zinc-700 bg-zinc-950/60 hover:border-zinc-500'
            }`}
          >
            <Film className="h-7 w-7 text-zinc-300" />
            <span className="mt-2 text-sm font-semibold text-white">
              {queue.length > 0 ? 'Add More Videos / Movies' : 'Choose Multiple Video Files or Drag Here'}
            </span>
            <span className="mt-1 text-xs text-zinc-400">
              5 MB smart chunking with auto-retry · MP4, MKV, MOV, WEBM, TS, AVI, 3GP
            </span>
            <input
              ref={fileInputRef}
              id="video-file-input"
              type="file"
              multiple
              accept="video/*,.mp4,.mkv,.mov,.webm,.m4v,.ts,.avi,.flv,.3gp,.3g2,.mpeg,.mpg,.wmv,.ogv,.mts,.m2ts"
              disabled={uploading}
              onChange={(e) => addFiles(e.target.files)}
              className="sr-only"
            />
          </label>

          {queue.length > 0 && (
            <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-zinc-800 bg-zinc-950/60">
              <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5 text-xs text-zinc-300">
                <span className="font-semibold">
                  {queue.length} {queue.length === 1 ? 'file' : 'files'} selected · {formatFileSize(totalBytes)}
                </span>
                {uploading && (
                  <span className="font-mono-tabular text-emerald-400">
                    Uploaded {doneCount} / {queue.length}
                  </span>
                )}
              </div>

              <ul className="max-h-60 divide-y divide-zinc-800/80 overflow-y-auto px-3 py-1">
                {queue.map((item, idx) => (
                  <li key={item.id} className="flex items-center gap-3 py-2.5">
                    <span className="font-mono-tabular w-5 text-xs text-zinc-500">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <input
                        type="text"
                        value={item.title}
                        disabled={uploading || item.status === 'done'}
                        onChange={(e) =>
                          setQueue((prev) =>
                            prev.map((q) => (q.id === item.id ? { ...q, title: e.target.value } : q))
                          )
                        }
                        aria-label={`Title for ${item.file.name}`}
                        className="w-full rounded border border-zinc-800 bg-zinc-900/70 px-2.5 py-1 text-xs font-medium text-white focus:border-zinc-500 focus:outline-none disabled:opacity-60"
                      />
                      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-zinc-400 font-mono-tabular">
                        <span className="truncate">{item.file.name} · {formatFileSize(item.file.size)}</span>
                        <span className="shrink-0">
                          {item.status === 'done'
                            ? 'Uploaded'
                            : item.status === 'processing'
                              ? 'Processing...'
                              : item.status === 'uploading'
                                ? `${formatFileSize(item.uploadedBytes)} · ${item.progressPct}%`
                                : item.status === 'error'
                                  ? 'Failed'
                                  : 'Ready'}
                        </span>
                      </div>
                      {(item.status === 'uploading' || item.status === 'processing') && (
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all duration-150"
                            style={{ width: `${item.progressPct}%` }}
                          />
                        </div>
                      )}
                      {item.error && (
                        <p className="mt-1 text-[11px] text-red-400">{item.error}</p>
                      )}
                    </div>
                    {item.status === 'done' ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                    ) : (
                      <button
                        type="button"
                        disabled={uploading}
                        onClick={() => setQueue((prev) => prev.filter((q) => q.id !== item.id))}
                        aria-label={`Remove ${item.file.name}`}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-red-400 disabled:opacity-30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-zinc-800 pt-4">
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Files</span>
            </button>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-300 hover:text-white"
              >
                {uploading ? 'Cancel Upload' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={uploading || queue.length === 0}
                data-testid="submit-video-upload"
                className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>
                  {uploading
                    ? `Uploading (${doneCount + 1}/${queue.length})`
                    : `Upload ${queue.length || ''} ${queue.length === 1 ? 'Video' : 'Videos'}`}
                </span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
