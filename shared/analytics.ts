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
  ResourceKey,
  RiskLevel,
} from './types';

export const ANALYTICS_SCHEMA_VERSION = '2026-08-29-m5-v1';
export const ANALYTICS_METRIC_DEFINITION_VERSION = '2026-08-29-m5-metrics-v1';

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
  effective: number;
  overrideCount: number;
}

export interface AnalyticsResourceSummary {
  schemaVersion: string;
  formulaVersion: string;
  items: Partial<Record<ResourceKey, AnalyticsResourceItemSummary>>;
  overrideCount: number;
}

export interface AnalyticsIncidentSummary {
  available: boolean;
  total: number;
  verified: number;
  bySeverity: Record<'low' | 'medium' | 'high', number>;
  byStatus: Record<'verified' | 'under_review' | 'rejected' | 'unknown', number>;
}

export interface AnalyticsControlSummary {
  available: boolean;
  total: number;
  approved: number;
  pending: number;
  reportedUnderReview: number;
  resubmitRequired: number;
  usePrevious: number;
}

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
  synthetic: boolean;
  reapplication: boolean;
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
}
