import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser', fullyParallel: false, workers: 1, timeout: 30000,
  reporter: 'list', use: { browserName: 'chromium', headless: true, viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure' }
});
