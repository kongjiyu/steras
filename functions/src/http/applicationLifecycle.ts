import { firestore } from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  COLLECTIONS,
  EventRecord,
  M1_DOCUMENT_SCHEMA_VERSION,
  M1_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  M1ApplicationRevisionSource,
  UserProfile,
} from '@shared/types';
import { isValidM1TemplateSelection } from '@shared/m1TemplateContract';
import { createM1EvidenceManifestDraft } from '@shared/m1EvidenceContract';
import { FUNCTION_REGION } from '../config/runtime';

interface EventLifecycleRequest { eventId?: string }

export const prepareApplicationRevision = onCall<EventLifecycleRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before editing an application.');
  return prepareApplicationRevisionForUser(request.auth.uid, validateEventId(request.data));
});

export const cancelEvent = onCall<EventLifecycleRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before cancelling an application.');
  return cancelEventForUser(request.auth.uid, validateEventId(request.data));
});

export function validateEventId(value: unknown): string {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const eventId = typeof record.eventId === 'string' ? record.eventId.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(eventId)) throw new HttpsError('invalid-argument', 'A valid eventId is required.');
  if (Object.keys(record).some((key) => key !== 'eventId')) throw new HttpsError('invalid-argument', 'The request contains unsupported fields.');
  return eventId;
}

export function lifecycleRevisionSource(event: EventRecord, now: number): M1ApplicationRevisionSource | undefined {
  if (!hasCanonicalCurrentVersion(event)) return undefined;
  const sourceVersionId = event.currentVersionId!;
  if (event.status === 'Pending' && isBeforeAdminReview(event)) {
    return { kind: 'pending_edit', sourceVersionId, startedAt: now };
  }
  if (event.status === 'Rejected'
    && event.initialReview?.decision === 'Rejected'
    && event.initialReview.reason.trim().length > 0
    && event.initialReview.suggestion?.trim()) {
    return {
      kind: 'rejected_revision',
      sourceVersionId,
      startedAt: now,
      rejectionReason: event.initialReview.reason.trim(),
      rejectionSuggestion: event.initialReview.suggestion.trim(),
    };
  }
  return undefined;
}

export function hasCanonicalCurrentVersion(event: EventRecord): boolean {
  return Number.isSafeInteger(event.currentVersionNumber)
    && event.currentVersionNumber >= 1
    && event.currentVersionId === `v${event.currentVersionNumber}`;
}

export function hasValidActiveRevision(event: EventRecord): boolean {
  const revision = event.activeRevision;
  if (!revision || !hasCanonicalCurrentVersion(event)
    || revision.sourceVersionId !== event.currentVersionId
    || !Number.isFinite(revision.startedAt)) return false;
  return revision.kind === 'pending_edit'
    ? revision.rejectionReason === undefined && revision.rejectionSuggestion === undefined
    : revision.kind === 'rejected_revision'
      && typeof revision.rejectionReason === 'string' && revision.rejectionReason.trim().length > 0
      && typeof revision.rejectionSuggestion === 'string' && revision.rejectionSuggestion.trim().length > 0;
}

export function isMatchingSubmittedVersion(eventId: string, event: EventRecord, value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !hasCanonicalCurrentVersion(event)) return false;
  const version = value as Record<string, unknown>;
  return version.eventId === eventId
    && version.versionId === event.currentVersionId
    && version.versionNumber === event.currentVersionNumber;
}

export function isBeforeAdminReview(event: EventRecord): boolean {
  return event.status === 'Pending'
    && !event.initialReview
    && (event.reviewStage === undefined || event.reviewStage === null || event.reviewStage === 'initial')
    && (event.assignedOfficerUids?.length ?? 0) === 0
    && Object.keys(event.assignedOfficerByAuthority ?? {}).length === 0;
}

export async function prepareApplicationRevisionForUser(uid: string, eventId: string, now = Date.now()) {
  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const userRef = db.collection(COLLECTIONS.USERS).doc(uid);
  return db.runTransaction(async (transaction) => {
    const [eventSnap, userSnap] = await Promise.all([transaction.get(eventRef), transaction.get(userRef)]);
    if (!eventSnap.exists) throw new HttpsError('not-found', 'Event application was not found.');
    const user = userSnap.data() as UserProfile | undefined;
    const event = { eventId, ...eventSnap.data() } as EventRecord;
    if (user?.role !== 'organizer') throw new HttpsError('permission-denied', 'Only organizer accounts can edit applications.');
    if (event.organizerId !== uid) throw new HttpsError('permission-denied', 'You do not own this event.');

    if (!hasCanonicalCurrentVersion(event)) {
      throw new HttpsError('failed-precondition', 'The submitted application version is invalid.');
    }
    const sourceVersionSnap = await transaction.get(eventRef.collection(COLLECTIONS.VERSIONS).doc(event.currentVersionId!));
    if (!sourceVersionSnap.exists || !isMatchingSubmittedVersion(eventId, event, sourceVersionSnap.data())) {
      throw new HttpsError('failed-precondition', 'The immutable submitted application version is missing or invalid.');
    }
    const expectedEditableVersionId = `v${event.currentVersionNumber + 1}`;
    const activeRevision = event.activeRevision;
    if (event.status === 'Draft' && activeRevision && hasValidActiveRevision(event) && event.editableVersionId === expectedEditableVersionId) {
      return { eventId, status: 'Draft' as const, editableVersionId: expectedEditableVersionId, revisionKind: activeRevision.kind };
    }
    const revision = lifecycleRevisionSource(event, now);
    if (!revision) throw new HttpsError('failed-precondition', 'This application cannot be edited in its current review state.');
    if (!isValidM1TemplateSelection(event.templateSelection)) {
      throw new HttpsError('failed-precondition', 'This application uses a legacy template selection and cannot be revised in place.');
    }
    const auditId = `${revision.kind}_${revision.sourceVersionId}`;
    transaction.update(eventRef, {
      status: 'Draft',
      editableVersionId: expectedEditableVersionId,
      activeRevision: revision,
      draftDocumentPaths: [],
      draftDocuments: [],
      documentSchemaVersion: M1_DOCUMENT_SCHEMA_VERSION,
      currentExtractionId: FieldValue.delete(),
      draftEvidenceManifest: createM1EvidenceManifestDraft(event.templateSelection.scenarioTemplateId, event.eventDetails.riskProfile),
      evidenceManifestSchemaVersion: M1_EVIDENCE_MANIFEST_SCHEMA_VERSION,
      assignedOfficerUids: [],
      assignedOfficerByAuthority: {},
      reviewStage: null,
      updatedAt: now,
    });
    transaction.create(eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId), {
      id: auditId,
      eventId,
      versionId: revision.sourceVersionId,
      action: revision.kind === 'pending_edit' ? 'application_edit_started' : 'application_revision_started',
      actorId: uid,
      actorRole: 'organizer',
      timestamp: now,
      previousStatus: event.status,
      newStatus: 'Draft',
      metadata: { editableVersionId: expectedEditableVersionId },
    });
    return { eventId, status: 'Draft' as const, editableVersionId: expectedEditableVersionId, revisionKind: revision.kind };
  });
}

export async function cancelEventForUser(uid: string, eventId: string, now = Date.now()) {
  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const userRef = db.collection(COLLECTIONS.USERS).doc(uid);
  return db.runTransaction(async (transaction) => {
    const [eventSnap, userSnap] = await Promise.all([transaction.get(eventRef), transaction.get(userRef)]);
    if (!eventSnap.exists) throw new HttpsError('not-found', 'Event application was not found.');
    const user = userSnap.data() as UserProfile | undefined;
    const event = { eventId, ...eventSnap.data() } as EventRecord;
    if (user?.role !== 'organizer') throw new HttpsError('permission-denied', 'Only organizer accounts can cancel applications.');
    if (event.organizerId !== uid) throw new HttpsError('permission-denied', 'You do not own this event.');
    if (event.status === 'Cancelled') return { eventId, status: 'Cancelled' as const };
    if (!isBeforeAdminReview(event) || !hasCanonicalCurrentVersion(event) || !event.currentVersionId) {
      throw new HttpsError('failed-precondition', 'Only a Pending application can be cancelled before Admin review begins.');
    }
    const sourceVersionSnap = await transaction.get(eventRef.collection(COLLECTIONS.VERSIONS).doc(event.currentVersionId));
    if (!sourceVersionSnap.exists || !isMatchingSubmittedVersion(eventId, event, sourceVersionSnap.data())) {
      throw new HttpsError('failed-precondition', 'The immutable submitted application version is missing or invalid.');
    }
    const auditId = `application_cancelled_${event.currentVersionId}`;
    transaction.update(eventRef, {
      status: 'Cancelled',
      cancelledAt: now,
      cancelledFromVersionId: event.currentVersionId,
      editableVersionId: null,
      assignedOfficerUids: [],
      assignedOfficerByAuthority: {},
      reviewStage: 'closed',
      updatedAt: now,
    });
    transaction.create(eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId), {
      id: auditId,
      eventId,
      versionId: event.currentVersionId,
      action: 'application_cancelled',
      actorId: uid,
      actorRole: 'organizer',
      timestamp: now,
      previousStatus: event.status,
      newStatus: 'Cancelled',
    });
    return { eventId, status: 'Cancelled' as const };
  });
}
