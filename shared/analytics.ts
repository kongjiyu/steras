import type {
  AIStatus,
  AssessmentReadiness,
  AssessmentStatus,
  AuthorityType,
  ComplianceStatus,
  ConfidenceLevel,
  EventStatus,
  EventType,
  HazardDomain,
  RejectionReasonCategory,
  ResourceKey,
  ResourceOverrideReasonCategory,
  RiskLevel,
} from './types';

export const ANALYTICS_SCHEMA_VERSION = '2026-09-03-m5-v3';
export const ANALYTICS_METRIC_DEFINITION_VERSION = '2026-09-03-m5-metrics-v3';

export type AnalyticsCoverageStatus = 'complete' | 'truncated' | 'unavailable';

export interface AnalyticsAvailabilityCount {
  available: boolean;
  count?: number;
}

export interface AnalyticsPortfolioRequest {
  from?: number;
  to?: number;
  eventTypes?: EventType[];
  statuses?: EventStatus[];
  venueIds?: string[];
  riskLevels?: RiskLevel[];
  authorityTypes?: AuthorityType[];
  assessmentSchemaVersions?: string[];
  includeSynthetic?: boolean;
  limit?: number;
}

export interface AnalyticsAssessmentSummary {
  status: AssessmentStatus;
  officialScore?: number;
  officialRiskLevel?: RiskLevel;
  readiness: AssessmentReadiness;
  compliance: ComplianceStatus;
  confidence: ConfidenceLevel;
  dominantHazard?: HazardDomain;
  identifiedHazardCategories: HazardDomain[];
  schemaVersion: string;
  categorySchemaVersion?: string;
  formulaVersion?: string;
  hardRuleVersion?: string;
  aiStatus: AIStatus | 'not_attempted';
  aiAgreement?: boolean;
  hardRuleAdjustments: number;
  manualReview: boolean;
}

export interface AnalyticsResourceItemSummary {
  baseline: number;
  minimum: number;
  maximum: number;
  effective?: number;
  overrideCount: number;
  overrideReasonCategories: Partial<Record<ResourceOverrideReasonCategory, number>>;
}

export interface AnalyticsResourceSummary {
  schemaVersion: string;
  formulaVersion: string;
  items: Partial<Record<ResourceKey, AnalyticsResourceItemSummary>>;
  overrideCount: number;
  /** Privacy-safe predefined categories only; free-text rationale is never exposed. */
  overrideReasonCategoriesAvailable: boolean;
  overrideReasonCategories: Partial<Record<ResourceOverrideReasonCategory, number>>;
}

export interface AnalyticsIncidentSummary {
  available: boolean;
  total: number;
  verified: number;
  severityAvailable: boolean;
  bySeverity: Record<'low' | 'medium' | 'high', number>;
  byStatus: Record<'verified' | 'under_review' | 'rejected' | 'unknown', number>;
  immediateActionRequired: AnalyticsAvailabilityCount;
  externalEscalations: AnalyticsAvailabilityCount;
}

export interface AnalyticsControlSummary {
  available: boolean;
  total: number;
  approved: number;
  pending: number;
  reportedUnderReview: number;
  resubmitRequired: number;
  usePrevious: number;
  stage1: {
    available: boolean;
    total: number;
    pendingSubmission: number;
    pendingVerification: number;
    verified: number;
    rejected: number;
    usePrevious: number;
  };
}

export interface AnalyticsLifecycleSummary {
  initialReviewAt?: number;
  authorityReviewAt?: number;
  secondReviewAt?: number;
  submissionToInitialReviewMs?: number;
  initialToAuthorityReviewMs?: number;
  authorityToSecondReviewMs?: number;
  submissionToTerminalDecisionMs?: number;
}

export interface AnalyticsRecordSourceCoverage {
  overrides: AnalyticsCoverageStatus;
  incidents: AnalyticsCoverageStatus;
  controls: AnalyticsCoverageStatus;
  decisionHistory: AnalyticsCoverageStatus;
  assignments: AnalyticsCoverageStatus;
  reviewDecisions: AnalyticsCoverageStatus;
  currentVersion: AnalyticsCoverageStatus;
  stage1Documents: AnalyticsCoverageStatus;
}

export type AnalyticsReviewStage = 'initial' | 'authority' | 'second';

export interface AnalyticsRejectionSummary {
  reasonCategory: RejectionReasonCategory;
  reviewStage: AnalyticsReviewStage;
}

export type AnalyticsRevisionOutcome =
  | 'initial_submission'
  | 'resubmitted_after_rejection'
  | 'revised_without_recorded_rejection'
  | 'unavailable';

export interface AnalyticsPortfolioRecord {
  eventId: string;
  eventName: string;
  eventType: EventType;
  venueId?: string;
  venueName: string;
  status: EventStatus;
  requiredAuthorities: AuthorityType[];
  currentVersionNumber: number;
  createdAt: number;
  submittedAt?: number;
  terminalDecisionAt?: number;
  updatedAt: number;
  lifecycle: AnalyticsLifecycleSummary;
  sourceCoverage: AnalyticsRecordSourceCoverage;
  synthetic: boolean;
  reapplication: boolean;
  revisionOutcome: AnalyticsRevisionOutcome;
  rejectionTaxonomyAvailable: boolean;
  rejections: AnalyticsRejectionSummary[];
  assessment?: AnalyticsAssessmentSummary;
  resources?: AnalyticsResourceSummary;
  incidents: AnalyticsIncidentSummary;
  controls: AnalyticsControlSummary;
}

export interface AnalyticsPortfolioResponse {
  schemaVersion: typeof ANALYTICS_SCHEMA_VERSION;
  metricDefinitionVersion: typeof ANALYTICS_METRIC_DEFINITION_VERSION;
  generatedAt: number;
  sourceCutoff: number;
  records: AnalyticsPortfolioRecord[];
  totalMatched: number;
  syntheticExcluded: number;
  truncated: boolean;
  unavailableSections: string[];
  coverage: {
    eventScan: Exclude<AnalyticsCoverageStatus, 'unavailable'>;
    childCollections: AnalyticsCoverageStatus;
    totalMatchedExact: boolean;
    limitations: string[];
  };
}
