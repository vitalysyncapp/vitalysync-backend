import { defineConfig } from '@playwright/test';

// This suite starts its own API against a newly created disposable database.
// It deliberately does not use the general config's existing server/database.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'check-in.spec.js',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  outputDir: './test-results/check-in',
  use: {
    browserName: 'chromium',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    viewport: { width: 430, height: 932 },
    timezoneId: 'Asia/Manila',
    screenshot: 'only-on-failure',
  },
});
