import type { RequestHandler } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import type { Auth } from '../auth.js';
import type { Database } from '../db/client.js';
import { LOCAL_USER_ID } from '../db/client.js';
import { user } from '../db/schema.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The user this request acts for. Set by requireUser; every stored-data query is scoped to it. */
      userId?: string;
      userEmail?: string;
      userName?: string;
    }
  }
}

export const TEST_USER_HEADER = 'x-nerdplexity-test-user';

export interface UserOptions {
  db: Database;
  /** Hosted servers require a signed-in account. */
  auth?: Auth;
  /**
   * Browser tests only (NERDPLEXITY_TEST_USERS=1, never on a hosted server): each test names its
   * own user in a header, so tests running side by side never see each other's data.
   */
  testUsers?: boolean;
}

/**
 * Decide who a request acts for. Hosted: the account whose session token is in the
 * Authorization header, or 401. On the user's own computer: the built-in owner.
 */
export function requireUser({ db, auth, testUsers }: UserOptions): RequestHandler {
  const known = new Set<string>();
  return async (req, res, next) => {
    try {
      if (auth) {
        const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
        if (!session) { res.status(401).json({ error: 'Sign in to continue.', code: 'auth-required' }); return; }
        req.userId = session.user.id;
        req.userEmail = session.user.email;
        req.userName = session.user.name;
        next();
        return;
      }
      const test = testUsers ? req.header(TEST_USER_HEADER)?.trim() : undefined;
      if (test) {
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(test)) { res.status(400).json({ error: 'Invalid test user.' }); return; }
        const id = `test-${test}`;
        if (!known.has(id)) {
          await db.insert(user).values({ id, name: 'Test user', email: `${id}@test.invalid`, emailVerified: true }).onConflictDoNothing();
          known.add(id);
        }
        req.userId = id;
      } else {
        req.userId = LOCAL_USER_ID;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
