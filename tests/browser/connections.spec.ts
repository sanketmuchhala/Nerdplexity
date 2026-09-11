import { expect, Page, test } from '@playwright/test';

type Target = { kind: string; baseURL?: string; apiKey?: string };

/** Serve discovery from fixtures so results do not depend on locally running runtimes. */
async function mockDiscovery(page: Page, respond: (target: Target) => unknown) {
  const targets: Target[] = [];
  await page.route('**/v1/models/discover', async route => {
    const { target } = route.request().postDataJSON();
    targets.push(target);
    await route.fulfill({ json: { checkedAt: Date.now(), ...respond(target) as object } });
  });
  return targets;
}

const offline = { ok: false, error: { category: 'offline', message: 'Nothing is answering at this address. Start the runtime, then refresh.' } };
const model = (id: string, extra = {}) => ({ id, displayName: id, capabilities: { tools: null, vision: null }, pricing: 'unknown', source: 'discovered', ...extra });

test('Models distinguishes an offline runtime from an empty catalog', async ({ page }) => {
  await mockDiscovery(page, target => target.kind === 'ollama' ? offline : { ok: true, execution: 'local', models: [] });
  await page.goto('/app/models');
  const connections = page.getByRole('region', { name: 'Connections' });
  const ollama = connections.getByRole('listitem').filter({ hasText: 'Ollama' });
  await expect(ollama.getByRole('status')).toHaveText('Offline');
  await expect(ollama).toContainText('Start the runtime');
  await expect(connections.getByRole('listitem').filter({ hasText: 'LM Studio' }).getByRole('status')).toHaveText('No models installed');
});

test('a custom endpoint is discovered, selected, and used for a streamed answer', async ({ page }) => {
  const targets = await mockDiscovery(page, target => target.baseURL === 'https://api.example.com/v1'
    ? { ok: true, execution: 'remote', models: [model('example/chat-1', { contextLength: 131072 })] }
    : offline);
  let runBody: any;
  await page.route('**/v1/local/run', async route => {
    runBody = route.request().postDataJSON();
    const events = [
      { type: 'status', message: 'Queued' },
      { type: 'delta', text: 'Hello from ' },
      { type: 'delta', text: 'the endpoint.' },
      { type: 'done', duration_ms: 12, usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } },
    ];
    await route.fulfill({ contentType: 'application/x-ndjson', body: events.map(e => JSON.stringify(e)).join('\n') + '\n' });
  });

  await page.goto('/app/models');
  await page.getByRole('button', { name: 'Add connection' }).click();
  const form = page.getByRole('form', { name: 'Add connection' });
  await form.getByLabel('Connection type').selectOption('custom');
  await form.getByLabel('Connection name').fill('Example');
  await form.getByLabel('Server address').fill('https://api.example.com/v1');
  await form.getByLabel('API key').fill('sk-example-secret');
  await form.getByRole('button', { name: 'Add and check' }).click();

  const row = page.getByRole('listitem').filter({ hasText: 'Example' });
  await expect(row.getByRole('status')).toHaveText('1 model');
  await expect(row).toContainText('Key for this session');
  expect(targets.find(t => t.baseURL === 'https://api.example.com/v1')?.apiKey).toBe('sk-example-secret');

  const card = page.getByRole('article').filter({ hasText: 'example/chat-1' });
  await expect(card).toContainText('131K context');
  await card.getByRole('button', { name: 'Use model' }).click();

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('button', { name: 'example/chat-1 Example', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message' }).fill('Say hello');
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(page.getByText('Hello from the endpoint.')).toBeVisible();
  await expect(page.getByText('example/chat-1 · Example')).toBeVisible();

  // The run is routed by connection, and the key travels only in the request body.
  expect(runBody).toMatchObject({ target: { kind: 'openai-compatible', baseURL: 'https://api.example.com/v1', apiKey: 'sk-example-secret' }, model: 'example/chat-1' });
  expect(runBody.provider).toBeUndefined();

  // Session-only keys are forgotten on reload.
  await page.goto('/app/models');
  await expect(page.getByRole('listitem').filter({ hasText: 'Example' })).not.toContainText('Key for this session');
});

test('a hosted provider without a key shows a key prompt instead of calling the backend', async ({ page }) => {
  const targets = await mockDiscovery(page, () => offline);
  await page.goto('/app/models');
  await page.getByRole('button', { name: 'Add connection' }).click();
  const form = page.getByRole('form', { name: 'Add connection' });
  await form.getByLabel('Connection type').selectOption('anthropic');
  await form.getByRole('button', { name: 'Add and check' }).click();
  await expect(form.getByRole('alert')).toHaveText('Enter an API key for this provider.');
  expect(targets.some(t => t.kind === 'anthropic')).toBe(false);
});
