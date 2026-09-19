import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'hydration.spec.ts', workers: 1, retries: 0, timeout: 60_000,
  use: { baseURL: process.env.HYDRATION_BASE_URL ?? 'http://localhost:3000', browserName: 'chromium', headless: true,
    actionTimeout: 15_000, navigationTimeout: 30_000, trace: 'off', video: 'off', screenshot: 'only-on-failure' },
  outputDir: 'test-results/hydration', reporter: [['list']],
});
