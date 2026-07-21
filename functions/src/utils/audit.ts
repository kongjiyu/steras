/**
 * Append-only audit log writer.
 *
 * Audit logs are stored as sub-collection `events/{eventId}/audit_logs/`.
 * Firestore rules enforce no client writes (server-only).
 */

import { firestore } from 'firebase-admin';
import { AuditAction, AuditLog, COLLECTIONS, UserRole } from '@shared/types';

export async function writeAuditLog(
  eventId: string,
  action: AuditAction,
  actorId: string,
  data: Partial<AuditLog> = {},
): Promise<void> {
  const log: AuditLog = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    eventId,
    action,
    actorId,
    actorRole: (data.actorRole as UserRole) ?? 'system',
    timestamp: Date.now(),
    ...(data.versionId ? { versionId: data.versionId } : {}),
    ...(data.previousStatus ? { previousStatus: data.previousStatus } : {}),
    ...(data.newStatus ? { newStatus: data.newStatus } : {}),
    ...(data.notes ? { notes: data.notes } : {}),
    ...(data.metadata ? { metadata: data.metadata } : {}),
  };
  await firestore()
    .collection(COLLECTIONS.EVENTS)
    .doc(eventId)
    .collection(COLLECTIONS.AUDIT_LOGS)
    .doc(log.id)
    .set(log);
}
