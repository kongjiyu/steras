import { describe, expect, it } from 'vitest';
import { __testOnly } from './auditFirestoreIntegrity';

describe('auditFirestoreIntegrity helpers', () => {
  it('produces stable finding IDs independent of related-path order', () => {
    expect(__testOnly.findingId('orphan_incident_event', 'incidents/i1', ['events/e1', 'historical_events/h1']))
      .toBe(__testOnly.findingId('orphan_incident_event', 'incidents/i1', ['historical_events/h1', 'events/e1']));
  });

  it('hashes normalized objects deterministically', () => {
    expect(__testOnly.hash({ b: 2, a: 1 })).toBe(__testOnly.hash({ a: 1, b: 2 }));
    expect(__testOnly.hash({ a: 1 })).not.toBe(__testOnly.hash({ a: 2 }));
  });

  it('renders a redacted report without document field values', () => {
    const output = __testOnly.markdown({
      auditRunId: 'audit-1', projectId: 'steras-test', generatedAt: new Date(0).toISOString(),
      scannedDocuments: 1, scannedStorageObjects: 0, collectionCounts: [{ collection: 'events', documents: 1 }],
      findings: [{ findingId: 'f1', code: 'orphan_incident_event', severity: 'critical', documentPath: 'incidents/i1', relatedPaths: ['events/e1'], beforeHash: 'hash', summary: 'Incident has no resolvable application or historical occurrence.' }],
    });
    expect(output).toContain('orphan_incident_event');
    expect(output).not.toContain('email');
    expect(output).not.toContain('phone');
  });
});
