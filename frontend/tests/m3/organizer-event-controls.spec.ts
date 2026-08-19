/**
 * M3 Workstream 2 — organizer read-only view of the event control list
 * (UC-34: "Display Stage 1 and Stage 2 Requirements").
 *
 *   - When the admin has generated + committed the control list, the
 *     organizer sees the per-authority cards with controlName,
 *     authority badge, Stage 1 requirements count, and Stage 2 label.
 *   - When the admin hasn't generated it yet, the organizer sees an
 *     "empty state" message pointing them to the admin.
 *
 *   No mutations. The organizer upload (UC-28) is Workstream 3.
 */
import { test, expect } from './fixtures';
import { resetApprovedEvent } from './admin-reset';

const APPROVED = 'evt-001-kl-music-festival';

test.describe('@M3 Workstream 2: organizer reads the control list', () => {
  test.beforeEach(async () => {
    await resetApprovedEvent();
  });

  test('organizer sees the read-only list when generated, empty state when not', async ({ page, api, loginAs }) => {
    // Step 1: empty state. controlListGenerated = false (from beforeEach).
    await loginAs('organizer');
    await page.goto(`/organizer/events/${APPROVED}/controls`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/admin hasn't published/i)).toBeVisible();
    // The committed list section is absent (no "List published" badge in the header).
    await expect(page.getByText(/^List published$/i)).toHaveCount(0);

    // Step 2: admin generates + commits.
    await api.signOut();
    await loginAs('admin');
    const gen = await api.callFunction<{ eventId: string }, { items: Array<{ controlName: string; authority: string; stageRequirement: 'stage1_only' | 'stage1_and_stage2'; stage1Requirements: Array<{ docType: 'application' | 'license' | 'insurance' | 'receipt' | 'floor_plan' | 'other'; label: string; required: boolean }>; stage2Requirement: { kind: 'image'; label: string } | null }> }>(
      'generateEventControlList',
      { eventId: APPROVED },
    );
    expect(gen.items.length).toBeGreaterThan(0);
    await api.callFunction('editEventControlList', { eventId: APPROVED, items: gen.items });

    // Step 3: organizer reloads and sees the cards.
    await api.signOut();
    await loginAs('organizer');
    await page.goto(`/organizer/events/${APPROVED}/controls`, { waitUntil: 'domcontentloaded' });
    // One card per required authority.
    const cards = page.locator('[data-testid^="organizer-control-"]');
    await expect(cards).toHaveCount(5);
    // The header badge is now "List published".
    await expect(page.getByText(/^List published$/i)).toBeVisible();
    // Spot-check the PDRM card. Post-Workstream 3, the per-control
    // card now lists the Stage 1 requirements as individual rows
    // (with Upload / Use Previous buttons) and a Stage 2 placeholder
    // at the bottom.
    const pdrmCard = page.locator('[data-testid="organizer-control-PDRM"]');
    await expect(pdrmCard).toBeVisible();
    // The Stage 2 row is at the bottom of the card (Workstream 4:
    // editable — "Stage 2" badge + label + Upload/Replace buttons).
    await expect(pdrmCard.locator('[data-testid="organizer-stage2-PDRM"]')).toContainText('Photo of PDRM officers on-site at venue');
    // At least one Stage 1 requirement row (the stub ships 3 for PDRM).
    const pdrmRows = pdrmCard.locator('[data-testid^="stage1-row-"]');
    await expect(pdrmRows.first()).toBeVisible();
  });
});
