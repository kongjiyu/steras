"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onEventStatusChanged = void 0;
exports.cleanupWithdrawnEvent = cleanupWithdrawnEvent;
/**
 * M1 → M3 withdrawal boundary (FR-M3-01).
 *
 * A withdrawal keeps the application and audit history but closes active
 * authority assignments and removes all public projections. The trigger is
 * intentionally idempotent so retries cannot lose records or create duplicate
 * audit entries.
 */
const firebase_admin_1 = require("firebase-admin");
const logger_1 = require("firebase-functions/logger");
const firestore_1 = require("firebase-functions/v2/firestore");
const types_1 = require("../../../shared/types");
const m4_1 = require("../../../shared/m4");
const runtime_1 = require("../config/runtime");
exports.onEventStatusChanged = (0, firestore_1.onDocumentUpdated)({ document: `${types_1.COLLECTIONS.EVENTS}/{eventId}`, region: runtime_1.FUNCTION_REGION }, async (change) => {
    const before = change.data?.before.data();
    const after = change.data?.after.data();
    if (!after || after.status !== 'Withdrawn' || before?.status === 'Withdrawn')
        return;
    await cleanupWithdrawnEvent(change.params.eventId);
});
async function cleanupWithdrawnEvent(eventId, now = Date.now()) {
    const db = (0, firebase_admin_1.firestore)();
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const [eventSnap, controlsSnap, assignmentsSnap, publicItemsSnap, incidentsSnap] = await Promise.all([
        eventRef.get(),
        eventRef.collection(types_1.COLLECTIONS.EVENT_CONTROLS).get(),
        eventRef.collection(types_1.COLLECTIONS.ASSIGNMENTS).get(),
        db.collection(types_1.COLLECTIONS.PUBLIC_EVENT_CONTROLS).doc(eventId).collection(types_1.COLLECTIONS.PUBLIC_EVENT_CONTROL_ITEMS).get(),
        db.collection(types_1.COLLECTIONS.INCIDENTS).where('eventId', '==', eventId).get(),
    ]);
    if (!eventSnap.exists)
        return;
    const event = eventSnap.data();
    if (event.status !== 'Withdrawn')
        return;
    // Keep each batch comfortably below Firestore's 500-write limit. All
    // operations are updates/deletes, so running them again is safe.
    const operations = [];
    for (const assignment of assignmentsSnap.docs) {
        operations.push((batch) => batch.set(assignment.ref, {
            status: 'revoked',
            revokedAt: now,
            revokedBy: 'system:withdrawn',
        }, { merge: true }));
    }
    for (const control of controlsSnap.docs) {
        const controlData = control.data();
        operations.push((batch) => batch.set(control.ref, {
            activityClosed: true,
            updatedAt: now,
            labelRemovedAt: now,
        }, { merge: true }));
        const stage2Docs = await control.ref.collection(types_1.COLLECTIONS.STAGE2_DOCS).get();
        for (const stage2 of stage2Docs.docs) {
            const data = stage2.data();
            if (data.published === true) {
                operations.push((batch) => batch.set(stage2.ref, { published: false }, { merge: true }));
            }
            operations.push((batch) => batch.delete(db.collection(types_1.COLLECTIONS.PUBLIC_EVENT_CONTROLS)
                .doc(eventId)
                .collection(types_1.COLLECTIONS.PUBLIC_EVENT_CONTROL_ITEMS)
                .doc(`${controlData.controlId}-stage2`)));
        }
    }
    for (const publicItem of publicItemsSnap.docs)
        operations.push((batch) => batch.delete(publicItem.ref));
    for (const incidentDocument of incidentsSnap.docs) {
        const incident = incidentDocument.data();
        if (incident.schemaVersion !== m4_1.M4_SCHEMA_VERSION || incident.status === 'resolved' || incident.activityClosed === true)
            continue;
        const historyId = `${incidentDocument.id}_event_withdrawn`;
        const history = {
            historyId,
            incidentId: incidentDocument.id,
            action: 'event_withdrawn',
            actorUid: 'system',
            actorRole: 'system',
            timestamp: now,
            summary: 'Incident activity closed because the associated event was withdrawn.',
            evidence: [],
        };
        operations.push((batch) => batch.set(incidentDocument.ref, {
            activityClosed: true,
            closureReason: 'event_withdrawn',
            closedAt: now,
            updatedAt: now,
        }, { merge: true }));
        operations.push((batch) => batch.set(incidentDocument.ref.collection('history').doc(historyId), history, { merge: false }));
    }
    for (let index = 0; index < operations.length; index += 400) {
        const batch = db.batch();
        for (const operation of operations.slice(index, index + 400))
            operation(batch);
        await batch.commit();
    }
    const cleanupAuditId = `withdrawn_cleanup_${event.currentVersionId ?? 'unversioned'}`;
    await db.runTransaction(async (transaction) => {
        const current = await transaction.get(eventRef);
        const currentEvent = current.data();
        if (!current.exists || currentEvent?.status !== 'Withdrawn'
            || currentEvent.currentVersionId !== event.currentVersionId)
            return;
        transaction.set(eventRef, {
            reviewStage: 'closed', assignedOfficerUids: [], assignedOfficerByAuthority: {}, updatedAt: now,
            withdrawalCleanupCompletedAt: now,
        }, { merge: true });
        transaction.delete(db.collection(types_1.COLLECTIONS.PUBLIC_EVENTS).doc(eventId));
        transaction.set(eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(cleanupAuditId), {
            id: cleanupAuditId,
            eventId,
            versionId: event.currentVersionId,
            action: 'withdrawn_cleanup',
            actorId: 'system',
            actorRole: 'system',
            timestamp: now,
            previousStatus: event.withdrawnFromStatus ?? event.status,
            newStatus: 'Withdrawn',
            notes: 'Closed pending assignments and unpublished event-control projections after withdrawal.',
            metadata: {
                assignmentsClosed: assignmentsSnap.size,
                controlsClosed: controlsSnap.size,
                publicItemsRemoved: publicItemsSnap.size,
                incidentsClosed: incidentsSnap.docs.filter((document) => {
                    const incident = document.data();
                    return incident.schemaVersion === m4_1.M4_SCHEMA_VERSION && incident.status !== 'resolved' && incident.activityClosed !== true;
                }).length,
            },
        }, { merge: true });
    });
    logger_1.logger.info('[onEventStatusChanged] withdrawal cleanup complete', { eventId, assignments: assignmentsSnap.size, controls: controlsSnap.size });
}
//# sourceMappingURL=onEventStatusChanged.js.map