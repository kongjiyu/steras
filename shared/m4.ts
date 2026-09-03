import type { AuthorityType, EventType, UserRole } from './types';

export const M4_SCHEMA_VERSION = '2026-09-03-m4-v1';
export const M4_AI_PROMPT_VERSION = '2026-09-03-incident-triage-v1';
export const M4_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;

export const INCIDENT_CATEGORIES = [
  'crowd', 'missing_person', 'lost_found', 'medical_safety', 'security',
  'property_damage', 'suspicious_activity', 'access_traffic', 'event_control_discrepancy', 'other',
] as const;
export type M4IncidentCategory = typeof INCIDENT_CATEGORIES[number];
export type M4IncidentSeverity = 'low' | 'medium' | 'high';
export type M4IncidentStatus = 'submitted' | 'manual_review_required' | 'organizer_review' | 'responding' | 'authority_investigation' | 'awaiting_resolution' | 'resolved';

export interface M4EvidenceRef { path: string; name: string; mimeType: string; size: number; uploadedBy: string; uploadedAt: number; }
export type M4AIAssessment =
  | { status: 'success'; model: string; promptVersion: typeof M4_AI_PROMPT_VERSION; severity: M4IncidentSeverity; immediateActionRequired: boolean; rationale: string; assessedAt: number }
  | { status: 'unavailable' | 'invalid'; promptVersion: typeof M4_AI_PROMPT_VERSION; reason: string; assessedAt: number };

export interface M4IncidentRecord {
  schemaVersion: typeof M4_SCHEMA_VERSION;
  incidentId: string; eventId: string; eventVersionId: string; venueId: string; eventType: EventType;
  eventName: string; organizerId: string; reporterUid: string; reporterRole: UserRole;
  category: M4IncidentCategory; incidentType: string; description: string; location: string; occurredAt: number;
  evidence: M4EvidenceRef[]; aiAssessment: M4AIAssessment; severity?: M4IncidentSeverity;
  immediateActionRequired?: boolean; status: M4IncidentStatus; assignedInternalTeam?: string;
  referredAuthorityId?: string; referredAuthorityType?: AuthorityType; linkedControlId?: string; linkedStage2DocId?: string;
  publicReportTicketId?: string; finalResolution?: string; discrepancyOutcome?: 'confirmed_true' | 'dismissed_fake';
  recommendedAuthorityIds?: string[]; assignedAuthorityOfficerUid?: string;
  assessmentEligible: boolean; synthetic: false; date: number; createdAt: number; updatedAt: number; resolvedAt?: number;
  activityClosed?: boolean; closureReason?: 'event_withdrawn'; closedAt?: number;
}

export interface M4AuthorityDirectoryEntry {
  authorityId: string; name: string; authorityType: AuthorityType; serviceCategories: M4IncidentCategory[];
  coverageAreas: string[]; contactName: string; contactPhone: string; contactEmail?: string;
  active: boolean; createdAt: number; updatedAt: number;
}

export interface M4IncidentHistoryEntry {
  historyId: string; incidentId: string; action: string; actorUid: string; actorRole: UserRole | 'system';
  timestamp: number; summary: string; evidence: M4EvidenceRef[]; idempotencyKey?: string; requestHash?: string;
}
