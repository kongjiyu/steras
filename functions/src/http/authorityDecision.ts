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
  RiskAssessment,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { createNotification } from '../utils/notifications';

interface AuthorityDecisionRequest {
  eventId?: string;
  decision?: DecisionValue;
  rationale?: string;
}

/** Minimum rationale length when the assessment is provisional / insufficient. */
const PROVISIONAL_MIN_RATIONALE = 80;
/** Standard rationale length floor (FR-M3-16: 10–1000 chars). */
const STANDARD_MIN_RATIONALE = 10;

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

  // Capture for the post-transaction notification step
  const notifCtx: { organizerId: string; aggregateStatus: EventRecord['status']; authorityType: AuthorityType; versionId: string } | null = null;
  let notifCtxOut: { organizerId: string; aggregateStatus: EventRecord['status']; authorityType: AuthorityType; versionId: string } | null = notifCtx;

  const result = await db.runTransaction(async (transaction) => {
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
    const assessmentReference = eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(versionId);
    const [currentSnapshot, versionSnapshot, assessmentSnapshot] = await Promise.all([
      transaction.get(currentReference),
      transaction.get(versionReference),
      transaction.get(assessmentReference),
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

    // ---- M3 gates: compliance + readiness (FR-M3-14, FR-M3-03 handoff) ----
    const assessment = assessmentSnapshot.data() as RiskAssessment | undefined;
    if (assessment?.complianceStatus === 'blocked' && decision === 'Approved') {
      throw new HttpsError(
        'failed-precondition',
        'This application cannot be approved while M2 compliance status is "blocked". ' +
        'Resolve the blocking compliance checks first or choose Reject / AmendmentRequested.',
      );
    }
    const readiness = assessment?.assessmentReadiness;
    const isProvisional = readiness === 'provisional' || readiness === 'insufficient_data';
    if (isProvisional && rationale.trim().length < PROVISIONAL_MIN_RATIONALE) {
      throw new HttpsError(
        'invalid-argument',
        `When the assessment is ${readiness}, the decision rationale must explain the gap ` +
        `(at least ${PROVISIONAL_MIN_RATIONALE} characters).`,
      );
    }
    // ---- end M3 gates ----

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
      metadata: {
        authorityType: profile.authorityType,
        decision,
        complianceStatus: assessment?.complianceStatus ?? null,
        assessmentReadiness: assessment?.assessmentReadiness ?? null,
      },
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

    if (event.organizerId) {
      const ctx: { organizerId: string; aggregateStatus: EventRecord['status']; authorityType: AuthorityType; versionId: string } = {
        organizerId: event.organizerId,
        aggregateStatus,
        authorityType: profile.authorityType,
        versionId,
      };
      notifCtxOut = ctx;
    }

    return { eventId, versionId, decisionId, decision, status: aggregateStatus, idempotent: false };
  });

  // ---- Notify the organiser (FR-M3-08, handoff item 7) ----
  // Idempotent on sourceActionId. A notification write failure MUST NOT
  // roll back a recorded decision.
  const notif = notifCtxOut as { organizerId: string; aggregateStatus: EventRecord['status']; authorityType: AuthorityType; versionId: string } | null;
  if (notif) {
    try {
      const notifType =
        notif.aggregateStatus === 'Approved' ? 'application_approved'
        : notif.aggregateStatus === 'Rejected' ? 'application_rejected'
        : notif.aggregateStatus === 'AmendmentRequested' ? 'amendment_requested'
        : 'decision_made';
      const notifTitle =
        notif.aggregateStatus === 'Approved' ? 'Application approved'
        : notif.aggregateStatus === 'Rejected' ? 'Application rejected'
        : notif.aggregateStatus === 'AmendmentRequested' ? 'Amendment requested'
        : 'Decision recorded';
      await createNotification({
        recipientUid: notif.organizerId,
        eventId,
        versionId: notif.versionId,
        type: notifType,
        title: notifTitle,
        message: `${notif.authorityType} ${decision} the application. See audit trail for rationale.`,
        sourceActionId: `${result.decisionId}_notif`,
      });
    } catch (err) {
      console.warn('[makeAuthorityDecision] notification write failed (non-fatal):', err);
    }
  }

  return result;
}

export function validateDecisionRequest(request: unknown): { eventId: string; decision: DecisionValue; rationale: string } {
  const value = typeof request === 'object' && request !== null ? request as Record<string, unknown> : {};
  const eventId = typeof value.eventId === 'string' ? value.eventId.trim() : '';
  const decision = value.decision;
  const rationale = typeof value.rationale === 'string' ? value.rationale.trim() : '';
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!isDecision(decision)) throw new HttpsError('invalid-argument', 'A valid decision is required.');
  if (rationale.length < STANDARD_MIN_RATIONALE || rationale.length > 1_000) {
    throw new HttpsError('invalid-argument', `Rationale must be between ${STANDARD_MIN_RATIONALE} and 1,000 characters.`);
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
