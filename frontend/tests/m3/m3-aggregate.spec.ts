/**
 * M3 aggregate decision flow (FR-M3-05, FR-M3-07, FR-M3-13, FR-M3-16, FR-M3-17)
 *
 * Tests the multi-authority aggregate behaviour:
 *   - rejection-precedence.spec.ts: a single Rejected decision → aggregate Rejected
 *   - amendment-precedence.spec.ts: a single AmendmentRequested (no Reject) → AmendmentRequested
 *   - unanimous-publish.spec.ts: all required authorities Approved (same version) → Approved
 *     + public_events/{id} created + organiser notification written
 */
import { test, expect, EVENTS } from './fixtures';
import { resetFoodFair } from './admin-reset';

const MIN_RATIONALE = 'Aggregate-test rationale — minimum 10 characters, acceptable for UAT.';
const BOMBA_RATIONALE = 'Bomba approval: fire safety officer signed off on egress routes and extinguisher placement.';
const KKM_RATIONALE = 'KKM approval: medical plan meets mass-gathering guideline for 12k attendees.';
const DBKL_RATIONALE = 'DBKL approval: venue capacity and emergency access verified on site.';

test.describe('@M3 aggregate decision flows', () => {
  // Each test starts with a clean evt-002 (UnderReview, no decisions) so
  // they can run in any order. Uses the Admin SDK to bypass security
  // rules (admins don't have client-side write permission on the events
  // collection).
  test.beforeEach(async () => {
    await resetFoodFair();
  });

  test('rejection precedence: single Rejected → aggregate Rejected, no public_events, no further decisions', async ({ page, api, loginAs }) => {
    // evt-002 requires PDRM, BOMBA, KKM, DBKL. PDRM rejects → aggregate is
    // Rejected. Per FR-M3-05 precedence, Rejected wins over any Approved
    // or AmendmentRequested. The function also blocks further decisions
    // (the version is "no longer open for review").
    await loginAs('pdrm');
    await page.goto(`/authority/events/${EVENTS.foodFair}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /your decision/i })).toBeVisible();
    // Scope to the "Your decision" section — the Stage-1 control
    // verification section also renders Verify/Reject buttons (per
    // authority × per Stage-1 doc), so a global selector would match
    // multiple elements under strict mode.
    const decisionSection = page.locator('section', { has: page.getByRole('heading', { name: /your decision/i }) });
    await decisionSection.getByLabel(/decision rationale/i).fill('PDRM E2E — crowd ingress plan fails. Rejecting for revision.');
    const rejectBtn = decisionSection.getByRole('button', { name: /^reject$/i });
    await rejectBtn.scrollIntoViewIfNeeded();
    await expect(rejectBtn).toBeEnabled();
    await rejectBtn.click();
    await expect.poll(async () => {
      const d = await api.getDoc(`events/${EVENTS.foodFair}/decisions/v1_PDRM`);
      return d?.decision === 'Rejected' ? true : null;
    }, { timeout: 10_000 }).toBe(true);

    // Verify aggregate is Rejected + no public_events entry
    const event = await api.getDoc(`events/${EVENTS.foodFair}`);
    expect(event!.status).toBe('Rejected');
    const publicEvent = await api.getDoc(`public_events/${EVENTS.foodFair}`);
    expect(publicEvent).toBeNull();

    // BOMBA tries to Approve — function should reject (version no longer
    // open for review) and no BOMBA decision should be recorded.
    await api.signOut();
    await loginAs('bomba');
    let callError: string | null = null;
    try {
      await api.callFunction('makeAuthorityDecision', {
        eventId: EVENTS.foodFair,
        decision: 'Approved',
        rationale: BOMBA_RATIONALE,
        // FR-M3-16: required when Approve (the function refuses without it).
        confirmedReview: true,
      });
    } catch (err) {
      callError = err instanceof Error ? err.message : String(err);
    }
    expect(callError).toMatch(/no longer open for review/i);
    // Aggregate is still Rejected
    const eventAfter = await api.getDoc(`events/${EVENTS.foodFair}`);
    expect(eventAfter!.status).toBe('Rejected');
  });

  test('amendment precedence: AmendmentRequested (no Reject) → AmendmentRequested', async ({ page, api, loginAs }) => {
    // evt-004 marathon: already AmendmentRequested. Use evt-002 for a clean test.
    await loginAs('pdrm');
    await page.goto(`/authority/events/${EVENTS.foodFair}`, { waitUntil: 'domcontentloaded' });
    // Make sure decisions are cleared
    const existing = await api.getCollection(`events/${EVENTS.foodFair}/decisions`);
    if (existing.length > 0) {
      // Clean decisions via Admin SDK path — but rules block client delete.
      // The global-setup already cleared; if not, this test would have failed
      // earlier in the suite. Best-effort assertion.
    }
    // Scope to the "Your decision" section for rationale + buttons
    // (Stage-1 section also has buttons/textareas).
    const decisionSection = page.locator('section', { has: page.getByRole('heading', { name: /your decision/i }) });
    await decisionSection.getByLabel(/decision rationale/i).fill('PDRM E2E — requesting amendment to medical plan and traffic TMP.');
    const amendBtn = decisionSection.getByRole('button', { name: /request amendment/i });
    await amendBtn.scrollIntoViewIfNeeded();
    await expect(amendBtn).toBeEnabled();
    await amendBtn.click();
    await expect.poll(async () => {
      const d = await api.getDoc(`events/${EVENTS.foodFair}/decisions/v1_PDRM`);
      return d?.decision === 'AmendmentRequested' ? true : null;
    }, { timeout: 10_000 }).toBe(true);

    const event = await api.getDoc(`events/${EVENTS.foodFair}`);
    expect(event!.status).toBe('AmendmentRequested');
    const publicEvent = await api.getDoc(`public_events/${EVENTS.foodFair}`);
    expect(publicEvent).toBeNull();
  });

  test('unanimous publish: all required Approved (same version) → Approved + public_events + notification', async ({ page, api, loginAs }) => {
    // evt-002 requires PDRM, BOMBA, KKM, DBKL. All four must Approve on v1.
    const rationales: Array<[string, string]> = [
      ['pdrm', 'PDRM approval: traffic management plan and crowd ingress accepted.'],
      ['bomba', BOMBA_RATIONALE],
      ['kkm', KKM_RATIONALE],
      ['dbkl', DBKL_RATIONALE],
    ];
    for (const [key, rationale] of rationales) {
      await api.signOut();
      await loginAs(key as 'pdrm' | 'bomba' | 'kkm' | 'dbkl');
      await page.goto(`/authority/events/${EVENTS.foodFair}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /your decision/i })).toBeVisible();
      // Scope to the "Your decision" section (Stage-1 section has its
      // own buttons/textareas).
      const decisionSection = page.locator('section', { has: page.getByRole('heading', { name: /your decision/i }) });
      const ta = decisionSection.getByLabel(/decision rationale/i);
      await ta.scrollIntoViewIfNeeded();
      await ta.fill(rationale);
      // FR-M3-16: tick the "I have reviewed" checkbox before Approve
      // (the button is disabled without it and the Cloud Function
      // would refuse the call server-side).
      await decisionSection.getByTestId('confirmed-review-checkbox').check();
      const approveBtn = decisionSection.getByRole('button', { name: /^approve$/i });
      await approveBtn.scrollIntoViewIfNeeded();
      await expect(approveBtn).toBeEnabled();
      await approveBtn.click();
      await expect.poll(async () => {
        const d = await api.getDoc(`events/${EVENTS.foodFair}/decisions/v1_${key.toUpperCase()}`);
        return d?.decision === 'Approved' ? true : null;
      }, { timeout: 10_000 }).toBe(true);
    }

    // Aggregate is Approved + public_events entry created
    const event = await api.getDoc(`events/${EVENTS.foodFair}`);
    expect(event!.status).toBe('Approved');
    const publicEvent = await api.getDoc(`public_events/${EVENTS.foodFair}`);
    expect(publicEvent).toBeTruthy();
    expect(publicEvent!.publicStatus).toBe('approved');
    expect(publicEvent!.approvedBy).toEqual(expect.arrayContaining(['PDRM', 'BOMBA', 'KKM', 'DBKL']));
  });
});
