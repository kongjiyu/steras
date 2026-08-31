/** Runtime-free identifiers for the managed STERAS Module 3 test dataset. */

export const STERAS_TEST_DATASET_ID = 'steras-module3-test-v2' as const;
export const STERAS_TEST_SHARED_PROJECT_ID = 'linkos-496505' as const;

export const STERAS_TEST_STATES = [
  'Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Penang', 'Perak',
  'Perlis', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu', 'Kuala Lumpur', 'Labuan', 'Putrajaya',
] as const;

export type SterasTestState = (typeof STERAS_TEST_STATES)[number];

export const STERAS_TEST_EVENT_MATRIX = [
  ['johor', 'concert'], ['johor', 'festival'],
  ['kedah', 'sports'], ['kedah', 'cultural'],
  ['kelantan', 'religious'], ['kelantan', 'exhibition'],
  ['melaka', 'fair'], ['melaka', 'conference'],
  ['negeri-sembilan', 'other'], ['negeri-sembilan', 'concert'],
  ['pahang', 'festival'], ['pahang', 'sports'],
  ['penang', 'cultural'], ['penang', 'religious'],
  ['perak', 'exhibition'], ['perak', 'fair'],
  ['perlis', 'conference'], ['perlis', 'other'],
  ['sabah', 'concert'], ['sabah', 'festival'],
  ['sarawak', 'sports'], ['sarawak', 'cultural'],
  ['selangor', 'religious'], ['selangor', 'exhibition'],
  ['terengganu', 'fair'], ['terengganu', 'conference'],
  ['kuala-lumpur', 'other'], ['kuala-lumpur', 'concert'],
  ['labuan', 'festival'], ['labuan', 'sports'],
  ['putrajaya', 'cultural'], ['putrajaya', 'religious'],
] as const;

export const STERAS_TEST_EVENT_IDS = Object.freeze(
  STERAS_TEST_STATES.flatMap((state) => {
    const slug = stateSlug(state);
    return [`steras-test-${slug}-01`, `steras-test-${slug}-02`];
  }),
);

/** Stable aliases used by the Module 3 Playwright workflows. */
export const STERAS_TEST_EVENTS = {
  initialReady: 'steras-test-johor-01',
  // Selangor keeps the default Playwright PDRM/BOMBA/KKM accounts in scope;
  // the scenario still covers a compliance-blocked manual assessment.
  complianceBlocked: 'steras-test-selangor-02',
  provisionalReview: 'steras-test-kedah-02',
  // Selangor's religious event requires PDRM/BOMBA/KKM/MOTAC and is used by
  // the assignment workstream so all four browser officers are state-eligible.
  awaitingAssignment: 'steras-test-selangor-01',
  // Kuala Lumpur's "other" event requires PDRM/BOMBA/KKM/DBKL and no MOTAC;
  // the aggregate Playwright workflow intentionally exercises those four
  // authorities.
  authorityPartial: 'steras-test-kuala-lumpur-01',
  secondReview: 'steras-test-kelantan-02',
  rejected: 'steras-test-melaka-01',
  secondReviewRejected: 'steras-test-melaka-02',
  controlVerification: 'steras-test-kuala-lumpur-02',
  publicStage2: 'steras-test-putrajaya-02',
} as const;

export const STERAS_TEST_RETIRED_EVENT_IDS = Object.freeze([] as const);

export type SterasTestEventId = (typeof STERAS_TEST_EVENT_IDS)[number];

/** Playwright's default accounts. All visible names use the STERAS convention. */
export const STERAS_TEST_ACCOUNT_EMAILS = {
  admin: 'admin1@steras.test',
  organizer: 'organizer1@steras.test',
  public: 'public1@steras.test',
  PDRM: 'pdrm.selangor@steras.test',
  BOMBA: 'bomba.selangor@steras.test',
  KKM: 'kkm.selangor@steras.test',
  DBKL: 'dbkl.kuala-lumpur@steras.test',
  MOTAC: 'motac.selangor@steras.test',
} as const;

export const STERAS_TEST_ADMIN_EMAILS = {
  admin1: 'admin1@steras.test',
  admin2: 'admin2@steras.test',
  admin3: 'admin3@steras.test',
} as const;

export interface SterasTestMarker {
  datasetId: typeof STERAS_TEST_DATASET_ID;
  fixtureId: string;
  managedBy: 'seed:steras:test';
}

export function isSterasTestEventId(value: string): value is SterasTestEventId {
  return (STERAS_TEST_EVENT_IDS as readonly string[]).includes(value);
}

export function stateSlug(state: string): string {
  return state.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
