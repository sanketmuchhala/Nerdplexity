import { defineConfig } from 'drizzle-kit';

// Generates SQL migrations from src/db/schema.ts: pnpm --filter @app/server db:generate
// The server applies them on start, to PGlite locally and to Postgres when hosted.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
