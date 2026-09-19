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
  ControlListProposal,
  EventControl,
  EventRecord,
  ProposedControlItem,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { MINIMAX_API_KEY } from '../config/secrets';
import { proposeControlItemsForEventWithMetadata } from './proposeEventControlList';
import {
  fixedPresetForEvent,
  riskLevelFromAssessment,
  type FixedWorkflowPresetSelection,
} from '../utils/m3FixedWorkflowPreset';

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
  proposalId?: string;
  proposalRevision?: number;
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
  const force = request.data?.force === true;
  if (!versionId) {
    throw new HttpsError('failed-precondition', 'The event has no submitted version.');
  }
  if (event.status !== 'Approved') {
    throw new HttpsError('failed-precondition', `Control list can only be generated after Admin final approval (current: ${event.status}).`);
  }

  // Lock the fixture-derived workflow before returning any draft or cached
  // proposal.  This makes Generate itself the first-operation boundary: a
  // later retry cannot silently re-match the event to a different template
  // after its risk assessment changes.
  await ensureFixedWorkflowSelection(db, eventRef, event, versionId);

  const proposalRef = eventRef.collection(COLLECTIONS.CONTROL_LIST_PROPOSALS).doc(versionId);
  const existingProposalSnap = await proposalRef.get();
  const existingProposal = existingProposalSnap.data() as ControlListProposal | undefined;

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
      return {
        items,
        cached: true,
        source: 'cache',
        ...(existingProposal?.proposalId ? { proposalId: existingProposal.proposalId, proposalRevision: existingProposal.revision } : {}),
      } satisfies GenerateEventControlListResponse;
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
    return {
      items,
      cached: true,
      source: 'cache',
      ...(existingProposal?.proposalId ? { proposalId: existingProposal.proposalId, proposalRevision: existingProposal.revision } : {}),
    } satisfies GenerateEventControlListResponse;
  }

  // A generated proposal is a recoverable draft, not a published control
  // list. Reuse it on navigation/reload unless the Admin explicitly asks to
  // regenerate it.
  if (!force && existingProposalSnap.exists && existingProposal?.status === 'draft'
    && existingProposal.eventId === eventId && existingProposal.versionId === versionId
    && Array.isArray(existingProposal.items) && existingProposal.items.length > 0) {
    return {
      items: existingProposal.items,
      cached: true,
      source: existingProposal.source,
      model: existingProposal.model,
      promptVersion: existingProposal.promptVersion,
      generatedAt: existingProposal.generatedAt,
      ...(existingProposal.fallbackReason ? { fallbackReason: existingProposal.fallbackReason } : {}),
      proposalId: existingProposal.proposalId,
      proposalRevision: existingProposal.revision,
    } satisfies GenerateEventControlListResponse;
  }

  // Cache miss: call the shared proposal helper directly. This avoids a
  // callable-to-callable network hop while preserving the same contract as
  // the admin-facing `proposeEventControlList` endpoint.
  const proposal = await proposeControlItemsForEventWithMetadata(eventId, versionId);

  if (!proposal.items.length) {
    throw new HttpsError('failed-precondition', 'The proposal function returned no items. Check the event has required authorities.');
  }
  const now = Date.now();
  const persisted = await db.runTransaction(async (tx) => {
    const [currentEventSnap, currentProposalSnap] = await Promise.all([tx.get(eventRef), tx.get(proposalRef)]);
    const currentEvent = currentEventSnap.data() as EventRecord | undefined;
    if (!currentEventSnap.exists || currentEvent?.currentVersionId !== versionId || currentEvent.status !== 'Approved') {
      throw new HttpsError('aborted', 'The application changed while the control proposal was being generated. Reload and try again.');
    }
    const currentProposal = currentProposalSnap.data() as ControlListProposal | undefined;
    if (!force && currentProposalSnap.exists && currentProposal?.status === 'draft'
      && currentProposal.eventId === eventId && currentProposal.versionId === versionId
      && Array.isArray(currentProposal.items) && currentProposal.items.length > 0) {
      return { record: currentProposal, cached: true };
    }
    const revision = Number.isSafeInteger(currentProposal?.revision) && (currentProposal?.revision ?? 0) > 0
      ? (currentProposal!.revision + 1) : 1;
    const record: ControlListProposal = {
      proposalId: `${eventId}_${versionId}`,
      eventId,
      versionId,
      revision,
      status: 'draft',
      items: proposal.items,
      source: proposal.source,
      model: proposal.model,
      promptVersion: proposal.promptVersion,
      generatedAt: proposal.generatedAt,
      generatedBy: request.auth!.uid,
      updatedAt: now,
      ...(proposal.fallbackReason ? { fallbackReason: proposal.fallbackReason } : {}),
    };
    tx.set(proposalRef, record);
    return { record, cached: false };
  });
  return {
    items: persisted.record.items,
    cached: persisted.cached,
    source: persisted.record.source,
    model: persisted.record.model,
    promptVersion: persisted.record.promptVersion,
    generatedAt: persisted.record.generatedAt,
    ...(persisted.record.fallbackReason ? { fallbackReason: persisted.record.fallbackReason } : {}),
    proposalId: persisted.record.proposalId,
    proposalRevision: persisted.record.revision,
  } satisfies GenerateEventControlListResponse;
});

async function ensureFixedWorkflowSelection(
  db: FirebaseFirestore.Firestore,
  eventRef: FirebaseFirestore.DocumentReference,
  event: EventRecord,
  versionId: string,
): Promise<FixedWorkflowPresetSelection> {
  if (event.fixedWorkflowPreset?.version === 'm3-fixed-workflow-v1') {
    return event.fixedWorkflowPreset as FixedWorkflowPresetSelection;
  }
  const assessmentSnap = event.currentAssessmentId
    ? await eventRef.collection(COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId).get()
    : null;
  const selection: FixedWorkflowPresetSelection = fixedPresetForEvent(event, riskLevelFromAssessment(assessmentSnap?.data())).selection;
  return db.runTransaction(async (tx) => {
    const currentSnap = await tx.get(eventRef);
    const current = currentSnap.data() as EventRecord | undefined;
    if (!currentSnap.exists || current?.currentVersionId !== versionId || current.status !== 'Approved') {
      throw new HttpsError('aborted', 'The application changed while the fixed workflow was being selected. Reload and try again.');
    }
    if (current.fixedWorkflowPreset?.version === 'm3-fixed-workflow-v1') {
      return current.fixedWorkflowPreset as FixedWorkflowPresetSelection;
    }
    tx.update(eventRef, { fixedWorkflowPreset: selection, updatedAt: Date.now() });
    return selection;
  });
}
