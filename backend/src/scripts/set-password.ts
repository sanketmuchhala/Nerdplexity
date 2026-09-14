import dotenv from 'dotenv';
import { and, eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { openDatabase } from '../db/client.js';
import { account, session, user } from '../db/schema.js';

// Set a new password for an account, for owners of a hosted server without an email provider.
// Signs the account out everywhere.
//
//   DATABASE_URL='postgresql://...' NEW_PASSWORD='...' pnpm --filter @app/server user:password -- --email you@example.com

dotenv.config({ path: '.env.local' });

async function main() {
  const index = process.argv.indexOf('--email');
  const email = index >= 0 ? process.argv[index + 1]?.trim().toLowerCase() : undefined;
  const password = process.env.NEW_PASSWORD ?? '';
  if (!email || password.length < 8 || password.length > 128) {
    console.error('Usage: DATABASE_URL=<Postgres URL> NEW_PASSWORD=<8–128 characters> pnpm --filter @app/server user:password -- --email <account email>');
    process.exit(2);
  }
  const database = await openDatabase();
  try {
    const [found] = await database.db.select({ id: user.id }).from(user).where(eq(user.email, email));
    if (!found) throw new Error(`No account for ${email}.`);
    const updated = await database.db.update(account).set({ password: await hashPassword(password), updatedAt: new Date() })
      .where(and(eq(account.userId, found.id), eq(account.providerId, 'credential'))).returning({ id: account.id });
    if (!updated.length) throw new Error(`${email} has no password sign-in.`);
    await database.db.delete(session).where(eq(session.userId, found.id));
    console.log(`[ACCOUNT] Password changed for ${email}. All of its sessions were signed out.`);
  } finally {
    await database.close();
  }
}

main().catch(error => {
  console.error(`[ACCOUNT] Failed: ${(error as Error).message}`);
  process.exit(1);
});
