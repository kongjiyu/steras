/**
 * proposeEventControlList — STUB callable (M3 round N+1, Q5).
 *
 * Per docs/team-handoffs/M3_INTEGRATION_CONTRACT.md §7: M2 owns the real
 * AI-backed version of this function. Until M2 ships it, M3 ships a stub
 * that returns a hardcoded 5-item list (one per authorityType) so the
 * downstream `generateEventControlList` flow can be built and tested.
 *
 * The stub:
 *   - Returns a hardcoded proposed control list for the event's
 *     `requiredAuthorities`.
 *   - When M2 ships the real version, delete this file and the export
 *     in `index.ts`; M3's caller will hit M2's callable instead.
 *   - Does NOT call MiniMax. Pure synchronous stub.
 *
 * Q5 (locked decision): M2 owns the AI call. M3's stub here is a
 * placeholder so the workflow can be exercised end-to-end.
 */
import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  AuthorityType,
  COLLECTIONS,
  EventRecord,
  ProposedControlItem,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';

interface ProposeEventControlListRequest {
  eventId?: string;
  versionId?: string;
}

/** Hardcoded Stage 1 requirements per authority (placeholder until M2). */
const STAGE1_TEMPLATES: Record<AuthorityType, ProposedControlItem['stage1Requirements']> = {
  PDRM:  [
    { docType: 'application', label: 'PDRM event notification acknowledgement', required: true },
    { docType: 'insurance',   label: 'Public liability insurance',                required: true },
    { docType: 'license',     label: 'Crowd management plan acknowledgement',    required: false },
  ],
  BOMBA: [
    { docType: 'application', label: 'BOMBA event notification acknowledgement', required: true },
    { docType: 'license',     label: 'Fire safety officer posting licence',     required: true },
    { docType: 'floor_plan',  label: 'Egress floor plan',                         required: true },
    { docType: 'insurance',   label: 'Public liability insurance',               required: true },
  ],
  KKM:   [
    { docType: 'application', label: 'KKM medical plan acknowledgement',         required: true },
    { docType: 'license',     label: 'On-site medical team licence',              required: true },
    { docType: 'insurance',   label: 'Public liability insurance',                required: true },
  ],
  DBKL:  [
    { docType: 'application', label: 'DBKL venue permit acknowledgement',        required: true },
    { docType: 'license',     label: 'Venue operating licence',                   required: true },
    { docType: 'insurance',   label: 'Public liability insurance',                required: true },
  ],
  MOTAC: [
    { docType: 'application', label: 'MOTAC tourism permit acknowledgement',     required: true },
    { docType: 'license',     label: 'Tourism operator licence',                 required: true },
  ],
};

/** Human-readable control names per authority. */
const CONTROL_NAMES: Record<AuthorityType, string> = {
  PDRM:  'PDRM presence + traffic management',
  BOMBA: 'Bomba fire safety + egress verification',
  KKM:   'KKM medical + sanitation verification',
  DBKL:  'DBKL venue + emergency access verification',
  MOTAC: 'MOTAC tourism operator compliance',
};

const STAGE2_LABEL: Record<AuthorityType, string> = {
  PDRM:  'Photo of PDRM officers on-site at venue',
  BOMBA: 'Photo of BOMBA officers and fire extinguishers at venue',
  KKM:   'Photo of KKM medical team + ambulance at venue',
  DBKL:  'Photo of DBKL-approved venue setup',
  MOTAC: 'Photo of MOTAC permit displayed at venue',
};

export const proposeEventControlList = onCall<ProposeEventControlListRequest>({ region: FUNCTION_REGION }, async (request) => {
  const eventId = (request.data?.eventId ?? '').trim();
  const versionId = (request.data?.versionId ?? '').trim();
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!versionId) throw new HttpsError('invalid-argument', 'versionId is required.');

  const items = await proposeControlItemsForEvent(eventId, versionId);
  console.log(`[proposeEventControlList:STUB] eventId=${eventId} versionId=${versionId} returning ${items.length} items`);
  return { items };
});

/**
 * Reusable core: look up the event and return the proposed control
 * items. Exported so other Cloud Functions (e.g. `generateEventControlList`)
 * can call this without going through the onCall surface (which would
 * require a deployed URL and auth context).
 */
export async function proposeControlItemsForEvent(eventId: string, versionId: string): Promise<ProposedControlItem[]> {
  const eventSnap = await firestore().collection(COLLECTIONS.EVENTS).doc(eventId).get();
  if (!eventSnap.exists) {
    throw new Error(`Event ${eventId} not found.`);
  }
  const event = eventSnap.data() as EventRecord;
  const required = event.requiredAuthorities ?? [];

  // STUB: return a hardcoded list. When M2 ships the real one, this
  // function is replaced with a call to M2's callable.
  const items: ProposedControlItem[] = required.map((authority) => ({
    controlName: CONTROL_NAMES[authority] ?? `${authority} compliance`,
    authority,
    stageRequirement: 'stage1_and_stage2',
    stage1Requirements: STAGE1_TEMPLATES[authority] ?? [],
    stage2Requirement: { kind: 'image', label: STAGE2_LABEL[authority] ?? `Photo of ${authority} at venue` },
  }));
  return items;
}
