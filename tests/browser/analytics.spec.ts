import { expect, type Page, test } from '@playwright/test';

const fake = `http://127.0.0.1:${Number(process.env.FAKE_PROVIDER_PORT) || 5299}`;

async function setup(page: Page) {
  await page.goto('/app/models');
  await page.getByRole('button', { name: 'Add Provider' }).click();
  const form = page.getByRole('form', { name: 'Add connection' });
  await form.getByLabel('Connection type').selectOption('custom');
  await form.getByLabel('Connection name').fill('Analytics fake');
  await form.getByLabel('Server address').fill(`${fake}/v1`);
  await form.getByRole('button', { name: 'Save Connection' }).click();
  await page.getByRole('article').filter({ hasText: 'fast-model' }).getByRole('button', { name: 'Select Model' }).click();
}

test('analytics uses saved runs and persists explicit feedback across reloads', async ({ page }, testInfo) => {
  await setup(page);
  const prompt = `analytics ${Date.now()}`;
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(prompt);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.np-provenance')).toHaveCount(1);
  await page.getByRole('button', { name: 'Mark message 2 helpful' }).click();
  await expect(page.getByRole('button', { name: 'Mark message 2 helpful' })).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/app/analytics');
  await expect(page).toHaveURL(/\/app\/analytics$/);
  await expect(page.locator('.np-analytics-cards article').first()).toContainText('Runs1');
  await expect(page.locator('.np-feedback-panel')).toContainText('1 Helpful');
  await expect(page.locator('.np-feedback-panel')).toContainText('0 Unhelpful');
  await expect(page.locator('.np-analytics-models')).toContainText('fast-model');
  await expect(page.getByText('Hallucination risk')).toHaveCount(0);
  await expect(page.getByText('Groundedness')).toHaveCount(0);
  await expect(page.getByText('PQS')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.np-feedback-panel')).toContainText('1 Helpful');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`analytics-${width}.png`) });
  }
});
