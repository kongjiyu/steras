import { EventVersion } from '@shared/types';
import { EVENT_IDS, USER_IDS, daysAgo, hoursAgo } from './ids';
import { mockEventsById } from './events';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Deterministic mock hash. Real value is computed in onEventCreated via
 *  `createHash('sha256')` — this browser-safe stand-in preserves uniqueness
 *  per (event, version) for testing equality. */
const hashInput = (input: { eventId: string; versionId: string }): string => {
  const hex = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h).toString(16).padStart(8, '0');
  };
  return `mock-${hex(input.eventId)}-${hex(input.versionId)}-${hex(`${input.eventId}${input.versionId}`)}`;
};

// Synthetic document paths (organiser uploads). Real paths would be Firebase
// Storage URLs like `events/{eventId}/versions/{versionId}/docs/{filename}`.
const docPaths = (eventId: string, versionId: string, files: string[]): string[] =>
  files.map((f) => `events/${eventId}/versions/${versionId}/docs/${encodeURIComponent(f)}`);

const baseDocs = ['event-application.pdf', 'venue-floor-plan.pdf', 'emergency-response-plan.pdf'];

const mkVersion = (overrides: {
  eventId: string;
  versionId: string;
  versionNumber: number;
  submittedBy: string;
  submittedAt: number;
  files?: string[];
  supersededAt?: number;
}): EventVersion => {
  const event = mockEventsById[overrides.eventId];
  if (!event) throw new Error(`mkVersion: unknown event ${overrides.eventId}`);
  const eventDetails = event.eventDetails;
  const files = overrides.files ?? baseDocs;
  return {
    versionId: overrides.versionId,
    eventId: overrides.eventId,
    versionNumber: overrides.versionNumber,
    eventDetails,
    documentPaths: docPaths(overrides.eventId, overrides.versionId, files),
    submittedBy: overrides.submittedBy,
    submittedAt: overrides.submittedAt,
    inputHash: hashInput({ eventId: overrides.eventId, versionId: overrides.versionId }),
    supersededAt: overrides.supersededAt,
  };
};

// ---------------------------------------------------------------------------
// Versions for each event
// ---------------------------------------------------------------------------
export const mockVersions: EventVersion[] = [
  // v1-only events (E001, E002, E003, E005, E006, E007, E008, E009, E011, E012, E013, E014, E015, E016, E017)
  ...[
    [EVENT_IDS.E001, 'v1', 1, USER_IDS.U_ORG_001, daysAgo(28)],
    [EVENT_IDS.E002, 'v1', 1, USER_IDS.U_ORG_002, daysAgo(12)],
    [EVENT_IDS.E003, 'v1', 1, USER_IDS.U_ORG_003, hoursAgo(6)],
    [EVENT_IDS.E005, 'v1', 1, USER_IDS.U_ORG_005, daysAgo(28)],
    [EVENT_IDS.E006, 'v1', 1, USER_IDS.U_ORG_001, daysAgo(55)],
    [EVENT_IDS.E007, 'v1', 1, USER_IDS.U_ORG_002, daysAgo(6)],
    [EVENT_IDS.E008, 'v1', 1, USER_IDS.U_ORG_003, daysAgo(8)],
    [EVENT_IDS.E009, 'v1', 1, USER_IDS.U_ORG_004, daysAgo(4)],
    [EVENT_IDS.E011, 'v1', 1, USER_IDS.U_ORG_001, daysAgo(28)],
    [EVENT_IDS.E012, 'v1', 1, USER_IDS.U_ORG_002, daysAgo(12)],
    [EVENT_IDS.E013, 'v1', 1, USER_IDS.U_ORG_003, daysAgo(55)],
    [EVENT_IDS.E014, 'v1', 1, USER_IDS.U_ORG_004, daysAgo(85)],
    [EVENT_IDS.E015, 'v1', 1, USER_IDS.U_ORG_005, daysAgo(85)],
    [EVENT_IDS.E016, 'v1', 1, USER_IDS.U_ORG_001, daysAgo(12)],
    [EVENT_IDS.E017, 'v1', 1, USER_IDS.U_ORG_002, hoursAgo(3)],  // draft, not yet submitted
  ].map(([eventId, versionId, versionNumber, submittedBy, submittedAt]) =>
    mkVersion({
      eventId: eventId as string,
      versionId: versionId as string,
      versionNumber: versionNumber as number,
      submittedBy: submittedBy as string,
      submittedAt: submittedAt as number,
    })
  ),

  // ----- E004 multi-version: v1 (rejected), v2 (in draft) -----
  mkVersion({
    eventId: EVENT_IDS.E004,
    versionId: 'v1',
    versionNumber: 1,
    submittedBy: USER_IDS.U_ORG_004,
    submittedAt: daysAgo(18),
    supersededAt: daysAgo(2),
  }),

  // ----- E010 multi-version: v1 (rejected), v2 (current, under review) -----
  mkVersion({
    eventId: EVENT_IDS.E010,
    versionId: 'v1',
    versionNumber: 1,
    submittedBy: USER_IDS.U_ORG_005,
    submittedAt: daysAgo(22),
    supersededAt: daysAgo(2),
    files: [...baseDocs, 'v1-crowd-flow-plan.pdf'],
  }),
  mkVersion({
    eventId: EVENT_IDS.E010,
    versionId: 'v2',
    versionNumber: 2,
    submittedBy: USER_IDS.U_ORG_005,
    submittedAt: daysAgo(2),
    files: [...baseDocs, 'v2-crowd-flow-plan-revised.pdf', 'v2-additional-medical-staffing.pdf'],
  }),
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
export const findVersionById = (eventId: string, versionId: string): EventVersion | undefined =>
  mockVersions.find((v) => v.eventId === eventId && v.versionId === versionId);

export const findVersionsForEvent = (eventId: string): EventVersion[] =>
  mockVersions
    .filter((v) => v.eventId === eventId)
    .sort((a, b) => b.versionNumber - a.versionNumber);
