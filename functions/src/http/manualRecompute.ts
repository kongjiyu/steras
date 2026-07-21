/**
 * HTTP-callable function for manual re-computation.
 * Useful for testing, demo, and authority-triggered reruns.
 *
 * Uses firebase-functions v2 onCall API.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { firestore } from 'firebase-admin';
import { COLLECTIONS } from '@shared/types';
import { recomputeRiskAndResources } from '../triggers/computeRisk';
import type { PipelineResult } from '../triggers/onEventCreated';
import { ASSESSMENT_SECRETS } from '../config/secrets';
import { FUNCTION_REGION } from '../config/runtime';

export const manualRecompute = onCall<{ eventId?: string }>({ region: FUNCTION_REGION, secrets: ASSESSMENT_SECRETS }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in first.');
  }

  return manualRecomputeForUser(request.auth.uid, request.data.eventId);
});

interface ManualRecomputeDependencies {
  loadProfile: (uid: string) => Promise<unknown>;
  recompute: (eventId: string) => Promise<PipelineResult>;
}

const defaultDependencies: ManualRecomputeDependencies = {
  loadProfile: async (uid) => (await firestore().collection(COLLECTIONS.USERS).doc(uid).get()).data(),
  recompute: recomputeRiskAndResources,
};

export async function manualRecomputeForUser(
  uid: string,
  rawEventId: unknown,
  dependencies: ManualRecomputeDependencies = defaultDependencies,
) {
  const profile = await dependencies.loadProfile(uid);
  validateRecomputeProfile(profile);
  const eventId = validateRecomputeEventId(rawEventId);

  try {
    const result = await dependencies.recompute(eventId);
    return { success: result.status === 'processed', ...result };
  } catch (err) {
    logger.error('[manualRecompute] failed:', err);
    throw new HttpsError('internal', 'Recompute failed.');
  }
}

export function validateRecomputeEventId(value: unknown): string {
  const eventId = typeof value === 'string' ? value.trim() : '';
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId required.');
  if (eventId.length > 200) throw new HttpsError('invalid-argument', 'eventId must be at most 200 characters.');
  return eventId;
}

export function validateRecomputeProfile(value: unknown): void {
  const profile = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  if (profile.role !== 'authority' || typeof profile.authorityType !== 'string' || !profile.authorityType) {
    throw new HttpsError('permission-denied', 'Only provisioned authority accounts can retry assessments.');
  }
}
