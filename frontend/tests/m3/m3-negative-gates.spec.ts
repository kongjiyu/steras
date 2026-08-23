/**
 * M3 negative gates — compliance + readiness (FR-M3-14, handoff item 1+2)
 *
 *   compliance-blocked:   Approve on complianceStatus=blocked must fail
 *   provisional-rationale: Approve on readiness=provisional requires ≥80
 *                          char rationale; short rationale must fail
 *   non-assigned:         PDRM tries to act on an event that only requires
 *                          BOMBA → permission-denied
 */
import { test, expect, EVENTS } from './fixtures';

test.describe('@M3 negative decision gates', () => {
  test('compliance-blocked: UI disables approval and Cloud Function rejects bypass attempts', async ({ page, api, loginAs }) => {
    await loginAs('pdrm');
    await page.goto(`/authority/events/${EVENTS.complianceBlocked}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /your decision/i })).toBeVisible();
    // Scope to the "Your decision" section — the Stage-1 control
    // verification section also renders rationale textareas.
    const decisionSection = page.locator('section', { has: page.getByRole('heading', { name: /your decision/i }) });
    const rationaleTa = decisionSection.getByLabel(/decision rationale/i);
    await rationaleTa.scrollIntoViewIfNeeded();
    await rationaleTa.fill('Test rationale for blocked compliance scenario — should be rejected by the Cloud Function.');
    await decisionSection.getByTestId('confirmed-review-checkbox').check();
    const approveBtn = decisionSection.getByRole('button', { name: /propose approval/i });
    await approveBtn.scrollIntoViewIfNeeded();
    await expect(approveBtn).toBeDisabled();
    let callError: string | null = null;
    try {
      await api.callFunction('recordOfficerProposal', {
        eventId: EVENTS.complianceBlocked,
        decision: 'Approved',
        reason: 'Test rationale for blocked compliance scenario — the server must reject this bypass attempt.',
        confirmedReview: true,
      });
    } catch (err) {
      callError = err instanceof Error ? err.message : String(err);
    }
    expect(callError).toMatch(/compliance.*blocked|blocked.*compliance/i);
    // And no decision was written
    const dec = await api.getDoc(`events/${EVENTS.complianceBlocked}/assignments/v1_PDRM`);
    expect(dec?.decision).toBeUndefined();
  });

  test('provisional-readiness: short rationale is rejected by Cloud Function', async ({ api, loginAs }) => {
    await loginAs('bomba');
    let callError: string | null = null;
    try {
      await api.callFunction('recordOfficerProposal', {
        eventId: EVENTS.provisionalReview,
        decision: 'Approved',
        reason: 'Short rationale that fails.',
        confirmedReview: true,
      });
    } catch (err) {
      callError = err instanceof Error ? err.message : String(err);
    }
    expect(callError).toMatch(/at least 80|provisional|insufficient_data/i);
    const assignment = await api.getDoc(`events/${EVENTS.provisionalReview}/assignments/v1_BOMBA`);
    expect(assignment?.decision).toBeUndefined();
  });

  test('provisional-readiness: ≥80 char rationale is accepted', async ({ page, api, loginAs }) => {
    await loginAs('bomba');
    await page.goto(`/authority/events/${EVENTS.provisionalReview}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /your decision/i })).toBeVisible();
    // Scope to the "Your decision" section (Stage-1 section also has textareas).
    const decisionSection = page.locator('section', { has: page.getByRole('heading', { name: /your decision/i }) });
    const rationaleTa = decisionSection.getByLabel(/decision rationale/i);
    await rationaleTa.scrollIntoViewIfNeeded();
    rationaleTa.fill(
      'Bomba approval: provisional M2 readiness acknowledged. ' +
      'KKM mass-gathering guideline and venue fire cert verified on site. ' +
      'No outstanding safety concerns. The provisional status is acceptable for this event size and risk profile.',
    );
    // FR-M3-16: tick the checkbox.
    await decisionSection.getByTestId('confirmed-review-checkbox').check();
    const approveBtn = decisionSection.getByRole('button', { name: /propose approval/i });
    await approveBtn.scrollIntoViewIfNeeded();
    await expect(approveBtn).toBeEnabled({ timeout: 10_000 });
    await approveBtn.click();
    await expect.poll(async () => {
      const d = await api.getDoc(`events/${EVENTS.provisionalReview}/assignments/v1_BOMBA`);
      return d?.decision === 'Approved' ? true : null;
    }, { timeout: 15_000, intervals: [500, 1_000, 1_500] }).toBe(true);
  });

  test('non-assigned authority cannot act on an event that does not require them', async ({ api, loginAs }) => {
    // The compliance-blocked fixture requires only PDRM + BOMBA. DBKL is
    // not assigned. Sign in as DBKL and call the current officer-proposal
    // Cloud Function directly —
    // the form is hidden for non-assigned authorities so we bypass the UI.
    await loginAs('dbkl');
    let callError: string | null = null;
    try {
      await api.callFunction('recordOfficerProposal', {
        eventId: EVENTS.complianceBlocked,
        decision: 'Approved',
        reason: 'DBKL attempting to act on an event it is not assigned to — should be rejected.',
      });
    } catch (err) {
      callError = err instanceof Error ? err.message : String(err);
    }
    // Expect a permission-denied HttpsError from the Cloud Function
    expect(callError).toMatch(/not (?:the named officer )?assigned|permission/i);
    // Switch to admin (via signOut then loginAs) to read the
    // (subcollection-server-only) decision and verify nothing was written.
    // We can't read this as DBKL because they're not assigned to the event.
    await api.signOut();
    await loginAs('admin');
    const dec = await api.getDoc(`events/${EVENTS.complianceBlocked}/assignments/v1_DBKL`);
    expect(dec).toBeNull();
  });
});
