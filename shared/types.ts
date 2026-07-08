/**
 * STERAS — Shared TypeScript types & enums
 * Used by both frontend (src/) and Cloud Functions (functions/src/).
 * Pure types only — no runtime imports.
 */

// =====================================================================
// USER ROLES
// =====================================================================

export type UserRole = 'organizer' | 'authority' | 'public';

export type AuthorityType =
  | 'PDRM' // Royal Malaysia Police
  | 'BOMBA' // Fire & Rescue
  | 'KKM' // Ministry of Health
  | 'DBKL' // Kuala Lumpur City Hall
  | 'MOTAC'; // Ministry of Tourism, Arts & Culture

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  authorityType?: AuthorityType; // only for role === 'authority'
  phone?: string;
  createdAt: number; // epoch ms
  updatedAt: number;
}

// =====================================================================
// EVENT TYPES
// =====================================================================

export type EventType =
  | 'concert'
  | 'festival'
  | 'sports'
  | 'cultural'
  | 'religious'
  | 'exhibition'
  | 'fair'
  | 'conference'
  | 'other';

export const EVENT_TYPES: { value: EventType; label: string }[] = [
  { value: 'concert', label: 'Concert / Music' },
  { value: 'festival', label: 'Festival' },
  { value: 'sports', label: 'Sports Event' },
  { value: 'cultural', label: 'Cultural Event' },
  { value: 'religious', label: 'Religious Gathering' },
  { value: 'exhibition', label: 'Exhibition' },
  { value: 'fair', label: 'Fair / Market' },
  { value: 'conference', label: 'Conference' },
  { value: 'other', label: 'Other' },
];

// =====================================================================
// EVENT STATUS
// =====================================================================

export type EventStatus =
  | 'Pending' // submitted, awaiting AI/rules + authority review
  | 'UnderReview' // an authority has opened it
  | 'AmendmentRequested' // authority wants changes
  | 'Approved'
  | 'Rejected'
  | 'Withdrawn'; // organizer pulled it

export const EVENT_STATUSES: { value: EventStatus; label: string; color: string }[] = [
  { value: 'Pending', label: 'Pending', color: 'amber' },
  { value: 'UnderReview', label: 'Under Review', color: 'blue' },
  { value: 'AmendmentRequested', label: 'Amendment Requested', color: 'orange' },
  { value: 'Approved', label: 'Approved', color: 'green' },
  { value: 'Rejected', label: 'Rejected', color: 'red' },
  { value: 'Withdrawn', label: 'Withdrawn', color: 'gray' },
];

// =====================================================================
// EVENT (Module 1)
// =====================================================================

export interface VenueLocation {
  lat: number;
  lng: number;
}

export interface EventDetails {
  name: string;
  type: EventType;
  venueName: string;
  venueAddress: string;
  venueLocation?: VenueLocation;
  venueCapacity: number;
  expectedAttendance: number;
  startDatetime: number; // epoch ms
  endDatetime: number; // epoch ms
  description?: string;
  organizerName: string;
  organizerContact: string; // phone or email
}

export interface EventRecord {
  eventId: string;
  organizerId: string;
  eventDetails: EventDetails;
  status: EventStatus;
  createdAt: number;
  updatedAt: number;
  // Populated by Cloud Functions / Module 2:
  riskScoreId?: string;
  resourceId?: string;
  decidedBy?: string; // authority uid
  decidedAt?: number;
}

// =====================================================================
// RISK SCORE (Module 2)
// =====================================================================

export type RiskLevel = 'Low' | 'Medium' | 'High';

export interface WeatherContext {
  forecast: string; // e.g. "Thunderstorm"
  temperature: number; // °C
  humidity: number; // %
  windSpeed: number; // m/s
  precipitationProbability: number; // %
  severeAlert: boolean;
}

export interface AIRiskScore {
  riskLevel: RiskLevel;
  riskScore: number; // 0-100
  reasoning: string;
  keyConcerns: string[];
  recommendedResources: Partial<ResourceRecommendation>; // AI's resource suggestion
  rawResponse?: string; // raw LLM output for audit
  model: string; // e.g. "MiniMax-M3"
  promptVersion: string; // for prompt-engineering audit trail
  generatedAt: number;
}

export interface RuleBasedScore {
  weatherScore: number; // 0-100, weighted 30%
  crowdScore: number; // 0-100, weighted 25%
  venueScore: number; // 0-100, weighted 20%
  historyScore: number; // 0-100, weighted 15%
  holidayScore: number; // 0-100, weighted 10%
  total: number; // 0-100, weighted sum
  riskLevel: RiskLevel;
  computedAt: number;
}

export interface RiskScoreRecord {
  id: string; // sub-collection doc id
  eventId: string;
  ai: AIRiskScore;
  rule: RuleBasedScore;
  disagreementFlag: boolean; // |ai.score - rule.total| >= 15
  disagreementDelta?: number;
  createdAt: number;
}

// =====================================================================
// RESOURCE RECOMMENDATION (Module 3)
// =====================================================================

export interface ResourceRecommendation {
  police: number;
  medicalTeams: number;
  ambulances: number;
  toilets: number;
  wasteBins: number;
  security: number;
  fireOfficers: number;
  confidenceLevel: 'estimate' | 'official'; // 'estimate' = prototype formula; 'official' = authority-validated
  source: 'rule-based' | 'ai' | 'manual'; // which engine produced this
  notes?: string;
  computedAt: number;
}

// =====================================================================
// AUDIT LOG (Module 4 + general)
// =====================================================================

export type AuditAction =
  | 'event_created'
  | 'event_updated'
  | 'event_withdrawn'
  | 'status_changed'
  | 'risk_score_computed'
  | 'resource_recommended'
  | 'amendment_requested'
  | 'authority_reviewed'
  | 'decision_made'
  | 'public_published';

export interface AuditLog {
  id: string;
  eventId: string;
  action: AuditAction;
  actorId: string;
  actorRole: UserRole | 'system';
  timestamp: number;
  previousStatus?: EventStatus;
  newStatus?: EventStatus;
  notes?: string;
  // Optional context blob
  metadata?: Record<string, unknown>;
}

// =====================================================================
// VENUE & INCIDENTS (Synthetic data for Module 2)
// =====================================================================

export interface Venue {
  venueId: string;
  name: string;
  address: string;
  capacity: number;
  location: VenueLocation;
  riskNotes?: string;
  // Optional reference to past incidents (synthetic)
  incidentCount?: number;
}

export interface Incident {
  incidentId: string;
  venueId: string;
  eventType: EventType;
  incidentType: string; // e.g. "medical_emergency", "crowd_crush", "weather_evacuation"
  severity: 'low' | 'medium' | 'high';
  date: number;
  description?: string;
}

// =====================================================================
// PUBLIC EVENT (Module 3 — read-only calendar for public viewers)
// =====================================================================

export interface PublicEvent {
  eventId: string;
  eventName: string;
  venueName: string;
  eventType: EventType;
  startDatetime: number;
  endDatetime: number;
  approvedBy: AuthorityType[];
  publicStatus: 'approved';
}

// =====================================================================
// FIRESTORE COLLECTION NAMES (constants — never hardcode strings elsewhere)
// =====================================================================

export const COLLECTIONS = {
  USERS: 'users',
  EVENTS: 'events',
  RISK_SCORES: 'risk_scores',
  RESOURCES: 'resources',
  AUDIT_LOGS: 'audit_logs',
  VENUES: 'venues',
  INCIDENTS: 'incidents',
  PUBLIC_EVENTS: 'public_events',
} as const;

// Disagreement threshold per PRD §4 (Module 2)
export const DISAGREEMENT_THRESHOLD = 15;
