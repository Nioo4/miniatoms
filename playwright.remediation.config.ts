import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/remediation', workers: 1, retries: 0, timeout: 25 * 60_000,
  use: { actionTimeout: 15_000, navigationTimeout: 30_000, trace: 'off', video: 'off' },
  reporter: [['list']], outputDir: process.env.REMEDIATION_OUTPUT_DIR ?? 'artifacts/private/remediation-candidate',
});
