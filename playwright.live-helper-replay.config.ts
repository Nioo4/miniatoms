import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'live-helper-replay.spec.ts', workers: 1, timeout: 30_000,
  use: { browserName: 'chromium', headless: true, actionTimeout: 10_000, trace: 'off', screenshot: 'only-on-failure' },
  outputDir: 'test-results/live-helper-replay', reporter: [['list']],
});
