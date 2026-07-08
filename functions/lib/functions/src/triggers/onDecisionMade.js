"use strict";
/**
 * Triggers: onDecisionMade
 *
 * Module 4 — when authority sets status to Approved/Rejected/AmendmentRequested,
 * append an audit log and (if Approved) publish to public_events.
 *
 * Uses firebase-functions v2 API.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.onDecisionMade = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firebase_admin_1 = require("firebase-admin");
const firebase_functions_1 = require("firebase-functions");
const types_1 = require("@shared/types");
const audit_1 = require("../utils/audit");
exports.onDecisionMade = (0, firestore_1.onDocumentUpdated)(`${types_1.COLLECTIONS.EVENTS}/{eventId}`, async (event) => {
    const before = event.data?.before.data();
    const afterData = event.data?.after.data();
    if (!before || !afterData)
        return;
    const after = { eventId: event.params.eventId, ...afterData };
    if (before.status === after.status)
        return;
    // Decision transitions only.
    const decisionStates = ['Approved', 'Rejected', 'AmendmentRequested', 'UnderReview', 'Withdrawn'];
    if (!decisionStates.includes(after.status))
        return;
    const db = (0, firebase_admin_1.firestore)();
    // Audit log.
    await (0, audit_1.writeAuditLog)(after.eventId, 'decision_made', after.decidedBy ?? 'unknown', {
        eventId: after.eventId,
        previousStatus: before.status,
        newStatus: after.status,
        actorId: after.decidedBy,
    });
    // If approved, publish to public_events (Module 3 — public calendar).
    if (after.status === 'Approved') {
        const publicEvent = {
            eventId: after.eventId,
            eventName: after.eventDetails.name,
            venueName: after.eventDetails.venueName,
            eventType: after.eventDetails.type,
            startDatetime: after.eventDetails.startDatetime,
            endDatetime: after.eventDetails.endDatetime,
            approvedBy: [], // TODO: track which authority types signed off
            publicStatus: 'approved',
        };
        await db.collection(types_1.COLLECTIONS.PUBLIC_EVENTS).doc(after.eventId).set(publicEvent);
        await (0, audit_1.writeAuditLog)(after.eventId, 'public_published', 'system', { eventId: after.eventId });
    }
    // If rejected/withdrawn, remove from public_events (if present).
    if (after.status === 'Rejected' || after.status === 'Withdrawn') {
        await db.collection(types_1.COLLECTIONS.PUBLIC_EVENTS).doc(after.eventId).delete().catch(() => undefined);
    }
    firebase_functions_1.logger.info(`[onDecisionMade] ${after.eventId}: ${before.status} → ${after.status}`);
});
//# sourceMappingURL=onDecisionMade.js.map