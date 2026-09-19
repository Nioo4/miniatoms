import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", testMatch: "preview.spec.ts", fullyParallel: false, workers: 1, timeout: 25_000,
  use: { browserName: "chromium", headless: true, screenshot: "only-on-failure", trace: "retain-on-failure" },
  reporter: [["list"], ["html", { outputFolder: "playwright-report/preview", open: "never" }]],
  outputDir: "test-results/preview",
});
