/**
 * editEventControlList — admin-only callable (M3 Workstream 2).
 *
 * The commit point for the per-authority event control list. The admin
 * opens `AdminControlListEditor`, sees the proposal from
 * `generateEventControlList`, edits it (add/remove controls, change
 * Stage 1 requirements), then commits via this function. The
 * transaction:
 *   - Wipes any existing `event_controls/{controlId}` for this event +
 *     version (idempotent re-commit).
 *   - Writes one `event_controls/{controlId}` per item, with the agreed
 *     shape and `controlItemVersion: 1`.
 *   - Sets `event.controlListGenerated = true` + writes a
 *     `controlListSnapshot` (denormalised, for the admin UI to render
 *     the current list without re-querying the sub-collection).
 *   - Writes one `control_list_published` audit log entry.
 *
 * Per the M3 owner decision (2026-08-18): the admin must explicitly
 * click "Commit changes" — there is no Firestore trigger that
 * auto-commits. So this function is the single entry point for
 * publishing a control list.
 */
import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  COLLECTIONS,
  EventControl,
  EventRecord,
  ProposedControlItem,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { createNotification, resolveAuthUid } from '../utils/notifications';

interface EditEventControlListRequest {
  eventId?: string;
  items?: ProposedControlItem[];
  /** Optional override. Defaults to the agreed shape; bumped only when
   *  re-committing an existing list. */
  controlItemVersion?: number;
}

interface EditEventControlListResponse {
  written: number;
  controlIds: string[];
  controlListSnapshot: NonNullable<EventRecord['controlListSnapshot']>;
}

export const editEventControlList = onCall<EditEventControlListRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before editing the control list.');
  const eventId = (request.data?.eventId ?? '').trim();
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  const items = request.data?.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpsError('invalid-argument', 'items must be a non-empty array.');
  }
  // Validate each item.
  const seenAuths = new Set<string>();
  for (const item of items) {
    if (!item.controlName || !item.authority) {
      throw new HttpsError('invalid-argument', 'Each item needs controlName and authority.');
    }
    if (seenAuths.has(item.authority)) {
      throw new HttpsError('invalid-argument', `Duplicate authority in items: ${item.authority}.`);
    }
    seenAuths.add(item.authority);
    if (!item.stage1Requirements && item.stageRequirement !== 'stage1_only') {
      throw new HttpsError('invalid-argument', `${item.authority}: stage1Requirements is required unless stageRequirement is 'stage1_only'.`);
    }
  }

  // Profile check: admin only.
  const db = firestore();
  const userSnap = await db.collection(COLLECTIONS.USERS).doc(request.auth.uid).get();
  const profile = userSnap.data() as UserProfile | undefined;
  if (!profile || profile.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can edit the control list.');
  }

  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) {
    throw new HttpsError('not-found', `Event ${eventId} not found.`);
  }
  const event = eventSnap.data() as EventRecord;
  const versionId = event.currentVersionId;
  if (!versionId) {
    throw new HttpsError('failed-precondition', 'The event has no submitted version.');
  }
  if (event.status !== 'Approved') {
    throw new HttpsError('failed-precondition', `Control list can only be committed after Admin final approval (current: ${event.status}).`);
  }
  // The list's authorities must match the event's requiredAuthorities.
  const required = new Set(event.requiredAuthorities ?? []);
  for (const item of items) {
    if (!required.has(item.authority)) {
      throw new HttpsError('failed-precondition', `Item authority ${item.authority} is not in the event's requiredAuthorities.`);
    }
  }
  if (seenAuths.size !== required.size || [...required].some((authority) => !seenAuths.has(authority))) {
    throw new HttpsError('invalid-argument', 'items must contain exactly one control for every required authority.');
  }

  const now = Date.now();
  const controlItemVersion = request.data?.controlItemVersion ?? 1;
  if (!Number.isSafeInteger(controlItemVersion) || controlItemVersion < 1 || controlItemVersion > 10_000) {
    throw new HttpsError('invalid-argument', 'controlItemVersion must be a positive safe integer.');
  }

  // Compute the new snapshot for the parent event doc.
  const newSnapshot: NonNullable<EventRecord['controlListSnapshot']> = items.map((item) => ({
    controlId: `${eventId}-ctrl-${item.authority.toLowerCase()}-v${controlItemVersion}`,
    controlName: item.controlName,
    authority: item.authority,
    stageRequirement: item.stageRequirement,
    stage1RequirementsCount: (item.stage1Requirements ?? []).length,
    stage2Label: item.stage2Requirement?.label,
    controlItemVersion,
    label: 'pending' as EventControl['label'],
  }));

  return db.runTransaction(async (tx) => {
    // Reads first.
    const evSnap = await tx.get(eventRef);
    if (!evSnap.exists) {
      throw new HttpsError('not-found', `Event ${eventId} disappeared.`);
    }
    const ev = evSnap.data() as EventRecord;
    if (ev.currentVersionId !== versionId) {
      throw new HttpsError('failed-precondition', 'The event was re-versioned while you were editing. Reload and try again.');
    }
    // Published controls and their evidence are immutable. Corrections use a
    // new controlItemVersion; prior records remain available for audit.
    const existingControls = await tx.get(eventRef.collection(COLLECTIONS.EVENT_CONTROLS).where('versionId', '==', versionId));
    if (!existingControls.empty) {
      throw new HttpsError('failed-precondition', 'The published control list is immutable. Submit a new application version for corrections.');
    }

    // Writes — one event_controls/{id} per item, with the agreed shape.
    // We do NOT pre-seed stage1_docs here; Workstream 3 (organizer
    // upload) is what fills them. The container is created with the
    // stage1Requirements metadata only.
    const controlIds: string[] = [];
    for (const item of items) {
      const controlId = `${eventId}-ctrl-${item.authority.toLowerCase()}-v${controlItemVersion}`;
      const ctrlRef = eventRef.collection(COLLECTIONS.EVENT_CONTROLS).doc(controlId);
      const ctrl: EventControl = {
        controlId,
        eventId,
        versionId,
        controlName: item.controlName,
        authority: item.authority,
        stageRequirement: item.stageRequirement,
        stage1Requirements: item.stage1Requirements ?? [],
        ...(item.stage2Requirement ? { stage2Requirement: item.stage2Requirement } : { stage2Requirement: null }),
        controlItemVersion,
        label: 'pending',
        createdAt: now,
        updatedAt: now,
      };
      tx.set(ctrlRef, ctrl);
      controlIds.push(controlId);
    }

    // Audit log.
    const auditId = `control_list_published_${versionId}_${controlItemVersion}_${now}`;
    tx.create(eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId), {
      id: auditId,
      eventId,
      versionId,
      action: 'control_list_published',
      actorId: request.auth!.uid,
      actorRole: 'admin',
      timestamp: now,
      notes: `Published control list v${controlItemVersion} with ${items.length} item(s).`,
      metadata: {
        controlItemVersion,
        controlIds,
        authorities: items.map((i) => i.authority),
      },
    });

    // Update the parent event: mark generated + write the snapshot.
    tx.update(eventRef, {
      controlListGenerated: true,
      controlListSnapshot: newSnapshot,
      updatedAt: now,
    });

    return { written: items.length, controlIds, controlListSnapshot: newSnapshot };
  }).then(async (result) => {
    // Notify the organiser that the control list is ready.
    if (event.organizerId) {
      try {
        const recipientUid = await resolveAuthUid(event.organizerId);
        if (recipientUid) {
          await createNotification({
            recipientUid,
            eventId,
            versionId,
            type: 'control_list_published',
            title: 'Event control list published',
            message: `The authority control list for "${event.eventDetails.name}" is ready. ${result.written} control${result.written === 1 ? '' : 's'} declared. You can now upload Stage 1 + Stage 2 evidence.`,
            sourceActionId: `control_list_published_${versionId}_${controlItemVersion}`,
          });
        }
      } catch (err) {
        console.warn('[editEventControlList] organiser notification failed (non-fatal):', err);
      }
    }
    return {
      eventId,
      versionId,
      written: result.written,
      controlIds: result.controlIds,
      controlListSnapshot: result.controlListSnapshot,
    } satisfies EditEventControlListResponse & { eventId: string; versionId: string };
  });
});
