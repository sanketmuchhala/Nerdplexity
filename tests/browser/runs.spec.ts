import { expect, Page, test } from '@playwright/test';

// These tests use the real backend and run engine against tests/fixtures/fake-provider.mjs.
const fake = `http://127.0.0.1:${Number(process.env.FAKE_PROVIDER_PORT) || 5299}`;

async function useFakeModel(page: Page, model: string) {
  await page.goto('/app/models');
  await page.getByRole('button', { name: 'Add connection' }).click();
  const form = page.getByRole('form', { name: 'Add connection' });
  await form.getByLabel('Connection type').selectOption('custom');
  await form.getByLabel('Connection name').fill('Fake');
  await form.getByLabel('Server address').fill(`${fake}/v1`);
  await form.getByRole('button', { name: 'Add and check' }).click();
  await page.getByRole('article').filter({ hasText: model }).getByRole('button', { name: 'Use model' }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function send(page: Page, prompt: string) {
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.fill(prompt);
  await box.press('Enter');
}

const upstream = async (page: Page, prompt: string) => (await page.request.get(`${fake}/_log?prompt=${encodeURIComponent(prompt)}`)).json();
const answers = (page: Page) => page.locator('.np-provenance');
const prompt = (name: string) => `${name} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test('an answer streams into view before the run completes', async ({ page }) => {
  await useFakeModel(page, 'slow-model');
  await send(page, prompt('stream'));
  await expect(page.getByText('token-2', { exact: false })).toBeVisible();
  // Still running: the stop control is shown and the final token has not arrived.
  await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible();
  await expect(page.getByText('token-29')).toHaveCount(0);
  await expect(page.getByText('token-29', { exact: false })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  await expect(answers(page)).toHaveCount(1);
  await expect(answers(page)).toHaveText('slow-model · Fake');
});

test('multi-byte text split across network chunks arrives intact', async ({ page }) => {
  await useFakeModel(page, 'fast-model');
  await send(page, prompt('unicode'));
  await expect(page.getByText('Hello from fast-model: café, naïve, \u{1F642}.')).toBeVisible();
});

test('Stop cancels the upstream request and keeps a labeled partial answer', async ({ page }) => {
  const text = prompt('stop');
  await useFakeModel(page, 'slow-model');
  await send(page, text);
  await expect(page.getByText('token-2', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Stop generation' }).click();
  await expect(answers(page)).toHaveText('slow-model · Fake · Stopped · partial answer');
  await expect(page.locator('.np-thread')).toContainText('token-0 token-1 token-2');
  await expect.poll(async () => (await upstream(page, text))[0]?.aborted).toBe(true);
  await page.waitForTimeout(800);
  await expect(page.getByText('token-29', { exact: false })).toHaveCount(0);
});

test('reloading mid-run reattaches without duplicating messages or requests', async ({ page }) => {
  const text = prompt('reload');
  await useFakeModel(page, 'slow-model');
  await send(page, text);
  await expect(page.getByText('token-3', { exact: false })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: new RegExp(text) }).first().click();
  await expect(page.getByText('token-29', { exact: false })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.np-thread').getByText(text, { exact: true })).toHaveCount(1);
  await expect(answers(page)).toHaveCount(1);
  // Every token appears exactly once in the final answer.
  const answer = await page.locator('.np-thread').innerText();
  for (let i = 0; i < 30; i++) expect(answer.match(new RegExp(`token-${i}(?!\\d)`, 'g'))).toHaveLength(1);
  expect(await upstream(page, text)).toHaveLength(1);
});

test('a run the server no longer has is marked interrupted, keeping the saved partial answer', async ({ page }) => {
  const text = prompt('restart');
  await useFakeModel(page, 'slow-model');
  await send(page, text);
  // Partial output is saved about once a second; wait until some has been persisted.
  await expect(page.getByText('token-14', { exact: false })).toBeVisible();
  // Simulate a backend restart: the run is unknown after the reload.
  await page.route('**/v1/runs/*/events**', route => route.fulfill({ status: 404, json: { error: 'This run is no longer available on the server.', code: 'unknown-run' } }));
  await page.reload();
  await page.getByRole('button', { name: new RegExp(text) }).first().click();
  await expect(answers(page)).toHaveText('slow-model · Fake · Interrupted · partial answer');
  await expect(page.locator('.np-thread')).toContainText('token-0');
  await expect(page.getByRole('alert')).toContainText('no longer available');
  // Nothing was resent automatically.
  expect(await upstream(page, text)).toHaveLength(1);
});

test('a rate limit shows retry guidance, and Retry does not repeat the user message', async ({ page }) => {
  const text = prompt('limit');
  await useFakeModel(page, 'limit-model');
  await send(page, text);
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('rate limiting');
  await expect(alert).toContainText('Try again in 7s.');
  await expect(answers(page)).toHaveCount(0);
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(async () => (await upstream(page, text)).length).toBe(2);
  await expect(page.getByRole('alert')).toContainText('Try again in 7s.');
  await expect(page.locator('.np-thread').getByText(text, { exact: true })).toHaveCount(1);
  await page.goto('/app/runs');
  await expect(page.locator('.np-run-list').getByRole('button', { name: new RegExp(text) })).toHaveCount(2);
});

test('a dropped stream keeps the partial answer marked as incomplete', async ({ page }) => {
  await useFakeModel(page, 'broken-model');
  await send(page, prompt('broken'));
  await expect(page.getByText('partial-a partial-b')).toBeVisible();
  await expect(answers(page)).toHaveText('broken-model · Fake · Failed · partial answer');
  await expect(page.getByRole('alert')).toContainText('ended before the model finished');
});

test('reasoning reported by the model is shown separately from the answer', async ({ page }) => {
  await useFakeModel(page, 'reasoning-model');
  await send(page, prompt('reasoning'));
  await expect(page.getByText('Reasoned answer.')).toBeVisible();
  await page.getByRole('button', { name: 'Thought process' }).click();
  await expect(page.getByText('Considering the question.')).toBeVisible();
});
