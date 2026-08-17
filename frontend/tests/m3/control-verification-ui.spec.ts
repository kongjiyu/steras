/**
 * M3 Stage-1 Control verification UI smoke test.
 *
 * Renders the AuthorityEventReview page against the deployed app and
 * verifies the new "Stage-1 control verification" card is visible,
 * shows the declared control, and the form can be filled in.
 */
import { test, expect, EVENTS } from './fixtures';

test.describe('@M3 control verification UI', () => {
  test('PDRM sees the control verification form on evt-control-verification', async ({ page, api, loginAs }) => {
    await loginAs('pdrm');
    await page.goto(`/authority/events/evt-control-verification`, { waitUntil: 'domcontentloaded' });
    // Wait for the section to render
    const heading = page.getByRole('heading', { name: /stage-1 control verification/i });
    await expect(heading).toBeVisible({ timeout: 15_000 });
    // At least one declared control should be visible with a Verify/Reject button
    const verifyBtn = page.getByRole('button', { name: /^verify$/i }).first();
    await expect(verifyBtn).toBeVisible();
    const rejectBtn = page.getByRole('button', { name: /^reject$/i }).first();
    await expect(rejectBtn).toBeVisible();
  });

  test('BOMBA can verify a declared control through the UI', async ({ page, api, loginAs }) => {
    // Sign in first so the api helper has auth context for reads/writes.
    await loginAs('bomba');
    // Reset to clear any prior verifications (evt-control-verification is set up
    // with 4 declared controls; the global-setup reruns on each spec run).
    const verifs = await api.getCollection<{ verificationId: string }>('events/evt-control-verification/control_verifications');
    for (const v of verifs) {
      await api.deleteDoc(`events/evt-control-verification/control_verifications/${v.verificationId}`).catch(() => undefined);
    }
    await page.goto(`/authority/events/evt-control-verification`, { waitUntil: 'domcontentloaded' });
    const heading = page.getByRole('heading', { name: /stage-1 control verification/i });
    await expect(heading).toBeVisible({ timeout: 15_000 });
    // Fill the FIRST control's rationale and click Verify
    const firstTextarea = page.locator('textarea[placeholder*="basis for your verification"]').first();
    await firstTextarea.fill('Bomba E2E UI — egress plan and extinguisher placement confirmed on inspection.');
    const firstVerifyBtn = page.getByRole('button', { name: /^verify$/i }).first();
    await firstVerifyBtn.click();
    // Wait for the success toast or the verification to land
    await expect.poll(async () => {
      const items = await api.getCollection<{ controlId: string; status: string }>('events/evt-control-verification/control_verifications');
      return items.find((item) => item.controlId === 'evt-control-verification-ctrl-1')?.status ?? null;
    }, { timeout: 15_000 }).toBe('verified');
  });
});
