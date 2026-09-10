import { expect, test } from '@playwright/test';

test('backend starts without an Ollama service', async ({ request }) => {
  const response = await request.get('http://127.0.0.1:5174/health');
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({ status: 'ok' });
});

test('a new conversation survives a browser reload', async ({ page }) => {
  await page.goto('/app');
  await page.locator('aside').getByRole('button', { name: 'New thread' }).click();
  await expect(page.locator('aside').getByText('New chat', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('aside').getByText('New chat', { exact: true })).toBeVisible();
});

test('empty event history renders without a runtime exception', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/app/analytics/events');
  await expect(page.getByRole('heading', { name: 'No Events Found' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('settings opens from chat and closes with Escape', async ({ page }) => {
  await page.goto('/app');
  await page.getByRole('button', { name: 'Settings & API Keys' }).click();
  await expect(page.getByPlaceholder('sk-ant-...')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByPlaceholder('sk-ant-...')).toBeHidden();
});
