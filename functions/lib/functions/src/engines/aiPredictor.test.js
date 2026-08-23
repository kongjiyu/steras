"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const categorySchema_1 = require("../config/categorySchema");
const assessmentValidator_1 = require("./assessmentValidator");
const resourceCalculator_1 = require("./resourceCalculator");
const aiPredictor_1 = require("./aiPredictor");
const event = {
    eventId: 'private-event-id', organizerId: 'private-user-id', status: 'Pending', currentVersionNumber: 1,
    draftDocumentPaths: [], requiredAuthorities: ['PDRM'], createdAt: 1, updatedAt: 1,
    eventDetails: {
        name: 'Private Event Name', type: 'festival', venueName: 'Private Venue Name', venueAddress: 'Private Address',
        venueCapacity: 10_000, expectedAttendance: 8_000, environment: 'outdoor', coverage: 'uncovered', seating: 'mixed',
        startDatetime: 10_000, endDatetime: 20_000, emergencyPlanSummary: 'Private emergency plan',
        organizerName: 'Private Person', organizerEmail: 'private@example.com', organizerPhone: '+60111111111',
    },
};
const context = {
    weather: { data: { forecast: 'Thunderstorm', temperature: 31, humidity: 85, windSpeed: 4, precipitationProbability: 80, severeAlert: true }, measurementStatus: 'available', source: 'openweather', freshness: 'fresh', fetchedAt: 1, expiresAt: 2, forecastFor: 10_000 },
    calendar: { localDate: '2026-07-21', dayOfWeek: 'Tuesday', isWeekend: false, isHolidayOrAdjacent: false, sourceVersion: 'test', sourceTimestamp: 1, coverageStatus: 'verified' },
    venue: { matched: true, venueId: 'venue-1', submittedCapacity: 10_000, registeredCapacity: 10_000, capacityDifference: 0, fetchedAt: 1 },
    incidentHistory: { matched: true, venueId: 'venue-1', incidentIds: [], total: 0, bySeverity: { low: 0, medium: 0, high: 0 }, syntheticStatus: 'none', fetchedAt: 1 },
};
const categoryIds = categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.map((category) => category.id);
const baseline = {
    categoryAssignments: [], officialScore: 20, officialRiskLevel: 'Low', evidence: [
        { key: 'weather', description: 'Thunderstorm', sourceTimestamp: 1, source: 'openweather', status: 'fresh', quality: 'verified', confidenceScore: 100, eligibility: 'eligible', syntheticStatus: 'none' },
    ], categorySchemaVersion: 'test', scoringLogicVersion: 'test', categorySchemaStatus: 'prototype', computedAt: 1,
};
const validPayload = {
    hazards: [{ hazardId: 'weather.storm', hazardName: 'Storm', categoryId: 'weather_environment', evidenceReferences: ['weather'], rationale: 'Severe alert.' }],
    categories: categoryIds.map((categoryId) => ({
        categoryId, likelihood: 2, severity: 3, evidenceReferences: ['weather'], rationale: `${categoryId} rationale`, confidence: 'medium', concerns: [], missingInformation: [],
    })),
};
const validResponse = JSON.stringify(validPayload);
(0, vitest_1.beforeEach)(aiPredictor_1.clearAICache);
(0, vitest_1.describe)('parseAIProposal', () => {
    (0, vitest_1.it)('accepts integer scores for every configured category', () => {
        (0, vitest_1.expect)((0, aiPredictor_1.parseAIProposal)(validResponse, categoryIds).categories).toHaveLength(categoryIds.length);
    });
    (0, vitest_1.it)('rejects missing, duplicate, unknown, fractional, and out-of-range scores', () => {
        (0, vitest_1.expect)(() => (0, aiPredictor_1.parseAIProposal)(JSON.stringify({ ...validPayload, categories: validPayload.categories.slice(1) }), categoryIds)).toThrow(/exactly/);
        const duplicate = structuredClone(validPayload);
        duplicate.categories[1].categoryId = duplicate.categories[0].categoryId;
        (0, vitest_1.expect)(() => (0, aiPredictor_1.parseAIProposal)(JSON.stringify(duplicate), categoryIds)).toThrow(/duplicate/);
        for (const likelihood of [0, 6, 2.5]) {
            const invalid = structuredClone(validPayload);
            invalid.categories[0].likelihood = likelihood;
            (0, vitest_1.expect)(() => (0, aiPredictor_1.parseAIProposal)(JSON.stringify(invalid), categoryIds)).toThrow(/integer from 1 to 5/);
        }
    });
    (0, vitest_1.it)('rejects invalid JSON, unknown evidence, and unsupported fields', () => {
        (0, vitest_1.expect)(() => (0, aiPredictor_1.parseAIProposal)('{bad', categoryIds)).toThrow(/valid JSON/);
        (0, vitest_1.expect)(() => (0, aiPredictor_1.parseAIProposal)(JSON.stringify({ ...validPayload, officialScore: 99 }), categoryIds)).toThrow(/unsupported fields/);
        const invalid = structuredClone(validPayload);
        invalid.categories[0].evidenceReferences = ['organizer_reputation'];
        (0, vitest_1.expect)(() => (0, aiPredictor_1.parseAIProposal)(JSON.stringify(invalid), categoryIds)).toThrow(/evidence key/);
    });
    (0, vitest_1.it)('rejects normalized duplicate hazard IDs and duplicate evidence references', () => {
        const duplicateHazards = structuredClone(validPayload);
        duplicateHazards.hazards.push({ ...duplicateHazards.hazards[0], hazardId: ' WEATHER.STORM ' });
        (0, vitest_1.expect)(() => (0, aiPredictor_1.parseAIProposal)(JSON.stringify(duplicateHazards), categoryIds)).toThrow(/duplicate hazardId/);
        const duplicateReferences = structuredClone(validPayload);
        duplicateReferences.categories[0].evidenceReferences = ['weather', 'weather'];
        (0, vitest_1.expect)(() => (0, aiPredictor_1.parseAIProposal)(JSON.stringify(duplicateReferences), categoryIds)).toThrow(/duplicate evidence/);
    });
    (0, vitest_1.it)('guarantees a parser-accepted proposal can enter validation and resource calculation', () => {
        const parsed = (0, aiPredictor_1.parseAIProposal)(validResponse, categoryIds);
        const validation = (0, assessmentValidator_1.validateAndCalculateProvisional)({
            status: 'success', proposalId: 'proposal-property', model: 'test', promptVersion: 'test',
            responseSchemaVersion: 'test', ...parsed, cacheStatus: 'miss', generatedAt: 1,
        }, baseline, 1);
        (0, vitest_1.expect)(validation.ok).toBe(true);
        if (!validation.ok)
            return;
        (0, vitest_1.expect)((0, resourceCalculator_1.computeResources)({
            eventId: event.eventId,
            versionId: 'v1',
            assessmentId: 'assessment-1',
            eventDetails: event.eventDetails,
            assessmentResult: validation.result,
        })).toMatchObject({ ok: true });
    });
});
(0, vitest_1.describe)('predictWithAI', () => {
    (0, vitest_1.it)('uses the configured timeout and sends an allowlisted input without PII', () => {
        (0, vitest_1.expect)(aiPredictor_1.AI_TIMEOUT_MS).toBe(30_000);
        const hostileContext = structuredClone(context);
        hostileContext.venue.venueId = 'internal-venue-id';
        hostileContext.venue.riskNotes = 'Call Private Person at private-context@example.com or +60129999999';
        hostileContext.incidentHistory.venueId = 'history-venue-id';
        hostileContext.incidentHistory.incidentIds = ['private-incident-id'];
        hostileContext.incidentHistory.historicalEventIds = ['private-history-id'];
        hostileContext.incidentHistory.comparableEvents = [{
                historicalEventId: 'raw-comparable-id', venueId: 'raw-venue-id', eventType: 'festival', attendance: 10,
                attendeeHours: 20, similarityScore: 5, patientPresentations: 0, hospitalTransfers: 0, incidentCount: 0, synthetic: false,
            }];
        const hostileBaseline = structuredClone(baseline);
        hostileBaseline.evidence[0].description = 'private-evidence@example.com +60128888888';
        hostileBaseline.evidence[0].source = 'private-source-id';
        const hostileEvent = structuredClone(event);
        hostileEvent.eventDetails.riskProfile = {
            medicalPlan: true,
            verifiedControlIds: ['medical-plan', 'private-control@example.com'],
            hiddenContact: 'private-profile@example.com',
        };
        const input = (0, aiPredictor_1.buildAllowedInput)(hostileEvent, hostileContext, hostileBaseline);
        (0, vitest_1.expect)(input).not.toContain('Private');
        (0, vitest_1.expect)(input).not.toContain('private@');
        (0, vitest_1.expect)(input).not.toContain('+601');
        (0, vitest_1.expect)(input).not.toContain('private-user-id');
        (0, vitest_1.expect)(input).not.toContain('internal-venue-id');
        (0, vitest_1.expect)(input).not.toContain('private-incident-id');
        (0, vitest_1.expect)(input).not.toContain('private-history-id');
        (0, vitest_1.expect)(input).not.toContain('raw-comparable-id');
        (0, vitest_1.expect)(input).not.toContain('private-source-id');
        (0, vitest_1.expect)(input).not.toContain('private-profile@example.com');
        (0, vitest_1.expect)(input).not.toContain('private-control@example.com');
        const parsed = JSON.parse(input);
        (0, vitest_1.expect)(parsed).toHaveProperty('rubric');
        (0, vitest_1.expect)(parsed).not.toHaveProperty('officialResult');
        (0, vitest_1.expect)(parsed.context.venue).not.toHaveProperty('riskNotes');
        (0, vitest_1.expect)(parsed.context.incidentHistory).not.toHaveProperty('comparableEvents');
        (0, vitest_1.expect)(parsed.evidence[0]).toEqual({ key: 'weather', status: 'fresh', quality: 'verified', confidenceScore: 100, sourceTimestamp: 1 });
    });
    (0, vitest_1.it)('caches successful proposals by model, prompt, and input', async () => {
        let requests = 0;
        const request = async () => { requests += 1; return validResponse; };
        (0, vitest_1.expect)((await (0, aiPredictor_1.predictWithAI)('secret', event, context, baseline, { now: 1_000, request })).cacheStatus).toBe('miss');
        (0, vitest_1.expect)((await (0, aiPredictor_1.predictWithAI)('secret', event, context, baseline, { now: 2_000, request })).cacheStatus).toBe('hit');
        (0, vitest_1.expect)(requests).toBe(1);
    });
    (0, vitest_1.it)('returns failure attempts without fabricated categories', async () => {
        const result = await (0, aiPredictor_1.analyseWithAI)('secret', event, context, baseline, async () => {
            throw new aiPredictor_1.AIProposalError('timeout', 'test timeout');
        });
        (0, vitest_1.expect)(result).toMatchObject({ status: 'timeout', retryable: true, cacheStatus: 'not-applicable' });
        (0, vitest_1.expect)(result).not.toHaveProperty('categories');
    });
    vitest_1.it.each(['unavailable', 'timeout', 'invalid'])('marks %s output as retryable without fabricated scores', async (status) => {
        const result = await (0, aiPredictor_1.analyseWithAI)('secret', event, context, baseline, async () => {
            throw new aiPredictor_1.AIProposalError(status, `test ${status}`);
        });
        (0, vitest_1.expect)(result).toMatchObject({ status, retryable: true });
        (0, vitest_1.expect)(result).not.toHaveProperty('categories');
    });
});
//# sourceMappingURL=aiPredictor.test.js.map