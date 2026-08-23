import { AuthorityDecision, AuthorityType, DecisionValue } from '@shared/types';
import { EVENT_IDS, USER_IDS, daysAgo, hoursAgo } from './ids';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
const decisionId = (versionId: string, authorityType: AuthorityType): string =>
  `${versionId}_${authorityType}`;

const historyId = (decisionIdStr: string, timestamp: number): string =>
  `${decisionIdStr}_${timestamp}`;

interface DecisionRecord {
  current: AuthorityDecision;
  history: AuthorityDecision[];
}

const mkDecision = (overrides: {
  eventId: string;
  versionId: string;
  authorityType: AuthorityType;
  decision: DecisionValue;
  rationale: string;
  reviewerId: string;
  decidedAt: number;
  current?: boolean;
}): AuthorityDecision => ({
  decisionId: decisionId(overrides.versionId, overrides.authorityType),
  eventId: overrides.eventId,
  versionId: overrides.versionId,
  authorityType: overrides.authorityType,
  decision: overrides.decision,
  rationale: overrides.rationale,
  reviewerId: overrides.reviewerId,
  decidedAt: overrides.decidedAt,
  current: overrides.current ?? true,
});

// ---------------------------------------------------------------------------
// Per-event decisions
// ---------------------------------------------------------------------------
const decisionsByEvent: Record<string, DecisionRecord[]> = {
  // E001 - Approved (all 5 required approved)
  [EVENT_IDS.E001]: [
    { current: mkDecision({ eventId: EVENT_IDS.E001, versionId: 'v1', authorityType: 'PDRM', decision: 'Approved', rationale: 'Crowd management plan verified. Traffic management plan approved by PDRM traffic division. No outstanding concerns.', reviewerId: USER_IDS.U_OFC_PDRM_KL_01, decidedAt: daysAgo(20) }),
      history: [] },
    { current: mkDecision({ eventId: EVENT_IDS.E001, versionId: 'v1', authorityType: 'BOMBA', decision: 'Approved', rationale: 'Fire safety inspection completed on-site. Fire marshal roster confirmed. No temporary high-risk structures.', reviewerId: USER_IDS.U_OFC_BOMBA_KL_01, decidedAt: daysAgo(19) }),
      history: [] },
    { current: mkDecision({ eventId: EVENT_IDS.E001, versionId: 'v1', authorityType: 'KKM', decision: 'Approved', rationale: 'Medical team allocation within KKM mass gathering guideline. Hospital transfer time within 8-minute target.', reviewerId: USER_IDS.U_OFC_KKM_KL_01, decidedAt: daysAgo(18) }),
      history: [] },
    { current: mkDecision({ eventId: EVENT_IDS.E001, versionId: 'v1', authorityType: 'DBKL', decision: 'Approved', rationale: 'Submitted capacity within verified safe capacity envelope. Venue access and sanitation plan acceptable.', reviewerId: USER_IDS.U_OFC_DBKL_KL_01, decidedAt: daysAgo(17) }),
      history: [] },
    { current: mkDecision({ eventId: EVENT_IDS.E001, versionId: 'v1', authorityType: 'MOTAC', decision: 'Approved', rationale: 'Tourism event registration complete. Cultural content aligned with MOTAC visit promotion themes.', reviewerId: USER_IDS.U_OFC_MOTAC_KL_01, decidedAt: daysAgo(16) }),
      history: [] },
  ],

  // E002 - UnderReview (PDRM approved, others pending)
  [EVENT_IDS.E002]: [
    { current: mkDecision({ eventId: EVENT_IDS.E002, versionId: 'v1', authorityType: 'PDRM', decision: 'Approved', rationale: 'Indoor venue, low crowd flow risk. Traffic plan not required for this scale.', reviewerId: USER_IDS.U_OFC_PDRM_SL_01, decidedAt: daysAgo(5) }),
      history: [] },
    { current: mkDecision({ eventId: EVENT_IDS.E002, versionId: 'v1', authorityType: 'BOMBA', decision: 'Approved', rationale: 'Indoor venue with verified fire cert. Cooking demo fire suppression verified.', reviewerId: USER_IDS.U_OFC_BOMBA_SL_01, decidedAt: daysAgo(3) }),
      history: [] },
    { current: mkDecision({ eventId: EVENT_IDS.E002, versionId: 'v1', authorityType: 'KKM', decision: 'Approved', rationale: 'Food sampling protocol acceptable. KKM officer will be on-site. Medical team sufficient.', reviewerId: USER_IDS.U_OFC_KKM_SL_01, decidedAt: daysAgo(1) }),
      history: [] },
  ],

  // E004 - Rejected v1
  [EVENT_IDS.E004]: [
    { current: mkDecision({ eventId: EVENT_IDS.E004, versionId: 'v1', authorityType: 'PDRM', decision: 'Approved', rationale: 'Traffic management plan approved.', reviewerId: USER_IDS.U_OFC_PDRM_KL_01, decidedAt: daysAgo(15), current: false }),
      history: [
        mkDecision({ eventId: EVENT_IDS.E004, versionId: 'v1', authorityType: 'PDRM', decision: 'Approved', rationale: 'Traffic management plan approved.', reviewerId: USER_IDS.U_OFC_PDRM_KL_01, decidedAt: daysAgo(15) }),
      ] },
    { current: mkDecision({ eventId: EVENT_IDS.E004, versionId: 'v1', authorityType: 'BOMBA', decision: 'Rejected', rationale: 'Insufficient medical plan for mass participation event. v1 had only 2 medical teams and 1 ambulance for 25,000 runners. KKM guideline requires minimum 5 teams and 3 ambulances.', reviewerId: USER_IDS.U_OFC_BOMBA_KL_01, decidedAt: daysAgo(12), current: false }),
      history: [
        mkDecision({ eventId: EVENT_IDS.E004, versionId: 'v1', authorityType: 'BOMBA', decision: 'Rejected', rationale: 'Insufficient medical plan for mass participation event. v1 had only 2 medical teams and 1 ambulance for 25,000 runners. KKM guideline requires minimum 5 teams and 3 ambulances.', reviewerId: USER_IDS.U_OFC_BOMBA_KL_01, decidedAt: daysAgo(12) }),
      ] },
    { current: mkDecision({ eventId: EVENT_IDS.E004, versionId: 'v1', authorityType: 'KKM', decision: 'Rejected', rationale: 'Medical staffing plan is insufficient for mass participation. The application cannot proceed in its current form.', reviewerId: USER_IDS.U_OFC_KKM_KL_01, decidedAt: daysAgo(11), current: false }),
      history: [
        mkDecision({ eventId: EVENT_IDS.E004, versionId: 'v1', authorityType: 'KKM', decision: 'Rejected', rationale: 'Medical staffing plan is insufficient for mass participation. The application cannot proceed in its current form.', reviewerId: USER_IDS.U_OFC_KKM_KL_01, decidedAt: daysAgo(11) }),
      ] },
  ],

  // E005 - Rejected
  [EVENT_IDS.E005]: [
    { current: mkDecision({ eventId: EVENT_IDS.E005, versionId: 'v1', authorityType: 'PDRM', decision: 'Approved', rationale: 'Traffic plan acceptable.', reviewerId: USER_IDS.U_OFC_PDRM_SL_01, decidedAt: daysAgo(15) }),
      history: [] },
    { current: mkDecision({ eventId: EVENT_IDS.E005, versionId: 'v1', authorityType: 'BOMBA', decision: 'Rejected', rationale: 'Outdoor venue has no valid fire certificate on file. Without a cert, the fire safety inspection cannot be completed and the event cannot be approved. Suggestion: obtain temporary fire cert from BOMBA Selangor or relocate to a venue with active cert.', reviewerId: USER_IDS.U_OFC_BOMBA_SL_01, decidedAt: daysAgo(13) }),
      history: [] },
    { current: mkDecision({ eventId: EVENT_IDS.E005, versionId: 'v1', authorityType: 'KKM', decision: 'Approved', rationale: 'Medical plan acceptable.', reviewerId: USER_IDS.U_OFC_KKM_SL_01, decidedAt: daysAgo(12) }),
      history: [] },
  ],

  // E006 - Withdrawn
  [EVENT_IDS.E006]: [
    { current: mkDecision({ eventId: EVENT_IDS.E006, versionId: 'v1', authorityType: 'DBKL', decision: 'Approved', rationale: 'Indoor venue, no concerns.', reviewerId: USER_IDS.U_OFC_DBKL_KL_01, decidedAt: daysAgo(48) }),
      history: [] },
  ],

  // E008 - UnderReview, blocked
  [EVENT_IDS.E008]: [
    { current: mkDecision({ eventId: EVENT_IDS.E008, versionId: 'v1', authorityType: 'PDRM', decision: 'Approved', rationale: 'Traffic plan acceptable.', reviewerId: USER_IDS.U_OFC_PDRM_SL_01, decidedAt: daysAgo(3) }),
      history: [] },
  ],

  // E009 - UnderReview, insufficient data
  [EVENT_IDS.E009]: [
    { current: mkDecision({ eventId: EVENT_IDS.E009, versionId: 'v1', authorityType: 'PDRM', decision: 'Approved', rationale: 'Crowd plan acceptable; security plan acceptable.', reviewerId: USER_IDS.U_OFC_PDRM_SL_02, decidedAt: hoursAgo(6) }),
      history: [] },
  ],

  // E010 - UnderReview, multi-version
  [EVENT_IDS.E010]: [
    { current: mkDecision({ eventId: EVENT_IDS.E010, versionId: 'v1', authorityType: 'PDRM', decision: 'Rejected', rationale: 'Crowd flow plan showed all attendees funneled through one entry; evacuation routes inadequate.', reviewerId: USER_IDS.U_OFC_PDRM_KL_01, decidedAt: daysAgo(18), current: false }),
      history: [
        mkDecision({ eventId: EVENT_IDS.E010, versionId: 'v1', authorityType: 'PDRM', decision: 'Rejected', rationale: 'Crowd flow plan showed all attendees funneled through one entry; evacuation routes inadequate.', reviewerId: USER_IDS.U_OFC_PDRM_KL_01, decidedAt: daysAgo(18) }),
      ] },
    { current: mkDecision({ eventId: EVENT_IDS.E010, versionId: 'v1', authorityType: 'BOMBA', decision: 'Approved', rationale: 'Open field; no fire cert issues.', reviewerId: USER_IDS.U_OFC_BOMBA_KL_01, decidedAt: daysAgo(15), current: false }),
      history: [
        mkDecision({ eventId: EVENT_IDS.E010, versionId: 'v1', authorityType: 'BOMBA', decision: 'Approved', rationale: 'Open field; no fire cert issues.', reviewerId: USER_IDS.U_OFC_BOMBA_KL_01, decidedAt: daysAgo(15) }),
      ] },
    { current: mkDecision({ eventId: EVENT_IDS.E010, versionId: 'v1', authorityType: 'DBKL', decision: 'Approved', rationale: 'Sanitation plan acceptable.', reviewerId: USER_IDS.U_OFC_DBKL_KL_01, decidedAt: daysAgo(14), current: false }),
      history: [
        mkDecision({ eventId: EVENT_IDS.E010, versionId: 'v1', authorityType: 'DBKL', decision: 'Approved', rationale: 'Sanitation plan acceptable.', reviewerId: USER_IDS.U_OFC_DBKL_KL_01, decidedAt: daysAgo(14) }),
      ] },
    { current: mkDecision({ eventId: EVENT_IDS.E010, versionId: 'v2', authorityType: 'PDRM', decision: 'Approved', rationale: 'v2 crowd flow plan addresses all prior concerns. Multiple entry points and defined evacuation routes confirmed.', reviewerId: USER_IDS.U_OFC_PDRM_KL_02, decidedAt: daysAgo(1) }),
      history: [] },
  ],

  // E011 - Approved with override
  [EVENT_IDS.E011]: [
    { current: mkDecision({ eventId: EVENT_IDS.E011, versionId: 'v1', authorityType: 'PDRM', decision: 'Approved', rationale: 'Traffic plan acceptable.', reviewerId: USER_IDS.U_OFC_PDRM_KL_01, decidedAt: daysAgo(20) }),
      history: [] },
    { current: mkDecision({ eventId: EVENT_IDS.E011, versionId: 'v1', authorityType: 'BOMBA', decision: 'Approved', rationale: 'Indoor arena with verified fire cert.', reviewerId: USER_IDS.U_OFC_BOMBA_KL_01, decidedAt: daysAgo(18) }),
      history: [] },
    { current: mkDecision({ eventId: EVENT_IDS.E011, versionId: 'v1', authorityType: 'KKM', decision: 'Approved', rationale: 'Medical staffing adequate.', reviewerId: USER_IDS.U_OFC_KKM_KL_01, decidedAt: daysAgo(17) }),
      history: [] },
  ],

  // E012 - UnderReview, high risk
  [EVENT_IDS.E012]: [
    { current: mkDecision({ eventId: EVENT_IDS.E012, versionId: 'v1', authorityType: 'PDRM', decision: 'Approved', rationale: 'Traffic plan comprehensive; road closure plan coordinated with DBKL.', reviewerId: USER_IDS.U_OFC_PDRM_FED_01, decidedAt: daysAgo(5) }),
      history: [] },
  ],

  // E013 - Approved, reported
  [EVENT_IDS.E013]: [
    { current: mkDecision({ eventId: EVENT_IDS.E013, versionId: 'v1', authorityType: 'PDRM', decision: 'Approved', rationale: 'Low-risk community event.', reviewerId: USER_IDS.U_OFC_PDRM_KL_01, decidedAt: daysAgo(45) }),
      history: [] },
    { current: mkDecision({ eventId: EVENT_IDS.E013, versionId: 'v1', authorityType: 'BOMBA', decision: 'Approved', rationale: 'Open field; basic fire safety present.', reviewerId: USER_IDS.U_OFC_BOMBA_KL_01, decidedAt: daysAgo(44) }),
      history: [] },
  ],

  // E014 - Approved, M4 confirmed true
  [EVENT_IDS.E014]: [
    { current: mkDecision({ eventId: EVENT_IDS.E014, versionId: 'v1', authorityType: 'PDRM', decision: 'Approved', rationale: 'Traffic plan approved.', reviewerId: USER_IDS.U_OFC_PDRM_SL_01, decidedAt: daysAgo(80) }),
      history: [] },
    { current: mkDecision({ eventId: EVENT_IDS.E014, versionId: 'v1', authorityType: 'BOMBA', decision: 'Approved', rationale: 'Fire safety verified.', reviewerId: USER_IDS.U_OFC_BOMBA_SL_01, decidedAt: daysAgo(78) }),
      history: [] },
    { current: mkDecision({ eventId: EVENT_IDS.E014, versionId: 'v1', authorityType: 'KKM', decision: 'Approved', rationale: 'Medical team on-site; ambulances positioned.', reviewerId: USER_IDS.U_OFC_KKM_SL_01, decidedAt: daysAgo(76) }),
      history: [] },
  ],

  // E015 - Approved, M4 dismissed
  [EVENT_IDS.E015]: [
    { current: mkDecision({ eventId: EVENT_IDS.E015, versionId: 'v1', authorityType: 'PDRM', decision: 'Approved', rationale: 'Traffic plan approved.', reviewerId: USER_IDS.U_OFC_PDRM_KL_01, decidedAt: daysAgo(78) }),
      history: [] },
    { current: mkDecision({ eventId: EVENT_IDS.E015, versionId: 'v1', authorityType: 'BOMBA', decision: 'Approved', rationale: 'Standard charity run coverage.', reviewerId: USER_IDS.U_OFC_BOMBA_KL_01, decidedAt: daysAgo(76) }),
      history: [] },
  ],
};

// ---------------------------------------------------------------------------
// Flatten to AuthorityDecision arrays
// ---------------------------------------------------------------------------
export const mockCurrentDecisions: AuthorityDecision[] = Object.values(decisionsByEvent)
  .flat()
  .map((d) => d.current);

export const mockDecisionHistory: AuthorityDecision[] = Object.values(decisionsByEvent)
  .flat()
  .flatMap((d) => d.history);

// Make sure the per-decision current/history consistency: every current
// should have a matching history entry (even if just the original), and
// every history entry should NOT have current=true.
const allDecisions: AuthorityDecision[] = [...mockCurrentDecisions, ...mockDecisionHistory];

// Re-stamp current flag deterministically (current=true only for current array)
const finalCurrent: AuthorityDecision[] = mockCurrentDecisions.map((d) => ({ ...d, current: true }));
const finalHistory: AuthorityDecision[] = allDecisions
  .filter((d) => !d.current)
  .map((d) => ({
    ...d,
    decisionId: historyId(d.decisionId, d.decidedAt),
    current: false,
  }));

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
export const mockAllDecisions = [...finalCurrent, ...finalHistory];

/**
 * Current decisions only (used by dashboard / aggregate status).
 * Document IDs follow the `{versionId}_{authorityType}` convention.
 */
export const mockCurrentDecisionsForUi = finalCurrent;

/**
 * Decision history (append-only audit log).
 * Document IDs follow the `{versionId}_{authorityType}_{timestamp}` convention.
 */
export const mockDecisionHistoryForUi = finalHistory;

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
export const findCurrentDecisions = (eventId: string, versionId: string): AuthorityDecision[] =>
  mockCurrentDecisionsForUi.filter((d) => d.eventId === eventId && d.versionId === versionId);

export const findDecisionHistory = (eventId: string): AuthorityDecision[] =>
  mockDecisionHistoryForUi
    .filter((d) => d.eventId === eventId)
    .sort((a, b) => b.decidedAt - a.decidedAt);

export const findCurrentDecisionForAuthority = (
  eventId: string,
  versionId: string,
  authorityType: AuthorityType,
): AuthorityDecision | undefined =>
  mockCurrentDecisionsForUi.find(
    (d) => d.eventId === eventId && d.versionId === versionId && d.authorityType === authorityType,
  );
