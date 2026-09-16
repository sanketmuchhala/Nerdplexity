import { expect, test } from './fixtures';

const fake = `http://127.0.0.1:${Number(process.env.FAKE_PROVIDER_PORT) || 5299}`;

test('Bench grades free models, keeps the results, and clears them', async ({ page }) => {
  // The real backend and Bench runner, against a local fake model that answers every question with a greeting.
  await page.goto('/app/models');
  await page.getByRole('button', { name: 'Add Provider' }).click();
  const form = page.getByRole('form', { name: 'Add connection' });
  await form.getByLabel('Connection type').selectOption('custom');
  await form.getByLabel('Connection name').fill('Fake router');
  await form.getByLabel('Server address').fill(`${fake}/router/v1`);
  await form.getByRole('button', { name: 'Save Connection' }).click();
  await expect(page.locator('h3[title="fast-model-8b"]')).toBeVisible();

  await page.getByRole('navigation', { name: 'Lab navigation' }).getByRole('button', { name: 'Bench' }).click();
  const setup = page.getByLabel('Bench setup');
  await expect(setup.getByText('openai/gsm8k')).toBeVisible();
  await setup.getByLabel(/fast-model-8b/).check();
  for (const category of ['Code', 'Instructions', 'Tools', 'Facts']) await setup.getByLabel(new RegExp(`^${category}`)).uncheck();
  await setup.getByLabel('Questions per category').selectOption('1');
  await expect(setup.getByRole('status')).toContainText('1 request: 1 per model.');
  await setup.getByRole('button', { name: 'Run Bench' }).click();

  const progress = page.getByLabel('Bench progress');
  await expect(progress).toContainText('1 of 1');
  await expect(progress).toContainText('Finished.');
  const results = page.getByLabel('Bench results');
  const row = results.getByRole('row', { name: /fast-model-8b/ });
  await expect(row).toContainText('0/1');
  await results.getByText("This run's answers (1)").click();
  await expect(results).toContainText('gsm8k:');
  await expect(results).toContainText('failed: expected');

  // Results are saved on the server.
  await page.reload();
  await expect(page.getByLabel('Bench results').getByRole('row', { name: /fast-model-8b/ })).toContainText('0/1');
  await page.getByRole('button', { name: 'Clear results' }).click();
  await expect(page.getByLabel('Bench results')).toContainText('No results yet.');
});
