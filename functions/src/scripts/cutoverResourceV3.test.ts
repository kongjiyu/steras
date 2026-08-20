import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASSESSMENT_SCHEMA_VERSION,
  EventVersion,
  HARD_RULE_VERSION,
  PROVISIONAL_FORMULA_VERSION,
  RESOURCE_KEYS,
  RESOURCE_SCHEMA_VERSION,
  ResourceRecommendation,
  ProvisionalRiskAssessment,
} from '@shared/types';
import { ACTIVE_CATEGORY_SCHEMA } from '../config/categorySchema';
import { computeResources } from '../engines/resourceCalculator';
import { encodeFirestoreValue } from './firestoreBackupCodec';
import {
  assertSafeResourceCutoverApply,
  backupChecksumFor,
  classifyResourceCutoverState,
  parseResourceCutoverArguments,
  RESOURCE_CUTOVER_PROJECT,
  ResourceCutoverBackup,
  shouldAbortResourceCutover,
  validateOrganizerResourceProjection,
  validateCurrentResourceTip,
  validateDecodedRestoreRelationships,
  validateResourceAgainstStoredInputs,
  validateResourceCutoverBackup,
  validateResourceDocumentIdentity,
  validateResourceCutoverOptions,
  validateResourceRevisionGraph,
} from './cutoverResourceV3';

describe('resource V3 cutover safety', () => {
  it('defaults to a non-destructive plan', () => {
    const options = parseResourceCutoverArguments(['--project', RESOURCE_CUTOVER_PROJECT]);
    expect(options.mode).toBe('plan');
    expect(() => validateResourceCutoverOptions(options)).not.toThrow();
  });

  it('requires the fixed project and exact destructive confirmation', () => {
    expect(() => validateResourceCutoverOptions(parseResourceCutoverArguments(['--project', 'wrong']))).toThrow('--project must equal');
    expect(() => validateResourceCutoverOptions(parseResourceCutoverArguments([
      '--project', RESOURCE_CUTOVER_PROJECT, '--mode', 'apply',
    ]))).toThrow('--confirm');
  });

  it('canonicalizes relative backup paths and rejects noncanonical direct options', () => {
    const parsed = parseResourceCutoverArguments([
      '--project', RESOURCE_CUTOVER_PROJECT, '--mode', 'restore', '--confirm', RESOURCE_CUTOVER_PROJECT, '--backup', 'relative.json',
      '--checksum', 'a'.repeat(64), '--backup-dir', './relative-backups',
    ]);
    expect(parsed.backupPath).toBe(path.resolve('relative.json'));
    expect(parsed.backupDirectory).toBe(path.resolve('./relative-backups'));
    expect(() => validateResourceCutoverOptions(parsed)).not.toThrow();
    expect(() => validateResourceCutoverOptions({ ...parsed, backupDirectory: './relative-backups' })).toThrow('canonical absolute');
  });

  it('requires a separately supplied audit checksum for restore', () => {
    expect(() => validateResourceCutoverOptions(parseResourceCutoverArguments([
      '--project', RESOURCE_CUTOVER_PROJECT, '--mode', 'restore', '--confirm', RESOURCE_CUTOVER_PROJECT,
      '--backup', '/tmp/backup.json',
    ]))).toThrow('--checksum');
    expect(() => validateResourceCutoverOptions(parseResourceCutoverArguments([
      '--project', RESOURCE_CUTOVER_PROJECT, '--mode', 'restore', '--confirm', RESOURCE_CUTOVER_PROJECT,
      '--backup', '/tmp/backup.json', '--checksum', 'a'.repeat(64),
    ]))).not.toThrow();
    expect(backupChecksumFor('backup')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps isolated backfill failures nonfatal while structural verification failures stop cutover', () => {
    expect(shouldAbortResourceCutover([])).toBe(false);
    expect(shouldAbortResourceCutover(['event-1:dangling-current-pointer'])).toBe(true);
  });

  it('detects dangling and cyclic revision chains', () => {
    expect(validateResourceRevisionGraph([resource('one', null), resource('two', 'one')])).toEqual([]);
    expect(validateResourceRevisionGraph([resource('one', 'missing')])).toContain('one:dangling-predecessor');
    expect(validateResourceRevisionGraph([resource('one', 'two'), resource('two', 'one')])).toContain('one:cycle');
    expect(validateResourceRevisionGraph([resource('one', null), resource('root-two', null)])).toContain('v1:provisional:multiple-roots');
  });

  it('rejects branched, duplicate and noncontiguous revisions and a stale current tip', () => {
    const root = resource('root', null, 1);
    const second = resource('second', 'root', 2);
    const branch = resource('branch', 'root', 2);
    expect(validateResourceRevisionGraph([root, second, branch])).toEqual(expect.arrayContaining([
      'root:branched-successors', 'v1:provisional:duplicate-revision',
    ]));
    expect(validateResourceRevisionGraph([root, resource('third', 'root', 3)])).toEqual(expect.arrayContaining([
      'v1:provisional:noncontiguous-revisions', 'third:noncontiguous-predecessor',
    ]));
    expect(validateCurrentResourceTip([root, second], 'root')).toContain('current-pointer-not-tip');
    expect(validateCurrentResourceTip([root, second], 'second')).toEqual([]);
  });

  it('rejects arbitrary or malformed backup paths before restore', () => {
    const backup = validBackup() as unknown as ResourceCutoverBackup;
    expect(() => validateResourceCutoverBackup(backup)).not.toThrow();
    expect(() => validateResourceCutoverBackup({
      ...backup,
      resources: [{ path: 'users/admin', data: encodeFirestoreValue({ resourceId: 'hostile' }) }],
    })).toThrow('outside the allowed resources scope');
    expect(() => validateResourceCutoverBackup({
      ...backup,
      manifest: { ...backup.manifest, eventPaths: ['events/another-event'] },
    })).toThrow('manifest event scope');
    expect(() => validateResourceCutoverBackup({
      ...backup,
      auditReferences: [{
        path: 'events/event-1/audit_logs/decision-1',
        data: encodeFirestoreValue({ action: 'decision_made' }),
      }],
    })).toThrow('managed resource action scope');
    expect(() => validateResourceCutoverBackup({ ...backup, unexpected: true })).toThrow('unknown top-level');
  });

  it('deletes only legacy resources and fails closed for mixed, rerun, or invalid V3 state', () => {
    const legacy = { path: 'events/event-1/resources/legacy', data: { resourceId: 'legacy' } };
    const { recommendation } = storedInputs();
    const v3 = { path: `events/event-1/resources/${recommendation.resourceId}`, data: recommendation };
    const legacyOnly = classifyResourceCutoverState([legacy], [{ eventPath: 'events/event-1', currentResourceId: 'legacy' }]);
    expect(legacyOnly).toMatchObject({ state: 'legacy_only', legacyPaths: [legacy.path], v3Resources: [] });
    expect(() => assertSafeResourceCutoverApply(legacyOnly)).not.toThrow();
    const mixed = classifyResourceCutoverState([legacy, v3], [{ eventPath: 'events/event-1', currentResourceId: recommendation.resourceId }]);
    expect(mixed.state).toBe('mixed');
    expect(() => assertSafeResourceCutoverApply(mixed)).toThrow('mixed legacy/V3');
    const rerun = classifyResourceCutoverState([v3], [{ eventPath: 'events/event-1', currentResourceId: recommendation.resourceId }]);
    expect(rerun.state).toBe('v3_only');
    expect(() => assertSafeResourceCutoverApply(rerun)).toThrow('already exist');
    const corrupt = classifyResourceCutoverState([
      { ...v3, data: { ...recommendation, resourceInputHash: 'f'.repeat(64) } },
    ], [{ eventPath: 'events/event-1', currentResourceId: recommendation.resourceId }]);
    expect(corrupt.state).toBe('invalid_v3');
    expect(() => assertSafeResourceCutoverApply(corrupt)).toThrow('stored V3 resources are invalid');
  });

  it('rejects decoded pointer and projection relationships before restore mutation', () => {
    const backup = validBackup() as unknown as ResourceCutoverBackup;
    backup.summaries = [{
      path: 'events/event-1/assessment_summaries/v1',
      data: encodeFirestoreValue({ resourceRecommendation: { resourceId: 'missing-resource' } }),
    }];
    const validated = validateResourceCutoverBackup(backup);
    expect(validateDecodedRestoreRelationships(validated, [
      { path: 'events/event-1/resources/resource-1', decoded: { resourceId: 'resource-1' } },
      {
        path: 'events/event-1/assessment_summaries/v1',
        decoded: { resourceRecommendation: { resourceId: 'missing-resource' } },
      },
    ])).toContain('events/event-1/assessment_summaries/v1:summary-resource-missing');
    expect(validateDecodedRestoreRelationships(validated, [{
      path: 'events/event-1/resources/resource-1', decoded: { resourceId: 'legacy-alias' },
    }])).toContain('events/event-1/resources/resource-1:resource-document-id-mismatch');
  });

  it('binds verified cutover resources to the stored assessment, version, hash and items', () => {
    const { version, assessment, recommendation } = storedInputs();
    expect(validateResourceAgainstStoredInputs(recommendation, 'event-1', version, assessment)).toEqual([]);
    expect(validateResourceAgainstStoredInputs(
      { ...recommendation, resourceInputHash: 'f'.repeat(64) }, 'event-1', version, assessment,
    )).toContain('recomputed-hash-mismatch');
    expect(validateResourceAgainstStoredInputs(
      {
        ...recommendation,
        stage: 'provisional',
        assessmentReference: { stage: 'provisional', assessmentId: recommendation.assessmentId, proposalId: 'wrong' },
      },
      'event-1', version, assessment,
    )).toContain('assessment-reference-mismatch');
    expect(validateResourceAgainstStoredInputs(recommendation, 'event-1', version, {
      ...assessment, schemaVersion: 'legacy',
    } as unknown as ProvisionalRiskAssessment)).toContain('stored-assessment-mismatch');
  });

  it('binds the pointer identity to the physical document and deterministic hash ID', () => {
    const canonical = resource(`provisional-v1-${'a'.repeat(64)}`, null);
    canonical.resourceInputHash = 'a'.repeat(64);
    expect(validateResourceDocumentIdentity(canonical.resourceId, canonical)).toEqual([]);
    expect(validateResourceDocumentIdentity('wrong-document', canonical)).toContain('resource-document-identity');
    expect(validateResourceDocumentIdentity(canonical.resourceId, { ...canonical, resourceId: 'embedded-alias' })).toContain('resource-document-identity');
  });

  it('detects organizer projection drift from the canonical resource', () => {
    const canonical = resource('one', null);
    canonical.revision = 1;
    canonical.stage = 'provisional';
    for (const key of RESOURCE_KEYS) canonical.items[key] = {
      ...canonical.items[key], baseline: 2, planningRange: { min: 2, max: 3 },
    };
    const quantities = Object.fromEntries(RESOURCE_KEYS.map((key) => [key, 2]));
    const items = Object.fromEntries(RESOURCE_KEYS.map((key) => [key, { baseline: 2, planningRange: { min: 2, max: 3 } }]));
    const summary = { resourceQuantities: quantities, resourceRecommendation: { resourceId: 'one', revision: 1, stage: 'provisional', items, disclaimer: 'Prototype.' } };
    expect(validateOrganizerResourceProjection(canonical, summary)).toEqual([]);
    (summary.resourceRecommendation.items.police as { baseline: number }).baseline = 9;
    expect(validateOrganizerResourceProjection(canonical, summary)).toContain('summary-police-mismatch');
  });
});

function resource(resourceId: string, supersedesResourceId: string | null, revisionOverride?: number): ResourceRecommendation {
  const items = Object.fromEntries(RESOURCE_KEYS.map((key) => [key, { resource: key }])) as ResourceRecommendation['items'];
  const revision = revisionOverride ?? (resourceId === 'two' ? 2 : 1);
  return {
    resourceId, supersedesResourceId, schemaVersion: RESOURCE_SCHEMA_VERSION, versionId: 'v1', stage: 'provisional',
    resourceInputHash: 'a'.repeat(64), revision, items,
  } as ResourceRecommendation;
}

function validBackup() {
  return {
    projectId: RESOURCE_CUTOVER_PROJECT,
    resourceSchemaVersion: RESOURCE_SCHEMA_VERSION,
    createdAt: new Date(0).toISOString(),
    manifest: {
      version: 2,
      eventPaths: ['events/event-1'],
      managedCollections: ['resources', 'resource_overrides'],
      managedAuditActions: ['resource_recommended', 'resource_overridden', 'resource_schema_cutover'],
    },
    events: [{ path: 'events/event-1', updatedAt: 1 }],
    resources: [{ path: 'events/event-1/resources/resource-1', data: encodeFirestoreValue({ resourceId: 'resource-1' }) }],
    overrides: [], summaries: [], auditReferences: [],
  };
}

function storedInputs(): {
  version: EventVersion;
  assessment: ProvisionalRiskAssessment;
  recommendation: ResourceRecommendation;
} {
  const eventDetails = {
    name: 'Test', type: 'conference' as const, venueName: 'Venue', venueAddress: 'KL', venueCapacity: 500,
    expectedAttendance: 100, environment: 'indoor' as const, coverage: 'covered' as const, seating: 'seated' as const,
    startDatetime: 1, endDatetime: 2, emergencyPlanSummary: 'Plan', organizerName: 'Org',
    organizerEmail: 'org@example.com', organizerPhone: '+6000000000',
  };
  const version: EventVersion = {
    versionId: 'v1', eventId: 'event-1', versionNumber: 1, eventDetails,
    documentPaths: [], submittedBy: 'organizer', submittedAt: 1, inputHash: 'version-hash',
  };
  const categories = ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({
    categoryId: category.id, categoryName: category.name,
    proposedLikelihood: 1 as const, proposedSeverity: 1 as const,
    validatedLikelihood: 1 as const, validatedSeverity: 1 as const,
    matrixScore: 1, normalizedScore: 4, riskLevel: 'Low' as const, weight: category.weight,
    weightedContribution: Math.round(4 * category.weight * 100) / 100,
    evidenceReferences: ['crowd' as const], rationale: 'Test', confidence: 'high' as const,
    concerns: [], missingInformation: [], appliedHardRules: [], guidelineChecks: [...category.guidelineChecks],
  }));
  const result = {
    proposalId: 'proposal-1', validatedHazards: [], categories, overallScore: 4,
    weightedRiskLevel: 'Low' as const, highestCategoryRiskLevel: 'Low' as const, overallRiskLevel: 'Low' as const,
    formulaVersion: PROVISIONAL_FORMULA_VERSION, categorySchemaVersion: ACTIVE_CATEGORY_SCHEMA.version,
    hardRuleVersion: HARD_RULE_VERSION, calculatedAt: 1,
  };
  const assessment = {
    assessmentId: 'assessment-1', eventId: 'event-1', versionId: 'v1', schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    status: 'provisional_ready', provisionalResult: result,
  } as unknown as ProvisionalRiskAssessment;
  const calculation = computeResources({ eventId: 'event-1', versionId: 'v1', assessmentId: 'assessment-1', eventDetails, assessmentResult: result });
  if (!calculation.ok) throw new Error(calculation.message);
  const resourceId = `provisional-v1-${calculation.resourceInputHash}`;
  return {
    version,
    assessment,
    recommendation: {
      resourceId, eventId: 'event-1', versionId: 'v1', assessmentId: 'assessment-1', schemaVersion: RESOURCE_SCHEMA_VERSION,
      stage: 'provisional', revision: 1, supersedesResourceId: null,
      assessmentReference: { stage: 'provisional', assessmentId: 'assessment-1', proposalId: 'proposal-1' },
      resourceInputHash: calculation.resourceInputHash, formulaVersion: calculation.formulaVersion,
      configVersion: calculation.configVersion, sourceRegistryVersion: calculation.sourceRegistryVersion,
      items: calculation.items, confidenceLevel: 'prototype', authorityReviewRequired: true, computedAt: 1,
    },
  };
}
