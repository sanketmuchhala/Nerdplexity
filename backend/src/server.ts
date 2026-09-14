import dotenv from 'dotenv';

// Load settings before modules that read them (hosted mode, allowed origins, database).
dotenv.config({ path: '.env.local' });

import { createApp } from './app.js';
import { openDatabase } from './db/client.js';
import { hostedMode } from './runtime/destinations.js';

async function main() {
  const hosted = hostedMode();
  const database = await openDatabase({ seedLocalUser: !hosted });
  const { app, extraOrigins, webDist } = createApp({ db: database.db, hosted });
  const PORT = Number(process.env.PORT) || 5174;
  // Hosted servers (Render, Railway) must listen on all interfaces; a local server stays on loopback.
  const HOST = process.env.HOST || (hosted ? '0.0.0.0' : '127.0.0.1');

  const server = app.listen(PORT, HOST, () => {
    console.log(`[SERVER] Nerdplexity server running on http://${HOST}:${PORT}`);
    console.log(`[DATA] ${database.kind === 'postgres' ? 'Postgres (DATABASE_URL)' : `PGlite at ${database.location}`}`);
    console.log(hosted
      ? `[SECURITY] Hosted mode: accounts required; local and private-network targets are refused. Allowed sites: ${[...extraOrigins].join(', ') || 'this machine only'}. API keys are never logged or stored.`
      : `[SECURITY] Local-only mode. API keys are never logged or stored.`);
    console.log(`[READY] Serving frontend from: ${webDist}`);
  });

  // Close the database cleanly so PGlite's files are never left mid-write.
  const shutdown = () => {
    server.close();
    void database.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch(error => {
  console.error(`[FATAL] ${(error as Error).message}`);
  process.exit(1);
});
