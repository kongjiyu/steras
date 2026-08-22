"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportStage2Doc = void 0;
exports.reportStage2DocForUser = reportStage2DocForUser;
/**
 * reportStage2Doc — public report of a published Stage 2 image
 * (FR-M3-29 first half, UC-36, UC-38, Workstream 4).
 *
 *   Any signed-in public viewer can 🚩 a Stage 2 image to indicate
 *   "this doesn't look right." Per A30: 1 report per user per control
 *   (rate-limit; subsequent calls are no-ops).
 *
 *   - Caller is signed in.
 *   - The Stage 2 doc exists with `published === true`.
 *   - Per-user counter doc at `events/{id}/event_controls/{controlId}/
 *     stage2_reports/{uid}` is the rate-limit. If it exists, the call
 *     is a no-op (idempotent — returns the existing ticketId).
 *
 *   - On first report: writes the counter doc + creates a
 *     `public_reports/{ticketId}` doc with `outcome: 'under_review'`
 *     + sets `m4TicketId` + `reportedAt` on the Stage 2 doc + writes
 *     a `stage2_reported` audit log entry + notifies the assigned
 *     officer + all admins + the event organiser.
 *
 *   Workstream 6 (M4 outcome trigger) handles the M4 side: when M4
 *   updates `public_reports/{id}.outcome`, M3 listens and updates
 *   the Stage 2 doc's `label` accordingly.
 */
const firebase_admin_1 = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
const notifications_1 = require("../utils/notifications");
const REPORT_CATEGORIES = ['item_not_at_venue', 'wrong_venue', 'low_quality_image', 'other'];
const DESCRIPTION_MIN = 20;
const DESCRIPTION_MAX = 500;
exports.reportStage2Doc = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before reporting.');
    try {
        return await reportStage2DocForUser(request.auth.uid, request.data);
    }
    catch (err) {
        if (err instanceof https_1.HttpsError) {
            console.warn(`[reportStage2Doc] HttpsError ${err.code}: ${err.message}`);
            throw err;
        }
        const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
        console.error(`[reportStage2Doc] unexpected error: ${message}`);
        throw new https_1.HttpsError('internal', message.slice(0, 500));
    }
});
async function reportStage2DocForUser(uid, data, now = Date.now()) {
    const eventId = (data.eventId ?? '').trim();
    const controlId = (data.controlId ?? '').trim();
    const category = (data.category ?? '').trim();
    const description = (data.description ?? '').trim();
    if (!eventId)
        throw new https_1.HttpsError('invalid-argument', 'eventId is required.');
    if (!controlId)
        throw new https_1.HttpsError('invalid-argument', 'controlId is required.');
    if (!REPORT_CATEGORIES.includes(category)) {
        throw new https_1.HttpsError('invalid-argument', `category must be one of: ${REPORT_CATEGORIES.join(', ')}.`);
    }
    if (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX) {
        throw new https_1.HttpsError('invalid-argument', `description must be between ${DESCRIPTION_MIN} and ${DESCRIPTION_MAX} characters.`);
    }
    const db = (0, firebase_admin_1.firestore)();
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const controlRef = eventRef.collection(types_1.COLLECTIONS.EVENT_CONTROLS).doc(controlId);
    const docId = `${controlId}-s2`;
    const docRef = controlRef.collection(types_1.COLLECTIONS.STAGE2_DOCS).doc(docId);
    const counterRef = controlRef.collection(types_1.COLLECTIONS.STAGE2_REPORTS).doc(uid);
    const { ticketId, alreadyReported, reportedAt, controlName, authorityType, versionId, eventOrganizerUid } = await db.runTransaction(async (tx) => {
        // Reads first.
        const [docSnap, counterSnap, controlSnap, eventSnap] = await Promise.all([
            tx.get(docRef),
            tx.get(counterRef),
            tx.get(controlRef),
            tx.get(eventRef),
        ]);
        if (!docSnap.exists) {
            throw new https_1.HttpsError('not-found', `Stage 2 image not found for control ${controlId}.`);
        }
        const stage2 = docSnap.data();
        if (stage2.published !== true) {
            throw new https_1.HttpsError('failed-precondition', 'This Stage 2 image is not published yet.');
        }
        if (!controlSnap.exists) {
            throw new https_1.HttpsError('not-found', `Control ${controlId} not found.`);
        }
        const control = controlSnap.data();
        if (!eventSnap.exists)
            throw new https_1.HttpsError('not-found', 'Event not found.');
        const event = eventSnap.data();
        const versionIdInner = event.currentVersionId ?? 'v1';
        if (counterSnap.exists) {
            // Already reported — return the existing ticket info.
            const existing = counterSnap.data();
            return {
                ticketId: existing.ticketId,
                alreadyReported: true,
                reportedAt: existing.reportedAt,
                controlName: control.controlName,
                authorityType: control.authority,
                versionId: versionIdInner,
                eventOrganizerUid: event.organizerId,
            };
        }
        // First report. Build the ticket id + write the counter + the report.
        const newTicketId = `${eventId}_${controlId}_${uid}_${now}`;
        const ticketRef = db.collection(types_1.COLLECTIONS.PUBLIC_REPORTS).doc(newTicketId);
        const evidencePaths = (data.evidencePaths ?? []).filter((p) => typeof p === 'string' && p.length > 0);
        const reportDoc = {
            ticketId: newTicketId,
            eventId,
            controlId,
            docId,
            reporterUid: uid,
            category,
            description,
            ...(evidencePaths.length > 0 ? { evidencePaths } : {}),
            outcome: 'under_review',
            createdAt: now,
            updatedAt: now,
        };
        tx.set(ticketRef, reportDoc);
        tx.set(counterRef, { uid, ticketId: newTicketId, reportedAt: now, category });
        tx.update(docRef, { m4TicketId: newTicketId, reportedAt: now });
        // Audit log.
        const auditId = `${versionIdInner}_${controlId}_stage2_reported_${uid}_${now}`;
        const auditRef = eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(auditId);
        tx.create(auditRef, {
            id: auditId,
            eventId,
            versionId: versionIdInner,
            action: 'stage2_reported',
            actorId: uid,
            actorRole: 'public',
            timestamp: now,
            notes: `${category}: ${description.slice(0, 80)}${description.length > 80 ? '...' : ''}`,
            metadata: {
                controlId,
                docId,
                ticketId: newTicketId,
                category,
            },
        });
        return {
            ticketId: newTicketId,
            alreadyReported: false,
            reportedAt: now,
            controlName: control.controlName,
            authorityType: control.authority,
            versionId: versionIdInner,
            eventOrganizerUid: event.organizerId,
        };
    });
    // Notifications (outside the transaction).
    await fireReportNotifications({
        eventId,
        controlId,
        docId,
        versionId,
        authorityType,
        controlName,
        ticketId,
        reportedAt,
        organizerUid: eventOrganizerUid,
    });
    return { ticketId, alreadyReported, reportedAt };
}
async function fireReportNotifications(args) {
    const db = (0, firebase_admin_1.firestore)();
    const title = 'Stage 2 image reported';
    const baseMessage = `Public viewer reported a Stage 2 issue for ${args.authorityType} "${args.controlName}". Ticket ${args.ticketId}. Awaiting M4 investigation.`;
    const sourceActionId = args.ticketId; // public_reports doc id is the natural idempotency key
    // Find the assigned officer for this authority + version.
    const assignmentId = `${args.versionId}_${args.authorityType}`;
    const assignmentRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(args.eventId).collection(types_1.COLLECTIONS.ASSIGNMENTS).doc(assignmentId);
    const assignmentSnap = await assignmentRef.get();
    const officerUid = assignmentSnap.exists ? (assignmentSnap.data().officerUid ?? null) : null;
    // Find all admin users.
    const adminsSnap = await db.collection(types_1.COLLECTIONS.USERS).where('role', '==', 'admin').get();
    const adminUids = adminsSnap.docs.map((d) => d.id);
    // Resolve the event organizer's auth uid (organizerId may be the doc id or a uid).
    const eventOrganizerAuthUid = await (0, notifications_1.resolveAuthUid)(args.organizerUid);
    const recipients = new Set();
    if (officerUid)
        recipients.add(officerUid);
    for (const uid of adminUids)
        recipients.add(uid);
    if (eventOrganizerAuthUid)
        recipients.add(eventOrganizerAuthUid);
    if (recipients.size === 0) {
        console.warn(`[reportStage2Doc] no recipients for ticket ${args.ticketId}: no officer, no admins, no organizer auth uid found.`);
        return;
    }
    await Promise.all([...recipients].map(async (recipientUid) => {
        try {
            await (0, notifications_1.createNotification)({
                recipientUid,
                eventId: args.eventId,
                versionId: args.versionId,
                type: 'stage2_reported',
                title,
                message: baseMessage,
                sourceActionId,
                // One doc per recipient (otherwise the writes overwrite each
                // other since sourceActionId alone is the doc id).
                notificationId: `${sourceActionId}_${recipientUid}`,
            });
        }
        catch (err) {
            console.warn(`[reportStage2Doc] notification to ${recipientUid} failed (non-fatal):`, err);
        }
    }));
}
//# sourceMappingURL=reportStage2Doc.js.map