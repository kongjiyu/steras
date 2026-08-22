"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const vitest_1 = require("vitest");
const types_1 = require("../../../shared/types");
const categorySchema_1 = require("../config/categorySchema");
const resourceCalculator_1 = require("../engines/resourceCalculator");
const firestoreBackupCodec_1 = require("./firestoreBackupCodec");
const cutoverResourceV3_1 = require("./cutoverResourceV3");
(0, vitest_1.describe)('resource V3 cutover safety', () => {
    (0, vitest_1.it)('defaults to a non-destructive plan', () => {
        const options = (0, cutoverResourceV3_1.parseResourceCutoverArguments)(['--project', cutoverResourceV3_1.RESOURCE_CUTOVER_PROJECT]);
        (0, vitest_1.expect)(options.mode).toBe('plan');
        (0, vitest_1.expect)(() => (0, cutoverResourceV3_1.validateResourceCutoverOptions)(options)).not.toThrow();
    });
    (0, vitest_1.it)('requires the fixed project and exact destructive confirmation', () => {
        (0, vitest_1.expect)(() => (0, cutoverResourceV3_1.validateResourceCutoverOptions)((0, cutoverResourceV3_1.parseResourceCutoverArguments)(['--project', 'wrong']))).toThrow('--project must equal');
        (0, vitest_1.expect)(() => (0, cutoverResourceV3_1.validateResourceCutoverOptions)((0, cutoverResourceV3_1.parseResourceCutoverArguments)([
            '--project', cutoverResourceV3_1.RESOURCE_CUTOVER_PROJECT, '--mode', 'apply',
        ]))).toThrow('--confirm');
    });
    (0, vitest_1.it)('canonicalizes relative backup paths and rejects noncanonical direct options', () => {
        const parsed = (0, cutoverResourceV3_1.parseResourceCutoverArguments)([
            '--project', cutoverResourceV3_1.RESOURCE_CUTOVER_PROJECT, '--mode', 'restore', '--confirm', cutoverResourceV3_1.RESOURCE_CUTOVER_PROJECT, '--backup', 'relative.json',
            '--checksum', 'a'.repeat(64), '--backup-dir', './relative-backups',
        ]);
        (0, vitest_1.expect)(parsed.backupPath).toBe(node_path_1.default.resolve('relative.json'));
        (0, vitest_1.expect)(parsed.backupDirectory).toBe(node_path_1.default.resolve('./relative-backups'));
        (0, vitest_1.expect)(() => (0, cutoverResourceV3_1.validateResourceCutoverOptions)(parsed)).not.toThrow();
        (0, vitest_1.expect)(() => (0, cutoverResourceV3_1.validateResourceCutoverOptions)({ ...parsed, backupDirectory: './relative-backups' })).toThrow('canonical absolute');
    });
    (0, vitest_1.it)('requires a separately supplied audit checksum for restore', () => {
        (0, vitest_1.expect)(() => (0, cutoverResourceV3_1.validateResourceCutoverOptions)((0, cutoverResourceV3_1.parseResourceCutoverArguments)([
            '--project', cutoverResourceV3_1.RESOURCE_CUTOVER_PROJECT, '--mode', 'restore', '--confirm', cutoverResourceV3_1.RESOURCE_CUTOVER_PROJECT,
            '--backup', '/tmp/backup.json',
        ]))).toThrow('--checksum');
        (0, vitest_1.expect)(() => (0, cutoverResourceV3_1.validateResourceCutoverOptions)((0, cutoverResourceV3_1.parseResourceCutoverArguments)([
            '--project', cutoverResourceV3_1.RESOURCE_CUTOVER_PROJECT, '--mode', 'restore', '--confirm', cutoverResourceV3_1.RESOURCE_CUTOVER_PROJECT,
            '--backup', '/tmp/backup.json', '--checksum', 'a'.repeat(64),
        ]))).not.toThrow();
        (0, vitest_1.expect)((0, cutoverResourceV3_1.backupChecksumFor)('backup')).toMatch(/^[a-f0-9]{64}$/);
    });
    (0, vitest_1.it)('keeps isolated backfill failures nonfatal while structural verification failures stop cutover', () => {
        (0, vitest_1.expect)((0, cutoverResourceV3_1.shouldAbortResourceCutover)([])).toBe(false);
        (0, vitest_1.expect)((0, cutoverResourceV3_1.shouldAbortResourceCutover)(['event-1:dangling-current-pointer'])).toBe(true);
    });
    (0, vitest_1.it)('detects dangling and cyclic revision chains', () => {
        (0, vitest_1.expect)((0, cutoverResourceV3_1.validateResourceRevisionGraph)([resource('one', null), resource('two', 'one')])).toEqual([]);
        (0, vitest_1.expect)((0, cutoverResourceV3_1.validateResourceRevisionGraph)([resource('one', 'missing')])).toContain('one:dangling-predecessor');
        (0, vitest_1.expect)((0, cutoverResourceV3_1.validateResourceRevisionGraph)([resource('one', 'two'), resource('two', 'one')])).toContain('one:cycle');
        (0, vitest_1.expect)((0, cutoverResourceV3_1.validateResourceRevisionGraph)([resource('one', null), resource('root-two', null)])).toContain('v1:provisional:multiple-roots');
    });
    (0, vitest_1.it)('rejects branched, duplicate and noncontiguous revisions and a stale current tip', () => {
        const root = resource('root', null, 1);
        const second = resource('second', 'root', 2);
        const branch = resource('branch', 'root', 2);
        (0, vitest_1.expect)((0, cutoverResourceV3_1.validateResourceRevisionGraph)([root, second, branch])).toEqual(vitest_1.expect.arrayContaining([
            'root:branched-successors', 'v1:provisional:duplicate-revision',
        ]));
        (0, vitest_1.expect)((0, cutoverResourceV3_1.validateResourceRevisionGraph)([root, resource('third', 'root', 3)])).toEqual(vitest_1.expect.arrayContaining([
            'v1:provisional:noncontiguous-revisions', 'third:noncontiguous-predecessor',
        ]));
        (0, vitest_1.expect)((0, cutoverResourceV3_1.validateCurrentResourceTip)([root, second], 'root')).toContain('current-pointer-not-tip');
        (0, vitest_1.expect)((0, cutoverResourceV3_1.validateCurrentResourceTip)([root, second], 'second')).toEqual([]);
    });
    (0, vitest_1.it)('rejects arbitrary or malformed backup paths before restore', () => {
        const backup = validBackup();
        (0, vitest_1.expect)(() => (0, cutoverResourceV3_1.validateResourceCutoverBackup)(backup)).not.toThrow();
        (0, vitest_1.expect)(() => (0, cutoverResourceV3_1.validateResourceCutoverBackup)({
            ...backup,
            resources: [{ path: 'users/admin', data: (0, firestoreBackupCodec_1.encodeFirestoreValue)({ resourceId: 'hostile' }) }],
        })).toThrow('outside the allowed resources scope');
        (0, vitest_1.expect)(() => (0, cutoverResourceV3_1.validateResourceCutoverBackup)({
            ...backup,
            manifest: { ...backup.manifest, eventPaths: ['events/another-event'] },
        })).toThrow('manifest event scope');
        (0, vitest_1.expect)(() => (0, cutoverResourceV3_1.validateResourceCutoverBackup)({
            ...backup,
            auditReferences: [{
                    path: 'events/event-1/audit_logs/decision-1',
                    data: (0, firestoreBackupCodec_1.encodeFirestoreValue)({ action: 'decision_made' }),
                }],
        })).toThrow('managed resource action scope');
        (0, vitest_1.expect)(() => (0, cutoverResourceV3_1.validateResourceCutoverBackup)({ ...backup, unexpected: true })).toThrow('unknown top-level');
    });
    (0, vitest_1.it)('deletes only legacy resources and fails closed for mixed, rerun, or invalid V3 state', () => {
        const legacy = { path: 'events/event-1/resources/legacy', data: { resourceId: 'legacy' } };
        const { recommendation } = storedInputs();
        const v3 = { path: `events/event-1/resources/${recommendation.resourceId}`, data: recommendation };
        const legacyOnly = (0, cutoverResourceV3_1.classifyResourceCutoverState)([legacy], [{ eventPath: 'events/event-1', currentResourceId: 'legacy' }]);
        (0, vitest_1.expect)(legacyOnly).toMatchObject({ state: 'legacy_only', legacyPaths: [legacy.path], v3Resources: [] });
        (0, vitest_1.expect)(() => (0, cutoverResourceV3_1.assertSafeResourceCutoverApply)(legacyOnly)).not.toThrow();
        const mixed = (0, cutoverResourceV3_1.classifyResourceCutoverState)([legacy, v3], [{ eventPath: 'events/event-1', currentResourceId: recommendation.resourceId }]);
        (0, vitest_1.expect)(mixed.state).toBe('mixed');
        (0, vitest_1.expect)(() => (0, cutoverResourceV3_1.assertSafeResourceCutoverApply)(mixed)).toThrow('mixed legacy/V3');
        const rerun = (0, cutoverResourceV3_1.classifyResourceCutoverState)([v3], [{ eventPath: 'events/event-1', currentResourceId: recommendation.resourceId }]);
        (0, vitest_1.expect)(rerun.state).toBe('v3_only');
        (0, vitest_1.expect)(() => (0, cutoverResourceV3_1.assertSafeResourceCutoverApply)(rerun)).toThrow('already exist');
        const corrupt = (0, cutoverResourceV3_1.classifyResourceCutoverState)([
            { ...v3, data: { ...recommendation, resourceInputHash: 'f'.repeat(64) } },
        ], [{ eventPath: 'events/event-1', currentResourceId: recommendation.resourceId }]);
        (0, vitest_1.expect)(corrupt.state).toBe('invalid_v3');
        (0, vitest_1.expect)(() => (0, cutoverResourceV3_1.assertSafeResourceCutoverApply)(corrupt)).toThrow('stored V3 resources are invalid');
    });
    (0, vitest_1.it)('rejects decoded pointer and projection relationships before restore mutation', () => {
        const backup = validBackup();
        backup.summaries = [{
                path: 'events/event-1/assessment_summaries/v1',
                data: (0, firestoreBackupCodec_1.encodeFirestoreValue)({ resourceRecommendation: { resourceId: 'missing-resource' } }),
            }];
        const validated = (0, cutoverResourceV3_1.validateResourceCutoverBackup)(backup);
        (0, vitest_1.expect)((0, cutoverResourceV3_1.validateDecodedRestoreRelationships)(validated, [
            { path: 'events/event-1/resources/resource-1', decoded: { resourceId: 'resource-1' } },
            {
                path: 'events/event-1/assessment_summaries/v1',
                decoded: { resourceRecommendation: { resourceId: 'missing-resource' } },
            },
        ])).toContain('events/event-1/assessment_summaries/v1:summary-resource-missing');
        (0, vitest_1.expect)((0, cutoverResourceV3_1.validateDecodedRestoreRelationships)(validated, [{
                path: 'events/event-1/resources/resource-1', decoded: { resourceId: 'legacy-alias' },
            }])).toContain('events/event-1/resources/resource-1:resource-document-id-mismatch');
    });
    (0, vitest_1.it)('binds verified cutover resources to the stored assessment, version, hash and items', () => {
        const { version, assessment, recommendation } = storedInputs();
        (0, vitest_1.expect)((0, cutoverResourceV3_1.validateResourceAgainstStoredInputs)(recommendation, 'event-1', version, assessment)).toEqual([]);
        (0, vitest_1.expect)((0, cutoverResourceV3_1.validateResourceAgainstStoredInputs)({ ...recommendation, resourceInputHash: 'f'.repeat(64) }, 'event-1', version, assessment)).toContain('recomputed-hash-mismatch');
        (0, vitest_1.expect)((0, cutoverResourceV3_1.validateResourceAgainstStoredInputs)({
            ...recommendation,
            stage: 'provisional',
            assessmentReference: { stage: 'provisional', assessmentId: recommendation.assessmentId, proposalId: 'wrong' },
        }, 'event-1', version, assessment)).toContain('assessment-reference-mismatch');
        (0, vitest_1.expect)((0, cutoverResourceV3_1.validateResourceAgainstStoredInputs)(recommendation, 'event-1', version, {
            ...assessment, schemaVersion: 'legacy',
        })).toContain('stored-assessment-mismatch');
    });
    (0, vitest_1.it)('binds the pointer identity to the physical document and deterministic hash ID', () => {
        const canonical = resource(`provisional-v1-${'a'.repeat(64)}`, null);
        canonical.resourceInputHash = 'a'.repeat(64);
        (0, vitest_1.expect)((0, cutoverResourceV3_1.validateResourceDocumentIdentity)(canonical.resourceId, canonical)).toEqual([]);
        (0, vitest_1.expect)((0, cutoverResourceV3_1.validateResourceDocumentIdentity)('wrong-document', canonical)).toContain('resource-document-identity');
        (0, vitest_1.expect)((0, cutoverResourceV3_1.validateResourceDocumentIdentity)(canonical.resourceId, { ...canonical, resourceId: 'embedded-alias' })).toContain('resource-document-identity');
    });
    (0, vitest_1.it)('detects organizer projection drift from the canonical resource', () => {
        const canonical = resource('one', null);
        canonical.revision = 1;
        canonical.stage = 'provisional';
        for (const key of types_1.RESOURCE_KEYS)
            canonical.items[key] = {
                ...canonical.items[key], baseline: 2, planningRange: { min: 2, max: 3 },
            };
        const quantities = Object.fromEntries(types_1.RESOURCE_KEYS.map((key) => [key, 2]));
        const items = Object.fromEntries(types_1.RESOURCE_KEYS.map((key) => [key, { baseline: 2, planningRange: { min: 2, max: 3 } }]));
        const summary = { resourceQuantities: quantities, resourceRecommendation: { resourceId: 'one', revision: 1, stage: 'provisional', items, disclaimer: 'Prototype.' } };
        (0, vitest_1.expect)((0, cutoverResourceV3_1.validateOrganizerResourceProjection)(canonical, summary)).toEqual([]);
        summary.resourceRecommendation.items.police.baseline = 9;
        (0, vitest_1.expect)((0, cutoverResourceV3_1.validateOrganizerResourceProjection)(canonical, summary)).toContain('summary-police-mismatch');
    });
});
function resource(resourceId, supersedesResourceId, revisionOverride) {
    const items = Object.fromEntries(types_1.RESOURCE_KEYS.map((key) => [key, { resource: key }]));
    const revision = revisionOverride ?? (resourceId === 'two' ? 2 : 1);
    return {
        resourceId, supersedesResourceId, schemaVersion: types_1.RESOURCE_SCHEMA_VERSION, versionId: 'v1', stage: 'provisional',
        resourceInputHash: 'a'.repeat(64), revision, items,
    };
}
function validBackup() {
    return {
        projectId: cutoverResourceV3_1.RESOURCE_CUTOVER_PROJECT,
        resourceSchemaVersion: types_1.RESOURCE_SCHEMA_VERSION,
        createdAt: new Date(0).toISOString(),
        manifest: {
            version: 2,
            eventPaths: ['events/event-1'],
            managedCollections: ['resources', 'resource_overrides'],
            managedAuditActions: ['resource_recommended', 'resource_overridden', 'resource_schema_cutover'],
        },
        events: [{ path: 'events/event-1', updatedAt: 1 }],
        resources: [{ path: 'events/event-1/resources/resource-1', data: (0, firestoreBackupCodec_1.encodeFirestoreValue)({ resourceId: 'resource-1' }) }],
        overrides: [], summaries: [], auditReferences: [],
    };
}
function storedInputs() {
    const eventDetails = {
        name: 'Test', type: 'conference', venueName: 'Venue', venueAddress: 'KL', venueCapacity: 500,
        expectedAttendance: 100, environment: 'indoor', coverage: 'covered', seating: 'seated',
        startDatetime: 1, endDatetime: 2, emergencyPlanSummary: 'Plan', organizerName: 'Org',
        organizerEmail: 'org@example.com', organizerPhone: '+6000000000',
    };
    const version = {
        versionId: 'v1', eventId: 'event-1', versionNumber: 1, eventDetails,
        documentPaths: [], submittedBy: 'organizer', submittedAt: 1, inputHash: 'version-hash',
    };
    const categories = categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({
        categoryId: category.id, categoryName: category.name,
        proposedLikelihood: 1, proposedSeverity: 1,
        validatedLikelihood: 1, validatedSeverity: 1,
        matrixScore: 1, normalizedScore: 4, riskLevel: 'Low', weight: category.weight,
        weightedContribution: Math.round(4 * category.weight * 100) / 100,
        evidenceReferences: ['crowd'], rationale: 'Test', confidence: 'high',
        concerns: [], missingInformation: [], appliedHardRules: [], guidelineChecks: [...category.guidelineChecks],
    }));
    const result = {
        proposalId: 'proposal-1', validatedHazards: [], categories, overallScore: 4,
        weightedRiskLevel: 'Low', highestCategoryRiskLevel: 'Low', overallRiskLevel: 'Low',
        formulaVersion: types_1.PROVISIONAL_FORMULA_VERSION, categorySchemaVersion: categorySchema_1.ACTIVE_CATEGORY_SCHEMA.version,
        hardRuleVersion: types_1.HARD_RULE_VERSION, calculatedAt: 1,
    };
    const assessment = {
        assessmentId: 'assessment-1', eventId: 'event-1', versionId: 'v1', schemaVersion: types_1.ASSESSMENT_SCHEMA_VERSION,
        status: 'provisional_ready', provisionalResult: result,
    };
    const calculation = (0, resourceCalculator_1.computeResources)({ eventId: 'event-1', versionId: 'v1', assessmentId: 'assessment-1', eventDetails, assessmentResult: result });
    if (!calculation.ok)
        throw new Error(calculation.message);
    const resourceId = `provisional-v1-${calculation.resourceInputHash}`;
    return {
        version,
        assessment,
        recommendation: {
            resourceId, eventId: 'event-1', versionId: 'v1', assessmentId: 'assessment-1', schemaVersion: types_1.RESOURCE_SCHEMA_VERSION,
            stage: 'provisional', revision: 1, supersedesResourceId: null,
            assessmentReference: { stage: 'provisional', assessmentId: 'assessment-1', proposalId: 'proposal-1' },
            resourceInputHash: calculation.resourceInputHash, formulaVersion: calculation.formulaVersion,
            configVersion: calculation.configVersion, sourceRegistryVersion: calculation.sourceRegistryVersion,
            items: calculation.items, confidenceLevel: 'prototype', authorityReviewRequired: true, computedAt: 1,
            validationScope: 'provisional_risk_input',
        },
    };
}
//# sourceMappingURL=cutoverResourceV3.test.js.map