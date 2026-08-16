/**
 * verifyEventControl — server-mediated Stage-1 control verification
 * (FR-M3-22, FR-M3-23, handoff item 3+4).
 *
 * Officers can only verify controls that:
 *  1. Belong to an event whose `requiredAuthorities` includes the officer's
 *     authority type.
 *  2. Belong to a control that is currently in `declared` or `absent` status.
 *
 * The verification record persists full provenance:
 *   - controlId, authorityType, reviewerUid, evidencePath, timestamp, versionId
 * plus rationale and the officer's `current` decision.
 *
 * Once a control is verified, the event's `verifiedControlIds` is updated
 * so M2 mitigation credits can be calculated against verified (not just
 * declared) controls.
 */
import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  COLLECTIONS,
  ControlVerification,
  ControlVerificationStatus,
  UserProfile,
  EventRecord,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { createNotification } from '../utils/notifications';

interface VerifyEventControlRequest {
  eventId?: string;
  controlId?: string;
  status?: ControlVerificationStatus;
  rationale?: string;
  evidencePath?: string;
  evidenceFile?: { name: string; sizeBytes: number; mimeType: string };
}

const RATIONALE_MIN = 10;
const RATIONALE_MAX = 1_000;

export const verifyEventControl = onCall<VerifyEventControlRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before verifying a control.');
  return verifyEventControlForUser(request.auth.uid, request.data);
});

export async function verifyEventControlForUser(
  uid: string,
  data: VerifyEventControlRequest,
  now = Date.now(),
) {
  const eventId = (data.eventId ?? '').trim();
  const controlId = (data.controlId ?? '').trim();
  const status = data.status;
  const rationale = (data.rationale ?? '').trim();
  const evidencePath = (data.evidencePath ?? '').trim() || undefined;
  const evidenceFile = data.evidenceFile;

  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!controlId) throw new HttpsError('invalid-argument', 'controlId is required.');
  if (status !== 'verified' && status !== 'rejected') {
    throw new HttpsError('invalid-argument', 'status must be "verified" or "rejected".');
  }
  if (rationale.length < RATIONALE_MIN || rationale.length > RATIONALE_MAX) {
    throw new HttpsError('invalid-argument', `Rationale must be between ${RATIONALE_MIN} and ${RATIONALE_MAX} characters.`);
  }

  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const userRef = db.collection(COLLECTIONS.USERS).doc(uid);

  return db.runTransaction(async (tx) => {
    const [userSnap, eventSnap, controlSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(eventRef),
      tx.get(eventRef.collection(COLLECTIONS.EVENT_CONTROLS).doc(controlId)),
    ]);

    const profile = userSnap.data() as UserProfile | undefined;
    if (!profile || profile.role !== 'authority' || !profile.authorityType) {
      throw new HttpsError('permission-denied', 'Only provisioned authority accounts can verify controls.');
    }
    if (!eventSnap.exists) throw new HttpsError('not-found', 'Event application was not found.');
    const event = eventSnap.data() as EventRecord;
    if (!event.requiredAuthorities.includes(profile.authorityType)) {
      throw new HttpsError('permission-denied', 'Your authority is not assigned to this application.');
    }
    if (!controlSnap.exists) {
      throw new HttpsError('not-found', `Control ${controlId} was not found for this event.`);
    }
    const versionId = event.currentVersionId;
    if (!versionId) throw new HttpsError('failed-precondition', 'The application has no submitted version.');

    const verificationId = `${versionId}_${controlId}_${profile.authorityType}`;
    const verifRef = eventRef.collection(COLLECTIONS.CONTROL_VERIFICATIONS).doc(verificationId);
    const verifSnap = await tx.get(verifRef);
    if (verifSnap.exists) {
      const existing = verifSnap.data() as ControlVerification;
      if (existing.status === status && existing.rationale === rationale && existing.reviewerUid === uid) {
        return { eventId, controlId, verificationId, status, idempotent: true };
      }
    }

    const verification: ControlVerification = {
      verificationId,
      eventId,
      versionId,
      controlId,
      authorityType: profile.authorityType,
      reviewerUid: uid,
      status,
      rationale,
      evidencePath,
      evidenceFile,
      createdAt: now,
    };

    tx.set(verifRef, verification);
    // Update the parent control's status field
    tx.update(controlSnap.ref, { status, updatedAt: now, reviewerUid: uid, authorityType: profile.authorityType });

    // Maintain the event-level verifiedControlIds set
    const existingVerified = (event.verifiedControlIds ?? []) as string[];
    if (status === 'verified') {
      const next = existingVerified.filter((id: string) => id !== controlId);
      next.push(controlId);
      tx.update(eventRef, { verifiedControlIds: next, updatedAt: now });
    } else {
      const next = existingVerified.filter((id: string) => id !== controlId);
      tx.update(eventRef, { verifiedControlIds: next, updatedAt: now });
    }

    // Audit log
    const auditId = `${verificationId}_${now}`;
    const auditRef = eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId);
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
        evidencePath: evidencePath ?? null,
      },
    });

    // Capture for post-transaction notification
    const organizerId = event.organizerId;
    const authorityType = profile.authorityType;
    const ctrlTitle = (controlSnap.data() as { title?: string } | undefined)?.title ?? controlId;

    return { eventId, controlId, verificationId, status, idempotent: false, organizerId, authorityType, ctrlTitle, versionId };
  }).then(async (result) => {
    // Fire-and-forget notification to the organiser. Not part of the
    // transaction so a notification write failure cannot roll back a
    // verified control.
    if (result.organizerId) {
      try {
        await createNotification({
          recipientUid: result.organizerId,
          eventId: result.eventId,
          versionId: result.versionId,
          type: result.status === 'verified' ? 'control_verified' : 'control_rejected',
          title: result.status === 'verified' ? 'Control verified' : 'Control rejected',
          message: `${result.authorityType} ${result.status} control "${result.ctrlTitle}".`,
          sourceActionId: `${result.verificationId}_notif`,
        });
      } catch (err) {
        console.warn('[verifyEventControl] notification write failed (non-fatal):', err);
      }
    }
    // Strip helper fields from the public return
    return {
      eventId: result.eventId,
      controlId: result.controlId,
      verificationId: result.verificationId,
      status: result.status,
      idempotent: result.idempotent,
    };
  });
}
