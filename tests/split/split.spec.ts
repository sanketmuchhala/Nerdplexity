import { expect, test } from '@playwright/test';

const apiOrigin = `http://127.0.0.1:${Number(process.env.SPLIT_API_PORT) || 5576}`;
const fake = `http://127.0.0.1:${Number(process.env.FAKE_PROVIDER_PORT) || 5299}`;

test('a separately hosted web app discovers models and streams a chat through the backend', async ({ page }) => {
  const apiCalls: string[] = [];
  page.on('request', request => { if (request.url().includes('/v1/')) apiCalls.push(`${request.method()} ${request.url()}`); });

  await page.goto('/app/models');
  await expect(page.locator('.np-backend-notice')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add Provider' }).click();
  const form = page.getByRole('form', { name: 'Add connection' });
  await form.getByLabel('Connection type').selectOption('custom');
  await form.getByLabel('Connection name').fill('Split fake');
  await form.getByLabel('Server address').fill(`${fake}/v1`);
  await form.getByRole('button', { name: 'Save Connection' }).click();
  await page.getByRole('article').filter({ has: page.locator('h3[title="fast-model"]') }).getByRole('button', { name: 'Select Model' }).click();
  await expect(page).toHaveURL(/\/app$/);

  const prompt = `split ${Date.now()}`;
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(prompt);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.np-thread')).toContainText('Hello from fast-model');
  await expect(page.locator('.np-provenance')).toContainText('fast-model · Split fake');

  // Every API call went to the backend's own origin, not the page's.
  expect(apiCalls.length).toBeGreaterThan(0);
  expect(apiCalls.every(call => call.includes(`${apiOrigin}/v1/`))).toBe(true);
  expect(apiCalls.some(call => call.startsWith(`POST ${apiOrigin}/v1/runs`))).toBe(true);
  expect(apiCalls.some(call => call.startsWith(`GET ${apiOrigin}/v1/runs/`))).toBe(true);
  const upstream = await (await page.request.get(`${fake}/_log?prompt=${encodeURIComponent(prompt)}`)).json();
  expect(upstream).toHaveLength(1);
});
