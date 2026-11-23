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
import { type PhonkTrack, type StreamConfig } from './src/lib/phonkLogic.ts';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const ALLOWED_AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac']);
const ALLOWED_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

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

async function bootstrap() {
  const app = express();
  const httpServer = http.createServer(app);
  const store = new TrackStore();
  const engine = new StreamEngine(store);

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
    if (body.mode === 'autonomous-24-7' || body.mode === 'canvas-relay') patch.mode = body.mode;
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
      body.visuals
    ) {
      engine.updateConfig({
        ...(typeof body.rtmpUrl === 'string' ? { rtmpUrl: body.rtmpUrl } : {}),
        ...(typeof body.dryRun === 'boolean' ? { dryRun: body.dryRun } : {}),
        ...(body.mode === 'autonomous-24-7' || body.mode === 'canvas-relay'
          ? { mode: body.mode }
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
    const trackId = typeof req.body?.trackId === 'string' ? req.body.trackId : undefined;
    engine.skipTrack(trackId);
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
      } catch (err) {
        console.error('Failed to prepare demo audio:', err);
      }
    });
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
