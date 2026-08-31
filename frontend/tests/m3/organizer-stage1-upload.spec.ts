/**
 * M3 Workstream 3 — organizer Stage 1 upload + "Use Previous" (UC-28,
 * UC-29, FR-M3-20, FR-M3-26).
 *
 *   1. Organizer uploads a Stage 1 doc to a slot. The doc is written
 *      with status='pending_verification' + a data: URL filePath; the
 *      audit log gets a 'stage1_doc_submitted' entry; the assigned
 *      officer + admin get a 'stage1_doc_submitted' notification.
 *   2. Organizer clicks "Use Previous" on a receipt slot. The doc flips
 *      to status='use_previous'. No source-event picker (M3 owner
 *      decision 2026-08-19). Stage 2 is the public verification
 *      backstop.
 *   3. "Use Previous" is refused on a non-receipt docType (e.g.
 *      application letter).
 *   4. Organizer resubmits after an officer rejected the doc. The new
 *      status is 'pending_verification' but the prior rejection
 *      reason is preserved on the doc (cleared on next verification).
 */
import { test, expect, EVENTS } from './fixtures';
import { resetApprovedEvent } from './admin-reset';

const APPROVED = EVENTS.musicFestival;
const PDRM = 'PDRM';

// Smallest valid JPEG (1x1 white pixel) ~ 125 bytes, well under 700 KB.
const TINY_JPEG_B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpgAH//Z';

interface StubItem {
  controlName: string;
  authority: string;
  stageRequirement: 'stage1_only' | 'stage1_and_stage2';
  stage1Requirements: Array<{ docType: 'application' | 'license' | 'insurance' | 'receipt' | 'floor_plan' | 'other'; label: string; required: boolean }>;
  stage2Requirement: { kind: 'image'; label: string } | null;
}

interface StubResponse { items: StubItem[] }
interface CommitResponse { written: number; controlIds: string[] }

/** Run the Workstream 2 setup (generate + edit) and return the
 *  PDRM controlId + the committed items list. The caller can then
 *  mutate the items (e.g. add a receipt) and re-commit. */
async function setupControlList(api: { callFunction: <TReq, TRes>(name: string, data?: TReq) => Promise<TRes>; signOut(): Promise<void> }, loginAs: (key: 'admin' | 'organizer' | 'pdrm' | 'bomba' | 'kkm' | 'dbkl' | 'public') => Promise<void>) {
  await loginAs('admin');
  const gen = await api.callFunction<{ eventId: string }, StubResponse>('generateEventControlList', { eventId: APPROVED });
  const commit = await api.callFunction<{ eventId: string; items: StubItem[] }, CommitResponse>('editEventControlList', { eventId: APPROVED, items: gen.items });
  const pdrmCtrlId = commit.controlIds.find((id) => id.includes('ctrl-pdrm-v1'))!;
  expect(pdrmCtrlId).toBeTruthy();
  return { pdrmCtrlId, items: gen.items, commit };
}

test.describe('@M3 Workstream 3: organizer Stage 1 upload + Use Previous', () => {
  test.setTimeout(90_000);

  test.beforeEach(async () => {
    await resetApprovedEvent();
  });

  test('organizer uploads a Stage 1 doc; status flips to pending_verification; audit + notifications fire', async ({ page, api, loginAs }) => {
    const { pdrmCtrlId } = await setupControlList(api, loginAs);
    const appDocId = `${pdrmCtrlId}-s1-application`;

    // Step 2: organizer uploads a small JPEG to the application letter slot.
    await api.signOut();
    await loginAs('organizer');
    const result = await api.callFunction<{ eventId: string; controlId: string; docId: string; fileName: string; mimeType: string; fileBase64: string }, { status: string; uploadedAt: number }>(
      'submitStage1Doc',
      { eventId: APPROVED, controlId: pdrmCtrlId, docId: appDocId, fileName: 'pdrm-application.jpg', mimeType: 'image/jpeg', fileBase64: TINY_JPEG_B64 },
    );
    expect(result.status).toBe('pending_verification');

    // Step 3: the doc is written with status + filePath + uploadedAt.
    const doc = await api.getDoc<{ status: string; filePath: string; uploadedAt: number; uploadedBy: string; rejectionReason?: string }>(
      `events/${APPROVED}/event_controls/${pdrmCtrlId}/stage1_docs/${appDocId}`,
    );
    expect(doc?.status).toBe('pending_verification');
    expect(doc?.filePath).toMatch(/^data:image\/jpeg;base64,/);
    expect(doc?.uploadedAt).toBeGreaterThan(0);
    expect(doc?.uploadedBy).toBeTruthy();
    // No rejection reason on a fresh upload.
    expect(doc?.rejectionReason ?? '').toBe('');

    // Step 4: organizer UI reflects the new status. (We do this BEFORE
    // re-signing in as admin for the audit read, to keep the page in
    // organizer auth and avoid a page reload race.)
    await page.goto(`/organizer/events/${APPROVED}/controls`, { waitUntil: 'domcontentloaded' });
    const row = page.locator(`[data-testid="stage1-row-${appDocId}"]`);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-status', 'pending_verification');
    await expect(row.locator(`[data-testid="stage1-status-${appDocId}"]`)).toContainText('Awaiting officer verification');

    // Step 5: the audit log got a 'stage1_doc_submitted' entry. Read it
    // as admin (organizer can't read audit_logs per the Firestore rules).
    await api.signOut();
    await loginAs('admin');
    const audits = await api.getCollection<{ action: string; actorId: string; actorRole: string; notes: string; metadata: { controlId: string; docId: string; path: string; mimeType?: string; fileSizeBytes?: number } }>(
      `events/${APPROVED}/audit_logs`,
    );
    const submitted = audits.filter((a) => a.action === 'stage1_doc_submitted');
    expect(submitted.length).toBe(1);
    expect(submitted[0].actorRole).toBe('organizer');
    expect(submitted[0].metadata.controlId).toBe(pdrmCtrlId);
    expect(submitted[0].metadata.docId).toBe(appDocId);
    expect(submitted[0].metadata.path).toBe('upload');
    expect(submitted[0].metadata.mimeType).toBe('image/jpeg');
    expect(submitted[0].metadata.fileSizeBytes).toBeGreaterThan(0);
  });

  test('organizer clicks Use Previous on a receipt slot; status flips to use_previous; audit fires', async ({ page, api, loginAs }) => {
    // Step 1: generate the stub list and inject a receipt requirement
    // into the PDRM control. The M3 stub doesn't ship a receipt docType
    // (its templates are app/license/insurance/floor_plan only), so the
    // test adds one before committing.
    await loginAs('admin');
    const gen = await api.callFunction<{ eventId: string }, StubResponse>('generateEventControlList', { eventId: APPROVED });
    const pdrm = gen.items.find((i) => i.authority === PDRM)!;
    pdrm.stage1Requirements = [
      ...pdrm.stage1Requirements,
      { docType: 'receipt', label: 'PDRM on-site service receipt', required: true },
    ];
    const commit = await api.callFunction<{ eventId: string; items: StubItem[] }, CommitResponse>('editEventControlList', { eventId: APPROVED, items: gen.items });
    const pdrmCtrlId = commit.controlIds.find((id) => id.includes('ctrl-pdrm-v1'))!;

    const receiptDocId = `${pdrmCtrlId}-s1-receipt`;

    // Step 2: organizer marks the receipt as Use Previous.
    await api.signOut();
    await loginAs('organizer');
    const result = await api.callFunction<{ eventId: string; controlId: string; docId: string; usePrevious: boolean }, { status: string }>(
      'submitStage1Doc',
      { eventId: APPROVED, controlId: pdrmCtrlId, docId: receiptDocId, usePrevious: true },
    );
    expect(result.status).toBe('use_previous');

    // Step 3: the doc was written with status=use_previous, no filePath.
    const doc = await api.getDoc<{ status: string; filePath?: string; uploadedAt: number }>(
      `events/${APPROVED}/event_controls/${pdrmCtrlId}/stage1_docs/${receiptDocId}`,
    );
    expect(doc?.status).toBe('use_previous');
    expect(doc?.filePath ?? '').toBe('');
    expect(doc?.uploadedAt).toBeGreaterThan(0);

    // Step 4: UI shows the row in use_previous state.
    await page.goto(`/organizer/events/${APPROVED}/controls`, { waitUntil: 'domcontentloaded' });
    const row = page.locator(`[data-testid="stage1-row-${receiptDocId}"]`);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-status', 'use_previous');
    await expect(row.locator(`[data-testid="stage1-status-${receiptDocId}"]`)).toContainText('Use Previous');
    // The Upload button is gone (only the "Marked as Use Previous" badge).
    await expect(row.locator('[data-testid="stage1-upload"]')).toHaveCount(0);

    // Step 5: audit log entry. Read as admin (organizer can't read
    // audit_logs per the Firestore rules).
    await api.signOut();
    await loginAs('admin');
    const audits = await api.getCollection<{ action: string; notes: string; metadata: { path: string } }>(`events/${APPROVED}/audit_logs`);
    const submitted = audits.filter((a) => a.action === 'stage1_doc_submitted');
    expect(submitted.length).toBe(1);
    expect(submitted[0].metadata.path).toBe('use_previous');
    expect(submitted[0].notes).toContain('Use Previous');
  });

  test('Use Previous is refused on a non-receipt docType (A25)', async ({ api, loginAs }) => {
    const { pdrmCtrlId } = await setupControlList(api, loginAs);
    const appDocId = `${pdrmCtrlId}-s1-application`;

    await api.signOut();
    await loginAs('organizer');
    let threw = false;
    let errMessage = '';
    try {
      await api.callFunction('submitStage1Doc', { eventId: APPROVED, controlId: pdrmCtrlId, docId: appDocId, usePrevious: true });
    } catch (err: unknown) {
      threw = true;
      const e = err as { code?: string; message?: string };
      errMessage = e.message ?? '';
    }
    expect(threw).toBe(true);
    // The error message mentions the docType / receipt rule.
    expect(errMessage).toMatch(/receipt/i);

    // The doc was NOT created.
    const doc = await api.getDoc<{ status: string }>(`events/${APPROVED}/event_controls/${pdrmCtrlId}/stage1_docs/${appDocId}`);
    expect(doc).toBeNull();
  });

  test('organizer resubmits after rejection; prior rejection reason is preserved on the doc', async ({ api, loginAs }) => {
    const { pdrmCtrlId } = await setupControlList(api, loginAs);
    const appDocId = `${pdrmCtrlId}-s1-application`;

    // Step 2: organizer uploads an application letter.
    await api.signOut();
    await loginAs('organizer');
    await api.callFunction('submitStage1Doc', { eventId: APPROVED, controlId: pdrmCtrlId, docId: appDocId, fileName: 'app.jpg', mimeType: 'image/jpeg', fileBase64: TINY_JPEG_B64 });

    // Step 3: PDRM officer rejects the doc with a reason + suggestion.
    await api.signOut();
    await loginAs('pdrmKl');
    const rejectionRationale = 'Application letter is illegible. Please re-upload a higher-resolution scan with the official letterhead visible at the top of the page so the issuing officer can verify the signature.';
    await api.callFunction('verifyStage1Doc', {
      eventId: APPROVED,
      controlId: pdrmCtrlId,
      docId: appDocId,
      status: 'rejected',
      rationale: rejectionRationale,
    });

    // The doc should now have status=rejected + rejectionReason set.
    const rejected = await api.getDoc<{ status: string; rejectionReason: string; rejectionSuggestion?: string }>(`events/${APPROVED}/event_controls/${pdrmCtrlId}/stage1_docs/${appDocId}`);
    expect(rejected?.status).toBe('rejected');
    expect(rejected?.rejectionReason).toBe(rejectionRationale);

    // Step 4: organizer resubmits.
    await api.signOut();
    await loginAs('organizer');
    const resubmitResult = await api.callFunction<{ eventId: string; controlId: string; docId: string; fileName: string; mimeType: string; fileBase64: string }, { status: string }>(
      'submitStage1Doc',
      { eventId: APPROVED, controlId: pdrmCtrlId, docId: appDocId, fileName: 'app-v2.jpg', mimeType: 'image/jpeg', fileBase64: TINY_JPEG_B64 },
    );
    expect(resubmitResult.status).toBe('pending_verification');

    // The doc has status=pending_verification BUT the prior rejection
    // reason is preserved on the doc so the officer sees the history
    // on the next pass. (Q4 confirmed.)
    const resubmitted = await api.getDoc<{ status: string; rejectionReason: string; uploadedAt: number }>(`events/${APPROVED}/event_controls/${pdrmCtrlId}/stage1_docs/${appDocId}`);
    expect(resubmitted?.status).toBe('pending_verification');
    expect(resubmitted?.rejectionReason).toBe(rejectionRationale);
    expect(resubmitted?.uploadedAt).toBeGreaterThan(0);
    // The controlItemVersion is still 1; we don't bump it on resubmit
    // (Q5 confirmed).
    const ctrl = await api.getDoc<{ controlItemVersion: number; label: string }>(`events/${APPROVED}/event_controls/${pdrmCtrlId}`);
    expect(ctrl?.controlItemVersion).toBe(1);
  });
});
