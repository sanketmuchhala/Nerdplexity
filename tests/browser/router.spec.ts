import { expect, Page, test } from './fixtures';

const fake = `http://127.0.0.1:${Number(process.env.FAKE_PROVIDER_PORT) || 5299}`;
const prompt = (name: string) => `${name} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function send(page: Page, text: string) {
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.fill(text);
  await box.press('Enter');
}

/** Navigates inside the app: a reload would drop session-only API keys. */
async function chooseRouter(page: Page) {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Chat' }).click();
  await page.getByRole('button', { name: 'Choose model' }).click();
  await page.getByRole('button', { name: 'Use the Free Router' }).click();
  // The Free Router may already be the default, so wait for the picker to close, not for the label.
  await expect(page.getByRole('dialog', { name: 'Choose a model' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose model' })).toContainText('Free Router');
}

test('the Free Router tries the best free model, falls back when it is rate limited, and credits the model that answered', async ({ page }) => {
  // The real backend and run engine, against a catalog of two local models: a large one that is always rate limited.
  await page.goto('/app/models');
  await page.getByRole('button', { name: 'Add Provider' }).click();
  const form = page.getByRole('form', { name: 'Add connection' });
  await form.getByLabel('Connection type').selectOption('custom');
  await form.getByLabel('Connection name').fill('Fake router');
  await form.getByLabel('Server address').fill(`${fake}/router/v1`);
  await form.getByRole('button', { name: 'Save Connection' }).click();
  await expect(page.locator('h3[title="fast-model-8b"]')).toBeVisible();

  await chooseRouter(page);
  const first = prompt('route');
  await send(page, first);
  await expect(page.getByText('Hello from fast-model: café, naïve, \u{1F642}.')).toBeVisible();
  // The answer is credited to Nerdplexity; the router's panel names every model it tried.
  await expect(page.locator('.np-provenance')).toHaveCount(0);
  const decision = page.getByLabel('Free Router decision');
  await expect(decision).toContainText('1 fallback');
  await decision.locator('summary').first().click();
  await expect(decision).toContainText('limit-model-70b');
  await expect(decision).toContainText('rate limiting');

  const asked = async (text: string) => ((await (await page.request.get(`${fake}/_log?prompt=${encodeURIComponent(text)}`)).json()) as { model: string }[]).map(entry => entry.model);
  expect(await asked(first)).toEqual(['limit-model-70b', 'fast-model-8b']);

  // The rate-limited model is cooling down, so the next message goes straight to the one that works.
  const second = prompt('route again');
  await send(page, second);
  await expect(page.getByText('Hello from fast-model: café, naïve, \u{1F642}.')).toHaveCount(2);
  expect(await asked(second)).toEqual(['fast-model-8b']);
  await expect(page.getByLabel('Free Router decision').last()).toContainText('First choice');

  // Run history names the model that answered.
  await page.goto('/app/runs');
  await expect(page.locator('.np-run-row').first()).toContainText('fast-model-8b via Free Router');
});

test('the Free Router sends only models verified as free, and never a paid or unpriced one', async ({ page }) => {
  const model = (id: string, extra = {}) => ({ id, displayName: id, capabilities: { tools: true, vision: false }, source: 'discovered', ...extra });
  // Only OpenRouter answers; the built-in local connections are offline.
  await page.route('**/v1/models/discover', route => route.fulfill({ json: route.request().postDataJSON().target.kind === 'openrouter' ? {
    ok: true, execution: 'remote', checkedAt: Date.now(),
    models: [model('meta/llama:free', { pricing: 'zero-price', contextLength: 131072 }), model('vendor/big', { pricing: 'paid', price: { input: 3, output: 15 } }), model('vendor/mystery', { pricing: 'unknown' })],
  } : { ok: false, error: { category: 'offline', message: 'Offline.' }, checkedAt: Date.now() } }));
  const bodies: any[] = [];
  await page.route('**/v1/runs', async route => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, json: { runId: 'run-routed', existing: false } });
  });
  const events = [
    { type: 'queued', position: 0 }, { type: 'started' },
    { type: 'route', attempt: 1, connectionId: 'openrouter', model: 'meta/llama:free', status: 'trying', reason: 'Best free match for general questions.' },
    { type: 'delta', text: 'Routed answer.' },
    { type: 'completed', route: { connectionId: 'openrouter', model: 'meta/llama:free', task: 'general', attempts: 1 }, timing: { queuedMs: 0, ttftMs: 300, durationMs: 800 } },
  ];
  await page.route('**/v1/runs/*/events**', route => route.fulfill({ contentType: 'application/x-ndjson', body: events.map((event, i) => JSON.stringify({ v: 1, runId: 'run-routed', seq: i + 1, ts: Date.now(), event })).join('\n') + '\n' }));

  await page.goto('/app/models');
  await page.getByRole('button', { name: 'Add Provider' }).click();
  const form = page.getByRole('form', { name: 'Add connection' });
  await form.getByLabel('Connection type').selectOption('openrouter');
  await form.getByLabel('API key').fill('sk-or-test');
  await form.getByRole('button', { name: 'Save Connection' }).click();
  await expect(page.locator('h3[title="vendor/big"]')).toBeVisible();

  await chooseRouter(page);
  await expect(page.getByRole('button', { name: 'Choose model' })).toContainText('1 free model');
  await send(page, 'Hello');
  await expect(page.getByText('Routed answer.')).toBeVisible();
  await expect(page.locator('.np-provenance')).toHaveCount(0);

  expect(bodies).toHaveLength(1);
  expect(bodies[0].target).toBeUndefined();
  expect(bodies[0].route.models.map((m: { model: string }) => m.model)).toEqual(['meta/llama:free']);
  expect(bodies[0].route.connections).toEqual([{ id: expect.any(String), target: { kind: 'openrouter', apiKey: 'sk-or-test' } }]);
});

test('the Free Router pools available models from multiple free-plan provider keys', async ({ page }) => {
  const model = (id: string) => ({ id, displayName: id, capabilities: { tools: true, vision: false }, pricing: 'unknown', source: 'discovered' });
  await page.route('**/v1/models/discover', route => {
    const kind = route.request().postDataJSON().target.kind as string;
    const models = kind === 'groq' ? [model('groq-model')] : kind === 'cerebras' ? [model('cerebras-model')] : [];
    return route.fulfill({ json: models.length
      ? { ok: true, execution: 'remote', checkedAt: Date.now(), models }
      : { ok: false, error: { category: 'offline', message: 'Offline.' }, checkedAt: Date.now() } });
  });
  const bodies: any[] = [];
  await page.route('**/v1/runs', async route => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, json: { runId: 'run-multi-provider', existing: false } });
  });
  const events = [
    { type: 'queued', position: 0 }, { type: 'started' },
    { type: 'route', attempt: 1, connectionId: 'groq', model: 'groq-model', status: 'trying', reason: 'Best free match.' },
    { type: 'delta', text: 'Answer from the shared free pool.' },
    { type: 'completed', route: { connectionId: 'groq', model: 'groq-model', task: 'general', attempts: 1 }, timing: { queuedMs: 0, ttftMs: 100, durationMs: 300 } },
  ];
  await page.route('**/v1/runs/*/events**', route => route.fulfill({ contentType: 'application/x-ndjson', body: events.map((event, i) => JSON.stringify({ v: 1, runId: 'run-multi-provider', seq: i + 1, ts: Date.now(), event })).join('\n') + '\n' }));

  await page.goto('/app/models');
  for (const [kind, key] of [['groq', 'gsk-test'], ['cerebras', 'csk-test']] as const) {
    await page.getByRole('button', { name: 'Add Provider' }).click();
    const form = page.getByRole('form', { name: 'Add connection' });
    await form.getByLabel('Connection type').selectOption(kind);
    await form.getByLabel('API key').fill(key);
    await form.getByLabel('Account billing').selectOption('no-billing');
    await form.getByRole('button', { name: 'Save Connection' }).click();
    await expect(page.locator(`h3[title="${kind}-model"]`)).toBeVisible();
  }

  await chooseRouter(page);
  await expect(page.getByRole('button', { name: 'Choose model' })).toContainText('2 free models');
  await send(page, 'Use every free provider');
  await expect(page.getByText('Answer from the shared free pool.')).toBeVisible();

  expect(bodies).toHaveLength(1);
  expect(bodies[0].route.models.map((entry: { model: string }) => entry.model).sort()).toEqual(['cerebras-model', 'groq-model']);
  expect(bodies[0].route.connections.map((entry: any) => entry.target).sort((a: any, b: any) => a.kind.localeCompare(b.kind))).toEqual([
    { kind: 'cerebras', apiKey: 'csk-test', freeTier: true },
    { kind: 'groq', apiKey: 'gsk-test', freeTier: true },
  ]);
});
