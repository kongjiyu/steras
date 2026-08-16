import { ResourceQuantities, ResourceRecommendation, AuthorityType } from '@shared/types';
import { EVENT_IDS, USER_IDS, daysAgo, hoursAgo } from './ids';
import { mockEventsById } from './events';
import { findAssessmentByEventVersion } from './assessments';

/**
 * MOCK-only: the `resource_overrides/{overrideId}` document shape. Inline
 * in overrideResources.ts; not yet promoted to shared/types.ts. When the
 * type lands, drop this and use the canonical import.
 */
export interface MockResourceOverride {
  overrideId: string;
  eventId: string;
  versionId: string;
  authorityType: AuthorityType;
  reviewerId: string;
  rationale: string;
  previous: ResourceQuantities;
  updated: ResourceQuantities;
  overriddenAt: number;
}

const RESOURCE_FORMULA_VERSION = '2026-07-24-prototype-range-v3';
const RESOURCE_GUIDELINE_VERSION = '2026-07-24-malaysia-research-v2';

const mkQuantities = (overrides: Partial<ResourceQuantities>): ResourceQuantities => ({
  police: 0,
  medicalTeams: 0,
  ambulances: 0,
  toilets: 0,
  wasteBins: 0,
  security: 0,
  fireOfficers: 0,
  ...overrides,
});

interface ResourceOverrides {
  eventId: string;
  versionId: string;
  quantities: ResourceQuantities;
  // Whether the officer overrode any of these values
  overridden?: boolean;
  overriddenBy?: string;
  overrideRationale?: string;
  overriddenAt?: number;
  computedAt: number;
}

const mkRecommendation = (o: ResourceOverrides): ResourceRecommendation => {
  const event = mockEventsById[o.eventId];
  if (!event) throw new Error(`mkRecommendation: unknown event ${o.eventId}`);
  const assessment = findAssessmentByEventVersion(o.eventId, o.versionId);
  if (!assessment) throw new Error(`mkRecommendation: missing assessment for ${o.eventId}/${o.versionId}`);

  const q = o.quantities;
  const rationaleFor = (resource: keyof ResourceQuantities, baseline: number, factors: string[], refs: string[]) => ({
    resource,
    baselineQuantity: baseline,
    factors,
    guidelineReferences: refs,
  });

  return {
    resourceId: o.versionId,
    eventId: o.eventId,
    versionId: o.versionId,
    assessmentId: o.versionId,
    ...q,
    formulaVersion: RESOURCE_FORMULA_VERSION,
    guidelineVersion: RESOURCE_GUIDELINE_VERSION,
    guidelineStatus: 'prototype',
    confidenceLevel: o.overridden ? 'authorityValidated' : 'prototype',
    rationales: {
      police: rationaleFor('police', q.police,
        [`Baseline scaled to ${event.eventDetails.expectedAttendance} attendees.`, assessment.officialRiskLevel === 'High' ? 'High-risk event: +50% on baseline.' : ''].filter(Boolean),
        ['PDRM Mass Event Safety Guidelines 2020 §4', 'WHO Mass Gathering Planning 2015']),
      security: rationaleFor('security', q.security,
        ['Baseline 1:200 attendees for outdoor venues.'],
        ['PDRM Private Security Cooperation SOP 2019']),
      medicalTeams: rationaleFor('medicalTeams', q.medicalTeams,
        ['Baseline per KKM Mass Gathering Medical Guidelines (1 team per 5,000 attendees).'],
        ['KKM Mass Gathering Medical Guidelines 2018 §3']),
      ambulances: rationaleFor('ambulances', q.ambulances,
        ['Baseline per KKM (1 ambulance per 10,000 attendees, minimum 1).'],
        ['KKM Mass Gathering Medical Guidelines 2018 §4']),
      toilets: rationaleFor('toilets', q.toilets,
        ['Baseline per WHO (1 per 250 attendees for events >4 hours).'],
        ['WHO Sanitation Guidelines for Mass Gatherings']),
      wasteBins: rationaleFor('wasteBins', q.wasteBins,
        ['Baseline 1 per 100 attendees, scaled by event duration.'],
        ['SWCorp Event Waste Management SOP 2021']),
      fireOfficers: rationaleFor('fireOfficers', q.fireOfficers,
        ['Baseline 1 per 2,000 attendees, minimum 2.'],
        ['BOMBA Fire Safety Act 1988 §11']),
    },
    items: [
      { resource: 'police', baseline: q.police, planningRange: { min: Math.max(0, q.police - 4), max: q.police + 8 }, assumptions: [`Attendance: ${event.eventDetails.expectedAttendance}`], riskModifiers: assessment.officialRiskLevel === 'High' ? ['High-risk +50%'] : [], confidence: 'prototype', guidelineReferences: ['PDRM §4'], reviewingAuthority: 'PDRM', authorityReviewRequired: true },
      { resource: 'security', baseline: q.security, planningRange: { min: Math.max(0, q.security - 4), max: q.security + 8 }, assumptions: [], riskModifiers: [], confidence: 'prototype', guidelineReferences: ['PDRM Private Security SOP'], reviewingAuthority: 'PDRM', authorityReviewRequired: true },
      { resource: 'medicalTeams', baseline: q.medicalTeams, planningRange: { min: Math.max(0, q.medicalTeams - 1), max: q.medicalTeams + 2 }, assumptions: [], riskModifiers: [], confidence: 'prototype', guidelineReferences: ['KKM §3'], reviewingAuthority: 'KKM', authorityReviewRequired: true },
      { resource: 'ambulances', baseline: q.ambulances, planningRange: { min: Math.max(0, q.ambulances - 1), max: q.ambulances + 1 }, assumptions: [], riskModifiers: [], confidence: 'prototype', guidelineReferences: ['KKM §4'], reviewingAuthority: 'KKM', authorityReviewRequired: true },
      { resource: 'toilets', baseline: q.toilets, planningRange: { min: Math.max(0, q.toilets - 4), max: q.toilets + 8 }, assumptions: [], riskModifiers: [], confidence: 'prototype', guidelineReferences: ['WHO Sanitation'], reviewingAuthority: 'DBKL', authorityReviewRequired: true },
      { resource: 'wasteBins', baseline: q.wasteBins, planningRange: { min: Math.max(0, q.wasteBins - 10), max: q.wasteBins + 20 }, assumptions: [], riskModifiers: [], confidence: 'prototype', guidelineReferences: ['SWCorp SOP'], reviewingAuthority: 'DBKL', authorityReviewRequired: true },
      { resource: 'fireOfficers', baseline: q.fireOfficers, planningRange: { min: Math.max(0, q.fireOfficers - 1), max: q.fireOfficers + 2 }, assumptions: [], riskModifiers: [], confidence: 'prototype', guidelineReferences: ['BOMBA §11'], reviewingAuthority: 'BOMBA', authorityReviewRequired: true },
    ],
    aiConsiderations: assessment.aiAdvisory.resourceConsiderations,
    notes: o.overridden
      ? `Authority override: ${o.overrideRationale}`
      : 'Prototype category mappings and resource guidance pending team and authority validation.',
    overriddenBy: o.overridden ? o.overriddenBy : undefined,
    overrideRationale: o.overridden ? o.overrideRationale : undefined,
    overriddenAt: o.overridden ? o.overriddenAt : undefined,
    computedAt: o.computedAt,
  };
};

// ---------------------------------------------------------------------------
// Resource recommendations for each event
// ---------------------------------------------------------------------------
export const mockResourceRecommendations: ResourceRecommendation[] = [
  // E001 - 15K attendance
  mkRecommendation({
    eventId: EVENT_IDS.E001, versionId: 'v1',
    quantities: mkQuantities({ police: 30, security: 45, medicalTeams: 3, ambulances: 2, toilets: 60, wasteBins: 150, fireOfficers: 8 }),
    computedAt: daysAgo(28),
  }),

  // E002 - 5K, provisional readiness
  mkRecommendation({
    eventId: EVENT_IDS.E002, versionId: 'v1',
    quantities: mkQuantities({ police: 12, security: 18, medicalTeams: 1, ambulances: 1, toilets: 22, wasteBins: 55, fireOfficers: 3 }),
    computedAt: daysAgo(12),
  }),

  // E003 - 800 attendees (small)
  mkRecommendation({
    eventId: EVENT_IDS.E003, versionId: 'v1',
    quantities: mkQuantities({ police: 4, security: 6, medicalTeams: 1, ambulances: 1, toilets: 4, wasteBins: 12, fireOfficers: 2 }),
    computedAt: hoursAgo(5),
  }),

  // E004 v1 - 25K (rejected)
  mkRecommendation({
    eventId: EVENT_IDS.E004, versionId: 'v1',
    quantities: mkQuantities({ police: 50, security: 75, medicalTeams: 5, ambulances: 3, toilets: 100, wasteBins: 250, fireOfficers: 12 }),
    computedAt: daysAgo(18),
  }),

  // E005 - 8K (rejected)
  mkRecommendation({
    eventId: EVENT_IDS.E005, versionId: 'v1',
    quantities: mkQuantities({ police: 18, security: 26, medicalTeams: 2, ambulances: 1, toilets: 32, wasteBins: 80, fireOfficers: 4 }),
    computedAt: daysAgo(28),
  }),

  // E006 - 3K (withdrawn)
  mkRecommendation({
    eventId: EVENT_IDS.E006, versionId: 'v1',
    quantities: mkQuantities({ police: 8, security: 12, medicalTeams: 1, ambulances: 1, toilets: 14, wasteBins: 35, fireOfficers: 2 }),
    computedAt: daysAgo(55),
  }),

  // E007 - 2K (manual review)
  mkRecommendation({
    eventId: EVENT_IDS.E007, versionId: 'v1',
    quantities: mkQuantities({ police: 6, security: 9, medicalTeams: 1, ambulances: 1, toilets: 10, wasteBins: 25, fireOfficers: 2 }),
    computedAt: daysAgo(6),
  }),

  // E008 - 1.2K, blocked compliance
  mkRecommendation({
    eventId: EVENT_IDS.E008, versionId: 'v1',
    quantities: mkQuantities({ police: 5, security: 8, medicalTeams: 1, ambulances: 1, toilets: 7, wasteBins: 18, fireOfficers: 2 }),
    computedAt: daysAgo(8),
  }),

  // E009 - 1.5K, insufficient data
  mkRecommendation({
    eventId: EVENT_IDS.E009, versionId: 'v1',
    quantities: mkQuantities({ police: 5, security: 8, medicalTeams: 1, ambulances: 1, toilets: 8, wasteBins: 20, fireOfficers: 2 }),
    computedAt: daysAgo(4),
  }),

  // E010 v1 (rejected) + v2 (under review)
  mkRecommendation({
    eventId: EVENT_IDS.E010, versionId: 'v1',
    quantities: mkQuantities({ police: 12, security: 18, medicalTeams: 1, ambulances: 1, toilets: 16, wasteBins: 40, fireOfficers: 3 }),
    computedAt: daysAgo(22),
  }),
  mkRecommendation({
    eventId: EVENT_IDS.E010, versionId: 'v2',
    quantities: mkQuantities({ police: 10, security: 16, medicalTeams: 1, ambulances: 1, toilets: 16, wasteBins: 40, fireOfficers: 3 }),
    computedAt: daysAgo(2),
  }),

  // E011 - 5K, with override (police increased for parliament session)
  mkRecommendation({
    eventId: EVENT_IDS.E011, versionId: 'v1',
    quantities: mkQuantities({ police: 18, security: 22, medicalTeams: 1, ambulances: 1, toilets: 22, wasteBins: 55, fireOfficers: 3 }),
    overridden: true,
    overriddenBy: USER_IDS.U_OFC_PDRM_FED_01,
    overrideRationale: 'Increasing police presence from baseline 12 to 18 due to concurrent Parliament session one week before event. Additional officers needed for road closures and dignitary routing.',
    overriddenAt: daysAgo(10),
    computedAt: daysAgo(28),
  }),

  // E012 - 20K, high risk
  mkRecommendation({
    eventId: EVENT_IDS.E012, versionId: 'v1',
    quantities: mkQuantities({ police: 60, security: 80, medicalTeams: 6, ambulances: 4, toilets: 80, wasteBins: 200, fireOfficers: 14 }),
    computedAt: daysAgo(12),
  }),

  // E013 - 600, approved
  mkRecommendation({
    eventId: EVENT_IDS.E013, versionId: 'v1',
    quantities: mkQuantities({ police: 3, security: 5, medicalTeams: 1, ambulances: 1, toilets: 4, wasteBins: 10, fireOfficers: 2 }),
    computedAt: daysAgo(55),
  }),

  // E014 - 10K, approved, M4 confirmed true (state will move to resubmit_required)
  mkRecommendation({
    eventId: EVENT_IDS.E014, versionId: 'v1',
    quantities: mkQuantities({ police: 22, security: 32, medicalTeams: 2, ambulances: 2, toilets: 40, wasteBins: 100, fireOfficers: 6 }),
    computedAt: daysAgo(85),
  }),

  // E015 - 3K, approved, M4 dismissed (back to approved)
  mkRecommendation({
    eventId: EVENT_IDS.E015, versionId: 'v1',
    quantities: mkQuantities({ police: 8, security: 12, medicalTeams: 1, ambulances: 1, toilets: 14, wasteBins: 35, fireOfficers: 2 }),
    computedAt: daysAgo(85),
  }),

  // E016 - 4K, legacy assessment
  mkRecommendation({
    eventId: EVENT_IDS.E016, versionId: 'v1',
    quantities: mkQuantities({ police: 10, security: 16, medicalTeams: 1, ambulances: 1, toilets: 16, wasteBins: 40, fireOfficers: 3 }),
    computedAt: daysAgo(12),
  }),

  // E017 - draft, no assessment yet
  // (no resource recommendation)
];

// ---------------------------------------------------------------------------
// Resource override history (append-only)
// ---------------------------------------------------------------------------
export const mockResourceOverrides: MockResourceOverride[] = [
  {
    overrideId: `${EVENT_IDS.E011}_v1_PDRM_${daysAgo(10)}`,
    eventId: EVENT_IDS.E011,
    versionId: 'v1',
    authorityType: 'PDRM',
    reviewerId: USER_IDS.U_OFC_PDRM_FED_01,
    rationale: 'Increasing police presence from baseline 12 to 18 due to concurrent Parliament session one week before event. Additional officers needed for road closures and dignitary routing.',
    previous: {
      police: 12, security: 22, medicalTeams: 1, ambulances: 1, toilets: 22, wasteBins: 55, fireOfficers: 3,
    },
    updated: {
      police: 18, security: 22, medicalTeams: 1, ambulances: 1, toilets: 22, wasteBins: 55, fireOfficers: 3,
    },
    overriddenAt: daysAgo(10),
  },
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
export const findResourceByEventVersion = (eventId: string, versionId: string): ResourceRecommendation | undefined =>
  mockResourceRecommendations.find((r) => r.eventId === eventId && r.versionId === versionId);

export const findResourceOverrides = (eventId: string, versionId: string): MockResourceOverride[] =>
  mockResourceOverrides.filter((o) => o.eventId === eventId && o.versionId === versionId);
