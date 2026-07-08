/**
 * STERAS — Cloud Functions entry point.
 *
 * Module mapping (per PRD §4):
 *   - Module 2 (Smart Risk Assessment): AI predictor + rule-based engine
 *   - Module 3 (Resource Recommendation): resource calculator
 *   - Module 4 (Authority Dashboard): triggered on event creation + decision
 *
 * Triggers:
 *   - onEventCreated   — fires when a new event doc is created
 *   - onEventUpdated   — fires on organizer edits (re-runs risk/resources)
 *   - onDecisionMade   — fires when authority sets status to Approved/Rejected
 */

import { initializeApp } from 'firebase-admin/app';

// Initialize firebase-admin before any function code runs.
initializeApp();

export { onEventCreated, onEventUpdated } from './triggers/onEventCreated';
export { onDecisionMade } from './triggers/onDecisionMade';
export { recomputeRiskAndResources } from './triggers/computeRisk';

// HTTP-callable functions (e.g. for manual authority re-trigger, seed runs)
export { manualRecompute } from './http/manualRecompute';
