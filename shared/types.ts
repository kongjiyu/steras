/** Shared runtime-free contracts used by the React app and Cloud Functions. */

export type UserRole = 'organizer' | 'authority' | 'public';

export type AuthorityType = 'PDRM' | 'BOMBA' | 'KKM' | 'DBKL' | 'MOTAC';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  authorityType?: AuthorityType;
  phone?: string;
  createdAt: number;
  updatedAt: number;
}

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

export type EventStatus =
  | 'Draft'
  | 'Pending'
  | 'UnderReview'
  | 'AmendmentRequested'
  | 'Approved'
  | 'Rejected'
  | 'Withdrawn';

export const EVENT_STATUSES: { value: EventStatus; label: string; color: string }[] = [
  { value: 'Draft', label: 'Draft', color: 'gray' },
  { value: 'Pending', label: 'Pending', color: 'amber' },
  { value: 'UnderReview', label: 'Under Review', color: 'blue' },
  { value: 'AmendmentRequested', label: 'Amendment Requested', color: 'orange' },
  { value: 'Approved', label: 'Approved', color: 'green' },
  { value: 'Rejected', label: 'Rejected', color: 'red' },
  { value: 'Withdrawn', label: 'Withdrawn', color: 'gray' },
];

export interface VenueLocation {
  lat: number;
  lng: number;
}

export type EventEnvironment = 'indoor' | 'outdoor' | 'mixed';
export type VenueCoverage = 'covered' | 'partially_covered' | 'uncovered';
export type SeatingType = 'seated' | 'standing' | 'mixed';

export interface EventDetails {
  name: string;
  type: EventType;
  venueId?: string;
  venueName: string;
  venueAddress: string;
  venueLocation?: VenueLocation;
  venueCapacity: number;
  expectedAttendance: number;
  environment: EventEnvironment;
  coverage: VenueCoverage;
  seating: SeatingType;
  startDatetime: number;
  endDatetime: number;
  description?: string;
  emergencyPlanSummary: string;
  organizerName: string;
  organizerEmail: string;
  organizerPhone: string;
}

export interface EventRecord {
  eventId: string;
  organizerId: string;
  eventDetails: EventDetails;
  status: EventStatus;
  currentVersionId?: string;
  currentVersionNumber: number;
  currentAssessmentId?: string;
  currentResourceId?: string;
  editableVersionId?: string | null;
  draftDocumentPaths: string[];
  requiredAuthorities: AuthorityType[];
  createdAt: number;
  updatedAt: number;
  submittedAt?: number;
}

export interface EventVersion {
  versionId: string;
  eventId: string;
  versionNumber: number;
  eventDetails: EventDetails;
  documentPaths: string[];
  submittedBy: string;
  submittedAt: number;
  inputHash: string;
  supersededAt?: number;
}

export type RiskLevel = 'Low' | 'Medium' | 'High';
export type AssessmentStatus = 'processing' | 'ready' | 'failed';
export type AIStatus = 'success' | 'unavailable' | 'invalid';

export interface WeatherContext {
  forecast: string;
  temperature: number;
  humidity: number;
  windSpeed: number;
  precipitationProbability: number;
  severeAlert: boolean;
}

export type ContextFreshness = 'fresh' | 'stale' | 'fallback';

export interface WeatherSnapshot {
  data: WeatherContext;
  source: 'openweather' | 'cache' | 'fallback';
  freshness: ContextFreshness;
  fetchedAt: number;
  expiresAt: number;
  forecastFor: number;
}

export interface IncidentSnapshot {
  incidents: Incident[];
  venueId?: string;
  matched: boolean;
  fetchedAt: number;
}

export type EvidenceKey = 'weather' | 'crowd' | 'venue' | 'history' | 'holiday';

export interface ScoreEvidence {
  key: EvidenceKey;
  description: string;
  sourceTimestamp: number;
}

export interface RiskSubScores {
  weather: number;
  crowd: number;
  venue: number;
  history: number;
  holiday: number;
}

export interface WeightedContributions {
  weather: number;
  crowd: number;
  venue: number;
  history: number;
  holiday: number;
}

export interface DeterministicBaseline {
  subScores: RiskSubScores;
  weightedContributions: WeightedContributions;
  baselineScore: number;
  baselineRiskLevel: RiskLevel;
  evidence: ScoreEvidence[];
  ruleVersion: string;
  computedAt: number;
}

export interface AIRefinement {
  model: string;
  promptVersion: string;
  status: AIStatus;
  proposedAdjustment: number;
  validatedAdjustment: number;
  reasoning: string;
  compoundEffects: string[];
  keyConcerns: string[];
  citedEvidenceKeys: EvidenceKey[];
  cacheStatus: 'hit' | 'miss' | 'not-applicable';
  generatedAt: number;
}

export interface RiskAssessment extends DeterministicBaseline {
  assessmentId: string;
  eventId: string;
  versionId: string;
  status: 'ready';
  ai: AIRefinement;
  finalScore: number;
  finalRiskLevel: RiskLevel;
  sourceTimestamps: Record<string, number>;
  contextStatuses: Record<string, string>;
  inputHash: string;
  createdAt: number;
}

export interface AssessmentJob {
  assessmentId: string;
  eventId: string;
  versionId: string;
  status: 'processing' | 'failed';
  inputHash: string;
  claimId: string;
  claimedAt: number;
  leaseExpiresAt: number;
  error?: string;
  createdAt: number;
}

export type AssessmentRecord = RiskAssessment | AssessmentJob;

export interface ResourceQuantities {
  police: number;
  medicalTeams: number;
  ambulances: number;
  toilets: number;
  wasteBins: number;
  security: number;
  fireOfficers: number;
}

export interface ResourceRecommendation extends ResourceQuantities {
  resourceId: string;
  eventId: string;
  versionId: string;
  assessmentId: string;
  formulaVersion: string;
  confidenceLevel: 'prototype' | 'authorityValidated';
  notes?: string;
  overriddenBy?: string;
  overrideRationale?: string;
  overriddenAt?: number;
  computedAt: number;
}

export type DecisionValue = 'Approved' | 'Rejected' | 'AmendmentRequested';

export interface AuthorityDecision {
  decisionId: string;
  eventId: string;
  versionId: string;
  authorityType: AuthorityType;
  decision: DecisionValue;
  rationale: string;
  reviewerId: string;
  decidedAt: number;
  current: boolean;
}

export type AuditAction =
  | 'event_created'
  | 'event_updated'
  | 'event_submitted'
  | 'event_withdrawn'
  | 'status_changed'
  | 'risk_score_computed'
  | 'resource_recommended'
  | 'resource_overridden'
  | 'amendment_requested'
  | 'authority_reviewed'
  | 'decision_made'
  | 'public_published';

export interface AuditLog {
  id: string;
  eventId: string;
  versionId?: string;
  action: AuditAction;
  actorId: string;
  actorRole: UserRole | 'system';
  timestamp: number;
  previousStatus?: EventStatus;
  newStatus?: EventStatus;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface Venue {
  venueId: string;
  name: string;
  address: string;
  capacity: number;
  location: VenueLocation;
  riskNotes?: string;
  incidentCount?: number;
}

export interface Incident {
  incidentId: string;
  venueId: string;
  eventType: EventType;
  incidentType: string;
  severity: 'low' | 'medium' | 'high';
  date: number;
  description?: string;
}

export interface PublicEvent {
  eventId: string;
  versionId: string;
  eventName: string;
  venueName: string;
  eventType: EventType;
  startDatetime: number;
  endDatetime: number;
  approvedBy: AuthorityType[];
  publicStatus: 'approved';
}

export const COLLECTIONS = {
  USERS: 'users',
  EVENTS: 'events',
  VERSIONS: 'versions',
  ASSESSMENTS: 'assessments',
  RESOURCES: 'resources',
  DECISIONS: 'decisions',
  DECISION_HISTORY: 'decision_history',
  RESOURCE_OVERRIDES: 'resource_overrides',
  AUDIT_LOGS: 'audit_logs',
  VENUES: 'venues',
  INCIDENTS: 'incidents',
  PUBLIC_EVENTS: 'public_events',
} as const;

export const RULE_VERSION = '2026-07-v1';
export const RESOURCE_FORMULA_VERSION = '2026-07-prototype-v1';
export const MAX_AI_ADJUSTMENT = 15;

export function riskLevelFor(score: number): RiskLevel {
  if (score >= 70) return 'High';
  if (score >= 40) return 'Medium';
  return 'Low';
}

export function finalScoreFor(baselineScore: number, proposedAdjustment: number) {
  const baseline = Math.max(0, Math.min(100, Math.round(baselineScore)));
  const validatedAdjustment = Math.max(0, Math.min(MAX_AI_ADJUSTMENT, Math.round(proposedAdjustment)));
  const finalScore = Math.min(100, baseline + validatedAdjustment);
  return { validatedAdjustment, finalScore, finalRiskLevel: riskLevelFor(finalScore) };
}
