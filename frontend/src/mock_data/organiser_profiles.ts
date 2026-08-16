import { UserProfile } from '@shared/types';
import { USER_IDS, MOCK_NOW } from './ids';
import { findUserById } from './users';

/**
 * Full organiser application profile (per `template content.md` §B).
 *
 * M1 would upload the MyKad / SSM / ROS documents to Firebase Storage
 * and reference them here. M3 only reads this for context during
 * review (organiser name, safety coordinator contact).
 *
 * Local type — promote to `@shared/types.ts` when M1 finalises the
 * application-form contract.
 */

export type OrganisationType = 'SSM' | 'ROS' | 'other';
export type RegistrationStatus = 'active' | 'suspended' | 'expired';

export interface SafetyCoordinator {
  name: string;
  role: string;
  contact: string;
  email: string;
  yearsOfExperience: number;
}

export interface PriorEvent {
  eventName: string;
  year: number;
  attendance: number;
  incidentCount: number;
  agency: string;
  lessonsLearned?: string;
}

export interface OrganiserProfile {
  organiserId: string;
  legalOrganisationName: string;
  tradingName?: string;
  organisationType: OrganisationType;
  registrationNumber: string;
  registeredAddress: string;
  registrationStatus: RegistrationStatus;
  /** Section B.5 - person responsible for safety coordination. */
  safetyCoordinator: SafetyCoordinator;
  /** Section B.6 - prior events. */
  priorEvents: PriorEvent[];
  /** Section B.7 - any prior incidents worth disclosing. */
  priorIncidentNotes?: string;
  /** Stats derived from prior events (for M5 analytics + M3 risk context). */
  totalPriorEvents: number;
  totalPriorAttendance: number;
  totalPriorIncidents: number;
  yearsOperating: number;
}

const baseOrganiser = (
  organiserId: string,
  profile: Omit<OrganiserProfile, 'organiserId' | 'totalPriorEvents' | 'totalPriorAttendance' | 'totalPriorIncidents' | 'yearsOperating'>,
): OrganiserProfile => {
  const totalPriorEvents = profile.priorEvents.length;
  const totalPriorAttendance = profile.priorEvents.reduce((s, e) => s + e.attendance, 0);
  const totalPriorIncidents = profile.priorEvents.reduce((s, e) => s + e.incidentCount, 0);
  const yearsOperating = profile.priorEvents.length > 0
    ? MOCK_NOW - Math.min(...profile.priorEvents.map((e) => new Date(e.year, 0, 1).getTime()))
    : 0;
  return { organiserId, totalPriorEvents, totalPriorAttendance, totalPriorIncidents, yearsOperating: Math.floor(yearsOperating / (365 * 24 * 60 * 60 * 1000)), ...profile };
};

// ---------------------------------------------------------------------------
// Per-organiser profiles
// ---------------------------------------------------------------------------
export const mockOrganiserProfiles: OrganiserProfile[] = [
  // U_ORG_001 - Chia Yu Xin (M3 owner) - experienced, clean record
  baseOrganiser(USER_IDS.U_ORG_001, {
    legalOrganisationName: 'Steras Events Sdn Bhd',
    tradingName: 'Steras Events',
    organisationType: 'SSM',
    registrationNumber: 'SSM-202101987654 (1234567-X)',
    registeredAddress: 'Level 12, Menara Stellas, Jalan Sultan Ismail, 50250 Kuala Lumpur',
    registrationStatus: 'active',
    safetyCoordinator: {
      name: 'Chia Yu Xin',
      role: 'Event Director & Safety Lead',
      contact: '+60 12-101 0001',
      email: 'chia.yuxin@steras.test',
      yearsOfExperience: 6,
    },
    priorEvents: [
      { eventName: 'KL Skyrun 2024', year: 2024, attendance: 800, incidentCount: 0, agency: 'KKM standby' },
      { eventName: 'Petaling Jaya Night Market 2024', year: 2024, attendance: 4200, incidentCount: 1, agency: 'PDRM patrol', lessonsLearned: 'Added two extra lighting towers at the entry to reduce trip hazards.' },
      { eventName: 'Bukit Jalil Corporate Run 2023', year: 2023, attendance: 5000, incidentCount: 0, agency: 'PDRM traffic control' },
      { eventName: 'KL Charity Run 2023', year: 2023, attendance: 3000, incidentCount: 0, agency: 'KKM standby' },
    ],
  }),

  // U_ORG_002 - Anny Wong - moderate experience
  baseOrganiser(USER_IDS.U_ORG_002, {
    legalOrganisationName: 'Anny Wong Productions',
    organisationType: 'SSM',
    registrationNumber: 'SSM-202000345678 (2345678-Y)',
    registeredAddress: 'No. 45, Jalan SS21/37, Damansara Utama, 47400 Petaling Jaya, Selangor',
    registrationStatus: 'active',
    safetyCoordinator: {
      name: 'Anny Wong',
      role: 'Festival Producer',
      contact: '+60 12-101 0002',
      email: 'anny.wong@steras.test',
      yearsOfExperience: 4,
    },
    priorEvents: [
      { eventName: 'PJ Heritage Food Fair 2024', year: 2024, attendance: 4800, incidentCount: 0, agency: 'KKM on-site officer' },
      { eventName: 'Axiata Arena Cultural Night 2024', year: 2024, attendance: 2100, incidentCount: 0, agency: 'BOMBA standby' },
      { eventName: 'KL World Tour 2023', year: 2023, attendance: 19500, incidentCount: 2, agency: 'PDRM + KKM joint', lessonsLearned: 'Earlier briefing for stewards on mosh-pit response prevented reoccurrence.' },
    ],
  }),

  // U_ORG_003 - Yap Ern Tong (M4 owner) - new, building track record
  baseOrganiser(USER_IDS.U_ORG_003, {
    legalOrganisationName: 'Yap Active Sports Events',
    organisationType: 'SSM',
    registrationNumber: 'SSM-202301123456 (3456789-Z)',
    registeredAddress: 'Lot 88, Lorong Maju, Taman Indah, 88300 Kota Kinabalu, Sabah',
    registrationStatus: 'active',
    safetyCoordinator: {
      name: 'Yap Ern Tong',
      role: 'Race Director',
      contact: '+60 12-101 0003',
      email: 'yap.erntong@steras.test',
      yearsOfExperience: 3,
    },
    priorEvents: [
      { eventName: 'KLCC Skyrun 2024', year: 2024, attendance: 750, incidentCount: 0, agency: 'KKM standby' },
      { eventName: 'KL Coastal Cleanup 2024', year: 2024, attendance: 550, incidentCount: 0, agency: 'PDRM advisory' },
    ],
  }),

  // U_ORG_004 - Oh Wan Ting (M5 owner) - community-focused
  baseOrganiser(USER_IDS.U_ORG_004, {
    legalOrganisationName: 'Oh Wan Ting Community Services',
    organisationType: 'ROS',
    registrationNumber: 'ROS-PPM-12345/2019',
    registeredAddress: 'No. 12, Jalan 17/29, Section 17, 46400 Petaling Jaya, Selangor',
    registrationStatus: 'active',
    safetyCoordinator: {
      name: 'Oh Wan Ting',
      role: 'Community Engagement Lead',
      contact: '+60 12-101 0004',
      email: 'oh.wanting@steras.test',
      yearsOfExperience: 2,
    },
    priorEvents: [
      { eventName: 'PJ Community Fair 2024', year: 2024, attendance: 1400, incidentCount: 0, agency: 'PDRM advisory' },
      { eventName: 'Bukit Jalil Marathon 2023', year: 2023, attendance: 22000, incidentCount: 1, agency: 'KKM + PDRM joint', lessonsLearned: 'BOMBA rejected v1 due to insufficient medical plan; re-designed in v2.' },
    ],
  }),

  // U_ORG_005 - Kong Ji Yu (M2 owner / integrator) - longest history
  baseOrganiser(USER_IDS.U_ORG_005, {
    legalOrganisationName: 'Kong Cultural Heritage Berhad',
    organisationType: 'SSM',
    registrationNumber: 'SSM-201800765432 (4567890-A)',
    registeredAddress: 'Level 8, Wisma Warisan, Jalan Tun Sambanthan, 50470 Kuala Lumpur',
    registrationStatus: 'active',
    safetyCoordinator: {
      name: 'Kong Ji Yu',
      role: 'Heritage Festival Director',
      contact: '+60 12-101 0005',
      email: 'kong.jiyu@steras.test',
      yearsOfExperience: 8,
    },
    priorEvents: [
      { eventName: 'Dataran Merdeka Night Market 2023', year: 2023, attendance: 3800, incidentCount: 0, agency: 'PDRM + DBKL' },
      { eventName: 'Shah Alam Beach Carnival 2023', year: 2023, attendance: 7500, incidentCount: 1, agency: 'BOMBA rejected; no event held', lessonsLearned: 'Re-applied with proper venue fire certification in 2024.' },
      { eventName: 'Bukit Jalil Charity Run 2024', year: 2024, attendance: 2800, incidentCount: 0, agency: 'PDRM traffic control' },
      { eventName: 'KL Heritage Week 2022', year: 2022, attendance: 12000, incidentCount: 0, agency: 'PDRM + DBKL + MOTAC' },
      { eventName: 'KL Lantern Festival 2022', year: 2022, attendance: 9000, incidentCount: 0, agency: 'BOMBA + KKM' },
    ],
    priorIncidentNotes: '2023 Shah Alam Beach Carnival application was rejected by BOMBA due to venue fire-cert non-compliance. The event was cancelled and the certificate was subsequently obtained. All subsequent events have full certification before submission.',
  }),
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
export const findOrganiserProfile = (organiserId: string): OrganiserProfile | undefined =>
  mockOrganiserProfiles.find((p) => p.organiserId === organiserId);

export const mockOrganiserProfilesById: Record<string, OrganiserProfile> = Object.fromEntries(
  mockOrganiserProfiles.map((p) => [p.organiserId, p]),
);

/** Returns the UserProfile (M1) + the extended OrganiserProfile (M3 review context). */
export const getOrganiserFullContext = (organiserId: string): { user: UserProfile | undefined; profile: OrganiserProfile | undefined } => {
  const user = findUserById(organiserId);
  const profile = findOrganiserProfile(organiserId);
  return { user, profile };
};
