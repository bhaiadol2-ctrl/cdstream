import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import http from 'http';
import multer from 'multer';
import path from 'path';
import { WebSocketServer, type WebSocket } from 'ws';
import { StreamEngine } from './server/streamEngine.ts';
import {
  UPLOADS_DIR,
  probeAudioDuration,
  sanitizePaletteInput,
  TrackStore,
} from './server/trackStore.ts';
import {
  cleanupStaleChunks,
  VIDEO_CHUNKS_DIR,
  VIDEO_THUMBS_DIR,
  VIDEOS_DIR,
  extractVideoThumbnail,
  probeVideoMetadata,
  VideoStore,
} from './server/videoStore.ts';
import {
  isLikelyVideoFile,
  UPLOAD_CHUNK_SIZE_BYTES,
  type PhonkTrack,
  type StreamConfig,
  type VideoItem,
} from './src/lib/phonkLogic.ts';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const ALLOWED_AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac']);
const ALLOWED_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_VIDEO_EXT = new Set([
  '.mp4',
  '.mkv',
  '.mov',
  '.webm',
  '.m4v',
  '.ts',
  '.avi',
  '.flv',
  '.3gp',
  '.3g2',
  '.mpeg',
  '.mpg',
  '.wmv',
  '.vob',
  '.mts',
  '.m2ts',
  '.ogv',
  '.divx',
  '.f4v',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt =
      file.fieldname === 'audio'
        ? ALLOWED_AUDIO_EXT.has(ext)
          ? ext
          : '.mp3'
        : ALLOWED_IMAGE_EXT.has(ext)
          ? ext
          : '.jpg';
    cb(null, `${crypto.randomUUID()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 55 * 1024 * 1024, // 55MB max per file
    files: 2,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (file.fieldname === 'audio') {
      if (file.mimetype.startsWith('audio/') || ALLOWED_AUDIO_EXT.has(ext)) {
        cb(null, true);
        return;
      }
      cb(new Error('Unsupported audio format. Please upload MP3, WAV, OGG, FLAC, or M4A.'));
      return;
    }
    if (file.fieldname === 'cover') {
      if (file.mimetype.startsWith('image/') || ALLOWED_IMAGE_EXT.has(ext)) {
        cb(null, true);
        return;
      }
      cb(new Error('Unsupported cover image format. Please upload JPG, PNG, or WEBP.'));
      return;
    }
    cb(new Error('Unexpected upload field.'));
  },
});

const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(VIDEOS_DIR, { recursive: true });
    cb(null, VIDEOS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ALLOWED_VIDEO_EXT.has(ext) ? ext : '.mp4';
    cb(null, `${crypto.randomUUID()}${safeExt}`);
  },
});

const videoUpload = multer({
  storage: videoStorage,
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024, // 2 GB max per big video
    files: 25,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (file.mimetype.startsWith('video/') || ALLOWED_VIDEO_EXT.has(ext)) {
      cb(null, true);
      return;
    }
    cb(new Error('Unsupported video format. Please upload MP4, MKV, MOV, WEBM, or TS.'));
  },
});

async function bootstrap() {
  const app = express();
  const httpServer = http.createServer(app);
  httpServer.requestTimeout = 0;
  httpServer.headersTimeout = 120_000;
  const store = new TrackStore();
  const videoStore = new VideoStore();
  const engine = new StreamEngine(store, videoStore);

  interface ChunkUploadSession {
    uploadId: string;
    partPath: string;
    originalName: string;
    safeExt: string;
    fileSize: number;
    title: string;
    createdAt: number;
  }
  const chunkSessions = new Map<string, ChunkUploadSession>();

  const finalizeVideoFile = async (params: {
    filePath: string;
    savedFilename: string;
    originalName: string;
    fileSizeBytes: number;
    customTitle?: string;
    clientDuration?: number;
  }): Promise<VideoItem> => {
    const rawTitle =
      params.customTitle?.trim() ||
      path
        .basename(params.originalName || 'Live Video', path.extname(params.originalName || ''))
        .replace(/[_-]+/g, ' ')
        .trim() ||
      'Live Video';

    const meta = await probeVideoMetadata(params.filePath);
    const thumbFilename = `${path.basename(params.savedFilename, path.extname(params.savedFilename))}.jpg`;
    const thumbPath = path.join(VIDEO_THUMBS_DIR, thumbFilename);
    const thumbOk = await extractVideoThumbnail(params.filePath, thumbPath, meta.durationSec);

    const durationSec =
      meta.durationSec > 0
        ? meta.durationSec
        : Number.isFinite(params.clientDuration) && (params.clientDuration || 0) > 0
          ? Math.round(params.clientDuration || 60)
          : 60;

    const newVideo: VideoItem = {
      id: `vid-${crypto.randomUUID().slice(0, 8)}`,
      title: rawTitle.slice(0, 90),
      videoUrl: `/uploads/videos/${path.basename(params.filePath)}`,
      thumbnailUrl: thumbOk
        ? `/uploads/videos/thumbs/${thumbFilename}`
        : '/src/assets/images/phonk_cover_crimson_1795444574683.jpg',
      durationSec,
      width: meta.width,
      height: meta.height,
      fileSizeBytes: params.fileSizeBytes,
      videoCodec: meta.videoCodec,
      audioCodec: meta.audioCodec,
      hasAudio: meta.hasAudio,
      createdAt: Date.now(),
    };

    return videoStore.add(newVideo);
  };

  app.use(express.json({ limit: '2mb' }));
  app.use('/uploads', express.static(UPLOADS_DIR, { fallthrough: true }));

  // WebSocket hub for real-time status push + Canvas MediaRecorder relay
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  httpServer.on('upgrade', (req, socket, head) => {
    const pathname = (req.url || '').split('?')[0];
    if (pathname !== '/ws/stream') {
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'status', payload: engine.getStatus() }));

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        engine.writeRelayChunk(buf);
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  engine.on('status', (status) => {
    const msg = JSON.stringify({ type: 'status', payload: status });
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        client.send(msg);
      }
    }
  });

  // --- API Routes ---

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/tracks', (_req, res) => {
    res.json({ tracks: store.getAll() });
  });

  app.post(
    '/api/tracks',
    upload.fields([
      { name: 'audio', maxCount: 1 },
      { name: 'cover', maxCount: 1 },
    ]),
    async (req, res) => {
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const audioFile = files?.audio?.[0];
      const coverFile = files?.cover?.[0];

      if (!audioFile) {
        if (coverFile) fs.unlink(coverFile.path, () => undefined);
        res.status(400).json({ error: 'An audio file is required.' });
        return;
      }

      const rawTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      if (!rawTitle) {
        fs.unlink(audioFile.path, () => undefined);
        if (coverFile) fs.unlink(coverFile.path, () => undefined);
        res.status(400).json({ error: 'Track title is required.' });
        return;
      }

      const artist =
        typeof req.body?.artist === 'string' && req.body.artist.trim()
          ? req.body.artist.trim().slice(0, 80)
          : 'Phonk Studio';
      const subgenre =
        typeof req.body?.subgenre === 'string' && req.body.subgenre.trim()
          ? req.body.subgenre.trim().slice(0, 48)
          : 'Drift Phonk';
      const bpmNum = Number(req.body?.bpm);
      const bpm = Number.isFinite(bpmNum) && bpmNum >= 60 && bpmNum <= 220 ? Math.round(bpmNum) : 136;

      let parsedPalette: unknown = null;
      if (typeof req.body?.palette === 'string') {
        try {
          parsedPalette = JSON.parse(req.body.palette);
        } catch {
          parsedPalette = null;
        }
      }

      const clientDuration = Number(req.body?.durationSec);
      const probedDuration = await probeAudioDuration(audioFile.path);
      const durationSec =
        probedDuration > 0
          ? probedDuration
          : Number.isFinite(clientDuration) && clientDuration > 0
            ? Math.round(clientDuration)
            : 60;

      const coverUrl = coverFile
        ? `/uploads/${path.basename(coverFile.path)}`
        : '/src/assets/images/phonk_cover_crimson_1795444574683.jpg';

      const newTrack: PhonkTrack = {
        id: `trk-${crypto.randomUUID().slice(0, 8)}`,
        title: rawTitle.slice(0, 80),
        artist,
        subgenre,
        audioUrl: `/uploads/${path.basename(audioFile.path)}`,
        coverUrl,
        durationSec,
        bpm,
        palette: sanitizePaletteInput(parsedPalette),
        isDemo: false,
        createdAt: Date.now(),
      };

      const saved = store.add(newTrack);
      res.status(201).json({ track: saved });
    }
  );

  app.patch('/api/tracks/:id', (req, res) => {
    const id = req.params.id;
    const patch: Partial<Pick<PhonkTrack, 'title' | 'artist' | 'subgenre' | 'bpm' | 'palette'>> = {};
    if (typeof req.body?.title === 'string' && req.body.title.trim()) {
      patch.title = req.body.title.trim().slice(0, 80);
    }
    if (typeof req.body?.artist === 'string' && req.body.artist.trim()) {
      patch.artist = req.body.artist.trim().slice(0, 80);
    }
    if (typeof req.body?.subgenre === 'string' && req.body.subgenre.trim()) {
      patch.subgenre = req.body.subgenre.trim().slice(0, 48);
    }
    if (typeof req.body?.bpm === 'number' && req.body.bpm >= 60 && req.body.bpm <= 220) {
      patch.bpm = Math.round(req.body.bpm);
    }
    if (req.body?.palette) {
      patch.palette = sanitizePaletteInput(req.body.palette);
    }

    const updated = store.update(id, patch);
    if (!updated) {
      res.status(404).json({ error: 'Track not found.' });
      return;
    }
    res.json({ track: updated });
  });

  app.post('/api/tracks/reorder', (req, res) => {
    const orderedIds = req.body?.orderedIds;
    if (!Array.isArray(orderedIds) || !orderedIds.every((id) => typeof id === 'string')) {
      res.status(400).json({ error: 'orderedIds must be an array of strings.' });
      return;
    }
    const tracks = store.reorder(orderedIds);
    res.json({ tracks });
  });

  app.post('/api/tracks/restore-demos', (_req, res) => {
    const tracks = store.restoreDemos();
    res.json({ tracks });
  });

  app.delete('/api/tracks/:id', (req, res) => {
    const removed = store.remove(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'Track not found.' });
      return;
    }
    res.json({ ok: true, tracks: store.getAll() });
  });

  // --- Direct Big Video Routes ---

  app.get('/api/videos', (_req, res) => {
    res.json({ videos: videoStore.getAll() });
  });

  // Chunked upload pipeline bypasses Cloud Run's 32 MiB single-request body cap
  app.post('/api/videos/upload/init', async (req, res) => {
    const filename = typeof req.body?.filename === 'string' ? req.body.filename.trim() : '';
    const mimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType.trim() : '';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const fileSize = Number(req.body?.fileSize);

    if (!filename || !Number.isFinite(fileSize) || fileSize <= 0) {
      res.status(400).json({ error: 'Invalid video file metadata.' });
      return;
    }
    if (fileSize > 2.5 * 1024 * 1024 * 1024) {
      res.status(400).json({ error: 'Video exceeds maximum supported size (2.5 GB).' });
      return;
    }
    if (!isLikelyVideoFile(filename, mimeType)) {
      res
        .status(400)
        .json({ error: 'Unsupported video format. Upload MP4, MKV, MOV, WEBM, TS, AVI, or 3GP.' });
      return;
    }

    const ext = path.extname(filename).toLowerCase();
    const safeExt = ALLOWED_VIDEO_EXT.has(ext) ? ext : '.mp4';
    const uploadId = crypto.randomUUID();
    const partPath = path.join(VIDEO_CHUNKS_DIR, `${uploadId}.part`);
    await fs.promises.mkdir(VIDEO_CHUNKS_DIR, { recursive: true });
    await fs.promises.writeFile(partPath, Buffer.alloc(0));

    chunkSessions.set(uploadId, {
      uploadId,
      partPath,
      originalName: filename,
      safeExt,
      fileSize: Math.floor(fileSize),
      title,
      createdAt: Date.now(),
    });

    res.json({
      uploadId,
      chunkSize: UPLOAD_CHUNK_SIZE_BYTES,
    });
  });

  app.post(
    '/api/videos/upload/chunk',
    express.raw({ type: 'application/octet-stream', limit: '16mb' }),
    async (req, res) => {
      const uploadIdHeader = req.headers['x-upload-id'];
      const offsetHeader = req.headers['x-chunk-offset'];
      const uploadId =
        typeof uploadIdHeader === 'string'
          ? uploadIdHeader.trim()
          : typeof req.query.uploadId === 'string'
            ? req.query.uploadId.trim()
            : '';
      const offset = Number(
        typeof offsetHeader === 'string' ? offsetHeader : req.query.offset
      );

      const session = chunkSessions.get(uploadId);
      if (!session) {
        res.status(404).json({ error: 'Upload session expired or not found. Please retry.' });
        return;
      }

      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (buf.length === 0) {
        res.status(400).json({ error: 'Empty video chunk received.' });
        return;
      }
      if (
        !Number.isFinite(offset) ||
        offset < 0 ||
        offset + buf.length > session.fileSize
      ) {
        res.status(400).json({ error: 'Chunk offset out of bounds.' });
        return;
      }

      const fh = await fs.promises.open(session.partPath, 'r+');
      try {
        await fh.write(buf, 0, buf.length, offset);
      } finally {
        await fh.close();
      }

      res.json({ ok: true, written: buf.length });
    }
  );

  app.post('/api/videos/upload/complete', async (req, res) => {
    const uploadId = typeof req.body?.uploadId === 'string' ? req.body.uploadId.trim() : '';
    const session = chunkSessions.get(uploadId);
    if (!session) {
      res.status(404).json({ error: 'Upload session not found.' });
      return;
    }

    const customTitle =
      typeof req.body?.title === 'string' && req.body.title.trim()
        ? req.body.title.trim()
        : session.title;
    const clientDuration = Number(req.body?.durationSec);

    try {
      const st = await fs.promises.stat(session.partPath);
      if (st.size <= 0) {
        await fs.promises.unlink(session.partPath).catch(() => undefined);
        chunkSessions.delete(uploadId);
        res.status(400).json({ error: 'Uploaded video file is empty.' });
        return;
      }

      const savedFilename = `${crypto.randomUUID()}${session.safeExt}`;
      const finalPath = path.join(VIDEOS_DIR, savedFilename);
      await fs.promises.mkdir(VIDEOS_DIR, { recursive: true });
      await fs.promises.rename(session.partPath, finalPath);
      chunkSessions.delete(uploadId);

      const saved = await finalizeVideoFile({
        filePath: finalPath,
        savedFilename,
        originalName: session.originalName,
        fileSizeBytes: st.size,
        customTitle,
        clientDuration,
      });

      res.status(201).json({
        video: saved,
        videos: [saved],
        allVideos: videoStore.getAll(),
      });
    } catch (err) {
      await fs.promises.unlink(session.partPath).catch(() => undefined);
      chunkSessions.delete(uploadId);
      const msg = err instanceof Error ? err.message : 'Failed to finalize uploaded video.';
      res.status(500).json({ error: msg });
    }
  });

  app.delete('/api/videos/upload/:uploadId', async (req, res) => {
    const uploadId = req.params.uploadId;
    const session = chunkSessions.get(uploadId);
    if (session) {
      chunkSessions.delete(uploadId);
      await fs.promises.unlink(session.partPath).catch(() => undefined);
    }
    res.json({ ok: true });
  });

  app.post(
    '/api/videos',
    (req, res, next) => {
      req.setTimeout(0);
      res.setTimeout(0);
      next();
    },
    videoUpload.array('video', 25),
    async (req, res) => {
      const uploadedFiles = Array.isArray(req.files)
        ? (req.files as Express.Multer.File[])
        : [];
      if (uploadedFiles.length === 0) {
        res.status(400).json({ error: 'At least one video file is required.' });
        return;
      }

      const customTitle =
        uploadedFiles.length === 1 && typeof req.body?.title === 'string' && req.body.title.trim()
          ? req.body.title.trim()
          : '';
      const clientDuration = Number(req.body?.durationSec);

      const addedVideos: VideoItem[] = [];
      for (const videoFile of uploadedFiles) {
        const saved = await finalizeVideoFile({
          filePath: videoFile.path,
          savedFilename: videoFile.filename,
          originalName: videoFile.originalname || 'Live Video',
          fileSizeBytes: videoFile.size || 0,
          customTitle,
          clientDuration,
        });
        addedVideos.push(saved);
      }

      res.status(201).json({
        video: addedVideos[0],
        videos: addedVideos,
        allVideos: videoStore.getAll(),
      });
    }
  );

  app.patch('/api/videos/:id', (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title) {
      res.status(400).json({ error: 'Video title is required.' });
      return;
    }
    const updated = videoStore.update(req.params.id, { title: title.slice(0, 90) });
    if (!updated) {
      res.status(404).json({ error: 'Video not found.' });
      return;
    }
    res.json({ video: updated });
  });

  app.post('/api/videos/reorder', (req, res) => {
    const orderedIds = req.body?.orderedIds;
    if (!Array.isArray(orderedIds) || !orderedIds.every((id) => typeof id === 'string')) {
      res.status(400).json({ error: 'orderedIds must be an array of strings.' });
      return;
    }
    res.json({ videos: videoStore.reorder(orderedIds) });
  });

  app.post('/api/videos/clear', (_req, res) => {
    videoStore.clearAll();
    res.json({ ok: true, videos: [] });
  });

  app.delete('/api/videos/:id', (req, res) => {
    const removed = videoStore.remove(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'Video not found.' });
      return;
    }
    res.json({ ok: true, videos: videoStore.getAll() });
  });

  // --- YouTube Live Stream Control Routes ---

  app.get('/api/stream/status', (_req, res) => {
    res.json({
      status: engine.getStatus(),
      config: engine.getConfig(),
    });
  });

  app.post('/api/stream/config', (req, res) => {
    const body = req.body || {};
    if (typeof body.streamKey === 'string') {
      if (body.streamKey.trim() === '') {
        engine.clearStreamKey();
      } else {
        engine.setStreamKey(body.streamKey);
      }
    }
    const patch: Partial<StreamConfig> = {};
    if (typeof body.rtmpUrl === 'string') patch.rtmpUrl = body.rtmpUrl;
    if (body.resolution === '1280x720' || body.resolution === '1920x1080') {
      patch.resolution = body.resolution;
    }
    if (body.fps === 30 || body.fps === 60) patch.fps = body.fps;
    if (typeof body.videoBitrateKbps === 'number') patch.videoBitrateKbps = body.videoBitrateKbps;
    if (typeof body.audioBitrateKbps === 'number') patch.audioBitrateKbps = body.audioBitrateKbps;
    if (typeof body.autoReconnect === 'boolean') patch.autoReconnect = body.autoReconnect;
    if (body.mode === 'video-24-7' || body.mode === 'autonomous-24-7' || body.mode === 'canvas-relay') {
      patch.mode = body.mode;
    }
    if (body.videoEncodeMode === 'safe-encode' || body.videoEncodeMode === 'direct-copy') {
      patch.videoEncodeMode = body.videoEncodeMode;
    }
    if (body.queueEndBehavior === 'loop' || body.queueEndBehavior === 'stop-after-queue') {
      patch.queueEndBehavior = body.queueEndBehavior;
    }
    if (typeof body.autoStopMinutes === 'number') {
      patch.autoStopMinutes = body.autoStopMinutes;
    }
    if (body.videoShield && typeof body.videoShield === 'object') {
      patch.videoShield = body.videoShield;
    }
    if (typeof body.dryRun === 'boolean') patch.dryRun = body.dryRun;
    if (body.visuals && typeof body.visuals === 'object') patch.visuals = body.visuals;

    const config = engine.updateConfig(patch);
    res.json({ status: engine.getStatus(), config });
  });

  app.post('/api/stream/start', async (req, res) => {
    const body = req.body || {};
    if (typeof body.streamKey === 'string' && body.streamKey.trim()) {
      engine.setStreamKey(body.streamKey);
    }
    if (
      typeof body.rtmpUrl === 'string' ||
      typeof body.dryRun === 'boolean' ||
      body.mode ||
      body.videoEncodeMode ||
      body.queueEndBehavior ||
      typeof body.autoStopMinutes === 'number' ||
      body.videoShield ||
      body.visuals
    ) {
      engine.updateConfig({
        ...(typeof body.rtmpUrl === 'string' ? { rtmpUrl: body.rtmpUrl } : {}),
        ...(typeof body.dryRun === 'boolean' ? { dryRun: body.dryRun } : {}),
        ...(body.mode === 'video-24-7' || body.mode === 'autonomous-24-7' || body.mode === 'canvas-relay'
          ? { mode: body.mode }
          : {}),
        ...(body.videoEncodeMode === 'safe-encode' || body.videoEncodeMode === 'direct-copy'
          ? { videoEncodeMode: body.videoEncodeMode }
          : {}),
        ...(body.queueEndBehavior === 'loop' || body.queueEndBehavior === 'stop-after-queue'
          ? { queueEndBehavior: body.queueEndBehavior }
          : {}),
        ...(typeof body.autoStopMinutes === 'number'
          ? { autoStopMinutes: body.autoStopMinutes }
          : {}),
        ...(body.videoShield && typeof body.videoShield === 'object'
          ? { videoShield: body.videoShield }
          : {}),
        ...(body.visuals && typeof body.visuals === 'object' ? { visuals: body.visuals } : {}),
      });
    }
    const result = await engine.start();
    if (!result.ok) {
      res.status(400).json({ error: result.error, status: engine.getStatus() });
      return;
    }
    res.json({ ok: true, status: engine.getStatus() });
  });

  app.post('/api/stream/stop', (_req, res) => {
    engine.stop();
    res.json({ ok: true, status: engine.getStatus() });
  });

  app.post('/api/stream/skip', (req, res) => {
    const targetId =
      typeof req.body?.videoId === 'string'
        ? req.body.videoId
        : typeof req.body?.trackId === 'string'
          ? req.body.trackId
          : undefined;
    engine.skipTrack(targetId);
    res.json({ ok: true, status: engine.getStatus() });
  });

  // Multer error handler
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (err instanceof multer.MulterError || err instanceof Error) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  );

  // Vite dev middleware or production static assets
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`PhonkCast 24/7 studio listening on http://0.0.0.0:${PORT}`);
    setImmediate(() => {
      try {
        store.prepareDemoAudio();
        cleanupStaleChunks();
      } catch (err) {
        console.error('Failed startup cleanup:', err);
      }
    });
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
