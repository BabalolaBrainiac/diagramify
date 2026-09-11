import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './browser-tests',
  workers: 1,
  use: { channel: process.env.DIAGRAMIFY_BROWSER_CHANNEL || undefined, headless: true, viewport: { width: 1440, height: 1000 } },
  reporter: 'list',
});
