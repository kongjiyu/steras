"use strict";
/**
 * Append-only audit log writer.
 *
 * Audit logs are stored as sub-collection `events/{eventId}/audit_logs/`.
 * Firestore rules enforce no client writes (server-only).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeAuditLog = writeAuditLog;
const firebase_admin_1 = require("firebase-admin");
const types_1 = require("../../../shared/types");
async function writeAuditLog(eventId, action, actorId, data = {}) {
    const log = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        eventId,
        action,
        actorId,
        actorRole: data.actorRole ?? 'system',
        timestamp: Date.now(),
        ...(data.versionId ? { versionId: data.versionId } : {}),
        ...(data.previousStatus ? { previousStatus: data.previousStatus } : {}),
        ...(data.newStatus ? { newStatus: data.newStatus } : {}),
        ...(data.notes ? { notes: data.notes } : {}),
        ...(data.metadata ? { metadata: data.metadata } : {}),
    };
    await (0, firebase_admin_1.firestore)()
        .collection(types_1.COLLECTIONS.EVENTS)
        .doc(eventId)
        .collection(types_1.COLLECTIONS.AUDIT_LOGS)
        .doc(log.id)
        .set(log);
}
//# sourceMappingURL=audit.js.map