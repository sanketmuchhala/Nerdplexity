import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';
import { LOCAL_USER_ID, openDatabase } from '../db/client.js';
import { user } from '../db/schema.js';
import { exportData, importData } from '../store/transfer.js';

// Copy everything saved on this computer into a hosted database, under an account there.
//
//   COPY_TO_DATABASE_URL='postgresql://...' pnpm --filter @app/server db:copy -- --as you@example.com
//
// Create the account on the hosted site first. Records that already exist there are skipped, so
// running it twice is safe. Stop the local server first: PGlite's folder is used by one process at a time.

dotenv.config({ path: '.env.local' });

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const to = arg('to') ?? process.env.COPY_TO_DATABASE_URL;
  const email = arg('as')?.trim().toLowerCase();
  if (!to || !email) {
    console.error('Usage: COPY_TO_DATABASE_URL=<Postgres URL> pnpm --filter @app/server db:copy -- --as <account email> [--from-data-dir <folder>]');
    process.exit(2);
  }
  const source = await openDatabase({ url: '', dataDir: arg('from-data-dir') });
  const target = await openDatabase({ url: to });
  try {
    const [account] = await target.db.select({ id: user.id }).from(user).where(eq(user.email, email));
    if (!account) throw new Error(`No account for ${email} in the target database. Sign up on the hosted site first.`);
    const data = await exportData(source.db, LOCAL_USER_ID);
    console.log(`[COPY] From PGlite at ${source.location} to the target database, as ${email}.`);
    const result = await importData(target.db, account.id, { ...data, done: true });
    for (const kind of Object.keys(result.imported) as (keyof typeof result.imported)[]) {
      console.log(`  ${kind}: ${result.imported[kind]} copied${result.skipped[kind] ? `, ${result.skipped[kind]} already there or unreadable` : ''}`);
    }
  } finally {
    await Promise.all([source.close(), target.close()]);
  }
}

main().catch(error => {
  // Messages from the database driver never include the URL's password.
  console.error(`[COPY] Failed: ${(error as Error).message}`);
  process.exit(1);
});
