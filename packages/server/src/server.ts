import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { runsRouter } from './routes/runs.js';
import { RunRegistry } from './runtime/runs.js';
import { discover } from './runtime/discovery.js';
import { errorHandler } from './middleware/errors.js';
import { modelsRouter } from './routes/models.js';

dotenv.config({ path: '.env.local' });

const app = express();
const PORT = Number(process.env.PORT) || 5174;
const HOST = process.env.HOST || '127.0.0.1';

// Security middleware
app.use(helmet());
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true
}));

// Reject browser requests from unrelated sites before accessing local runtimes.
app.use((req, res, next) => {
  if (req.headers.origin) {
    try {
      const origin = new URL(req.headers.origin);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
        res.status(403).json({ error: 'Open Nerdplexity on localhost.' });
        return;
      }
    } catch { res.status(403).json({ error: 'Invalid origin.' }); return; }
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
// Run engine: start, stream ordered events with replay, cancel.
app.use('/v1/runs', runsRouter(new RunRegistry()));
app.use('/v1/models', modelsRouter());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Model discovery for a configured connection. Keys travel in the body, never the URL.
app.post('/v1/models/discover', async (req, res) => {
  res.json(await discover(req.body?.target));
});

app.use('/v1', (_req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

// Error handling middleware
app.use(errorHandler);

// ── Serve built web frontend ──────────────────────────────
// In production (Vercel), the web package is built to packages/web/dist
// The server dist is at packages/server/dist, so web dist is two levels up + web/dist
const webDist = path.resolve(__dirname, '../../web/dist');
app.use(express.static(webDist));

// SPA catch-all — any unmatched GET serves index.html so React Router works
app.get('*', (_req, res) => {
  const index = path.join(webDist, 'index.html');
  res.sendFile(index, (err) => {
    if (err) {
      // If web dist doesn't exist (local dev without frontend build), send a simple message
      res.status(200).json({ status: 'API server running', note: 'Frontend not built — run: pnpm --filter @app/web build' });
    }
  });
});

app.listen(Number(PORT), HOST, () => {
  console.log(`[SERVER] Nerdplexity server running on http://${HOST}:${PORT}`);
  console.log(`[SECURITY] Local-only mode. API keys are never logged or stored.`);
  console.log(`[READY] Serving frontend from: ${webDist}`);
});
