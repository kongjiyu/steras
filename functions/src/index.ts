/**
 * STERAS — Cloud Functions entry point.
 *
 * Module mapping (per PRD §4):
 *   - Module 2 (Smart Risk Assessment): AI predictor + rule-based engine
 *   - Module 3 (Resource Recommendation): resource calculator
 *   - Module 4 (Authority Dashboard): transactional multi-agency review
 *
 * Triggers:
 *   - onEventCreated   — fires when a new event doc is created
 *   - onEventUpdated   — fires on organizer edits (re-runs risk/resources)
 *   - makeAuthorityDecision — records and aggregates authority decisions
 *   - overrideResources     — validates and audits resource adjustments
 */

import { initializeApp } from 'firebase-admin/app';

// Initialize firebase-admin before any function code runs.
initializeApp();

export { onEventCreated, onEventUpdated } from './triggers/onEventCreated';
export { recomputeRiskAndResources } from './triggers/computeRisk';

// HTTP-callable functions (e.g. for manual authority re-trigger, seed runs)
export { manualRecompute } from './http/manualRecompute';
export { submitEvent } from './http/submitEvent';
export { withdrawEvent } from './http/withdrawEvent';
export { makeAuthorityDecision } from './http/authorityDecision';
export { overrideResources } from './http/overrideResources';
export { verifyStage1Doc } from './http/verifyStage1Doc';
export { markNotificationRead, listMyNotifications } from './http/notifications';
// M3 round N+1 — stub. Replaced by M2's `proposeEventControlList` when
// M2 lands it (per integration contract Q5).
export { proposeEventControlList } from './http/proposeEventControlList';
// M3 Workstream 1 — officer assignment + multi-stage review.
export { assignAuthorityOfficers } from './http/assignAuthorityOfficers';
export { recordOfficerProposal } from './http/recordOfficerProposal';
export { makeSecondReviewDecision } from './http/makeSecondReviewDecision';
// M3 Workstream 1 polish — reverse an assignment (A15 backup officer swap).
export { unassignAuthorityOfficers } from './http/unassignAuthorityOfficers';
// M3 Workstream 2 — event control list model + AI generation (admin).
export { generateEventControlList } from './http/generateEventControlList';
export { editEventControlList } from './http/editEventControlList';
// M3 Workstream 3 — organizer Stage 1 upload (FR-M3-20, FR-M3-26,
// UC-28, UC-29). Two paths: upload (base64 in Firestore) or
// use_previous (one-click receipt shortcut per M3 owner decision
// 2026-08-19).
export { submitStage1Doc } from './http/submitStage1Doc';
