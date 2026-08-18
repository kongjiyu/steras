/**
 * generateEventControlList — admin-only callable (M3 Workstream 2).
 *
 * The proposal entry point for the per-authority event control list.
 * Admin opens `AdminControlListEditor`, clicks "Generate proposal", and
 * this function:
 *   - If the event already has a published list (`controlListGenerated
 *     === true`): returns the cached snapshot from the event doc,
 *     marked `cached: true`. Does NOT call MiniMax again (A23: don't
 *     regenerate without explicit reason).
 *   - Otherwise: calls the existing `proposeEventControlList` Cloud
 *     Function (M3 stub for now; M2's real version when it lands),
 *     which returns the proposed `ProposedControlItem[]`. We return
 *     them to the admin as `items` with `cached: false`. The admin
 *     can then edit and commit via `editEventControlList`.
 *
 * The commit step is a separate call — `generate` only proposes.
 * Per the M3 owner decision (2026-08-18): the admin must explicitly
 * click "Generate" and "Commit". No auto-trigger.
 */
import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  COLLECTIONS,
  EventRecord,
  ProposedControlItem,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { proposeControlItemsForEvent } from './proposeEventControlList';

interface GenerateEventControlListRequest {
  eventId?: string;
  /** Optional. Defaults to event.currentVersionId. */
  versionId?: string;
  /** If true, force a fresh call to the proposal function (skip cache).
   *  Defaults to false. Used by the admin's "regenerate" button. */
  force?: boolean;
}

interface GenerateEventControlListResponse {
  items: ProposedControlItem[];
  cached: boolean;
  source: 'cache' | 'proposeEventControlList';
}

export const generateEventControlList = onCall<GenerateEventControlListRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before generating the control list.');
  const eventId = (request.data?.eventId ?? '').trim();
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');

  // Profile check: admin only.
  const db = firestore();
  const userSnap = await db.collection(COLLECTIONS.USERS).doc(request.auth.uid).get();
  const profile = userSnap.data() as UserProfile | undefined;
  if (!profile || profile.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can generate the control list.');
  }

  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) {
    throw new HttpsError('not-found', `Event ${eventId} not found.`);
  }
  const event = eventSnap.data() as EventRecord;
  const versionId = (request.data?.versionId ?? event.currentVersionId ?? '').trim();
  if (!versionId) {
    throw new HttpsError('failed-precondition', 'The event has no submitted version.');
  }
  if (!['UnderReview', 'Approved'].includes(event.status)) {
    throw new HttpsError('failed-precondition', `Control list can only be generated for events in UnderReview or Approved status (current: ${event.status}).`);
  }

  const force = request.data?.force === true;

  // Cache hit: controlListGenerated is true AND the snapshot is for the
  // current version. The snapshot was written by editEventControlList.
  if (!force && event.controlListGenerated && event.controlListSnapshot && event.controlListSnapshot.length > 0) {
    // Convert the snapshot back to ProposedControlItem shape. We
    // intentionally lose the per-Stage-1-requirement detail (we
    // stored only the count). The admin can hit `force: true` to
    // re-fetch the full proposal from the AI.
    const items: ProposedControlItem[] = event.controlListSnapshot.map((s) => ({
      controlName: s.controlName,
      authority: s.authority,
      stageRequirement: s.stageRequirement,
      stage1Requirements: Array.from({ length: s.stage1RequirementsCount }, () => ({
        docType: 'other' as const,
        label: '(see event_controls doc)',
        required: true,
      })),
      stage2Requirement: s.stage2Label ? { kind: 'image' as const, label: s.stage2Label } : null,
    }));
    return { items, cached: true, source: 'cache' } satisfies GenerateEventControlListResponse;
  }

  // Cache miss: call the proposal helper directly. This is the M3
  // stub for now; when M2 ships `proposeEventControlList`, the
  // import above resolves to M2's real callable (and the call site
  // stays the same).
  const items = await proposeControlItemsForEvent(eventId, versionId);

  if (!items.length) {
    throw new HttpsError('failed-precondition', 'The proposal function returned no items. Check the event has required authorities.');
  }
  return { items, cached: false, source: 'proposeEventControlList' } satisfies GenerateEventControlListResponse;
});
