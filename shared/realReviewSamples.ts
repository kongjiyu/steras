import type { AuthorityType, EventType } from './types';

/**
 * Publicly grounded Module 3 review samples.  These are fixture definitions,
 * not permit applications: private contacts, evidence, assessments, and
 * workflow decisions are deliberately synthetic in the seeder.
 */
export const REAL_REVIEW_SAMPLE_DATASET_ID = 'steras-module3-real-review-samples-v1' as const;
export const REAL_REVIEW_SAMPLE_AS_OF = '2026-09-15' as const;

export const REAL_REVIEW_SAMPLE_EVENT_IDS = [
  'steras-sample-klscm-2026',
  'steras-sample-malaysian-motogp-2026',
  'steras-sample-ironman-malaysia-2026',
] as const;

export type RealReviewSampleId = (typeof REAL_REVIEW_SAMPLE_EVENT_IDS)[number];
export type RealReviewSampleWorkflow = 'initial_review' | 'manual_review_required' | 'final_review';

export interface RealReviewSampleDefinition {
  id: RealReviewSampleId;
  workflow: RealReviewSampleWorkflow;
  name: string;
  type: EventType;
  venueName: string;
  venueAddress: string;
  venueLocation: { lat: number; lng: number };
  venueCapacity: number;
  expectedAttendance: number;
  startIso: string;
  endIso: string;
  organizerName: string;
  requiredAuthorities: AuthorityType[];
  sourceUrls: string[];
  publicFacts: string;
  syntheticCapacityNote: string;
}

export const REAL_REVIEW_SAMPLES: Readonly<Record<RealReviewSampleId, RealReviewSampleDefinition>> = {
  'steras-sample-klscm-2026': {
    id: 'steras-sample-klscm-2026',
    workflow: 'initial_review',
    name: 'Kuala Lumpur Standard Chartered Marathon 2026',
    type: 'sports',
    venueName: 'Dataran Merdeka and the Kuala Lumpur city route',
    venueAddress: 'Dataran Merdeka, Jalan Raja, 50050 Kuala Lumpur, Malaysia',
    venueLocation: { lat: 3.1478, lng: 101.6932 },
    venueCapacity: 50_000,
    expectedAttendance: 43_000,
    startIso: '2026-10-03T05:00:00+08:00',
    endIso: '2026-10-04T14:00:00+08:00',
    organizerName: 'Dirigo Events Sdn Bhd',
    // The prepared review fixtures intentionally exercise the complete
    // five-department authority workflow.  This is fixture metadata only;
    // normal submissions still derive requirements from event details.
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'],
    sourceUrls: ['https://www.kl-marathon.com/volunteers/general-volunteers/general-information/'],
    publicFacts: 'The official volunteer information describes the 2026 edition as accommodating about 43,000 runners across the Kuala Lumpur city route.',
    syntheticCapacityNote: 'The simultaneous venue-capacity figure is a conservative STERAS validation estimate, not an organiser-published limit.',
  },
  'steras-sample-malaysian-motogp-2026': {
    id: 'steras-sample-malaysian-motogp-2026',
    workflow: 'manual_review_required',
    name: 'PETRONAS Grand Prix of Malaysia 2026',
    type: 'sports',
    venueName: 'PETRONAS Sepang International Circuit',
    venueAddress: 'Jalan Pekeliling, 64000 Sepang, Selangor, Malaysia',
    venueLocation: { lat: 2.7606, lng: 101.7388 },
    venueCapacity: 200_000,
    expectedAttendance: 190_977,
    startIso: '2026-10-30T08:00:00+08:00',
    endIso: '2026-11-01T23:00:00+08:00',
    organizerName: 'Sepang International Circuit',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'],
    sourceUrls: ['https://www.sepangcircuit.com/events/petronas-grand-prix-of-malaysia-2026-overview'],
    publicFacts: 'The official Sepang event page lists 30 October–1 November 2026 at PETRONAS Sepang International Circuit and reports 190,977 visitors for the previous edition.',
    syntheticCapacityNote: 'Attendance uses the prior-edition public visitor total; the simultaneous capacity estimate is synthetic for validation.',
  },
  'steras-sample-ironman-malaysia-2026': {
    id: 'steras-sample-ironman-malaysia-2026',
    workflow: 'final_review',
    name: '2026 IRONMAN Malaysia',
    type: 'sports',
    venueName: 'Langkawi — MIEC transition areas and Pelangi Beach Resort finish',
    venueAddress: 'Langkawi, Kedah, Malaysia',
    venueLocation: { lat: 6.35, lng: 99.8 },
    venueCapacity: 5_000,
    expectedAttendance: 2_000,
    startIso: '2026-11-21T05:00:00+08:00',
    endIso: '2026-11-22T02:00:00+08:00',
    organizerName: 'IRONMAN Malaysia',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'],
    sourceUrls: ['https://www.ironman.com/sites/default/files/2026-01/2026%20IMMY_IM70.3LGK_Event%20Schedule.pdf'],
    publicFacts: 'The official 2026 event schedule places IRONMAN Malaysia on 21 November 2026 in Langkawi, with transition activity at MIEC and the finish at Pelangi Beach Resort.',
    syntheticCapacityNote: 'Participant and simultaneous-capacity values are conservative STERAS fixture estimates because the schedule does not publish a permit capacity.',
  },
};
