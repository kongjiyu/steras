"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishStage2Doc = void 0;
exports.publishStage2DocForUser = publishStage2DocForUser;
exports.buildPublicEventControl = buildPublicEventControl;
/**
 * publishStage2Doc — admin-only Stage 2 publish (Workstream 5, FR-M3-21, UC-14).
 *
 *   The admin reviews the organizer's Stage 2 image and either
 *   publishes it (makes it visible to the public) or rejects it (with
 *   a reason; the organizer can re-upload). This is the admin publish
 *   gate that lets us tighten the `stage2_docs` Firestore rule back to
 *   a per-doc `published == true` check.
 *
 *   - Caller is signed in + is the admin for the project.
 *   - The Stage 2 doc exists for the current `versionId` AND the
 *     control requires Stage 2.
 *   - Sets `published: true` + `publishedAt` + `publishedBy` on the
 *     Stage 2 doc.
 *   - Clears any prior rejection fields (so a publish-after-reject
 *     leaves a clean slate).
 *   - Writes a `stage2_doc_published` audit log entry.
 *   - Notifies the organizer.
 *
 *   The companion function `unpublishStage2Doc` handles the reject /
 *   unpublish side (sets `published: false` + rejection fields + a
 *   `stage2_doc_rejected` audit + organizer notification).
 */
const firebase_admin_1 = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
const notifications_1 = require("../utils/notifications");
exports.publishStage2Doc = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before publishing.');
    try {
        return await publishStage2DocForUser(request.auth.uid, request.data);
    }
    catch (err) {
        if (err instanceof https_1.HttpsError) {
            console.warn(`[publishStage2Doc] HttpsError ${err.code}: ${err.message}`);
            throw err;
        }
        const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
        console.error(`[publishStage2Doc] unexpected error: ${message}`);
        throw new https_1.HttpsError('internal', message.slice(0, 500));
    }
});
async function publishStage2DocForUser(uid, data, now = Date.now()) {
    const eventId = (data.eventId ?? '').trim();
    const controlId = (data.controlId ?? '').trim();
    if (!eventId)
        throw new https_1.HttpsError('invalid-argument', 'eventId is required.');
    if (!controlId)
        throw new https_1.HttpsError('invalid-argument', 'controlId is required.');
    const db = (0, firebase_admin_1.firestore)();
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const controlRef = eventRef.collection(types_1.COLLECTIONS.EVENT_CONTROLS).doc(controlId);
    const docId = `${controlId}-s2`;
    const docRef = controlRef.collection(types_1.COLLECTIONS.STAGE2_DOCS).doc(docId);
    const publicControlId = `${controlId}-stage2`;
    const publicRef = db.collection(types_1.COLLECTIONS.PUBLIC_EVENT_CONTROLS)
        .doc(eventId)
        .collection(types_1.COLLECTIONS.PUBLIC_EVENT_CONTROL_ITEMS)
        .doc(publicControlId);
    const userRef = db.collection(types_1.COLLECTIONS.USERS).doc(uid);
    const result = await db.runTransaction(async (tx) => {
        const [userSnap, eventSnap, controlSnap, docSnap, publicSnap] = await Promise.all([
            tx.get(userRef),
            tx.get(eventRef),
            tx.get(controlRef),
            tx.get(docRef),
            tx.get(publicRef),
        ]);
        if (!userSnap.exists)
            throw new https_1.HttpsError('permission-denied', 'User profile not found.');
        const profile = userSnap.data();
        if (profile.role !== 'admin') {
            throw new https_1.HttpsError('permission-denied', 'Only an admin can publish Stage 2 images.');
        }
        if (!eventSnap.exists)
            throw new https_1.HttpsError('not-found', 'Event not found.');
        const event = eventSnap.data();
        const versionId = event.currentVersionId ?? 'v1';
        if (!controlSnap.exists)
            throw new https_1.HttpsError('not-found', `Control ${controlId} not found.`);
        const control = controlSnap.data();
        if (control.versionId !== versionId) {
            throw new https_1.HttpsError('failed-precondition', `Control ${controlId} is for a prior version. The admin must re-commit the list.`);
        }
        if (!control.stage2Requirement) {
            throw new https_1.HttpsError('failed-precondition', `Control ${controlId} does not require Stage 2.`);
        }
        if (!docSnap.exists) {
            throw new https_1.HttpsError('not-found', 'No Stage 2 image has been uploaded yet for this control.');
        }
        const stage2 = docSnap.data();
        if (stage2.published === true) {
            // Idempotent: already published, return the existing publishedAt.
            if (!publicSnap.exists) {
                tx.set(publicRef, buildPublicEventControl({
                    publicControlId,
                    eventId,
                    versionId,
                    controlId,
                    docId,
                    control,
                    stage2,
                    publishedAt: stage2.publishedAt ?? now,
                    publishedBy: stage2.publishedBy ?? uid,
                    sanitizedAt: stage2.publishedAt ?? now,
                }));
            }
            return {
                alreadyPublished: true,
                publishedAt: stage2.publishedAt ?? now,
                organizerUid: event.organizerId,
                authorityType: control.authority,
                controlName: control.controlName,
                versionId,
            };
        }
        if (stage2.m4TicketId) {
            throw new https_1.HttpsError('failed-precondition', 'A public report is open for this Stage 2 image. Wait for M4 to resolve the ticket before publishing.');
        }
        // Publish: set the published flags, clear any prior rejection fields.
        tx.update(docRef, {
            published: true,
            publishedAt: now,
            publishedBy: uid,
            // Clear rejection fields so the organizer + admin UI sees a clean slate.
            rejectionReason: firebase_admin_1.firestore.FieldValue.delete(),
            rejectionAt: firebase_admin_1.firestore.FieldValue.delete(),
            rejectedBy: firebase_admin_1.firestore.FieldValue.delete(),
        });
        // Public viewers read this sanitised projection, never the private
        // organiser/officer document. The image is explicitly selected by the
        // admin at this boundary; no organiser identity or private metadata is
        // copied into the public record.
        tx.set(publicRef, buildPublicEventControl({
            publicControlId,
            eventId,
            versionId,
            controlId,
            docId,
            control,
            stage2,
            publishedAt: now,
            publishedBy: uid,
            sanitizedAt: now,
        }));
        // Audit log.
        const auditId = `${versionId}_${controlId}_stage2_published_${uid}_${now}`;
        const auditRef = eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(auditId);
        tx.create(auditRef, {
            id: auditId,
            eventId,
            versionId,
            action: 'stage2_doc_published',
            actorId: uid,
            actorRole: 'admin',
            timestamp: now,
            notes: `Published Stage 2 image for ${control.authority}.`,
            metadata: {
                controlId,
                docId,
                authorityType: control.authority,
            },
        });
        return {
            alreadyPublished: false,
            publishedAt: now,
            organizerUid: event.organizerId,
            authorityType: control.authority,
            controlName: control.controlName,
            versionId,
        };
    });
    // Notify the organizer (outside the transaction). No-op if the doc
    // was already published (idempotent path).
    if (!result.alreadyPublished) {
        const organizerAuthUid = await (0, notifications_1.resolveAuthUid)(result.organizerUid);
        if (organizerAuthUid) {
            const sourceActionId = `${eventId}_${controlId}_stage2_published_${result.publishedAt}`;
            try {
                await (0, notifications_1.createNotification)({
                    recipientUid: organizerAuthUid,
                    eventId,
                    versionId: result.versionId,
                    type: 'stage2_doc_published',
                    title: 'Stage 2 image published',
                    message: `${result.authorityType}: your Stage 2 image for "${result.controlName}" has been published. Public verification (👍 confirm / 🚩 report) is now open.`,
                    sourceActionId,
                    notificationId: `${sourceActionId}_${organizerAuthUid}`,
                });
            }
            catch (err) {
                console.warn(`[publishStage2Doc] organizer notification failed (non-fatal):`, err);
            }
        }
    }
    return { published: true, publishedAt: result.publishedAt };
}
function buildPublicEventControl(args) {
    return {
        publicControlId: args.publicControlId,
        eventId: args.eventId,
        versionId: args.versionId,
        controlId: args.controlId,
        docId: args.docId,
        authority: args.control.authority,
        controlName: args.control.controlName,
        stage2Label: args.control.stage2Requirement?.label ?? 'Visual evidence',
        imageUrl: args.stage2.imageUrl,
        publicConfirmCount: args.stage2.publicConfirmCount ?? 0,
        ...(args.stage2.m4TicketId ? { reported: true } : { reported: false }),
        publishedAt: args.publishedAt,
        sanitized: true,
        sanitizedAt: args.sanitizedAt,
        // Do not expose the admin's auth UID in a public document.
        sanitizedBy: 'system',
    };
}
//# sourceMappingURL=publishStage2Doc.js.map