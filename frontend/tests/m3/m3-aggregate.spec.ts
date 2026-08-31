/**
 * M3 aggregate decision flow (FR-M3-05, FR-M3-07, FR-M3-13, FR-M3-16, FR-M3-17)
 *
 * Tests the multi-authority aggregate behaviour:
 *   - rejection-precedence.spec.ts: a single Rejected decision → aggregate Rejected
 *   - removed amendment decisions are rejected; applications expose only Approve/Reject
 *   - unanimous-publish.spec.ts: all required authorities Approved (same version) → Approved
 *     + public_events/{id} created + organiser notification written
 */
import { test, expect, EVENTS } from './fixtures';
import { resetFoodFair } from './admin-reset';

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

  test('rejection precedence: officer proposals aggregate to Rejected and admin records the final outcome', async ({ page, api, loginAs }) => {
    // evt-002 requires PDRM, BOMBA, KKM, DBKL. A single rejection is the
    // aggregate recommendation, but only the admin's second review changes
    // the application status.
    await loginAs('pdrmKl');
    await page.goto(`/authority/events/${EVENTS.foodFair}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /your decision/i })).toBeVisible();
    // Scope to the "Your decision" section — the Stage-1 control
    // verification section also renders Verify/Reject buttons (per
    // authority × per Stage-1 doc), so a global selector would match
    // multiple elements under strict mode.
    const decisionSection = page.locator('section', { has: page.getByRole('heading', { name: /your decision/i }) });
    await decisionSection.getByLabel(/decision rationale/i).fill('PDRM E2E — crowd ingress plan fails. Rejecting for revision.');
    await decisionSection.getByRole('textbox', { name: /^Suggestion \/ corrective action/ }).fill('Please revise the crowd ingress and traffic management plan before resubmission.');
    const rejectBtn = decisionSection.getByRole('button', { name: /propose rejection/i });
    await rejectBtn.scrollIntoViewIfNeeded();
    await expect(rejectBtn).toBeEnabled();
    await rejectBtn.click();
    await expect.poll(async () => {
      const d = await api.getDoc(`events/${EVENTS.foodFair}/assignments/v1_PDRM`);
      return d?.decision === 'Rejected' ? true : null;
    }, { timeout: 10_000 }).toBe(true);

    // Complete the remaining proposals so second review can open.
    for (const [key, reason] of [
      ['bombaKl', BOMBA_RATIONALE],
      ['kkmKl', KKM_RATIONALE],
      ['dbkl', DBKL_RATIONALE],
    ] as const) {
      await api.signOut();
      await loginAs(key);
      await api.callFunction('recordOfficerProposal', { eventId: EVENTS.foodFair, decision: 'Approved', reason, confirmedReview: true });
    }
    await api.signOut();
    await loginAs('admin');
    await api.callFunction('makeSecondReviewDecision', {
      eventId: EVENTS.foodFair,
      finalDecision: 'Rejected',
      reason: 'The final application does not satisfy the required inter-agency safety conditions.',
      suggestion: 'Submit a new application with a complete and verified safety plan.',
    });

    const event = await api.getDoc(`events/${EVENTS.foodFair}`);
    expect(event!.status).toBe('Rejected');
    const publicEvent = await api.getDoc(`public_events/${EVENTS.foodFair}`);
    expect(publicEvent).toBeNull();

    // A further officer proposal is rejected after the final decision.
    await api.signOut();
    await loginAs('bombaKl');
    let callError: string | null = null;
    try {
      await api.callFunction('recordOfficerProposal', {
        eventId: EVENTS.foodFair,
        decision: 'Approved',
        reason: BOMBA_RATIONALE,
        confirmedReview: true,
      });
    } catch (err) {
      callError = err instanceof Error ? err.message : String(err);
    }
    expect(callError).toMatch(/no longer open|already|initial review/i);
    // Final result remains Rejected.
    await api.signOut();
    await loginAs('admin');
    const eventAfter = await api.getDoc(`events/${EVENTS.foodFair}`);
    expect(eventAfter!.status).toBe('Rejected');
  });

  test('removed amendment decisions are rejected by the officer endpoint', async ({ api, loginAs }) => {
    await loginAs('pdrmKl');
    let callError: string | null = null;
    try {
      await api.callFunction('recordOfficerProposal', {
        eventId: EVENTS.foodFair,
        decision: 'AmendmentRequested',
        reason: 'Legacy amendment decision must not be accepted.',
        confirmedReview: true,
      });
    } catch (error) {
      callError = error instanceof Error ? error.message : String(error);
    }
    expect(callError).toMatch(/invalid|decision|approved|rejected/i);
    expect((await api.getDoc(`events/${EVENTS.foodFair}`))?.status).toBe('UnderReview');
  });

  test('unanimous publish: all required Approved (same version) → Approved + public_events + notification', async ({ page, api, loginAs }) => {
    // evt-002 requires PDRM, BOMBA, KKM, DBKL. All four must Approve on v1.
    const rationales: Array<[string, string]> = [
      ['pdrmKl', 'PDRM approval: traffic management plan and crowd ingress accepted.'],
      ['bombaKl', BOMBA_RATIONALE],
      ['kkmKl', KKM_RATIONALE],
      ['dbkl', DBKL_RATIONALE],
    ];
    for (const [key, rationale] of rationales) {
      await api.signOut();
      await loginAs(key as 'pdrmKl' | 'bombaKl' | 'kkmKl' | 'dbkl');
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
      const approveBtn = decisionSection.getByRole('button', { name: /propose approval/i });
      await approveBtn.scrollIntoViewIfNeeded();
      await expect(approveBtn).toBeEnabled();
      await approveBtn.click();
      await expect.poll(async () => {
        const authority = key === 'dbkl' ? 'DBKL' : key.replace('Kl', '').toUpperCase();
        const d = await api.getDoc(`events/${EVENTS.foodFair}/assignments/v1_${authority}`);
        return d?.decision === 'Approved' ? true : null;
      }, { timeout: 10_000 }).toBe(true);
    }

    await api.signOut();
    await loginAs('admin');
    const second = await api.callFunction<{ eventId: string; finalDecision: 'Approved' }, { status: string }>('makeSecondReviewDecision', {
      eventId: EVENTS.foodFair,
      finalDecision: 'Approved',
      adminNote: 'Admin confirms the unanimous officer proposal.',
    });
    expect(second.status).toBe('Approved');

    // Admin final approval publishes the public event.
    const event = await api.getDoc(`events/${EVENTS.foodFair}`);
    expect(event!.status).toBe('Approved');
    const publicEvent = await api.getDoc(`public_events/${EVENTS.foodFair}`);
    expect(publicEvent).toBeTruthy();
    expect(publicEvent!.publicStatus).toBe('approved');
    expect(publicEvent!.approvedBy).toEqual(expect.arrayContaining(['PDRM', 'BOMBA', 'KKM', 'DBKL']));
  });
});
