import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/live", workers: 1, retries: 0, timeout: 300_000,
  use: { baseURL: process.env.LIVE_BASE_URL, browserName: "chromium", headless: true, viewport: { width: 1440, height: 1000 },
    trace: "off", video: "off", screenshot: "only-on-failure" },
  reporter: [["list"], ["html", { outputFolder: "playwright-report/live", open: "never" }]],
  outputDir: "test-results/live",
});

