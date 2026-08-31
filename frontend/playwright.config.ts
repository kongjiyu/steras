import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for M3 (Authority Approval) end-to-end tests.
 *
 * Runs against the deployed Firebase Hosting site so we test the
 * real Cloud Functions + Firestore + Auth, not a local dev server.
 *
 * Three projects (all share the same Firebase deployment):
 *
 *   m3-smoke  — 12 critical specs that prove the M3 contract:
 *               - pdrm-decision (happy path)
 *               - m3-negative-gates (compliance + readiness gates)
 *               - m3-aggregate (rejection / invalid legacy decision / unanimous)
 *               - m3-controls-notifications (verified control +
 *                 organiser notification)
 *               ~2-3 min. Default for developer feedback. Fastest path
 *               to "is M3 still working?".
 *
 *   m3-full   — 14 specs = smoke + control-verification-ui. The two new
 *               control-verification UI specs cover the Stage-1 form
 *               (verify + reject buttons) and complete in ~4 min.
 *               Excludes the Workstream 1 officer-assignment specs
 *               which occasionally flake on Firebase Hosting cold-start
 *               when run after many other tests.
 *
 *   m3-workstream1 — 5 specs covering the officer assignment + second
 *               review flow, the unassign / backup-officer swap, and
 *               the FR-M3-16 "confirmed review" gate. Designed to run
 *               in its own clean process (separate Playwright
 *               invocation) so the cumulative Firebase Auth slowness
 *               from the other suites doesn't trip the 30s loginAs
 *               timeout. Runs in ~2 min.
 *
 * retries: 1 recovers from one-off cold-start blips.
 *
 * To run a single spec:
 *   npx playwright test pdrm-decision
 *
 * To run the full M3 suite (smoke only by default; opt in to the rest):
 *   npx playwright test --project=m3-smoke
 *   npx playwright test --project=m3-full
 *   npx playwright test --project=m3-workstream1
 *
 * To run everything (CI):
 *   npx playwright test --project=m3-smoke && \
 *   npx playwright test --project=m3-full && \
 *   npx playwright test --project=m3-workstream1
 */
export default defineConfig({
  testDir: './tests/m3',
  globalSetup: './tests/m3/global-setup.ts',
  fullyParallel: false,           // Each spec mutates shared Firestore state
  workers: 1,
  retries: 1,                     // Recover from Firebase cold-start flakes
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    // The M3 suite mutates Firestore through globalSetup. Requiring an
    // explicit target prevents an accidental run against the production/demo
    // hosting site from a developer shell.
    baseURL: process.env.STERAS_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'm3-smoke',
      testMatch: [
        'admin-manual-review.spec.ts',
        'pdrm-decision.spec.ts',
        'm3-negative-gates.spec.ts',
        'm3-aggregate.spec.ts',
        'm3-controls-notifications.spec.ts',
        'organizer-event-controls.spec.ts',
      ],
      use: { ...devices['Desktop Chrome'], channel: undefined },
    },
    {
      name: 'm3-full',
      // smoke + control-verification-ui + generate-control-list +
      // organizer-stage1-upload + Workstream 4 (organizer Stage 2 +
      // public confirm/report) + Workstream 5 (admin publish gate).
      // Excludes officer-assignment (its 5-6 sequential Firebase Auth
      // logins flake when run immediately after the other 12 specs).
      testMatch: [
        'admin-manual-review.spec.ts',
        'pdrm-decision.spec.ts',
        'm3-negative-gates.spec.ts',
        'm3-aggregate.spec.ts',
        'm3-controls-notifications.spec.ts',
        'control-verification-ui.spec.ts',
        'generate-control-list.spec.ts',
        'organizer-stage1-upload.spec.ts',
        'stage2-organizer-upload.spec.ts',
        'stage2-public-confirm-report.spec.ts',
        'stage2-admin-publish.spec.ts',
      ],
      use: { ...devices['Desktop Chrome'], channel: undefined },
    },
    {
      name: 'm3-workstream1',
      // Run in its own clean process so Firebase Auth isn't hot from
      // a prior 12+ spec run.
      testMatch: [
        'officer-assignment.spec.ts',
        'unassign-officer.spec.ts',
      ],
      use: { ...devices['Desktop Chrome'], channel: undefined },
    },
  ],
});
