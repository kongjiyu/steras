import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for M3 (Authority Approval) end-to-end tests.
 *
 * Runs against the deployed Firebase Hosting site so we test the
 * real Cloud Functions + Firestore + Auth, not a local dev server.
 *
 * To run a single spec:
 *   npx playwright test pdrm-decision
 *
 * To run the full M3 suite:
 *   npx playwright test --grep "@M3"
 */
export default defineConfig({
  testDir: './tests/m3',
  globalSetup: './tests/m3/global-setup.ts',
  fullyParallel: false,           // Each spec mutates shared Firestore state
  workers: 1,
  retries: 0,                     // Fail fast; we want to see real issues
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.STERAS_BASE_URL ?? 'https://linkos-496505.web.app',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: undefined },
    },
  ],
});
