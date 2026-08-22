"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitStage2Doc = void 0;
exports.submitStage2DocForUser = submitStage2DocForUser;
/**
 * submitStage2Doc — server-mediated Stage 2 image upload by the
 * event's organiser (FR-M3-20 second half, UC-35..38 pre-reqs, Workstream 4).
 *
 *   Stage 2 is the *visual evidence* of the control at the venue
 *   (e.g. a photo of the PDRM officer on site). It's uploaded by the
 *   organiser and publicly verifiable.
 *
 *   Per the Workstream 4 design, the organizer's upload is the publish
 *   event — the image goes out with `published: true` immediately.
 *   Workstream 5 adds the admin "Publish to public" step (with
 *   sanitisation), at which point the admin can unpublish + republish.
 *
 * Behaviour:
 *   - Caller is signed in + is the event's organiser.
 *   - The target EventControl exists for the current `versionId` AND
 *     has a `stage2Requirement` (i.e. the control requires Stage 2).
 *   - The doc is a singleton per control: docId = `${controlId}-s2`.
 *   - File size <= 700 KB binary; mime in {image/jpeg, image/png}.
 *   - The image is stored as a data: URL in `imageUrl` (per project
 *     convention: base64 in Firestore, NOT Firebase Storage).
 *   - On re-upload: overwrite the prior doc; preserve `m4TicketId`
 *     if it exists (so M4's investigation stays anchored to the
 *     same control; the new image becomes the "resubmitted" version).
 *   - Refuse re-upload if the current `m4TicketId` is set
 *     (Q4 confirmed: organizer must wait for M4's outcome to clear
 *     the ticket before re-uploading).
 *
 *   - Writes a `stage2_doc_submitted` audit log entry.
 *   - Notifies the assigned officer (if any) + all admins.
 *
 * Idempotency: the docId is composite (singleton per control). Re-
 * upload overwrites in place.
 */
const firebase_admin_1 = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
const notifications_1 = require("../utils/notifications");
const MAX_FILE_BYTES = 700 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png']);
/** Estimate the decoded size of a base64 string (4 chars -> 3 bytes,
 *  with padding). Used for the file-size gate. */
function approxBase64DecodedBytes(b64) {
    const len = b64.length;
    if (len === 0)
        return 0;
    // Strip any data URL prefix if present (defensive).
    const comma = b64.indexOf(',');
    const clean = comma >= 0 ? b64.slice(comma + 1) : b64;
    const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
    return Math.floor((clean.length * 3) / 4) - padding;
}
exports.submitStage2Doc = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before submitting a Stage 2 image.');
    try {
        return await submitStage2DocForUser(request.auth.uid, request.data);
    }
    catch (err) {
        if (err instanceof https_1.HttpsError) {
            console.warn(`[submitStage2Doc] HttpsError ${err.code}: ${err.message}`);
            throw err;
        }
        const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
        console.error(`[submitStage2Doc] unexpected error: ${message}`);
        throw new https_1.HttpsError('internal', message.slice(0, 500));
    }
});
async function submitStage2DocForUser(uid, data, now = Date.now()) {
    const eventId = (data.eventId ?? '').trim();
    const controlId = (data.controlId ?? '').trim();
    const fileName = (data.fileName ?? '').trim();
    const mimeType = (data.mimeType ?? '').trim();
    const fileBase64 = (data.fileBase64 ?? '').trim();
    const label = (data.label ?? '').trim();
    if (!eventId)
        throw new https_1.HttpsError('invalid-argument', 'eventId is required.');
    if (!controlId)
        throw new https_1.HttpsError('invalid-argument', 'controlId is required.');
    if (!fileName)
        throw new https_1.HttpsError('invalid-argument', 'fileName is required.');
    if (!mimeType || !ALLOWED_MIME.has(mimeType)) {
        throw new https_1.HttpsError('invalid-argument', `mimeType must be one of: ${[...ALLOWED_MIME].join(', ')}.`);
    }
    if (!fileBase64)
        throw new https_1.HttpsError('invalid-argument', 'fileBase64 is required.');
    const approxBytes = approxBase64DecodedBytes(fileBase64);
    if (approxBytes > MAX_FILE_BYTES) {
        throw new https_1.HttpsError('invalid-argument', `File too large: ${approxBytes} bytes. Max ${MAX_FILE_BYTES} bytes (~700 KB). Compress and re-upload.`);
    }
    const db = (0, firebase_admin_1.firestore)();
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const controlRef = eventRef.collection(types_1.COLLECTIONS.EVENT_CONTROLS).doc(controlId);
    const docId = `${controlId}-s2`;
    const docRef = controlRef.collection(types_1.COLLECTIONS.STAGE2_DOCS).doc(docId);
    const publicRef = db.collection(types_1.COLLECTIONS.PUBLIC_EVENT_CONTROLS)
        .doc(eventId)
        .collection(types_1.COLLECTIONS.PUBLIC_EVENT_CONTROL_ITEMS)
        .doc(`${controlId}-stage2`);
    const userRef = db.collection(types_1.COLLECTIONS.USERS).doc(uid);
    const result = await db.runTransaction(async (tx) => {
        // Reads.
        const [userSnap, eventSnap, controlSnap, docSnap] = await Promise.all([
            tx.get(userRef),
            tx.get(eventRef),
            tx.get(controlRef),
            tx.get(docRef),
        ]);
        if (!userSnap.exists)
            throw new https_1.HttpsError('permission-denied', 'User profile not found.');
        const profile = userSnap.data();
        if (profile.role !== 'organizer') {
            throw new https_1.HttpsError('permission-denied', 'Only the event organiser can submit Stage 2 images.');
        }
        if (!eventSnap.exists)
            throw new https_1.HttpsError('not-found', 'Event application was not found.');
        const event = eventSnap.data();
        if (event.organizerId !== uid) {
            throw new https_1.HttpsError('permission-denied', 'You are not the organiser of this event.');
        }
        if (event.controlListGenerated !== true) {
            throw new https_1.HttpsError('failed-precondition', 'The admin has not published the control list yet.');
        }
        if (!controlSnap.exists) {
            throw new https_1.HttpsError('not-found', `Control ${controlId} was not found for this event.`);
        }
        const control = controlSnap.data();
        const versionId = event.currentVersionId ?? 'v1';
        if (control.versionId !== versionId) {
            throw new https_1.HttpsError('failed-precondition', `Control ${controlId} is for a prior version. The admin must re-commit the list.`);
        }
        if (!control.stage2Requirement) {
            throw new https_1.HttpsError('failed-precondition', `Control ${controlId} does not require Stage 2.`);
        }
        const existingDoc = docSnap.exists ? docSnap.data() : null;
        if (existingDoc && existingDoc.m4TicketId) {
            throw new https_1.HttpsError('failed-precondition', 'A report is open for this Stage 2 image. Wait for M4 to resolve the ticket before replacing.');
        }
        // Build the new doc.
        // Workstream 5: the doc is written with `published: false`. An
        // admin must explicitly publish via `publishStage2Doc` before the
        // image goes public (FR-M3-21, UC-14/15). The confirm/report
        // functions gate on `published === true`, so they correctly
        // no-op for pending images. On a re-upload, we also clear any
        // prior rejection fields (so the organizer gets a clean slate).
        const newDoc = {
            docId,
            imageUrl: `data:${mimeType};base64,${fileBase64}`,
            uploadedAt: now,
            uploadedBy: uid,
            publicConfirmCount: 0, // fresh on every upload — the prior image's confirms don't carry over
            published: false,
        };
        // Preserve m4TicketId if it existed (it can't per the Q4 check above, but be defensive).
        if (existingDoc?.m4TicketId)
            newDoc.m4TicketId = existingDoc.m4TicketId;
        if (existingDoc?.reportedAt)
            newDoc.reportedAt = existingDoc.reportedAt;
        // Writes.
        tx.set(docRef, newDoc, { merge: true });
        // A replacement is private until the admin reviews it again. Remove the
        // previous sanitised copy atomically so the old image cannot linger in
        // public view while the new upload is pending.
        tx.delete(publicRef);
        // Audit log.
        const auditId = `${versionId}_${controlId}_stage2_submitted_${now}`;
        const auditRef = eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(auditId);
        tx.create(auditRef, {
            id: auditId,
            eventId,
            versionId,
            action: 'stage2_doc_submitted',
            actorId: uid,
            actorRole: 'organizer',
            timestamp: now,
            notes: label || fileName,
            metadata: {
                controlId,
                docId,
                authorityType: control.authority,
                fileName,
                mimeType,
                fileSizeBytes: approxBytes,
                replaced: existingDoc !== null,
            },
        });
        return {
            eventId,
            controlId,
            docId,
            versionId,
            organizerId: event.organizerId,
            authorityType: control.authority,
            controlName: control.controlName,
            fileName,
            mimeType,
            fileSizeBytes: approxBytes,
            uploadedAt: now,
        };
    });
    // Notifications.
    await fireSubmitStage2Notifications(result);
    return {
        eventId: result.eventId,
        controlId: result.controlId,
        docId: result.docId,
        status: 'pending',
        uploadedAt: result.uploadedAt,
    };
}
async function fireSubmitStage2Notifications(args) {
    const db = (0, firebase_admin_1.firestore)();
    const sourceActionId = `${args.eventId}_${args.controlId}_stage2_submitted_${args.uploadedAt}`;
    const title = 'Stage 2 image submitted (pending admin review)';
    // Workstream 5 — the image is NOT public yet. Notify the assigned
    // officer (FYI) and all admins (action required to publish or reject).
    const baseMessage = `${args.authorityType}: organizer submitted a Stage 2 image for "${args.controlName}". File: ${args.fileName}. The image is pending admin review — public verification starts once an admin publishes it.`;
    // Find the assigned officer for this authority + version.
    const assignmentId = `${args.versionId}_${args.authorityType}`;
    const assignmentRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(args.eventId).collection(types_1.COLLECTIONS.ASSIGNMENTS).doc(assignmentId);
    const assignmentSnap = await assignmentRef.get();
    const officerUid = assignmentSnap.exists ? (assignmentSnap.data().officerUid ?? null) : null;
    // Find all admin users.
    const adminsSnap = await db.collection(types_1.COLLECTIONS.USERS).where('role', '==', 'admin').get();
    const adminUids = adminsSnap.docs.map((d) => d.id);
    const recipients = new Set();
    if (officerUid)
        recipients.add(officerUid);
    for (const uid of adminUids)
        recipients.add(uid);
    if (recipients.size === 0) {
        console.warn(`[submitStage2Doc] no recipients: no officer assigned to ${args.authorityType} for ${args.eventId} v${args.versionId}; no admin users in users/`);
        return;
    }
    await Promise.all([...recipients].map(async (recipientUid) => {
        try {
            await (0, notifications_1.createNotification)({
                recipientUid,
                eventId: args.eventId,
                versionId: args.versionId,
                type: 'stage2_doc_submitted',
                title,
                message: baseMessage,
                sourceActionId,
                // One doc per recipient (otherwise the writes overwrite each
                // other since sourceActionId alone is the doc id).
                notificationId: `${sourceActionId}_${recipientUid}`,
            });
        }
        catch (err) {
            console.warn(`[submitStage2Doc] notification to ${recipientUid} failed (non-fatal):`, err);
        }
    }));
}
//# sourceMappingURL=submitStage2Doc.js.map