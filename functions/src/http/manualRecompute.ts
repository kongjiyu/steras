/**
 * HTTP-callable function for manual re-computation.
 * Useful for testing, demo, and authority-triggered reruns.
 *
 * Uses firebase-functions v2 onCall API.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { firestore } from 'firebase-admin';
import { AssessmentStatus, AuthorityType, COLLECTIONS, EventRecord } from '@shared/types';
import { recomputeRiskAndResources } from '../triggers/computeRisk';
import type { PipelineResult, RetryAuthorization } from '../triggers/onEventCreated';
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
  loadEvent: (eventId: string) => Promise<unknown>;
  loadAssessment: (eventId: string, assessmentId: string) => Promise<unknown>;
  recompute: (eventId: string, authorization: RetryAuthorization) => Promise<PipelineResult>;
}

const defaultDependencies: ManualRecomputeDependencies = {
  loadProfile: async (uid) => (await firestore().collection(COLLECTIONS.USERS).doc(uid).get()).data(),
  loadEvent: async (eventId) => (await firestore().collection(COLLECTIONS.EVENTS).doc(eventId).get()).data(),
  loadAssessment: async (eventId, assessmentId) => (
    await firestore().collection(COLLECTIONS.EVENTS).doc(eventId)
      .collection(COLLECTIONS.ASSESSMENTS).doc(assessmentId).get()
  ).data(),
  recompute: recomputeRiskAndResources,
};

export async function manualRecomputeForUser(
  uid: string,
  rawEventId: unknown,
  dependencies: ManualRecomputeDependencies = defaultDependencies,
) {
  const profile = await dependencies.loadProfile(uid);
  const authorityType = validateRecomputeProfile(profile);
  const eventId = validateRecomputeEventId(rawEventId);
  const event = await dependencies.loadEvent(eventId);
  const assessmentId = validateAuthorityAssignment(event, authorityType);
  const assessment = await dependencies.loadAssessment(eventId, assessmentId);
  validateRetryableAssessment(assessment);

  try {
    const result = await dependencies.recompute(eventId, { uid, authorityType });
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

export function validateRecomputeProfile(value: unknown): AuthorityType {
  const profile = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  if (profile.role !== 'authority' || !isAuthorityType(profile.authorityType)) {
    throw new HttpsError('permission-denied', 'Only provisioned authority accounts can retry assessments.');
  }
  return profile.authorityType;
}

export function validateAuthorityAssignment(value: unknown, authorityType: string): string {
  const event = typeof value === 'object' && value !== null ? value as Partial<EventRecord> : {};
  if (!Array.isArray(event.requiredAuthorities) || !event.requiredAuthorities.includes(authorityType as never)) {
    throw new HttpsError('permission-denied', 'Your authority is not assigned to this application.');
  }
  const assessmentId = typeof event.currentVersionId === 'string' && event.currentVersionId
    ? event.currentVersionId
    : event.currentAssessmentId;
  if (typeof assessmentId !== 'string' || !assessmentId) {
    throw new HttpsError('failed-precondition', 'This application has no assessment that can be retried.');
  }
  return assessmentId;
}

export function validateRetryableAssessment(value: unknown): void {
  const assessment = typeof value === 'object' && value !== null ? value as { status?: AssessmentStatus } : {};
  if (assessment.status !== 'manual_review_required' && assessment.status !== 'failed') {
    throw new HttpsError('failed-precondition', 'Only manual-review or failed assessments can be retried.');
  }
}

function isAuthorityType(value: unknown): value is AuthorityType {
  return value === 'PDRM' || value === 'BOMBA' || value === 'KKM' || value === 'DBKL';
}
