/**
 * M3 verified-control workflow (FR-M3-22, FR-M3-23, FR-M3-24, Q1 refactor)
 * + durable in-app notifications (FR-M3-08, handoff item 7)
 *
 *   control-verification.spec.ts: officer verifies a Stage-1 document
 *     via the verifyStage1Doc Cloud Function. The function writes
 *     status/verifiedBy/verifiedAt/rejectionReason to the
 *     event_controls/{id}/stage1_docs/{id} doc and updates the parent
 *     control's aggregate label.
 *   notifications.spec.ts: after a decision, the organiser gets a
 *     notification in the notifications collection.
 */
import { test, expect, EVENTS } from './fixtures';
import { resetFoodFair } from './admin-reset';

test.describe('@M3 verified-control workflow', () => {
  test('KKM cannot verify a control on an event that does not require KKM', async ({ api, loginAs }) => {
    // evt-provisional-readiness requires [PDRM, BOMBA]. KKM is not
    // assigned — should be rejected with a permission error.
    await loginAs('kkm');
    let callError: string | null = null;
    try {
      await api.callFunction('verifyStage1Doc', {
        eventId: 'evt-provisional-readiness',
        controlId: 'evt-provisional-readiness-ctrl-pdrm',
        docId: 'evt-provisional-readiness-ctrl-pdrm-s1-application',
        status: 'verified',
        rationale: 'KKM should not be allowed to verify on this event.',
      });
    } catch (err) {
      callError = err instanceof Error ? err.message : String(err);
    }
    expect(callError).toMatch(/not assigned|permission/i);
  });

  test('PDRM verifies a declared Stage-1 document', async ({ api, loginAs }) => {
    await loginAs('pdrm');
    const eventId = 'evt-control-verification';
    const controlId = `${eventId}-ctrl-pdrm`;
    const docId = `${controlId}-s1-application`;
    const result = await api.callFunction<{ eventId: string; controlId: string; docId: string; status: 'verified' | 'rejected' }, { status: 'verified' | 'rejected' }>(
      'verifyStage1Doc',
      {
        eventId,
        controlId,
        docId,
        status: 'verified',
        rationale: 'E2E — uploaded evacuation plan reviewed and approved by PDRM. All egress routes confirmed.',
      },
    );
    expect(result.status).toBe('verified');
  });
});

test.describe('@M3 organiser notifications', () => {
  // Other specs in the same suite (e.g. m3-aggregate) leave evt-002 in
  // Approved/Rejected state. Reset to a clean UnderReview before each
  // notifications test so they can run in any order.
  test.beforeEach(async () => {
    await resetFoodFair();
  });

  test('organiser receives a notification after the event is Approved', async ({ api, loginAs }) => {
    const eventId = EVENTS.foodFair;
    const rationales: Array<[string, string]> = [
      ['pdrm', 'PDRM approval: traffic management plan and crowd ingress accepted.'],
      ['bomba', 'Bomba approval: fire safety officer signed off on egress routes.'],
      ['kkm', 'KKM approval: medical plan meets mass-gathering guideline.'],
      ['dbkl', 'DBKL approval: venue capacity and emergency access verified.'],
    ];
    for (const [key, rationale] of rationales) {
      await api.signOut();
      await loginAs(key as 'pdrm' | 'bomba' | 'kkm' | 'dbkl');
      await api.callFunction('makeAuthorityDecision', { eventId, decision: 'Approved', rationale });
    }

    await api.signOut();
    await loginAs('organizer');
    const result = await api.callFunction<{ limit?: number }, { items: Array<{ notificationId: string; type: string; eventId: string; read: boolean }>; unread: number }>(
      'listMyNotifications',
      { limit: 50 },
    );
    const myNotifs = result.items.filter((n) => n.eventId === eventId);
    expect(myNotifs.length).toBeGreaterThanOrEqual(1);
    expect(myNotifs.some((n) => n.type === 'application_approved')).toBe(true);
  });

  test('markNotificationRead toggles read state', async ({ api, loginAs }) => {
    await loginAs('organizer');
    const result = await api.callFunction<{ limit?: number }, { items: Array<{ notificationId: string; read: boolean }>; unread: number }>(
      'listMyNotifications',
      { limit: 1 },
    );
    if (result.items.length === 0) {
      test.skip(true, 'No notifications to test with — previous test left none.');
      return;
    }
    const notifId = result.items[0].notificationId;
    const updateResult = await api.callFunction<{ notificationId: string; read?: boolean }, { ok: boolean; idempotent: boolean }>(
      'markNotificationRead',
      { notificationId: notifId, read: true },
    );
    expect(updateResult.ok).toBe(true);
    const after = await api.callFunction<{ limit?: number }, { items: Array<{ notificationId: string; read: boolean }>; unread: number }>(
      'listMyNotifications',
      { limit: 50 },
    );
    const afterNotif = after.items.find((n) => n.notificationId === notifId);
    expect(afterNotif?.read).toBe(true);
  });
});
