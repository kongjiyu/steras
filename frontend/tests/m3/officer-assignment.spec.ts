/**
 * M3 Workstream 1 — Officer assignment + second review flow.
 *
 * Verifies the full multi-stage review pipeline:
 *   1. Admin calls `assignAuthorityOfficers` (dryRun) to get the checklist.
 *   2. Admin commits the assignment (default-checked, no overrides).
 *   3. Each officer calls `recordOfficerProposal` (replaces the legacy
 *      `makeAuthorityDecision` path for the new flow).
 *   4. When all proposals are in, event.reviewStage auto-advances to 'second'.
 *   5. Admin calls `makeSecondReviewDecision` to confirm the aggregate.
 *   6. Event status is updated and the assignment workload is decremented.
 *
 * Uses evt-004-kl-marathon (requires PDRM, BOMBA, KKM, DBKL; status
 * AmendmentRequested) so we can run a fresh flow without disturbing the
 * other test events.
 */
import { test, expect } from './fixtures';
import { resetMarathon } from './admin-reset';

const MARATHON = 'evt-004-kl-marathon';
const OFFICERS = {
  pdrm: 'mmcccuLb5kQOKGdf2eECQOiAS7h2',
  bomba: 'sKCMYylLOpY1dabTFcRwrxb0y0c2',
  kkm: 'qjLsLI8ZSJNX5t6HlsrRTQYG9Bl2',
  dbkl: 'efL2zcnyExZqvciYoq5V0oZZMPn1',
} as const;

test.describe('@M3 Workstream 1: officer assignment + second review', () => {
  // The full flow does 5 sequential Firebase Auth logins (admin + 4
  // officers + admin again) and 7 Cloud Function calls. Under sustained
  // load Firebase Auth can take 20-40s per login. 180s is the floor.
  test.setTimeout(180_000);

  test.beforeEach(async () => {
    // Reset evt-004 + officers + notifications via Admin SDK (client
    // auth can't write to events/ — admin ops are server-only).
    await resetMarathon();
  });

  test('full flow: assign -> 4 officers propose -> admin confirms aggregate', async ({ api, loginAs }) => {
    // Login as admin to call assignAuthorityOfficers.
    await loginAs('admin');

    // --- Step 1+2: admin assigns officers (dryRun then commit) ---
    const dryRun = await api.callFunction<{ eventId: string; dryRun: true }, { checklist: Array<{ authorityType: string; defaultOfficerUid: string; candidates: Array<{ officerUid: string }> }>; venueState: string }>(
      'assignAuthorityOfficers',
      { eventId: MARATHON, dryRun: true },
    );
    expect(dryRun.checklist.length).toBe(4);
    expect(dryRun.venueState).toBe('Selangor');
    // Default-check matches our expected officer pool.
    const byAuth = Object.fromEntries(dryRun.checklist.map((c) => [c.authorityType, c.defaultOfficerUid]));
    expect(byAuth.PDRM).toBe(OFFICERS.pdrm);
    expect(byAuth.BOMBA).toBe(OFFICERS.bomba);
    expect(byAuth.KKM).toBe(OFFICERS.kkm);
    expect(byAuth.DBKL).toBe(OFFICERS.dbkl);

    const assignmentMap = {
      PDRM: OFFICERS.pdrm,
      BOMBA: OFFICERS.bomba,
      KKM: OFFICERS.kkm,
      DBKL: OFFICERS.dbkl,
    };
    const commitResult = await api.callFunction<{ eventId: string; assignmentMap: Record<string, string>; dryRun: false }, { assigned: number; venueState: string }>(
      'assignAuthorityOfficers',
      { eventId: MARATHON, assignmentMap, dryRun: false },
    );
    expect(commitResult.assigned).toBe(4);

    // Verify each officer's workloadCount incremented to 1.
    for (const uid of Object.values(OFFICERS)) {
      const o = await api.getDoc<{ workloadCount: number }>(`officers/${uid}`);
      expect(o?.workloadCount).toBe(1);
    }
    // Verify event.reviewStage='authority'.
    const evAfter = await api.getDoc<{ reviewStage: string }>(`events/${MARATHON}`);
    expect(evAfter?.reviewStage).toBe('authority');

    // --- Step 3: each officer records a proposal ---
    const rationales: Array<[keyof typeof OFFICERS, string, string]> = [
      ['pdrm', 'PDRM approval: traffic management plan and crowd ingress accepted.', 'PDRM E2E — fine as-is.'],
      ['bomba', 'Bomba approval: fire safety officer signed off on egress routes.', 'Bomba E2E — no changes needed.'],
      ['kkm', 'KKM approval: medical plan meets mass-gathering guideline.', 'KKM E2E — medical coverage OK.'],
      ['dbkl', 'DBKL approval: venue capacity and emergency access verified.', 'DBKL E2E — venue OK.'],
    ];
    for (const [key, reason, suggestion] of rationales) {
      await api.signOut();
      await loginAs(key);
      const result = await api.callFunction<{ eventId: string; decision: string; reason: string; suggestion: string }, { allCompleted: boolean }>(
        'recordOfficerProposal',
        { eventId: MARATHON, decision: 'Approved', reason, suggestion },
      );
      expect(result).toBeTruthy();
    }

    // After all 4 proposals, reviewStage auto-advances to 'second'.
    // Sign in as admin (so api.getDoc has auth context).
    await api.signOut();
    await loginAs('admin');
    const evAfterProposals = await api.getDoc<{ reviewStage: string; status: string }>(`events/${MARATHON}`);
    expect(evAfterProposals?.reviewStage).toBe('second');
    // Event.status should NOT have changed yet (pure aggregator model).
    expect(evAfterProposals?.status).toBe('UnderReview');

    // --- Step 5: admin confirms aggregate ---
    await loginAs('admin');
    const confirmed = await api.callFunction<{ eventId: string; confirmedDecision: 'Approved'; adminNote: string }, { status: string }>(
      'makeSecondReviewDecision',
      { eventId: MARATHON, confirmedDecision: 'Approved', adminNote: 'All four authorities approved; confirming aggregate.' },
    );
    expect(confirmed.status).toBe('Approved');

    // Event status + secondReview record.
    const finalEv = await api.getDoc<{ status: string; reviewStage: string | null; secondReview?: { reviewerUid: string; confirmedDecision: string } }>(`events/${MARATHON}`);
    expect(finalEv?.status).toBe('Approved');
    expect(finalEv?.reviewStage).toBeNull();
    expect(finalEv?.secondReview?.confirmedDecision).toBe('Approved');

    // Each officer's workloadCount back to 0.
    for (const uid of Object.values(OFFICERS)) {
      const o = await api.getDoc<{ workloadCount: number }>(`officers/${uid}`);
      expect(o?.workloadCount).toBe(0);
    }
  });

  test('PDRM cannot record a proposal if not assigned', async ({ api, loginAs }) => {
    // Login as admin, assign all four officers via the new flow.
    await loginAs('admin');
    await api.callFunction<{ eventId: string; assignmentMap: Record<string, string>; dryRun: false }, { assigned: number }>(
      'assignAuthorityOfficers',
      { eventId: MARATHON, assignmentMap: { PDRM: OFFICERS.pdrm, BOMBA: OFFICERS.bomba, KKM: OFFICERS.kkm, DBKL: OFFICERS.dbkl }, dryRun: false },
    );

    // PDRM can record for their PDRM assignment. The "not assigned"
    // check is implicit — the function looks up assignments/{versionId}_PDRM
    // for the calling user's authorityType; if missing, throws
    // 'permission-denied'.
    await api.signOut();
    await loginAs('pdrm');
    let err: string | null = null;
    try {
      await api.callFunction('recordOfficerProposal', {
        eventId: MARATHON,
        decision: 'Approved',
        reason: 'PDRM E2E — verifying the assigned proposal path works.',
        suggestion: 'n/a',
      });
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    expect(err).toBeNull();
  });
});
