import { expect, test } from '@playwright/test';

// A hosted server (NERDPLEXITY_HOSTED=1) with accounts, called across origins by the web app,
// as with Vercel and Railway. Runs in order: the first account is the owner's.
const apiOrigin = `http://127.0.0.1:${Number(process.env.HOSTED_API_PORT) || 5577}`;
const email = `owner-${Date.now()}@example.com`;
const password = 'correct horse battery staple';

test.describe.configure({ mode: 'serial' });

test('the owner creates the first account, and threads are saved to it across reloads', async ({ page }) => {
  const calls: { url: string; auth: boolean }[] = [];
  page.on('request', request => {
    if (request.url().includes('/v1/') && !request.url().includes('/v1/health') && request.method() !== 'OPTIONS') {
      calls.push({ url: request.url(), auth: !!request.headers().authorization });
    }
  });
  await page.goto('/app');
  // Nothing loads before signing in; the first account may be created.
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert')).toContainText('at least 8 characters');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.locator('aside').getByRole('button', { name: 'New thread' }).click();
  await expect(page.locator('aside').getByText('New chat', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('aside').getByText('New chat', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Account' }).click();
  await expect(page.getByRole('group', { name: 'Account' })).toContainText(email);

  // Every data request went to the server's origin with the session token.
  const data = calls.filter(call => !call.url.includes('/v1/auth/'));
  expect(data.length).toBeGreaterThan(3);
  expect(data.every(call => call.url.startsWith(`${apiOrigin}/v1/`) && call.auth)).toBe(true);
});

test('signing out closes the workspace; sign-ups are closed after the owner; signing in brings the threads back', async ({ page, request }) => {
  const health = await (await request.get(`${apiOrigin}/v1/health`)).json();
  expect(health).toMatchObject({ hosted: true, authRequired: true, signupsOpen: false });
  // Without a session, the server refuses data requests.
  expect((await request.get(`${apiOrigin}/v1/conversations`)).status()).toBe(401);

  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Sign in to Nerdplexity' })).toBeVisible();
  await expect(page.getByText('New accounts are closed on this server.')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('do not match an account');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('aside').getByText('New chat', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Nerdplexity' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('nerdplexity:session'))).toBeNull();
});

test('an expired or revoked session returns to sign-in', async ({ page }) => {
  await page.goto('/app');
  await page.evaluate(() => localStorage.setItem('nerdplexity:session', 'revoked-session-token'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in to Nerdplexity' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('nerdplexity:session'))).toBeNull();
});
