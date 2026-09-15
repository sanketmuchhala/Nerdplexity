import { expect, Page, test } from './fixtures';

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
  await expect(page.locator('.np-provenance')).toHaveText('agent-model-70b · Fake agent · via Free Agent');
  const panel = page.getByLabel('Free Agent steps').last();
  await expect(panel).toContainText('Two drafts, checked and combined');
  await expect(panel).toContainText('3 requests');
  await panel.locator('summary').first().click();
  await expect(panel).toContainText('Draft 1');
  await expect(panel).toContainText('Draft 2');
  await expect(panel).toContainText('Final answer');
  await panel.getByText('Read the draft').first().click();
  await expect(panel).toContainText('Draft from agent-model-30b.');

  const calls = await upstream(page, text);
  expect(calls.map(call => call.model).sort()).toEqual(['agent-model-30b', 'agent-model-70b', 'agent-model-8b']);
  const writer = calls.find(call => call.model === 'agent-model-70b')!;
  expect(writer.messages.some(m => m.role === 'system' && m.content.includes('Draft from agent-model-30b.'))).toBe(true);

  await nav(page, 'Run history').click();
  await expect(page.locator('.np-run-row').first()).toContainText('agent-model-70b via Free Agent · 3 requests');
});

test('the Free Agent splits a message with several parts between specialists, answers greetings directly, and lists its specialists', async ({ page }) => {
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

  const hello = prompt('Hi there');
  await send(page, hello);
  await expect(page.locator('.np-provenance')).toHaveCount(2);
  await expect(page.getByLabel('Free Agent steps').last()).toContainText('Answered directly');
  expect(await upstream(page, hello)).toHaveLength(1);

  await nav(page, 'Bench').click();
  const table = page.getByLabel('Specialists');
  await expect(table.getByRole('row', { name: /^Code/ })).toContainText('agent-model-70b');
  await expect(table.getByRole('row', { name: /^Writing/ })).toContainText('agent-model-30b');
});
