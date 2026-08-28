"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = require("node:crypto");
const vitest_1 = require("vitest");
const onEventCreated_1 = require("./onEventCreated");
const manualFinalisation_1 = require("../engines/manualFinalisation");
const types_1 = require("../../../shared/types");
(0, vitest_1.describe)('M1-submitted assessment input integrity', () => {
    (0, vitest_1.it)('binds the exact template selection into the immutable version hash', () => {
        const templateSelection = {
            eventCategory: 'cultural_heritage_festival',
            venueSetting: 'outdoor_fixed_site',
            coreTemplateId: 'STERAS-CORE',
            scenarioTemplateId: 'STERAS-T08-CUL-OF-v1.0',
            templateRegistryVersion: '2026-08-28-v1',
            selectedAt: 1,
        };
        const eventDetails = {
            name: 'KL Cultural Festival', type: 'cultural',
            venueName: 'Central Venue', venueAddress: 'Kuala Lumpur', venueLocation: { lat: 3.139, lng: 101.687 },
            venueCapacity: 2_000, expectedAttendance: 1_500, environment: 'outdoor',
            coverage: 'partially_covered', seating: 'mixed',
            startDatetime: 2_000, endDatetime: 3_000,
            emergencyPlanSummary: 'Emergency exits and first-aid posts are documented.',
            organizerName: 'Organizer', organizerEmail: 'organizer@example.com', organizerPhone: '+60123456789',
            riskProfile: {
                internationalAttendees: false, alcoholServed: false, foodServed: true, freeDrinkingWater: true,
                ticketedEntry: true, overnightAccommodation: false, pyrotechnics: false, temporaryStructures: false,
                rivalryOrTensionExpected: false, crowdManagementPlan: true, trafficManagementPlan: true,
                severeWeatherPlan: true, medicalPlan: true, evacuationPlanTested: true, authorityCoordinationConfirmed: true,
                vulnerableAttendeesPercent: 10, standingAttendeesPercent: 20, nearestHospitalTravelMinutes: 15,
            },
        };
        const documentPaths = ['event_documents/event-1/v1/evidence.pdf'];
        const inputHash = (0, node_crypto_1.createHash)('sha256').update(JSON.stringify({ eventDetails, templateSelection, documentPaths })).digest('hex');
        const version = {
            eventId: 'event-1', versionId: 'v1', versionNumber: 1, eventDetails, templateSelection,
            documentPaths, submittedBy: 'organizer-1', submittedAt: 1_000, inputHash,
        };
        (0, vitest_1.expect)((0, onEventCreated_1.isPipelineEventVersion)(version, 'event-1', 'v1')).toBe(true);
        (0, vitest_1.expect)((0, onEventCreated_1.isPipelineEventVersion)({ ...version, templateSelection: undefined }, 'event-1', 'v1')).toBe(false);
        (0, vitest_1.expect)((0, onEventCreated_1.isPipelineEventVersion)({
            ...version,
            templateSelection: { ...templateSelection, scenarioTemplateId: 'STERAS-T01-ENT-IN-v2.0' },
        }, 'event-1', 'v1')).toBe(false);
        (0, vitest_1.expect)((0, onEventCreated_1.isPipelineEventVersion)({
            ...version,
            templateSelection: { ...templateSelection, selectedAt: 2 },
        }, 'event-1', 'v1')).toBe(false);
    });
});
(0, vitest_1.describe)('resource pipeline identity and revision helpers', () => {
    (0, vitest_1.it)('uses stage, version and the complete input hash in deterministic IDs', () => {
        const hash = 'a'.repeat(64);
        (0, vitest_1.expect)((0, onEventCreated_1.resourceDocumentId)('provisional', 'v1', hash)).toBe(`provisional-v1-${hash}`);
        (0, vitest_1.expect)((0, onEventCreated_1.resourceDocumentId)('provisional', 'v1', hash)).toBe((0, onEventCreated_1.resourceDocumentId)('provisional', 'v1', hash));
        (0, vitest_1.expect)((0, onEventCreated_1.resourceDocumentId)('official', 'v1', hash)).not.toBe((0, onEventCreated_1.resourceDocumentId)('provisional', 'v1', hash));
    });
    (0, vitest_1.it)('creates an append-only revision link without mutating the predecessor', () => {
        const previous = { resourceId: 'provisional-v1-old', revision: 3 };
        const snapshot = structuredClone(previous);
        (0, vitest_1.expect)((0, onEventCreated_1.nextResourceRevision)(previous)).toEqual({ revision: 4, supersedesResourceId: previous.resourceId });
        (0, vitest_1.expect)(previous).toEqual(snapshot);
        (0, vitest_1.expect)((0, onEventCreated_1.nextResourceRevision)()).toEqual({ revision: 1, supersedesResourceId: null });
        (0, vitest_1.expect)(() => (0, onEventCreated_1.nextResourceRevision)({ resourceId: 'exhausted', revision: Number.MAX_SAFE_INTEGER })).toThrow();
    });
    (0, vitest_1.it)('recovers the latest valid predecessor when a failed run cleared the pointer', () => {
        const older = recommendation('old', 1, 10);
        const latest = recommendation('latest', 2, 20);
        (0, vitest_1.expect)((0, onEventCreated_1.latestValidHistoricalResource)([older, { ...latest, schemaVersion: 'legacy' }, latest])?.resourceId).toBe(latest.resourceId);
        (0, vitest_1.expect)((0, onEventCreated_1.latestValidHistoricalResource)(undefined)).toBeUndefined();
    });
});
(0, vitest_1.describe)('AI validation failure recovery', () => {
    (0, vitest_1.it)('downgrades a validated-but-unusable success without retaining scores', () => {
        const proposal = {
            status: 'success',
            proposalId: 'proposal-1',
            model: 'MiniMax-test',
            promptVersion: 'prompt-v1',
            responseSchemaVersion: 'response-v1',
            hazards: [],
            categories: [],
            cacheStatus: 'miss',
            generatedAt: 123,
        };
        const failed = (0, onEventCreated_1.invalidAiProposalForManualRecovery)(proposal, 'category crowd has no eligible evidence');
        (0, vitest_1.expect)(failed).toEqual(vitest_1.expect.objectContaining({
            status: 'invalid',
            model: 'MiniMax-test',
            promptVersion: 'prompt-v1',
            responseSchemaVersion: 'response-v1',
            retryable: true,
            cacheStatus: 'not-applicable',
            generatedAt: 123,
        }));
        (0, vitest_1.expect)(failed.errorSummary).toContain('no eligible evidence');
        (0, vitest_1.expect)('categories' in failed).toBe(false);
        (0, vitest_1.expect)('hazards' in failed).toBe(false);
        (0, vitest_1.expect)((0, manualFinalisation_1.isManualAssessmentSourceEligible)({ aiProposal: failed, assessmentReadiness: 'complete' })).toBe(true);
    });
});
(0, vitest_1.describe)('manual assessment lock guard', () => {
    (0, vitest_1.it)('distinguishes absent, valid, and malformed lock fields', () => {
        (0, vitest_1.expect)((0, onEventCreated_1.__testOnlyManualLockState)({ status: 'manual_review_required' })).toBe('absent');
        (0, vitest_1.expect)((0, onEventCreated_1.__testOnlyManualLockState)({ activeManualAssessmentId: 'manual-1' })).toBe('valid');
        (0, vitest_1.expect)((0, onEventCreated_1.__testOnlyManualLockState)({ activeManualAssessmentId: null })).toBe('invalid');
        (0, vitest_1.expect)((0, onEventCreated_1.__testOnlyManualLockState)({ activeManualAssessmentId: 42 })).toBe('invalid');
        (0, vitest_1.expect)((0, onEventCreated_1.__testOnlyManualLockState)({ activeManualAssessmentId: 'manual/child' })).toBe('invalid');
    });
});
function recommendation(_label, revision, computedAt) {
    const resourceInputHash = (revision === 1 ? 'a' : 'b').repeat(64);
    const resourceId = `provisional-v1-${resourceInputHash}`;
    const source = {
        sourceId: 'internal.test', title: 'Test', issuer: 'STERAS', kind: 'internal_prototype',
        locator: 'test', version: 'v1', retrievedAt: 1, verificationStatus: 'prototype_unverified',
    };
    const items = Object.fromEntries(types_1.RESOURCE_KEYS.map((resource) => [resource, {
            status: 'ready', resource, baseline: 1, planningRange: { min: 1, max: 2 },
            inputReferences: [{ inputId: 'attendance', kind: 'event_field', path: 'attendance', value: 100 }],
            assumptions: [{ assumptionId: `${resource}.assumption`, statement: 'Test', sourceIds: [source.sourceId] }],
            appliedRules: [{ ruleId: `${resource}.rule`, description: 'Test', inputReferenceIds: ['attendance'], sourceIds: [source.sourceId], contribution: 1 }],
            sourceSnapshots: [source], authoritySource: { status: 'not_supplied', reason: 'Prototype.' },
            confidence: 'prototype', reviewingAuthority: 'PDRM', authorityReviewRequired: true,
        }]));
    return {
        resourceId, eventId: 'event-1', versionId: 'v1', assessmentId: 'v1', schemaVersion: types_1.RESOURCE_SCHEMA_VERSION,
        stage: 'provisional', revision, supersedesResourceId: revision === 1 ? null : `provisional-v1-${'a'.repeat(64)}`,
        assessmentReference: { stage: 'provisional', assessmentId: 'v1', proposalId: 'proposal-1' },
        resourceInputHash, formulaVersion: 'formula', configVersion: 'config', sourceRegistryVersion: 'sources',
        items, confidenceLevel: 'prototype', authorityReviewRequired: true, validationScope: 'provisional_risk_input', computedAt,
    };
}
//# sourceMappingURL=onEventCreated.test.js.map