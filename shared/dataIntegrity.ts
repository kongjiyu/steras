export type IntegritySeverity = 'info' | 'warning' | 'error' | 'critical';

export type IntegrityVisibility = 'private' | 'public';

export type IntegrityVerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export interface IntegrityFinding {
  findingId: string;
  code: string;
  severity: IntegritySeverity;
  documentPath: string;
  relatedPaths: string[];
  beforeHash: string;
  summary: string;
  proposedAction?: string;
}

export interface IntegrityCollectionCount {
  collection: string;
  documents: number;
}

export interface IntegrityAuditReport {
  auditRunId: string;
  projectId: string;
  generatedAt: string;
  scannedDocuments: number;
  scannedStorageObjects: number;
  collectionCounts: IntegrityCollectionCount[];
  /** Counts for every visited collection path, including event subcollections. */
  collectionDocumentCounts?: IntegrityCollectionCount[];
  findings: IntegrityFinding[];
}

export interface IntegrityRepairApproval {
  manifestId?: string;
  projectId?: string;
  auditRunId?: string;
  actionId?: string;
  findingId: string;
  documentPath: string;
  expectedBeforeHash: string;
  approvedAction: string;
  approvedBy: string;
  approvedAt: string;
}

export type IntegrityRepairOperation =
  | 'quarantine_public_projection'
  | 'create_historical_occurrence'
  | 'migrate_legacy_metadata'
  | 'migrate_identifier'
  | 'manual_review';

export interface IntegrityRepairAction {
  actionId: string;
  findingId: string;
  operation: IntegrityRepairOperation;
  documentPath: string;
  relatedPaths: string[];
  expectedBeforeHash: string;
  reason: string;
  destructive: boolean;
  status: 'proposed' | 'approved' | 'applied' | 'skipped';
}

export interface IntegrityRepairManifest {
  manifestId: string;
  projectId: string;
  auditRunId: string;
  generatedAt: string;
  expectedReportGeneratedAt: string;
  actions: IntegrityRepairAction[];
}

export interface GovernanceRecord {
  sourcePath: string;
  sourceBatchId?: string;
  verificationStatus: IntegrityVerificationStatus;
  visibility: IntegrityVisibility;
  originalId?: string;
  replacementId?: string;
  verifiedBy?: string;
  verifiedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface HistoricalEventOccurrence {
  historicalEventId: string;
  sourceEventKey: string;
  sourceIncidentId: string;
  eventName: string;
  eventType: string;
  venueId?: string;
  organizerId?: string;
  occurredAt: number;
  sourceVersionId?: string;
  visibility: IntegrityVisibility;
  source: 'legacy_incident_import';
  createdAt: number;
  updatedAt: number;
}

/** Incident references remain compatible with legacy eventId fields while
 * allowing historical occurrences that are not permit applications. */
export type EventReference =
  | { kind: 'application'; eventId: string; versionId?: string }
  | { kind: 'historical_occurrence'; historicalEventId: string; legacyEventKey?: string };

export const GOVERNANCE_COLLECTION = 'data_governance_records' as const;
export const HISTORICAL_OCCURRENCES_COLLECTION = 'historical_events' as const;

export const LEGACY_SOURCE_FIELDS = [
  'sterasTest',
  'sterasFixture',
  'presentationData',
  'reportingData',
  'synthetic',
  '_fixtureVersion',
  '_fixtureAssignments',
] as const;

export const INTEGRITY_ERROR_SEVERITIES = new Set<IntegritySeverity>(['error', 'critical']);

export function integrityFindingSortKey(finding: Pick<IntegrityFinding, 'severity' | 'code' | 'documentPath'>): string {
  const rank: Record<IntegritySeverity, number> = { critical: 0, error: 1, warning: 2, info: 3 };
  return `${rank[finding.severity]}:${finding.code}:${finding.documentPath}`;
}

export function compareIntegrityFindings(a: IntegrityFinding, b: IntegrityFinding): number {
  return integrityFindingSortKey(a).localeCompare(integrityFindingSortKey(b));
}

export function hasIntegrityErrors(report: Pick<IntegrityAuditReport, 'findings'>): boolean {
  return report.findings.some((finding) => INTEGRITY_ERROR_SEVERITIES.has(finding.severity));
}
