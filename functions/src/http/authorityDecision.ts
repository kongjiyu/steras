import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  AuthorityDecision,
  AuthorityType,
  COLLECTIONS,
  DecisionValue,
  EventRecord,
  EventVersion,
  PublicEvent,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';

interface AuthorityDecisionRequest {
  eventId?: string;
  decision?: DecisionValue;
  rationale?: string;
}

export const makeAuthorityDecision = onCall<AuthorityDecisionRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before reviewing an application.');
  return makeAuthorityDecisionForUser(request.auth.uid, request.data);
});

export async function makeAuthorityDecisionForUser(
  uid: string,
  request: AuthorityDecisionRequest,
  now = Date.now(),
) {
  const { eventId, decision, rationale } = validateDecisionRequest(request);

  const db = firestore();
  const eventReference = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const userReference = db.collection(COLLECTIONS.USERS).doc(uid);
  const publicReference = db.collection(COLLECTIONS.PUBLIC_EVENTS).doc(eventId);

  return db.runTransaction(async (transaction) => {
    const [userSnapshot, eventSnapshot] = await Promise.all([
      transaction.get(userReference),
      transaction.get(eventReference),
    ]);
    const profile = userSnapshot.data() as UserProfile | undefined;
    if (!profile || profile.role !== 'authority' || !profile.authorityType) {
      throw new HttpsError('permission-denied', 'Only provisioned authority accounts can make decisions.');
    }
    if (!eventSnapshot.exists) throw new HttpsError('not-found', 'Event application was not found.');
    const event = { eventId, ...eventSnapshot.data() } as EventRecord;
    const versionId = event.currentVersionId;
    if (!versionId) throw new HttpsError('failed-precondition', 'The application has no submitted version.');
    if (!event.requiredAuthorities.includes(profile.authorityType)) {
      throw new HttpsError('permission-denied', 'Your authority is not assigned to this application.');
    }

    const decisionId = currentDecisionId(versionId, profile.authorityType);
    const currentReference = eventReference.collection(COLLECTIONS.DECISIONS).doc(decisionId);
    const versionReference = eventReference.collection(COLLECTIONS.VERSIONS).doc(versionId);
    const [currentSnapshot, versionSnapshot] = await Promise.all([
      transaction.get(currentReference),
      transaction.get(versionReference),
    ]);
    const current = currentSnapshot.data() as AuthorityDecision | undefined;
    if (current && current.decision === decision && current.rationale === rationale && current.reviewerId === uid) {
      return { eventId, versionId, decisionId, decision, status: event.status, idempotent: true };
    }
    if (!['Pending', 'UnderReview'].includes(event.status)) {
      throw new HttpsError('failed-precondition', 'This application version is no longer open for review.');
    }
    if (event.currentAssessmentId !== versionId || event.currentResourceId !== versionId) {
      throw new HttpsError('failed-precondition', 'Risk assessment and resources must be ready before a decision.');
    }
    if (!versionSnapshot.exists) throw new HttpsError('failed-precondition', 'The immutable application version is missing.');

    const decisionReferences = event.requiredAuthorities.map((authority) =>
      eventReference.collection(COLLECTIONS.DECISIONS).doc(currentDecisionId(versionId, authority)));
    const decisionSnapshots = await transaction.getAll(...decisionReferences);
    const decisions = new Map<AuthorityType, DecisionValue>();
    decisionSnapshots.forEach((snapshot) => {
      const value = snapshot.data() as AuthorityDecision | undefined;
      if (value?.versionId === versionId && value.current) decisions.set(value.authorityType, value.decision);
    });
    decisions.set(profile.authorityType, decision);
    const aggregateStatus = aggregateDecisionStatus(event.requiredAuthorities, decisions);
    const version = versionSnapshot.data() as EventVersion;
    const authorityDecision: AuthorityDecision = {
      decisionId,
      eventId,
      versionId,
      authorityType: profile.authorityType,
      decision,
      rationale,
      reviewerId: uid,
      decidedAt: now,
      current: true,
    };
    const historyId = `${decisionId}_${now}`;
    const historyReference = eventReference.collection(COLLECTIONS.DECISION_HISTORY).doc(historyId);
    const auditReference = eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(`${historyId}_decision`);

    transaction.set(currentReference, authorityDecision);
    transaction.create(historyReference, { ...authorityDecision, decisionId: historyId, current: false });
    transaction.update(eventReference, {
      status: aggregateStatus,
      editableVersionId: aggregateStatus === 'AmendmentRequested' ? `v${event.currentVersionNumber + 1}` : null,
      ...(aggregateStatus === 'AmendmentRequested' ? { draftDocumentPaths: [] } : {}),
      updatedAt: now,
    });
    transaction.create(auditReference, {
      id: auditReference.id,
      eventId,
      versionId,
      action: 'decision_made',
      actorId: uid,
      actorRole: 'authority',
      timestamp: now,
      previousStatus: event.status,
      newStatus: aggregateStatus,
      notes: rationale,
      metadata: { authorityType: profile.authorityType, decision },
    });

    if (aggregateStatus === 'Approved') {
      const details = version.eventDetails;
      const publicEvent: PublicEvent = {
        eventId,
        versionId,
        eventName: details.name,
        venueName: details.venueName,
        eventType: details.type,
        startDatetime: details.startDatetime,
        endDatetime: details.endDatetime,
        approvedBy: event.requiredAuthorities,
        publicStatus: 'approved',
      };
      transaction.set(publicReference, publicEvent);
      const publishAudit = eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(`${versionId}_public_published`);
      transaction.set(publishAudit, {
        id: publishAudit.id, eventId, versionId, action: 'public_published', actorId: 'system', actorRole: 'system', timestamp: now,
        metadata: { approvedBy: event.requiredAuthorities },
      });
    } else {
      transaction.delete(publicReference);
    }

    return { eventId, versionId, decisionId, decision, status: aggregateStatus, idempotent: false };
  });
}

export function validateDecisionRequest(request: unknown): { eventId: string; decision: DecisionValue; rationale: string } {
  const value = typeof request === 'object' && request !== null ? request as Record<string, unknown> : {};
  const eventId = typeof value.eventId === 'string' ? value.eventId.trim() : '';
  const decision = value.decision;
  const rationale = typeof value.rationale === 'string' ? value.rationale.trim() : '';
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!isDecision(decision)) throw new HttpsError('invalid-argument', 'A valid decision is required.');
  if (rationale.length < 10 || rationale.length > 1_000) {
    throw new HttpsError('invalid-argument', 'Rationale must be between 10 and 1,000 characters.');
  }
  return { eventId, decision, rationale };
}

export function aggregateDecisionStatus(
  requiredAuthorities: AuthorityType[],
  decisions: ReadonlyMap<AuthorityType, DecisionValue>,
): EventRecord['status'] {
  if (requiredAuthorities.some((authority) => decisions.get(authority) === 'Rejected')) return 'Rejected';
  if (requiredAuthorities.some((authority) => decisions.get(authority) === 'AmendmentRequested')) return 'AmendmentRequested';
  if (requiredAuthorities.length > 0 && requiredAuthorities.every((authority) => decisions.get(authority) === 'Approved')) return 'Approved';
  return 'UnderReview';
}

function currentDecisionId(versionId: string, authorityType: AuthorityType): string {
  return `${versionId}_${authorityType}`;
}

function isDecision(value: unknown): value is DecisionValue {
  return value === 'Approved' || value === 'Rejected' || value === 'AmendmentRequested';
}
