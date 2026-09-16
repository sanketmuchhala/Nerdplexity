import { expect, type Page, test } from './fixtures';
import { readFile } from 'node:fs/promises';

const fake = `http://127.0.0.1:${Number(process.env.FAKE_PROVIDER_PORT) || 5299}`;
const unique = (name: string) =>
  `${name} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const upstream = async (page: Page, prompt: string) =>
  (
    await page.request.get(`${fake}/_log?prompt=${encodeURIComponent(prompt)}`)
  ).json();
async function setup(page: Page, model = 'fast-model') {
  await page.goto('/app/models');
  await page.getByRole('button', { name: 'Add Provider' }).click();
  const form = page.getByRole('form', { name: 'Add connection' });
  await form.getByLabel('Connection type').selectOption('custom');
  await form.getByLabel('Connection name').fill('Workbench fake');
  await form.getByLabel('Server address').fill(`${fake}/v1`);
  await form.getByRole('button', { name: 'Save Connection' }).click();
  await page
    .getByRole('article')
    .filter({ hasText: model })
    .getByRole('button', { name: 'Select Model' })
    .click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.getByRole('button', { name: 'Choose model', exact: true }),
  ).toContainText(model);
}
async function send(page: Page, text: string, count: number) {
  await expect(page.locator('dialog')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.np-provenance')).toHaveCount(count);
}
async function choose(page: Page, model: string) {
  await page.getByRole('button', { name: 'Choose model', exact: true }).click();
  await page
    .getByRole('button', {
      name: `Use ${model} on Workbench fake`,
      exact: true,
    })
    .click();
}

test('switches models inline with coherent history and preserved provenance', async ({
  page,
}) => {
  await setup(page);
  const first = unique('first'),
    second = unique('second');
  await send(page, first, 1);
  await choose(page, 'reasoning-model');
  await send(page, second, 2);
  await expect(page.locator('.np-provenance')).toHaveText([
    'fast-model · Workbench fake',
    'reasoning-model · Workbench fake',
  ]);
  const log = await upstream(page, second);
  expect(log[0].model).toBe('reasoning-model');
  expect(log[0].messages.map((m: { role: string }) => m.role)).toEqual([
    'system',
    'user',
    'assistant',
    'user',
  ]);
  expect(log[0].messages[0].content).toContain('everyday-chat-v1');
  expect(log[0].messages[1].content).toBe(first);
});

test('automatic output uses discovered model capacity and persists across reloads', async ({ page }) => {
  await page.route('**/v1/models/discover', async route => {
    const response = await route.fetch();
    const catalog = await response.json();
    if (catalog.ok) catalog.models = catalog.models.map((model: { id: string }) => ({ ...model, contextLength: 131_072, maxOutputTokens: 32_768 }));
    await route.fulfill({ response, json: catalog });
  });
  await setup(page);
  await page.getByRole('button', { name: 'Generation settings' }).click();
  await expect(page.getByLabel('Output limit mode')).toHaveValue('auto');
  await expect(page.getByLabel('Context budget mode')).toHaveValue('auto');
  await expect(page.locator('.np-context-summary')).toContainText('32,768 output tokens');
  await page.getByRole('button', { name: 'Apply to this thread' }).click();
  await page.reload();
  const text = unique('automatic output');
  await send(page, text, 1);
  const requests = await upstream(page, text);
  expect(requests[0].maxTokens).toBe(32_768);
});

test('presets survive reload and retries retain the original input/settings snapshot', async ({
  page,
}) => {
  await setup(page, 'limit-model');
  await page.getByRole('button', { name: 'Generation settings' }).click();
  await page.getByLabel('System instruction').fill('Original instruction');
  await page.getByLabel('Output limit mode').selectOption('custom');
  await page.getByLabel('Maximum output tokens').fill('321');
  await page.getByLabel('Preset name').fill('Focused');
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Preset saved');
  await page.getByRole('button', { name: 'Apply to this thread' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Generation settings' }).click();
  await page
    .getByLabel('Saved preset')
    .selectOption({ label: 'Focused · limit-model' });
  await page.getByRole('button', { name: 'Use preset', exact: true }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  const text = unique('immutable');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('alert')).toContainText('rate limiting');
  await page.getByRole('button', { name: 'Generation settings' }).click();
  await page.getByLabel('System instruction').fill('Changed instruction');
  await page.getByLabel('Maximum output tokens').fill('999');
  await page.getByRole('button', { name: 'Apply to this thread' }).click();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(async () => (await upstream(page, text)).length).toBe(2);
  const requests = await upstream(page, text);
  expect(requests[0].messages).toEqual(requests[1].messages);
  expect(requests[1].messages[0].content).toContain('everyday-chat-v1');
  expect(requests[1].messages[1].content).toContain('Original instruction');
  expect(requests.map((r: { maxTokens: number }) => r.maxTokens)).toEqual([
    321, 321,
  ]);
  expect(requests[1]).not.toHaveProperty('temperature');
  await page.goto('/app/runs');
  await page
    .locator('.np-run-list')
    .getByRole('button', { name: new RegExp(text) })
    .first()
    .click();
  await page.getByText('Input and settings sent', { exact: true }).click();
  await expect(page.locator('.np-run-detail')).toContainText(
    'Original instruction',
  );
});

test('editing and regenerating create branches without changing the original thread', async ({
  page,
}) => {
  await setup(page);
  const original = unique('original'),
    edited = unique('edited');
  await send(page, original, 1);
  await page
    .getByRole('button', { name: 'Edit message 1 in a branch', exact: true })
    .click();
  await page.getByLabel('Branch message').fill(edited);
  await page.getByRole('button', { name: 'Start branch' }).click();
  await expect(
    page.getByRole('textbox', { name: 'Message', exact: true }),
  ).toHaveValue(edited);
  expect(await upstream(page, edited)).toHaveLength(0);
  await send(page, edited, 1);
  await page
    .locator('.np-history-row > button:first-child')
    .filter({ hasText: original })
    .last()
    .click();
  await expect(page.locator('.np-thread')).toContainText(original);
  await expect(page.locator('.np-thread')).not.toContainText(edited);
  await page
    .getByRole('button', { name: 'Regenerate message 2', exact: true })
    .click();
  await expect(page.locator('.np-provenance')).toHaveCount(1);
  await expect(page.locator('.np-chat-toolbar')).toContainText(
    'Branch · original retained',
  );
  await expect
    .poll(async () => (await upstream(page, original)).length)
    .toBe(2);
  await expect(page.locator('.np-history-row')).toHaveCount(3);
});

test('context limits trim whole old turns automatically, and export/import preserves the transcript', async ({
  page,
}) => {
  await setup(page);
  const data = {
    format: 'nerdplexity-thread',
    version: 1,
    title: 'Long imported thread',
    allowCharges: true,
    connectionId: 'untrusted',
    messages: [
      { role: 'user', content: 'Old ' + 'x'.repeat(5000) },
      { role: 'assistant', content: 'Old answer' },
      { role: 'user', content: 'Recent question' },
      { role: 'assistant', content: 'Recent answer' },
    ],
  };
  await page.getByLabel('Import thread file').setInputFiles({
    name: 'thread.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.locator('.np-chat-toolbar')).toContainText(
    'Long imported thread',
  );
  await expect(
    page.getByRole('button', { name: 'Choose model', exact: true }),
  ).toContainText('Choose a model');
  await choose(page, 'fast-model');
  await page.getByRole('button', { name: 'Generation settings' }).click();
  await page.getByLabel('Output limit mode').selectOption('custom');
  await page.getByLabel('Context budget mode').selectOption('custom');
  await page.getByLabel('Maximum output tokens').fill('100');
  await page.getByLabel('Context budget', { exact: true }).fill('2048');
  await page.getByRole('button', { name: 'Apply to this thread' }).click();
  const text = unique('trim');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await expect(page.getByRole('button', { name: 'Inspect context' })).toContainText('2 messages omitted');
  await send(page, text, 1);
  const requests = await upstream(page, text);
  expect(
    requests[0].messages.map((m: { content: string }) => m.content),
  ).toEqual([
    expect.stringContaining('everyday-chat-v1'),
    'Recent question',
    'Recent answer',
    text,
  ]);
  await expect(page.locator('.np-thread')).toContainText('Old answer');
  const downloadPromise = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export thread', exact: true })
    .click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported.messages).toHaveLength(6);
  expect(exported).not.toHaveProperty('connectionId');
  expect(exported).not.toHaveProperty('allowCharges');
  await page.getByLabel('Import thread file').setInputFiles({
    name: 'again.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(page.locator('.np-history-row')).toHaveCount(3);
  await expect(
    page.getByRole('button', { name: 'Choose model', exact: true }),
  ).toContainText('Choose a model');
});

test('theme, keyboard dialogs, mobile navigation, and responsive layouts', async ({
  page,
}, testInfo) => {
  await setup(page);
  await page.getByRole('button', { name: 'Choose model', exact: true }).click();
  await expect(page.getByLabel('Search models')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Choose model', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('.np-app')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('.np-app')).toHaveAttribute('data-theme', 'light');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width <= 900) await expect(page.locator('.np-sidebar')).toBeHidden();
    // Let responsive transitions paint before retaining a visual-review artifact.
    await page.waitForTimeout(250);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`light-${width}.png`) });
  }
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const nav = page.getByRole('dialog', { name: 'Navigation', exact: true });
  await expect(
    nav.getByRole('button', { name: 'Close navigation', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    nav.getByRole('link', { name: 'Nerdplexity on GitHub' }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    nav.getByRole('button', { name: 'Close navigation', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Open navigation' }),
  ).toBeFocused();
  await expect(page.locator('#workspace-content')).not.toHaveAttribute(
    'inert',
    '',
  );
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.screenshot({ path: testInfo.outputPath('dark-390.png') });
  await page.getByRole('button', { name: 'Generation settings' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Run settings' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('settings-390.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(
    page.getByRole('dialog', { name: 'Search workspace' }),
  ).toBeVisible();
  await expect(page.getByLabel('Search pages and threads')).toBeFocused();
  await page.keyboard.press('Escape');
});

test('attachments are inspectable and comparisons run identical frozen context', async ({ page }) => {
  await page.route('**/v1/models/discover', async route => {
    const body = route.request().postDataJSON();
    const connected = String(body.target.baseURL ?? '').includes(String(Number(process.env.FAKE_PROVIDER_PORT) || 5299));
    await route.fulfill({ json: { ok: true, execution: 'local', checkedAt: Date.now(), models: connected ? ['fast-model', 'reasoning-model'].map(id => ({ id, displayName: id, capabilities: { tools: null, vision: true }, pricing: 'local', source: 'discovered' })) : [] } });
  });
  await setup(page);
  await page.getByLabel('Attach files').setInputFiles([
    { name: 'facts.md', mimeType: 'text/markdown', buffer: Buffer.from('# Fact\nThe answer is forty-two.') },
    { name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from('image') },
  ]);
  const attachment = page.locator('.np-attachment').filter({ hasText: 'facts.md' });
  await expect(attachment).toContainText('facts.md');
  await attachment.locator('summary').click();
  await expect(attachment).toContainText('The answer is forty-two.');

  const contextPrompt = unique('attached');
  await send(page, contextPrompt, 1);
  const attachedRequest = await upstream(page, contextPrompt);
  expect(attachedRequest[0].messages[1].content).toContain('--- BEGIN FILE: facts.md ---');
  expect(attachedRequest[0].messages.at(-1).content[1]).toMatchObject({ type: 'image_url', image_url: { url: expect.stringContaining('data:image/png;base64,') } });

  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/compare$/);
  await page.getByLabel('Comparison model A').selectOption({ label: 'fast-model · Workbench fake' });
  await page.getByLabel('Comparison model B').selectOption({ label: 'reasoning-model · Workbench fake' });
  const comparePrompt = unique('compare');
  await page.getByLabel('Comparison prompt').fill(comparePrompt);
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await expect(page.locator('.np-compare-side')).toHaveCount(2);
  await expect(page.locator('.np-compare-side .np-label')).toHaveText(['completed', 'completed']);
  const compared = await upstream(page, comparePrompt);
  expect(compared).toHaveLength(2);
  expect(compared[0].messages).toEqual(compared[1].messages);
  expect(compared[0].messages[1].content).toContain('facts.md');
  // Both models are on this machine: the second request starts only after the first finishes.
  const [firstRun, secondRun] = [...compared].sort((a, b) => a.startedAt - b.startedAt);
  expect(secondRun.startedAt).toBeGreaterThanOrEqual(firstRun.endedAt);
  await expect(page.locator('.np-compare-settings')).toContainText('Shared settings: Temperature');
  await expect(page.locator('.np-compare-settings')).toContainText('one at a time');
  await expect(page.locator('.np-compare-side').first()).toContainText('Provider-reported tokens');
  await expect(page.locator('.np-compare-side').first()).toContainText('Runtime-reported model load');
  await page.reload();
  await page.getByRole('button', { name: new RegExp(comparePrompt) }).click();
  await expect(page.locator('.np-compare-side')).toHaveCount(2);
  await page.getByRole('button', { name: 'Continue in chat' }).nth(1).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('button', { name: 'Choose model', exact: true })).toContainText('reasoning-model');
  await expect(page.locator('.np-thread')).toContainText(comparePrompt);
  let remaining = await page.locator('.np-attachment').count();
  while (remaining > 0) {
    const item = page.locator('.np-attachment').first();
    await item.locator('summary').click();
    await item.getByRole('button', { name: 'Remove from context' }).click();
    remaining -= 1;
    await expect(page.locator('.np-attachment')).toHaveCount(remaining);
  }
  await expect(page.locator('.np-attachment')).toHaveCount(0);
});

test('Ollama install progress and removal reflect runtime state', async ({ page }) => {
  const installed = ['qwen3:8b'];
  await page.route('**/v1/models/discover', async route => {
    const body = route.request().postDataJSON();
    const ollama = body.target.kind === 'ollama';
    await route.fulfill({ json: { ok: true, execution: 'local', checkedAt: Date.now(), models: ollama ? installed.map(id => ({ id, displayName: id, capabilities: { tools: null, vision: null }, pricing: 'local', source: 'discovered' })) : [] } });
  });
  await page.route('**/v1/models/ollama/pull', async route => {
    const body = route.request().postDataJSON();
    installed.push(body.model);
    await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: '{"status":"downloading","total":100,"completed":50,"done":false}\n{"status":"success","done":true}\n' });
  });
  await page.route('**/v1/models/ollama', async route => {
    const body = route.request().postDataJSON();
    installed.splice(installed.indexOf(body.model), 1);
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/app/models');
  await page.getByLabel('Ollama connection').selectOption({ label: 'Ollama' });
  await page.getByLabel('Ollama model name').fill('gemma3:4b');
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(page.getByRole('article').filter({ hasText: 'gemma3:4b' })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('article').filter({ hasText: 'gemma3:4b' }).getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('article').filter({ hasText: 'gemma3:4b' })).toHaveCount(0);
});

test('calculator tool: the exact call and result stay separate from model text and persist', async ({ page }) => {
  await setup(page, 'tool-model');
  await page.locator('summary[aria-label="Tools"]').click();
  const toggle = page.getByRole('button', { name: 'Calculator tool' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.np-composer-footnote')).toContainText('Tools: Calculator');
  const text = unique('What is [[2+3*4]]?');
  await send(page, text, 1);
  const activity = page.locator('.np-thread .np-tool');
  await expect(activity).toHaveCount(2);
  await expect(activity.first()).toContainText('I will calculate this exactly.');
  await expect(activity.nth(1)).toContainText('Calculator');
  await expect(activity.nth(1)).toContainText('2+3*4 = 14');
  await expect(page.locator('.np-answer-content')).toHaveText('The result is 14.');
  await activity.nth(1).locator('summary').click();
  await expect(activity.nth(1)).toContainText('Computed by the app, not by the model.');

  const requests = await upstream(page, text);
  expect(requests).toHaveLength(2);
  expect(requests[0].tools).toEqual(['calculator']);
  expect(requests[1].messages.slice(-2)).toEqual([
    { role: 'assistant', content: 'I will calculate this exactly.', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'calculator', arguments: '{"expression":"2+3*4"}' } }] },
    { role: 'tool', tool_call_id: 'call_1', content: '{"expression":"2+3*4","result":14}' },
  ]);

  await page.reload();
  await page.locator('.np-history-row > button:first-child').filter({ hasText: text }).click();
  await expect(page.locator('.np-thread .np-tool').filter({ hasText: 'Calculator' })).toContainText('2+3*4 = 14');
  await expect(page.getByRole('button', { name: 'Calculator tool' })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/app/runs');
  const row = page.locator('.np-run-list').getByRole('button', { name: new RegExp(text.replace(/[[\]+*?]/g, '\\$&')) }).first();
  await expect(row).toContainText('With tools');
  await row.click();
  await expect(page.locator('.np-run-detail .np-tool').filter({ hasText: 'Calculator' })).toContainText('2+3*4 = 14');
});

test('malformed tool arguments are returned to the model and the run still completes', async ({ page }) => {
  await setup(page, 'tool-model');
    await page.locator('summary[aria-label="Tools"]').click();
  await page.getByRole('button', { name: 'Calculator tool' }).click();
  const text = unique('malformed request');
  await send(page, text, 1);
  const activity = page.locator('.np-thread .np-tool-error');
  await expect(activity).toContainText('not valid JSON');
  await expect(page.locator('.np-thread')).toContainText('The tool reported an error: The tool arguments were not valid JSON.');
  const requests = await upstream(page, text);
  expect(JSON.parse(requests[1].messages.at(-1).content)).toEqual({ error: 'The tool arguments were not valid JSON.' });
});

test('document tools search, then read, local workspace documents in a multi-step loop', async ({ page }) => {
  await page.goto('/app/workspace');
  await page.getByRole('button', { name: 'New document' }).click();
  await page.getByLabel('Document title').fill('Launch notes');
  await page.getByLabel('Content').fill('Owner: Priya. Decision: ship on Friday.');
  await page.getByRole('button', { name: 'Save document' }).click();
  await expect(page.getByRole('status')).toContainText('Document saved');
  await setup(page, 'tool-model');
  // Documents opens its panel: the documents, and the switch that lets this thread use them.
      await page.locator('summary[aria-label="Tools"]').click();
  await page.getByRole('button', { name: 'Documents tool' }).click();
  const panel = page.getByRole('dialog', { name: 'Documents' });
  await expect(panel.getByText('Launch notes')).toBeVisible();
  await panel.getByRole('switch', { name: 'Use documents in this thread' }).click();
  await expect(panel.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Documents tool' })).toHaveAttribute('aria-pressed', 'true');
  const text = unique('Check my notes');
  await send(page, text, 1);
  const activity = page.locator('.np-thread .np-tool');
  await expect(activity).toHaveCount(2);
  await expect(activity.nth(0)).toContainText('Searched documents');
  await expect(activity.nth(0)).toContainText('“owner” · 1 match');
  await expect(activity.nth(1)).toContainText('Read a document');
  await expect(page.locator('.np-thread')).toContainText('According to Launch notes: Owner: Priya. Decision: ship on Friday.');
  await activity.nth(1).locator('summary').click();
  await expect(activity.nth(1)).toContainText('Retrieved from your documents');
  const requests = await upstream(page, text);
  expect(requests).toHaveLength(3);
  expect(requests[0].tools).toEqual(['search_documents', 'read_document']);
  expect(requests[0].messages[0].content).toContain('Launch notes');
});

test('web search runs on its own when a message needs current information, shows safe sources, and keeps the key out of the model request', async ({ page }) => {
  const key = 'exa-test-key-000001';
  
  const exaLog = async () => (await page.request.get(`${fake}/_exa_log`)).json();
  await setup(page, 'fast-model');
  // There is no Web button: search is automatic once an Exa key is saved in Connections.
    await page.locator('summary[aria-label="Tools"]').click();
  await expect(page.getByRole('button', { name: 'Web tool' })).toHaveCount(0);
    await expect(page.locator('.np-composer-footnote')).not.toContainText('Web search');
  await page.getByRole('navigation', { name: 'Settings navigation' }).getByRole('button', { name: 'Connections' }).click();
  await page.getByLabel('Exa API key').fill(key);
  await page.getByRole('button', { name: 'Save key' }).click();
  await expect(page.locator('.np-web-search')).toContainText('Key saved for this tab');
  await expect(page.locator('.np-web-search')).toContainText('exa••••0001');
  await expect(page.getByRole('checkbox', { name: /Search automatically/ })).toBeChecked();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Chat' }).click();
  await expect(page.locator('.np-composer-footnote')).toContainText('Web search is automatic (Exa)');

  // A question about something current is searched before the model answers.
  const text = unique('What is the latest Nerdplexity release?');
  await send(page, text, 1);
  const activity = page.locator('.np-thread .np-tool');
  await expect(activity).toContainText('Searched the web');
  await expect(activity).toContainText('· 1 result');
  await expect(activity).toContainText('Automatic');
  await activity.locator('summary').click();
  await expect(activity).toContainText('Retrieved from the web through Exa');
  const link = activity.getByRole('link', { name: 'Nerdplexity 2.0 released' });
  await expect(link).toHaveAttribute('href', 'https://example.com/nerdplexity-2');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(activity.getByRole('link')).toHaveCount(1);
  expect((await exaLog()).at(-1)).toMatchObject({ key, body: { query: text, numResults: 5 } });
  const requests = await upstream(page, text);
  expect(requests[0].tools).toEqual([]);
  expect(requests[0].messages.some((m: { role: string; content: string }) => m.role === 'system' && m.content.includes('https://example.com/nerdplexity-2'))).toBe(true);
  expect(JSON.stringify(requests)).not.toContain(key);

  // A message that does not need the web is not searched.
  const searches = (await exaLog()).length;
  await send(page, unique('Tell me a joke about cats'), 2);
  expect((await exaLog()).length).toBe(searches);

  // Turned off in Connections, nothing is searched.
  await page.getByRole('navigation', { name: 'Settings navigation' }).getByRole('button', { name: 'Connections' }).click();
  await page.getByRole('checkbox', { name: /Search automatically/ }).uncheck();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Chat' }).click();
  await expect(page.locator('.np-composer-footnote')).not.toContainText('Web search');
  await send(page, unique('Any news today?'), 3);
  expect((await exaLog()).length).toBe(searches);

  await page.getByRole('navigation', { name: 'Lab navigation' }).getByRole('button', { name: 'History' }).click();
  await page.locator('.np-run-list').getByRole('button', { name: text }).first().click();
  await page.getByText('Input and settings sent', { exact: true }).click();
  await expect(page.locator('.np-run-detail')).not.toContainText(key);
});

test('Documents opens the documents, not the model picker, even before a model is chosen', async ({ page }) => {
  await page.goto('/app');
      await page.locator('summary[aria-label="Tools"]').click();
  await page.getByRole('button', { name: 'Documents tool' }).click();
  const panel = page.getByRole('dialog', { name: 'Documents' });
  await expect(panel).toContainText('Your workspace is empty.');
  await expect(panel.getByRole('switch', { name: 'Use documents in this thread' })).toBeDisabled();
  await expect(page.getByRole('dialog', { name: 'Choose model' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Add a document' }).click();
  await expect(page).toHaveURL(/\/app\/workspace$/);
  // The notes card on the welcome screen opens the same panel when documents cannot be used yet.
  await page.goto('/app');
  await page.getByRole('button', { name: 'Work with my notes' }).click();
  await expect(page.getByRole('dialog', { name: 'Documents' })).toBeVisible();
});
