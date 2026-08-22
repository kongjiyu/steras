/** Runtime-free identifiers for the isolated Module 3 UAT dataset. */

export const M3_UAT_DATASET_ID = 'm3-linkos-v1' as const;
export const M3_UAT_SHARED_PROJECT_ID = 'linkos-496505' as const;

export const M3_UAT_EVENTS = {
  initialReady: 'm3-uat-01-initial-ready',
  complianceBlocked: 'm3-uat-02-compliance-blocked',
  provisionalReview: 'm3-uat-03-provisional-review',
  awaitingAssignment: 'm3-uat-04-awaiting-assignment',
  authorityPartial: 'm3-uat-05-authority-partial',
  secondReview: 'm3-uat-06-second-review',
  rejected: 'm3-uat-07-rejected',
  amendment: 'm3-uat-08-amendment',
  controlVerification: 'm3-uat-09-control-verification',
  publicStage2: 'm3-uat-10-public-stage2',
} as const;

export const M3_UAT_EVENT_IDS = Object.freeze(Object.values(M3_UAT_EVENTS));

export type M3UatEventId = (typeof M3_UAT_EVENT_IDS)[number];

export const M3_UAT_ACCOUNT_EMAILS = {
  admin: 'm3-uat-admin@steras.test',
  organizer: 'm3-uat-organizer@steras.test',
  public: 'm3-uat-public@steras.test',
  PDRM: 'm3-uat-pdrm@steras.test',
  BOMBA: 'm3-uat-bomba@steras.test',
  KKM: 'm3-uat-kkm@steras.test',
  DBKL: 'm3-uat-dbkl@steras.test',
  MOTAC: 'm3-uat-motac@steras.test',
} as const;

export interface M3UatMarker {
  datasetId: typeof M3_UAT_DATASET_ID;
  fixtureId: M3UatEventId;
  managedBy: 'seed:m3:uat';
}

export function isM3UatEventId(value: string): value is M3UatEventId {
  return (M3_UAT_EVENT_IDS as readonly string[]).includes(value);
}

