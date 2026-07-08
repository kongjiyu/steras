/**
 * HTTP-callable function for manual re-computation.
 * Useful for testing, demo, and authority-triggered reruns.
 *
 * Uses firebase-functions v2 onCall API.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { recomputeRiskAndResources } from '../triggers/computeRisk';

export const manualRecompute = onCall<{ eventId?: string }>(async (request) => {
  // Require auth.
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in first.');
  }

  const eventId = request.data.eventId;
  if (!eventId) {
    throw new HttpsError('invalid-argument', 'eventId required.');
  }

  try {
    await recomputeRiskAndResources(eventId);
    return { success: true, eventId };
  } catch (err) {
    logger.error('[manualRecompute] failed:', err);
    throw new HttpsError('internal', 'Recompute failed.');
  }
});
