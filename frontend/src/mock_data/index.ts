/**
 * M3 mock data - barrel export.
 *
 * Usage in frontend (designed to be import-swappable with live Firestore):
 *
 *   import { mockEvents, findEventById } from '@/mock_data';
 *   // ...
 *   // Later, when wired to Firestore:
 *   // import { liveEvents as mockEvents, findEventById } from '@/lib/firestore';
 *
 * All data is typed against `@shared/types` (or local types in this folder
 * for planned-but-unbuilt features like EventControl, Notification,
 * OrganiserProfile, EventDocument, EventSchedule).
 *
 * The 17 events cover all 7 EventStatus values plus edge cases for the
 * 6 known M3 gaps (compliance gate, provisional rationale, control
 * verification, Stage 2 verification, M4 outcome trigger, durable
 * notifications).
 */

// ----- IDs + time helpers -----
export * from './ids';

// ----- Users (organisers, admin, 25 officers, 3 public viewers) -----
export * from './users';

// ----- Organiser extended profiles (SSM, safety coordinator, prior events) -----
export * from './organiser_profiles';

// ----- Venues -----
export * from './venues';

// ----- 5 STERAS event categories + 3 venue settings -----
export * from './event_categories';

// ----- 14 trigger-based event conditions + per-event map -----
export * from './event_triggers';

// ----- Events -----
export * from './events';

// ----- Event daily hours + activity timeline -----
export * from './event_schedules';

// ----- Event supporting documents (9 core + trigger-based) -----
export * from './event_documents';

// ----- Event versions (immutable) -----
export * from './versions';

// ----- M2 Risk assessments (consumed by M3) -----
export * from './assessments';

// ----- M2 Resource recommendations + M3 overrides -----
export * from './resources';

// ----- M3 Authority decisions + history -----
export * from './decisions';

// ----- M3 Audit logs (append-only) -----
export * from './audit_logs';

// ----- Public events projection (sanitised) -----
export * from './public_events';

// ----- Notifications (PLANNED - 16 matrix triggers) -----
export * from './notifications';

// ----- Event controls + Stage 1 / Stage 2 (PLANNED) -----
// Also exports STAGE2_IMAGE map for components that need the real-photo URLs.
export * from './controls';

// ----- M4 public report tickets (PLANNED) -----
export * from './public_reports';

// ----- M4 incidents (M2 history inputs) -----
export * from './incidents';

// ----- M2 historical events -----
export * from './historical_events';

// ----- Named scenario groupings + page-level snapshots -----
export * from './scenarios';
