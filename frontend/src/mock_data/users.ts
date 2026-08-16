import { AuthorityType, UserProfile, UserRole } from '@shared/types';
import { USER_IDS, daysAgo } from './ids';

/**
 * MOCK-only metadata for authority officers. When the planned
 * `scopeType` / `state` / `pendingReviewCount` fields are added to
 * `UserProfile` in shared/types.ts, this can be merged in.
 */
export interface OfficerMeta {
  scopeType: 'state' | 'federal';
  /** Malaysian state name (for state-scoped officers). Federal officers have undefined. */
  state?: 'Kuala Lumpur' | 'Selangor' | 'Penang' | 'Johor' | 'Sabah';
  /** Number of currently-pending reviews. Used by A4 workload-based default-check. */
  pendingReviewCount: number;
}

const now = daysAgo(0);

const baseProfile = (
  uid: string,
  name: string,
  email: string,
  role: UserRole,
  extra: Partial<Pick<UserProfile, 'phone' | 'authorityType'>> = {},
): UserProfile => ({
  uid,
  name,
  email,
  role,
  phone: '+60 12-345 6789',
  createdAt: daysAgo(120),
  updatedAt: now,
  ...extra,
});

// ============================================================================
// Organisers (5 - using the team roster)
// ============================================================================
export const mockOrganisers: UserProfile[] = [
  {
    ...baseProfile(USER_IDS.U_ORG_001, 'Chia Yu Xin', 'chia.yuxin@steras.test', 'organizer',
      { phone: '+60 12-101 0001' }),
  },
  {
    ...baseProfile(USER_IDS.U_ORG_002, 'Anny Wong', 'anny.wong@steras.test', 'organizer',
      { phone: '+60 12-101 0002' }),
  },
  {
    ...baseProfile(USER_IDS.U_ORG_003, 'Yap Ern Tong', 'yap.erntong@steras.test', 'organizer',
      { phone: '+60 12-101 0003' }),
  },
  {
    ...baseProfile(USER_IDS.U_ORG_004, 'Oh Wan Ting', 'oh.wanting@steras.test', 'organizer',
      { phone: '+60 12-101 0004' }),
  },
  {
    ...baseProfile(USER_IDS.U_ORG_005, 'Kong Ji Yu', 'kong.jiyu@steras.test', 'organizer',
      { phone: '+60 12-101 0005' }),
  },
];

// ============================================================================
// Admin (1) - role='authority' but no authorityType
// ============================================================================
export const mockAdmins: UserProfile[] = [
  {
    ...baseProfile(USER_IDS.U_ADM_001, 'Ahmad Razak bin Ismail', 'ahmad.razak@steras.test', 'authority',
      { phone: '+60 12-200 0001' }),
  },
];

// ============================================================================
// Authority officers - Federal (5 - 1 per type)
// ============================================================================
const federalOfficer = (
  uid: string,
  name: string,
  authorityType: AuthorityType,
): UserProfile => baseProfile(uid, name, `${uid}@steras.test`, 'authority', {
  authorityType,
  phone: '+60 12-300 0000',
});

export const mockFederalOfficers: UserProfile[] = [
  federalOfficer(USER_IDS.U_OFC_PDRM_FED_01, 'SAC Tarmizi bin Hashim', 'PDRM'),
  federalOfficer(USER_IDS.U_OFC_BOMBA_FED_01, 'PgKB Ikmal bin Ahmad', 'BOMBA'),
  federalOfficer(USER_IDS.U_OFC_KKM_FED_01, 'Dr. Suriani binti Ali', 'KKM'),
  federalOfficer(USER_IDS.U_OFC_DBKL_FED_01, 'Ir. Faizal bin Othman', 'DBKL'),
  federalOfficer(USER_IDS.U_OFC_MOTAC_FED_01, 'Pn. Zalina binti Yunus', 'MOTAC'),
];

// ============================================================================
// Authority officers - State (20 - 2 per (state, type) per A2)
// ============================================================================
const stateOfficer = (
  uid: string,
  name: string,
  authorityType: AuthorityType,
): UserProfile => baseProfile(uid, name, `${uid}@steras.test`, 'authority', {
  authorityType,
  phone: '+60 12-400 0000',
});

export const mockStateOfficers: UserProfile[] = [
  // Kuala Lumpur (10)
  stateOfficer(USER_IDS.U_OFC_PDRM_KL_01, 'Insp. Raj Kumar a/l Maniam', 'PDRM'),
  stateOfficer(USER_IDS.U_OFC_PDRM_KL_02, 'Insp. Hafiz bin Razali', 'PDRM'),
  stateOfficer(USER_IDS.U_OFC_BOMBA_KL_01, 'PgKB Lim Chong Wei', 'BOMBA'),
  stateOfficer(USER_IDS.U_OFC_BOMBA_KL_02, 'PgKB Sarah binti Mohd', 'BOMBA'),
  stateOfficer(USER_IDS.U_OFC_KKM_KL_01, 'Dr. Rajeshwari a/p Govindan', 'KKM'),
  stateOfficer(USER_IDS.U_OFC_KKM_KL_02, 'Dr. Nurul Ain binti Salleh', 'KKM'),
  stateOfficer(USER_IDS.U_OFC_DBKL_KL_01, 'Ir. Chong Mei Yee', 'DBKL'),
  stateOfficer(USER_IDS.U_OFC_DBKL_KL_02, 'Ir. Daniel anak Bintang', 'DBKL'),
  stateOfficer(USER_IDS.U_OFC_MOTAC_KL_01, 'En. Khairul Anuar bin Bakar', 'MOTAC'),
  stateOfficer(USER_IDS.U_OFC_MOTAC_KL_02, 'Pn. Priya a/p Subramaniam', 'MOTAC'),

  // Selangor (10)
  stateOfficer(USER_IDS.U_OFC_PDRM_SL_01, 'Insp. Nazri bin Ismail', 'PDRM'),
  stateOfficer(USER_IDS.U_OFC_PDRM_SL_02, 'Insp. Kavitha a/p Ramasamy', 'PDRM'),
  stateOfficer(USER_IDS.U_OFC_BOMBA_SL_01, 'PgKB Mohd Faizal bin Ali', 'BOMBA'),
  stateOfficer(USER_IDS.U_OFC_BOMBA_SL_02, 'PgKB Tan Bee Lian', 'BOMBA'),
  stateOfficer(USER_IDS.U_OFC_KKM_SL_01, 'Dr. Vikram a/l Sundram', 'KKM'),
  stateOfficer(USER_IDS.U_OFC_KKM_SL_02, 'Dr. Aishah binti Yusof', 'KKM'),
  stateOfficer(USER_IDS.U_OFC_DBKL_SL_01, 'Ir. Jason Lee Boon Han', 'DBKL'),
  stateOfficer(USER_IDS.U_OFC_DBKL_SL_02, 'Ir. Nurul Huda binti Rahman', 'DBKL'),
  stateOfficer(USER_IDS.U_OFC_MOTAC_SL_01, 'En. Ramesh a/l Krishnan', 'MOTAC'),
  stateOfficer(USER_IDS.U_OFC_MOTAC_SL_02, 'Pn. Shanti a/p Velu', 'MOTAC'),
];

// ============================================================================
// Registered public viewers (3 - can confirm/report Stage 2 images)
// ============================================================================
export const mockPublicViewers: UserProfile[] = [
  baseProfile(USER_IDS.U_PUB_001, 'Lim Wei Jian', 'lim.weijian@steras.test', 'public',
    { phone: '+60 12-500 0001' }),
  baseProfile(USER_IDS.U_PUB_002, 'Tan Mei Ling', 'tan.meiling@steras.test', 'public',
    { phone: '+60 12-500 0002' }),
  baseProfile(USER_IDS.U_PUB_003, 'Goh Kar Ying', 'goh.karying@steras.test', 'public',
    { phone: '+60 12-500 0003' }),
];

// ============================================================================
// Combined
// ============================================================================
export const mockUsers: UserProfile[] = [
  ...mockOrganisers,
  ...mockAdmins,
  ...mockFederalOfficers,
  ...mockStateOfficers,
  ...mockPublicViewers,
];

// ============================================================================
// Officer meta - scopeType / state / pendingReviewCount (mock-only)
// ============================================================================
export const OFFICER_META: Record<string, OfficerMeta> = {
  // Federal - always default-checked (A4)
  [USER_IDS.U_OFC_PDRM_FED_01]: { scopeType: 'federal', pendingReviewCount: 0 },
  [USER_IDS.U_OFC_BOMBA_FED_01]: { scopeType: 'federal', pendingReviewCount: 1 },
  [USER_IDS.U_OFC_KKM_FED_01]: { scopeType: 'federal', pendingReviewCount: 0 },
  [USER_IDS.U_OFC_DBKL_FED_01]: { scopeType: 'federal', pendingReviewCount: 1 },
  [USER_IDS.U_OFC_MOTAC_FED_01]: { scopeType: 'federal', pendingReviewCount: 0 },

  // KL state (primary first by default; A4 picks the one with fewer pending)
  [USER_IDS.U_OFC_PDRM_KL_01]: { scopeType: 'state', state: 'Kuala Lumpur', pendingReviewCount: 3 },
  [USER_IDS.U_OFC_PDRM_KL_02]: { scopeType: 'state', state: 'Kuala Lumpur', pendingReviewCount: 1 },
  [USER_IDS.U_OFC_BOMBA_KL_01]: { scopeType: 'state', state: 'Kuala Lumpur', pendingReviewCount: 2 },
  [USER_IDS.U_OFC_BOMBA_KL_02]: { scopeType: 'state', state: 'Kuala Lumpur', pendingReviewCount: 0 },
  [USER_IDS.U_OFC_KKM_KL_01]: { scopeType: 'state', state: 'Kuala Lumpur', pendingReviewCount: 1 },
  [USER_IDS.U_OFC_KKM_KL_02]: { scopeType: 'state', state: 'Kuala Lumpur', pendingReviewCount: 2 },
  [USER_IDS.U_OFC_DBKL_KL_01]: { scopeType: 'state', state: 'Kuala Lumpur', pendingReviewCount: 0 },
  [USER_IDS.U_OFC_DBKL_KL_02]: { scopeType: 'state', state: 'Kuala Lumpur', pendingReviewCount: 3 },
  [USER_IDS.U_OFC_MOTAC_KL_01]: { scopeType: 'state', state: 'Kuala Lumpur', pendingReviewCount: 1 },
  [USER_IDS.U_OFC_MOTAC_KL_02]: { scopeType: 'state', state: 'Kuala Lumpur', pendingReviewCount: 0 },

  // Selangor state
  [USER_IDS.U_OFC_PDRM_SL_01]: { scopeType: 'state', state: 'Selangor', pendingReviewCount: 2 },
  [USER_IDS.U_OFC_PDRM_SL_02]: { scopeType: 'state', state: 'Selangor', pendingReviewCount: 0 },
  [USER_IDS.U_OFC_BOMBA_SL_01]: { scopeType: 'state', state: 'Selangor', pendingReviewCount: 1 },
  [USER_IDS.U_OFC_BOMBA_SL_02]: { scopeType: 'state', state: 'Selangor', pendingReviewCount: 3 },
  [USER_IDS.U_OFC_KKM_SL_01]: { scopeType: 'state', state: 'Selangor', pendingReviewCount: 0 },
  [USER_IDS.U_OFC_KKM_SL_02]: { scopeType: 'state', state: 'Selangor', pendingReviewCount: 1 },
  [USER_IDS.U_OFC_DBKL_SL_01]: { scopeType: 'state', state: 'Selangor', pendingReviewCount: 2 },
  [USER_IDS.U_OFC_DBKL_SL_02]: { scopeType: 'state', state: 'Selangor', pendingReviewCount: 0 },
  [USER_IDS.U_OFC_MOTAC_SL_01]: { scopeType: 'state', state: 'Selangor', pendingReviewCount: 1 },
  [USER_IDS.U_OFC_MOTAC_SL_02]: { scopeType: 'state', state: 'Selangor', pendingReviewCount: 2 },
};

// ============================================================================
// Lookups
// ============================================================================
export const findUserById = (uid: string): UserProfile | undefined =>
  mockUsers.find((u) => u.uid === uid);

export const findOfficerMeta = (uid: string): OfficerMeta | undefined =>
  OFFICER_META[uid];

/** All state-scoped officers for a given state, sorted by pendingReviewCount asc. */
export const findStateOfficers = (state: OfficerMeta['state']): UserProfile[] => {
  if (!state) return [];
  return mockStateOfficers
    .filter((u) => OFFICER_META[u.uid]?.state === state)
    .sort((a, b) => (OFFICER_META[a.uid]?.pendingReviewCount ?? 0) - (OFFICER_META[b.uid]?.pendingReviewCount ?? 0));
};

/** All federal officers for a given type. */
export const findFederalOfficers = (authorityType: AuthorityType): UserProfile[] =>
  mockFederalOfficers.filter((u) => u.authorityType === authorityType);
