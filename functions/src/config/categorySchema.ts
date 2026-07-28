import {
  CATEGORY_SCHEMA_STATUS,
  CATEGORY_SCHEMA_VERSION,
  HazardDomain,
  SCORING_LOGIC_VERSION,
} from '@shared/types';

export interface CategoryDefinition {
  id: HazardDomain;
  name: string;
  guidelineChecks: string[];
}

/**
 * Temporary M2 configuration that preserves the existing deterministic inputs
 * behind the category-based contract required by STERAS_PRD.md.
 *
 * The team must replace the names, weights, thresholds, and guideline check IDs
 * after the category taxonomy and authority sources are approved. Until then the
 * status remains `prototype` and the UI must not present it as official guidance.
 */
export const ACTIVE_CATEGORY_SCHEMA = {
  version: CATEGORY_SCHEMA_VERSION,
  scoringLogicVersion: SCORING_LOGIC_VERSION,
  status: CATEGORY_SCHEMA_STATUS,
  categories: [
    {
      id: 'crowd',
      name: 'Crowd safety',
      guidelineChecks: ['my.dosh.hirarc.2008', 'who.mass-gathering.all-hazards.2023', 'my.ubbl.state-specific'],
    },
    {
      id: 'venue_fire',
      name: 'Venue, fire and structural safety',
      guidelineChecks: ['my.dosh.hirarc.2008', 'my.fire-services-act.1988', 'my.ubbl.state-specific'],
    },
    {
      id: 'weather_environment',
      name: 'Weather and environmental exposure',
      guidelineChecks: ['my.dosh.hirarc.2008', 'who.mass-gathering.all-hazards.2023', 'my.met.warning-criteria'],
    },
    {
      id: 'public_health',
      name: 'Public health and epidemiology',
      guidelineChecks: ['who.mass-gathering.all-hazards.2023'],
    },
    {
      id: 'food_water_sanitation',
      name: 'Food, water and sanitation',
      guidelineChecks: ['who.mass-gathering.all-hazards.2023'],
    },
    {
      id: 'medical_capacity',
      name: 'Medical and health-system capacity',
      guidelineChecks: ['who.mass-gathering.all-hazards.2023', 'internal.resource-baseline.v3'],
    },
    {
      id: 'security_cbrn',
      name: 'Security, behaviour and CBRN',
      guidelineChecks: ['who.mass-gathering.all-hazards.2023'],
    },
    {
      id: 'transport_accessibility',
      name: 'Transport and accessibility',
      guidelineChecks: ['who.mass-gathering.all-hazards.2023', 'my.ubbl.state-specific'],
    },
  ] satisfies CategoryDefinition[],
} as const;
