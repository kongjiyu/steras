/**
 * Record an authority officer's human confirmation or override of residual
 * hazard likelihood/severity (FR-M3-14).
 *
 * M2's deterministic assessment is immutable. This callable stores the
 * authority's scoped review artifact, including original and revised values,
 * so a later M2 recomputation can consume it without allowing an officer to
 * silently mutate the official score.
 */
import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  Assignment,
  AuthorityAssessmentReview,
  COLLECTIONS,
  EventRecord,
  RiskAssessment,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';

interface ScoreOverrideInput {
  hazardId?: string;
  residualLikelihood?: number;
  residualSeverity?: number;
}

interface ReviewAssessmentScoresRequest {
  eventId?: string;
  rationale?: string;
  overrides?: ScoreOverrideInput[];
  resourceConfirmed?: boolean;
}

const RATIONALE_MIN = 10;
const RATIONALE_MAX = 1_000;

export const reviewAssessmentScores = onCall<ReviewAssessmentScoresRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before recording an assessment review.');
  return reviewAssessmentScoresForUser(request.auth.uid, request.data);
});

export async function reviewAssessmentScoresForUser(
  uid: string,
  data: ReviewAssessmentScoresRequest,
  now = Date.now(),
) {
  const eventId = (data.eventId ?? '').trim();
  const rationale = (data.rationale ?? '').trim();
  const overrides = Array.isArray(data.overrides) ? data.overrides : [];
  const resourceConfirmed = data.resourceConfirmed === true;
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (rationale.length < RATIONALE_MIN || rationale.length > RATIONALE_MAX) {
    throw new HttpsError('invalid-argument', `Rationale must be between ${RATIONALE_MIN} and ${RATIONALE_MAX} characters.`);
  }
  if (overrides.length > 100) throw new HttpsError('invalid-argument', 'Too many hazard overrides.');

  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const userRef = db.collection(COLLECTIONS.USERS).doc(uid);
  const userSnap = await userRef.get();
  const profile = userSnap.data() as UserProfile | undefined;
  if (!profile || profile.role !== 'authority' || !profile.authorityType) {
    throw new HttpsError('permission-denied', 'Only provisioned authority officers can review scores.');
  }
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) throw new HttpsError('not-found', 'Event application was not found.');
  const event = eventSnap.data() as EventRecord;
  const versionId = event.currentVersionId;
  if (!versionId) throw new HttpsError('failed-precondition', 'The application has no submitted version.');
  if (!['Pending', 'UnderReview'].includes(event.status)) {
    throw new HttpsError('failed-precondition', 'Scores can only be reviewed during active authority review.');
  }

  const assignmentSnapshot = await eventRef.collection(COLLECTIONS.ASSIGNMENTS).get();
  const assignment = assignmentSnapshot.docs
    .map((snapshot) => ({ ...(snapshot.data() as Assignment), assignmentId: snapshot.id }))
    .find((candidate) => candidate.versionId === versionId
      && candidate.authorityType === profile.authorityType
      && candidate.officerUid === uid
      && (candidate.status === 'pending' || candidate.status === 'in_progress'));
  if (!assignment) throw new HttpsError('permission-denied', 'You are not the named officer assigned to this application.');

  const assessmentSnapshot = await eventRef.collection(COLLECTIONS.ASSESSMENTS).doc(versionId).get();
  const assessment = assessmentSnapshot.data() as RiskAssessment | undefined;
  if (!assessment || !['provisional_ready', 'authority_review', 'official_ready'].includes(assessment.status)) {
    throw new HttpsError('failed-precondition', 'A current assessment is required before score review.');
  }
  const hazards = extractReviewHazards(assessment);
  if (overrides.length > 0 && hazards.length === 0) {
    throw new HttpsError('failed-precondition', 'A current all-hazards assessment is required before recording score overrides.');
  }

  const hazardsById = new Map(hazards.map((hazard) => [hazard.hazardId, hazard]));
  const normalizedOverrides: AuthorityAssessmentReview['overrides'] = [];
  const seen = new Set<string>();
  for (const input of overrides) {
    const hazardId = (input.hazardId ?? '').trim();
    if (!hazardId || seen.has(hazardId)) throw new HttpsError('invalid-argument', 'Each hazard override must have a unique hazardId.');
    seen.add(hazardId);
    const hazard = hazardsById.get(hazardId);
    if (!hazard) throw new HttpsError('invalid-argument', `Hazard ${hazardId} is not in the current assessment.`);
    if (!isMatrixValue(input.residualLikelihood) || !isMatrixValue(input.residualSeverity)) {
      throw new HttpsError('invalid-argument', 'Residual likelihood and severity must be whole numbers from 1 to 5.');
    }
    normalizedOverrides.push({
      hazardId,
      hazardName: hazard.hazardName,
      originalResidualLikelihood: hazard.residualLikelihood,
      originalResidualSeverity: hazard.residualSeverity,
      revisedResidualLikelihood: input.residualLikelihood,
      revisedResidualSeverity: input.residualSeverity,
    });
  }

  const reviewId = `${versionId}_${profile.authorityType}`;
  const reviewRef = eventRef.collection(COLLECTIONS.ASSESSMENT_REVIEWS).doc(reviewId);
  const auditRef = eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(`${reviewId}_assessment_review`);
  const review: AuthorityAssessmentReview = {
    reviewId,
    eventId,
    versionId,
    authorityType: profile.authorityType,
    reviewerUid: uid,
    rationale,
    reviewedAt: now,
    resourceConfirmed,
    overrides: normalizedOverrides,
  };
  await db.runTransaction(async (tx) => {
    const [currentEvent, currentAssignment] = await Promise.all([tx.get(eventRef), tx.get(eventRef.collection(COLLECTIONS.ASSIGNMENTS).doc(assignment.assignmentId))]);
    const current = currentEvent.data() as EventRecord | undefined;
    const currentAssignmentData = currentAssignment.data() as Assignment | undefined;
    if (!current || current.currentVersionId !== versionId || !['Pending', 'UnderReview'].includes(current.status)) {
      throw new HttpsError('failed-precondition', 'The application changed while the score review was being recorded.');
    }
    if (!currentAssignmentData || currentAssignmentData.officerUid !== uid || currentAssignmentData.status === 'revoked' || currentAssignmentData.status === 'completed') {
      throw new HttpsError('failed-precondition', 'This assignment is no longer open for score review.');
    }
    tx.set(reviewRef, review);
    tx.set(auditRef, {
      id: auditRef.id,
      eventId,
      versionId,
      action: 'assessment_reviewed',
      actorId: uid,
      actorRole: 'authority',
      timestamp: now,
      notes: rationale,
      metadata: {
        authorityType: profile.authorityType,
        overrideCount: normalizedOverrides.length,
        resourceConfirmed,
        overrides: normalizedOverrides,
      },
    });
  });
  return { eventId, versionId, reviewId, overrideCount: normalizedOverrides.length, resourceConfirmed, reviewedAt: now };
}

function isMatrixValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

interface ReviewHazard {
  hazardId: string;
  hazardName: string;
  residualLikelihood: number;
  residualSeverity: number;
}

function extractReviewHazards(assessment: RiskAssessment): ReviewHazard[] {
  const candidate = (assessment as RiskAssessment & { hazards?: unknown }).hazards;
  if (!Array.isArray(candidate)) return [];
  return candidate.filter((value): value is ReviewHazard => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return typeof record.hazardId === 'string'
      && typeof record.hazardName === 'string'
      && Number.isInteger(record.residualLikelihood)
      && Number.isInteger(record.residualSeverity)
      && Number(record.residualLikelihood) >= 1
      && Number(record.residualLikelihood) <= 5
      && Number(record.residualSeverity) >= 1
      && Number(record.residualSeverity) <= 5;
  });
}
