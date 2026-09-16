import { expect as baseExpect, Page, test } from './fixtures';

// The fake models count as "on this machine", and those share one queue with every other test
// running in parallel, so an answer can wait its turn. A whole Deep Research run waits for six.
const expect = baseExpect.configure({ timeout: 30_000 });
const SLOW = { timeout: 60_000 };

const fake = `http://127.0.0.1:${Number(process.env.FAKE_PROVIDER_PORT) || 5299}`;
// The suffix keeps prompts unique without looking like arithmetic.
const prompt = (text: string) => `${text} [ref ${Date.now()}x${Math.random().toString(36).slice(2, 7)}]`;
const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name });

async function connectAgentModels(page: Page) {
  await page.goto('/app/models');
  await page.getByRole('button', { name: 'Add Provider' }).click();
  const form = page.getByRole('form', { name: 'Add connection' });
  await form.getByLabel('Connection type').selectOption('custom');
  await form.getByLabel('Connection name').fill('Fake agent');
  await form.getByLabel('Server address').fill(`${fake}/agent/v1`);
  await form.getByRole('button', { name: 'Save Connection' }).click();
  await expect(page.locator('h3[title="agent-model-8b"]')).toBeVisible();
}

async function chooseAgent(page: Page) {
  await nav(page, 'Chat').click();
  await page.getByRole('button', { name: 'Choose model' }).click();
  await page.getByRole('button', { name: 'Use the Free Agent' }).click();
  await expect(page.getByRole('dialog', { name: 'Choose a model' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose model' })).toContainText('Free Agent');
}

async function send(page: Page, text: string) {
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.fill(text);
  await box.press('Enter');
}

const upstream = async (page: Page, text: string) =>
  ((await (await page.request.get(`${fake}/_log?prompt=${encodeURIComponent(text)}`)).json()) as { model: string; messages: { role: string; content: string }[] }[]);

test('the Free Agent drafts with two models, has the strongest check and write the answer, and shows every step', async ({ page }) => {
  await connectAgentModels(page);
  await chooseAgent(page);
  const text = prompt('Solve 12 * 7 and show your work');
  await send(page, text);

  await expect(page.getByText('Checked final answer from agent-model-70b.')).toBeVisible();
  // The answer is credited to Nerdplexity; the Free Agent panel names every model and its role.
  await expect(page.locator('.np-provenance')).toHaveCount(0);
  const panel = page.getByLabel('Free Agent steps').last();
  await expect(panel).toContainText('Two drafts, checked and combined');
  await expect(panel).toContainText('3 requests');
  await panel.locator('summary').first().click();
  await expect(panel).toContainText('Draft 1');
  await expect(panel).toContainText('Draft 2');
  await expect(panel).toContainText('Final answer');
  await expect(panel).toContainText('3 models');
  await expect(panel.getByLabel('How the models worked together')).toContainText('Checks and writes');
  await expect(panel.locator('.np-agent-step').last()).toContainText('agent-model-70b');
  await expect(panel.locator('.np-agent-step').last()).toContainText('Fake agent');
  await expect(panel.locator('.np-agent-step').last()).toContainText('Received Draft 1 from');
  await panel.getByText('Read the draft').first().click();
  await expect(panel).toContainText('Draft from agent-model-30b.');

  const calls = await upstream(page, text);
  expect(calls.map(call => call.model).sort()).toEqual(['agent-model-30b', 'agent-model-70b', 'agent-model-8b']);
  const writer = calls.find(call => call.model === 'agent-model-70b')!;
  expect(writer.messages.some(m => m.role === 'system' && m.content.includes('Draft from agent-model-30b.'))).toBe(true);

  // Run history still names every model.
  await nav(page, 'Run history').click();
  await expect(page.locator('.np-run-row').first()).toContainText('agent-model-70b via Free Agent · 3 requests');
});

test('the Free Agent splits a message with several parts between specialists, uses two models for a greeting, and lists its specialists', async ({ page }) => {
  await connectAgentModels(page);
  await chooseAgent(page);
  const multi = prompt('What is an API? Can you also write a haiku about APIs?');
  await send(page, multi);
  await expect(page.getByText('Checked final answer from agent-model-70b.')).toBeVisible();
  const panel = page.getByLabel('Free Agent steps').last();
  await expect(panel).toContainText('Split into parts for specialists');
  await panel.locator('summary').first().click();
  await expect(panel).toContainText('Plan');
  await expect(panel).toContainText('Part 1 · general');
  await expect(panel).toContainText('Explain what an API is');
  await expect(panel).toContainText('Part 2 · writing');
  expect(await upstream(page, multi)).toHaveLength(2);

  // Even a greeting uses two models: one drafts, another checks and writes.
  const hello = prompt('Hi there');
  await send(page, hello);
  await expect(page.getByText('Checked final answer from agent-model-70b.')).toHaveCount(2);
  await expect(page.getByLabel('Free Agent steps').last()).toContainText('One draft, checked and rewritten');
  const helloCalls = await upstream(page, hello);
  expect(helloCalls).toHaveLength(2);
  expect(new Set(helloCalls.map(call => call.model)).size).toBe(2);

  await nav(page, 'Bench').click();
  const table = page.getByLabel('Specialists');
  await expect(table.getByRole('row', { name: /^Code/ })).toContainText('agent-model-70b');
  await expect(table.getByRole('row', { name: /^Writing/ })).toContainText('agent-model-30b');
});

test('agent settings choose how the Free Agent behaves and which model does each part', async ({ page }) => {
  await connectAgentModels(page);
  const settings = page.getByLabel('Agent settings');
  await expect(page.getByRole('button', { name: 'Use Free Agent' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'In use' })).toBeVisible();

  // Quick: one model answers, even a question that would get drafts.
  await settings.getByRole('radio', { name: /^Quick/ }).check();
  await chooseAgent(page);
  const quick = prompt('Solve 12 * 7 and show your work');
  await send(page, quick);
  await expect(page.getByLabel('Free Agent steps').last()).toContainText('Answered directly');
  await expect.poll(async () => (await upstream(page, quick)).length).toBe(1);

  // Back to automatic, with the smallest model writing the final answer and one draft.
  await nav(page, 'Models').click();
  await settings.getByRole('radio', { name: /^Automatic/ }).check();
  await settings.getByLabel('Drafts per answer').selectOption('1');
  await expect(settings.getByLabel('Draft 2')).toHaveCount(0);
  await settings.getByLabel('Final answer').selectOption({ label: 'agent-model-8b · Fake agent' });
  await nav(page, 'Chat').click();
  const chosen = prompt('Solve 9 * 6 and show your work');
  await send(page, chosen);
  await expect(page.getByText('Checked final answer from agent-model-8b.')).toBeVisible();
  const calls = await upstream(page, chosen);
  expect(calls).toHaveLength(2);
  expect(calls.at(-1)!.model).toBe('agent-model-8b');

  // The settings are kept, and reset returns every part to automatic.
  await nav(page, 'Models').click();
  await expect(settings.getByLabel('Final answer')).toHaveValue(/agent-model-8b/);
  await settings.getByRole('button', { name: 'Reset to automatic' }).click();
  await expect(settings.getByLabel('Final answer')).toHaveValue('');
  await expect(settings.getByLabel('Drafts per answer')).toHaveValue('2');
});

test('while it works, the panel is open and shows each model drafting and thinking, live', async ({ page }) => {
  // Deliberately slow models, behind a queue shared with every other test: allow three times the usual.
  test.slow();
  await connectAgentModels(page);
  await chooseAgent(page);
  await send(page, prompt('Solve 12 * 7 slowly and show your work'));
  // The live panel opens by itself, and the status line names the models drafting.
  const panel = page.getByLabel('Free Agent steps').last();
  const draft = panel.locator('.np-agent-step').filter({ hasText: 'Draft 1' });
  await expect(draft.locator('.np-agent-stream.thinking')).toContainText('Considering it as agent-model');
  await expect(draft.locator('.np-agent-stream').filter({ hasText: 'Writing' })).toContainText('Draft from');
  await expect(page.locator('.np-reasoning-status')).toContainText('drafting');
  // When the run ends, the drafts fold away and stay readable. Models on this machine take turns, so this takes a while.
  await expect(page.getByText('Checked final answer from agent-model-70b.')).toBeVisible(SLOW);
  const saved = page.getByLabel('Free Agent steps').last();
  await saved.locator('summary').first().click();
  await expect(saved.getByText('Show its thinking').first()).toBeVisible();
});

test('Deep research plans, searches, has several models read the sources, and writes a report citing them', async ({ page }) => {
  // A research run needs six model requests in a row through the shared queue for models on this machine.
  test.slow();
  await connectAgentModels(page);
  // Deep research needs an Exa key.
  await nav(page, 'Connections').click();
  await page.getByLabel('Exa API key').fill('exa-test-key-000001');
  await page.getByRole('button', { name: 'Save key' }).click();
  await expect(page.locator('.np-web-search')).toContainText('Key saved for this tab');
  await chooseAgent(page);
  // Type, switch Deep research on, and send at once: the message waits for the setting to be saved.
  const text = prompt('How tall is the fake tower and who built it?');
  await page.getByRole('textbox', { name: 'Message' }).fill(text);
  await page.getByRole('button', { name: 'Deep research' }).click();
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(page.getByRole('button', { name: 'Deep research' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.np-composer-footnote')).toContainText('Deep research: the Free Agent plans');
  // The report cites the sources it was given. Which model writes it is up to the ranking and health.
  await expect(page.getByText(/^Research report from agent-model-\d+b: the tower is 300 metres tall \[1\], and it was built by a company \[2\]\.$/)).toBeVisible(SLOW);
  // The sources the report cites, numbered in order.
  await expect(page.getByRole('link', { name: /example\.com/ })).toHaveCount(2);

  const panel = page.getByLabel('Free Agent steps').last();
  await expect(panel).toContainText('Deep research');
  await panel.locator('summary').first().click();
  const flow = panel.getByLabel('How the models worked together');
  await expect(flow).toContainText('2 searches');
  await expect(flow).toContainText('Read 2 sources');
  await expect(flow).toContainText('Writes the report');
  // Each reader kept its true quote and dropped the invented one.
  await expect(panel.locator('.np-agent-step').filter({ hasText: 'Source 1' })).toContainText('Kept 1 note; dropped 1 whose quote is not on the page');
  await expect(panel.locator('.np-agent-step').filter({ hasText: 'Citation check' })).toContainText('2 citations to 2 of 2 sources; each names a source with checked notes');

  // Only checked quotes reached the writer.
  const calls = await upstream(page, text);
  const writer = calls.find(call => call.messages.some(m => m.role === 'system' && m.content.includes('You write a research report')))!;
  const note = writer.messages.find(m => m.role === 'system' && m.content.includes('You write a research report'))!.content;
  expect(note).toContain('The tower is 300 metres tall');
  expect(note).not.toContain('This sentence is not on the page at all.');
});
