import { test, expect, PRESENTATION_EVENTS } from './fixtures';

/**
 * The presentation portfolio is an explicitly opt-in production dataset. The
 * default M3 suite stays deterministic and does not touch these records; set
 * STERAS_PRESENTATION_FLOW=true after the guarded seed to run this read-only
 * invariant and surface smoke flow.
 */
test.describe('post-final presentation workflow portfolio', () => {
  test.skip(!process.env.STERAS_PRESENTATION_FLOW, 'Opt in with STERAS_PRESENTATION_FLOW=true after the guarded presentation seed.');

  test('exposes post-final workflow states without leaking pending evidence', async ({ page, api, loginAs }) => {
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
      const publicEvent = await api.getDoc<{ versionId?: string; publicStatus?: string }>(`public_events/${eventId}`);
      if (event?.status === 'Approved') expect(publicEvent).toMatchObject({ versionId: 'v1', publicStatus: 'approved' });
      else expect(publicEvent).toBeNull();
      expect(event?.currentAssessmentId).toBeTruthy();
      expect(event?.currentResourceId).toBeTruthy();
    }

    const secondReview = await api.getDoc<{ status?: string; reviewStage?: string | null }>(`events/${PRESENTATION_EVENTS.secondReview}`);
    expect(secondReview).toMatchObject({ status: 'UnderReview', reviewStage: 'second' });
    const secondAssignments = await api.getCollection<{ status?: string; decision?: string }>(`events/${PRESENTATION_EVENTS.secondReview}/assignments`);
    expect(secondAssignments).toHaveLength(5);
    expect(secondAssignments.every((assignment) => assignment.status === 'completed' && Boolean(assignment.decision))).toBe(true);

    const controls = await api.getCollection(`events/${PRESENTATION_EVENTS.documentationReady}/event_controls`);
    const stage1Controls = await api.getCollection(`events/${PRESENTATION_EVENTS.stage1Pending}/event_controls`);
    const stage2Controls = await api.getCollection(`events/${PRESENTATION_EVENTS.stage2PendingPublication}/event_controls`);
    const stage1Pending = await api.getCollection<{ status?: string }>(`events/${PRESENTATION_EVENTS.stage1Pending}/event_controls/${stage1Controls[0].id}/stage1_docs`);
    const stage2Pending = await api.getCollection<{ published?: boolean }>(`events/${PRESENTATION_EVENTS.stage2PendingPublication}/event_controls/${stage2Controls[0].id}/stage2_docs`);
    expect(controls.length).toBeGreaterThan(0);
    expect(stage1Pending).toHaveLength(2);
    expect(stage1Pending.every((document) => document.status === 'pending_verification')).toBe(true);
    expect(stage2Pending).toHaveLength(1);
    expect(stage2Pending[0]?.published).not.toBe(true);
    for (const eventId of [PRESENTATION_EVENTS.documentationReady, PRESENTATION_EVENTS.stage1Pending, PRESENTATION_EVENTS.stage2PendingPublication]) {
      expect(await api.getCollection(`public_event_controls/${eventId}/items`)).toHaveLength(0);
      expect(await api.getCollection(`public_event_controls/${eventId}/stage1_documents`)).toHaveLength(0);
    }

    await page.goto(`/admin/applications/${PRESENTATION_EVENTS.secondReview}`);
    await expect(page.getByTestId('admin-final-decision')).toBeVisible();
  });
});
