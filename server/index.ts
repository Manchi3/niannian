import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chatRouter from './routes/chat.js';
import condenseRouter from './routes/condense.js';
import authRouter from './routes/auth.js';
import userRouter from './routes/user.js';
import memoriesRouter from './routes/memories.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Large limit for base64 image payloads

// --- Health check ---
app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'particle-diary-api' });
});

// --- API Routes ---
app.use('/api/chat', chatRouter);
app.use('/api/condense', condenseRouter);
app.use('/api/auth', authRouter);
app.use('/api/user', userRouter);
app.use('/api/memories', memoriesRouter);

// --- Static file serving (production) ---
// In production, serve the built frontend from dist/
const distPath = path.resolve(__dirname, '../dist');
app.use(express.static(distPath));

// SPA fallback: all non-API routes serve index.html
app.get('*', (req, res, next) => {
  // Skip API routes
  if (req.path.startsWith('/api/')) {
    return next();
  }
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) {
      // dist/ doesn't exist yet (development mode) — return 404
      res.status(404).json({ error: 'Not found' });
    }
  });
});

// --- Error handler ---
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error('[Server Error]', err.message);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  },
);

// --- Start server ---
app.listen(PORT, () => {
  console.log(`[Particle Diary API] Server running on http://localhost:${PORT}`);
});

export default app;
