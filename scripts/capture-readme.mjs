// Captures the README screenshots with scripted demo data: model catalogs and run events are
// served by Playwright routes, so no keys, local models, or network access are needed.
// With the dev servers running: node scripts/capture-readme.mjs  (WEB_PORT selects the app port)
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const web = `http://127.0.0.1:${Number(process.env.WEB_PORT) || 5173}`;
const output = 'docs/screenshots/readme';
const model = (id, displayName, extra = {}) => ({ id, displayName, source: 'discovered', capabilities: { tools: true, vision: false }, ...extra });

const catalogs = {
  ollama: { execution: 'local', models: [
    model('qwen3:8b', 'qwen3:8b', { pricing: 'local', contextLength: 40_960, sizeBytes: 5_225_000_000, details: 'Q4_K_M · 8.2B', loaded: true }),
    model('gemma3:12b', 'gemma3:12b', { pricing: 'local', contextLength: 131_072, sizeBytes: 8_149_000_000, details: 'Q4_K_M · 12.2B', capabilities: { tools: false, vision: true } }),
    model('llama3.2:3b', 'llama3.2:3b', { pricing: 'local', contextLength: 131_072, sizeBytes: 2_019_000_000, details: 'Q4_K_M · 3.2B' }),
  ] },
  openrouter: { execution: 'remote', models: [
    model('anthropic/claude-sonnet-4.5', 'Anthropic: Claude Sonnet 4.5', { pricing: 'paid', price: { input: 3, output: 15 }, contextLength: 1_000_000, capabilities: { tools: true, vision: true } }),
    model('google/gemini-2.5-flash', 'Google: Gemini 2.5 Flash', { pricing: 'paid', price: { input: 0.3, output: 2.5 }, contextLength: 1_048_576, capabilities: { tools: true, vision: true } }),
    model('openai/gpt-5-mini', 'OpenAI: GPT-5 Mini', { pricing: 'paid', price: { input: 0.25, output: 2 }, contextLength: 400_000, capabilities: { tools: true, vision: true } }),
    model('nvidia/nemotron-3-super-120b-a12b:free', 'NVIDIA: Nemotron 3 Super (free)', { pricing: 'zero-price', contextLength: 262_144 }),
    model('deepseek/deepseek-chat-v3.1:free', 'DeepSeek: DeepSeek V3.1 (free)', { pricing: 'zero-price', contextLength: 163_840 }),
    model('mistralai/mistral-small-3.2-24b-instruct', 'Mistral: Mistral Small 3.2 24B', { pricing: 'paid', price: { input: 0.1, output: 0.3 }, contextLength: 131_072 }),
  ] },
};

const timing = { queuedMs: 0, ttftMs: 420, durationMs: 1_650 };
const trace = { id: 'call_1', name: 'calculator', step: 1, source: 'computed', input: { expression: '48127 * 3919 - 2^17' } };
const runEvents = [
  { type: 'queued', position: 0 }, { type: 'started' },
  { type: 'tool', ...trace, output: null, status: 'running' },
  { type: 'tool', ...trace, output: { expression: '48127 * 3919 - 2^17', result: 188478641 }, status: 'completed', durationMs: 1 },
  { type: 'status', message: 'Tools · step 2 of 6' },
  { type: 'delta', text: '**48127 × 3919 − 2¹⁷ = 188,478,641**\n\n' },
  { type: 'delta', text: 'The calculator worked it out in two parts:\n\n- 48127 × 3919 = 188,609,713\n- 2¹⁷ = 131,072\n\nSubtracting gives 188,478,641.' },
  { type: 'completed', usage: { prompt_tokens: 212, completion_tokens: 64, total_tokens: 276 }, finishReason: 'stop', timing },
];

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const page = await context.newPage();
  await page.route('**/v1/models/discover', async route => {
    const { target } = route.request().postDataJSON();
    const catalog = catalogs[target.kind];
    await route.fulfill({ json: catalog ? { ok: true, checkedAt: Date.now(), ...catalog } : { ok: false, checkedAt: Date.now(), error: { category: 'offline', message: 'Nothing is answering at this address. Start the runtime, then refresh.' } } });
  });
  await page.route('**/v1/runs', route => route.fulfill({ status: 201, json: { runId: 'demo-run', existing: false } }));
  await page.route('**/v1/runs/*/events**', route => route.fulfill({
    contentType: 'application/x-ndjson',
    body: runEvents.map((event, i) => JSON.stringify({ v: 1, runId: 'demo-run', seq: i + 1, ts: Date.now(), event })).join('\n') + '\n',
  }));

  await page.goto(`${web}/app/models`);
  await page.getByRole('button', { name: 'Add Provider' }).click();
  const form = page.getByRole('form', { name: 'Add connection' });
  await form.getByLabel('Connection type').selectOption('openrouter');
  await form.getByLabel('API key').fill('sk-or-demo-key');
  await form.getByRole('button', { name: 'Save Connection' }).click();
  await page.locator('h3[title="anthropic/claude-sonnet-4.5"]').waitFor();
  await page.locator('.np-model-title').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector('.np-model-title')?.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${output}/models.png` });

  await page.getByRole('article').filter({ has: page.locator('h3[title="qwen3:8b"]') }).getByRole('button', { name: 'Select Model' }).click();
  await page.getByRole('button', { name: 'Calculator tool' }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('What is 48127 × 3919 − 2^17? Use the calculator.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByText('Subtracting gives 188,478,641.').waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${output}/chat.png` });

  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${output}/chat-light.png` });

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${output}/chat-phone.png` });
  await context.close();
  console.log(`Saved screenshots to ${output}/`);
} finally {
  await browser.close();
}
