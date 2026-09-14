import { expect, Page, test } from './fixtures';

// These tests use the real backend and run engine against tests/fixtures/fake-provider.mjs.
const fake = `http://127.0.0.1:${Number(process.env.FAKE_PROVIDER_PORT) || 5299}`;

async function useFakeModel(page: Page, model: string) {
  await page.goto('/app/models');
  await page.getByRole('button', { name: 'Add Provider' }).click();
  const form = page.getByRole('form', { name: 'Add connection' });
  await form.getByLabel('Connection type').selectOption('custom');
  await form.getByLabel('Connection name').fill('Fake');
  await form.getByLabel('Server address').fill(`${fake}/v1`);
  await form.getByRole('button', { name: 'Save Connection' }).click();
  await page
    .getByRole('article')
    .filter({ hasText: model })
    .getByRole('button', { name: 'Select Model' })
    .click();
  await expect(page).toHaveURL(/\/app$/);
}

async function send(page: Page, prompt: string) {
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.fill(prompt);
  await box.press('Enter');
}

const upstream = async (page: Page, prompt: string) =>
  (
    await page.request.get(`${fake}/_log?prompt=${encodeURIComponent(prompt)}`)
  ).json();
const answers = (page: Page) => page.locator('.np-provenance');
/** The run history record the app saved on the server for this prompt. */
const savedRun = async (page: Page, text: string) =>
  ((await (await page.request.get('/v1/run-records')).json()) as { prompt: string; output: string; runId?: string }[])
    .find((run) => run.prompt === text);
const prompt = (name: string) =>
  `${name} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test('an answer streams into view before the run completes', async ({
  page,
}) => {
  await useFakeModel(page, 'slow-model');
  await send(page, prompt('stream'));
  await expect(page.getByText('token-2', { exact: false })).toBeVisible();
  // Still running: the stop control is shown and the final token has not arrived.
  await expect(
    page.getByRole('button', { name: 'Stop generation' }),
  ).toBeVisible();
  await expect(page.getByText('token-29')).toHaveCount(0);
  await expect(page.getByText('token-29', { exact: false })).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page.getByRole('button', { name: 'Send message' }),
  ).toBeVisible();
  await expect(answers(page)).toHaveCount(1);
  await expect(answers(page)).toHaveText('slow-model · Fake');
});

test('multi-byte text split across network chunks arrives intact', async ({
  page,
}) => {
  await useFakeModel(page, 'fast-model');
  await send(page, prompt('unicode'));
  await expect(
    page.getByText('Hello from fast-model: café, naïve, \u{1F642}.'),
  ).toBeVisible();
});

test('Stop cancels the upstream request and keeps a labeled partial answer', async ({
  page,
}) => {
  const text = prompt('stop');
  await useFakeModel(page, 'slow-model');
  await send(page, text);
  await expect(page.getByText('token-2', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Stop generation' }).click();
  await expect(answers(page)).toHaveText(
    'slow-model · Fake · Stopped · partial answer',
  );
  await expect(page.locator('.np-thread')).toContainText(
    'token-0 token-1 token-2',
  );
  await expect
    .poll(async () => (await upstream(page, text))[0]?.aborted)
    .toBe(true);
  await page.waitForTimeout(800);
  await expect(page.getByText('token-29', { exact: false })).toHaveCount(0);
});

test('reloading mid-run reattaches without duplicating messages or requests', async ({
  page,
}) => {
  const text = prompt('reload');
  await useFakeModel(page, 'slow-model');
  await send(page, text);
  await expect(page.getByText('token-3', { exact: false })).toBeVisible();
  await page.reload();
  await page
    .getByRole('button', { name: new RegExp(text) })
    .first()
    .click();
  await expect(page.getByText('token-29', { exact: false })).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page.locator('.np-thread').getByText(text, { exact: true }),
  ).toHaveCount(1);
  await expect(answers(page)).toHaveCount(1);
  // Every token appears exactly once in the final answer.
  const answer = await page.locator('.np-thread').innerText();
  for (let i = 0; i < 30; i++)
    expect(answer.match(new RegExp(`token-${i}(?!\\d)`, 'g'))).toHaveLength(1);
  expect(await upstream(page, text)).toHaveLength(1);
});

test('a run the server no longer has is marked interrupted, keeping the saved partial answer', async ({
  page,
}) => {
  const text = prompt('restart');
  await useFakeModel(page, 'restart-model');
  await send(page, text);
  await expect(page.getByText('token-2', { exact: false })).toBeVisible();
  // Wait for the periodic save itself, rather than tying the test to stream speed.
  await expect
    .poll(() =>
      savedRun(page, text).then((run) => run?.output.includes('token-0')),
    )
    .toBe(true);
  // Simulate a backend restart: the run is unknown after the reload.
  await page.route('**/v1/runs/*/events**', (route) =>
    route.fulfill({
      status: 404,
      json: {
        error: 'This run is no longer available on the server.',
        code: 'unknown-run',
      },
    }),
  );
  await page.reload();
  await page
    .getByRole('button', { name: new RegExp(text) })
    .first()
    .click();
  await expect(answers(page)).toHaveText(
    'restart-model · Fake · Interrupted · partial answer',
  );
  await expect(page.locator('.np-thread')).toContainText('token-0');
  await expect(page.getByRole('alert')).toContainText('no longer available');
  // Nothing was resent automatically.
  expect(await upstream(page, text)).toHaveLength(1);
  // The browser route simulated a lost backend; stop the real fixture run left behind it.
  const serverRunId = (await savedRun(page, text))?.runId;
  if (serverRunId) await page.request.post(`/v1/runs/${serverRunId}/cancel`);
});

test('a rate limit shows retry guidance, and Retry does not repeat the user message', async ({
  page,
}) => {
  const text = prompt('limit');
  await useFakeModel(page, 'limit-model');
  await send(page, text);
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('rate limiting');
  await expect(alert).toContainText('Try again in 30s.');
  await expect(answers(page)).toHaveCount(0);
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(async () => (await upstream(page, text)).length).toBe(2);
  await expect(page.getByRole('alert')).toContainText('Try again in 30s.');
  await expect(
    page.locator('.np-thread').getByText(text, { exact: true }),
  ).toHaveCount(1);
  await page.goto('/app/runs');
  await expect(
    page
      .locator('.np-run-list')
      .getByRole('button', { name: new RegExp(text) }),
  ).toHaveCount(2);
});

test('a short rate limit is waited out visibly and then answered', async ({
  page,
}) => {
  const text = prompt('busy');
  await useFakeModel(page, 'busy-model');
  await send(page, text);
  await expect(page.getByRole('status')).toContainText(
    'Retrying in 1s (1 of 2)',
  );
  await expect(page.getByText('Answered after waiting.')).toBeVisible();
  expect(await upstream(page, text)).toHaveLength(2);
  // Quota headers from the provider appear on the connection.
  await page.goto('/app/models');
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Fake' }),
  ).toContainText('998 of 1,000 requests left');
});

test('a dropped stream keeps the partial answer marked as incomplete', async ({
  page,
}) => {
  await useFakeModel(page, 'broken-model');
  await send(page, prompt('broken'));
  await expect(page.getByText('partial-a partial-b')).toBeVisible();
  await expect(answers(page)).toHaveText(
    'broken-model · Fake · Failed · partial answer',
  );
  await expect(page.getByRole('alert')).toContainText(
    'ended before the model finished',
  );
});

test('reasoning reported by the model is shown separately from the answer', async ({
  page,
}) => {
  await useFakeModel(page, 'reasoning-model');
  await send(page, prompt('reasoning'));
  // Reasoning stays folded while it streams; opening it shows the live text.
  const live = page.getByRole('region', { name: 'Thinking live' });
  await expect(live).toBeVisible();
  // The drawer heading reads "Thinking..." plus the current status, so it has no fixed name.
  const liveToggle = live.getByRole('button', { name: /Thinking/ });
  await expect(liveToggle).toHaveAttribute('aria-expanded', 'false');
  // The streaming bubble animates, so the toggle never holds still long enough for a normal click.
  await liveToggle.click({ force: true });
  await expect(live).toContainText('Analysis');
  await expect(page.getByText('Reasoned answer.')).toHaveCount(0);
  await expect(page.getByText('Reasoned answer.')).toBeVisible();
  // A finished thought process starts collapsed (reasoning is optional to read) and opens on request.
  const complete = page.getByRole('region', { name: 'Thought process' });
  const toggle = complete.getByRole('button', { name: /Thought process/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(complete.locator('.np-reasoning-body')).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(complete).toContainText('Considering the question.');
  await expect(complete).toContainText('Checking the conclusion.');
  await expect(complete.locator('.np-reasoning-body')).toHaveCSS('max-height', 'none');
  expect(await complete.evaluate(node => {
    const answer = node.parentElement?.querySelector('.np-answer-content');
    return !!answer && Boolean(node.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);

  await complete.getByRole('button', { name: /Thought process/ }).click();
  await expect(complete.locator('.np-reasoning-body')).toHaveCount(0);
  await complete.getByRole('button', { name: /Thought process/ }).click();
  await expect(complete).toContainText('Checking the conclusion.');
});
