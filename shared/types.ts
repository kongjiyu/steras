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
  | 'Withdrawn'
  | 'Manual Review Required';

export const EVENT_STATUSES: { value: EventStatus; label: string; color: string }[] = [
  { value: 'Draft', label: 'Draft', color: 'gray' },
  { value: 'Pending', label: 'Pending', color: 'amber' },
  { value: 'UnderReview', label: 'Under Review', color: 'blue' },
  { value: 'AmendmentRequested', label: 'Amendment Requested', color: 'orange' },
  { value: 'Approved', label: 'Approved', color: 'green' },
  { value: 'Rejected', label: 'Rejected', color: 'red' },
  { value: 'Withdrawn', label: 'Withdrawn', color: 'gray' },
  { value: 'Manual Review Required', label: 'Manual Review Required', color: 'purple' },
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
  /** M3 round N+1 (Workstream 1) — which review stage the event is in.
   *  - 'initial':   admin has not yet approved for officer review (default)
   *  - 'authority': officers are reviewing (admin clicked "Assign")
   *  - 'second':    all officers have decided; admin must confirm aggregate
   *  Absent or 'initial' = legacy flow (no assignment required). */
  reviewStage?: 'initial' | 'authority' | 'second';
  /** M3 round N+1 (Workstream 2) — true after the admin has generated AND
   *  committed the per-authority event control list. The organizer can
   *  then see the Stage 1 + Stage 2 requirements in
   *  `OrganizerEventControls` (UC-34) and the officers can verify them.
   *  Reset to `false` (or unset) if a new version is approved and a new
   *  control list needs to be generated for that version. */
  controlListGenerated?: boolean;
  /** M3 round N+1 (Workstream 2) — the per-authority control list
   *  items, mirrored from `event_controls/{controlId}` (or its absence
   *  when the list hasn't been generated). Mainly used for the admin
   *  UI to render the current list without re-querying the sub-collection.
   *  Server-owned: written by `editEventControlList`. */
  controlListSnapshot?: Array<{
    controlId: string;
    controlName: string;
    authority: AuthorityType;
    stageRequirement: 'stage1_only' | 'stage1_and_stage2';
    stage1RequirementsCount: number;
    stage2Label?: string;
    controlItemVersion: number;
    label: EventControl['label'];
  }>;
  createdAt: number;
  updatedAt: number;
  submittedAt?: number;
  authorityReviewCompletedAt?: number;
  authorityReviewCompletedVersionId?: string;
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
export const ASSESSMENT_SCHEMA_VERSION = '2026-08-21-prd-v5-hardening-v1';
export const CONTEXT_EVIDENCE_SCHEMA_VERSION = '2026-08-21-context-evidence-v1';
export const EVIDENCE_SUFFICIENCY_VERSION = '2026-08-21-eight-category-v1';
export const VENUE_BINDING_VERSION = '2026-08-21-canonical-venue-v1';
export const WEATHER_POLICY_VERSION = '2026-08-21-no-placeholder-v1';
export const SCORE_REVIEW_SCHEMA_VERSION = '2026-08-20-authority-review-v1';
export const SCORE_RESOLUTION_SCHEMA_VERSION = '2026-08-20-score-resolution-v1';
export const OFFICIAL_FORMULA_VERSION = '2026-08-20-authority-official-v1';
export const MANUAL_ASSESSMENT_SCHEMA_VERSION = '2026-08-21-admin-manual-v1';
export const MANUAL_OFFICIAL_FORMULA_VERSION = '2026-08-21-admin-manual-official-v1';
export type AssessmentStatus =
  | 'processing'
  | 'manual_review_required'
  | 'provisional_ready'
  | 'authority_review'
  | 'official_ready'
  | 'failed';
export type AIStatus = 'success' | 'unavailable' | 'timeout' | 'invalid';
export type ScoreRating = 1 | 2 | 3 | 4 | 5;
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

interface WeatherSnapshotBase {
  source: 'met-malaysia' | 'openweather' | 'cache' | 'fallback';
  freshness: ContextFreshness;
  fetchedAt: number;
  expiresAt: number;
  forecastFor: number;
}

export type WeatherSnapshot = WeatherSnapshotBase & ({
  data: WeatherContext;
  measurementStatus: 'available';
  unavailableReason?: never;
} | {
  data: null;
  measurementStatus: 'unavailable';
  unavailableReason: 'outside_forecast_horizon' | 'provider_unavailable';
});

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
  coverageStatus: 'verified' | 'unsupported_year';
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
  syntheticStatus: 'none' | 'partial' | 'all';
  incidentEvidence?: Array<{
    incidentId: string;
    synthetic: boolean;
    datasetVersion?: string;
  }>;
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
  quality: EvidenceQuality;
  confidenceScore: number;
  eligibility: 'eligible' | 'ineligible' | 'missing';
  syntheticStatus: 'none' | 'partial' | 'all';
}

export interface ContextEvidenceProvenance {
  evidenceId: string;
  evidenceKey: EvidenceKey;
  sourceKind: 'external_api' | 'official_registry' | 'official_dataset' | 'submitted_document' | 'submitted_declaration' | 'derived';
  sourceLocator: string;
  retrievedAt: number;
  sourceVersion: string;
  eligibility: 'eligible' | 'ineligible' | 'missing';
  eligibilityReason?: string;
  synthetic: boolean;
  visibility: 'authority_only' | 'organizer_safe';
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

export interface AIHazardProposal {
  hazardId: string;
  hazardName: string;
  categoryId: HazardDomain;
  evidenceReferences: EvidenceKey[];
  rationale: string;
}

export interface AICategoryProposal {
  categoryId: string;
  likelihood: ScoreRating;
  severity: ScoreRating;
  evidenceReferences: EvidenceKey[];
  rationale: string;
  confidence: ConfidenceLevel;
  concerns: string[];
  missingInformation: string[];
}

export interface AISuccessfulProposal {
  status: 'success';
  proposalId: string;
  model: string;
  promptVersion: string;
  responseSchemaVersion: string;
  hazards: AIHazardProposal[];
  categories: AICategoryProposal[];
  cacheStatus: 'hit' | 'miss' | 'not-applicable';
  generatedAt: number;
}

export interface AIFailedProposal {
  status: 'unavailable' | 'timeout' | 'invalid';
  model: string;
  promptVersion: string;
  responseSchemaVersion: string;
  retryable: boolean;
  errorSummary: string;
  cacheStatus: 'not-applicable';
  generatedAt: number;
}

export type AIProposalAttempt = AISuccessfulProposal | AIFailedProposal;

export type ValidationWarningCode =
  | 'missing_evidence'
  | 'unsupported_evidence_reference'
  | 'invalid_calculation'
  | 'rubric_conflict'
  | 'low_confidence'
  | 'hard_rule_adjustment';

export interface ValidationWarning {
  warningId: string;
  code: ValidationWarningCode;
  message: string;
  categoryId?: string;
  evidenceReferences: EvidenceKey[];
}

export interface AppliedHardRule {
  ruleId: string;
  categoryId: string;
  axis: ControlAxis;
  proposedValue: ScoreRating;
  constrainedValue: ScoreRating;
  rationale: string;
  guidelineReferences: string[];
}

export interface ValidatedCategoryResult {
  categoryId: string;
  categoryName: string;
  proposedLikelihood: ScoreRating;
  proposedSeverity: ScoreRating;
  validatedLikelihood: ScoreRating;
  validatedSeverity: ScoreRating;
  matrixScore: number;
  normalizedScore: number;
  riskLevel: RiskLevel;
  weight: number;
  weightedContribution: number;
  evidenceReferences: EvidenceKey[];
  rationale: string;
  confidence: ConfidenceLevel;
  concerns: string[];
  missingInformation: string[];
  appliedHardRules: AppliedHardRule[];
  guidelineChecks: string[];
}

export interface ProvisionalAssessmentResult {
  proposalId: string;
  validatedHazards: AIHazardProposal[];
  categories: ValidatedCategoryResult[];
  overallScore: number;
  weightedRiskLevel: RiskLevel;
  highestCategoryRiskLevel: RiskLevel;
  overallRiskLevel: RiskLevel;
  formulaVersion: string;
  categorySchemaVersion: string;
  hardRuleVersion: string;
  calculatedAt: number;
}

export interface OfficialCategoryResult extends ValidatedCategoryResult {
  authorityLikelihood: ScoreRating;
  authoritySeverity: ScoreRating;
  sourceReviewIds: string[];
  resolutionId?: string;
}

export interface OfficialAssessmentResult extends Omit<ProvisionalAssessmentResult, 'categories'> {
  sourceKind?: 'ai_authority';
  categories: OfficialCategoryResult[];
  reviewIds: string[];
  resolutionId?: string;
  officialInputHash: string;
  officialFormulaVersion: typeof OFFICIAL_FORMULA_VERSION;
  finalizedAt: number;
  finalizedBy: string;
}

export interface AdminManualHazard {
  hazardId: string;
  hazardName: string;
  categoryId: HazardDomain;
  evidenceReferences: EvidenceKey[];
  rationale: string;
}

export interface AdminManualCategoryInput {
  categoryId: HazardDomain;
  likelihood: ScoreRating;
  severity: ScoreRating;
  evidenceReferences: EvidenceKey[];
  rationale: string;
  missingInformation: string;
}

export interface AdminManualAssessment {
  manualAssessmentId: string;
  schemaVersion: typeof MANUAL_ASSESSMENT_SCHEMA_VERSION;
  eventId: string;
  versionId: string;
  assessmentId: string;
  assessmentInputHash: string;
  eventVersionInputHash: string;
  categorySchemaVersion: string;
  hardRuleVersion: string;
  officialFormulaVersion: typeof MANUAL_OFFICIAL_FORMULA_VERSION;
  hazards: AdminManualHazard[];
  categories: AdminManualCategoryInput[];
  rationale: string;
  submittedBy: string;
  idempotencyKey: string;
  createdAt: number;
}

export interface ManualOfficialCategoryResult {
  categoryId: HazardDomain;
  categoryName: string;
  manualLikelihood: ScoreRating;
  manualSeverity: ScoreRating;
  validatedLikelihood: ScoreRating;
  validatedSeverity: ScoreRating;
  matrixScore: number;
  normalizedScore: number;
  riskLevel: RiskLevel;
  weight: number;
  weightedContribution: number;
  evidenceReferences: EvidenceKey[];
  rationale: string;
  missingInformation: string;
  appliedHardRules: AppliedHardRule[];
  guidelineChecks: string[];
}

export interface ManualOfficialAssessmentResult {
  sourceKind: 'admin_manual';
  manualAssessmentId: string;
  manualHazards: AdminManualHazard[];
  categories: ManualOfficialCategoryResult[];
  overallScore: number;
  weightedRiskLevel: RiskLevel;
  highestCategoryRiskLevel: RiskLevel;
  overallRiskLevel: RiskLevel;
  formulaVersion: typeof MANUAL_OFFICIAL_FORMULA_VERSION;
  categorySchemaVersion: string;
  hardRuleVersion: string;
  officialInputHash: string;
  calculatedAt: number;
  finalizedAt: number;
  finalizedBy: string;
}

export type CalculatedAssessmentResult = ProvisionalAssessmentResult | OfficialAssessmentResult | ManualOfficialAssessmentResult;

interface AuthorityCategoryScoreReviewBase {
  categoryId: string;
  likelihood: ScoreRating;
  severity: ScoreRating;
}

export type AuthorityCategoryScoreReview =
  | (AuthorityCategoryScoreReviewBase & { decision: 'confirmed'; reason?: never })
  | (AuthorityCategoryScoreReviewBase & { decision: 'overridden'; reason: string });

export interface AuthorityScoreReview {
  reviewId: string;
  schemaVersion: typeof SCORE_REVIEW_SCHEMA_VERSION;
  eventId: string;
  versionId: string;
  assessmentId: string;
  proposalId: string;
  provisionalCalculatedAt: number;
  assessmentInputHash: string;
  categorySchemaVersion: string;
  authorityType: AuthorityType;
  reviewerId: string;
  categories: AuthorityCategoryScoreReview[];
  rationale: string;
  idempotencyKey: string;
  supersedesReviewId?: string;
  createdAt: number;
}

export interface AuthorityReviewHead {
  reviewId: string;
  createdAt: number;
}

export interface AuthorityScoreConflict {
  categoryId: string;
  reviewIds: string[];
}

export interface AuthorityReviewState {
  requiredAuthorities: AuthorityType[];
  activeReviewHeads: Partial<Record<AuthorityType, AuthorityReviewHead>>;
  conflicts: AuthorityScoreConflict[];
  activeResolutionId?: string;
  updatedAt: number;
}

export interface AuthorityScoreResolutionCategory {
  categoryId: string;
  likelihood: ScoreRating;
  severity: ScoreRating;
  reason: string;
}

export interface AuthorityScoreResolution {
  resolutionId: string;
  schemaVersion: typeof SCORE_RESOLUTION_SCHEMA_VERSION;
  eventId: string;
  versionId: string;
  assessmentId: string;
  reviewHeadIds: Partial<Record<AuthorityType, string>>;
  categories: AuthorityScoreResolutionCategory[];
  resolvedBy: string;
  rationale: string;
  createdAt: number;
}

interface AssessmentBase {
  assessmentId: string;
  eventId: string;
  versionId: string;
  schemaVersion: typeof ASSESSMENT_SCHEMA_VERSION;
  contextSnapshot: AssessmentContextSnapshot;
  evidence: ScoreEvidence[];
  contextEvidence: ContextEvidenceProvenance[];
  sourceTimestamps: Record<string, number>;
  contextStatuses: Record<string, string>;
  assessmentReadiness: AssessmentReadiness;
  complianceStatus: ComplianceStatus;
  complianceChecks: ComplianceCheck[];
  dataConfidenceScore: number;
  dataConfidenceLevel: ConfidenceLevel;
  inputHash: string;
  createdAt: number;
}

export interface ProvisionalRiskAssessment extends AssessmentBase {
  status: 'provisional_ready' | 'authority_review';
  aiProposal: AISuccessfulProposal;
  warnings: ValidationWarning[];
  authorityReviewRequired: true;
  provisionalResult: ProvisionalAssessmentResult;
  authorityReviewState?: AuthorityReviewState;
}

export interface ManualReviewRiskAssessment extends AssessmentBase {
  status: 'manual_review_required';
  aiProposal: AIProposalAttempt | null;
  warnings: ValidationWarning[];
  authorityReviewRequired: true;
  manualReviewReason: string;
  activeManualAssessmentId?: string;
}

export interface OfficialRiskAssessment extends AssessmentBase {
  status: 'official_ready';
  aiProposal: AISuccessfulProposal;
  warnings: ValidationWarning[];
  authorityReviewRequired: false;
  provisionalResult: ProvisionalAssessmentResult;
  officialResult: OfficialAssessmentResult;
  authorityReviewState: AuthorityReviewState;
}

export interface AdminManualOfficialRiskAssessment extends AssessmentBase {
  status: 'official_ready';
  sourceKind: 'admin_manual';
  aiProposal: AIFailedProposal | null;
  warnings: ValidationWarning[];
  authorityReviewRequired: false;
  manualReviewReason: string;
  activeManualAssessmentId: string;
  officialResult: ManualOfficialAssessmentResult;
}

export type RiskAssessment = ProvisionalRiskAssessment | ManualReviewRiskAssessment | OfficialRiskAssessment | AdminManualOfficialRiskAssessment;

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

export interface OrganizerAssessmentSummary {
  assessmentId: string;
  eventId: string;
  versionId: string;
  schemaVersion: string;
  status: AssessmentStatus;
  overallScore?: number;
  overallRiskLevel?: RiskLevel;
  categories: Array<{
    categoryId: string;
    categoryName: string;
    normalizedScore: number;
    riskLevel: RiskLevel;
  }>;
  assessmentReadiness?: AssessmentReadiness;
  complianceStatus?: ComplianceStatus;
  authorityReviewRequired: boolean;
  authorityReviewProgress?: { completed: number; required: number };
  resourceQuantities?: ResourceQuantities;
  resourceRecommendation?: OrganizerResourceRecommendation;
  computedAt: number;
}

/**
 * A lossy, presentation-only projection of the canonical resource items.
 * ResourceRecommendation does not extend this type so the stored baseline
 * cannot diverge from the provenance attached to its item.
 */
export interface ResourceQuantities {
  police: number;
  medicalTeams: number;
  ambulances: number;
  toilets: number;
  wasteBins: number;
  security: number;
  fireOfficers: number;
}

export const RESOURCE_SCHEMA_VERSION = '2026-08-21-prd-v5-hardening-v1';
export const RESOURCE_FORMULA_VERSION = '2026-08-19-deterministic-v4';
export const RESOURCE_CONFIG_VERSION = '2026-08-19-prototype-v1';
export const RESOURCE_SOURCE_REGISTRY_VERSION = '2026-08-19-v1';
export const RESOURCE_KEYS = [
  'police',
  'security',
  'medicalTeams',
  'ambulances',
  'fireOfficers',
  'toilets',
  'wasteBins',
] as const;
export type ResourceKey = typeof RESOURCE_KEYS[number];
export type ResourceRecommendationStage = 'provisional' | 'official';
export type ResourceConfidence = 'prototype' | 'low' | 'medium' | 'authority_validated';
export type ResourceSourceVerificationStatus = 'prototype_unverified' | 'verified';

export interface ResourcePlanningRange {
  min: number;
  max: number;
}

export interface ResourceInputReference {
  inputId: string;
  kind: 'event_field' | 'assessment_overall' | 'assessment_category';
  path: string;
  value: string | number | boolean;
}

export interface ResourceSourceSnapshot {
  sourceId: string;
  title: string;
  issuer: string;
  kind: 'internal_prototype' | 'law' | 'official_guidance' | 'voluntary_standard';
  locator: string;
  version: string;
  retrievedAt: number;
  verificationStatus: ResourceSourceVerificationStatus;
}

export interface ResourceAssumption {
  assumptionId: string;
  statement: string;
  sourceIds: string[];
}

export interface ResourceAppliedRule {
  ruleId: string;
  description: string;
  inputReferenceIds: string[];
  sourceIds: string[];
  contribution: number;
}

export type ResourceAuthoritySource =
  | {
      status: 'not_supplied';
      reason: string;
    }
  | {
      status: 'supplied';
      source: ResourceSourceSnapshot;
    };

export interface ResourceRecommendationItem {
  status: 'ready';
  resource: ResourceKey;
  baseline: number;
  planningRange: ResourcePlanningRange;
  inputReferences: ResourceInputReference[];
  assumptions: ResourceAssumption[];
  appliedRules: ResourceAppliedRule[];
  sourceSnapshots: ResourceSourceSnapshot[];
  authoritySource: ResourceAuthoritySource;
  confidence: ResourceConfidence;
  reviewingAuthority: AuthorityType;
  authorityReviewRequired: boolean;
}

export interface OrganizerResourceRecommendation {
  resourceId: string;
  revision: number;
  stage: 'provisional' | 'official';
  items: Record<ResourceKey, { baseline: number; planningRange: ResourcePlanningRange }>;
  disclaimer: string;
}

export type ResourceAssessmentReference =
  | {
      stage: 'provisional';
      assessmentId: string;
      proposalId: string;
    }
  | {
      stage: 'official';
      assessmentId: string;
      proposalId: string;
      sourceKind?: 'ai_authority';
      finalizedAt: number;
      finalizedBy: string;
    }
  | {
      stage: 'official';
      assessmentId: string;
      sourceKind: 'admin_manual';
      manualAssessmentId: string;
      finalizedAt: number;
      finalizedBy: string;
    };

interface ResourceRecommendationBase {
  resourceId: string;
  eventId: string;
  versionId: string;
  assessmentId: string;
  schemaVersion: typeof RESOURCE_SCHEMA_VERSION;
  revision: number;
  supersedesResourceId: string | null;
  resourceInputHash: string;
  formulaVersion: string;
  configVersion: string;
  sourceRegistryVersion: string;
  items: Record<ResourceKey, ResourceRecommendationItem>;
  confidenceLevel: ResourceConfidence;
  authorityReviewRequired: boolean;
  validationScope: 'provisional_risk_input' | 'official_risk_input_only';
  notes?: string;
  computedAt: number;
}

export type ResourceRecommendation = ResourceRecommendationBase & (
  | {
      stage: 'provisional';
      assessmentReference: Extract<ResourceAssessmentReference, { stage: 'provisional' }>;
    }
  | {
      stage: 'official';
      assessmentReference: Extract<ResourceAssessmentReference, { stage: 'official' }>;
    }
);

export type DecisionValue = 'Approved' | 'Rejected' | 'AmendmentRequested';

export interface AuthorityDecision {
  decisionId: string;
  eventId: string;
  versionId: string;
  authorityType: AuthorityType;
  decision: DecisionValue;
  rationale: string;
  suggestion?: string;
  materialsReviewed?: boolean;
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
  | 'assessment_schema_cutover'
  | 'resource_schema_cutover'
  | 'resource_recommended'
  | 'resource_overridden'
  | 'amendment_requested'
  | 'assignment_created'
  | 'authority_reviewed'
  | 'authority_score_reviewed'
  | 'authority_score_review_superseded'
  | 'score_conflict_detected'
  | 'score_conflict_resolved'
  | 'official_assessment_finalized'
  | 'official_finalization_failed'
  | 'manual_assessment_submitted'
  | 'manual_official_assessment_finalized'
  | 'manual_official_finalization_failed'
  | 'manual_official_finalization_retried'
  | 'decision_made'
  | 'public_published'
  | 'control_verified'
  | 'control_rejected'
  | 'assignment_revoked'
  | 'control_list_published'
  // M3 round N+1 (Workstream 3) — organizer Stage 1 upload
  | 'stage1_doc_submitted'
  // M3 round N+1 (Workstream 4) — Stage 2 + public flow
  | 'stage2_doc_submitted'
  | 'stage2_confirmed'
  | 'stage2_reported'
  // M3 round N+1 (Workstream 5) — admin publish gate
  | 'stage2_doc_published'
  | 'stage2_doc_rejected';

export type NotificationType =
  | 'decision_made'
  | 'application_approved'
  | 'application_rejected'
  | 'amendment_requested'
  | 'control_verified'
  | 'control_rejected'
  | 'control_list_published'
  // Q1 refactor: per-doc Stage 1 verification notifications
  | 'stage1_doc_approved'
  | 'stage1_doc_rejected'
  // M3 round N+1 (Workstream 3) — organizer Stage 1 upload
  | 'stage1_doc_submitted'
  // M3 round N+1 (Workstream 4) — Stage 2 public flow
  | 'stage2_doc_submitted'
  | 'stage2_reported'
  // M3 round N+1 (Workstream 5) — admin publish gate
  | 'stage2_doc_published'
  | 'stage2_doc_rejected';

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
  /**
   * FR-M3-08: rejection notifications must include the reason and
   * suggestion as separate, structured fields (not just concatenated
   * into the `message` string). Optional for legacy / non-rejection
   * notifications — old docs without these fields degrade gracefully.
   */
  reason?: string;
  suggestion?: string;
}

export type ControlVerificationStatus = 'verified' | 'rejected';

// Q1 refactor: the old `ControlVerification` standalone verification record
// is gone. Per-doc verification provenance now lives directly on the
// Stage1Doc (status, verifiedBy, verifiedAt, rejectionReason, filePath).

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
  active: boolean;
  name: string;
  address: string;
  capacity: number;
  location: VenueLocation;
  jurisdiction?: string;
  /** Malaysian state name (e.g. 'Selangor', 'Kuala Lumpur') for officer
   *  scope matching. Optional for legacy venues. */
  state?: string;
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
  ASSESSMENT_SUMMARIES: 'assessment_summaries',
  SCORE_REVIEWS: 'score_reviews',
  SCORE_RESOLUTIONS: 'score_resolutions',
  MANUAL_ASSESSMENTS: 'manual_assessments',
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
  // M3 round N+1 — workstream 1
  OFFICERS: 'officers',
  ASSIGNMENTS: 'assignments',
  STAGE1_DOCS: 'stage1_docs',
  STAGE2_DOCS: 'stage2_docs',
  // M3 round N+1 (Workstream 4) — per-user rate-limit counters
  // under each control. Server-only writes; client reads for the
  // UI to show "You confirmed" / "You reported" states.
  STAGE2_CONFIRMS: 'stage2_confirms',
  STAGE2_REPORTS: 'stage2_reports',
  PUBLIC_EVENT_CONTROLS: 'public_event_controls',
  PUBLIC_REPORTS: 'public_reports',
} as const;

export const CATEGORY_SCHEMA_VERSION = '2026-07-24-all-hazards-v2';
export const SCORING_LOGIC_VERSION = '2026-07-24-hirarc-residual-v2';
export const HARD_RULE_VERSION = '2026-08-18-hirarc-floor-v1';
export const PROVISIONAL_FORMULA_VERSION = '2026-08-18-weighted-safety-floor-v1';
export const CATEGORY_SCHEMA_STATUS: CategorySchemaStatus = 'prototype';

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

// =====================================================================
// M3 (Authority Approval and Notification) — round N+1
// Officer profile + Event Control (Stage 1 / Stage 2) canonical shapes.
// See docs/team-handoffs/M3_INTEGRATION_CONTRACT.md.
// =====================================================================

/** Officer profile — top-level `officers/{uid}` collection (parallel to
 *  `users/{uid}`). Only users with `role: 'authority'` get one. The
 *  existence of this doc signals "this user is a real authority officer
 *  available for assignment". `workloadCount` is the live count of open
 *  assignments; the default-check picks the lowest-workload officer
 *  per `authorityType` (locked assumption A4). */
export interface OfficerProfile {
  uid: string;                 // = the auth UID, also the doc id
  authorityType: AuthorityType;
  /** Malaysian state (e.g. 'Selangor', 'Kuala Lumpur'). Used for
   *  state-scoped officer matching against `eventDetails.venue.state`. */
  state: string;
  /** 'state' = only assigned when venue.state matches;
   *  'federal' = always default-checked. */
  scopeType: 'state' | 'federal';
  /** Live count of open assignments. Updated by the assignment Cloud
   *  Function. Sorted ascending by the default-check. */
  workloadCount: number;
  /** Soft cap. The default-check skips officers at or above this count
   *  unless there's no other option. */
  workloadLimit: number;
  /** Last assignment timestamp (ms). Tiebreaker for the default-check. */
  lastAssignedAt?: number;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Stage 1 control documentation — sub-collection of a control item. */
export interface Stage1Doc {
  docId: string;
  docType: 'receipt' | 'application' | 'floor_plan' | 'license' | 'insurance' | 'other';
  label: string;
  uploadedAt?: number;
  uploadedBy?: string;
  /** Storage path or external URL to the uploaded file. */
  filePath?: string;
  status: 'pending_submission' | 'pending_verification' | 'verified' | 'rejected' | 'use_previous';
  /** If `status: 'use_previous'`, the source event this reuses from.
   *  Per the locked decision, "Use Previous" is unconditional (no A26
   *  gate). */
  usePreviousSourceEventId?: string;
  verifiedBy?: string;
  verifiedAt?: number;
  rejectionReason?: string;
  rejectionSuggestion?: string;
}

/** Stage 2 control documentation (visual evidence). */
export interface Stage2Doc {
  docId: string;
  imageUrl: string;
  uploadedAt: number;
  uploadedBy: string;
  publicConfirmCount: number;
  reportedAt?: number;
  m4TicketId?: string;
  published: boolean;
  publishedAt?: number;
  publishedBy?: string;
  /** Workstream 5 — set when an admin rejects the image pre-publish. */
  rejectionReason?: string;
  rejectionAt?: number;
  rejectedBy?: string;
}

/** Full Event Control canonical shape — replaces the flat `event_controls`
 *  doc with a sub-collection layout (FR-M3-22..29, Q1 refactor). */
export interface EventControl {
  controlId: string;
  eventId: string;
  versionId: string;
  controlName: string;
  authority: AuthorityType;
  stageRequirement: 'stage1_only' | 'stage1_and_stage2';
  /** Default Stage 1 requirements generated by M2's `proposeEventControlList`
   *  (or the M3 stub). Organiser uploads or marks as Use Previous. */
  stage1Requirements: Array<{ docType: Stage1Doc['docType']; label: string; required: boolean }>;
  stage2Requirement: { kind: 'image'; label: string } | null;
  /** Bumped on every resubmission so the audit trail is per-version. */
  controlItemVersion: number;
  /** Audit-only: if the last Stage 1 doc was a Use Previous, the event
   *  id it reused from. */
  usePreviousSourceEventId?: string;
  /** Aggregate across the control's Stage 1 docs. */
  label: 'approved' | 'pending' | 'reported_under_review' | 'resubmit_required';
  labelAddedAt?: number;
  labelRemovedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** Outcome of a Stage 1 verification (officer's per-doc decision). */
export interface Stage1Verification {
  /** Composite ID = `${versionId}_${controlId}_${docId}_${authorityType}`. */
  verificationId: string;
  eventId: string;
  versionId: string;
  controlId: string;
  docId: string;
  authorityType: AuthorityType;
  reviewerUid: string;
  status: 'verified' | 'rejected';
  rationale: string;
  evidencePath?: string;
  evidenceFile?: { name: string; sizeBytes: number; mimeType: string };
  createdAt: number;
}

/** Officer assignment to an event version. Doc id = `${versionId}_${authorityType}`
 *  (one assignment per authority per version). Created by `assignAuthorityOfficers`;
 *  consumed by `recordOfficerProposal`. */
export interface Assignment {
  assignmentId: string;
  eventId: string;
  versionId: string;
  authorityType: AuthorityType;
  officerUid: string;
  assignedBy: string;
  assignedAt: number;
  status: 'pending' | 'in_progress' | 'completed' | 'revoked';
  decision?: DecisionValue;
  reason?: string;
  suggestion?: string;
  decidedAt?: number;
  revokedAt?: number;
  revokedBy?: string;
}

/** Public report of an inaccurate Stage 2 image. M3 writes the doc when
 *  a public viewer reports; M4 updates `outcome` after investigation.
 *  M3 listens (Q4) and updates the control's `label` via the
 *  `onM4ReportOutcome` trigger. */
export interface PublicReport {
  ticketId: string;
  eventId: string;
  controlId: string;
  docId: string;
  reporterUid: string;
  category: string;
  description: string;
  evidencePaths?: string[];
  outcome?: 'confirmed_true' | 'dismissed_fake' | 'under_review';
  outcomeNotes?: string;
  outcomeSetBy?: string;
  outcomeSetAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** Proposed event-control list shape — what M2's `proposeEventControlList`
 *  callable returns. The M3 stub returns a hardcoded version of this
 *  (one item per required authority). */
export interface ProposedControlItem {
  controlName: string;
  authority: AuthorityType;
  stageRequirement: 'stage1_only' | 'stage1_and_stage2';
  stage1Requirements: Array<{ docType: Stage1Doc['docType']; label: string; required: boolean }>;
  stage2Requirement: { kind: 'image'; label: string } | null;
}
