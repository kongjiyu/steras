"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyStage1Doc = void 0;
exports.verifyStage1DocForUser = verifyStage1DocForUser;
/**
 * verifyStage1Doc — server-mediated Stage 1 document verification
 * (FR-M3-22, FR-M3-23, Q1 refactor).
 *
 * Replaces the old `verifyEventControl` which operated on the flat
 * `event_controls/{id}` doc. The new flow operates on a per-doc
 * sub-collection: each control item has N Stage 1 docs (e.g. an
 * application letter, a licence, an insurance policy) and the officer
 * verifies them one at a time.
 *
 * Behaviour:
 *   - Officer must be assigned to the event's `requiredAuthorities`.
 *   - The target Stage 1 doc must exist and be in `pending_verification`.
 *   - Updates the doc with status, verifiedBy, verifiedAt, rejectionReason.
 *   - Recomputes the parent control item's aggregate `label`
 *     (approved / pending / resubmit_required) from its stage1 docs.
 *   - Maintains `event.verifiedControlIds` (a control is included only
 *     when ALL its stage1 docs are verified).
 *   - Writes an audit log + fires a notification to the organiser.
 *   - Idempotent on (eventId, controlId, docId, versionId) — same status
 *     + rationale + reviewer = no-op.
 *
 * The Stage 1 doc carries the verification provenance directly:
 *   { status, verifiedBy, verifiedAt, rejectionReason, rejectionSuggestion }
 *
 * Stage 2 docs are public-verified (not officer-verified); see
 * `confirmStage2Doc` in Workstream 4.
 */
const firebase_admin_1 = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
const notifications_1 = require("../utils/notifications");
const controlAggregate_1 = require("../utils/controlAggregate");
const RATIONALE_MIN = 10;
const RATIONALE_MAX = 1_000;
exports.verifyStage1Doc = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before verifying a Stage 1 document.');
    try {
        return await verifyStage1DocForUser(request.auth.uid, request.data);
    }
    catch (err) {
        if (err instanceof https_1.HttpsError) {
            console.warn(`[verifyStage1Doc] HttpsError ${err.code}: ${err.message}`);
            throw err;
        }
        const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
        console.error(`[verifyStage1Doc] unexpected error: ${message}`);
        throw new https_1.HttpsError('internal', message.slice(0, 500));
    }
});
async function verifyStage1DocForUser(uid, data, now = Date.now()) {
    const eventId = (data.eventId ?? '').trim();
    const controlId = (data.controlId ?? '').trim();
    const docId = (data.docId ?? '').trim();
    const status = data.status;
    const rationale = (data.rationale ?? '').trim();
    const evidencePath = (data.evidencePath ?? '').trim() || undefined;
    if (!eventId)
        throw new https_1.HttpsError('invalid-argument', 'eventId is required.');
    if (!controlId)
        throw new https_1.HttpsError('invalid-argument', 'controlId is required.');
    if (!docId)
        throw new https_1.HttpsError('invalid-argument', 'docId is required.');
    if (status !== 'verified' && status !== 'rejected') {
        throw new https_1.HttpsError('invalid-argument', 'status must be "verified" or "rejected".');
    }
    if (rationale.length < RATIONALE_MIN || rationale.length > RATIONALE_MAX) {
        throw new https_1.HttpsError('invalid-argument', `Rationale must be between ${RATIONALE_MIN} and ${RATIONALE_MAX} characters.`);
    }
    const db = (0, firebase_admin_1.firestore)();
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const userRef = db.collection(types_1.COLLECTIONS.USERS).doc(uid);
    return db.runTransaction(async (tx) => {
        // Reads first (Firestore requires all reads before all writes).
        const [userSnap, eventSnap, controlSnap, docSnap, assignmentsSnap] = await Promise.all([
            tx.get(userRef),
            tx.get(eventRef),
            tx.get(eventRef.collection(types_1.COLLECTIONS.EVENT_CONTROLS).doc(controlId)),
            tx.get(eventRef.collection(types_1.COLLECTIONS.EVENT_CONTROLS).doc(controlId).collection(types_1.COLLECTIONS.STAGE1_DOCS).doc(docId)),
            tx.get(eventRef.collection(types_1.COLLECTIONS.ASSIGNMENTS)),
        ]);
        const profile = userSnap.data();
        if (!profile || profile.role !== 'authority' || !profile.authorityType) {
            throw new https_1.HttpsError('permission-denied', 'Only provisioned authority accounts can verify Stage 1 documents.');
        }
        if (!eventSnap.exists)
            throw new https_1.HttpsError('not-found', 'Event application was not found.');
        const event = eventSnap.data();
        const assignment = assignmentsSnap.docs
            .map((snapshot) => snapshot.data())
            .find((candidate) => candidate.versionId === event.currentVersionId
            && candidate.authorityType === profile.authorityType
            && candidate.officerUid === uid
            && (candidate.status === 'pending' || candidate.status === 'in_progress'));
        if (!assignment) {
            throw new https_1.HttpsError('permission-denied', 'You are not the named officer assigned to this application.');
        }
        if (!controlSnap.exists) {
            throw new https_1.HttpsError('not-found', `Control ${controlId} was not found for this event.`);
        }
        const control = controlSnap.data();
        if (control.authority !== profile.authorityType) {
            throw new https_1.HttpsError('permission-denied', `This control belongs to ${control.authority}, not ${profile.authorityType}.`);
        }
        if (!docSnap.exists) {
            throw new https_1.HttpsError('not-found', `Stage 1 document ${docId} was not found for control ${controlId}.`);
        }
        const doc = docSnap.data();
        if (doc.status === 'pending_submission') {
            throw new https_1.HttpsError('failed-precondition', 'The organiser has not uploaded this Stage 1 document yet.');
        }
        if (doc.status === 'use_previous') {
            throw new https_1.HttpsError('failed-precondition', 'This Stage 1 document uses a prior receipt and does not need officer verification.');
        }
        if (doc.status === 'verified' || doc.status === 'rejected') {
            if (doc.status === status && doc.verifiedBy === uid && doc.rejectionReason === rationale) {
                return { eventId, controlId, docId, status, idempotent: true };
            }
            throw new https_1.HttpsError('failed-precondition', `This Stage 1 document is already ${doc.status}.`);
        }
        // doc.status === 'pending_verification' — proceed.
        // Read all stage1_docs for this control to recompute the aggregate label.
        const allDocsSnap = await tx.get(eventRef.collection(types_1.COLLECTIONS.EVENT_CONTROLS).doc(controlId).collection(types_1.COLLECTIONS.STAGE1_DOCS));
        const allDocs = allDocsSnap.docs.map((d) => d.data());
        const updatedDoc = { ...doc, status, verifiedBy: uid, verifiedAt: now };
        if (status === 'rejected') {
            updatedDoc.rejectionReason = rationale;
        }
        else {
            // Clear any prior rejection reason on a successful verify
            updatedDoc.rejectionReason = '';
        }
        if (evidencePath) {
            // Stash the evidence path on the doc so it's persisted with the
            // verification (per FR-M3-22). The Stage1Doc type doesn't have
            // evidencePath yet, so we use the filePath field.
            updatedDoc.filePath = evidencePath;
        }
        // Recompute the aggregate (with the updated doc in the picture).
        const merged = allDocs.map((d) => (d.docId === docId ? updatedDoc : d));
        const newAggregateLabel = (0, controlAggregate_1.aggregateLabel)(merged);
        const wasAllVerified = allDocs.every((d) => d.status === 'verified' || d.status === 'use_previous');
        const isAllVerifiedNow = merged.every((d) => d.status === 'verified' || d.status === 'use_previous');
        // Writes.
        tx.set(docSnap.ref, updatedDoc, { merge: true });
        tx.update(controlSnap.ref, { label: newAggregateLabel, updatedAt: now });
        // Maintain event.verifiedControlIds.
        const existingVerified = (event.verifiedControlIds ?? []);
        let nextVerified = existingVerified;
        if (isAllVerifiedNow && !wasAllVerified) {
            nextVerified = [...existingVerified.filter((id) => id !== controlId), controlId];
        }
        else if (!isAllVerifiedNow && wasAllVerified) {
            nextVerified = existingVerified.filter((id) => id !== controlId);
        }
        if (nextVerified !== existingVerified) {
            tx.update(eventRef, { verifiedControlIds: nextVerified, updatedAt: now });
        }
        // Audit log.
        const versionId = event.currentVersionId ?? 'v1';
        const auditId = `${versionId}_${controlId}_${docId}_${profile.authorityType}_${now}`;
        const auditRef = eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(auditId);
        tx.create(auditRef, {
            id: auditId,
            eventId,
            versionId,
            action: status === 'verified' ? 'control_verified' : 'control_rejected',
            actorId: uid,
            actorRole: 'authority',
            timestamp: now,
            notes: rationale,
            metadata: {
                authorityType: profile.authorityType,
                controlId,
                docId,
                evidencePath: evidencePath ?? null,
                newAggregateLabel,
            },
        });
        return {
            eventId,
            controlId,
            docId,
            status,
            idempotent: false,
            organizerId: event.organizerId,
            authorityType: profile.authorityType,
            controlName: control.controlName,
            versionId,
            newAggregateLabel,
        };
    }).then(async (result) => {
        if (result.organizerId) {
            try {
                const recipientUid = await (0, notifications_1.resolveAuthUid)(result.organizerId);
                if (!recipientUid) {
                    console.warn(`[verifyStage1Doc] skipping notification: no recipientUid for organizerId=${result.organizerId}`);
                }
                else {
                    await (0, notifications_1.createNotification)({
                        recipientUid,
                        eventId: result.eventId,
                        versionId: result.versionId,
                        type: result.status === 'verified' ? 'stage1_doc_approved' : 'stage1_doc_rejected',
                        title: result.status === 'verified' ? 'Stage 1 document approved' : 'Stage 1 document rejected',
                        message: `${result.authorityType} ${result.status} ${result.controlName}.`,
                        sourceActionId: `${result.eventId}_${result.controlId}_${result.docId}_${now}`,
                    });
                }
            }
            catch (err) {
                console.warn('[verifyStage1Doc] notification write failed (non-fatal):', err);
            }
        }
        return {
            eventId: result.eventId,
            controlId: result.controlId,
            docId: result.docId,
            status: result.status,
            newAggregateLabel: result.newAggregateLabel,
            idempotent: result.idempotent,
        };
    });
}
//# sourceMappingURL=verifyStage1Doc.js.map