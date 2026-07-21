import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { COLLECTIONS, EventRecord, ResourceQuantities, ResourceRecommendation, UserProfile } from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';

interface OverrideResourcesRequest {
  eventId?: string;
  quantities?: ResourceQuantities;
  rationale?: string;
}

export const overrideResources = onCall<OverrideResourcesRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before overriding resources.');
  return overrideResourcesForUser(request.auth.uid, request.data);
});

export async function overrideResourcesForUser(uid: string, request: OverrideResourcesRequest, now = Date.now()) {
  const { eventId, quantities, rationale } = validateResourceOverrideRequest(request);

  const db = firestore();
  const eventReference = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const userReference = db.collection(COLLECTIONS.USERS).doc(uid);
  return db.runTransaction(async (transaction) => {
    const [userSnapshot, eventSnapshot] = await Promise.all([transaction.get(userReference), transaction.get(eventReference)]);
    const profile = userSnapshot.data() as UserProfile | undefined;
    const event = eventSnapshot.exists ? { eventId, ...eventSnapshot.data() } as EventRecord : undefined;
    if (!profile || profile.role !== 'authority' || !profile.authorityType) throw new HttpsError('permission-denied', 'Only provisioned authorities can override resources.');
    if (!event || !event.currentVersionId) throw new HttpsError('not-found', 'Submitted event application was not found.');
    if (!event.requiredAuthorities.includes(profile.authorityType)) throw new HttpsError('permission-denied', 'Your authority is not assigned to this application.');
    if (!['Pending', 'UnderReview'].includes(event.status)) throw new HttpsError('failed-precondition', 'Resources can only be changed during active review.');

    const versionId = event.currentVersionId;
    const resourceReference = eventReference.collection(COLLECTIONS.RESOURCES).doc(versionId);
    const resourceSnapshot = await transaction.get(resourceReference);
    if (!resourceSnapshot.exists) throw new HttpsError('failed-precondition', 'Resource recommendation is not ready.');
    const previous = resourceSnapshot.data() as ResourceRecommendation;
    const updated: ResourceRecommendation = {
      ...previous,
      ...quantities,
      confidenceLevel: 'authorityValidated',
      notes: `Authority override: ${rationale}`,
      overriddenBy: uid,
      overrideRationale: rationale,
      overriddenAt: now,
    };
    const overrideId = `${versionId}_${profile.authorityType}_${now}`;
    const overrideReference = eventReference.collection(COLLECTIONS.RESOURCE_OVERRIDES).doc(overrideId);
    const auditReference = eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(`${overrideId}_resource_override`);
    transaction.set(resourceReference, updated);
    transaction.create(overrideReference, { overrideId, eventId, versionId, authorityType: profile.authorityType, reviewerId: uid, rationale, previous, updated, overriddenAt: now });
    transaction.create(auditReference, {
      id: auditReference.id, eventId, versionId, action: 'resource_overridden', actorId: uid, actorRole: 'authority', timestamp: now,
      notes: rationale, metadata: { authorityType: profile.authorityType, previous, updated: quantities },
    });
    return { eventId, versionId, resourceId: versionId, overriddenAt: now };
  });
}

export function validateResourceOverrideRequest(request: unknown): { eventId: string; quantities: ResourceQuantities; rationale: string } {
  const value = typeof request === 'object' && request !== null ? request as Record<string, unknown> : {};
  const eventId = typeof value.eventId === 'string' ? value.eventId.trim() : '';
  const rationale = typeof value.rationale === 'string' ? value.rationale.trim() : '';
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!isResourceQuantities(value.quantities)) throw new HttpsError('invalid-argument', 'Every resource quantity must be a non-negative integer.');
  if (rationale.length < 10 || rationale.length > 1_000) throw new HttpsError('invalid-argument', 'Rationale must be between 10 and 1,000 characters.');
  return { eventId, quantities: value.quantities, rationale };
}

function isResourceQuantities(value: unknown): value is ResourceQuantities {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const fields: (keyof ResourceQuantities)[] = ['police', 'medicalTeams', 'ambulances', 'toilets', 'wasteBins', 'security', 'fireOfficers'];
  return Object.keys(record).length === fields.length && fields.every((field) => Number.isInteger(record[field]) && (record[field] as number) >= 0 && (record[field] as number) <= 1_000_000);
}
