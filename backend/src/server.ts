import dotenv from 'dotenv';

// Load settings before modules that read them (hosted mode, allowed origins).
dotenv.config({ path: '.env.local' });

import { createApp } from './app.js';

const { app, hosted, extraOrigins, webDist } = createApp();
const PORT = Number(process.env.PORT) || 5174;
// Hosted servers (Render, Railway) must listen on all interfaces; a local server stays on loopback.
const HOST = process.env.HOST || (hosted ? '0.0.0.0' : '127.0.0.1');

app.listen(PORT, HOST, () => {
  console.log(`[SERVER] Nerdplexity server running on http://${HOST}:${PORT}`);
  console.log(hosted
    ? `[SECURITY] Hosted mode: local and private-network targets are refused. Allowed sites: ${[...extraOrigins].join(', ') || 'this machine only'}. API keys are never logged or stored.`
    : `[SECURITY] Local-only mode. API keys are never logged or stored.`);
  console.log(`[READY] Serving frontend from: ${webDist}`);
});
