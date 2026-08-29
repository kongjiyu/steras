"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelEvent = exports.prepareApplicationRevision = void 0;
exports.validateEventId = validateEventId;
exports.lifecycleRevisionSource = lifecycleRevisionSource;
exports.hasCanonicalCurrentVersion = hasCanonicalCurrentVersion;
exports.hasValidActiveRevision = hasValidActiveRevision;
exports.isMatchingSubmittedVersion = isMatchingSubmittedVersion;
exports.isBeforeAdminReview = isBeforeAdminReview;
exports.prepareApplicationRevisionForUser = prepareApplicationRevisionForUser;
exports.cancelEventForUser = cancelEventForUser;
const firebase_admin_1 = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const m1TemplateContract_1 = require("../../../shared/m1TemplateContract");
const m1EvidenceContract_1 = require("../../../shared/m1EvidenceContract");
const runtime_1 = require("../config/runtime");
exports.prepareApplicationRevision = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before editing an application.');
    return prepareApplicationRevisionForUser(request.auth.uid, validateEventId(request.data));
});
exports.cancelEvent = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before cancelling an application.');
    return cancelEventForUser(request.auth.uid, validateEventId(request.data));
});
function validateEventId(value) {
    const record = value && typeof value === 'object' ? value : {};
    const eventId = typeof record.eventId === 'string' ? record.eventId.trim() : '';
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(eventId))
        throw new https_1.HttpsError('invalid-argument', 'A valid eventId is required.');
    if (Object.keys(record).some((key) => key !== 'eventId'))
        throw new https_1.HttpsError('invalid-argument', 'The request contains unsupported fields.');
    return eventId;
}
function lifecycleRevisionSource(event, now) {
    if (!hasCanonicalCurrentVersion(event))
        return undefined;
    const sourceVersionId = event.currentVersionId;
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
function hasCanonicalCurrentVersion(event) {
    return Number.isSafeInteger(event.currentVersionNumber)
        && event.currentVersionNumber >= 1
        && event.currentVersionId === `v${event.currentVersionNumber}`;
}
function hasValidActiveRevision(event) {
    const revision = event.activeRevision;
    if (!revision || !hasCanonicalCurrentVersion(event)
        || revision.sourceVersionId !== event.currentVersionId
        || !Number.isFinite(revision.startedAt))
        return false;
    return revision.kind === 'pending_edit'
        ? revision.rejectionReason === undefined && revision.rejectionSuggestion === undefined
        : revision.kind === 'rejected_revision'
            && typeof revision.rejectionReason === 'string' && revision.rejectionReason.trim().length > 0
            && typeof revision.rejectionSuggestion === 'string' && revision.rejectionSuggestion.trim().length > 0;
}
function isMatchingSubmittedVersion(eventId, event, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !hasCanonicalCurrentVersion(event))
        return false;
    const version = value;
    return version.eventId === eventId
        && version.versionId === event.currentVersionId
        && version.versionNumber === event.currentVersionNumber;
}
function isBeforeAdminReview(event) {
    return event.status === 'Pending'
        && !event.initialReview
        && (event.reviewStage === undefined || event.reviewStage === null || event.reviewStage === 'initial')
        && (event.assignedOfficerUids?.length ?? 0) === 0
        && Object.keys(event.assignedOfficerByAuthority ?? {}).length === 0;
}
async function prepareApplicationRevisionForUser(uid, eventId, now = Date.now()) {
    const db = (0, firebase_admin_1.firestore)();
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const userRef = db.collection(types_1.COLLECTIONS.USERS).doc(uid);
    return db.runTransaction(async (transaction) => {
        const [eventSnap, userSnap] = await Promise.all([transaction.get(eventRef), transaction.get(userRef)]);
        if (!eventSnap.exists)
            throw new https_1.HttpsError('not-found', 'Event application was not found.');
        const user = userSnap.data();
        const event = { eventId, ...eventSnap.data() };
        if (user?.role !== 'organizer')
            throw new https_1.HttpsError('permission-denied', 'Only organizer accounts can edit applications.');
        if (event.organizerId !== uid)
            throw new https_1.HttpsError('permission-denied', 'You do not own this event.');
        if (!hasCanonicalCurrentVersion(event)) {
            throw new https_1.HttpsError('failed-precondition', 'The submitted application version is invalid.');
        }
        const sourceVersionSnap = await transaction.get(eventRef.collection(types_1.COLLECTIONS.VERSIONS).doc(event.currentVersionId));
        if (!sourceVersionSnap.exists || !isMatchingSubmittedVersion(eventId, event, sourceVersionSnap.data())) {
            throw new https_1.HttpsError('failed-precondition', 'The immutable submitted application version is missing or invalid.');
        }
        const expectedEditableVersionId = `v${event.currentVersionNumber + 1}`;
        const activeRevision = event.activeRevision;
        if (event.status === 'Draft' && activeRevision && hasValidActiveRevision(event) && event.editableVersionId === expectedEditableVersionId) {
            return { eventId, status: 'Draft', editableVersionId: expectedEditableVersionId, revisionKind: activeRevision.kind };
        }
        const revision = lifecycleRevisionSource(event, now);
        if (!revision)
            throw new https_1.HttpsError('failed-precondition', 'This application cannot be edited in its current review state.');
        if (!(0, m1TemplateContract_1.isValidM1TemplateSelection)(event.templateSelection)) {
            throw new https_1.HttpsError('failed-precondition', 'This application uses a legacy template selection and cannot be revised in place.');
        }
        const auditId = `${revision.kind}_${revision.sourceVersionId}`;
        transaction.update(eventRef, {
            status: 'Draft',
            editableVersionId: expectedEditableVersionId,
            activeRevision: revision,
            draftDocumentPaths: [],
            draftDocuments: [],
            documentSchemaVersion: types_1.M1_DOCUMENT_SCHEMA_VERSION,
            currentExtractionId: firestore_1.FieldValue.delete(),
            draftEvidenceManifest: (0, m1EvidenceContract_1.createM1EvidenceManifestDraft)(event.templateSelection.scenarioTemplateId, event.eventDetails.riskProfile),
            evidenceManifestSchemaVersion: types_1.M1_EVIDENCE_MANIFEST_SCHEMA_VERSION,
            assignedOfficerUids: [],
            assignedOfficerByAuthority: {},
            reviewStage: null,
            updatedAt: now,
        });
        transaction.create(eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(auditId), {
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
        return { eventId, status: 'Draft', editableVersionId: expectedEditableVersionId, revisionKind: revision.kind };
    });
}
async function cancelEventForUser(uid, eventId, now = Date.now()) {
    const db = (0, firebase_admin_1.firestore)();
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const userRef = db.collection(types_1.COLLECTIONS.USERS).doc(uid);
    return db.runTransaction(async (transaction) => {
        const [eventSnap, userSnap] = await Promise.all([transaction.get(eventRef), transaction.get(userRef)]);
        if (!eventSnap.exists)
            throw new https_1.HttpsError('not-found', 'Event application was not found.');
        const user = userSnap.data();
        const event = { eventId, ...eventSnap.data() };
        if (user?.role !== 'organizer')
            throw new https_1.HttpsError('permission-denied', 'Only organizer accounts can cancel applications.');
        if (event.organizerId !== uid)
            throw new https_1.HttpsError('permission-denied', 'You do not own this event.');
        if (event.status === 'Cancelled')
            return { eventId, status: 'Cancelled' };
        if (!isBeforeAdminReview(event) || !hasCanonicalCurrentVersion(event) || !event.currentVersionId) {
            throw new https_1.HttpsError('failed-precondition', 'Only a Pending application can be cancelled before Admin review begins.');
        }
        const sourceVersionSnap = await transaction.get(eventRef.collection(types_1.COLLECTIONS.VERSIONS).doc(event.currentVersionId));
        if (!sourceVersionSnap.exists || !isMatchingSubmittedVersion(eventId, event, sourceVersionSnap.data())) {
            throw new https_1.HttpsError('failed-precondition', 'The immutable submitted application version is missing or invalid.');
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
        transaction.create(eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(auditId), {
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
        return { eventId, status: 'Cancelled' };
    });
}
//# sourceMappingURL=applicationLifecycle.js.map