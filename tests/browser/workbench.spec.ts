import { expect, type Page, test } from '@playwright/test';
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
  await page.getByRole('button', { name: 'Add connection' }).click();
  const form = page.getByRole('form', { name: 'Add connection' });
  await form.getByLabel('Connection type').selectOption('custom');
  await form.getByLabel('Connection name').fill('Workbench fake');
  await form.getByLabel('Server address').fill(`${fake}/v1`);
  await form.getByRole('button', { name: 'Add and check' }).click();
  await page
    .getByRole('article')
    .filter({ hasText: model })
    .getByRole('button', { name: 'Use model' })
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
    'user',
    'assistant',
    'user',
  ]);
  expect(log[0].messages[0].content).toBe(first);
});

test('presets survive reload and retries retain the original input/settings snapshot', async ({
  page,
}) => {
  await setup(page, 'limit-model');
  await page.getByRole('button', { name: 'Generation settings' }).click();
  await page.getByLabel('System instruction').fill('Original instruction');
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
  expect(requests[1].messages[0].content).toBe('Original instruction');
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
  await expect(page.locator('.np-thread-heading')).toContainText(
    'Branch · original retained',
  );
  await expect
    .poll(async () => (await upstream(page, original)).length)
    .toBe(2);
  await expect(page.locator('.np-history-row')).toHaveCount(3);
});

test('context limits require deliberate trimming, and export/import preserves text without routing', async ({
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
  await expect(page.locator('.np-thread-heading')).toContainText(
    'Long imported thread',
  );
  await expect(
    page.getByRole('button', { name: 'Choose model', exact: true }),
  ).toContainText('Choose a model');
  await choose(page, 'fast-model');
  await page.getByRole('button', { name: 'Generation settings' }).click();
  await page.getByLabel('Maximum output tokens').fill('100');
  await page.getByLabel('Context budget', { exact: true }).fill('1024');
  await page.getByRole('button', { name: 'Apply to this thread' }).click();
  const text = unique('trim');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await expect(
    page.getByRole('button', { name: 'Send message' }),
  ).toBeDisabled();
  expect(await upstream(page, text)).toHaveLength(0);
  await page.getByRole('button', { name: 'Review context' }).click();
  await page.getByLabel('Conversation history').selectOption('recent');
  await page.getByLabel('Previous turns to include').fill('1');
  await expect(
    page.getByText(
      '2 earlier messages omitted from this request. The full transcript is retained.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Apply to this thread' }).click();
  await send(page, text, 1);
  const requests = await upstream(page, text);
  expect(
    requests[0].messages.map((m: { content: string }) => m.content),
  ).toEqual(['Recent question', 'Recent answer', text]);
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
