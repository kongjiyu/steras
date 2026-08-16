/**
 * Event trigger conditions (per `steras-event-info.md` §4).
 *
 * Each trigger represents an event condition that, when met, requires
 * additional supporting documents. M1 collects these on the application
 * form; M3 sees them in the review context.
 *
 * Local enum — promote to `@shared/types.ts` when the contract is locked.
 */

export type EventTrigger =
  | 'uses_public_road'               // Trigger 1 - road closure
  | 'uses_tents_temporary_structures' // Trigger 2 - canopy permit
  | 'large_indoor_high_crowd'         // Trigger 3 - venue capacity + fire plan
  | 'food_beverage_vendors'           // Trigger 4 - food licences
  | 'foreign_performers'              // Trigger 5 - PUSPAL approval
  | 'fireworks_pyrotechnics'          // Trigger 6 - operator + safety zone
  | 'funfair_amusement_rides'         // Trigger 7 - ride certificates
  | 'outdoor_route_based'             // Trigger 8 - route plan + checkpoints
  | 'ticketed_event'                  // Trigger 9 - ticket sample
  | 'sale_of_alcohol'                 // Trigger 10 - liquor licence
  | 'drone_operation'                 // Trigger 11 - drone approval
  | 'government_land_park'           // Trigger 12 - land authority permission
  | 'water_based_activity'            // Trigger 13 - water safety plan
  | 'high_risk_large_scale';          // Trigger 14 - insurance + medical agreement

export const EVENT_TRIGGER_LABELS: Record<EventTrigger, string> = {
  uses_public_road:                'Uses a public road or requires road closure',
  uses_tents_temporary_structures:  'Uses tents, canopies or temporary structures',
  large_indoor_high_crowd:          'Large indoor or high-crowd event',
  food_beverage_vendors:            'Food and beverage vendors',
  foreign_performers:               'Foreign performers',
  fireworks_pyrotechnics:           'Fireworks or pyrotechnics',
  funfair_amusement_rides:          'Funfair or amusement rides',
  outdoor_route_based:              'Outdoor route-based event',
  ticketed_event:                   'Ticketed event',
  sale_of_alcohol:                  'Sale of alcohol',
  drone_operation:                  'Drone operation',
  government_land_park:             'Event on government land, park or protected area',
  water_based_activity:             'Water-based activity',
  high_risk_large_scale:            'High-risk or large-scale event',
};

export const EVENT_TRIGGER_ADDITIONAL_DOCS: Record<EventTrigger, string[]> = {
  uses_public_road:                ['Route map', 'Traffic-management plan', 'Road-closure application', 'Diversion plan'],
  uses_tents_temporary_structures:  ['Canopy / temporary-structure permit', 'Structural drawings', 'Installation details', 'Engineer certification'],
  large_indoor_high_crowd:          ['Venue capacity document', 'Fire-safety plan', 'Emergency-exit plan', 'BOMBA support / approval'],
  food_beverage_vendors:            ['Vendor list', 'Food-premises / trading licences', 'Food-safety documentation'],
  foreign_performers:               ['PUSPAL approval', 'Immigration / professional-visit documents'],
  fireworks_pyrotechnics:           ['Activity declaration', 'Operator appointment', 'Approval / certification', 'Safety-zone plan', 'Insurance'],
  funfair_amusement_rides:          ['Ride list + photographs', 'Equipment certificates', 'Inspection records', 'Maintenance records', 'Operator competency'],
  outdoor_route_based:              ['Detailed route plan', 'Checkpoint plan', 'Traffic-control plan', 'Participant tracking', 'Medical-station locations'],
  ticketed_event:                   ['Ticketing information', 'Ticket sample', 'State entertainment-duty documentation'],
  sale_of_alcohol:                  ['Liquor licence / temporary sale approval'],
  drone_operation:                  ['Drone-operation approval', 'Flight plan'],
  government_land_park:             ['Land / park / forestry / site authority permission'],
  water_based_activity:             ['Water-safety plan', 'Rescue arrangement', 'Participant equipment list', 'Operator certification'],
  high_risk_large_scale:            ['Public-liability insurance', 'Medical-provider agreement', 'Ambulance arrangement', 'Professional security plan'],
};

// ---------------------------------------------------------------------------
// Per-event trigger map (which of the 14 conditions apply)
// ---------------------------------------------------------------------------
import { EVENT_IDS } from './ids';

export const mockEventTriggers: Record<string, EventTrigger[]> = {
  // E001 - Dataran Merdeka Music Festival - large outdoor, ticketed, alcohol, food, public road
  [EVENT_IDS.E001]: ['large_indoor_high_crowd', 'food_beverage_vendors', 'sale_of_alcohol', 'ticketed_event', 'high_risk_large_scale'],
  // E002 - PJ Food Fair - food vendors, government land
  [EVENT_IDS.E002]: ['food_beverage_vendors', 'government_land_park'],
  // E003 - KLCC Skyrun - indoor, route-based
  [EVENT_IDS.E003]: ['large_indoor_high_crowd', 'outdoor_route_based'],
  // E004 - KL Marathon - route-based, road closure, ticketed, high risk
  [EVENT_IDS.E004]: ['outdoor_route_based', 'uses_public_road', 'ticketed_event', 'high_risk_large_scale', 'large_indoor_high_crowd'],
  // E005 - Shah Alam Beach Carnival - tents, food, government land
  [EVENT_IDS.E005]: ['uses_tents_temporary_structures', 'food_beverage_vendors', 'government_land_park', 'funfair_amusement_rides'],
  // E006 - KL Tech Conference - indoor
  [EVENT_IDS.E006]: ['large_indoor_high_crowd'],
  // E007 - KL Cultural Night - indoor
  [EVENT_IDS.E007]: ['large_indoor_high_crowd'],
  // E008 - Shah Alam Adventure Race - outdoor route
  [EVENT_IDS.E008]: ['outdoor_route_based', 'high_risk_large_scale'],
  // E009 - PJ Community Fair - government land
  [EVENT_IDS.E009]: ['government_land_park', 'food_beverage_vendors'],
  // E010 - KL Night Market - government land, food, tents
  [EVENT_IDS.E010]: ['government_land_park', 'food_beverage_vendors', 'uses_tents_temporary_structures'],
  // E011 - KL Corporate Run - route, ticketed, road
  [EVENT_IDS.E011]: ['outdoor_route_based', 'uses_public_road', 'ticketed_event'],
  // E012 - KL World Tour Concert - pyrotechnics, alcohol, high risk, ticketed, large crowd
  [EVENT_IDS.E012]: ['fireworks_pyrotechnics', 'sale_of_alcohol', 'high_risk_large_scale', 'ticketed_event', 'large_indoor_high_crowd', 'uses_tents_temporary_structures'],
  // E013 - KL Coastal Cleanup - government land
  [EVENT_IDS.E013]: ['government_land_park'],
  // E014 - Shah Alam Music Fest - tents, food, alcohol, ticketed, large
  [EVENT_IDS.E014]: ['uses_tents_temporary_structures', 'food_beverage_vendors', 'sale_of_alcohol', 'ticketed_event', 'large_indoor_high_crowd'],
  // E015 - KL Charity Run - route, road, ticketed
  [EVENT_IDS.E015]: ['outdoor_route_based', 'uses_public_road', 'ticketed_event'],
  // E016 - Axiata Music Fest - indoor, ticketed, food
  [EVENT_IDS.E016]: ['large_indoor_high_crowd', 'ticketed_event', 'food_beverage_vendors'],
  // E017 - PJ Wedding Expo - indoor
  [EVENT_IDS.E017]: ['large_indoor_high_crowd'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export const triggersForEvent = (eventId: string): EventTrigger[] =>
  mockEventTriggers[eventId] ?? [];

export const additionalDocsForEvent = (eventId: string): string[] => {
  const triggers = triggersForEvent(eventId);
  const docs = new Set<string>();
  triggers.forEach((t) => EVENT_TRIGGER_ADDITIONAL_DOCS[t].forEach((d) => docs.add(d)));
  return Array.from(docs);
};

export const isHighRisk = (eventId: string): boolean =>
  (mockEventTriggers[eventId] ?? []).includes('high_risk_large_scale');

export const labelForTrigger = (t: EventTrigger): string => EVENT_TRIGGER_LABELS[t];
