import { EventType } from '@shared/types';

/**
 * STERAS 5 Event Categories (per `steras-event-info.md` §1).
 * Maps the existing `EventType` (M1 contract) to the higher-level
 * STERAS category for M2 risk assessment + M5 reporting.
 *
 * Local type — promote to `@shared/types.ts` when M1/M2 align on it.
 */

export type EventCategory =
  | 'entertainment_performance'    // Concert, theatre, live performance, fashion show
  | 'sports_recreational'          // Fun run, marathon, cycling, tournament
  | 'cultural_heritage_festival'   // Cultural festival, heritage, festive event, public parade
  | 'exhibition_convention'        // Tourism expo, trade exhibition, convention, roadshow
  | 'carnival_public_celebration'; // Food carnival, tourism carnival, funfair, countdown

export const EVENT_CATEGORY_LABELS: Record<EventCategory, { name: string; short: string; color: string }> = {
  entertainment_performance:    { name: 'Entertainment and Performance Event',     short: 'Entertainment', color: 'purple' },
  sports_recreational:          { name: 'Sports and Recreational Event',           short: 'Sports',        color: 'blue' },
  cultural_heritage_festival:   { name: 'Cultural, Heritage and Festival Event',   short: 'Cultural',      color: 'amber' },
  exhibition_convention:        { name: 'Exhibition, Convention and Promotional',  short: 'Exhibition',    color: 'cyan' },
  carnival_public_celebration:   { name: 'Carnival and Public Celebration',         short: 'Carnival',      color: 'rose' },
};

export const EVENT_CATEGORY_EXAMPLES: Record<EventCategory, string[]> = {
  entertainment_performance:    ['Concert', 'Theatre', 'Live performance', 'Fashion show'],
  sports_recreational:          ['Fun run', 'Marathon', 'Cycling event', 'Tournament'],
  cultural_heritage_festival:   ['Cultural festival', 'Heritage celebration', 'Festive event', 'Public parade', 'Religious gathering'],
  exhibition_convention:        ['Tourism expo', 'Trade exhibition', 'Convention', 'Roadshow', 'Conference'],
  carnival_public_celebration:   ['Food carnival', 'Tourism carnival', 'Funfair', 'Public countdown', 'Fair', 'Market'],
};

/** Maps each `EventType` value (from `@shared/types.ts`) to a STERAS category. */
export const EVENT_TYPE_TO_CATEGORY: Record<EventType, EventCategory> = {
  concert:    'entertainment_performance',
  festival:   'cultural_heritage_festival',
  sports:     'sports_recreational',
  cultural:   'cultural_heritage_festival',
  religious:  'cultural_heritage_festival',
  exhibition: 'exhibition_convention',
  fair:       'carnival_public_celebration',
  conference: 'exhibition_convention',
  other:      'carnival_public_celebration',
};

/** Maps each `EventType` to the typical risks that M2 would assess (from `steras-event-info.md` §1). */
export const EVENT_CATEGORY_RISKS: Record<EventCategory, string[]> = {
  entertainment_performance:    ['Crowd congestion', 'Stage safety', 'Sound systems', 'Electrical hazards', 'Security'],
  sports_recreational:          ['Participant injuries', 'Route safety', 'Traffic control', 'Medical support'],
  cultural_heritage_festival:   ['Crowd control', 'Food safety', 'Temporary stalls', 'Fire risks', 'Cultural sensitivities'],
  exhibition_convention:        ['Venue capacity', 'Booth safety', 'Emergency exits', 'Electrical installations'],
  carnival_public_celebration:   ['Rides', 'Temporary structures', 'Food hygiene', 'Crowd density', 'Fire and security'],
};

/**
 * STERAS 3 Venue Settings (per `steras-event-info.md` §2).
 * M3 only reads this for default-check officer selection (A4).
 * Distinct from the existing `EventDetails.environment` which is a M1 field.
 */
export type VenueSetting = 'indoor' | 'outdoor_fixed' | 'outdoor_route';

export const VENUE_SETTING_LABELS: Record<VenueSetting, { name: string; examples: string }> = {
  indoor:          { name: 'Indoor',              examples: 'Hall, convention centre, enclosed stadium' },
  outdoor_fixed:   { name: 'Outdoor fixed-site',  examples: 'Park, field, open-air stadium' },
  outdoor_route:   { name: 'Outdoor route-based', examples: 'Fun run, marathon, parade, cycling event' },
};

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
export const categoryFor = (type: EventType): EventCategory => EVENT_TYPE_TO_CATEGORY[type];

export const labelForCategory = (category: EventCategory): string => EVENT_CATEGORY_LABELS[category].name;
export const labelForVenueSetting = (setting: VenueSetting): string => VENUE_SETTING_LABELS[setting].name;
