/**
 * M3 Stage-1 Control verification UI smoke test (Q1 refactor).
 *
 * Renders the AuthorityEventReview page against the deployed app and
 * verifies the new "Stage-1 control verification" card lists each
 * Stage 1 document, and the per-doc form can be filled in.
 */
import { test, expect, EVENTS } from './fixtures';
import { restoreControlVerificationFixture } from './admin-reset';

test.describe('@M3 control verification UI', () => {
  test.beforeAll(async () => {
    await restoreControlVerificationFixture();
  });

  test('PDRM sees the per-doc verification form on evt-control-verification', async ({ page, loginAs }) => {
    await loginAs('pdrm');
    await page.goto(`/authority/events/${EVENTS.controlVerification}`, { waitUntil: 'domcontentloaded' });
    const heading = page.getByRole('heading', { name: /stage-1 control verification/i });
    await expect(heading).toBeVisible({ timeout: 15_000 });
    // At least one Verify/Reject button (per stage1 doc) should be visible
    const verifyBtn = page.getByRole('button', { name: /^verify$/i }).first();
    await expect(verifyBtn).toBeVisible();
    const rejectBtn = page.getByRole('button', { name: /^reject$/i }).first();
    await expect(rejectBtn).toBeVisible();
  });

  test('BOMBA can verify a declared Stage 1 document through the UI', async ({ page, api, loginAs }) => {
    // Sign in first so the api helper has auth context.
    await loginAs('bomba');
    // Clear any prior verifications on the BOMBA control so we can re-verify.
    const evtId = EVENTS.controlVerification;
    const ctrlId = `${evtId}-ctrl-bomba-v1`;
    const docs = await api.getCollection<{ docId: string; status: string }>(`events/${evtId}/event_controls/${ctrlId}/stage1_docs`);
    for (const d of docs) {
      if (d.status === 'verified' || d.status === 'rejected') {
        await api.setDoc(`events/${evtId}/event_controls/${ctrlId}/stage1_docs/${d.docId}`, { status: 'pending_verification', verifiedBy: null, verifiedAt: null, rejectionReason: '' }).catch(() => undefined);
      }
    }
    await page.goto(`/authority/events/${evtId}`, { waitUntil: 'domcontentloaded' });
    const heading = page.getByRole('heading', { name: /stage-1 control verification/i });
    await expect(heading).toBeVisible({ timeout: 15_000 });
    // Fill the FIRST per-doc rationale (BOMBA's first Stage 1 doc) and click Verify
    const firstTextarea = page.locator('textarea[placeholder*="basis for your verification"]').first();
    await firstTextarea.fill('Bomba E2E UI — egress plan and extinguisher placement confirmed on inspection.');
    const firstVerifyBtn = page.getByRole('button', { name: /^verify$/i }).first();
    await firstVerifyBtn.click();
    // Wait for the doc's status to flip to 'verified' via the live snapshot.
    await expect.poll(async () => {
      const d = await api.getDoc<{ status: string }>(`events/${evtId}/event_controls/${ctrlId}/stage1_docs/${docs[0].docId}`);
      return d?.status ?? null;
    }, { timeout: 15_000 }).toBe('verified');
  });
});
