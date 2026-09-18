import type { AuthorityType, EventType, UserRole } from './types';

export const M4_SCHEMA_VERSION = '2026-09-03-m4-v1';
export const M4_AI_PROMPT_VERSION = '2026-09-03-incident-triage-v1';
export const M4_AI_AUTHORITY_PROMPT_VERSION = '2026-09-15-incident-authority-recommendation-v1';
export const M4_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
export const M4_EVENT_TIME_ZONE = 'Asia/Kuala_Lumpur';
const M4_DAY_MS = 86_400_000;

function m4DatePart(parts: Intl.DateTimeFormatPart[], type: string) {
  return parts.find((part) => part.type === type)?.value ?? '';
}

/** The Malaysia calendar date on which the selected event begins (its D-Day). */
export function m4EventDayDate(timestamp: number) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: M4_EVENT_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp));
  return `${m4DatePart(parts, 'year')}-${m4DatePart(parts, 'month')}-${m4DatePart(parts, 'day')}`;
}

/** Returns the Malaysia creation date key used by participant incident IDs. */
export function m4IncidentCreationDate(timestamp: number) {
  const date = m4EventDayDate(timestamp);
  return `${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}`;
}

/** Formats a participant incident ID from its creation date and daily sequence. */
export function m4IncidentIdForSequence(timestamp: number, sequence: number) {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 9999) throw new Error('Incident sequence must be between 1 and 9999.');
  return `INC-${m4IncidentCreationDate(timestamp)}-${String(sequence).padStart(4, '0')}`;
}

/** Converts a Malaysia D-Day date and wall-clock time to an absolute timestamp. */
export function m4EventDayTimestamp(date: string, time: string) {
  return Date.parse(`${date}T${time}:00+08:00`);
}

/** Returns the fixed D-Day date and its full 24-hour Malaysia calendar-day interval. */
export function m4EventDayBounds(timestamp: number) {
  const date = m4EventDayDate(timestamp);
  const start = m4EventDayTimestamp(date, '00:00');
  return { date, start, end: start + M4_DAY_MS };
}

/** Current Malaysia wall-clock time formatted for a native time input. */
export function m4MalaysiaTimeValue(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: M4_EVENT_TIME_ZONE,
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  return `${m4DatePart(parts, 'hour')}:${m4DatePart(parts, 'minute')}`;
}

export const INCIDENT_CATEGORIES = [
  'crowd', 'missing_person', 'lost_found', 'medical_safety', 'security',
  'property_damage', 'suspicious_activity', 'access_traffic', 'event_control_discrepancy', 'other',
] as const;
export type M4IncidentCategory = typeof INCIDENT_CATEGORIES[number];
export const INCIDENT_CATEGORY_LABELS: Record<M4IncidentCategory, string> = {
  crowd: 'Crowd Congestion or Overcrowding',
  missing_person: 'Missing Person',
  lost_found: 'Lost and Found',
  medical_safety: 'Medical or Safety Incident',
  security: 'Security Concern',
  property_damage: 'Property or Facility Damage',
  suspicious_activity: 'Suspicious Activity',
  access_traffic: 'Access or Traffic Issue',
  event_control_discrepancy: 'Published Event Control Discrepancy',
  other: 'Other Incident',
};
export type M4IncidentSeverity = 'low' | 'medium' | 'high';
export type M4IncidentStatus = 'submitted' | 'manual_review_required' | 'organizer_review' | 'responding' | 'authority_investigation' | 'awaiting_resolution' | 'resolved';
export type M4ParticipantProgressState = 'complete' | 'current' | 'upcoming';
export type M4ParticipantProgressKey = 'submitted' | 'review' | 'action' | 'resolved';
export interface M4ParticipantProgressStep {
  key: M4ParticipantProgressKey; title: string; state: M4ParticipantProgressState; description: string; timestamp?: number; note?: string;
}

export interface M4EvidenceRef { path: string; name: string; mimeType: string; size: number; uploadedBy: string; uploadedAt: number; }
export type M4AIAssessment =
  | { status: 'success'; model: string; promptVersion: typeof M4_AI_PROMPT_VERSION; severity: M4IncidentSeverity; immediateActionRequired: boolean; rationale: string; assessedAt: number }
  | { status: 'unavailable' | 'invalid'; promptVersion: typeof M4_AI_PROMPT_VERSION; reason: string; assessedAt: number };
export type M4AuthorityRecommendation =
  | { status: 'success'; model: string; promptVersion: typeof M4_AI_AUTHORITY_PROMPT_VERSION; authorityIds: string[]; rationale: string; assessedAt: number }
  | { status: 'no_match' | 'unavailable' | 'invalid'; model?: string; promptVersion: typeof M4_AI_AUTHORITY_PROMPT_VERSION; reason: string; assessedAt: number };

export interface M4IncidentRecord {
  reportWithdrawnAt?: number;
  schemaVersion: typeof M4_SCHEMA_VERSION;
  incidentId: string; eventId: string; eventVersionId: string; venueId: string; eventType: EventType;
  eventName: string; organizerId: string; reporterUid: string; reporterRole: UserRole;
  category: M4IncidentCategory; incidentType: string; description: string; location: string; occurredAt: number;
  evidence: M4EvidenceRef[]; aiAssessment: M4AIAssessment; aiAuthorityRecommendation?: M4AuthorityRecommendation; severity?: M4IncidentSeverity;
  immediateActionRequired?: boolean; status: M4IncidentStatus; assignedInternalTeam?: string;
  referredAuthorityId?: string; referredAuthorityType?: AuthorityType; referredAuthorityName?: string; linkedControlId?: string; linkedStage2DocId?: string;
  publicReportTicketId?: string; finalResolution?: string; discrepancyOutcome?: 'confirmed_true' | 'dismissed_fake';
  recommendedAuthorityIds?: string[]; assignedAuthorityOfficerUid?: string; linkedControlName?: string;
  assessmentEligible: boolean; synthetic: boolean; date: number; createdAt: number; updatedAt: number; resolvedAt?: number;
  reviewedAt?: number; actionStartedAt?: number;
  activityClosed?: boolean; closureReason?: 'event_withdrawn'; closedAt?: number;
}

/** Builds the participant-safe progress timeline without exposing internal AI or response details. */
export function participantIncidentProgress(record: Pick<M4IncidentRecord, 'status' | 'createdAt' | 'updatedAt' | 'resolvedAt' | 'reviewedAt' | 'actionStartedAt' | 'finalResolution'> & Partial<Pick<M4IncidentRecord, 'assignedInternalTeam' | 'referredAuthorityType' | 'referredAuthorityName'>>): M4ParticipantProgressStep[] {
  const reviewComplete = ['responding', 'authority_investigation', 'awaiting_resolution', 'resolved'].includes(record.status);
  const actionInProgress = ['responding', 'authority_investigation'].includes(record.status);
  const actionComplete = ['awaiting_resolution', 'resolved'].includes(record.status);
  const resolutionCurrent = record.status === 'awaiting_resolution';
  const resolved = record.status === 'resolved';
  const steps: M4ParticipantProgressStep[] = [{ key: 'submitted', title: 'Report submitted', state: 'complete', timestamp: record.createdAt, description: 'Report submitted for the event.' }];
  if (!reviewComplete) {
    steps.push({ key: 'review', title: 'Under review', state: 'current', description: 'Your report is being reviewed by the organiser.' });
    return steps;
  }
  steps.push({ key: 'review', title: 'Reviewed', state: 'complete', timestamp: record.reviewedAt ?? record.updatedAt, description: 'Your report has been reviewed.' });
  if (actionInProgress || actionComplete) {
    const authorityName = record.referredAuthorityName ?? record.referredAuthorityType ?? 'the assigned authority';
    const actionTitle = record.status === 'authority_investigation'
      ? `Investigation ongoing by ${authorityName}`
      : record.status === 'responding'
        ? `Action taken by ${record.assignedInternalTeam ?? 'the internal response team'}`
        : 'Action completed';
    const actionDescription = record.status === 'authority_investigation'
      ? 'The selected authority is investigating this report.'
      : record.status === 'responding'
        ? 'The organiser has assigned an internal response team.'
        : 'The response action has been completed.';
    steps.push({ key: 'action', title: actionTitle, state: actionInProgress ? 'current' : 'complete', timestamp: record.actionStartedAt ?? record.updatedAt, description: actionDescription });
  }
  if (resolutionCurrent || resolved) steps.push({ key: 'resolved', title: 'Resolved', state: resolved ? 'complete' : 'current', timestamp: resolved ? record.resolvedAt : undefined, description: resolved ? 'The incident has been resolved.' : 'The response is complete and awaiting final resolution.', ...(resolved && record.finalResolution ? { note: record.finalResolution } : {}) });
  return steps;
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
