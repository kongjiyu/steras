"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onEventUpdated = exports.onEventCreated = void 0;
exports.runRiskAndResourcePipeline = runRiskAndResourcePipeline;
const node_crypto_1 = require("node:crypto");
const firebase_admin_1 = require("firebase-admin");
const firebase_functions_1 = require("firebase-functions");
const firestore_1 = require("firebase-functions/v2/firestore");
const types_1 = require("../../../shared/types");
const aiPredictor_1 = require("../engines/aiPredictor");
const resourceCalculator_1 = require("../engines/resourceCalculator");
const ruleBased_1 = require("../engines/ruleBased");
const holidays_1 = require("../utils/holidays");
const weather_1 = require("../utils/weather");
const secrets_1 = require("../config/secrets");
const runtime_1 = require("../config/runtime");
const CLAIM_LEASE_MS = 2 * 60 * 1000;
async function runRiskAndResourcePipeline(eventId, now = Date.now()) {
    const db = (0, firebase_admin_1.firestore)();
    const eventReference = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const eventSnapshot = await eventReference.get();
    if (!eventSnapshot.exists)
        return { status: 'skipped', eventId, reason: 'event-not-found' };
    const event = { eventId, ...eventSnapshot.data() };
    if (event.status !== 'Pending' || !event.currentVersionId) {
        return { status: 'skipped', eventId, reason: 'event-not-pending' };
    }
    const versionId = event.currentVersionId;
    const versionReference = eventReference.collection(types_1.COLLECTIONS.VERSIONS).doc(versionId);
    const versionSnapshot = await versionReference.get();
    if (!versionSnapshot.exists)
        throw new Error(`Immutable event version ${versionId} was not found.`);
    const version = versionSnapshot.data();
    const inputHash = processingHash(version.inputHash);
    const assessmentReference = eventReference.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(versionId);
    const resourceReference = eventReference.collection(types_1.COLLECTIONS.RESOURCES).doc(versionId);
    const claimId = (0, node_crypto_1.randomUUID)();
    const claimed = await db.runTransaction(async (transaction) => {
        const [currentEventSnapshot, existingSnapshot] = await Promise.all([
            transaction.get(eventReference),
            transaction.get(assessmentReference),
        ]);
        const currentEvent = currentEventSnapshot.data();
        if (!currentEvent || currentEvent.status !== 'Pending' || currentEvent.currentVersionId !== versionId)
            return false;
        const existing = existingSnapshot.data();
        if (existing?.status === 'ready' && existing.inputHash === inputHash)
            return false;
        if (existing?.status === 'processing' && existing.inputHash === inputHash && existing.leaseExpiresAt > now)
            return false;
        const job = {
            assessmentId: versionId,
            eventId,
            versionId,
            status: 'processing',
            inputHash,
            claimId,
            claimedAt: now,
            leaseExpiresAt: now + CLAIM_LEASE_MS,
            createdAt: existing?.createdAt ?? now,
        };
        transaction.set(assessmentReference, job);
        return true;
    });
    if (!claimed)
        return { status: 'skipped', eventId, versionId, reason: 'already-claimed-or-ready' };
    try {
        const assessedEvent = { ...event, eventDetails: version.eventDetails };
        const [weather, incidentHistory, venueContext] = await Promise.all([
            (0, weather_1.fetchWeather)(version.eventDetails.venueLocation, version.eventDetails.venueName, version.eventDetails.startDatetime, { apiKey: secrets_1.OPENWEATHER_API_KEY.value() }),
            (0, ruleBased_1.fetchHistoricalContext)(assessedEvent),
            (0, ruleBased_1.fetchVenueContext)(version.eventDetails.venueId, version.eventDetails.venueName, version.eventDetails.venueCapacity),
        ]);
        const calendar = (0, holidays_1.getCalendarContext)(version.eventDetails.startDatetime);
        const contextSnapshot = {
            weather,
            calendar,
            venue: venueContext,
            incidentHistory,
        };
        const computedAt = Date.now();
        const officialResult = (0, ruleBased_1.computeCategoryBasedAssessment)(assessedEvent, contextSnapshot, computedAt);
        const apiKey = secrets_1.MINIMAX_API_KEY.value();
        const aiAdvisory = await (0, aiPredictor_1.analyseWithAIOrFallback)(apiKey, assessedEvent, contextSnapshot, officialResult);
        const createdAt = Date.now();
        const assessment = {
            assessmentId: versionId,
            eventId,
            versionId,
            status: 'ready',
            ...officialResult,
            aiAdvisory,
            contextSnapshot,
            sourceTimestamps: { weather: weather.fetchedAt, holiday: calendar.sourceTimestamp, venue: venueContext.fetchedAt, incidents: incidentHistory.fetchedAt },
            contextStatuses: {
                weather: `${weather.source}:${weather.freshness}`,
                holiday: calendar.sourceVersion,
                venue: venueContext.matched ? 'matched' : 'unmatched',
                incidents: incidentHistory.matched ? 'matched' : 'unmatched',
                ai: aiAdvisory.cacheStatus,
            },
            inputHash,
            createdAt,
        };
        const resourceCalculation = (0, resourceCalculator_1.computeResources)(version.eventDetails, officialResult);
        const resources = {
            resourceId: versionId,
            eventId,
            versionId,
            assessmentId: versionId,
            ...resourceCalculation.quantities,
            rationales: resourceCalculation.rationales,
            items: resourceCalculation.items,
            formulaVersion: types_1.RESOURCE_FORMULA_VERSION,
            guidelineVersion: types_1.RESOURCE_GUIDELINE_VERSION,
            guidelineStatus: 'prototype',
            aiConsiderations: aiAdvisory.resourceConsiderations,
            confidenceLevel: 'prototype',
            notes: 'Prototype category mappings and resource guidance pending team and authority validation.',
            computedAt: createdAt,
        };
        const finalized = await db.runTransaction(async (transaction) => {
            const [claimSnapshot, currentEventSnapshot] = await Promise.all([
                transaction.get(assessmentReference),
                transaction.get(eventReference),
            ]);
            const claim = claimSnapshot.data();
            const currentEvent = currentEventSnapshot.data();
            if (claim?.status !== 'processing' || claim.claimId !== claimId)
                return false;
            if (!currentEvent || currentEvent.status !== 'Pending' || currentEvent.currentVersionId !== versionId)
                return false;
            transaction.set(assessmentReference, assessment);
            transaction.set(resourceReference, resources);
            transaction.update(eventReference, { currentAssessmentId: versionId, currentResourceId: versionId, updatedAt: createdAt });
            transaction.set(eventReference.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${versionId}-risk-score-computed`), {
                id: `${versionId}-risk-score-computed`, eventId, versionId, action: 'risk_score_computed', actorId: 'system', actorRole: 'system', timestamp: createdAt,
                metadata: {
                    officialScore: officialResult.officialScore,
                    officialRiskLevel: officialResult.officialRiskLevel,
                    categorySchemaVersion: officialResult.categorySchemaVersion,
                    scoringLogicVersion: officialResult.scoringLogicVersion,
                    aiStatus: aiAdvisory.status,
                    aiCacheStatus: aiAdvisory.cacheStatus,
                    model: aiAdvisory.model,
                    promptVersion: aiAdvisory.promptVersion,
                    responseSchemaVersion: aiAdvisory.responseSchemaVersion,
                    inputHash,
                },
            });
            transaction.set(eventReference.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${versionId}-resource-recommended`), {
                id: `${versionId}-resource-recommended`, eventId, versionId, action: 'resource_recommended', actorId: 'system', actorRole: 'system', timestamp: createdAt,
                metadata: { resourceId: versionId, formulaVersion: types_1.RESOURCE_FORMULA_VERSION, guidelineVersion: types_1.RESOURCE_GUIDELINE_VERSION, guidelineStatus: 'prototype' },
            });
            return true;
        });
        if (!finalized)
            return { status: 'skipped', eventId, versionId, reason: 'claim-lost-or-version-changed' };
        firebase_functions_1.logger.info(`[assessment] ${eventId}/${versionId}: official=${officialResult.officialScore}/${officialResult.officialRiskLevel}, ai=${aiAdvisory.status}`);
        return { status: 'processed', eventId, versionId };
    }
    catch (error) {
        await markFailed(assessmentReference, claimId, inputHash, error);
        throw error;
    }
}
function processingHash(versionInputHash) {
    return (0, node_crypto_1.createHash)('sha256').update(JSON.stringify({
        versionInputHash,
        categorySchemaVersion: types_1.CATEGORY_SCHEMA_VERSION,
        scoringLogicVersion: types_1.SCORING_LOGIC_VERSION,
        promptVersion: aiPredictor_1.PROMPT_VERSION,
        aiResponseSchemaVersion: aiPredictor_1.AI_RESPONSE_SCHEMA_VERSION,
        formulaVersion: types_1.RESOURCE_FORMULA_VERSION,
        guidelineVersion: types_1.RESOURCE_GUIDELINE_VERSION,
    })).digest('hex');
}
async function markFailed(reference, claimId, inputHash, error) {
    const db = (0, firebase_admin_1.firestore)();
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const current = snapshot.data();
        if (current?.status !== 'processing' || current.claimId !== claimId)
            return;
        transaction.set(reference, {
            ...current,
            status: 'failed',
            inputHash,
            error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown assessment failure',
            leaseExpiresAt: Date.now(),
        });
    });
}
exports.onEventCreated = (0, firestore_1.onDocumentCreated)({ document: `${types_1.COLLECTIONS.EVENTS}/{eventId}`, region: runtime_1.FUNCTION_REGION, secrets: secrets_1.ASSESSMENT_SECRETS }, async (trigger) => {
    const eventId = trigger.params.eventId;
    // M3 E2E test fixtures carry pre-seeded complianceStatus /
    // assessmentReadiness overrides. The engine would otherwise overwrite
    // them with the engine schema. The Playwright suite uses these ids
    // (and the seed-mockData ids starting with evt-001..evt-004 are
    // intentionally NOT skipped — they go through the full engine flow).
    const M3_TEST_FIXTURE_IDS = new Set([
        'evt-compliance-blocked',
        'evt-provisional-readiness',
        'evt-control-verification',
    ]);
    if (M3_TEST_FIXTURE_IDS.has(eventId)) {
        firebase_functions_1.logger.info(`[onEventCreated] skipped M3 test fixture: ${eventId}`);
        return;
    }
    try {
        await runRiskAndResourcePipeline(eventId);
    }
    catch (error) {
        firebase_functions_1.logger.error('[onEventCreated] failed', error);
    }
});
exports.onEventUpdated = (0, firestore_1.onDocumentUpdated)({ document: `${types_1.COLLECTIONS.EVENTS}/{eventId}`, region: runtime_1.FUNCTION_REGION, secrets: secrets_1.ASSESSMENT_SECRETS }, async (trigger) => {
    const before = trigger.data?.before.data();
    const after = trigger.data?.after.data();
    if (!before || !after || after.status !== 'Pending')
        return;
    if (before.status === 'Pending' && before.currentVersionId === after.currentVersionId)
        return;
    try {
        await runRiskAndResourcePipeline(trigger.params.eventId);
    }
    catch (error) {
        firebase_functions_1.logger.error('[onEventUpdated] failed', error);
    }
});
//# sourceMappingURL=onEventCreated.js.map