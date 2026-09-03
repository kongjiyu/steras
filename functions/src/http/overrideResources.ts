import { createHash } from 'node:crypto';
import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  COLLECTIONS,
  EventRecord,
  RESOURCE_KEYS,
  RESOURCE_OVERRIDE_REASON_CATEGORIES,
  ResourceOverrideReasonCategory,
  ResourceOverrideRecord,
  ResourceQuantities,
  ResourceRecommendation,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { validateResourceRecommendation } from '../engines/resourceContract';

interface OverrideResourcesRequest {
  eventId?: string;
  quantities?: ResourceQuantities;
  rationale?: string;
  /** Stable client key used to make retries return the same append-only record. */
  idempotencyKey?: string;
  overrideReasonCategory?: ResourceOverrideReasonCategory;
}

export const overrideResources = onCall<OverrideResourcesRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before overriding resources.');
  return overrideResourcesForUser(request.auth.uid, request.data);
});

export async function overrideResourcesForUser(uid: string, request: OverrideResourcesRequest, now = Date.now()) {
  const { eventId, quantities, rationale, idempotencyKey, overrideReasonCategory } = validateResourceOverrideRequest(request);

  const db = firestore();
  const eventReference = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const userReference = db.collection(COLLECTIONS.USERS).doc(uid);
  return db.runTransaction(async (transaction) => {
    const overrideQuery = eventReference.collection(COLLECTIONS.RESOURCE_OVERRIDES)
      .where('idempotencyKey', '==', idempotencyKey).limit(1);
    const [userSnapshot, eventSnapshot, assignmentsSnapshot, existingOverrideSnapshot] = await Promise.all([
      transaction.get(userReference),
      transaction.get(eventReference),
      transaction.get(eventReference.collection(COLLECTIONS.ASSIGNMENTS)),
      transaction.get(overrideQuery),
    ]);
    const profile = userSnapshot.data() as UserProfile | undefined;
    const event = eventSnapshot.exists ? { eventId, ...eventSnapshot.data() } as EventRecord : undefined;
    if (!profile || profile.role !== 'authority' || !profile.authorityType) {
      throw new HttpsError('permission-denied', 'Only provisioned authorities can override resources.');
    }
    if (!event || !event.currentVersionId || !event.currentAssessmentId || !event.currentResourceId) {
      throw new HttpsError('failed-precondition', 'The application current-generation pointers are incomplete.');
    }
    if (!safeDocumentId(event.currentVersionId) || !safeDocumentId(event.currentAssessmentId)
      || !safeDocumentId(event.currentResourceId)) {
      throw new HttpsError('failed-precondition', 'The application current-generation pointers are invalid.');
    }

    const assignment = assignmentsSnapshot.docs
      .map((snapshot) => snapshot.data() as { versionId?: string; authorityType?: string; officerUid?: string; status?: string })
      .find((candidate) => candidate.versionId === event.currentVersionId
        && candidate.authorityType === profile.authorityType
        && candidate.officerUid === uid
        && (candidate.status === 'pending' || candidate.status === 'in_progress'));
    if (!assignment) throw new HttpsError('permission-denied', 'You are not the named officer assigned to this application.');
    if (!['Pending', 'UnderReview'].includes(event.status)) {
      throw new HttpsError('failed-precondition', 'Resources can only be changed during active review.');
    }

    const resourceReference = eventReference.collection(COLLECTIONS.RESOURCES).doc(event.currentResourceId);
    const assessmentReference = eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId);
    const [resourceSnapshot, assessmentSnapshot] = await Promise.all([
      transaction.get(resourceReference),
      transaction.get(assessmentReference),
    ]);
    const resource = resourceSnapshot.data() as ResourceRecommendation | undefined;
    const assessment = assessmentSnapshot.data() as { assessmentId?: string; eventId?: string; versionId?: string } | undefined;
    if (!resourceSnapshot.exists || !resource || !validateResourceRecommendation(resource).ok
      || resource.resourceId !== event.currentResourceId
      || resource.eventId !== eventId
      || resource.versionId !== event.currentVersionId
      || resource.assessmentId !== event.currentAssessmentId
      || !assessmentSnapshot.exists
      || assessment?.assessmentId !== event.currentAssessmentId
      || assessment.eventId !== eventId
      || assessment.versionId !== event.currentVersionId) {
      throw new HttpsError('failed-precondition', 'The current assessment/resource contract is invalid or not ready.');
    }

    const existingOverride = existingOverrideSnapshot.docs[0];
    if (existingOverride) {
      const existing = existingOverride.data() as ResourceOverrideRecord;
      if (existing.eventId !== eventId || existing.versionId !== event.currentVersionId
        || existing.baseResourceId !== event.currentResourceId || existing.reviewerId !== uid
        || !sameQuantities(existing.quantities, quantities) || existing.rationale !== rationale
        || existing.overrideReasonCategory !== overrideReasonCategory) {
        throw new HttpsError('already-exists', 'The idempotency key is already bound to different override content.');
      }
      return {
        eventId,
        versionId: event.currentVersionId,
        assessmentId: event.currentAssessmentId,
        resourceId: event.currentResourceId,
        baseResourceId: event.currentResourceId,
        overrideId: existing.overrideId,
        quantities: existing.quantities,
        overriddenAt: existing.overriddenAt,
        idempotent: true,
      };
    }

    const previousOverridesSnapshot = await transaction.get(
      eventReference.collection(COLLECTIONS.RESOURCE_OVERRIDES)
        .where('baseResourceId', '==', event.currentResourceId),
    );
    const previousOverrides = previousOverridesSnapshot.docs
      .map((snapshot) => snapshot.data() as ResourceOverrideRecord)
      .filter((candidate) => candidate.eventId === eventId
        && candidate.versionId === event.currentVersionId
        && candidate.baseResourceId === event.currentResourceId
        && isResourceQuantities(candidate.quantities))
      .sort((left, right) => right.overriddenAt - left.overriddenAt);
    const previous = previousOverrides[0];
    const previousQuantities = previous?.quantities ?? toResourceQuantities(resource);
    const overrideId = `override-${createHash('sha256').update(`${uid}:${idempotencyKey}`).digest('hex').slice(0, 32)}`;
    const overrideReference = eventReference.collection(COLLECTIONS.RESOURCE_OVERRIDES).doc(overrideId);
    const auditReference = eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(`${overrideId}_resource_override`);
    const record: ResourceOverrideRecord = {
      overrideId,
      eventId,
      versionId: event.currentVersionId,
      assessmentId: event.currentAssessmentId,
      baseResourceId: event.currentResourceId,
      resourceId: event.currentResourceId,
      authorityType: profile.authorityType,
      reviewerId: uid,
      rationale,
      overrideReasonCategory,
      previousQuantities,
      quantities,
      idempotencyKey,
      ...(previous ? { supersedesOverrideId: previous.overrideId } : {}),
      overriddenAt: now,
    };
    transaction.create(overrideReference, record);
    transaction.create(auditReference, {
      id: auditReference.id,
      eventId,
      versionId: event.currentVersionId,
      action: 'resource_overridden',
      actorId: uid,
      actorRole: 'authority',
      timestamp: now,
      notes: rationale,
      metadata: {
        authorityType: profile.authorityType,
        resourceId: event.currentResourceId,
        baseResourceId: event.currentResourceId,
        previousQuantities,
        quantities,
        overrideId,
        overrideReasonCategory,
      },
    });
    return {
      eventId,
      versionId: event.currentVersionId,
      assessmentId: event.currentAssessmentId,
      resourceId: event.currentResourceId,
      baseResourceId: event.currentResourceId,
      overrideId,
      quantities,
      overriddenAt: now,
      idempotent: false,
    };
  });
}

export function validateResourceOverrideRequest(request: unknown): {
  eventId: string;
  quantities: ResourceQuantities;
  rationale: string;
  idempotencyKey: string;
  overrideReasonCategory: ResourceOverrideReasonCategory;
} {
  const value = typeof request === 'object' && request !== null ? request as Record<string, unknown> : {};
  const eventId = typeof value.eventId === 'string' ? value.eventId.trim() : '';
  const rationale = typeof value.rationale === 'string' ? value.rationale.trim() : '';
  const idempotencyKey = typeof value.idempotencyKey === 'string' ? value.idempotencyKey.trim() : '';
  const overrideReasonCategory = value.overrideReasonCategory;
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!isResourceQuantities(value.quantities)) throw new HttpsError('invalid-argument', 'Every resource quantity must be a non-negative integer.');
  if (rationale.length < 10 || rationale.length > 1_000) throw new HttpsError('invalid-argument', 'Rationale must be between 10 and 1,000 characters.');
  if (!safeIdempotencyKey(idempotencyKey)) throw new HttpsError('invalid-argument', 'idempotencyKey must be 8-128 characters.');
  if (!RESOURCE_OVERRIDE_REASON_CATEGORIES.includes(overrideReasonCategory as ResourceOverrideReasonCategory)) {
    throw new HttpsError('invalid-argument', 'A valid overrideReasonCategory is required.');
  }
  return { eventId, quantities: value.quantities, rationale, idempotencyKey, overrideReasonCategory: overrideReasonCategory as ResourceOverrideReasonCategory };
}

function isResourceQuantities(value: unknown): value is ResourceQuantities {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === RESOURCE_KEYS.length
    && RESOURCE_KEYS.every((field) => Number.isInteger(record[field])
      && (record[field] as number) >= 0 && (record[field] as number) <= 1_000_000);
}

function toResourceQuantities(resource: ResourceRecommendation): ResourceQuantities {
  return Object.fromEntries(RESOURCE_KEYS.map((key) => [key, resource.items[key].baseline])) as unknown as ResourceQuantities;
}

function sameQuantities(left: unknown, right: ResourceQuantities): boolean {
  return isResourceQuantities(left) && RESOURCE_KEYS.every((key) => left[key] === right[key]);
}

function safeDocumentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function safeIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}
