import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';
export type { Page } from '@playwright/test';

/**
 * Each test (and each retry) acts as its own user on the shared test server, so tests running
 * side by side never see each other's threads. The server honors this header only when started
 * with NERDPLEXITY_TEST_USERS=1, which playwright.config.ts sets and hosted servers ignore.
 */
export const test = base.extend({
  extraHTTPHeaders: async ({}, use, testInfo) => {
    await use({ 'X-Nerdplexity-Test-User': `${testInfo.testId}-${testInfo.retry}-${testInfo.repeatEachIndex}` });
  },
});
