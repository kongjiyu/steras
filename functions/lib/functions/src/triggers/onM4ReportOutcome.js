"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onM4ReportOutcome = void 0;
exports.isM4TerminalOutcome = isM4TerminalOutcome;
exports.applyM4ReportOutcome = applyM4ReportOutcome;
/**
 * M3/M4 boundary: apply a resolved public Stage 2 discrepancy.
 *
 * M3 creates `public_reports/{ticketId}` when a registered public viewer
 * reports an inaccurate image. M4 owns the investigation and writes one of
 * the two terminal outcomes. This trigger applies that outcome atomically to
 * the private control document and its sanitised public projection.
 */
const firebase_admin_1 = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const logger_1 = require("firebase-functions/logger");
const firestore_2 = require("firebase-functions/v2/firestore");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
const publishStage2Doc_1 = require("../http/publishStage2Doc");
const notifications_1 = require("../utils/notifications");
function isM4TerminalOutcome(value) {
    return value === 'confirmed_true' || value === 'dismissed_fake';
}
exports.onM4ReportOutcome = (0, firestore_2.onDocumentUpdated)({ document: `${types_1.COLLECTIONS.PUBLIC_REPORTS}/{ticketId}`, region: runtime_1.FUNCTION_REGION }, async (change) => {
    const before = change.data?.before.data();
    const after = change.data?.after.data();
    if (!after || !isM4TerminalOutcome(after.outcome) || before?.outcome === after.outcome)
        return;
    try {
        await applyM4ReportOutcome(after, after.outcome, after.outcomeSetAt ?? Date.now());
    }
    catch (error) {
        logger_1.logger.error('[onM4ReportOutcome] failed to apply M4 outcome', {
            ticketId: after.ticketId,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
});
async function applyM4ReportOutcome(report, outcome, now = Date.now()) {
    const db = (0, firebase_admin_1.firestore)();
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(report.eventId);
    const controlRef = eventRef.collection(types_1.COLLECTIONS.EVENT_CONTROLS).doc(report.controlId);
    const stage2Ref = controlRef.collection(types_1.COLLECTIONS.STAGE2_DOCS).doc(report.docId);
    const publicRef = db.collection(types_1.COLLECTIONS.PUBLIC_EVENT_CONTROLS)
        .doc(report.eventId)
        .collection(types_1.COLLECTIONS.PUBLIC_EVENT_CONTROL_ITEMS)
        .doc(`${report.controlId}-stage2`);
    const result = await db.runTransaction(async (tx) => {
        const [eventSnap, controlSnap, stage2Snap, publicSnap] = await Promise.all([
            tx.get(eventRef),
            tx.get(controlRef),
            tx.get(stage2Ref),
            tx.get(publicRef),
        ]);
        if (!eventSnap.exists || !controlSnap.exists || !stage2Snap.exists) {
            logger_1.logger.warn('[onM4ReportOutcome] referenced control no longer exists', {
                ticketId: report.ticketId,
                eventId: report.eventId,
                controlId: report.controlId,
            });
            return null;
        }
        const event = eventSnap.data();
        const control = controlSnap.data();
        const stage2 = stage2Snap.data();
        const versionId = event.currentVersionId ?? control.versionId ?? 'v1';
        const auditAction = outcome === 'confirmed_true' ? 'control_resubmit_required' : 'control_restored';
        if (outcome === 'confirmed_true') {
            // The organiser must submit a replacement image. Removing the ticket
            // lock is intentional: the M4 outcome has resolved the report and the
            // replacement upload is now the next workflow step.
            tx.update(stage2Ref, {
                published: false,
                m4TicketId: firestore_1.FieldValue.delete(),
                reportedAt: firestore_1.FieldValue.delete(),
                rejectionReason: 'M4 confirmed the public discrepancy; submit a corrected Stage 2 image.',
                rejectionAt: now,
                rejectedBy: 'm4',
            });
            tx.update(controlRef, {
                label: 'resubmit_required',
                labelAddedAt: now,
                updatedAt: now,
            });
            if (publicSnap.exists)
                tx.delete(publicRef);
        }
        else {
            // The report was dismissed. Restore the last admin-published image and
            // expose it again through a clean sanitised projection.
            tx.update(stage2Ref, {
                published: true,
                publishedAt: stage2.publishedAt ?? now,
                publishedBy: stage2.publishedBy ?? 'm4',
                m4TicketId: firestore_1.FieldValue.delete(),
                reportedAt: firestore_1.FieldValue.delete(),
                rejectionReason: firestore_1.FieldValue.delete(),
                rejectionAt: firestore_1.FieldValue.delete(),
                rejectedBy: firestore_1.FieldValue.delete(),
            });
            tx.update(controlRef, {
                label: 'approved',
                labelAddedAt: now,
                updatedAt: now,
            });
            tx.set(publicRef, (0, publishStage2Doc_1.buildPublicEventControl)({
                publicControlId: `${report.controlId}-stage2`,
                eventId: report.eventId,
                versionId,
                controlId: report.controlId,
                docId: report.docId,
                control,
                stage2: { ...stage2, m4TicketId: undefined, reportedAt: undefined, published: true },
                publishedAt: stage2.publishedAt ?? now,
                publishedBy: stage2.publishedBy ?? 'm4',
                sanitizedAt: now,
            }));
        }
        const auditId = `${report.ticketId}_${outcome}`;
        tx.set(eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(auditId), {
            id: auditId,
            eventId: report.eventId,
            versionId,
            action: auditAction,
            actorId: report.outcomeSetBy ?? 'm4',
            actorRole: 'system',
            timestamp: now,
            notes: outcome === 'confirmed_true'
                ? 'M4 confirmed the Stage 2 discrepancy; organiser resubmission required.'
                : 'M4 dismissed the Stage 2 discrepancy; the published control was restored.',
            metadata: { ticketId: report.ticketId, controlId: report.controlId, docId: report.docId, outcome },
        });
        return {
            eventId: report.eventId,
            controlId: report.controlId,
            outcome,
            organizerId: event.organizerId,
            authorityType: control.authority,
            controlName: control.controlName,
            versionId,
        };
    });
    if (!result)
        return null;
    const eventSnapshot = await eventRef.get();
    const organizerId = eventSnapshot.data()?.organizerId;
    const organizerUid = organizerId ? await (0, notifications_1.resolveAuthUid)(organizerId) : null;
    const adminsSnapshot = await db.collection(types_1.COLLECTIONS.USERS).where('role', '==', 'admin').get();
    const recipients = new Set(adminsSnapshot.docs.map((doc) => doc.id));
    if (organizerUid)
        recipients.add(organizerUid);
    const confirmed = outcome === 'confirmed_true';
    await Promise.all([...recipients].map(async (recipientUid) => {
        try {
            await (0, notifications_1.createNotification)({
                recipientUid,
                eventId: result.eventId,
                versionId: result.versionId,
                type: confirmed ? 'control_resubmit_required' : 'control_restored',
                title: confirmed ? 'Stage 2 correction required' : 'Stage 2 control restored',
                message: confirmed
                    ? `${result.authorityType}: M4 confirmed a public discrepancy for "${result.controlName}". Upload a corrected Stage 2 image for admin review.`
                    : `${result.authorityType}: M4 dismissed the public discrepancy for "${result.controlName}". The published Stage 2 image is visible again.`,
                sourceActionId: report.ticketId,
                notificationId: `${report.ticketId}_${outcome}_${recipientUid}`,
            });
        }
        catch (error) {
            logger_1.logger.warn('[onM4ReportOutcome] notification failed (non-fatal)', {
                recipientUid,
                ticketId: report.ticketId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }));
    return { eventId: result.eventId, controlId: result.controlId, outcome };
}
//# sourceMappingURL=onM4ReportOutcome.js.map