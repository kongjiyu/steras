import { RESOURCE_KEYS, RESOURCE_SCHEMA_VERSION, ResourceQuantities, ResourceRecommendation, AuthorityType } from '@shared/types';
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

const RESOURCE_FORMULA_VERSION = '2026-08-19-deterministic-v4';
const RESOURCE_CONFIG_VERSION = '2026-08-19-prototype-v1';
const RESOURCE_SOURCE_REGISTRY_VERSION = '2026-08-19-v1';

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

  const q = o.quantities;
  const stage = assessment?.status === 'official_ready' ? 'official' : 'provisional';
  const resourceInputHash = 'a'.repeat(64);
  const source = {
    sourceId: 'internal.resource-baseline.v4',
    title: 'STERAS internal prototype resource baseline assumptions',
    issuer: 'STERAS',
    kind: 'internal_prototype' as const,
    locator: 'functions/src/config/resourceRecommendationConfig.ts',
    version: RESOURCE_CONFIG_VERSION,
    retrievedAt: Date.UTC(2026, 7, 19),
    verificationStatus: 'prototype_unverified' as const,
  };
  const items = Object.fromEntries(RESOURCE_KEYS.map((resource) => [resource, {
    status: 'ready' as const,
    resource,
    baseline: q[resource],
    planningRange: { min: q[resource], max: Math.ceil(q[resource] * 1.25) },
    inputReferences: [{ inputId: 'event.expectedAttendance', kind: 'event_field' as const, path: 'eventDetails.expectedAttendance', value: event.eventDetails.expectedAttendance }],
    assumptions: [{ assumptionId: `resource.${resource}.prototype-baseline`, statement: 'Internal academic prototype; not an authority minimum.', sourceIds: [source.sourceId] }],
    appliedRules: [{ ruleId: `resource.${resource}.mock`, description: 'Mock deterministic resource rule.', inputReferenceIds: ['event.expectedAttendance'], sourceIds: [source.sourceId], contribution: q[resource] }],
    sourceSnapshots: [source],
    authoritySource: { status: 'not_supplied' as const, reason: 'No verified authority-issued numeric ratio is supplied.' },
    confidence: stage === 'official' ? 'authority_validated' as const : 'prototype' as const,
    reviewingAuthority: resource === 'fireOfficers' ? 'BOMBA' as const
      : resource === 'medicalTeams' || resource === 'ambulances' ? 'KKM' as const
        : resource === 'toilets' || resource === 'wasteBins' ? 'DBKL' as const
          : 'PDRM' as const,
    authorityReviewRequired: stage !== 'official',
  }])) as ResourceRecommendation['items'];
  const proposalId = assessment?.aiProposal?.status === 'success' ? assessment.aiProposal.proposalId : `mock-${o.eventId}`;

  return {
    resourceId: `${stage}-${o.versionId}-${resourceInputHash}`,
    eventId: o.eventId,
    versionId: o.versionId,
    assessmentId: o.versionId,
    schemaVersion: RESOURCE_SCHEMA_VERSION,
    stage,
    revision: 1,
    supersedesResourceId: null,
    assessmentReference: stage === 'official'
      ? { stage: 'official', assessmentId: o.versionId, proposalId, finalizedAt: o.computedAt, finalizedBy: o.overriddenBy ?? 'mock-authority' }
      : { stage: 'provisional', assessmentId: o.versionId, proposalId },
    resourceInputHash,
    formulaVersion: RESOURCE_FORMULA_VERSION,
    configVersion: RESOURCE_CONFIG_VERSION,
    sourceRegistryVersion: RESOURCE_SOURCE_REGISTRY_VERSION,
    items,
    confidenceLevel: stage === 'official' ? 'authority_validated' : 'prototype',
    authorityReviewRequired: stage !== 'official',
    notes: 'Indicative academic prototype guidance; not an operational deployment authorisation.',
    computedAt: o.computedAt,
  } as ResourceRecommendation;
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
