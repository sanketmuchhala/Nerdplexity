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
import { allowedOrigins, originAllowed, originGuard } from './middleware/origins.js';
import { hostedMode } from './runtime/destinations.js';

dotenv.config({ path: '.env.local' });

const app = express();
const PORT = Number(process.env.PORT) || 5174;
// Hosted servers (Render, Railway) must listen on all interfaces; a local server stays on loopback.
const HOST = process.env.HOST || (hostedMode() ? '0.0.0.0' : '127.0.0.1');
// A frontend hosted elsewhere (for example on Vercel) is allowed only when listed in ALLOWED_ORIGINS.
const extraOrigins = allowedOrigins();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => callback(null, !origin || originAllowed(origin, extraOrigins)),
}));

// Reject browser requests from unrelated sites before accessing runtimes or providers.
app.use(originGuard(extraOrigins));

app.use(express.json({ limit: '10mb' }));
// Run engine: start, stream ordered events with replay, cancel.
app.use('/v1/runs', runsRouter(new RunRegistry()));
// Installing or removing Ollama models only makes sense on the user's own machine.
if (!hostedMode()) app.use('/v1/models', modelsRouter());

// Health check. /v1/health is the same check on the API path, which a dev proxy or a separately
// hosted frontend reaches in every setup.
const health: express.RequestHandler = (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
};
app.get('/health', health);
app.get('/v1/health', health);

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
  console.log(hostedMode()
    ? `[SECURITY] Hosted mode: local and private-network targets are refused. Allowed sites: ${[...extraOrigins].join(', ') || 'this machine only'}. API keys are never logged or stored.`
    : `[SECURITY] Local-only mode. API keys are never logged or stored.`);
  console.log(`[READY] Serving frontend from: ${webDist}`);
});
