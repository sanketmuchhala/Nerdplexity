import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins/bearer';
import { count, ne } from 'drizzle-orm';
import type { Database } from './db/client.js';
import { LOCAL_USER_ID } from './db/client.js';
import { authSchema, user } from './db/schema.js';
import { originAllowed } from './middleware/origins.js';

/** 'first': only the first account can be created (the owner), then sign-ups close. */
export type SignupPolicy = 'open' | 'closed' | 'first';

export function signupPolicy(value = process.env.NERDPLEXITY_SIGNUPS): SignupPolicy {
  const policy = value?.trim().toLowerCase();
  return policy === 'open' || policy === 'closed' ? policy : 'first';
}

export interface AuthOptions {
  db: Database;
  /** Signs session tokens. At least 32 characters; BETTER_AUTH_SECRET. */
  secret: string;
  /** The server's public address, e.g. https://nerdplexity.up.railway.app (BETTER_AUTH_URL). */
  baseURL?: string;
  extraOrigins: ReadonlySet<string>;
  signups: SignupPolicy;
  /** Limit repeated sign-in attempts. On unless a test turns it off. */
  rateLimit: boolean;
}

export async function signupsOpen(db: Database, policy: SignupPolicy) {
  if (policy !== 'first') return policy === 'open';
  const [row] = await db.select({ n: count() }).from(user).where(ne(user.id, LOCAL_USER_ID));
  return Number(row.n) === 0;
}

/**
 * Accounts for a hosted server: email and password, with sessions carried as bearer tokens.
 * The web app and the server are usually on different sites (Vercel and Railway), where
 * browsers block third-party cookies, so the app keeps the token and sends it in a header.
 */
export function createAuth(options: AuthOptions) {
  return betterAuth({
    database: drizzleAdapter(options.db, { provider: 'pg', schema: authSchema }),
    basePath: '/v1/auth',
    secret: options.secret,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    // The sites allowed for the rest of the API: ALLOWED_ORIGINS, this machine, and the server's own address.
    trustedOrigins: request => {
      const origin = request?.headers.get('origin');
      return origin && originAllowed(origin, options.extraOrigins, request?.headers.get('host') ?? undefined) ? [origin] : [];
    },
    emailAndPassword: { enabled: true, autoSignIn: true, minPasswordLength: 8, maxPasswordLength: 128 },
    plugins: [bearer()],
    rateLimit: { enabled: options.rateLimit, window: 60, max: 100 },
    advanced: {
      // Railway and Render put the visitor's address in these headers.
      ipAddress: { ipAddressHeaders: ['x-real-ip', 'x-forwarded-for'] },
    },
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            if (!await signupsOpen(options.db, options.signups)) {
              throw new APIError('FORBIDDEN', { message: 'New accounts are closed on this server. Ask its owner to set NERDPLEXITY_SIGNUPS=open.' });
            }
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
