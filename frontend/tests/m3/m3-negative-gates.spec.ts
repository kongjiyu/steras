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
  test('compliance-blocked: Approve is rejected by Cloud Function', async ({ page, api, loginAs }) => {
    await loginAs('pdrm');
    await page.goto(`/authority/events/evt-compliance-blocked`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /your decision/i })).toBeVisible();
    const rationaleTa = page.getByLabel(/decision rationale/i);
    await rationaleTa.scrollIntoViewIfNeeded();
    await rationaleTa.fill('Test rationale for blocked compliance scenario — should be rejected by the Cloud Function.');
    const approveBtn = page.getByRole('button', { name: /^approve$/i });
    await approveBtn.scrollIntoViewIfNeeded();
    await expect(approveBtn).toBeEnabled({ timeout: 10_000 });
    await approveBtn.click();
    // Expect a failure toast from the Cloud Function
    await expect(page.getByText(/compliance status is "blocked"/i)).toBeVisible({ timeout: 10_000 });
    // And no decision was written
    const dec = await api.getDoc(`events/evt-compliance-blocked/decisions/v1_PDRM`);
    expect(dec).toBeNull();
  });

  test('provisional-readiness: short rationale is rejected by Cloud Function', async ({ page, loginAs }) => {
    await loginAs('bomba');
    await page.goto(`/authority/events/evt-provisional-readiness`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /your decision/i })).toBeVisible();
    const rationaleTa = page.getByLabel(/decision rationale/i);
    await rationaleTa.scrollIntoViewIfNeeded();
    // 30 chars — passes the 10-char baseline but fails the 80-char provisional gate
    rationaleTa.fill('Short rationale that fails.');
    const approveBtn = page.getByRole('button', { name: /^approve$/i });
    await approveBtn.scrollIntoViewIfNeeded();
    await expect(approveBtn).toBeEnabled({ timeout: 10_000 });
    await approveBtn.click();
    await expect(page.getByText(/assessment is provisional/i)).toBeVisible({ timeout: 10_000 });
  });

  test('provisional-readiness: ≥80 char rationale is accepted', async ({ page, api, loginAs }) => {
    await loginAs('bomba');
    await page.goto(`/authority/events/evt-provisional-readiness`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /your decision/i })).toBeVisible();
    const rationaleTa = page.getByLabel(/decision rationale/i);
    await rationaleTa.scrollIntoViewIfNeeded();
    rationaleTa.fill(
      'Bomba approval: provisional M2 readiness acknowledged. ' +
      'KKM mass-gathering guideline and venue fire cert verified on site. ' +
      'No outstanding safety concerns. The provisional status is acceptable for this event size and risk profile.',
    );
    const approveBtn = page.getByRole('button', { name: /^approve$/i });
    await approveBtn.scrollIntoViewIfNeeded();
    await expect(approveBtn).toBeEnabled({ timeout: 10_000 });
    await approveBtn.click();
    await expect.poll(async () => {
      const d = await api.getDoc(`events/evt-provisional-readiness/decisions/v1_BOMBA`);
      return d?.decision === 'Approved' ? true : null;
    }, { timeout: 15_000, intervals: [500, 1_000, 1_500] }).toBe(true);
  });

  test('non-assigned authority cannot act on an event that does not require them', async ({ page, api, loginAs }) => {
    // evt-002 requires [PDRM, BOMBA, KKM, DBKL]. KKM is assigned.
    // Sign in as a different authority... but our seed only has PDRM, BOMBA,
    // KKM, DBKL. To exercise the "non-assigned" branch, we need an event
    // that requires only a subset. We can use evt-003 (engine schema,
    // requires PDRM, BOMBA, KKM) and sign in as DBKL (not assigned).
    await loginAs('dbkl');
    await page.goto(`/authority/events/${EVENTS.mountainRun}`, { waitUntil: 'domcontentloaded' });
    // Page may render but the decision form should be disabled or the
    // Cloud Function will reject. Fill and try to submit.
    await expect(page.getByRole('heading', { name: /your decision/i })).toBeVisible();
    const rationaleTa = page.getByLabel(/decision rationale/i);
    await rationaleTa.scrollIntoViewIfNeeded();
    rationaleTa.fill('DBKL attempting to act on an event it is not assigned to — should be rejected.');
    const approveBtn = page.getByRole('button', { name: /^approve$/i });
    await approveBtn.scrollIntoViewIfNeeded();
    if (await approveBtn.isEnabled({ timeout: 5_000 }).catch(() => false)) {
      await approveBtn.click();
      // Expect a failure toast from the Cloud Function (permission-denied)
      await expect(page.getByText(/not assigned|permission/i)).toBeVisible({ timeout: 10_000 });
    }
    // No decision recorded
    const dec = await api.getDoc(`events/${EVENTS.mountainRun}/decisions/v1_DBKL`);
    expect(dec).toBeNull();
  });
});
