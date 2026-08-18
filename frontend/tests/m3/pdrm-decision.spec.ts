/**
 * PDRM decision flow — Module 3 (Authority Approval)
 *
 * Walks the happy path: PDRM officer signs in, opens an assigned event,
 * records an Approve decision, and verifies the aggregate status updates.
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
    await loginAs('pdrm');
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

    // Fill the rationale and submit Approve.
    const rationale = 'PDRM E2E test — crowd ingress plan accepted, traffic management plan acceptable.';
    // Scope to the "Your decision" section (Stage-1 section also has textareas/buttons).
    const decisionSection = page.locator('section', { has: page.getByRole('heading', { name: /your decision/i }) });
    const rationaleTa = decisionSection.getByLabel(/decision rationale/i);
    await rationaleTa.scrollIntoViewIfNeeded();
    await rationaleTa.fill(rationale);
    await expect(rationaleTa).toHaveValue(rationale);

    // FR-M3-16: tick the "I have reviewed" checkbox before Approve.
    await decisionSection.getByTestId('confirmed-review-checkbox').check();

    const approveBtn = decisionSection.getByRole('button', { name: /^approve$/i });
    await approveBtn.scrollIntoViewIfNeeded();
    await expect(approveBtn).toBeEnabled({ timeout: 10_000 });
    await approveBtn.click();

    // Wait for the decision to land in Firestore
    await expect.poll(async () => {
      const d = await api.getDoc(`events/${EVENTS.foodFair}/decisions/v1_PDRM`);
      return d?.decision === 'Approved' ? true : null;
    }, { timeout: 15_000, intervals: [500, 1_000, 1_500] }).toBe(true);

    // Assert: Firestore reflects the decision + status moved to UnderReview
    // (only PDRM has approved; other required authorities still pending).
    const decision = await api.getDoc(`events/${EVENTS.foodFair}/decisions/v1_PDRM`);
    expect(decision).toBeTruthy();
    expect(decision!.decision).toBe('Approved');
    expect(decision!.reviewerId).toBe(pdrmUid);
    expect(decision!.current).toBe(true);
    expect(decision!.rationale).toBe(rationale);

    const eventAfter = await api.getDoc(`events/${EVENTS.foodFair}`);
    expect(eventAfter!.status).toBe('UnderReview');
  });
});
