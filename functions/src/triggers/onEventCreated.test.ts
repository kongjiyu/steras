import { describe, expect, it } from 'vitest';
import { latestValidHistoricalResource, nextResourceRevision, resourceDocumentId } from './onEventCreated';
import { RESOURCE_KEYS, RESOURCE_SCHEMA_VERSION, ResourceRecommendation } from '@shared/types';

describe('resource pipeline identity and revision helpers', () => {
  it('uses stage, version and the complete input hash in deterministic IDs', () => {
    const hash = 'a'.repeat(64);
    expect(resourceDocumentId('provisional', 'v1', hash)).toBe(`provisional-v1-${hash}`);
    expect(resourceDocumentId('provisional', 'v1', hash)).toBe(resourceDocumentId('provisional', 'v1', hash));
    expect(resourceDocumentId('official', 'v1', hash)).not.toBe(resourceDocumentId('provisional', 'v1', hash));
  });

  it('creates an append-only revision link without mutating the predecessor', () => {
    const previous = { resourceId: 'provisional-v1-old', revision: 3 };
    const snapshot = structuredClone(previous);
    expect(nextResourceRevision(previous)).toEqual({ revision: 4, supersedesResourceId: previous.resourceId });
    expect(previous).toEqual(snapshot);
    expect(nextResourceRevision()).toEqual({ revision: 1, supersedesResourceId: null });
    expect(() => nextResourceRevision({ resourceId: 'exhausted', revision: Number.MAX_SAFE_INTEGER })).toThrow();
  });

  it('recovers the latest valid predecessor when a failed run cleared the pointer', () => {
    const older = recommendation('old', 1, 10);
    const latest = recommendation('latest', 2, 20);
    expect(latestValidHistoricalResource([older, { ...latest, schemaVersion: 'legacy' }, latest])?.resourceId).toBe(latest.resourceId);
    expect(latestValidHistoricalResource(undefined)).toBeUndefined();
  });
});

function recommendation(_label: string, revision: number, computedAt: number): ResourceRecommendation {
  const resourceInputHash = (revision === 1 ? 'a' : 'b').repeat(64);
  const resourceId = `provisional-v1-${resourceInputHash}`;
  const source = {
    sourceId: 'internal.test', title: 'Test', issuer: 'STERAS', kind: 'internal_prototype' as const,
    locator: 'test', version: 'v1', retrievedAt: 1, verificationStatus: 'prototype_unverified' as const,
  };
  const items = Object.fromEntries(RESOURCE_KEYS.map((resource) => [resource, {
    status: 'ready' as const, resource, baseline: 1, planningRange: { min: 1, max: 2 },
    inputReferences: [{ inputId: 'attendance', kind: 'event_field' as const, path: 'attendance', value: 100 }],
    assumptions: [{ assumptionId: `${resource}.assumption`, statement: 'Test', sourceIds: [source.sourceId] }],
    appliedRules: [{ ruleId: `${resource}.rule`, description: 'Test', inputReferenceIds: ['attendance'], sourceIds: [source.sourceId], contribution: 1 }],
    sourceSnapshots: [source], authoritySource: { status: 'not_supplied' as const, reason: 'Prototype.' },
    confidence: 'prototype' as const, reviewingAuthority: 'PDRM' as const, authorityReviewRequired: true,
  }])) as ResourceRecommendation['items'];
  return {
    resourceId, eventId: 'event-1', versionId: 'v1', assessmentId: 'v1', schemaVersion: RESOURCE_SCHEMA_VERSION,
    stage: 'provisional', revision, supersedesResourceId: revision === 1 ? null : `provisional-v1-${'a'.repeat(64)}`,
    assessmentReference: { stage: 'provisional', assessmentId: 'v1', proposalId: 'proposal-1' },
    resourceInputHash, formulaVersion: 'formula', configVersion: 'config', sourceRegistryVersion: 'sources',
    items, confidenceLevel: 'prototype', authorityReviewRequired: true, computedAt,
  };
}
