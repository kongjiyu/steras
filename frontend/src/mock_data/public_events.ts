import { PublicEvent } from '@shared/types';
import { EVENT_IDS, daysAgo, daysAhead } from './ids';
import { mockEventsById } from './events';

// Sanitized projection: only includes approved-and-published events.
// Fields are a strict subset of EventRecord (no organiser PII, no private
// evidence, no risk details, no incidents, no decisions).

export const mockPublicEvents: PublicEvent[] = [
  {
    eventId: EVENT_IDS.E001,
    versionId: 'v1',
    eventName: 'Dataran Merdeka Music Festival 2026',
    venueName: 'Dataran Merdeka',
    eventType: 'festival',
    startDatetime: daysAhead(75),
    endDatetime: daysAhead(75) + 8 * 60 * 60 * 1000,
    approvedBy: ['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'],
    publicStatus: 'approved',
  },
  {
    eventId: EVENT_IDS.E011,
    versionId: 'v1',
    eventName: 'Bukit Jalil Corporate Charity Run 2026',
    venueName: 'Bukit Jalil National Stadium',
    eventType: 'sports',
    startDatetime: daysAhead(35),
    endDatetime: daysAhead(35) + 4 * 60 * 60 * 1000,
    approvedBy: ['PDRM', 'BOMBA', 'KKM'],
    publicStatus: 'approved',
  },
  {
    eventId: EVENT_IDS.E013,
    versionId: 'v1',
    eventName: 'KL Coastal Cleanup Day',
    venueName: 'Dataran Merdeka',
    eventType: 'cultural',
    startDatetime: daysAgo(5),
    endDatetime: daysAgo(5) + 3 * 60 * 60 * 1000,
    approvedBy: ['PDRM', 'BOMBA'],
    publicStatus: 'approved',
  },
  {
    eventId: EVENT_IDS.E014,
    versionId: 'v1',
    eventName: 'Shah Alam Music Fest 2026',
    venueName: 'Shah Alam Stadium',
    eventType: 'festival',
    startDatetime: daysAgo(15),
    endDatetime: daysAgo(15) + 6 * 60 * 60 * 1000,
    approvedBy: ['PDRM', 'BOMBA', 'KKM'],
    publicStatus: 'approved',
  },
  {
    eventId: EVENT_IDS.E015,
    versionId: 'v1',
    eventName: 'Bukit Jalil Charity Run',
    venueName: 'Bukit Jalil National Stadium',
    eventType: 'sports',
    startDatetime: daysAgo(20),
    endDatetime: daysAgo(20) + 4 * 60 * 60 * 1000,
    approvedBy: ['PDRM', 'BOMBA'],
    publicStatus: 'approved',
  },
];

// Cross-reference check: only Approved events should appear here.
mockPublicEvents.forEach((pe) => {
  const event = mockEventsById[pe.eventId];
  if (event && event.status !== 'Approved') {
    throw new Error(`mockPublicEvents: ${pe.eventId} is in public projection but status=${event.status}`);
  }
});

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
export const findPublicEventById = (eventId: string): PublicEvent | undefined =>
  mockPublicEvents.find((e) => e.eventId === eventId);
