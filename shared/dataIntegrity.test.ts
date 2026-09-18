import { describe, expect, it } from 'vitest';
import { compareIntegrityFindings, hasIntegrityErrors, type IntegrityAuditReport } from './dataIntegrity';

describe('data integrity contracts', () => {
  it('sorts findings by severity, code, and document path', () => {
    const findings = [
      { findingId: '3', code: 'z', severity: 'warning' as const, documentPath: 'events/b', relatedPaths: [], beforeHash: 'b', summary: 'b' },
      { findingId: '2', code: 'a', severity: 'critical' as const, documentPath: 'events/z', relatedPaths: [], beforeHash: 'z', summary: 'z' },
      { findingId: '1', code: 'a', severity: 'error' as const, documentPath: 'events/a', relatedPaths: [], beforeHash: 'a', summary: 'a' },
    ];
    expect([...findings].sort(compareIntegrityFindings).map((finding) => finding.findingId)).toEqual(['2', '1', '3']);
  });

  it('detects error and critical findings without treating warnings as failures', () => {
    const report: IntegrityAuditReport = {
      auditRunId: 'audit-1', projectId: 'steras-test', generatedAt: new Date(0).toISOString(),
      scannedDocuments: 0, scannedStorageObjects: 0, collectionCounts: [],
      findings: [{ findingId: '1', code: 'legacy_source_marker', severity: 'warning', documentPath: 'events/a', relatedPaths: [], beforeHash: 'a', summary: 'legacy' }],
    };
    expect(hasIntegrityErrors(report)).toBe(false);
    expect(hasIntegrityErrors({ ...report, findings: [{ ...report.findings[0], severity: 'error' }] })).toBe(true);
  });
});
