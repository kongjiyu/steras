/**
 * PDRM decision flow — Module 3 (Authority Approval)
 *
 * Walks the happy path: PDRM officer signs in, opens an assigned event,
 * records an approval proposal, and verifies the event remains pending final
 * admin review.
 *
 * Tagged @M3 so the full M3 suite can be run with:
 *   npx playwright test --grep "@M3"
 */
import { test, expect, EVENTS } from './fixtures';
import { resetFoodFair } from './admin-reset';

test.describe('@M3 PDRM decision flow', () => {
  // Reset evt-002 to clean UnderReview state in case other specs
  // (aggregate, control-verification) mutated it.
  test.beforeEach(async () => {
    await resetFoodFair();
  });

  test('PDRM approves an assigned event', async ({ page, api, loginAs }) => {
    // Global setup (tests/m3/global-setup.ts) has already reset evt-002 to
    // a clean UnderReview state with a mock resource doc written.
    await loginAs('pdrmKl');
    const pdrmUid = await api.currentUid();
    expect(pdrmUid).toBeTruthy();

    // Sanity: the event requires PDRM and is in a state we can act on.
    const eventBefore = await api.getDoc(`events/${EVENTS.foodFair}`);
    expect(eventBefore).toBeTruthy();
    expect(eventBefore!.requiredAuthorities).toContain('PDRM');
    expect(['Pending', 'UnderReview']).toContain(eventBefore!.status);

    // Act: navigate to the event review page.
    await page.goto(`/authority/events/${EVENTS.foodFair}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /your decision/i })).toBeVisible();

    // Fill the rationale and submit an approval proposal.
    const rationale = 'PDRM E2E test — crowd ingress plan accepted, traffic management plan acceptable.';
    // Scope to the "Your decision" section (Stage-1 section also has textareas/buttons).
    const decisionSection = page.locator('section', { has: page.getByRole('heading', { name: /your decision/i }) });
    const rationaleTa = decisionSection.getByLabel(/decision rationale/i);
    await rationaleTa.scrollIntoViewIfNeeded();
    await rationaleTa.fill(rationale);
    await expect(rationaleTa).toHaveValue(rationale);

    // FR-M3-16: tick the "I have reviewed" checkbox before Approve.
    await decisionSection.getByTestId('confirmed-review-checkbox').check();

    const approveBtn = decisionSection.getByRole('button', { name: /propose approval/i });
    await approveBtn.scrollIntoViewIfNeeded();
    await expect(approveBtn).toBeEnabled({ timeout: 10_000 });
    await approveBtn.click();

    // Wait for the officer proposal to land in the current-version assignment.
    await expect.poll(async () => {
      const d = await api.getDoc(`events/${EVENTS.foodFair}/assignments/v1_PDRM`);
      return d?.decision === 'Approved' ? true : null;
    }, { timeout: 15_000, intervals: [500, 1_000, 1_500] }).toBe(true);

    // Assert: the proposal is completed, while status remains UnderReview
    // until the admin records the final second-review outcome.
    const assignment = await api.getDoc(`events/${EVENTS.foodFair}/assignments/v1_PDRM`);
    expect(assignment).toBeTruthy();
    expect(assignment!.decision).toBe('Approved');
    expect(assignment!.officerUid).toBe(pdrmUid);
    expect(assignment!.status).toBe('completed');
    expect(assignment!.reason).toBe(rationale);

    const eventAfter = await api.getDoc(`events/${EVENTS.foodFair}`);
    expect(eventAfter!.status).toBe('UnderReview');
    expect(eventAfter!.reviewStage).toBe('authority');
  });
});
