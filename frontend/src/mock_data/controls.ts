/**
 * Event control fixtures (PLANNED per FR-M3-19/20/26).
 *
 * The shape here is the local mock type that anticipates the planned
 * `EventControl` collection structure described in
 * `STERAS_M3_Modified_Scope_Enhancement_Proposals.md` §8.
 *
 * When the real types land in shared/types.ts, the local types in this
 * file can be deleted and the fixtures re-typed to the canonical shape.
 */

import { EVENT_IDS, USER_IDS, daysAgo } from './ids';

// Bundled images (Vite hashes these into public URL strings). When wiring
// live Firestore data, replace the import with a Firebase Storage URL
// string and the `Stage2Doc.imageUrl: string` contract stays unchanged.
import policePresenceJpg from './images/police-presence.jpg';
import fireMarshalJpg from './images/fire-marshal.jpg';
import medicalStationJpg from './images/medical-station.jpg';
import crowdControlJpg from './images/crowd-control.jpg';
import wasteMgmtJpg from './images/waste-mgmt.jpg';

export type StageRequirement = 'stage1_only' | 'stage1_and_stage2';
export type Stage1DocType = 'receipt' | 'application' | 'floor_plan' | 'license' | 'insurance' | 'other';
export type Stage1Status = 'pending_submission' | 'pending_verification' | 'verified' | 'rejected' | 'use_previous';
export type ControlLabel = 'approved' | 'pending' | 'reported_under_review' | 'resubmit_required';
export type ControlAuthority = 'PDRM' | 'BOMBA' | 'KKM' | 'DBKL' | 'MOTAC';

/** Real-photo image map. Keys are the per-control category slot; values
 *  are the bundled Stage 2 image URL. Reused by every approved event so
 *  the dashboard looks consistent across events. */
export const STAGE2_IMAGE = {
  policePresence: policePresenceJpg,
  fireMarshal: fireMarshalJpg,
  medicalStation: medicalStationJpg,
  crowdControl: crowdControlJpg,
  wasteMgmt: wasteMgmtJpg,
} as const;

export interface Stage1Doc {
  docId: string;
  docType: Stage1DocType;
  label: string;
  uploadedAt?: number;
  uploadedBy?: string;
  evidencePath?: string;
  status: Stage1Status;
  usePreviousSourceEventId?: string;
  verifiedBy?: string;
  verifiedAt?: number;
  rejectionReason?: string;
  rejectionSuggestion?: string;
}

export interface Stage2Doc {
  docId: string;
  imageUrl: string;
  uploadedAt: number;
  uploadedBy: string;
  publicConfirmCount: number;
  reportedAt?: number;
  m4TicketId?: string;
  published: boolean;
  publishedAt?: number;
}

export interface EventControl {
  controlId: string;
  eventId: string;
  versionId: string;
  controlName: string;
  authority: ControlAuthority;
  stageRequirement: StageRequirement;
  stage1Docs: Stage1Doc[];
  stage2Docs: Stage2Doc[];
  controlItemVersion: number;
  usePreviousSourceEventId?: string;
  publicConfirmCount: number;
  reportedAt?: number;
  m4TicketId?: string;
  published: boolean;
  publishedAt?: number;
  publishedBy?: string;
  label: ControlLabel;
  labelAddedAt?: number;
  labelRemovedAt?: number;
}

// ---------------------------------------------------------------------------
// E001 - Dataran Merdeka Music Festival (5 controls, all verified+published)
// ---------------------------------------------------------------------------
const e001Controls: EventControl[] = [
  {
    controlId: 'ctrl-e001-01-police-presence',
    eventId: EVENT_IDS.E001, versionId: 'v1',
    controlName: 'Police presence at venue',
    authority: 'PDRM',
    stageRequirement: 'stage1_and_stage2',
    stage1Docs: [
      { docId: 'doc-e001-01-s1-1', docType: 'application', label: 'PDRM event notification acknowledgement',
        uploadedAt: daysAgo(20), uploadedBy: USER_IDS.U_ORG_001,
        evidencePath: 'events/evt-001-kl-music-festival/controls/ctrl-e001-01-police-presence/stage1/pdrm-acknowledgement.pdf',
        status: 'verified', verifiedBy: USER_IDS.U_OFC_PDRM_KL_01, verifiedAt: daysAgo(18) },
    ],
    stage2Docs: [
      { docId: 'doc-e001-01-s2-1', imageUrl: STAGE2_IMAGE.policePresence,
        uploadedAt: daysAgo(10), uploadedBy: USER_IDS.U_ORG_001,
        publicConfirmCount: 12, published: true, publishedAt: daysAgo(9) },
    ],
    controlItemVersion: 1,
    publicConfirmCount: 12,
    published: true,
    publishedAt: daysAgo(9),
    publishedBy: USER_IDS.U_ADM_001,
    label: 'approved',
  },
  {
    controlId: 'ctrl-e001-02-fire-marshal',
    eventId: EVENT_IDS.E001, versionId: 'v1',
    controlName: 'Fire marshal on-site',
    authority: 'BOMBA',
    stageRequirement: 'stage1_and_stage2',
    stage1Docs: [
      { docId: 'doc-e001-02-s1-1', docType: 'license', label: 'BOMBA fire safety compliance certificate',
        uploadedAt: daysAgo(20), uploadedBy: USER_IDS.U_ORG_001,
        evidencePath: 'events/evt-001-kl-music-festival/controls/ctrl-e001-02-fire-marshal/stage1/bomba-fsc.pdf',
        status: 'use_previous', usePreviousSourceEventId: 'evt-005-shah-alam-beach-carnival-v1',  // <-- A25: use previous
        verifiedBy: 'system', verifiedAt: daysAgo(20) },
    ],
    stage2Docs: [
      { docId: 'doc-e001-02-s2-1', imageUrl: STAGE2_IMAGE.fireMarshal,
        uploadedAt: daysAgo(10), uploadedBy: USER_IDS.U_ORG_001,
        publicConfirmCount: 8, published: true, publishedAt: daysAgo(9) },
    ],
    controlItemVersion: 1,
    usePreviousSourceEventId: 'evt-005-shah-alam-beach-carnival-v1',
    publicConfirmCount: 8,
    published: true,
    publishedAt: daysAgo(9),
    publishedBy: USER_IDS.U_ADM_001,
    label: 'approved',
  },
  {
    controlId: 'ctrl-e001-03-medical-station',
    eventId: EVENT_IDS.E001, versionId: 'v1',
    controlName: 'Medical station at venue',
    authority: 'KKM',
    stageRequirement: 'stage1_and_stage2',
    stage1Docs: [
      { docId: 'doc-e001-03-s1-1', docType: 'license', label: 'KKM medical team credentials',
        uploadedAt: daysAgo(20), uploadedBy: USER_IDS.U_ORG_001,
        evidencePath: 'events/evt-001-kl-music-festival/controls/ctrl-e001-03-medical-station/stage1/kkm-credentials.pdf',
        status: 'verified', verifiedBy: USER_IDS.U_OFC_KKM_KL_01, verifiedAt: daysAgo(18) },
      { docId: 'doc-e001-03-s1-2', docType: 'receipt', label: 'Medical supplies purchase receipt',
        uploadedAt: daysAgo(20), uploadedBy: USER_IDS.U_ORG_001,
        evidencePath: 'events/evt-001-kl-music-festival/controls/ctrl-e001-03-medical-station/stage1/medical-supplies-receipt.pdf',
        status: 'verified', verifiedBy: USER_IDS.U_OFC_KKM_KL_01, verifiedAt: daysAgo(18) },
    ],
    stage2Docs: [
      { docId: 'doc-e001-03-s2-1', imageUrl: STAGE2_IMAGE.medicalStation,
        uploadedAt: daysAgo(8), uploadedBy: USER_IDS.U_ORG_001,
        publicConfirmCount: 12, published: true, publishedAt: daysAgo(7) },
    ],
    controlItemVersion: 1,
    publicConfirmCount: 12,
    published: true,
    publishedAt: daysAgo(7),
    publishedBy: USER_IDS.U_ADM_001,
    label: 'approved',
  },
  {
    controlId: 'ctrl-e001-04-crowd-control',
    eventId: EVENT_IDS.E001, versionId: 'v1',
    controlName: 'Crowd control plan and barriers',
    authority: 'PDRM',
    stageRequirement: 'stage1_and_stage2',
    stage1Docs: [
      { docId: 'doc-e001-04-s1-1', docType: 'floor_plan', label: 'Crowd flow floor plan',
        uploadedAt: daysAgo(20), uploadedBy: USER_IDS.U_ORG_001,
        evidencePath: 'events/evt-001-kl-music-festival/controls/ctrl-e001-04-crowd-control/stage1/crowd-flow-plan.pdf',
        status: 'verified', verifiedBy: USER_IDS.U_OFC_PDRM_KL_01, verifiedAt: daysAgo(18) },
    ],
    stage2Docs: [
      { docId: 'doc-e001-04-s2-1', imageUrl: STAGE2_IMAGE.crowdControl,
        uploadedAt: daysAgo(10), uploadedBy: USER_IDS.U_ORG_001,
        publicConfirmCount: 6, published: true, publishedAt: daysAgo(9) },
    ],
    controlItemVersion: 1,
    publicConfirmCount: 6,
    published: true,
    publishedAt: daysAgo(9),
    publishedBy: USER_IDS.U_ADM_001,
    label: 'approved',
  },
  {
    controlId: 'ctrl-e001-05-waste-mgmt',
    eventId: EVENT_IDS.E001, versionId: 'v1',
    controlName: 'Waste management',
    authority: 'DBKL',
    stageRequirement: 'stage1_and_stage2',
    stage1Docs: [
      { docId: 'doc-e001-05-s1-1', docType: 'application', label: 'SWCorp waste collection schedule',
        uploadedAt: daysAgo(20), uploadedBy: USER_IDS.U_ORG_001,
        evidencePath: 'events/evt-001-kl-music-festival/controls/ctrl-e001-05-waste-mgmt/stage1/swcorp-schedule.pdf',
        status: 'verified', verifiedBy: USER_IDS.U_OFC_DBKL_KL_01, verifiedAt: daysAgo(17) },
    ],
    stage2Docs: [
      { docId: 'doc-e001-05-s2-1', imageUrl: STAGE2_IMAGE.wasteMgmt,
        uploadedAt: daysAgo(10), uploadedBy: USER_IDS.U_ORG_001,
        publicConfirmCount: 4, published: true, publishedAt: daysAgo(9) },
    ],
    controlItemVersion: 1,
    publicConfirmCount: 4,
    published: true,
    publishedAt: daysAgo(9),
    publishedBy: USER_IDS.U_ADM_001,
    label: 'approved',
  },
];

// ---------------------------------------------------------------------------
// E011 - Corporate Run (5 controls, all verified+published, override applied)
// ---------------------------------------------------------------------------
const e011Controls: EventControl[] = e001Controls.map((c) => ({
  ...c,
  controlId: c.controlId.replace('e001', 'e011'),
  eventId: EVENT_IDS.E011,
  stage1Docs: c.stage1Docs.map((d) => ({ ...d, docId: d.docId.replace('e001', 'e011'), evidencePath: d.evidencePath?.replace('e001', 'e011') })),
  stage2Docs: c.stage2Docs.map((d) => ({ ...d, docId: d.docId.replace('e001', 'e011') })),
  publicConfirmCount: Math.max(1, Math.floor(c.publicConfirmCount / 2)),
}));

// ---------------------------------------------------------------------------
// E013 - Coastal Cleanup (5 controls; Control #3 reported_under_review)
// ---------------------------------------------------------------------------
const e013Controls: EventControl[] = e001Controls.map((c) => ({
  ...c,
  controlId: c.controlId.replace('e001', 'e013'),
  eventId: EVENT_IDS.E013,
  stage1Docs: c.stage1Docs.map((d) => ({ ...d, docId: d.docId.replace('e001', 'e013'), evidencePath: d.evidencePath?.replace('e001', 'e013') })),
  stage2Docs: c.stage2Docs.map((d) => ({ ...d, docId: d.docId.replace('e001', 'e013') })),
  publicConfirmCount: 2,
}));

// Inject the reported state on Control #3 (medical station)
e013Controls[2].reportedAt = daysAgo(1);
e013Controls[2].m4TicketId = 'rep-001-e013-c3-staged-image';
e013Controls[2].label = 'reported_under_review';
e013Controls[2].labelAddedAt = daysAgo(1);

// ---------------------------------------------------------------------------
// E014 - Shah Alam Music Fest (5 controls; Control #3 resubmit_required)
// ---------------------------------------------------------------------------
const e014Controls: EventControl[] = e001Controls.map((c) => ({
  ...c,
  controlId: c.controlId.replace('e001', 'e014'),
  eventId: EVENT_IDS.E014,
  stage1Docs: c.stage1Docs.map((d) => ({ ...d, docId: d.docId.replace('e001', 'e014'), evidencePath: d.evidencePath?.replace('e001', 'e014') })),
  stage2Docs: c.stage2Docs.map((d) => ({ ...d, docId: d.docId.replace('e001', 'e014'), imageUrl: d.imageUrl.replace('e001', 'e014') })),
  publicConfirmCount: 3,
}));

// Control #3 (medical station) - M4 confirmed_true -> resubmit_required
e014Controls[2].label = 'resubmit_required';
e014Controls[2].labelAddedAt = daysAgo(5);
e014Controls[2].reportedAt = daysAgo(8);
e014Controls[2].m4TicketId = 'rep-002-e014-c3-confirmed';
// Bump controlItemVersion (E3: re-upload versioning)
e014Controls[2].controlItemVersion = 2;
e014Controls[2].stage1Docs = e014Controls[2].stage1Docs.map((d) => ({ ...d, status: 'rejected' as const, rejectionReason: 'Medical team credentials expired', rejectionSuggestion: 'Upload current KKM-issued credentials for medical team lead.' }));
e014Controls[2].stage2Docs = e014Controls[2].stage2Docs.map((d) => ({ ...d, reportedAt: daysAgo(8), m4TicketId: 'rep-002-e014-c3-confirmed' }));

// ---------------------------------------------------------------------------
// E015 - KL Charity Run (5 controls; Control #3 dismissed, back to approved)
// ---------------------------------------------------------------------------
const e015Controls: EventControl[] = e001Controls.map((c) => ({
  ...c,
  controlId: c.controlId.replace('e001', 'e015'),
  eventId: EVENT_IDS.E015,
  stage1Docs: c.stage1Docs.map((d) => ({ ...d, docId: d.docId.replace('e001', 'e015'), evidencePath: d.evidencePath?.replace('e001', 'e015') })),
  stage2Docs: c.stage2Docs.map((d) => ({ ...d, docId: d.docId.replace('e001', 'e015'), imageUrl: d.imageUrl.replace('e001', 'e015') })),
  publicConfirmCount: 5,
}));

// Control #3 (medical station) - M4 dismissed -> restored to approved
e015Controls[2].label = 'approved';
e015Controls[2].labelAddedAt = undefined;
e015Controls[2].labelRemovedAt = daysAgo(5);
e015Controls[2].reportedAt = undefined;
e015Controls[2].m4TicketId = undefined;
e015Controls[2].stage2Docs = e015Controls[2].stage2Docs.map((d) => ({ ...d, reportedAt: undefined, m4TicketId: undefined, publicConfirmCount: 7 }));

// ---------------------------------------------------------------------------
// Combined
// ---------------------------------------------------------------------------
export const mockEventControls: EventControl[] = [
  ...e001Controls,
  ...e011Controls,
  ...e013Controls,
  ...e014Controls,
  ...e015Controls,
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
export const findControlsForEvent = (eventId: string): EventControl[] =>
  mockEventControls.filter((c) => c.eventId === eventId);

export const findControlById = (controlId: string): EventControl | undefined =>
  mockEventControls.find((c) => c.controlId === controlId);

export const findControlsByLabel = (label: ControlLabel): EventControl[] =>
  mockEventControls.filter((c) => c.label === label);
