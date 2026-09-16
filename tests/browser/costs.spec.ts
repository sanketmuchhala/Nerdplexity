import { expect, Page, test } from './fixtures';

type Target = { kind: string; baseURL?: string; apiKey?: string };
const model = (id: string, extra = {}) => ({ id, displayName: id, capabilities: { tools: null, vision: null }, pricing: 'unknown', source: 'discovered', ...extra });
const offline = { ok: false, error: { category: 'offline', message: 'Offline.' } };
const timing = { queuedMs: 0, ttftMs: 400, durationMs: 900 };

async function mockDiscovery(page: Page, byKind: Record<string, unknown[]>) {
  await page.route('**/v1/models/discover', async route => {
    const { target } = route.request().postDataJSON() as { target: Target };
    const models = byKind[target.kind];
    await route.fulfill({ json: { checkedAt: Date.now(), ...(models ? { ok: true, execution: 'remote', models } : offline) } });
  });
}

/** Serve runs from a script: each started run gets the next list of events. */
async function mockRuns(page: Page, script: object[][]) {
  const bodies: any[] = [];
  await page.route('**/v1/runs', async route => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, json: { runId: `run-${bodies.length}`, existing: false } });
  });
  await page.route('**/v1/runs/*/events**', async route => {
    const index = Number(/run-(\d+)/.exec(route.request().url())![1]) - 1;
    const events = [{ type: 'queued', position: 0 }, { type: 'started' }, ...(script[Math.min(index, script.length - 1)])];
    await route.fulfill({ contentType: 'application/x-ndjson', body: events.map((event, i) => JSON.stringify({ v: 1, runId: `run-${index + 1}`, seq: i + 1, ts: Date.now(), event })).join('\n') + '\n' });
  });
  return bodies;
}

async function addConnection(page: Page, type: string, key: string, billing?: string) {
  await page.goto('/app/models');
  await page.getByRole('button', { name: 'Add Provider' }).click();
  const form = page.getByRole('form', { name: 'Add connection' });
  await form.getByLabel('Connection type').selectOption(type);
  await form.getByLabel('API key').fill(key);
  if (billing) await form.getByLabel('Account billing').selectOption(billing);
  await form.getByRole('button', { name: 'Save Connection' }).click();
}

// Model rows show a readable name; the exact model ID is the heading's title.
const card = (page: Page, id: string) => page.getByRole('article').filter({ has: page.locator(`h3[title="${id}"]`) });

test('Free only blocks models that are not confirmed free until the user allows charges', async ({ page }) => {
  await mockDiscovery(page, { openrouter: [
    model('meta/llama:free', { pricing: 'zero-price' }),
    model('vendor/big', { pricing: 'paid', price: { input: 3, output: 15 } }),
  ] });
  const runs = await mockRuns(page, [[{ type: 'delta', text: 'Billed answer.' }, { type: 'completed', timing }]]);
  await addConnection(page, 'openrouter', 'sk-or-test');
  await expect(card(page, 'meta/llama:free')).toContainText('Free model');
  await expect(card(page, 'vendor/big')).toContainText('$3 in / $15 out per M tokens');

  await page.getByLabel(/Free only/).check();
  await expect(card(page, 'vendor/big').getByRole('button', { name: 'Select Model' })).toBeDisabled();
  await page.getByRole('button', { name: 'Free to use' }).click();
  await expect(page.getByRole('article')).toHaveCount(1);

  // A model ID the catalog does not list has an unknown price, so it is blocked.
  await page.getByLabel('Connection for model ID').selectOption({ label: 'OpenRouter' });
  await page.getByLabel('Model ID', { exact: true }).fill('vendor/unlisted');
  await page.getByRole('button', { name: 'Use model ID' }).click();
  const notice = page.getByRole('note');
  await expect(notice).toContainText('Free only is on. Nerdplexity cannot confirm this model is free on OpenRouter.');
  await page.getByRole('textbox', { name: 'Message' }).fill('Hello');
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  expect(runs).toHaveLength(0);

  await notice.getByRole('button', { name: 'Allow charges in this thread' }).click();
  await expect(page.getByRole('button', { name: 'Charges allowed here' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(page.getByText('Billed answer.')).toBeVisible();
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ model: 'vendor/unlisted', costPolicy: 'any', target: { kind: 'openrouter', apiKey: 'sk-or-test' } });
});

test('a free model that hits its limit offers free alternatives and never switches on its own', async ({ page }) => {
  await mockDiscovery(page, { openrouter: [model('a:free', { pricing: 'zero-price' }), model('b:free', { pricing: 'zero-price' }), model('openrouter/free', { pricing: 'zero-price' }), model('paid', { pricing: 'paid' })] });
  const runs = await mockRuns(page, [
    [{ type: 'failed', error: { category: 'quota', message: "OpenRouter's shared Google AI Studio route is temporarily rate limited. This model is still $0.", retryable: true, retryAfterMs: 45000 }, timing }],
    [{ type: 'delta', text: 'Answer from the free router.' }, { type: 'completed', timing }],
  ]);
  await addConnection(page, 'openrouter', 'sk-or-test');
  await card(page, 'a:free').getByRole('button', { name: 'Select Model' }).click();
  await page.getByRole('textbox', { name: 'Message' }).fill('Question');
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('shared Google AI Studio route is temporarily rate limited');
  await expect(alert).toContainText('still $0');
  await expect(alert).toContainText('Try again in 45s.');
  await expect(alert.getByRole('button', { name: 'Try openrouter/free' })).toBeVisible();
  await expect(alert.getByRole('button', { name: /Try paid/ })).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(runs).toHaveLength(1);

  await alert.getByRole('button', { name: 'Try openrouter/free' }).click();
  await expect(page.getByText('Answer from the free router.')).toBeVisible();
  expect(runs.map(r => r.model)).toEqual(['a:free', 'openrouter/free']);
  await expect(page.locator('.np-provenance')).toHaveText('openrouter/free · OpenRouter');
  await expect(page.locator('.np-thread').getByText('Question', { exact: true })).toHaveCount(1);
});

test('an account marked as having no billing counts as free, and the Gemini data-use notice is shown', async ({ page }) => {
  await mockDiscovery(page, { gemini: [model('gemini-2.5-flash')] });
  await page.goto('/app/models');
  await page.getByRole('button', { name: 'Add Provider' }).click();
  const form = page.getByRole('form', { name: 'Add connection' });
  await form.getByLabel('Connection type').selectOption('gemini');
  await expect(form).toContainText('Google may use your prompts to improve its products');
  await form.getByLabel('API key').fill('AIza-test');
  await form.getByLabel('Account billing').selectOption('no-billing');
  await form.getByRole('button', { name: 'Save Connection' }).click();
  await page.getByLabel(/Free only/).check();
  await expect(card(page, 'gemini-2.5-flash')).toContainText('Free plan');
  await expect(card(page, 'gemini-2.5-flash').getByRole('button', { name: 'Select Model' })).toBeEnabled();
});

test('Check enforces Free only and asks before a paid check when charges are allowed', async ({ page }) => {
  await mockDiscovery(page, { openrouter: [model('a:free', { pricing: 'zero-price' }), model('vendor/big', { pricing: 'paid', price: { input: 3, output: 15 } })] });
  const runs = await mockRuns(page, [[{ type: 'delta', text: 'OK' }, { type: 'completed', timing }]]);
  await addConnection(page, 'openrouter', 'sk-or-test');
  await card(page, 'a:free').getByRole('button', { name: 'Check' }).click();
  await expect(card(page, 'a:free')).toContainText('Check passed · first text in 0.4s');
  await card(page, 'vendor/big').getByRole('button', { name: 'Check' }).click();
  await expect(page.getByRole('alert')).toContainText('Turn it off before checking a paid or unpriced model');
  expect(runs).toHaveLength(1);
  await page.getByLabel(/Free only/).uncheck();
  const dialogs: string[] = [];
  page.once('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  await card(page, 'vendor/big').getByRole('button', { name: 'Check' }).click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toContain('may bill it');
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ model: 'a:free', costPolicy: 'free-only', settings: { maxTokens: 64 } });
  page.once('dialog', dialog => { void dialog.accept(); });
  await card(page, 'vendor/big').getByRole('button', { name: 'Check' }).click();
  await expect(card(page, 'vendor/big')).toContainText('Check passed');
  expect(runs[1]).toMatchObject({ model: 'vendor/big', costPolicy: 'any' });
});
