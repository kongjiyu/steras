/**
 * M3 Workstream 4 + Workstream 5 — organizer Stage 2 upload
 * (FR-M3-20 second half, UC-35..38 pre-reqs; FR-M3-21 admin publish
 * gate).
 *
 *   1. Organizer uploads a Stage 2 image. Asserts (WS5 — pending by
 *      default; admin publishes in a separate step):
 *      - status='pending' in the response
 *      - doc has imageUrl starting with 'data:image/jpeg;base64,'
 *      - doc.published === false, no publishedAt/publishedBy yet
 *      - doc.publicConfirmCount === 0 (fresh on upload)
 *      - audit_logs has a 'stage2_doc_submitted' entry
 *      - assigned officer + admin get a 'stage2_doc_submitted' notification
 *      - the organizer UI shows the row with data-status='pending'
 *        + a "Pending admin review" badge
 *      - then admin calls `publishStage2Doc` and the row flips to
 *        data-status='published'
 *
 *   2. Organizer cannot re-upload once a report is open. Test:
 *      - organizer uploads an image
 *      - admin publishes it (the public report flow gates on
 *        `published === true`)
 *      - public user reports
 *      - organizer tries to replace -> refused with a clear error
 */
import { test, expect, EVENTS } from './fixtures';
import { resetApprovedEvent } from './admin-reset';

const APPROVED = EVENTS.musicFestival;
const PDRM = 'PDRM';

// Smallest valid JPEG (1x1 white pixel).
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

async function setupControlList(api: { callFunction: <TReq, TRes>(name: string, data?: TReq) => Promise<TRes>; signOut(): Promise<void> }, loginAs: (key: 'admin' | 'organizer' | 'pdrm' | 'bomba' | 'kkm' | 'dbkl' | 'public') => Promise<void>) {
  await loginAs('admin');
  const gen = await api.callFunction<{ eventId: string }, StubResponse>('generateEventControlList', { eventId: APPROVED });
  const commit = await api.callFunction<{ eventId: string; items: StubItem[] }, CommitResponse>('editEventControlList', { eventId: APPROVED, items: gen.items });
  const pdrmCtrlId = commit.controlIds.find((id) => id.includes('ctrl-pdrm-v1'))!;
  return { pdrmCtrlId };
}

test.describe('@M3 Workstream 4: organizer Stage 2 upload', () => {
  test.setTimeout(90_000);

  test.beforeEach(async () => {
    await resetApprovedEvent();
  });

  test('organizer uploads a Stage 2 image; status flips to published; audit + notifications fire', async ({ page, api, loginAs }) => {
    const { pdrmCtrlId } = await setupControlList(api, loginAs);
    const stage2DocId = `${pdrmCtrlId}-s2`;

    // Step 2: organizer uploads a small JPEG as the Stage 2 image.
    // Workstream 5: the doc lands at `published: false` (pending admin
    // review). The organizer's `status` response is now `'pending'`.
    await api.signOut();
    await loginAs('organizer');
    const result = await api.callFunction<{ eventId: string; controlId: string; fileName: string; mimeType: string; fileBase64: string }, { status: 'pending'; docId: string; uploadedAt: number }>(
      'submitStage2Doc',
      { eventId: APPROVED, controlId: pdrmCtrlId, fileName: 'pdrm-on-site.jpg', mimeType: 'image/jpeg', fileBase64: TINY_JPEG_B64 },
    );
    expect(result.status).toBe('pending');
    expect(result.docId).toBe(stage2DocId);

    // Step 3: doc is written with the data URL + pending + fresh count.
    // No `published` / `publishedAt` / `publishedBy` yet — admin must
    // click Publish before those fields are set.
    const doc = await api.getDoc<{ imageUrl: string; published: boolean; publishedAt?: number; publishedBy?: string; publicConfirmCount: number; uploadedAt: number; uploadedBy: string; m4TicketId?: string }>(
      `events/${APPROVED}/event_controls/${pdrmCtrlId}/stage2_docs/${stage2DocId}`,
    );
    expect(doc?.imageUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(doc?.published).toBe(false);
    expect(doc?.publishedAt ?? null).toBeNull();
    expect(doc?.publishedBy ?? '').toBe('');
    expect(doc?.publicConfirmCount).toBe(0);
    expect(doc?.uploadedAt).toBeGreaterThan(0);
    expect(doc?.uploadedBy).toBeTruthy();
    expect(doc?.m4TicketId ?? '').toBe('');

    // Step 4: the audit log got a 'stage2_doc_submitted' entry. Read
    // as admin (organizer can't read audit_logs per the Firestore rules).
    await api.signOut();
    await loginAs('admin');
    const audits = await api.getCollection<{ action: string; actorRole: string; metadata: { controlId: string; docId: string; authorityType: string; fileName: string; mimeType: string; fileSizeBytes: number; replaced: boolean } }>(
      `events/${APPROVED}/audit_logs`,
    );
    const submitted = audits.filter((a) => a.action === 'stage2_doc_submitted');
    expect(submitted.length).toBe(1);
    expect(submitted[0].actorRole).toBe('organizer');
    expect(submitted[0].metadata.controlId).toBe(pdrmCtrlId);
    expect(submitted[0].metadata.docId).toBe(stage2DocId);
    expect(submitted[0].metadata.authorityType).toBe('PDRM');
    expect(submitted[0].metadata.mimeType).toBe('image/jpeg');
    expect(submitted[0].metadata.replaced).toBe(false);

    // Step 5: organizer UI shows the row in pending state (Workstream 5:
    // the doc lands at `published: false` and waits for an admin to
    // publish before it goes public). Then we admin-publish + verify
    // the row flips to `published`.
    await api.signOut();
    await loginAs('organizer');
    await page.goto(`/organizer/events/${APPROVED}/controls`, { waitUntil: 'domcontentloaded' });
    const row = page.locator(`[data-testid="stage2-row-${PDRM}"]`);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-status', 'pending');
    await expect(row.locator(`[data-testid="stage2-pending-badge-${PDRM}"]`)).toBeVisible();
    // The view-link + replace button are still present so the organizer
    // can view what they uploaded and re-upload if needed.
    await expect(row.locator(`[data-testid="stage2-view-link-${PDRM}"]`)).toBeVisible();
    await expect(row.locator(`[data-testid="stage2-replace-${PDRM}"]`)).toBeVisible();
    await expect(row.locator(`[data-testid="stage2-upload-${PDRM}"]`)).toHaveCount(0);

    // Step 6: admin publishes. Now the row flips to 'published'.
    await api.signOut();
    await loginAs('admin');
    await api.callFunction('publishStage2Doc', { eventId: APPROVED, controlId: pdrmCtrlId });
    await api.signOut();
    await loginAs('organizer');
    await page.goto(`/organizer/events/${APPROVED}/controls`, { waitUntil: 'domcontentloaded' });
    await expect(row).toHaveAttribute('data-status', 'published');
    await expect(row.locator(`[data-testid="stage2-replace-${PDRM}"]`)).toBeVisible();
  });

  test('organizer cannot replace the Stage 2 image while a report is open', async ({ api, loginAs }) => {
    const { pdrmCtrlId } = await setupControlList(api, loginAs);
    const stage2DocId = `${pdrmCtrlId}-s2`;

    // Step 1: organizer uploads (lands at published: false in WS5).
    await api.signOut();
    await loginAs('organizer');
    await api.callFunction('submitStage2Doc', { eventId: APPROVED, controlId: pdrmCtrlId, fileName: 'first.jpg', mimeType: 'image/jpeg', fileBase64: TINY_JPEG_B64 });

    // Step 2: admin publishes (public can't report a pending image).
    await api.signOut();
    await loginAs('admin');
    await api.callFunction('publishStage2Doc', { eventId: APPROVED, controlId: pdrmCtrlId });

    // Step 3: public user reports.
    await api.signOut();
    await loginAs('public');
    const longDescription = 'I went to the venue on the advertised date and there was no PDRM officer present at the entrance. The advertised photo does not match what I saw on the day. Please investigate.';
    const reportResult = await api.callFunction<{ eventId: string; controlId: string; category: string; description: string }, { ticketId: string; alreadyReported: boolean }>(
      'reportStage2Doc',
      { eventId: APPROVED, controlId: pdrmCtrlId, category: 'item_not_at_venue', description: longDescription },
    );
    expect(reportResult.alreadyReported).toBe(false);
    const ticketId = reportResult.ticketId;
    expect(ticketId).toBeTruthy();

    // Step 4: organizer tries to replace. The function should refuse
    // with failed-precondition ("A report is open for this Stage 2 image").
    await api.signOut();
    await loginAs('organizer');
    let threw = false;
    let errMessage = '';
    try {
      await api.callFunction('submitStage2Doc', { eventId: APPROVED, controlId: pdrmCtrlId, fileName: 'second.jpg', mimeType: 'image/jpeg', fileBase64: TINY_JPEG_B64 });
    } catch (err: unknown) {
      threw = true;
      const e = err as { code?: string; message?: string };
      errMessage = e.message ?? '';
    }
    expect(threw).toBe(true);
    expect(errMessage).toMatch(/report is open|m4 ticket/i);

    // The Stage 2 doc is unchanged: imageUrl is the FIRST upload,
    // not the second. The replace call did NOT write.
    const doc = await api.getDoc<{ imageUrl: string; published: boolean; m4TicketId?: string }>(
      `events/${APPROVED}/event_controls/${pdrmCtrlId}/stage2_docs/${stage2DocId}`,
    );
    expect(doc?.published).toBe(true);
    expect(doc?.m4TicketId).toBe(ticketId);
    // imageUrl was set by the first upload; if replace had succeeded, the
    // fileName in the data URL metadata wouldn't change (it's just base64),
    // but the audit log would have a 2nd entry. Check the audit
    // (organizer can't read audit_logs per the Firestore rules; sign
    // in as admin for the read).
    await api.signOut();
    await loginAs('admin');
    const audits = await api.getCollection<{ action: string; metadata: { fileName: string } }>(`events/${APPROVED}/audit_logs`);
    const submitted = audits.filter((a) => a.action === 'stage2_doc_submitted');
    expect(submitted.length).toBe(1);
    expect(submitted[0].metadata.fileName).toBe('first.jpg');
  });
});
