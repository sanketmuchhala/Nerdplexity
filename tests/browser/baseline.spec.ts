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

test('the retired event route opens empty run analytics without a runtime exception', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/app/analytics/events');
  await expect(page).toHaveURL(/\/app\/analytics$/);
  await expect(page.getByRole('heading', { name: 'No run data yet.' })).toBeVisible();
  expect(errors).toEqual([]);
});
