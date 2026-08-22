/**
 * M3 Workstream 1 polish — unassign / backup officer swap.
 *
 * `unassignAuthorityOfficers` reverses an assignment. Use cases:
 *   - A15 backup officer swap (admin picked the wrong officer and
 *     wants to re-pick BEFORE the officer has recorded anything)
 *   - Admin double-clicked Assign and wants to start over
 *
 * Refuses if any targeted assignment is `completed` (a proposal has
 * been recorded). Once data is in, the admin must go through the
 * second review to close out the work.
 *
 * Three cases:
 *   1. Single authority: assign all 4 → unassign PDRM only → 3
 *      remaining, PDRM revoked, workload decremented for PDRM only.
 *   2. All: assign all 4 → unassign all → all revoked, all workload
 *      back to 0, event.reviewStage reset to null.
 *   3. Refusal after proposal: assign → 1 records → unassign →
 *      HttpsError `failed-precondition` and no changes.
 */
import { test, expect, EVENTS } from './fixtures';
import { dedicatedOfficerUids, resetMarathon } from './admin-reset';

const MARATHON = EVENTS.marathon;
let OFFICERS: Awaited<ReturnType<typeof dedicatedOfficerUids>>;
const allAssigned = () => ({ PDRM: OFFICERS.pdrm, BOMBA: OFFICERS.bomba, KKM: OFFICERS.kkm, DBKL: OFFICERS.dbkl });

test.describe('@M3 unassign / backup officer swap', () => {
  test.setTimeout(60_000);

  test.beforeEach(async () => {
    await resetMarathon();
    OFFICERS = await dedicatedOfficerUids();
  });

  // Helper — read the event's actual currentVersionId (evt-004 is
  // seeded as v2, not v1) so the assignment paths match the function's
  // writes. Falls back to 'v1' if the field is unexpectedly missing.
  async function readVersionId(api: { getDoc: <T = Record<string, unknown>>(path: string) => Promise<T | null> }): Promise<string> {
    const ev = await api.getDoc<{ currentVersionId?: string }>(`events/${MARATHON}`);
    return ev?.currentVersionId ?? 'v1';
  }

  test('unassign a single authority: others stay, workload decrements only for the one revoked', async ({ api, loginAs }) => {
    await loginAs('admin');
    await api.callFunction(
      'assignAuthorityOfficers',
      { eventId: MARATHON, assignmentMap: allAssigned(), dryRun: false },
    );

    const versionId = await readVersionId(api);

    // Unassign PDRM only.
    const result = await api.callFunction<{ eventId: string; authorityType: 'PDRM' }, { revoked: number; reviewStageReset: boolean }>(
      'unassignAuthorityOfficers',
      { eventId: MARATHON, authorityType: 'PDRM' },
    );
    expect(result.revoked).toBe(1);
    expect(result.reviewStageReset).toBe(false);

    // PDRM assignment: revoked, has revokedAt + revokedBy.
    const pdrmAssignment = await api.getDoc<{ status: string; revokedAt?: number; revokedBy?: string }>(`events/${MARATHON}/assignments/${versionId}_PDRM`);
    expect(pdrmAssignment?.status).toBe('revoked');
    expect(pdrmAssignment?.revokedAt).toBeGreaterThan(0);
    expect(pdrmAssignment?.revokedBy).toBeTruthy();

    // The other 3 are still pending.
    for (const auth of ['BOMBA', 'KKM', 'DBKL'] as const) {
      const a = await api.getDoc<{ status: string }>(`events/${MARATHON}/assignments/${versionId}_${auth}`);
      expect(a?.status).toBe('pending');
    }

    // PDRM workload back to 0; the other 3 stay at 1.
    for (const [auth, uid] of Object.entries(OFFICERS)) {
      const o = await api.getDoc<{ workloadCount: number }>(`officers/${uid}`);
      expect(o?.workloadCount).toBe(auth === 'pdrm' || auth === 'motac' ? 0 : 1);
    }

    // Event reviewStage stays at 'authority' (still has active assignments).
    const ev = await api.getDoc<{ reviewStage: string }>(`events/${MARATHON}`);
    expect(ev?.reviewStage).toBe('authority');

    // An `assignment_revoked` audit log is written.
    const audits = await api.getCollection<{ action: string; metadata: { authorityType: string; officerUid: string } }>(
      `events/${MARATHON}/audit_logs`,
    );
    const revokedLogs = audits.filter((a) => a.action === 'assignment_revoked');
    expect(revokedLogs.length).toBe(1);
    expect(revokedLogs[0].metadata.authorityType).toBe('PDRM');
    expect(revokedLogs[0].metadata.officerUid).toBe(OFFICERS.pdrm);
  });

  test('unassign all: every assignment revoked, every workload decremented, event.reviewStage reset to null', async ({ api, loginAs }) => {
    await loginAs('admin');
    await api.callFunction(
      'assignAuthorityOfficers',
      { eventId: MARATHON, assignmentMap: allAssigned(), dryRun: false },
    );

    const versionId = await readVersionId(api);

    // Unassign all (no authorityType filter).
    const result = await api.callFunction<{ eventId: string }, { revoked: number; reviewStageReset: boolean }>(
      'unassignAuthorityOfficers',
      { eventId: MARATHON },
    );
    expect(result.revoked).toBe(4);
    expect(result.reviewStageReset).toBe(true);

    // All assignments revoked.
    for (const auth of ['PDRM', 'BOMBA', 'KKM', 'DBKL'] as const) {
      const a = await api.getDoc<{ status: string }>(`events/${MARATHON}/assignments/${versionId}_${auth}`);
      expect(a?.status).toBe('revoked');
    }

    // All officers back to workload 0.
    for (const uid of Object.values(OFFICERS)) {
      const o = await api.getDoc<{ workloadCount: number }>(`officers/${uid}`);
      expect(o?.workloadCount).toBe(0);
    }

    // Event reviewStage reset to null (back to pre-assignment state).
    const ev = await api.getDoc<{ reviewStage: string | null }>(`events/${MARATHON}`);
    expect(ev?.reviewStage).toBeNull();

    // 4 `assignment_revoked` audit logs.
    const audits = await api.getCollection<{ action: string; metadata: { authorityType: string } }>(
      `events/${MARATHON}/audit_logs`,
    );
    const revokedLogs = audits.filter((a) => a.action === 'assignment_revoked');
    expect(revokedLogs.length).toBe(4);
  });

  test('refuses to unassign once a proposal has been recorded (data is significant)', async ({ api, loginAs }) => {
    await loginAs('admin');
    await api.callFunction(
      'assignAuthorityOfficers',
      { eventId: MARATHON, assignmentMap: allAssigned(), dryRun: false },
    );

    const versionId = await readVersionId(api);

    // PDRM records a proposal.
    await api.signOut();
    await loginAs('pdrm');
    await api.callFunction('recordOfficerProposal', {
      eventId: MARATHON,
      decision: 'Approved',
      reason: 'PDRM E2E — recorded before the unassign attempt.',
      suggestion: 'PDRM E2E — fine as-is.',
      confirmedReview: true,
    });

    // Admin tries to unassign PDRM — should fail.
    await api.signOut();
    await loginAs('admin');
    let err: string | null = null;
    try {
      await api.callFunction('unassignAuthorityOfficers', { eventId: MARATHON, authorityType: 'PDRM' });
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    expect(err).toMatch(/already recorded a proposal|failed-precondition/i);

    // PDRM's assignment is still 'completed', not 'revoked'.
    const pdrmAssignment = await api.getDoc<{ status: string }>(`events/${MARATHON}/assignments/${versionId}_PDRM`);
    expect(pdrmAssignment?.status).toBe('completed');

    // PDRM workload unchanged (still 1).
    const pdrmOfficer = await api.getDoc<{ workloadCount: number }>(`officers/${OFFICERS.pdrm}`);
    expect(pdrmOfficer?.workloadCount).toBe(1);
  });
});
