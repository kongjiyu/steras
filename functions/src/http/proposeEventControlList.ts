/**
 * proposeEventControlList — admin-only control-list proposal callable.
 *
 * M3 uses the shared MiniMax advisory client and keeps deterministic
 * per-authority templates as an explicit fallback for unavailable or invalid
 * provider responses. The generate flow calls the shared helper directly so
 * it does not make a callable-to-callable network hop.
 */
import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  AuthorityType,
  COLLECTIONS,
  EventRecord,
  ProposedControlItem,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { MINIMAX_API_KEY } from '../config/secrets';
import { proposeControlListWithMiniMax, type ControlListProposalResult } from '../engines/controlListProposer';

interface ProposeEventControlListRequest {
  eventId?: string;
  versionId?: string;
}

/** Deterministic per-authority Stage 1 requirements used only as the
 * explicitly labelled fallback when the advisory provider is unavailable. */
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

export const proposeEventControlList = onCall<ProposeEventControlListRequest>({ region: FUNCTION_REGION, secrets: [MINIMAX_API_KEY] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before requesting a control-list proposal.');
  const profileSnap = await firestore().collection(COLLECTIONS.USERS).doc(request.auth.uid).get();
  const profile = profileSnap.data() as UserProfile | undefined;
  if (!profile || profile.role !== 'admin') throw new HttpsError('permission-denied', 'Only admins can request a control-list proposal.');
  const eventId = (request.data?.eventId ?? '').trim();
  const versionId = (request.data?.versionId ?? '').trim();
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!versionId) throw new HttpsError('invalid-argument', 'versionId is required.');

  const proposal = await proposeControlItemsForEventWithMetadata(eventId, versionId);
  console.log(`[proposeEventControlList] eventId=${eventId} versionId=${versionId} source=${proposal.source} items=${proposal.items.length}`);
  return proposal;
});

/**
 * Reusable core: look up the event and return the proposed control
 * items. Exported so other Cloud Functions (e.g. `generateEventControlList`)
 * can call this without going through the onCall surface (which would
 * require a deployed URL and auth context).
 */
export async function proposeControlItemsForEvent(eventId: string, versionId: string): Promise<ProposedControlItem[]> {
  const proposal = await proposeControlItemsForEventWithMetadata(eventId, versionId);
  return proposal.items;
}

export async function proposeControlItemsForEventWithMetadata(eventId: string, versionId: string): Promise<ControlListProposalResult> {
  const eventSnap = await firestore().collection(COLLECTIONS.EVENTS).doc(eventId).get();
  if (!eventSnap.exists) {
    throw new Error(`Event ${eventId} not found.`);
  }
  const event = eventSnap.data() as EventRecord;
  if (event.currentVersionId && event.currentVersionId !== versionId) {
    throw new Error(`Version ${versionId} is not the current version for event ${eventId}.`);
  }
  if (event.status !== 'Approved') {
    throw new Error('The Admin second review must approve the current application before generating controls.');
  }
  if (!event.currentAssessmentId || !event.currentResourceId) {
    throw new Error('The current official assessment/resource pointers are missing.');
  }
  const required = event.requiredAuthorities ?? [];

  const fallbackItems: ProposedControlItem[] = required.map((authority) => ({
    controlName: CONTROL_NAMES[authority] ?? `${authority} compliance`,
    authority,
    stageRequirement: 'stage1_and_stage2',
    stage1Requirements: STAGE1_TEMPLATES[authority] ?? [],
    stage2Requirement: { kind: 'image', label: STAGE2_LABEL[authority] ?? `Photo of ${authority} at venue` },
  }));

  const [assessmentSnap, resourceSnap] = await Promise.all([
    event.currentAssessmentId
      ? firestore().collection(COLLECTIONS.EVENTS).doc(eventId).collection(COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId).get()
      : Promise.resolve(null),
    event.currentResourceId
      ? firestore().collection(COLLECTIONS.EVENTS).doc(eventId).collection(COLLECTIONS.RESOURCES).doc(event.currentResourceId).get()
      : Promise.resolve(null),
  ]);
  const assessment = assessmentSnap?.data() as Record<string, unknown> | undefined;
  const resource = resourceSnap?.data() as Record<string, unknown> | undefined;
  if (!assessmentSnap?.exists || assessment?.status !== 'official_ready'
    || assessment.eventId !== eventId || assessment.versionId !== versionId
    || !resourceSnap?.exists || resource?.stage !== 'official'
    || resource.eventId !== eventId || resource.versionId !== versionId
    || resource.assessmentId !== event.currentAssessmentId) {
    throw new Error('The control list requires a current bound M2 V3 official assessment and official resource.');
  }

  let apiKey = '';
  try {
    apiKey = MINIMAX_API_KEY.value();
  } catch {
    // Secret values are unavailable in local/unit environments; the
    // deterministic fallback remains the safe result in that case.
  }
  return proposeControlListWithMiniMax(
    apiKey,
    {
      event,
      requiredAuthorities: required,
      assessment,
      resource,
    },
    fallbackItems,
  );
}
