import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({ ...base, testMatch: "client-lifecycle.spec.ts", outputDir: "test-results/client-lifecycle", reporter: [["list"]] });
