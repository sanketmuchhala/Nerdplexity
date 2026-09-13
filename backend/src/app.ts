import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import type { BackendHealth } from '@app/types';
import { runsRouter } from './routes/runs.js';
import { RunRegistry } from './runtime/runs.js';
import { discover } from './runtime/discovery.js';
import { errorHandler } from './middleware/errors.js';
import { modelsRouter } from './routes/models.js';
import { allowedOrigins, originAllowed, originGuard } from './middleware/origins.js';
import { hostedMode } from './runtime/destinations.js';

export interface AppOptions {
  /** Hosted deployment: no Ollama management. Defaults to NERDPLEXITY_HOSTED. */
  hosted?: boolean;
  /** Browser origins allowed besides this machine. Defaults to ALLOWED_ORIGINS. */
  extraOrigins?: ReadonlySet<string>;
  registry?: RunRegistry;
  /** Built frontend to serve at the same address, if present. */
  webDist?: string;
}

export interface NerdplexityApp {
  app: express.Express;
  hosted: boolean;
  extraOrigins: ReadonlySet<string>;
  webDist: string;
}

/** The Nerdplexity API (and, when built, the web app). Starting the listener is up to the caller. */
export function createApp(options: AppOptions = {}): NerdplexityApp {
  const hosted = options.hosted ?? hostedMode();
  const extraOrigins = options.extraOrigins ?? allowedOrigins();
  const webDist = options.webDist ?? path.resolve(__dirname, '../../frontend/dist');
  const app = express();

  app.use(helmet());

  // Health is readable from any site, so a hosted frontend can tell "server down" from
  // "this site is not allowed" (a CORS rejection looks like a network failure otherwise).
  const health: express.RequestHandler = (req, res) => {
    const origin = req.headers.origin;
    const body: BackendHealth = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      hosted,
      originAllowed: !origin || originAllowed(origin, extraOrigins),
      features: { ollamaManagement: !hosted },
    };
    res.json(body);
  };
  app.get(['/health', '/v1/health'], cors({ methods: ['GET'] }), health);

  app.use(cors({ origin: (origin, callback) => callback(null, !origin || originAllowed(origin, extraOrigins)) }));
  // Reject browser requests from unrelated sites before they reach runtimes or providers.
  app.use(originGuard(extraOrigins));
  app.use(express.json({ limit: '10mb' }));

  // Run engine: start, stream ordered events with replay, cancel.
  app.use('/v1/runs', runsRouter(options.registry ?? new RunRegistry()));
  // Installing or removing Ollama models only makes sense on the user's own machine.
  if (!hosted) app.use('/v1/models', modelsRouter());
  // Model discovery for a configured connection. Keys travel in the body, never the URL.
  app.post('/v1/models/discover', async (req, res) => {
    res.json(await discover(req.body?.target));
  });
  app.use('/v1', (_req, res) => {
    res.status(404).json({ error: 'API route not found.' });
  });
  app.use(errorHandler);

  // A built frontend (frontend/dist) is served at the same address when present, so one
  // server process can host the whole app. Unmatched GETs get index.html for client routes.
  app.use(express.static(webDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(webDist, 'index.html'), (err) => {
      if (err) res.status(200).json({ status: 'API server running', note: 'Frontend not built — run: pnpm --filter @app/web build' });
    });
  });

  return { app, hosted, extraOrigins, webDist };
}
