import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'docs/screenshots/baseline';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const observations = [];
try {
  for (const [label, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    // Avoid external fonts and inference during reproducible UI capture.
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
    });
    for (const [name, path] of [['landing', '/'], ['chat', '/app'], ['dashboard', '/app/analytics/dashboard'], ['events', '/app/analytics/events']]) {
      await page.goto(`http://127.0.0.1:5173${path}`);
      await page.locator('#root').waitFor();
      await page.waitForFunction(() => !document.body.innerText.includes('Loading…'));
      await page.screenshot({ path: `${output}/${name}-${label}.png`, fullPage: true });
      observations.push({ name, viewport: label, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) });
    }
    await page.evaluate(async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('ChatDatabase');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise((resolve, reject) => {
          const tx = database.transaction('events', 'readwrite');
          for (let i = 0; i < 6; i++) {
            tx.objectStore('events').put({
              id: `baseline-${i}`, corr_id: `baseline-${i}`,
              ts: new Date(Date.now() - i * 60_000).toISOString(),
              provider: 'local-ollama', model: 'baseline-model',
              usage: { prompt_tokens: 80, completion_tokens: 120, total_tokens: 200 },
              timing: { ttft_ms: 200 + i * 20, latency_ms: 1200 + i * 100 },
              result: { status: i === 0 ? 'error' : 'ok' },
            });
          }
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        database.close();
      }
    });
    for (const name of ['dashboard', 'events']) {
      await page.goto(`http://127.0.0.1:5173/app/analytics/${name}`);
      await page.getByRole('heading', { level: 1 }).waitFor();
      await page.screenshot({ path: `${output}/${name}-populated-${label}.png`, fullPage: true });
    }
    await page.route('**/v1/metrics', route => route.fulfill({ status: 503, json: { error: 'Synthetic baseline outage' } }));
    await page.goto('http://127.0.0.1:5173/app/analytics/dashboard');
    await page.getByRole('heading', { level: 1 }).waitFor();
    await page.screenshot({ path: `${output}/metrics-unavailable-${label}.png`, fullPage: true });
    await context.close();
  }
  await writeFile(`${output}/observations.json`, `${JSON.stringify(observations, null, 2)}\n`);
} finally {
  await browser.close();
}
