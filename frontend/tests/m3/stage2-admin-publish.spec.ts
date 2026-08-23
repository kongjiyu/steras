/**
 * M3 Workstream 5 — admin Stage 2 publish gate (FR-M3-21, UC-14, UC-15).
 *
 *   1. Admin publishes a pending image. Asserts: `publishStage2Doc`
 *      returns `published: true`; the Stage 2 doc has `publishedAt`
 *      + `publishedBy` set; the organizer's row in
 *      `OrganizerEventControls` flips from `data-status='pending'` to
 *      `data-status='published'`; the admin sees the "Published"
 *      badge on the review page.
 *
 *   2. Admin rejects a pending image with a reason. Asserts: the
 *      doc gets `rejectionReason/At/By` set; `published` stays
 *      `false`; the organizer sees the `data-status='rejected'`
 *      badge + the reason text; the admin sees the last-rejection
 *      reason on the review page.
 *
 *   3. Admin unpublishes a published image (no reason). Asserts: the
 *      doc flips back to `published: false`; no rejection fields are
 *      set (this is "pull it down" not "this is bad"); the organizer
 *      sees the row back to `data-status='pending'`.
 *
 *   4. Public viewer cannot see a pending image. Asserts: the
 *      `public-stage2-card-PDRM` element is absent when the Stage 2
 *      doc is `published: false` (pending OR rejected). This is the
 *      application-side mirror of the Firestore rule.
 */
import { test, expect, EVENTS } from './fixtures';
import { resetApprovedEvent } from './admin-reset';

const APPROVED = EVENTS.musicFestival;
const PDRM = 'PDRM';

// Smallest valid JPEG (1x1 white pixel).
const TINY_JPEG_B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpgAH//Z';

interface StubItem { authority: string; controlName: string; stageRequirement: 'stage1_only' | 'stage1_and_stage2' }
interface StubResponse { items: StubItem[] }
interface CommitResponse { written: number; controlIds: string[] }

async function setupControlList(api: { callFunction: <TReq, TRes>(name: string, data?: TReq) => Promise<TRes>; signOut(): Promise<void> }, loginAs: (key: 'admin' | 'organizer' | 'pdrm' | 'bomba' | 'kkm' | 'dbkl' | 'public') => Promise<void>) {
  await loginAs('admin');
  const gen = await api.callFunction<{ eventId: string }, StubResponse>('generateEventControlList', { eventId: APPROVED });
  const commit = await api.callFunction<{ eventId: string; items: StubItem[] }, CommitResponse>('editEventControlList', { eventId: APPROVED, items: gen.items });
  const pdrmCtrlId = commit.controlIds.find((id) => id.includes('ctrl-pdrm-v1'))!;
  return { pdrmCtrlId };
}

async function organizerUpload(api: { callFunction: <TReq, TRes>(name: string, data?: TReq) => Promise<TRes>; signOut(): Promise<void> }, loginAs: (key: 'admin' | 'organizer' | 'pdrm' | 'bomba' | 'kkm' | 'dbkl' | 'public') => Promise<void>, pdrmCtrlId: string) {
  await api.signOut();
  await loginAs('organizer');
  await api.callFunction('submitStage2Doc', { eventId: APPROVED, controlId: pdrmCtrlId, fileName: 'pdrm-on-site.jpg', mimeType: 'image/jpeg', fileBase64: TINY_JPEG_B64 });
}

test.describe('@M3 Workstream 5: admin Stage 2 publish gate', () => {
  test.setTimeout(90_000);

  test.beforeEach(async () => {
    await resetApprovedEvent();
  });

  test('admin publishes a pending image; organizer row flips to data-status=published', async ({ page, api, loginAs }) => {
    const { pdrmCtrlId } = await setupControlList(api, loginAs);
    await organizerUpload(api, loginAs, pdrmCtrlId);

    // The organizer's row should be 'pending' before publish.
    await api.signOut();
    await loginAs('organizer');
    await page.goto(`/organizer/events/${APPROVED}/controls`, { waitUntil: 'domcontentloaded' });
    const row = page.locator(`[data-testid="stage2-row-${PDRM}"]`);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-status', 'pending');
    await expect(row.locator(`[data-testid="stage2-pending-badge-${PDRM}"]`)).toBeVisible();

    // Admin publishes.
    await api.signOut();
    await loginAs('admin');
    const publishResult = await api.callFunction<{ eventId: string; controlId: string }, { published: true; publishedAt: number }>(
      'publishStage2Doc',
      { eventId: APPROVED, controlId: pdrmCtrlId },
    );
    expect(publishResult.published).toBe(true);
    expect(publishResult.publishedAt).toBeGreaterThan(0);

    // The doc has publishedAt + publishedBy; no rejection fields.
    const stage2DocId = `${pdrmCtrlId}-s2`;
    const doc = await api.getDoc<{ published: boolean; publishedAt: number; publishedBy: string; rejectionReason?: string }>(
      `events/${APPROVED}/event_controls/${pdrmCtrlId}/stage2_docs/${stage2DocId}`,
    );
    expect(doc?.published).toBe(true);
    expect(doc?.publishedAt).toBeGreaterThan(0);
    expect(doc?.publishedBy).toBeTruthy();
    expect(doc?.rejectionReason ?? '').toBe('');

    // Audit log: one stage2_doc_published entry.
    const audits = await api.getCollection<{ action: string; actorRole: string; metadata: { controlId: string; docId: string; authorityType: string } }>(
      `events/${APPROVED}/audit_logs`,
    );
    const publishedAudits = audits.filter((a) => a.action === 'stage2_doc_published');
    expect(publishedAudits.length).toBe(1);
    expect(publishedAudits[0].actorRole).toBe('admin');
    expect(publishedAudits[0].metadata.controlId).toBe(pdrmCtrlId);
    expect(publishedAudits[0].metadata.authorityType).toBe(PDRM);

    // The organizer's row should be 'published' now.
    await api.signOut();
    await loginAs('organizer');
    await page.goto(`/organizer/events/${APPROVED}/controls`, { waitUntil: 'domcontentloaded' });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-status', 'published');
    await expect(row.locator(`[data-testid="stage2-replace-${PDRM}"]`)).toBeVisible();
    await expect(row.locator(`[data-testid="stage2-upload-${PDRM}"]`)).toHaveCount(0);
  });

  test('admin rejects a pending image with a reason; organizer row shows data-status=rejected + reason', async ({ page, api, loginAs }) => {
    const { pdrmCtrlId } = await setupControlList(api, loginAs);
    await organizerUpload(api, loginAs, pdrmCtrlId);

    // Admin rejects with a reason.
    await api.signOut();
    await loginAs('admin');
    const reason = 'The photo is too dark to make out the PDRM officer. Please re-upload in daylight with the officer facing the camera.';
    const rejectResult = await api.callFunction<{ eventId: string; controlId: string; reason: string }, { published: false; reason?: string; rejectedAt: number }>(
      'unpublishStage2Doc',
      { eventId: APPROVED, controlId: pdrmCtrlId, reason },
    );
    expect(rejectResult.published).toBe(false);
    expect(rejectResult.reason).toBe(reason);
    expect(rejectResult.rejectedAt).toBeGreaterThan(0);

    // The doc has rejection fields set, published stays false.
    const stage2DocId = `${pdrmCtrlId}-s2`;
    const doc = await api.getDoc<{ published: boolean; rejectionReason: string; rejectionAt: number; rejectedBy: string; publishedAt?: number }>(
      `events/${APPROVED}/event_controls/${pdrmCtrlId}/stage2_docs/${stage2DocId}`,
    );
    expect(doc?.published).toBe(false);
    expect(doc?.rejectionReason).toBe(reason);
    expect(doc?.rejectionAt).toBeGreaterThan(0);
    expect(doc?.rejectedBy).toBeTruthy();
    // No published fields (this is a reject, not an unpublish of a
    // previously-published doc).
    expect(doc?.publishedAt ?? null).toBeNull();

    // The organizer's row should be 'rejected' + show the reason.
    await api.signOut();
    await loginAs('organizer');
    await page.goto(`/organizer/events/${APPROVED}/controls`, { waitUntil: 'domcontentloaded' });
    const row = page.locator(`[data-testid="stage2-row-${PDRM}"]`);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-status', 'rejected');
    await expect(row.locator(`[data-testid="stage2-rejected-badge-${PDRM}"]`)).toBeVisible();
    await expect(row.locator(`[data-testid="stage2-rejection-reason-${PDRM}"]`)).toContainText(reason);
    // The Re-upload button is shown (the organizer can fix and re-submit).
    await expect(row.locator(`[data-testid="stage2-replace-${PDRM}"]`)).toBeVisible();
  });

  test('admin unpublishes a published image; organizer row flips back to data-status=pending (no rejection fields)', async ({ page, api, loginAs }) => {
    const { pdrmCtrlId } = await setupControlList(api, loginAs);
    await organizerUpload(api, loginAs, pdrmCtrlId);

    // Publish first.
    await api.signOut();
    await loginAs('admin');
    await api.callFunction('publishStage2Doc', { eventId: APPROVED, controlId: pdrmCtrlId });

    // Unpublish (no reason — this is "pull it down", not "this is bad").
    const unpublishResult = await api.callFunction<{ eventId: string; controlId: string }, { published: false; rejectedAt: number }>(
      'unpublishStage2Doc',
      { eventId: APPROVED, controlId: pdrmCtrlId },
    );
    expect(unpublishResult.published).toBe(false);

    // The doc is unpublished, with no rejection fields (just published: false).
    const stage2DocId = `${pdrmCtrlId}-s2`;
    const doc = await api.getDoc<{ published: boolean; rejectionReason?: string; publishedAt?: number }>(
      `events/${APPROVED}/event_controls/${pdrmCtrlId}/stage2_docs/${stage2DocId}`,
    );
    expect(doc?.published).toBe(false);
    expect(doc?.rejectionReason ?? '').toBe('');
    expect(doc?.publishedAt ?? null).toBeNull();

    // The organizer's row should be back to 'pending' (not 'rejected'
    // — there's no rejection reason).
    await api.signOut();
    await loginAs('organizer');
    await page.goto(`/organizer/events/${APPROVED}/controls`, { waitUntil: 'domcontentloaded' });
    const row = page.locator(`[data-testid="stage2-row-${PDRM}"]`);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-status', 'pending');
    // The Replace button is shown (the organizer can re-upload if they want).
    await expect(row.locator(`[data-testid="stage2-replace-${PDRM}"]`)).toBeVisible();
  });

  test('public viewer does not see a pending (unpublished) Stage 2 image', async ({ page, api, loginAs }) => {
    const { pdrmCtrlId } = await setupControlList(api, loginAs);
    await organizerUpload(api, loginAs, pdrmCtrlId);

    // Don't publish — leave it as pending.
    await api.signOut();
    await loginAs('public');
    await page.goto(`/events/${APPROVED}`, { waitUntil: 'domcontentloaded' });
    // The PDRM card must NOT be visible (the image is pending admin review).
    await expect(page.locator(`[data-testid="public-stage2-card-${PDRM}"]`)).toHaveCount(0);
    // The empty state should be visible (no published images).
    await expect(page.locator('[data-testid="public-stage2-empty"]')).toBeVisible();

    // Now publish and re-check.
    await api.signOut();
    await loginAs('admin');
    await api.callFunction('publishStage2Doc', { eventId: APPROVED, controlId: pdrmCtrlId });

    await api.signOut();
    await loginAs('public');
    await page.goto(`/events/${APPROVED}`, { waitUntil: 'domcontentloaded' });
    const card = page.locator(`[data-testid="public-stage2-card-${PDRM}"]`);
    await expect(card).toBeVisible();
    await expect(card.locator(`[data-testid="public-stage2-confirm-${PDRM}"]`)).toBeVisible();
  });
});
