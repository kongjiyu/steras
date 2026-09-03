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
 *   - Otherwise: calls M3's shared MiniMax-backed, schema-validated
 *     proposal engine with an explicit deterministic fallback, and
 *     returns the provenance metadata alongside the proposed items.
 *
 * The commit step is a separate call — `generate` only proposes.
 * Per the M3 owner decision (2026-08-18): the admin must explicitly
 * click "Generate" and "Commit". No auto-trigger.
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
import { MINIMAX_API_KEY } from '../config/secrets';
import { proposeControlItemsForEventWithMetadata } from './proposeEventControlList';

interface GenerateEventControlListRequest {
  eventId?: string;
  /** Optional. Defaults to event.currentVersionId. */
  versionId?: string;
  /** If true, force a fresh call to the proposal function (skip cache).
   *  Defaults to false. Used by the admin's "regenerate" button. */
  force?: boolean;
}

export interface GenerateEventControlListResponse {
  items: ProposedControlItem[];
  cached: boolean;
  source: 'cache' | 'minimax' | 'deterministic_fallback';
  model?: string;
  promptVersion?: string;
  generatedAt?: number;
  fallbackReason?: string;
}

export const generateEventControlList = onCall<GenerateEventControlListRequest>({ region: FUNCTION_REGION, secrets: [MINIMAX_API_KEY] }, async (request) => {
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
  if (event.status !== 'Approved') {
    throw new HttpsError('failed-precondition', `Control list can only be generated after Admin final approval (current: ${event.status}).`);
  }

  // Cache hit: controlListGenerated is true AND the snapshot is for the
  // current version. The snapshot was written by editEventControlList.
  if (event.controlListGenerated && event.controlListSnapshot && event.controlListSnapshot.length > 0) {
    // Rehydrate from the committed controls so cached proposals preserve the
    // exact Stage 1 document types/labels and Stage 2 requirement. Legacy
    // snapshots only stored a count, so retain a bounded placeholder fallback
    // for records whose control subcollection is unavailable.
    const controlsSnap = await eventRef.collection(COLLECTIONS.EVENT_CONTROLS).get();
    const currentControls = controlsSnap.docs
      .map((doc) => doc.data() as EventControl)
      .filter((control) => control.versionId === versionId);
    if (currentControls.length > 0) {
      const items: ProposedControlItem[] = currentControls.map((control) => ({
        controlName: control.controlName,
        authority: control.authority,
        stageRequirement: control.stageRequirement,
        stage1Requirements: control.stage1Requirements,
        stage2Requirement: control.stage2Requirement,
      }));
      return { items, cached: true, source: 'cache' } satisfies GenerateEventControlListResponse;
    }
    const items: ProposedControlItem[] = event.controlListSnapshot.map((s) => ({
      controlName: s.controlName,
      authority: s.authority,
      stageRequirement: s.stageRequirement,
      stage1Requirements: Array.from({ length: s.stage1RequirementsCount }, () => ({
        docType: 'other' as const,
        label: '(legacy control requirement)',
        required: true,
      })),
      stage2Requirement: s.stage2Label ? { kind: 'image' as const, label: s.stage2Label } : null,
    }));
    return { items, cached: true, source: 'cache' } satisfies GenerateEventControlListResponse;
  }

  // Cache miss: call the shared proposal helper directly. This avoids a
  // callable-to-callable network hop while preserving the same contract as
  // the admin-facing `proposeEventControlList` endpoint.
  const proposal = await proposeControlItemsForEventWithMetadata(eventId, versionId);

  if (!proposal.items.length) {
    throw new HttpsError('failed-precondition', 'The proposal function returned no items. Check the event has required authorities.');
  }
  return { ...proposal, cached: false } satisfies GenerateEventControlListResponse;
});
