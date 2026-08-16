/**
 * M4-owned public_reports collection (PLANNED per FR-M3-30/31/32).
 *
 * This is the M3 ↔ M4 contract:
 *   M4 writes a `public_reports/{ticketId}` document when a public
 *   viewer reports a Stage 2 image.
 *   M3 has a Firestore trigger on this collection that applies the
 *   state transition (FR-M3-31 confirmed_true or FR-M3-32 dismissed).
 *
 * Document ID is the M4 ticket id.
 */

import { EVENT_IDS, REPORT_IDS, USER_IDS, daysAgo } from './ids';

export type PublicReportOutcome = 'under_investigation' | 'dismissed' | 'confirmed_true' | 'confirmed_critical';

export interface PublicReport {
  ticketId: string;
  eventId: string;
  controlId: string;
  reportedBy: string;
  reportedAt: number;
  category: 'image_inaccurate' | 'image_outdated' | 'image_misleading' | 'other';
  description: string;
  outcome: PublicReportOutcome;
  resolvedAt?: number;
  resolutionNotes?: string;
  m3NotifiedAt?: number;
  // Audit
  investigatedBy?: string;
}

export const mockPublicReports: PublicReport[] = [
  // R001 - E013 medical station, under investigation
  {
    ticketId: REPORT_IDS.R001,
    eventId: EVENT_IDS.E013,
    controlId: 'ctrl-e013-03-medical-station',
    reportedBy: USER_IDS.U_PUB_002,
    reportedAt: daysAgo(1),
    category: 'image_inaccurate',
    description: 'The image shown does not match the actual medical station at the venue. The image appears to be from a different event.',
    outcome: 'under_investigation',
  },

  // R002 - E014 medical station, confirmed_true
  {
    ticketId: REPORT_IDS.R002,
    eventId: EVENT_IDS.E014,
    controlId: 'ctrl-e014-03-medical-station',
    reportedBy: USER_IDS.U_PUB_001,
    reportedAt: daysAgo(8),
    category: 'image_misleading',
    description: 'The medical team shown in the image is not the actual team on-site. Credentials do not match the names listed in the verified Stage 1 documentation.',
    outcome: 'confirmed_true',
    resolvedAt: daysAgo(5),
    resolutionNotes: 'Investigation confirmed discrepancy between published image and on-site medical team. Organiser must re-upload Stage 2 with current team.',
    investigatedBy: 'm4-investigator-001',
    m3NotifiedAt: daysAgo(5),
  },

  // R003 - E015 medical station, dismissed as fake
  {
    ticketId: REPORT_IDS.R003,
    eventId: EVENT_IDS.E015,
    controlId: 'ctrl-e015-03-medical-station',
    reportedBy: USER_IDS.U_PUB_003,
    reportedAt: daysAgo(10),
    category: 'image_inaccurate',
    description: 'Image looks like a stock photo, not the actual on-site team.',
    outcome: 'dismissed',
    resolvedAt: daysAgo(5),
    resolutionNotes: 'Investigation confirmed the reported image is genuine. Reporter appears to be a competitor organisation. Original approved state restored.',
    investigatedBy: 'm4-investigator-001',
    m3NotifiedAt: daysAgo(5),
  },
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
export const findPublicReportById = (ticketId: string): PublicReport | undefined =>
  mockPublicReports.find((r) => r.ticketId === ticketId);

export const findPublicReports = (): PublicReport[] => mockPublicReports;

export const findPublicReportsForControl = (controlId: string): PublicReport[] =>
  mockPublicReports.filter((r) => r.controlId === controlId);

export const findOpenPublicReports = (): PublicReport[] =>
  mockPublicReports.filter((r) => r.outcome === 'under_investigation');
