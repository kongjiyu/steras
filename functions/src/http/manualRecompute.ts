/**
 * HTTP-callable function for manual re-computation.
 * Useful for testing, demo, and authority-triggered reruns.
 *
 * Uses firebase-functions v2 onCall API.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/logger';
import { firestore } from 'firebase-admin';
import { AssessmentStatus, AuthorityType, COLLECTIONS, EventRecord } from '@shared/types';
import { recomputeRiskAndResources } from '../triggers/computeRisk';
import type { PipelineResult, RetryAuthorization } from '../triggers/onEventCreated';
import { ASSESSMENT_SECRETS } from '../config/secrets';
import { FUNCTION_REGION } from '../config/runtime';
import { RESOURCE_CUTOVER_LOCK_PATH } from '../config/resourceCutoverLock';

export const manualRecompute = onCall<{ eventId?: string }>({ region: FUNCTION_REGION, secrets: ASSESSMENT_SECRETS, timeoutSeconds: 240 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in first.');
  }

  const payload = request.data && typeof request.data === 'object' ? request.data as { eventId?: unknown } : {};
  return manualRecomputeForUser(request.auth.uid, payload.eventId);
});

interface ManualRecomputeDependencies {
  loadProfile: (uid: string) => Promise<unknown>;
  loadEvent: (eventId: string) => Promise<unknown>;
  loadAssessment: (eventId: string, assessmentId: string) => Promise<unknown>;
  recompute: (eventId: string, authorization: RetryAuthorization) => Promise<PipelineResult>;
  loadCutoverLock?: () => Promise<unknown>;
}

const defaultDependencies: ManualRecomputeDependencies = {
  loadProfile: async (uid) => (await firestore().collection(COLLECTIONS.USERS).doc(uid).get()).data(),
  loadEvent: async (eventId) => (await firestore().collection(COLLECTIONS.EVENTS).doc(eventId).get()).data(),
  loadAssessment: async (eventId, assessmentId) => (
    await firestore().collection(COLLECTIONS.EVENTS).doc(eventId)
      .collection(COLLECTIONS.ASSESSMENTS).doc(assessmentId).get()
  ).data(),
  recompute: recomputeRiskAndResources,
  loadCutoverLock: async () => (await firestore().doc(RESOURCE_CUTOVER_LOCK_PATH).get()).exists,
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
  const versionId = validateCurrentVersion(event);
  const assessment = await dependencies.loadAssessment(eventId, assessmentId);
  validateRetryableAssessment(assessment, { eventId, versionId, assessmentId });
  if (await dependencies.loadCutoverLock?.()) throw new HttpsError('unavailable', 'Resource migration is in progress. Retry shortly.');

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
  if (!isSafeDocumentId(eventId)) throw new HttpsError('invalid-argument', 'eventId must be a valid document id.');
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
  const assessmentId = event.currentAssessmentId;
  if (!isSafeDocumentId(assessmentId)) {
    throw new HttpsError('failed-precondition', 'This application has no assessment that can be retried.');
  }
  return assessmentId;
}

function validateCurrentVersion(value: unknown): string {
  const event = typeof value === 'object' && value !== null ? value as Partial<EventRecord> : {};
  if (!isSafeDocumentId(event.currentVersionId)) {
    throw new HttpsError('failed-precondition', 'This application has no current version that can be retried.');
  }
  return event.currentVersionId;
}

export function validateRetryableAssessment(value: unknown, expected?: { eventId: string; versionId: string; assessmentId: string }): void {
  const assessment = typeof value === 'object' && value !== null ? value as { status?: AssessmentStatus; activeManualAssessmentId?: unknown } : {};
  if (expected) {
    const identity = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    if (identity.eventId !== expected.eventId || identity.versionId !== expected.versionId || identity.assessmentId !== expected.assessmentId) {
      throw new HttpsError('aborted', 'The assessment generation changed before retry authorization completed.');
    }
  }
  const hasManualLockField = Object.prototype.hasOwnProperty.call(assessment, 'activeManualAssessmentId');
  if (hasManualLockField && !isSafeManualAssessmentId(assessment.activeManualAssessmentId)) {
    throw new HttpsError('failed-precondition', 'The Admin manual assessment lock is invalid; do not retry this generation.');
  }
  if (isSafeManualAssessmentId(assessment.activeManualAssessmentId)) {
    throw new HttpsError('failed-precondition', 'An Admin manual assessment is already locked for this application version.');
  }
  if (assessment.status !== 'manual_review_required' && assessment.status !== 'failed') {
    throw new HttpsError('failed-precondition', 'Only manual-review or failed assessments can be retried.');
  }
}

function isSafeManualAssessmentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function isSafeDocumentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function isAuthorityType(value: unknown): value is AuthorityType {
  return value === 'PDRM' || value === 'BOMBA' || value === 'KKM' || value === 'DBKL' || value === 'MOTAC';
}
