/** Shared runtime-free contracts used by the React app and Cloud Functions. */

export type UserRole = 'organizer' | 'authority' | 'public' | 'admin';

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

export interface EventRiskProfile {
  vulnerableAttendeesPercent?: number;
  standingAttendeesPercent?: number;
  internationalAttendees?: boolean;
  alcoholServed?: boolean;
  foodServed?: boolean;
  freeDrinkingWater?: boolean;
  ticketedEntry?: boolean;
  overnightAccommodation?: boolean;
  pyrotechnics?: boolean;
  temporaryStructures?: boolean;
  rivalryOrTensionExpected?: boolean;
  crowdManagementPlan?: boolean;
  trafficManagementPlan?: boolean;
  severeWeatherPlan?: boolean;
  medicalPlan?: boolean;
  evacuationPlanTested?: boolean;
  authorityCoordinationConfirmed?: boolean;
  nearestHospitalTravelMinutes?: number;
  verifiedControlIds?: string[];
}

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
  riskProfile?: EventRiskProfile;
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
  /** Control IDs that have been VERIFIED (not just declared) by an authority. */
  verifiedControlIds?: string[];
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
export type AssessmentReadiness = 'complete' | 'provisional' | 'insufficient_data';
export type ComplianceStatus = 'pass' | 'review_required' | 'blocked';
export type ConfidenceLevel = 'low' | 'medium' | 'high';
export type EvidenceQuality = 'official' | 'verified' | 'declared' | 'stale' | 'missing';
export type HazardDomain =
  | 'crowd'
  | 'venue_fire'
  | 'weather_environment'
  | 'public_health'
  | 'food_water_sanitation'
  | 'medical_capacity'
  | 'security_cbrn'
  | 'transport_accessibility';
export type ControlStatus = 'verified' | 'declared' | 'absent' | 'unknown';
export type ControlAxis = 'likelihood' | 'severity';

export interface WeatherContext {
  forecast: string;
  temperature: number;
  humidity: number;
  windSpeed: number;
  precipitationProbability: number;
  severeAlert: boolean;
}

export type ContextFreshness = 'fresh' | 'stale' | 'fallback' | 'not_assessable_yet' | 'unavailable';

export interface WeatherSnapshot {
  data: WeatherContext;
  source: 'met-malaysia' | 'openweather' | 'cache' | 'fallback';
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

export type EvidenceKey =
  | 'weather'
  | 'crowd'
  | 'venue'
  | 'history'
  | 'holiday'
  | 'public_health'
  | 'sanitation'
  | 'medical'
  | 'security'
  | 'transport'
  | 'compliance';

export interface CalendarContextSnapshot {
  localDate: string;
  dayOfWeek: string;
  isWeekend: boolean;
  isHolidayOrAdjacent: boolean;
  holidayName?: string;
  holidayDistanceDays?: -1 | 0 | 1;
  sourceVersion: string;
  sourceTimestamp: number;
}

export interface VenueContextSnapshot {
  matched: boolean;
  venueId?: string;
  submittedCapacity: number;
  registeredCapacity?: number;
  capacityDifference?: number;
  verifiedSafeCapacity?: number;
  jurisdiction?: string;
  fireCertificateStatus?: Venue['fireCertificateStatus'];
  fireCertificateExpiresAt?: number;
  emergencyAccessVerified?: boolean;
  nearestHospitalTravelMinutes?: number;
  riskNotes?: string;
  fetchedAt: number;
}

export interface HistoricalIncidentContextSnapshot {
  matched: boolean;
  venueId?: string;
  incidentIds: string[];
  total: number;
  bySeverity: Record<Incident['severity'], number>;
  historicalEventIds?: string[];
  historicalEventCount?: number;
  totalAttendance?: number;
  totalAttendeeHours?: number;
  patientPresentationRatePerThousand?: number;
  hospitalTransferRatePerThousand?: number;
  incidentRatePerThousandAttendeeHours?: number;
  comparableEvents?: ComparableHistoricalEvent[];
  lookbackStart?: number;
  syntheticEvidence?: boolean;
  fetchedAt: number;
}

export interface AssessmentContextSnapshot {
  weather: WeatherSnapshot;
  calendar: CalendarContextSnapshot;
  venue: VenueContextSnapshot;
  incidentHistory: HistoricalIncidentContextSnapshot;
}

export interface ScoreEvidence {
  key: EvidenceKey;
  description: string;
  sourceTimestamp: number;
  source: string;
  status: string;
  quality?: EvidenceQuality;
  confidenceScore?: number;
}

export type CategorySchemaStatus = 'prototype' | 'authorityValidated';

export interface ControlEvidence {
  controlId: string;
  status: ControlStatus;
  affects: ControlAxis;
  evidenceId?: string;
  source?: string;
}

export interface HazardAssessment {
  hazardId: string;
  hazardName: string;
  domain: HazardDomain;
  inherentLikelihood: 1 | 2 | 3 | 4 | 5;
  inherentSeverity: 1 | 2 | 3 | 4 | 5;
  inherentMatrixScore: number;
  controls: ControlEvidence[];
  residualLikelihood: 1 | 2 | 3 | 4 | 5;
  residualSeverity: 1 | 2 | 3 | 4 | 5;
  residualMatrixScore: number;
  riskLevel: RiskLevel;
  evidenceKeys: EvidenceKey[];
  missingData: string[];
  guidelineChecks: string[];
}

export interface HazardDomainSummary {
  domain: HazardDomain;
  name: string;
  score: number;
  matrixScore: number;
  riskLevel: RiskLevel;
  dominantHazardId: string;
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
}

export interface ComplianceCheck {
  checkId: string;
  name: string;
  status: ComplianceStatus;
  authority: AuthorityType;
  jurisdiction: string;
  rationale: string;
  evidenceKeys: EvidenceKey[];
  guidelineReference: string;
}

export interface CategoryAssignment {
  categoryId: string;
  categoryName: string;
  score: number;
  riskLevel: RiskLevel;
  weight: number;
  weightedContribution: number;
  rationale: string;
  evidenceKeys: EvidenceKey[];
  guidelineChecks: string[];
}

export interface DeterministicCategoryResult {
  categoryAssignments: CategoryAssignment[];
  officialScore: number;
  officialRiskLevel: RiskLevel;
  evidence: ScoreEvidence[];
  categorySchemaVersion: string;
  scoringLogicVersion: string;
  categorySchemaStatus: CategorySchemaStatus;
  assessmentReadiness?: AssessmentReadiness;
  complianceStatus?: ComplianceStatus;
  complianceChecks?: ComplianceCheck[];
  hazards?: HazardAssessment[];
  domainSummaries?: HazardDomainSummary[];
  officialMatrixScore?: number;
  dataConfidenceScore?: number;
  dataConfidenceLevel?: ConfidenceLevel;
  manualReviewRequired?: boolean;
  computedAt: number;
}

export interface AIAdvisoryCategoryAnalysis {
  categoryId: string;
  advisoryBand: RiskLevel;
  explanation: string;
  evidenceReferences: EvidenceKey[];
  keyConcerns: string[];
  resourceConsiderations: string[];
}

export interface AIAdvisoryAnalysis {
  model: string;
  promptVersion: string;
  responseSchemaVersion: string;
  status: AIStatus;
  label: 'advisory';
  overallBand?: RiskLevel;
  overallExplanation: string;
  categories: AIAdvisoryCategoryAnalysis[];
  keyConcerns: string[];
  resourceConsiderations: string[];
  citedEvidenceKeys: EvidenceKey[];
  cacheStatus: 'hit' | 'miss' | 'not-applicable';
  generatedAt: number;
}

export interface RiskAssessment extends DeterministicCategoryResult {
  assessmentId: string;
  eventId: string;
  versionId: string;
  status: 'ready';
  aiAdvisory: AIAdvisoryAnalysis;
  contextSnapshot: AssessmentContextSnapshot;
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

export interface ResourceRationale {
  resource: keyof ResourceQuantities;
  baselineQuantity: number;
  factors: string[];
  guidelineReferences: string[];
}

export interface ResourceRecommendationItem {
  resource: keyof ResourceQuantities;
  baseline: number;
  planningRange: { min: number; max: number };
  assumptions: string[];
  riskModifiers: string[];
  confidence: 'prototype' | 'low' | 'medium' | 'authorityValidated';
  guidelineReferences: string[];
  reviewingAuthority: AuthorityType;
  authorityReviewRequired: boolean;
}

export interface ResourceRecommendation extends ResourceQuantities {
  resourceId: string;
  eventId: string;
  versionId: string;
  assessmentId: string;
  formulaVersion: string;
  guidelineVersion: string;
  guidelineStatus: CategorySchemaStatus;
  rationales: Record<keyof ResourceQuantities, ResourceRationale>;
  items?: ResourceRecommendationItem[];
  aiConsiderations: string[];
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
  | 'public_published'
  | 'control_verified'
  | 'control_rejected';

export type NotificationType =
  | 'decision_made'
  | 'application_approved'
  | 'application_rejected'
  | 'amendment_requested'
  | 'control_verified'
  | 'control_rejected';

export interface Notification {
  notificationId: string;
  recipientUid: string;
  eventId: string;
  versionId?: string;
  type: NotificationType;
  title: string;
  message: string;
  sourceActionId: string;
  read: boolean;
  createdAt: number;
  readAt?: number;
}

export type ControlVerificationStatus = 'verified' | 'rejected';

export interface ControlVerification {
  /** Composite ID = `${versionId}_${controlId}_${authorityType}` */
  verificationId: string;
  eventId: string;
  versionId: string;
  controlId: string;
  authorityType: AuthorityType;
  reviewerUid: string;
  status: ControlVerificationStatus;
  rationale: string;
  /** Optional storage path (Firebase Storage or external) the reviewer used. */
  evidencePath?: string;
  /** Optional attached file metadata (filename, sizeBytes, mimeType). */
  evidenceFile?: { name: string; sizeBytes: number; mimeType: string };
  createdAt: number;
}

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
  jurisdiction?: string;
  usableAreaM2?: number;
  fixedSeats?: number;
  verifiedSafeCapacity?: number;
  exitCount?: number;
  totalExitWidthMm?: number;
  fireCertificateStatus?: 'valid' | 'expired' | 'not_required' | 'unknown';
  fireCertificateExpiresAt?: number;
  nearestHospitalTravelMinutes?: number;
  emergencyAccessVerified?: boolean;
  synthetic?: boolean;
  datasetVersion?: string;
  riskNotes?: string;
  incidentCount?: number;
}

export interface Incident {
  incidentId: string;
  eventId?: string;
  eventVersionId?: string;
  venueId: string;
  eventType: EventType;
  incidentType: string;
  severity: 'low' | 'medium' | 'high';
  date: number;
  status?: 'verified' | 'under_review' | 'rejected';
  assessmentEligible?: boolean;
  outcome?: {
    injured: number;
    hospitalized: number;
    fatalities: number;
    evacuated: number;
  };
  verifiedBy?: string;
  verifiedAt?: number;
  synthetic?: boolean;
  datasetVersion?: string;
  description?: string;
}

export interface HistoricalEventOutcome {
  historicalEventId: string;
  venueId: string;
  eventType: EventType;
  startDatetime: number;
  endDatetime: number;
  attendance: number;
  registeredCapacity: number;
  environment: EventEnvironment;
  coverage: VenueCoverage;
  seating: SeatingType;
  controlsVerified: string[];
  resourcesPlanned: Partial<ResourceQuantities>;
  resourcesActuallyUsed: Partial<ResourceQuantities>;
  outcomes: {
    patientPresentations: number;
    hospitalTransfers: number;
    ambulanceActivations: number;
    crowdIncidents: number;
    securityIncidents: number;
    weatherInterruptions: number;
    nearMisses: number;
    fatalities: number;
  };
  incidentIds: string[];
  completed: true;
  assessmentEligible: boolean;
  afterActionFindings: string[];
  synthetic: boolean;
  datasetVersion: string;
}

export interface ComparableHistoricalEvent {
  historicalEventId: string;
  venueId: string;
  eventType: EventType;
  attendance: number;
  attendeeHours: number;
  similarityScore: number;
  patientPresentations: number;
  hospitalTransfers: number;
  incidentCount: number;
  synthetic: boolean;
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
  HISTORICAL_EVENTS: 'historical_events',
  DATASET_MANIFESTS: 'dataset_manifests',
  PUBLIC_EVENTS: 'public_events',
  NOTIFICATIONS: 'notifications',
  EVENT_CONTROLS: 'event_controls',
  CONTROL_VERIFICATIONS: 'control_verifications',
} as const;

export const CATEGORY_SCHEMA_VERSION = '2026-07-24-all-hazards-v2';
export const SCORING_LOGIC_VERSION = '2026-07-24-hirarc-residual-v2';
export const CATEGORY_SCHEMA_STATUS: CategorySchemaStatus = 'prototype';
export const RESOURCE_FORMULA_VERSION = '2026-07-24-prototype-range-v3';
export const RESOURCE_GUIDELINE_VERSION = '2026-07-24-malaysia-research-v2';

export function riskLevelFor(score: number): RiskLevel {
  if (score >= 70) return 'High';
  if (score >= 40) return 'Medium';
  return 'Low';
}

export function hirarcRiskLevelFor(matrixScore: number): RiskLevel {
  if (matrixScore >= 15) return 'High';
  if (matrixScore >= 5) return 'Medium';
  return 'Low';
}
