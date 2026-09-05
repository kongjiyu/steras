import { AuthorityType, EventDetails, EventRecord, EventStatus, EventType } from '@shared/types';
import { EVENT_IDS, USER_IDS, VENUE_IDS, daysAgo, daysAhead, hoursAgo } from './ids';
import { mockVenuesById } from './venues';
import { findUserById } from './users';

// ---------------------------------------------------------------------------
// Helpers - keep each event definition compact but explicit
// ---------------------------------------------------------------------------
const mkEventDetails = (overrides: Partial<EventDetails> & {
  name: string;
  type: EventType;
  venueId: string;
  organiserUid: string;
  startDatetime: number;
  endDatetime: number;
  expectedAttendance: number;
}): EventDetails => {
  const venue = mockVenuesById[overrides.venueId];
  if (!venue) throw new Error(`mkEventDetails: unknown venue ${overrides.venueId}`);
  const organiser = findUserById(overrides.organiserUid);
  if (!organiser) throw new Error(`mkEventDetails: unknown organiser ${overrides.organiserUid}`);

  return {
    name: overrides.name,
    type: overrides.type,
    venueId: overrides.venueId,
    venueName: overrides.venueName ?? venue.name,
    venueAddress: overrides.venueAddress ?? venue.address,
    venueLocation: overrides.venueLocation ?? venue.location,
    venueCapacity: overrides.venueCapacity ?? venue.verifiedSafeCapacity ?? venue.capacity,
    expectedAttendance: overrides.expectedAttendance,
    environment: overrides.environment ?? 'outdoor',
    coverage: overrides.coverage ?? 'uncovered',
    seating: overrides.seating ?? 'mixed',
    startDatetime: overrides.startDatetime,
    endDatetime: overrides.endDatetime,
    description: overrides.description,
    emergencyPlanSummary: overrides.emergencyPlanSummary ?? 'Standard event emergency response plan including crowd control, medical standby, evacuation routes and coordination with on-site authorities.',
    riskProfile: overrides.riskProfile,
    organizerName: organiser.name,
    organizerEmail: organiser.email,
    organizerPhone: organiser.phone ?? '+60 12-000 0000',
  };
};

const mkEvent = (overrides: {
  eventId: string;
  organiserUid: string;
  status: EventStatus;
  requiredAuthorities: AuthorityType[];
  eventDetails: EventDetails;
  currentVersionId?: string;
  currentVersionNumber?: number;
  editableVersionId?: string | null;
  draftDocumentPaths?: string[];
  currentAssessmentId?: string;
  currentResourceId?: string;
  createdAt: number;
  updatedAt: number;
  submittedAt?: number;
}): EventRecord => ({
  eventId: overrides.eventId,
  organizerId: overrides.organiserUid,
  eventDetails: overrides.eventDetails,
  status: overrides.status,
  currentVersionId: overrides.currentVersionId,
  currentVersionNumber: overrides.currentVersionNumber ?? 1,
  currentAssessmentId: overrides.currentAssessmentId,
  currentResourceId: overrides.currentResourceId,
  editableVersionId: overrides.editableVersionId ?? null,
  draftDocumentPaths: overrides.draftDocumentPaths ?? [],
  requiredAuthorities: overrides.requiredAuthorities,
  createdAt: overrides.createdAt,
  updatedAt: overrides.updatedAt,
  submittedAt: overrides.submittedAt,
});

// ---------------------------------------------------------------------------
// 17 events covering all 7 statuses + edge cases
// ---------------------------------------------------------------------------
export const mockEvents: EventRecord[] = [
  // =======================================================================
  // E001 - KL Music Festival - Approved + Published (happy path with controls)
  // =======================================================================
  mkEvent({
    eventId: EVENT_IDS.E001,
    organiserUid: USER_IDS.U_ORG_001,
    status: 'Approved',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'],
    currentVersionId: 'v1',
    currentVersionNumber: 1,
    currentAssessmentId: 'v1',
    currentResourceId: 'v1',
    eventDetails: mkEventDetails({
      name: 'Dataran Merdeka Music Festival 2026',
      type: 'festival',
      venueId: VENUE_IDS.V001,
      organiserUid: USER_IDS.U_ORG_001,
      expectedAttendance: 15000,
      environment: 'outdoor',
      coverage: 'uncovered',
      seating: 'standing',
      startDatetime: daysAhead(75),
      endDatetime: daysAhead(75) + 8 * 60 * 60 * 1000,
      description: 'A two-day open-air music festival featuring 12 local and international artists. Expected to draw 15,000 attendees over the weekend with food and beverage concessions on-site.',
    }),
    createdAt: daysAgo(30),
    submittedAt: daysAgo(28),
    updatedAt: daysAgo(5),
  }),

  // =======================================================================
  // E002 - PJ Food Fair - UnderReview (mid) - one Approved, others pending - PROVISIONAL
  // =======================================================================
  mkEvent({
    eventId: EVENT_IDS.E002,
    organiserUid: USER_IDS.U_ORG_002,
    status: 'UnderReview',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM'],
    currentVersionId: 'v1',
    currentVersionNumber: 1,
    currentAssessmentId: 'v1',
    currentResourceId: 'v1',
    eventDetails: mkEventDetails({
      name: 'Petaling Jaya Heritage Food Fair',
      type: 'fair',
      venueId: VENUE_IDS.V006,
      organiserUid: USER_IDS.U_ORG_002,
      expectedAttendance: 5000,
      environment: 'indoor',
      coverage: 'covered',
      seating: 'mixed',
      startDatetime: daysAhead(45),
      endDatetime: daysAhead(45) + 6 * 60 * 60 * 1000,
      description: 'Heritage food fair celebrating traditional Malaysian cuisine. 80 stalls, cooking demonstrations, and cultural performances.',
    }),
    createdAt: daysAgo(14),
    submittedAt: daysAgo(12),
    updatedAt: daysAgo(1),
  }),

  // =======================================================================
  // E003 - KL Mountain Run - Pending (M2 still processing)
  // =======================================================================
  mkEvent({
    eventId: EVENT_IDS.E003,
    organiserUid: USER_IDS.U_ORG_003,
    status: 'Pending',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM'],
    currentVersionId: 'v1',
    currentVersionNumber: 1,
    currentAssessmentId: 'v1',
    currentResourceId: 'v1',
    eventDetails: mkEventDetails({
      name: 'KLCC Skyrun 2026',
      type: 'sports',
      venueId: VENUE_IDS.V003,
      organiserUid: USER_IDS.U_ORG_003,
      expectedAttendance: 800,
      environment: 'indoor',
      coverage: 'covered',
      seating: 'mixed',
      startDatetime: daysAhead(60),
      endDatetime: daysAhead(60) + 4 * 60 * 60 * 1000,
      description: 'Indoor stair-climbing marathon across KLCC Convention Centre. 800 participants, staggered start times.',
    }),
    createdAt: hoursAgo(18),
    submittedAt: hoursAgo(6),
    updatedAt: hoursAgo(6),
  }),

  // =======================================================================
  // E004 - KL Marathon - Rejected current version
  // =======================================================================
  mkEvent({
    eventId: EVENT_IDS.E004,
    organiserUid: USER_IDS.U_ORG_004,
    status: 'Rejected',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM', 'DBKL'],
    currentVersionId: 'v1',        // v1 is the last submitted + reviewed version
    currentVersionNumber: 1,
    currentAssessmentId: 'v1',
    currentResourceId: 'v1',
    draftDocumentPaths: [],
    eventDetails: mkEventDetails({
      name: 'Bukit Jalil International Marathon 2026',
      type: 'sports',
      venueId: VENUE_IDS.V002,
      organiserUid: USER_IDS.U_ORG_004,
      expectedAttendance: 25000,
      environment: 'outdoor',
      coverage: 'uncovered',
      seating: 'standing',
      startDatetime: daysAhead(50),
      endDatetime: daysAhead(50) + 7 * 60 * 60 * 1000,
      description: 'International marathon with 25,000 runners including elite, amateur, and corporate categories. Route covers 42km through KL city centre.',
    }),
    createdAt: daysAgo(21),
    submittedAt: daysAgo(18),
    updatedAt: daysAgo(1),
  }),

  // =======================================================================
  // E005 - Shah Alam Beach Carnival - Rejected (final)
  // =======================================================================
  mkEvent({
    eventId: EVENT_IDS.E005,
    organiserUid: USER_IDS.U_ORG_005,
    status: 'Rejected',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM'],
    currentVersionId: 'v1',
    currentVersionNumber: 1,
    currentAssessmentId: 'v1',
    currentResourceId: 'v1',
    eventDetails: mkEventDetails({
      name: 'Shah Alam Beach Carnival',
      type: 'festival',
      venueId: VENUE_IDS.V005,
      organiserUid: USER_IDS.U_ORG_005,
      expectedAttendance: 8000,
      environment: 'outdoor',
      coverage: 'uncovered',
      seating: 'mixed',
      startDatetime: daysAhead(90),
      endDatetime: daysAhead(90) + 6 * 60 * 60 * 1000,
      description: 'Beach-themed carnival with water activities, food stalls and live music.',
    }),
    createdAt: daysAgo(30),
    submittedAt: daysAgo(28),
    updatedAt: daysAgo(10),
  }),

  // =======================================================================
  // E006 - KL Tech Conference - Withdrawn
  // =======================================================================
  mkEvent({
    eventId: EVENT_IDS.E006,
    organiserUid: USER_IDS.U_ORG_001,
    status: 'Withdrawn',
    requiredAuthorities: ['DBKL', 'MOTAC'],
    currentVersionId: 'v1',
    currentVersionNumber: 1,
    currentAssessmentId: 'v1',
    currentResourceId: 'v1',
    eventDetails: mkEventDetails({
      name: 'KL Tech Summit 2026',
      type: 'conference',
      venueId: VENUE_IDS.V003,
      organiserUid: USER_IDS.U_ORG_001,
      expectedAttendance: 3000,
      environment: 'indoor',
      coverage: 'covered',
      seating: 'seated',
      startDatetime: daysAhead(20),
      endDatetime: daysAhead(20) + 8 * 60 * 60 * 1000,
      description: 'Annual regional technology conference with 3,000 attendees across 2 days. Withdrawn by organiser due to venue scheduling conflict.',
    }),
    createdAt: daysAgo(60),
    submittedAt: daysAgo(55),
    updatedAt: daysAgo(40),
  }),

  // =======================================================================
  // E007 - KL Cultural Night - Manual Review Required (AI unavailable)
  // =======================================================================
  mkEvent({
    eventId: EVENT_IDS.E007,
    organiserUid: USER_IDS.U_ORG_002,
    status: 'Pending',
    requiredAuthorities: ['PDRM', 'BOMBA', 'MOTAC'],
    currentVersionId: 'v1',
    currentVersionNumber: 1,
    currentAssessmentId: 'v1',
    currentResourceId: 'v1',
    eventDetails: mkEventDetails({
      name: 'Axiata Arena Cultural Night',
      type: 'cultural',
      venueId: VENUE_IDS.V004,
      organiserUid: USER_IDS.U_ORG_002,
      expectedAttendance: 2000,
      environment: 'indoor',
      coverage: 'covered',
      seating: 'seated',
      startDatetime: daysAhead(30),
      endDatetime: daysAhead(30) + 3 * 60 * 60 * 1000,
      description: 'Traditional cultural performances representing Malaysia\'s three major ethnic groups. Indoor arena setting.',
    }),
    createdAt: daysAgo(7),
    submittedAt: daysAgo(6),
    updatedAt: daysAgo(6),
  }),

  // =======================================================================
  // E008 - Shah Alam Adventure Race - UnderReview + Blocked Compliance
  // =======================================================================
  mkEvent({
    eventId: EVENT_IDS.E008,
    organiserUid: USER_IDS.U_ORG_003,
    status: 'UnderReview',
    requiredAuthorities: ['PDRM', 'BOMBA'],
    currentVersionId: 'v1',
    currentVersionNumber: 1,
    currentAssessmentId: 'v1',
    currentResourceId: 'v1',
    eventDetails: mkEventDetails({
      name: 'Shah Alam Adventure Race',
      type: 'sports',
      venueId: VENUE_IDS.V005,
      organiserUid: USER_IDS.U_ORG_003,
      expectedAttendance: 1200,
      environment: 'outdoor',
      coverage: 'uncovered',
      seating: 'standing',
      startDatetime: daysAhead(40),
      endDatetime: daysAhead(40) + 5 * 60 * 60 * 1000,
      description: 'Multi-discipline adventure race: trail running, kayaking, and cycling. 1,200 participants across 3 waves.',
    }),
    createdAt: daysAgo(10),
    submittedAt: daysAgo(8),
    updatedAt: daysAgo(2),
  }),

  // =======================================================================
  // E009 - PJ Community Fair - UnderReview + Insufficient Data
  // =======================================================================
  mkEvent({
    eventId: EVENT_IDS.E009,
    organiserUid: USER_IDS.U_ORG_004,
    status: 'UnderReview',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM'],
    currentVersionId: 'v1',
    currentVersionNumber: 1,
    currentAssessmentId: 'v1',
    currentResourceId: 'v1',
    eventDetails: mkEventDetails({
      name: 'PJ Community Engagement Fair',
      type: 'fair',
      venueId: VENUE_IDS.V006,
      organiserUid: USER_IDS.U_ORG_004,
      expectedAttendance: 1500,
      environment: 'outdoor',
      coverage: 'partially_covered',
      seating: 'standing',
      startDatetime: daysAhead(25),
      endDatetime: daysAhead(25) + 5 * 60 * 60 * 1000,
      description: 'Community engagement fair with local government services, health screenings, and family activities.',
    }),
    createdAt: daysAgo(5),
    submittedAt: daysAgo(4),
    updatedAt: hoursAgo(8),
  }),

  // =======================================================================
  // E010 - KL Night Market - Multi-version (v1 rejected, v2 under review)
  // =======================================================================
  mkEvent({
    eventId: EVENT_IDS.E010,
    organiserUid: USER_IDS.U_ORG_005,
    status: 'UnderReview',
    requiredAuthorities: ['PDRM', 'BOMBA', 'DBKL'],
    currentVersionId: 'v2',
    currentVersionNumber: 2,
    currentAssessmentId: 'v2',
    currentResourceId: 'v2',
    eventDetails: mkEventDetails({
      name: 'Dataran Merdeka Night Market',
      type: 'cultural',
      venueId: VENUE_IDS.V001,
      organiserUid: USER_IDS.U_ORG_005,
      expectedAttendance: 4000,
      environment: 'outdoor',
      coverage: 'uncovered',
      seating: 'standing',
      startDatetime: daysAhead(65),
      endDatetime: daysAhead(65) + 4 * 60 * 60 * 1000,
      description: 'Weekly night market with food, crafts and live entertainment. Re-submitted with revised crowd flow plan after v1 rejection.',
    }),
    createdAt: daysAgo(25),
    submittedAt: daysAgo(2),
    updatedAt: hoursAgo(18),
  }),

  // =======================================================================
  // E011 - KL Corporate Run - Approved + Resource Override
  // =======================================================================
  mkEvent({
    eventId: EVENT_IDS.E011,
    organiserUid: USER_IDS.U_ORG_001,
    status: 'Approved',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM'],
    currentVersionId: 'v1',
    currentVersionNumber: 1,
    currentAssessmentId: 'v1',
    currentResourceId: 'v1',
    eventDetails: mkEventDetails({
      name: 'Bukit Jalil Corporate Charity Run 2026',
      type: 'sports',
      venueId: VENUE_IDS.V002,
      organiserUid: USER_IDS.U_ORG_001,
      expectedAttendance: 5000,
      environment: 'outdoor',
      coverage: 'uncovered',
      seating: 'standing',
      startDatetime: daysAhead(35),
      endDatetime: daysAhead(35) + 4 * 60 * 60 * 1000,
      description: 'Corporate charity run with 5,000 participants. Police presence increased due to proximity to Parliament session.',
    }),
    createdAt: daysAgo(30),
    submittedAt: daysAgo(28),
    updatedAt: daysAgo(5),
  }),

  // =======================================================================
  // E012 - KL Concert - High Risk + Multi-authority (5 types)
  // =======================================================================
  mkEvent({
    eventId: EVENT_IDS.E012,
    organiserUid: USER_IDS.U_ORG_002,
    status: 'UnderReview',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'],
    currentVersionId: 'v1',
    currentVersionNumber: 1,
    currentAssessmentId: 'v1',
    currentResourceId: 'v1',
    eventDetails: mkEventDetails({
      name: 'Bukit Jalil World Tour Concert',
      type: 'concert',
      venueId: VENUE_IDS.V002,
      organiserUid: USER_IDS.U_ORG_002,
      expectedAttendance: 20000,
      environment: 'outdoor',
      coverage: 'uncovered',
      seating: 'seated',
      startDatetime: daysAhead(80),
      endDatetime: daysAhead(80) + 5 * 60 * 60 * 1000,
      description: 'International artist world tour. 20,000 attendees, pyrotechnics, temporary structures, alcohol served. High-risk profile.',
      riskProfile: {
        pyrotechnics: true,
        temporaryStructures: true,
        alcoholServed: true,
        internationalAttendees: true,
        vulnerableAttendeesPercent: 5,
        standingAttendeesPercent: 30,
        crowdManagementPlan: true,
        trafficManagementPlan: true,
        severeWeatherPlan: true,
        medicalPlan: true,
        evacuationPlanTested: true,
        authorityCoordinationConfirmed: true,
      },
    }),
    createdAt: daysAgo(14),
    submittedAt: daysAgo(12),
    updatedAt: daysAgo(3),
  }),

  // =======================================================================
  // E013 - KL Beach Cleanup - Approved + Stage 2 Reported (M4 ticket open)
  // =======================================================================
  mkEvent({
    eventId: EVENT_IDS.E013,
    organiserUid: USER_IDS.U_ORG_003,
    status: 'Approved',
    requiredAuthorities: ['PDRM', 'BOMBA'],
    currentVersionId: 'v1',
    currentVersionNumber: 1,
    currentAssessmentId: 'v1',
    currentResourceId: 'v1',
    eventDetails: mkEventDetails({
      name: 'KL Coastal Cleanup Day',
      type: 'cultural',
      venueId: VENUE_IDS.V001,
      organiserUid: USER_IDS.U_ORG_003,
      expectedAttendance: 600,
      environment: 'outdoor',
      coverage: 'uncovered',
      seating: 'standing',
      startDatetime: daysAgo(5),
      endDatetime: daysAgo(5) + 3 * 60 * 60 * 1000,
      description: 'Community coastal cleanup with educational booths and recycling stations.',
    }),
    createdAt: daysAgo(60),
    submittedAt: daysAgo(55),
    updatedAt: daysAgo(1),
  }),

  // =======================================================================
  // E014 - Shah Alam Music Fest - Approved + M4 confirmed_true (resubmit_required)
  // =======================================================================
  mkEvent({
    eventId: EVENT_IDS.E014,
    organiserUid: USER_IDS.U_ORG_004,
    status: 'Approved',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM'],
    currentVersionId: 'v1',
    currentVersionNumber: 1,
    currentAssessmentId: 'v1',
    currentResourceId: 'v1',
    eventDetails: mkEventDetails({
      name: 'Shah Alam Music Fest 2026',
      type: 'festival',
      venueId: VENUE_IDS.V005,
      organiserUid: USER_IDS.U_ORG_004,
      expectedAttendance: 10000,
      environment: 'outdoor',
      coverage: 'uncovered',
      seating: 'standing',
      startDatetime: daysAgo(15),
      endDatetime: daysAgo(15) + 6 * 60 * 60 * 1000,
      description: 'Two-day music festival. Medical station image was reported as inaccurate; the incident investigation confirmed the report; resubmission required.',
    }),
    createdAt: daysAgo(90),
    submittedAt: daysAgo(85),
    updatedAt: daysAgo(5),
  }),

  // =======================================================================
  // E015 - KL Charity Run - Approved + M4 dismissed (back to approved)
  // =======================================================================
  mkEvent({
    eventId: EVENT_IDS.E015,
    organiserUid: USER_IDS.U_ORG_005,
    status: 'Approved',
    requiredAuthorities: ['PDRM', 'BOMBA'],
    currentVersionId: 'v1',
    currentVersionNumber: 1,
    currentAssessmentId: 'v1',
    currentResourceId: 'v1',
    eventDetails: mkEventDetails({
      name: 'Bukit Jalil Charity Run',
      type: 'sports',
      venueId: VENUE_IDS.V002,
      organiserUid: USER_IDS.U_ORG_005,
      expectedAttendance: 3000,
      environment: 'outdoor',
      coverage: 'uncovered',
      seating: 'standing',
      startDatetime: daysAgo(20),
      endDatetime: daysAgo(20) + 4 * 60 * 60 * 1000,
      description: 'Charity run for local hospital fund. Stage 2 medical station image was reported but the incident investigation dismissed the report.',
    }),
    createdAt: daysAgo(90),
    submittedAt: daysAgo(85),
    updatedAt: daysAgo(5),
  }),

  // =======================================================================
  // E016 - Axiata Music Fest - UnderReview + Legacy Assessment (recompute needed)
  // =======================================================================
  mkEvent({
    eventId: EVENT_IDS.E016,
    organiserUid: USER_IDS.U_ORG_001,
    status: 'UnderReview',
    requiredAuthorities: ['PDRM', 'BOMBA', 'MOTAC'],
    currentVersionId: 'v1',
    currentVersionNumber: 1,
    currentAssessmentId: 'v1',  // points to a doc with v1 shape
    currentResourceId: 'v1',
    eventDetails: mkEventDetails({
      name: 'Axiata Arena Music Fest',
      type: 'festival',
      venueId: VENUE_IDS.V004,
      organiserUid: USER_IDS.U_ORG_001,
      expectedAttendance: 4000,
      environment: 'indoor',
      coverage: 'covered',
      seating: 'seated',
      startDatetime: daysAhead(55),
      endDatetime: daysAhead(55) + 4 * 60 * 60 * 1000,
      description: 'Multi-genre indoor music festival. Assessment is in legacy v1 shape — recompute required before review.',
    }),
    createdAt: daysAgo(14),
    submittedAt: daysAgo(12),
    updatedAt: daysAgo(3),
  }),

  // =======================================================================
  // E017 - PJ Wedding Expo - Draft (organiser has not yet submitted)
  // =======================================================================
  mkEvent({
    eventId: EVENT_IDS.E017,
    organiserUid: USER_IDS.U_ORG_002,
    status: 'Draft',
    requiredAuthorities: [],
    currentVersionNumber: 0,
    editableVersionId: 'v1',  // organiser is creating v1
    eventDetails: mkEventDetails({
      name: 'PJ Wedding Expo 2026',
      type: 'exhibition',
      venueId: VENUE_IDS.V006,
      organiserUid: USER_IDS.U_ORG_002,
      expectedAttendance: 2000,
      environment: 'indoor',
      coverage: 'covered',
      seating: 'mixed',
      // Provisional - not yet committed
      startDatetime: daysAhead(120),
      endDatetime: daysAhead(120) + 6 * 60 * 60 * 1000,
      description: 'Wedding expo with 50 vendor booths, fashion shows, and food sampling.',
    }),
    createdAt: daysAgo(2),
    updatedAt: hoursAgo(3),
  }),
];

// ============================================================================
// Lookups
// ============================================================================
export const findEventById = (eventId: string): EventRecord | undefined =>
  mockEvents.find((e) => e.eventId === eventId);

export const mockEventsById: Record<string, EventRecord> = Object.fromEntries(
  mockEvents.map((e) => [e.eventId, e]),
);

/** Events where the given authorityType is in requiredAuthorities and the event is in an active review state. */
export const findActiveEventsForAuthority = (authorityType: AuthorityType): EventRecord[] =>
  mockEvents.filter(
    (e) => e.requiredAuthorities.includes(authorityType)
      && ['Pending', 'UnderReview'].includes(e.status),
  );

/** Events that have been fully approved and published. */
export const findApprovedEvents = (): EventRecord[] =>
  mockEvents.filter((e) => e.status === 'Approved');
