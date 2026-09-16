import { test, expect, PRESENTATION_EVENTS } from './fixtures';

/**
 * The presentation portfolio is an explicitly opt-in production dataset. The
 * default M3 suite stays deterministic and does not touch these records; set
 * STERAS_PRESENTATION_FLOW=true after the guarded seed to run this read-only
 * invariant and surface smoke flow.
 */
test.describe('post-final presentation workflow portfolio', () => {
  test.skip(!process.env.STERAS_PRESENTATION_FLOW, 'Opt in with STERAS_PRESENTATION_FLOW=true after the guarded presentation seed.');

  test('exposes the four documented post-final workflow states without public projections', async ({ page, api, loginAs }) => {
    await loginAs('admin');
    for (const [key, eventId] of Object.entries(PRESENTATION_EVENTS)) {
      const event = await api.getDoc<{
        status?: string;
        reviewStage?: string | null;
        controlListGenerated?: boolean;
        currentAssessmentId?: string;
        currentResourceId?: string;
        requiredAuthorities?: string[];
      }>(`events/${eventId}`);
      expect(event, `${key} event should be seeded`).not.toBeNull();
      expect(event?.requiredAuthorities).toEqual(expect.arrayContaining(['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC']));
      await expect(api.getDoc(`public_events/${eventId}`)).resolves.toBeNull();
      await expect(api.getDoc(`public_event_controls/${eventId}`)).resolves.toBeNull();
      expect(event?.currentAssessmentId).toBeTruthy();
      expect(event?.currentResourceId).toBeTruthy();
    }

    const secondReview = await api.getDoc<{ status?: string; reviewStage?: string | null }>(`events/${PRESENTATION_EVENTS.secondReview}`);
    expect(secondReview).toMatchObject({ status: 'UnderReview', reviewStage: 'second' });
    const secondAssignments = await api.getCollection<{ status?: string; decision?: string }>(`events/${PRESENTATION_EVENTS.secondReview}/assignments`);
    expect(secondAssignments).toHaveLength(5);
    expect(secondAssignments.every((assignment) => assignment.status === 'completed' && Boolean(assignment.decision))).toBe(true);

    const controls = await api.getCollection(`events/${PRESENTATION_EVENTS.documentationReady}/event_controls`);
    const stage1Pending = await api.getCollection<{ status?: string }>(`events/${PRESENTATION_EVENTS.stage1Pending}/event_controls/presentation-selangor-food-festival-crowd-control/stage1_docs`);
    const stage2Pending = await api.getCollection<{ published?: boolean }>(`events/${PRESENTATION_EVENTS.stage2PendingPublication}/event_controls/presentation-johor-waterfront-fair-crowd-control/stage2_docs`);
    expect(controls.length).toBeGreaterThan(0);
    expect(stage1Pending).toHaveLength(2);
    expect(stage1Pending.every((document) => document.status === 'pending_verification')).toBe(true);
    expect(stage2Pending).toHaveLength(1);
    expect(stage2Pending[0]?.published).not.toBe(true);

    await page.goto(`/admin/applications/${PRESENTATION_EVENTS.secondReview}`);
    await expect(page.getByTestId('admin-final-decision')).toBeVisible();
  });
});
