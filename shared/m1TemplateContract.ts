import {
  EventEnvironment,
  EventType,
  M1EventCategory,
  M1TemplateSelection,
  M1VenueSetting,
  M1_TEMPLATE_REGISTRY_VERSION,
} from './types';

export const M1_EVENT_CATEGORY_VALUES: readonly M1EventCategory[] = [
  'entertainment_performance',
  'sports_recreational',
  'cultural_heritage_festival',
  'exhibition_convention_promotional',
  'carnival_public_celebration',
];

export const M1_VENUE_SETTING_VALUES: readonly M1VenueSetting[] = [
  'indoor',
  'outdoor_fixed_site',
  'outdoor_route_based',
];

const TEMPLATE_MATRIX: Record<M1EventCategory, Record<M1VenueSetting, string>> = {
  entertainment_performance: {
    indoor: 'STERAS-T01-ENT-IN-v2.0',
    outdoor_fixed_site: 'STERAS-T02-ENT-OF-v1.0',
    outdoor_route_based: 'STERAS-T03-ENT-OR-v1.0',
  },
  sports_recreational: {
    indoor: 'STERAS-T04-SPT-IN-v1.0',
    outdoor_fixed_site: 'STERAS-T05-SPT-OF-v1.0',
    outdoor_route_based: 'STERAS-T06-SPT-OR-v1.0',
  },
  cultural_heritage_festival: {
    indoor: 'STERAS-T07-CUL-IN-v1.0',
    outdoor_fixed_site: 'STERAS-T08-CUL-OF-v1.0',
    outdoor_route_based: 'STERAS-T09-CUL-OR-v1.0',
  },
  exhibition_convention_promotional: {
    indoor: 'STERAS-T10-EXP-IN-v1.0',
    outdoor_fixed_site: 'STERAS-T11-EXP-OF-v1.0',
    outdoor_route_based: 'STERAS-T12-EXP-OR-v1.0',
  },
  carnival_public_celebration: {
    indoor: 'STERAS-T13-CAR-IN-v1.0',
    outdoor_fixed_site: 'STERAS-T14-CAR-OF-v1.0',
    outdoor_route_based: 'STERAS-T15-CAR-OR-v1.0',
  },
};

export function m1ScenarioTemplateIdFor(eventCategory: M1EventCategory, venueSetting: M1VenueSetting): string {
  return TEMPLATE_MATRIX[eventCategory][venueSetting];
}

export function m1CategoryForEventType(eventType: EventType): M1EventCategory {
  return EVENT_TYPE_CATEGORY[eventType];
}

export function m1VenueSettingMatchesEnvironment(venueSetting: M1VenueSetting, environment: EventEnvironment): boolean {
  return venueSetting === 'indoor' ? environment === 'indoor' : environment !== 'indoor';
}

export function isValidM1TemplateSelection(value: unknown): value is M1TemplateSelection {
  if (!isRecord(value) || Object.keys(value).some((key) => !SELECTION_KEYS.has(key))) return false;
  if (!M1_EVENT_CATEGORY_VALUES.includes(value.eventCategory as M1EventCategory)
    || !M1_VENUE_SETTING_VALUES.includes(value.venueSetting as M1VenueSetting)
    || value.coreTemplateId !== 'STERAS-CORE'
    || value.templateRegistryVersion !== M1_TEMPLATE_REGISTRY_VERSION
    || typeof value.selectedAt !== 'number'
    || !Number.isSafeInteger(value.selectedAt)
    || value.selectedAt <= 0
    || typeof value.scenarioTemplateId !== 'string') return false;
  return m1ScenarioTemplateIdFor(
    value.eventCategory as M1EventCategory,
    value.venueSetting as M1VenueSetting,
  ) === value.scenarioTemplateId;
}

const SELECTION_KEYS = new Set([
  'eventCategory',
  'venueSetting',
  'coreTemplateId',
  'scenarioTemplateId',
  'templateRegistryVersion',
  'selectedAt',
]);

const EVENT_TYPE_CATEGORY: Record<EventType, M1EventCategory> = {
  concert: 'entertainment_performance',
  festival: 'cultural_heritage_festival',
  sports: 'sports_recreational',
  cultural: 'cultural_heritage_festival',
  religious: 'cultural_heritage_festival',
  exhibition: 'exhibition_convention_promotional',
  fair: 'carnival_public_celebration',
  conference: 'exhibition_convention_promotional',
  other: 'carnival_public_celebration',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
