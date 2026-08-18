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
const assessmentValidator_1 = require("../engines/assessmentValidator");
const resourceCalculator_1 = require("../engines/resourceCalculator");
const ruleBased_1 = require("../engines/ruleBased");
const holidays_1 = require("../utils/holidays");
const weather_1 = require("../utils/weather");
const secrets_1 = require("../config/secrets");
const runtime_1 = require("../config/runtime");
const CLAIM_LEASE_MS = 2 * 60 * 1000;
async function runRiskAndResourcePipeline(eventId, now = Date.now(), retryManual = false, retryAuthorization) {
    const db = (0, firebase_admin_1.firestore)();
    const eventReference = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const eventSnapshot = await eventReference.get();
    if (!eventSnapshot.exists)
        return { status: 'skipped', eventId, reason: 'event-not-found' };
    const event = { eventId, ...eventSnapshot.data() };
    if (event.status !== 'Pending' || !event.currentVersionId)
        return { status: 'skipped', eventId, reason: 'event-not-pending' };
    const versionId = event.currentVersionId;
    const versionReference = eventReference.collection(types_1.COLLECTIONS.VERSIONS).doc(versionId);
    const assessmentReference = eventReference.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(versionId);
    const summaryReference = eventReference.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).doc(versionId);
    const resourceReference = eventReference.collection(types_1.COLLECTIONS.RESOURCES).doc(versionId);
    const versionSnapshot = await versionReference.get();
    if (!versionSnapshot.exists) {
        await recordMissingVersionFailure(eventReference, assessmentReference, summaryReference, resourceReference, eventId, versionId, now);
        return { status: 'processed', eventId, versionId, reason: 'version-not-found' };
    }
    const version = versionSnapshot.data();
    const inputHash = processingHash(version.inputHash);
    const claimId = (0, node_crypto_1.randomUUID)();
    const claimed = await db.runTransaction(async (transaction) => {
        const retryUserReference = retryAuthorization
            ? db.collection(types_1.COLLECTIONS.USERS).doc(retryAuthorization.uid)
            : undefined;
        const [currentEventSnapshot, existingSnapshot, retryUserSnapshot] = await Promise.all([
            transaction.get(eventReference),
            transaction.get(assessmentReference),
            retryUserReference ? transaction.get(retryUserReference) : Promise.resolve(undefined),
        ]);
        const currentEvent = currentEventSnapshot.data();
        if (!currentEvent || currentEvent.status !== 'Pending' || currentEvent.currentVersionId !== versionId)
            return false;
        if (retryManual) {
            const retryUser = retryUserSnapshot?.data();
            if (!retryAuthorization
                || retryUser?.role !== 'authority'
                || retryUser.authorityType !== retryAuthorization.authorityType
                || !retryUser.authorityType
                || !currentEvent.requiredAuthorities.includes(retryUser.authorityType))
                return 'retry-not-authorized';
        }
        const existing = existingSnapshot.data();
        if (retryManual && existing?.status !== 'manual_review_required' && existing?.status !== 'failed') {
            return 'retry-not-retryable';
        }
        if (existing && ['provisional_ready', 'authority_review', 'official_ready'].includes(existing.status) && existing.inputHash === inputHash)
            return false;
        if (existing?.status === 'manual_review_required' && existing.inputHash === inputHash && !retryManual)
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
    if (claimed === 'retry-not-authorized')
        return { status: 'skipped', eventId, versionId, reason: claimed };
    if (claimed === 'retry-not-retryable')
        return { status: 'skipped', eventId, versionId, reason: claimed };
    if (!claimed)
        return { status: 'skipped', eventId, versionId, reason: 'already-claimed-or-ready' };
    try {
        const assessedEvent = { ...event, eventDetails: version.eventDetails };
        const [weather, incidentHistory, venue] = await Promise.all([
            (0, weather_1.fetchWeather)(version.eventDetails.venueLocation, version.eventDetails.venueName, version.eventDetails.startDatetime, { apiKey: secrets_1.OPENWEATHER_API_KEY.value() }),
            (0, ruleBased_1.fetchHistoricalContext)(assessedEvent),
            (0, ruleBased_1.fetchVenueContext)(version.eventDetails.venueId, version.eventDetails.venueName, version.eventDetails.venueCapacity),
        ]);
        const calendar = (0, holidays_1.getCalendarContext)(version.eventDetails.startDatetime);
        const contextSnapshot = { weather, calendar, venue, incidentHistory };
        const baseline = (0, ruleBased_1.computeCategoryBasedAssessment)(assessedEvent, contextSnapshot, Date.now());
        const createdAt = Date.now();
        const common = {
            assessmentId: versionId,
            eventId,
            versionId,
            schemaVersion: types_1.ASSESSMENT_SCHEMA_VERSION,
            contextSnapshot,
            evidence: baseline.evidence,
            sourceTimestamps: { weather: weather.fetchedAt, holiday: calendar.sourceTimestamp, venue: venue.fetchedAt, incidents: incidentHistory.fetchedAt },
            contextStatuses: {
                weather: `${weather.source}:${weather.freshness}`,
                holiday: calendar.sourceVersion,
                venue: venue.matched ? 'matched' : 'unmatched',
                incidents: incidentHistory.matched ? 'matched' : 'unmatched',
            },
            assessmentReadiness: baseline.assessmentReadiness ?? 'insufficient_data',
            complianceStatus: baseline.complianceStatus ?? 'review_required',
            complianceChecks: baseline.complianceChecks ?? [],
            dataConfidenceScore: baseline.dataConfidenceScore ?? 0,
            dataConfidenceLevel: baseline.dataConfidenceLevel ?? 'low',
            inputHash,
            createdAt,
        };
        let assessment;
        let resources;
        const readinessWarnings = [];
        if (common.assessmentReadiness === 'provisional')
            readinessWarnings.push({
                warningId: 'missing_evidence.assessment.provisional',
                code: 'missing_evidence',
                message: 'The assessment is provisional because one or more evidence sources are incomplete or stale.',
                evidenceReferences: [],
            });
        if (common.complianceStatus === 'blocked')
            readinessWarnings.push({
                warningId: 'rubric_conflict.compliance.blocked',
                code: 'rubric_conflict',
                message: 'A blocked compliance check prevents approval even when a provisional score is available.',
                evidenceReferences: ['compliance'],
            });
        if (common.assessmentReadiness === 'insufficient_data') {
            assessment = manualAssessment(common, null, [{
                    warningId: 'missing_evidence.assessment',
                    code: 'missing_evidence',
                    message: 'The application does not contain sufficient eligible evidence for AI assessment.',
                    evidenceReferences: [],
                }], 'Insufficient application evidence requires manual review.');
        }
        else {
            const aiProposal = await (0, aiPredictor_1.analyseWithAI)(secrets_1.MINIMAX_API_KEY.value(), assessedEvent, contextSnapshot, baseline);
            if (aiProposal.status !== 'success') {
                const failureWarnings = aiProposal.status === 'invalid' ? [{
                        warningId: 'invalid_calculation.ai.invalid-output',
                        code: 'invalid_calculation',
                        message: 'MiniMax returned output that did not satisfy the required assessment schema.',
                        evidenceReferences: [],
                    }] : [];
                assessment = manualAssessment(common, aiProposal, [...readinessWarnings, ...failureWarnings], `MiniMax ${aiProposal.status}: ${aiProposal.errorSummary}`);
            }
            else {
                const validation = (0, assessmentValidator_1.validateAndCalculateProvisional)(aiProposal, baseline, createdAt);
                if (!validation.ok) {
                    assessment = manualAssessment(common, aiProposal, [...readinessWarnings, ...validation.warnings], validation.reason);
                }
                else {
                    assessment = {
                        ...common,
                        status: 'provisional_ready',
                        aiProposal,
                        warnings: [...readinessWarnings, ...validation.warnings],
                        authorityReviewRequired: true,
                        provisionalResult: validation.result,
                    };
                    resources = provisionalResources(version, validation.result, baseline, aiProposal.categories.flatMap((category) => category.concerns), createdAt);
                }
            }
        }
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
            transaction.set(summaryReference, organizerSummary(assessment, resources, createdAt));
            if (resources)
                transaction.set(resourceReference, resources);
            else
                transaction.delete(resourceReference);
            transaction.update(eventReference, {
                currentAssessmentId: versionId,
                currentResourceId: resources ? versionId : firebase_admin_1.firestore.FieldValue.delete(),
                updatedAt: createdAt,
            });
            transaction.set(eventReference.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${versionId}-risk-score-computed-v3`), {
                id: `${versionId}-risk-score-computed-v3`, eventId, versionId, action: 'risk_score_computed', actorId: 'system', actorRole: 'system', timestamp: createdAt,
                metadata: {
                    assessmentStatus: assessment.status,
                    schemaVersion: types_1.ASSESSMENT_SCHEMA_VERSION,
                    provisionalScore: assessment.status === 'provisional_ready' ? assessment.provisionalResult.overallScore : null,
                    provisionalRiskLevel: assessment.status === 'provisional_ready' ? assessment.provisionalResult.overallRiskLevel : null,
                    aiStatus: assessment.aiProposal?.status ?? 'not-attempted',
                    inputHash,
                },
            });
            if (resources)
                transaction.set(eventReference.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${versionId}-resource-recommended-v3`), {
                    id: `${versionId}-resource-recommended-v3`, eventId, versionId, action: 'resource_recommended', actorId: 'system', actorRole: 'system', timestamp: createdAt,
                    metadata: { resourceId: versionId, assessmentStage: 'provisional', formulaVersion: types_1.RESOURCE_FORMULA_VERSION, guidelineVersion: types_1.RESOURCE_GUIDELINE_VERSION },
                });
            return true;
        });
        if (!finalized)
            return { status: 'skipped', eventId, versionId, reason: 'claim-lost-or-version-changed' };
        firebase_functions_1.logger.info(`[assessment] ${eventId}/${versionId}: status=${assessment.status}, ai=${assessment.aiProposal?.status ?? 'not-attempted'}`);
        return { status: 'processed', eventId, versionId };
    }
    catch (error) {
        await markFailed(assessmentReference, summaryReference, claimId, inputHash, error);
        throw error;
    }
}
async function recordMissingVersionFailure(eventReference, assessmentReference, summaryReference, resourceReference, eventId, versionId, now) {
    const inputHash = processingHash(`missing-version:${versionId}`);
    const claimId = (0, node_crypto_1.randomUUID)();
    await (0, firebase_admin_1.firestore)().runTransaction(async (transaction) => {
        const currentSnapshot = await transaction.get(eventReference);
        const current = currentSnapshot.data();
        if (!current || current.status !== 'Pending' || current.currentVersionId !== versionId)
            return;
        transaction.set(assessmentReference, {
            assessmentId: versionId,
            eventId,
            versionId,
            status: 'failed',
            inputHash,
            claimId,
            claimedAt: now,
            leaseExpiresAt: now,
            error: `Immutable event version ${versionId} was not found.`,
            createdAt: now,
        });
        transaction.set(summaryReference, {
            assessmentId: versionId, eventId, versionId, schemaVersion: types_1.ASSESSMENT_SCHEMA_VERSION,
            status: 'failed', categories: [], authorityReviewRequired: true, computedAt: now,
        });
        transaction.delete(resourceReference);
        transaction.update(eventReference, {
            currentAssessmentId: versionId,
            currentResourceId: firebase_admin_1.firestore.FieldValue.delete(),
            updatedAt: now,
        });
        transaction.set(eventReference.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${versionId}-risk-score-computed-v3`), {
            id: `${versionId}-risk-score-computed-v3`, eventId, versionId, action: 'risk_score_computed',
            actorId: 'system', actorRole: 'system', timestamp: now,
            metadata: { assessmentStatus: 'failed', schemaVersion: types_1.ASSESSMENT_SCHEMA_VERSION, inputHash, reason: 'version-not-found' },
        });
    });
}
function manualAssessment(common, aiProposal, warnings, reason) {
    return { ...common, status: 'manual_review_required', aiProposal, warnings, authorityReviewRequired: true, manualReviewReason: reason };
}
function provisionalResources(version, provisional, baseline, aiConsiderations, computedAt) {
    const compatible = {
        ...baseline,
        categoryAssignments: provisional.categories.map((category) => ({
            categoryId: category.categoryId,
            categoryName: category.categoryName,
            score: category.normalizedScore,
            riskLevel: category.riskLevel,
            weight: category.weight,
            weightedContribution: category.weightedContribution,
            rationale: category.rationale,
            evidenceKeys: category.evidenceReferences,
            guidelineChecks: category.guidelineChecks,
        })),
        officialScore: provisional.overallScore,
        officialRiskLevel: provisional.overallRiskLevel,
        computedAt,
    };
    const calculation = (0, resourceCalculator_1.computeResources)(version.eventDetails, compatible);
    return {
        resourceId: version.versionId,
        eventId: version.eventId,
        versionId: version.versionId,
        assessmentId: version.versionId,
        ...calculation.quantities,
        rationales: calculation.rationales,
        items: calculation.items,
        formulaVersion: types_1.RESOURCE_FORMULA_VERSION,
        guidelineVersion: types_1.RESOURCE_GUIDELINE_VERSION,
        guidelineStatus: 'prototype',
        aiConsiderations,
        confidenceLevel: 'prototype',
        assessmentStage: 'provisional',
        notes: 'Provisional planning ranges; authority validation and official assessment are pending.',
        computedAt,
    };
}
function processingHash(versionInputHash) {
    return (0, node_crypto_1.createHash)('sha256').update(JSON.stringify({
        versionInputHash,
        assessmentSchemaVersion: types_1.ASSESSMENT_SCHEMA_VERSION,
        categorySchemaVersion: types_1.CATEGORY_SCHEMA_VERSION,
        scoringLogicVersion: types_1.SCORING_LOGIC_VERSION,
        hardRuleVersion: types_1.HARD_RULE_VERSION,
        provisionalFormulaVersion: types_1.PROVISIONAL_FORMULA_VERSION,
        promptVersion: aiPredictor_1.PROMPT_VERSION,
        aiResponseSchemaVersion: aiPredictor_1.AI_RESPONSE_SCHEMA_VERSION,
        resourceFormulaVersion: types_1.RESOURCE_FORMULA_VERSION,
        resourceGuidelineVersion: types_1.RESOURCE_GUIDELINE_VERSION,
    })).digest('hex');
}
async function markFailed(reference, summaryReference, claimId, inputHash, error) {
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
        transaction.set(summaryReference, {
            assessmentId: current.assessmentId,
            eventId: current.eventId,
            versionId: current.versionId,
            schemaVersion: types_1.ASSESSMENT_SCHEMA_VERSION,
            status: 'failed',
            categories: [],
            authorityReviewRequired: true,
            computedAt: Date.now(),
        });
    });
}
function organizerSummary(assessment, resources, computedAt) {
    const result = assessment.status === 'official_ready'
        ? assessment.officialResult
        : assessment.status === 'provisional_ready' || assessment.status === 'authority_review'
            ? assessment.provisionalResult
            : undefined;
    return {
        assessmentId: assessment.assessmentId,
        eventId: assessment.eventId,
        versionId: assessment.versionId,
        schemaVersion: assessment.schemaVersion,
        status: assessment.status,
        ...(result ? { overallScore: result.overallScore, overallRiskLevel: result.overallRiskLevel } : {}),
        categories: result?.categories.map((category) => ({
            categoryId: category.categoryId,
            categoryName: category.categoryName,
            normalizedScore: category.normalizedScore,
            riskLevel: category.riskLevel,
        })) ?? [],
        assessmentReadiness: assessment.assessmentReadiness,
        complianceStatus: assessment.complianceStatus,
        authorityReviewRequired: assessment.authorityReviewRequired,
        ...(resources ? { resourceQuantities: {
                police: resources.police,
                security: resources.security,
                medicalTeams: resources.medicalTeams,
                ambulances: resources.ambulances,
                fireOfficers: resources.fireOfficers,
                toilets: resources.toilets,
                wasteBins: resources.wasteBins,
            } } : {}),
        computedAt,
    };
}
exports.onEventCreated = (0, firestore_1.onDocumentCreated)({ document: `${types_1.COLLECTIONS.EVENTS}/{eventId}`, region: runtime_1.FUNCTION_REGION, secrets: secrets_1.ASSESSMENT_SECRETS }, async (trigger) => {
    try {
        await runRiskAndResourcePipeline(trigger.params.eventId);
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