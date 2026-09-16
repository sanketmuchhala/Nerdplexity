import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { toNodeHandler } from 'better-auth/node';
import type { BackendHealth } from '@app/types';
import { runsRouter } from './routes/runs.js';
import { benchRouter } from './routes/bench.js';
import { benchScores } from './store/bench.js';
import { agentRouter } from './routes/agent.js';
import { AccountPacer, RouterHealth } from './runtime/router.js';
import { RunRegistry } from './runtime/runs.js';
import { discover } from './runtime/discovery.js';
import { errorHandler } from './middleware/errors.js';
import { modelsRouter } from './routes/models.js';
import { allowedOrigins, originAllowed, originGuard } from './middleware/origins.js';
import { hostedMode } from './runtime/destinations.js';
import type { Database } from './db/client.js';
import { createAuth, signupPolicy, signupsOpen, type Auth, type SignupPolicy } from './auth.js';
import { requireUser } from './middleware/user.js';
import { dataRouter, importHandler } from './routes/data.js';

export interface AppOptions {
  /** Where users and their data are stored (see openDatabase). */
  db: Database;
  /** Hosted deployment: accounts required, no Ollama management. Defaults to NERDPLEXITY_HOSTED. */
  hosted?: boolean;
  /** Browser origins allowed besides this machine. Defaults to ALLOWED_ORIGINS. */
  extraOrigins?: ReadonlySet<string>;
  registry?: RunRegistry;
  /** Built frontend to serve at the same address, if present. */
  webDist?: string;
  /** Account settings for a hosted server. Default to BETTER_AUTH_SECRET, BETTER_AUTH_URL, and NERDPLEXITY_SIGNUPS. */
  auth?: { secret?: string; baseURL?: string; signups?: SignupPolicy; rateLimit?: boolean };
  /** Let browser tests pick a user per test with a header. Never on a hosted server. Defaults to NERDPLEXITY_TEST_USERS=1. */
  testUsers?: boolean;
}

export interface NerdplexityApp {
  app: express.Express;
  hosted: boolean;
  extraOrigins: ReadonlySet<string>;
  webDist: string;
  auth?: Auth;
}

/** The Nerdplexity API (and, when built, the web app). Starting the listener is up to the caller. */
export function createApp(options: AppOptions): NerdplexityApp {
  const { db } = options;
  const hosted = options.hosted ?? hostedMode();
  const extraOrigins = options.extraOrigins ?? allowedOrigins();
  const webDist = options.webDist ?? path.resolve(__dirname, '../../frontend/dist');
  const signups = options.auth?.signups ?? signupPolicy();
  let auth: Auth | undefined;
  if (hosted) {
    const secret = options.auth?.secret ?? process.env.BETTER_AUTH_SECRET?.trim() ?? '';
    // Without a stable secret, anyone could forge sessions, and restarts would sign everyone out.
    if (secret.length < 32) throw new Error('A hosted server needs BETTER_AUTH_SECRET: a random value of at least 32 characters (openssl rand -base64 32).');
    auth = createAuth({
      db, secret, extraOrigins, signups,
      baseURL: options.auth?.baseURL ?? (process.env.BETTER_AUTH_URL?.trim() || undefined),
      rateLimit: options.auth?.rateLimit ?? true,
    });
  }
  const user = requireUser({ db, auth, testUsers: !hosted && (options.testUsers ?? process.env.NERDPLEXITY_TEST_USERS === '1') });
  const app = express();
  // Railway and Render forward requests through one proxy; trust it for the visitor's address and HTTPS.
  if (hosted) app.set('trust proxy', 1);

  app.use(helmet());

  // Health is readable from any site, so a hosted frontend can tell "server down" from
  // "this site is not allowed" (a CORS rejection looks like a network failure otherwise).
  const health: express.RequestHandler = (req, res, next) => {
    const origin = req.headers.origin;
    (hosted ? signupsOpen(db, signups) : Promise.resolve(false)).then(open => {
      const body: BackendHealth = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        hosted,
        originAllowed: !origin || originAllowed(origin, extraOrigins, req.headers.host),
        authRequired: hosted,
        signupsOpen: open,
        features: { ollamaManagement: !hosted },
      };
      res.json(body);
    }, next);
  };
  app.get(['/health', '/v1/health'], cors({ methods: ['GET'] }), health);

  app.use(cors({
    origin: (origin, callback) => callback(null, !origin || originAllowed(origin, extraOrigins)),
    exposedHeaders: ['set-auth-token'],
  }));
  // Reject browser requests from unrelated sites before they reach runtimes, providers, or data.
  app.use(originGuard(extraOrigins));

  // Accounts (hosted only): sign up, sign in, sign out, session. Better Auth reads its own bodies.
  if (auth) app.all('/v1/auth/*', toNodeHandler(auth));

  // A browser's saved data, imported once; larger than any other request.
  app.post('/v1/import', user, express.json({ limit: '50mb' }), importHandler(db));

  // Run engine: start, stream ordered events with replay, cancel. Hosted servers require an account.
  // The Free Router ranks models with the user's Bench results.
  const registry = options.registry ?? new RunRegistry();
  // One health record per server, shared by the Free Router, the Free Agent, and the specialists view.
  const routerHealth = new RouterHealth();
  // One pacer for the server: parallel steps of every run share each account's rate limit.
  const pacer = new AccountPacer();
  const scores = (owner: string) => benchScores(db, owner);
  app.use('/v1/runs', user, express.json({ limit: '10mb' }), runsRouter(registry, fetch, routerHealth, scores, pacer));
  app.use('/v1/agent', user, express.json({ limit: '1mb' }), agentRouter(routerHealth, scores));
  // Bench jobs run in the same registry, so their events, replay, and cancel use /v1/runs/:id.
  app.use('/v1/bench', user, express.json({ limit: '1mb' }), benchRouter(registry, db));
  // Installing or removing Ollama models only makes sense on the user's own machine.
  if (!hosted) app.use('/v1/models', express.json({ limit: '1mb' }), modelsRouter());
  // Model discovery for a configured connection. Keys travel in the body, never the URL.
  app.post('/v1/models/discover', user, express.json({ limit: '1mb' }), async (req, res) => {
    res.json(await discover(req.body?.target));
  });
  // Saved threads, documents, run history, connections, presets, comparisons, and settings.
  app.use('/v1', dataRouter(db, user));
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

  return { app, hosted, extraOrigins, webDist, auth };
}
