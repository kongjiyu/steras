import { describe, expect, it } from 'vitest';
import { buildRepairManifest, __testOnly } from './prepareIntegrityRepairManifest';

describe('prepareIntegrityRepairManifest', () => {
  it('maps findings to explicit, approval-gated operations', () => {
    const manifest = buildRepairManifest({
      auditRunId: 'audit-1', projectId: 'linkos-496505', generatedAt: '2026-09-19T00:00:00.000Z',
      scannedDocuments: 2, scannedStorageObjects: 1, collectionCounts: [],
      findings: [
        { findingId: 'f1', code: 'orphan_incident_event', severity: 'critical', documentPath: 'incidents/i1', relatedPaths: [], beforeHash: 'h1', summary: 'orphan' },
        { findingId: 'f2', code: 'legacy_source_marker', severity: 'warning', documentPath: 'events/e1', relatedPaths: [], beforeHash: 'h2', summary: 'marker' },
        { findingId: 'f3', code: 'review_without_active_assignment', severity: 'error', documentPath: 'events/e2', relatedPaths: [], beforeHash: 'h3', summary: 'review' },
      ],
    });
    expect(manifest.projectId).toBe('linkos-496505');
    expect(manifest.actions.map((action) => action.operation)).toEqual(['create_historical_occurrence', 'migrate_legacy_metadata', 'manual_review']);
    expect(manifest.actions.every((action) => action.status === 'proposed')).toBe(true);
    expect(manifest.actions.every((action) => action.expectedBeforeHash.length > 0)).toBe(true);
  });

  it('keeps action IDs deterministic', () => {
    expect(__testOnly.actionId('f1', 'manual_review')).toBe(__testOnly.actionId('f1', 'manual_review'));
    expect(__testOnly.actionId('f1', 'manual_review')).not.toBe(__testOnly.actionId('f1', 'migrate_identifier'));
    expect(__testOnly.operationForCode('storage_legacy_source_marker')).toBe('manual_review');
  });
});
