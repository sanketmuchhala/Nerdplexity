import { expect, test } from '@playwright/test';

test('backend starts without an Ollama service', async ({ request }) => {
  const response = await request.get(`http://127.0.0.1:${Number(process.env.PORT) || 5174}/health`);
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({ status: 'ok' });
});

test('retired API paths are closed', async ({ request }) => {
  const response = await request.get(`http://127.0.0.1:${Number(process.env.PORT) || 5174}/v1/ping`);
  expect(response.status()).toBe(404);
  expect(await response.json()).toEqual({ error: 'API route not found.' });
});

test('a new conversation survives a browser reload', async ({ page }) => {
  await page.goto('/app');
  await page.locator('aside').getByRole('button', { name: 'New thread' }).click();
  await expect(page.locator('aside').getByText('New chat', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('aside').getByText('New chat', { exact: true })).toBeVisible();
});

test('retired analytics routes open Run history', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/app/analytics/events');
  await expect(page).toHaveURL(/\/app\/runs$/);
  await expect(page.getByRole('heading', { name: 'See what actually happened.' })).toBeVisible();
  await expect(page.locator('nav').getByRole('button', { name: 'Analytics' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a notice explains when the server cannot be reached, and Retry clears it', async ({ page }) => {
  await page.route('**/v1/health', route => route.fulfill({ status: 503, json: { error: 'down' } }));
  await page.goto('/app');
  const notice = page.locator('.np-backend-notice');
  await expect(notice).toContainText('No Nerdplexity server is connected.');
  await expect(notice.getByRole('link', { name: 'deploy the server' })).toHaveAttribute('href', /#deploying$/);
  await page.unroute('**/v1/health');
  await notice.getByRole('button', { name: 'Retry' }).click();
  await expect(notice).toHaveCount(0);
});

test('the API health check is served under /v1 for proxies and hosted frontends', async ({ page }) => {
  // Through the web app's dev proxy, as a hosted frontend would reach it through VITE_API_URL.
  const response = await page.request.get('/v1/health');
  expect(await response.json()).toMatchObject({ status: 'ok' });
});

const health = (extra: object) => ({ status: 'ok', timestamp: new Date().toISOString(), hosted: false, originAllowed: true, features: { ollamaManagement: true }, ...extra });

test('a server that does not allow this site says how to fix it', async ({ page }) => {
  await page.route('**/v1/health', route => route.fulfill({ json: health({ originAllowed: false }) }));
  await page.goto('/app');
  const notice = page.locator('.np-backend-notice');
  await expect(notice).toContainText('This Nerdplexity server does not allow this site.');
  await expect(notice).toContainText('ALLOWED_ORIGINS');
});

test('a hosted server hides Ollama management and explains why local models are unavailable', async ({ page }) => {
  await page.route('**/v1/health', route => route.fulfill({ json: health({ hosted: true, features: { ollamaManagement: false } }) }));
  await page.goto('/app/models');
  await expect(page.locator('.np-hosted-hint')).toContainText('cannot reach models on your computer');
  await expect(page.getByRole('heading', { name: 'Install an Ollama model' })).toHaveCount(0);
  await expect(page.locator('.np-backend-notice')).toHaveCount(0);
});
