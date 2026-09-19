import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:'./tests/e2e',testMatch:'workbench.spec.ts',fullyParallel:false,workers:1,
  timeout:150000,expect:{timeout:30000},retries:0,
  outputDir:'test-results/workbench',
  use:{baseURL:'http://localhost:3001',browserName:'chromium',headless:true,viewport:{width:1440,height:1000},
    screenshot:'only-on-failure',trace:'off',video:'off'},
  // No traces: they can contain the local Supabase bearer/session credentials.
  reporter:[['list'],['html',{open:'never',outputFolder:'playwright-report/workbench'}]],
});
