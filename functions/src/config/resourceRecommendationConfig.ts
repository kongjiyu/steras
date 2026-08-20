import {
  AuthorityType,
  EventType,
  RESOURCE_CONFIG_VERSION,
  RESOURCE_FORMULA_VERSION,
  RESOURCE_SOURCE_REGISTRY_VERSION,
  ResourceKey,
  ResourceSourceSnapshot,
} from '@shared/types';

export { RESOURCE_CONFIG_VERSION, RESOURCE_FORMULA_VERSION, RESOURCE_SOURCE_REGISTRY_VERSION } from '@shared/types';

export const INTERNAL_RESOURCE_SOURCE_ID = 'internal.resource-baseline.v4';

export const RESOURCE_SOURCE_REGISTRY: Record<string, ResourceSourceSnapshot> = {
  [INTERNAL_RESOURCE_SOURCE_ID]: {
    sourceId: INTERNAL_RESOURCE_SOURCE_ID,
    title: 'STERAS internal prototype resource baseline assumptions',
    issuer: 'STERAS',
    kind: 'internal_prototype',
    locator: 'functions/src/config/resourceRecommendationConfig.ts',
    version: RESOURCE_CONFIG_VERSION,
    retrievedAt: Date.UTC(2026, 7, 19),
    verificationStatus: 'prototype_unverified',
  },
};

export interface ResourceBaselineConfig {
  divisor: number;
  minimum: number;
}

export interface ResourceRecommendationConfig {
  formulaVersion: string;
  configVersion: string;
  sourceRegistryVersion: string;
  planningRangeMultiplier: number;
  baselines: Record<ResourceKey, ResourceBaselineConfig>;
  toiletSecondaryDivisor: number;
  highOverallModifiers: Partial<Record<ResourceKey, number>>;
  highCategoryModifiers: Partial<Record<'crowd' | 'weather_environment' | 'venue_fire', Partial<Record<ResourceKey, number>>>>;
  indoorModifiers: Partial<Record<ResourceKey, number>>;
  securityEventMultipliers: Record<EventType, number>;
  reviewingAuthorities: Record<ResourceKey, AuthorityType>;
  numericSourceId: string;
  assessmentCategoryIds: readonly string[];
}

export const ACTIVE_RESOURCE_CONFIG: ResourceRecommendationConfig = {
  formulaVersion: RESOURCE_FORMULA_VERSION,
  configVersion: RESOURCE_CONFIG_VERSION,
  sourceRegistryVersion: RESOURCE_SOURCE_REGISTRY_VERSION,
  planningRangeMultiplier: 1.25,
  baselines: {
    police: { divisor: 250, minimum: 2 },
    security: { divisor: 100, minimum: 0 },
    medicalTeams: { divisor: 1_000, minimum: 1 },
    ambulances: { divisor: 5_000, minimum: 1 },
    fireOfficers: { divisor: 500, minimum: 1 },
    toilets: { divisor: 50, minimum: 0 },
    wasteBins: { divisor: 100, minimum: 0 },
  },
  toiletSecondaryDivisor: 75,
  highOverallModifiers: {
    police: 10,
    medicalTeams: 1,
    ambulances: 1,
  },
  highCategoryModifiers: {
    crowd: { police: 5, security: 5 },
    weather_environment: { medicalTeams: 1 },
    venue_fire: { fireOfficers: 2 },
  },
  indoorModifiers: { fireOfficers: 1 },
  securityEventMultipliers: {
    concert: 2,
    festival: 1.5,
    sports: 1.5,
    cultural: 1,
    religious: 1.5,
    exhibition: 1,
    fair: 1,
    conference: 1,
    other: 1,
  },
  reviewingAuthorities: {
    police: 'PDRM',
    security: 'PDRM',
    medicalTeams: 'KKM',
    ambulances: 'KKM',
    fireOfficers: 'BOMBA',
    toilets: 'KKM',
    wasteBins: 'DBKL',
  },
  numericSourceId: INTERNAL_RESOURCE_SOURCE_ID,
  assessmentCategoryIds: [
    'crowd', 'venue_fire', 'weather_environment', 'public_health',
    'food_water_sanitation', 'medical_capacity', 'security_cbrn', 'transport_accessibility',
  ],
};
