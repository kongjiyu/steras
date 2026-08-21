"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onEventUpdated = exports.onEventCreated = exports.__testOnlyManualLockState = exports.__testOnlyMarkFailed = void 0;
exports.runRiskAndResourcePipeline = runRiskAndResourcePipeline;
exports.invalidAiProposalForManualRecovery = invalidAiProposalForManualRecovery;
exports.recomputeResourceForStoredAssessment = recomputeResourceForStoredAssessment;
exports.resourceDocumentId = resourceDocumentId;
exports.nextResourceRevision = nextResourceRevision;
exports.latestValidHistoricalResource = latestValidHistoricalResource;
exports.isResourceEligibleAssessment = isResourceEligibleAssessment;
const node_crypto_1 = require("node:crypto");
const firebase_admin_1 = require("firebase-admin");
const firebase_functions_1 = require("firebase-functions");
const firestore_1 = require("firebase-functions/v2/firestore");
const types_1 = require("../../../shared/types");
const aiPredictor_1 = require("../engines/aiPredictor");
const assessmentValidator_1 = require("../engines/assessmentValidator");
const authorityFinalisation_1 = require("../engines/authorityFinalisation");
const manualFinalisation_1 = require("../engines/manualFinalisation");
const resourceCalculator_1 = require("../engines/resourceCalculator");
const resourceContract_1 = require("../engines/resourceContract");
const ruleBased_1 = require("../engines/ruleBased");
const holidays_1 = require("../utils/holidays");
const weather_1 = require("../utils/weather");
const secrets_1 = require("../config/secrets");
const runtime_1 = require("../config/runtime");
const resourceCutoverLock_1 = require("../config/resourceCutoverLock");
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
    if (!isSafeDocumentId(event.currentVersionId))
        return { status: 'skipped', eventId, reason: 'invalid-current-version' };
    const versionId = event.currentVersionId;
    const versionReference = eventReference.collection(types_1.COLLECTIONS.VERSIONS).doc(versionId);
    const assessmentReference = eventReference.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(versionId);
    const summaryReference = eventReference.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).doc(versionId);
    const versionSnapshot = await versionReference.get();
    if (!versionSnapshot.exists) {
        await recordMissingVersionFailure(eventReference, assessmentReference, summaryReference, eventId, versionId, now);
        return { status: 'processed', eventId, versionId, reason: 'version-not-found' };
    }
    const version = versionSnapshot.data();
    if (!isPipelineEventVersion(version, eventId, versionId)) {
        await recordMissingVersionFailure(eventReference, assessmentReference, summaryReference, eventId, versionId, now, 'invalid-version-contract');
        return { status: 'processed', eventId, versionId, reason: 'invalid-version-contract' };
    }
    const inputHash = processingHash(version.inputHash);
    const claimId = (0, node_crypto_1.randomUUID)();
    const claimed = await db.runTransaction(async (transaction) => {
        const retryUserReference = retryAuthorization
            ? db.collection(types_1.COLLECTIONS.USERS).doc(retryAuthorization.uid)
            : undefined;
        const [currentEventSnapshot, existingSnapshot, retryUserSnapshot, cutoverLockSnapshot] = await Promise.all([
            transaction.get(eventReference),
            transaction.get(assessmentReference),
            retryUserReference ? transaction.get(retryUserReference) : Promise.resolve(undefined),
            transaction.get(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH)),
        ]);
        if (cutoverLockSnapshot.exists)
            return false;
        const currentEvent = currentEventSnapshot.data();
        if (!currentEvent || currentEvent.status !== 'Pending' || currentEvent.currentVersionId !== versionId
            || (currentEvent.currentAssessmentId !== undefined && currentEvent.currentAssessmentId !== versionId))
            return false;
        if (retryManual) {
            const retryUser = retryUserSnapshot?.data();
            if (!retryAuthorization
                || retryUser?.role !== 'authority'
                || retryUser.authorityType !== retryAuthorization.authorityType
                || !retryUser.authorityType
                || !Array.isArray(currentEvent.requiredAuthorities)
                || !currentEvent.requiredAuthorities.includes(retryUser.authorityType))
                return 'retry-not-authorized';
        }
        const existing = existingSnapshot.data();
        if (retryManual && existing?.status !== 'manual_review_required' && existing?.status !== 'failed') {
            return 'retry-not-retryable';
        }
        const existingManualLock = manualLockState(existing);
        if (existingManualLock === 'invalid')
            return 'retry-not-retryable';
        if (existingManualLock === 'valid')
            return retryManual ? 'retry-not-retryable' : false;
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
    if (!claimed) {
        const resourceResult = await recomputeResourceForStoredAssessment(eventId, now);
        return {
            status: 'skipped',
            eventId,
            versionId,
            reason: resourceResult.status === 'failed' ? 'already-claimed-or-ready' : `assessment-ready-resource-${resourceResult.status}`,
        };
    }
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
        let resourceCalculation;
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
                    assessment = manualAssessment(common, invalidAiProposalForManualRecovery(aiProposal, validation.reason), [...readinessWarnings, ...validation.warnings], validation.reason);
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
                    resourceCalculation = (0, resourceCalculator_1.computeResources)({
                        eventId,
                        versionId,
                        assessmentId: assessment.assessmentId,
                        eventDetails: version.eventDetails,
                        assessmentResult: validation.result,
                    });
                }
            }
        }
        const finalized = await db.runTransaction(async (transaction) => {
            const [claimSnapshot, currentEventSnapshot, cutoverLockSnapshot] = await Promise.all([
                transaction.get(assessmentReference),
                transaction.get(eventReference),
                transaction.get(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH)),
            ]);
            const claim = claimSnapshot.data();
            const currentEvent = currentEventSnapshot.data();
            if (claim?.status !== 'processing' || claim.claimId !== claimId)
                return false;
            if (!currentEvent || currentEvent.status !== 'Pending' || currentEvent.currentVersionId !== versionId
                || (currentEvent.currentAssessmentId !== undefined && currentEvent.currentAssessmentId !== assessment.assessmentId))
                return false;
            // A manual assessment is an exclusive recovery path for this generation.
            // Never let a late AI transaction overwrite its persisted manual lock or
            // publish a provisional resource after Admin has claimed the assessment.
            if (manualLockState(claim) !== 'absent')
                return false;
            if (cutoverLockSnapshot.exists) {
                transaction.update(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH), {
                    queuedEvents: firebase_admin_1.firestore.FieldValue.arrayUnion((0, resourceCutoverLock_1.createResourceCutoverQueueToken)({
                        eventId,
                        currentVersionId: versionId,
                        currentAssessmentId: assessment.assessmentId,
                        assessmentInputHash: assessment.inputHash,
                        generationId: claimId,
                        queuedAt: createdAt,
                    })),
                });
            }
            transaction.set(assessmentReference, assessment);
            transaction.set(summaryReference, organizerSummary(assessment, undefined, createdAt));
            transaction.update(eventReference, {
                currentAssessmentId: versionId,
                currentResourceId: firebase_admin_1.firestore.FieldValue.delete(),
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
            return true;
        });
        if (!finalized)
            return { status: 'skipped', eventId, versionId, reason: 'claim-lost-or-version-changed' };
        if (assessment.status === 'provisional_ready' && resourceCalculation) {
            await persistResourceCalculation(eventReference, version, assessment, resourceCalculation, createdAt);
        }
        firebase_functions_1.logger.info(`[assessment] ${eventId}/${versionId}: status=${assessment.status}, ai=${assessment.aiProposal?.status ?? 'not-attempted'}`);
        return { status: 'processed', eventId, versionId };
    }
    catch (error) {
        await markFailed(eventReference, assessmentReference, summaryReference, claimId, inputHash, error);
        throw error;
    }
}
async function recordMissingVersionFailure(eventReference, assessmentReference, summaryReference, eventId, versionId, now, reason = 'version-not-found') {
    const db = (0, firebase_admin_1.firestore)();
    const inputHash = processingHash(`${reason}:${versionId}`);
    const claimId = (0, node_crypto_1.randomUUID)();
    await db.runTransaction(async (transaction) => {
        const [currentSnapshot, assessmentSnapshot, cutoverLockSnapshot] = await Promise.all([
            transaction.get(eventReference),
            transaction.get(assessmentReference),
            transaction.get(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH)),
        ]);
        const current = currentSnapshot.data();
        if (!current || current.status !== 'Pending' || current.currentVersionId !== versionId
            || (current.currentAssessmentId !== undefined && current.currentAssessmentId !== versionId))
            return;
        if (manualLockState(assessmentSnapshot.data()) !== 'absent')
            return;
        if (cutoverLockSnapshot.exists)
            transaction.update(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH), {
                queuedEvents: firebase_admin_1.firestore.FieldValue.arrayUnion((0, resourceCutoverLock_1.createResourceCutoverQueueToken)({
                    eventId, currentVersionId: versionId, currentAssessmentId: versionId,
                    assessmentInputHash: inputHash, generationId: claimId, queuedAt: now,
                })),
            });
        transaction.set(assessmentReference, {
            assessmentId: versionId,
            eventId,
            versionId,
            status: 'failed',
            inputHash,
            claimId,
            claimedAt: now,
            leaseExpiresAt: now,
            error: reason === 'version-not-found'
                ? `Immutable event version ${versionId} was not found.`
                : `Immutable event version ${versionId} failed runtime contract validation.`,
            createdAt: now,
        });
        transaction.set(summaryReference, {
            assessmentId: versionId, eventId, versionId, schemaVersion: types_1.ASSESSMENT_SCHEMA_VERSION,
            status: 'failed', categories: [], authorityReviewRequired: true, computedAt: now,
        });
        transaction.update(eventReference, {
            currentAssessmentId: versionId,
            currentResourceId: firebase_admin_1.firestore.FieldValue.delete(),
            updatedAt: now,
        });
        transaction.set(eventReference.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${versionId}-risk-score-computed-v3`), {
            id: `${versionId}-risk-score-computed-v3`, eventId, versionId, action: 'risk_score_computed',
            actorId: 'system', actorRole: 'system', timestamp: now,
            metadata: { assessmentStatus: 'failed', schemaVersion: types_1.ASSESSMENT_SCHEMA_VERSION, inputHash, reason },
        });
    });
}
function isPipelineEventVersion(value, eventId, versionId) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const version = value;
    const details = version.eventDetails;
    if (version.eventId !== eventId || version.versionId !== versionId
        || !Number.isSafeInteger(version.versionNumber) || Number(version.versionNumber) < 1
        || !Array.isArray(version.documentPaths) || !version.documentPaths.every((path) => typeof path === 'string')
        || typeof version.submittedBy !== 'string' || !version.submittedBy.trim()
        || !Number.isFinite(version.submittedAt)
        || typeof version.inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(version.inputHash)
        || !details || typeof details !== 'object' || Array.isArray(details))
        return false;
    const eventDetails = details;
    return typeof eventDetails.name === 'string' && Boolean(eventDetails.name.trim())
        && typeof eventDetails.type === 'string' && Boolean(eventDetails.type.trim())
        && typeof eventDetails.venueName === 'string' && Boolean(eventDetails.venueName.trim())
        && typeof eventDetails.venueAddress === 'string' && Boolean(eventDetails.venueAddress.trim())
        && Number.isFinite(eventDetails.venueCapacity) && Number(eventDetails.venueCapacity) >= 0
        && Number.isFinite(eventDetails.expectedAttendance) && Number(eventDetails.expectedAttendance) >= 0
        && ['indoor', 'outdoor', 'mixed'].includes(String(eventDetails.environment))
        && ['covered', 'partially_covered', 'uncovered'].includes(String(eventDetails.coverage))
        && ['seated', 'standing', 'mixed'].includes(String(eventDetails.seating))
        && Number.isFinite(eventDetails.startDatetime) && Number.isFinite(eventDetails.endDatetime)
        && Number(eventDetails.endDatetime) >= Number(eventDetails.startDatetime)
        && typeof eventDetails.emergencyPlanSummary === 'string';
}
function manualAssessment(common, aiProposal, warnings, reason) {
    return { ...common, status: 'manual_review_required', aiProposal, warnings, authorityReviewRequired: true, manualReviewReason: reason };
}
function manualLockState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !Object.prototype.hasOwnProperty.call(value, 'activeManualAssessmentId'))
        return 'absent';
    const id = value.activeManualAssessmentId;
    return isSafeManualAssessmentId(id) ? 'valid' : 'invalid';
}
function isSafeManualAssessmentId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function isSafeDocumentId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
/**
 * A syntactically valid MiniMax response can still fail deterministic validation
 * (for example, because all of a category's evidence references are unsupported).
 * Do not persist that response as a successful proposal: its scores are not an
 * eligible input for manual recovery. Preserve only the attempt metadata and a
 * bounded validation error so Admin can retry or provide an assessment without
 * treating invalid AI output as an authoritative proposal.
 */
function invalidAiProposalForManualRecovery(proposal, reason) {
    const model = typeof proposal.model === 'string' && proposal.model.trim() ? proposal.model : 'unknown';
    const promptVersion = typeof proposal.promptVersion === 'string' && proposal.promptVersion.trim()
        ? proposal.promptVersion
        : aiPredictor_1.PROMPT_VERSION;
    const responseSchemaVersion = typeof proposal.responseSchemaVersion === 'string' && proposal.responseSchemaVersion.trim()
        ? proposal.responseSchemaVersion
        : aiPredictor_1.AI_RESPONSE_SCHEMA_VERSION;
    return {
        status: 'invalid',
        model,
        promptVersion,
        responseSchemaVersion,
        retryable: true,
        errorSummary: `MiniMax proposal failed deterministic validation: ${reason}`.slice(0, 500),
        cacheStatus: 'not-applicable',
        generatedAt: Number.isFinite(proposal.generatedAt) ? proposal.generatedAt : Date.now(),
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
    })).digest('hex');
}
async function markFailed(eventReference, reference, summaryReference, claimId, inputHash, error) {
    const db = (0, firebase_admin_1.firestore)();
    await db.runTransaction(async (transaction) => {
        const [snapshot, cutoverLockSnapshot, eventSnapshot] = await Promise.all([
            transaction.get(reference),
            transaction.get(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH)),
            transaction.get(eventReference),
        ]);
        const current = snapshot.data();
        if (current?.status !== 'processing' || current.claimId !== claimId)
            return;
        if (manualLockState(current) !== 'absent')
            return;
        const event = eventSnapshot.data();
        const failureAssessment = {
            ...current,
            status: 'failed',
            inputHash,
            error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown assessment failure',
            leaseExpiresAt: Date.now(),
        };
        if (!event || event.status !== 'Pending' || event.currentVersionId !== current.versionId
            || (event.currentAssessmentId !== undefined && event.currentAssessmentId !== current.assessmentId)) {
            transaction.set(reference, failureAssessment);
            return;
        }
        if (cutoverLockSnapshot.exists)
            transaction.update(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH), {
                queuedEvents: firebase_admin_1.firestore.FieldValue.arrayUnion((0, resourceCutoverLock_1.createResourceCutoverQueueToken)({
                    eventId: current.eventId, currentVersionId: current.versionId, currentAssessmentId: current.assessmentId,
                    assessmentInputHash: inputHash, generationId: claimId, queuedAt: Date.now(),
                })),
            });
        transaction.set(reference, failureAssessment);
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
        transaction.update(eventReference, {
            currentAssessmentId: current.assessmentId,
            currentResourceId: firebase_admin_1.firestore.FieldValue.delete(),
            updatedAt: Date.now(),
        });
    });
}
/** Transaction-level race harness; not exported from the deployed Functions entrypoint. */
exports.__testOnlyMarkFailed = markFailed;
exports.__testOnlyManualLockState = manualLockState;
function organizerSummary(assessment, resources, computedAt) {
    const result = assessment.status === 'official_ready'
        ? assessment.officialResult
        : assessment.status === 'provisional_ready' || assessment.status === 'authority_review'
            ? assessment.provisionalResult
            : undefined;
    const reviewState = 'authorityReviewState' in assessment ? assessment.authorityReviewState : undefined;
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
        ...(assessment.assessmentReadiness ? { assessmentReadiness: assessment.assessmentReadiness } : {}),
        ...(assessment.complianceStatus ? { complianceStatus: assessment.complianceStatus } : {}),
        authorityReviewRequired: assessment.authorityReviewRequired
            ?? assessment.status !== 'official_ready',
        ...(reviewState ? {
            authorityReviewProgress: {
                completed: Object.keys(reviewState.activeReviewHeads).length,
                required: reviewState.requiredAuthorities.length,
            },
        } : {}),
        ...(resources ? {
            resourceQuantities: resourceQuantities(resources),
            resourceRecommendation: organizerResourceRecommendation(resources),
        } : {}),
        computedAt,
    };
}
async function recomputeResourceForStoredAssessment(eventId, now = Date.now(), hooks = {}) {
    const db = (0, firebase_admin_1.firestore)();
    const eventReference = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const eventSnapshot = await eventReference.get();
    const event = eventSnapshot.exists ? { eventId, ...eventSnapshot.data() } : undefined;
    if (!event?.currentVersionId || !event.currentAssessmentId)
        return { status: 'failed', reason: 'missing-current-input' };
    if (!isSafeDocumentId(event.currentVersionId) || !isSafeDocumentId(event.currentAssessmentId)
        || (event.currentResourceId !== undefined && !isSafeDocumentId(event.currentResourceId))) {
        return { status: 'failed', reason: 'invalid-current-pointers' };
    }
    const [versionSnapshot, assessmentSnapshot] = await Promise.all([
        eventReference.collection(types_1.COLLECTIONS.VERSIONS).doc(event.currentVersionId).get(),
        eventReference.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId).get(),
    ]);
    const version = versionSnapshot.data();
    const assessment = assessmentSnapshot.data();
    if (!version
        || version.versionId !== event.currentVersionId
        || version.eventId !== eventId
        || !isResourceEligibleAssessment(assessment, eventId, version.versionId, version.eventDetails)) {
        return { status: 'failed', reason: 'provisional-assessment-not-ready' };
    }
    const assessmentResult = resourceAssessmentResult(assessment);
    const calculation = (0, resourceCalculator_1.computeResources)({
        eventId,
        versionId: version.versionId,
        assessmentId: assessment.assessmentId,
        eventDetails: version.eventDetails,
        assessmentResult,
    });
    await hooks.beforePersist?.();
    return persistResourceCalculation(eventReference, version, assessment, calculation, now, hooks.cutoverSessionId);
}
async function persistResourceCalculation(eventReference, version, assessment, calculation, computedAt, cutoverSessionId) {
    const db = (0, firebase_admin_1.firestore)();
    if (!calculation.ok) {
        const failureId = `${version.versionId}-resource-calculation-${calculation.code}-${computedAt}-${(0, node_crypto_1.randomUUID)()}`;
        const failurePersisted = await db.runTransaction(async (transaction) => {
            const assessmentReference = eventReference.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(assessment.assessmentId);
            const [currentSnapshot, currentAssessmentSnapshot, cutoverLockSnapshot] = await Promise.all([
                transaction.get(eventReference),
                transaction.get(assessmentReference),
                transaction.get(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH)),
            ]);
            const current = currentSnapshot.data();
            const currentAssessment = currentAssessmentSnapshot.data();
            const leaseNow = Date.now();
            const cutoverAllowed = cutoverSessionId
                ? cutoverLockSnapshot.exists
                    && cutoverLockSnapshot.data()?.active === true
                    && cutoverLockSnapshot.data()?.sessionId === cutoverSessionId
                    && Number.isFinite(cutoverLockSnapshot.data()?.leaseExpiresAt)
                    && cutoverLockSnapshot.data().leaseExpiresAt > leaseNow
                : !cutoverLockSnapshot.exists;
            if (!cutoverAllowed)
                return false;
            if (!(current?.currentVersionId === version.versionId
                && current.currentAssessmentId === assessment.assessmentId
                && isSameResourceAssessment(currentAssessment, assessment, version.eventDetails)))
                return false;
            if (!await officialAssessmentProvenanceMatches(transaction, eventReference, current, version, currentAssessment))
                return false;
            transaction.update(eventReference, { currentResourceId: firebase_admin_1.firestore.FieldValue.delete(), updatedAt: computedAt });
            transaction.set(eventReference.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).doc(version.versionId), organizerSummary(assessment, undefined, computedAt));
            transaction.create(eventReference.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(failureId), {
                id: failureId,
                eventId: version.eventId,
                versionId: version.versionId,
                action: 'resource_recommended',
                actorId: 'system',
                actorRole: 'system',
                timestamp: computedAt,
                metadata: { outcome: 'failed', code: calculation.code, reason: calculation.message, schemaVersion: types_1.RESOURCE_SCHEMA_VERSION },
            });
            return true;
        });
        if (!failurePersisted)
            return { status: 'failed', reason: 'resource-cutover-fencing-failed' };
        return { status: 'failed', reason: calculation.code };
    }
    const stage = assessment.status === 'official_ready' ? 'official' : 'provisional';
    const resourceId = resourceDocumentId(stage, version.versionId, calculation.resourceInputHash);
    return db.runTransaction(async (transaction) => {
        const assessmentReference = eventReference.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(assessment.assessmentId);
        const [currentEventSnapshot, currentAssessmentSnapshot, cutoverLockSnapshot] = await Promise.all([
            transaction.get(eventReference),
            transaction.get(assessmentReference),
            transaction.get(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH)),
        ]);
        const currentEvent = currentEventSnapshot.data();
        const currentAssessment = currentAssessmentSnapshot.data();
        const leaseNow = Date.now();
        const cutoverAllowed = cutoverSessionId
            ? cutoverLockSnapshot.exists
                && cutoverLockSnapshot.data()?.active === true
                && cutoverLockSnapshot.data()?.sessionId === cutoverSessionId
                && Number.isFinite(cutoverLockSnapshot.data()?.leaseExpiresAt)
                && cutoverLockSnapshot.data().leaseExpiresAt > leaseNow
            : !cutoverLockSnapshot.exists;
        if (!cutoverAllowed) {
            return { status: 'failed', reason: cutoverSessionId
                    ? 'resource-cutover-fencing-failed'
                    : 'resource-cutover-in-progress' };
        }
        if (!currentEvent
            || !['Pending', 'UnderReview'].includes(currentEvent.status)
            || currentEvent.currentVersionId !== version.versionId
            || currentEvent.currentAssessmentId !== assessment.assessmentId
            || !isResourceEligibleAssessment(currentAssessment, version.eventId, version.versionId, version.eventDetails)
            || !isSameResourceAssessment(currentAssessment, assessment, version.eventDetails)) {
            return { status: 'failed', reason: 'event-or-assessment-changed' };
        }
        if (!await officialAssessmentProvenanceMatches(transaction, eventReference, currentEvent, version, currentAssessment)) {
            return { status: 'failed', reason: 'official-provenance-invalid' };
        }
        const currentCalculation = (0, resourceCalculator_1.computeResources)({
            eventId: version.eventId,
            versionId: version.versionId,
            assessmentId: currentAssessment.assessmentId,
            eventDetails: version.eventDetails,
            assessmentResult: resourceAssessmentResult(currentAssessment),
        });
        if (!currentCalculation.ok || currentCalculation.resourceInputHash !== calculation.resourceInputHash) {
            return { status: 'failed', reason: 'event-or-assessment-changed' };
        }
        const resourceReference = eventReference.collection(types_1.COLLECTIONS.RESOURCES).doc(resourceId);
        const [existingSnapshot, historicalSnapshot] = await Promise.all([
            transaction.get(resourceReference),
            transaction.get(eventReference.collection(types_1.COLLECTIONS.RESOURCES)
                .where('versionId', '==', version.versionId)
                .where('stage', '==', stage)),
        ]);
        const history = historicalSnapshot.docs
            .map((document) => (0, resourceContract_1.validateResourceRecommendation)(document.data()).ok
            ? document.data()
            : undefined)
            .filter((resource) => Boolean(resource));
        if (history.length !== historicalSnapshot.size
            || historicalSnapshot.docs.some((document) => document.data()?.resourceId !== document.id)
            || history.some((resource) => resource.eventId !== version.eventId
                || resource.versionId !== version.versionId || resource.stage !== stage)) {
            return { status: 'failed', reason: 'invalid-resource-history' };
        }
        const historyTip = latestValidHistoricalResource(history);
        const chainPointer = currentEvent.currentResourceId ?? historyTip?.resourceId;
        if (history.length > 0 && (!chainPointer
            || (0, resourceContract_1.validateResourceRevisionChain)(history, chainPointer).length > 0)) {
            return { status: 'failed', reason: 'invalid-resource-revision-chain' };
        }
        if (existingSnapshot.exists) {
            const existing = existingSnapshot.data();
            if (existing.resourceInputHash !== calculation.resourceInputHash
                || existing.stage !== stage
                || existing.eventId !== version.eventId
                || existing.versionId !== version.versionId
                || existing.assessmentId !== currentAssessment.assessmentId
                || existing.assessmentReference.stage !== stage
                || !resourceReferenceMatches(existing, currentAssessment)
                || existing.formulaVersion !== calculation.formulaVersion
                || existing.configVersion !== calculation.configVersion
                || existing.sourceRegistryVersion !== calculation.sourceRegistryVersion
                || (0, resourceCalculator_1.stableStringify)(existing.items) !== (0, resourceCalculator_1.stableStringify)(resourceItemsForStage(stage, calculation.items))) {
                return { status: 'failed', reason: 'resource-id-collision' };
            }
            if (!(0, resourceContract_1.validateResourceRecommendation)(existing).ok)
                return { status: 'failed', reason: 'invalid-existing-resource' };
            const pointedResource = chainPointer && chainPointer !== resourceId
                ? history.find((resource) => resource.resourceId === chainPointer)
                : undefined;
            if (pointedResource && (!(0, resourceContract_1.validateResourceRecommendation)(pointedResource).ok
                || pointedResource.eventId !== version.eventId
                || pointedResource.versionId !== version.versionId
                || pointedResource.stage !== stage)) {
                return { status: 'failed', reason: 'invalid-current-resource' };
            }
            if (pointedResource && pointedResource.revision === existing.revision
                && pointedResource.resourceId !== existing.resourceId) {
                return { status: 'failed', reason: 'ambiguous-resource-revision' };
            }
            if (pointedResource && pointedResource.revision > existing.revision) {
                transaction.set(eventReference.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).doc(version.versionId), organizerSummary(currentAssessment, pointedResource, computedAt));
                return { status: 'reused', resourceId: pointedResource.resourceId };
            }
            if (currentEvent.currentResourceId !== resourceId) {
                transaction.update(eventReference, { currentResourceId: resourceId, updatedAt: computedAt });
            }
            transaction.set(eventReference.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).doc(version.versionId), organizerSummary(currentAssessment, existing, computedAt));
            return { status: 'reused', resourceId };
        }
        const previousId = currentEvent.currentResourceId && currentEvent.currentResourceId !== resourceId
            ? currentEvent.currentResourceId
            : undefined;
        const previousSnapshot = previousId
            ? await transaction.get(eventReference.collection(types_1.COLLECTIONS.RESOURCES).doc(previousId))
            : undefined;
        if (previousId && !previousSnapshot?.exists) {
            return { status: 'failed', reason: 'dangling-current-resource' };
        }
        const previousCandidate = previousSnapshot?.exists ? previousSnapshot.data() : undefined;
        if (previousCandidate && (!(0, resourceContract_1.validateResourceRecommendation)(previousCandidate).ok
            || previousCandidate.eventId !== version.eventId
            || previousCandidate.versionId !== version.versionId
            || previousCandidate.stage !== stage)) {
            return { status: 'failed', reason: 'invalid-current-resource' };
        }
        const previous = previousCandidate
            ? previousCandidate
            : historyTip;
        if (previous?.revision === Number.MAX_SAFE_INTEGER) {
            return { status: 'failed', reason: 'resource-revision-overflow' };
        }
        const nextRevision = nextResourceRevision(previous);
        const recommendationItems = resourceItemsForStage(stage, calculation.items);
        const recommendationBase = {
            resourceId,
            eventId: version.eventId,
            versionId: version.versionId,
            assessmentId: currentAssessment.assessmentId,
            schemaVersion: types_1.RESOURCE_SCHEMA_VERSION,
            revision: nextRevision.revision,
            supersedesResourceId: nextRevision.supersedesResourceId,
            resourceInputHash: calculation.resourceInputHash,
            formulaVersion: calculation.formulaVersion,
            configVersion: calculation.configVersion,
            sourceRegistryVersion: calculation.sourceRegistryVersion,
            items: recommendationItems,
            computedAt,
        };
        const recommendation = stage === 'official'
            ? {
                ...recommendationBase,
                stage: 'official',
                assessmentReference: officialResourceReference(currentAssessment),
                confidenceLevel: 'authority_validated',
                authorityReviewRequired: false,
                notes: 'Official deterministic planning ranges based on finalized human-reviewed risk scores.',
            }
            : {
                ...recommendationBase,
                stage: 'provisional',
                assessmentReference: {
                    stage: 'provisional',
                    assessmentId: currentAssessment.assessmentId,
                    proposalId: resourceProposalId(currentAssessment),
                },
                confidenceLevel: 'prototype',
                authorityReviewRequired: true,
                notes: 'Provisional internal prototype planning ranges; authority validation and official assessment are pending.',
            };
        transaction.create(resourceReference, recommendation);
        transaction.update(eventReference, { currentResourceId: resourceId, updatedAt: computedAt });
        transaction.set(eventReference.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).doc(version.versionId), organizerSummary(currentAssessment, recommendation, computedAt));
        const auditReference = eventReference.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${resourceId}-recommended`);
        transaction.create(auditReference, {
            id: auditReference.id,
            eventId: version.eventId,
            versionId: version.versionId,
            action: 'resource_recommended',
            actorId: 'system',
            actorRole: 'system',
            timestamp: computedAt,
            metadata: {
                resourceId,
                previousResourceId: previous?.resourceId ?? null,
                assessmentId: currentAssessment.assessmentId,
                stage,
                schemaVersion: types_1.RESOURCE_SCHEMA_VERSION,
                formulaVersion: types_1.RESOURCE_FORMULA_VERSION,
                configVersion: types_1.RESOURCE_CONFIG_VERSION,
                sourceRegistryVersion: types_1.RESOURCE_SOURCE_REGISTRY_VERSION,
                resourceInputHash: calculation.resourceInputHash,
            },
        });
        return { status: 'created', resourceId };
    });
}
function resourceDocumentId(stage, versionId, resourceInputHash) {
    return `${stage}-${versionId}-${resourceInputHash}`;
}
function nextResourceRevision(previous) {
    if (previous && (!Number.isSafeInteger(previous.revision)
        || previous.revision < 1
        || previous.revision >= Number.MAX_SAFE_INTEGER)) {
        throw new Error('Cannot create a resource revision after an invalid or exhausted revision number.');
    }
    return {
        revision: previous ? previous.revision + 1 : 1,
        supersedesResourceId: previous?.resourceId ?? null,
    };
}
function latestValidHistoricalResource(values) {
    return values
        ?.map((value) => (0, resourceContract_1.validateResourceRecommendation)(value).ok ? value : undefined)
        .filter((value) => Boolean(value))
        .sort((left, right) => right.revision - left.revision || right.computedAt - left.computedAt)[0];
}
function isResourceEligibleAssessment(value, eventId, versionId, eventDetails) {
    if (!value || typeof value !== 'object')
        return false;
    const raw = value;
    if (raw.status === 'official_ready' && raw.sourceKind === 'admin_manual') {
        const assessment = value;
        try {
            return assessment.schemaVersion === types_1.ASSESSMENT_SCHEMA_VERSION
                && assessment.eventId === eventId && assessment.versionId === versionId
                && assessment.authorityReviewRequired === false
                && Number.isFinite(assessment.createdAt)
                && ['complete', 'provisional', 'insufficient_data'].includes(assessment.assessmentReadiness)
                && ['pass', 'review_required', 'blocked'].includes(assessment.complianceStatus)
                && Number.isFinite(assessment.dataConfidenceScore)
                && ['low', 'medium', 'high'].includes(assessment.dataConfidenceLevel)
                && typeof assessment.assessmentId === 'string' && Boolean(assessment.assessmentId)
                && isSafeManualAssessmentId(assessment.activeManualAssessmentId)
                && assessment.officialResult?.sourceKind === 'admin_manual'
                && assessment.officialResult.manualAssessmentId === assessment.activeManualAssessmentId
                && (assessment.aiProposal === null
                    ? assessment.assessmentReadiness === 'insufficient_data'
                    : assessment.aiProposal.status !== 'success')
                && Boolean(assessment.contextSnapshot) && Array.isArray(assessment.evidence)
                && (0, resourceCalculator_1.validateManualOfficialAssessmentResult)(assessment.officialResult).length === 0;
        }
        catch {
            return false;
        }
    }
    const assessment = value;
    const isCalculatedStatus = assessment.status === 'provisional_ready'
        || assessment.status === 'authority_review'
        || assessment.status === 'official_ready';
    if (!(isCalculatedStatus
        && assessment.schemaVersion === types_1.ASSESSMENT_SCHEMA_VERSION
        && assessment.eventId === eventId
        && assessment.versionId === versionId
        && typeof assessment.assessmentId === 'string' && assessment.assessmentId.length > 0
        && assessment.aiProposal?.status === 'success'
        && Array.isArray(assessment.aiProposal.categories)
        && Array.isArray(assessment.aiProposal.hazards)
        && assessment.aiProposal.proposalId === assessment.provisionalResult?.proposalId
        && Boolean(assessment.provisionalResult)
        && assessment.contextSnapshot
        && Array.isArray(assessment.evidence)
        && (0, resourceCalculator_1.validateProvisionalAssessmentResult)(assessment.provisionalResult).length === 0))
        return false;
    if (assessment.status === 'official_ready' && (!assessment.officialResult
        || assessment.officialResult.officialFormulaVersion !== types_1.OFFICIAL_FORMULA_VERSION
        || assessment.officialResult.proposalId !== assessment.aiProposal?.proposalId
        || !/^[a-f0-9]{64}$/.test(assessment.officialResult.officialInputHash)))
        return false;
    const result = assessment.status === 'official_ready'
        ? assessment.officialResult
        : assessment.provisionalResult;
    const proposal = assessment.aiProposal;
    if ((0, resourceCalculator_1.validateProvisionalAssessmentResult)(result).length > 0)
        return false;
    try {
        const eligibleEvidence = new Set(assessment.evidence
            .filter((item) => item && typeof item.status === 'string'
            && item.quality !== 'missing'
            && !['unavailable', 'unmatched', 'missing'].includes(item.status.trim().toLowerCase()))
            .map((item) => item.key));
        if (result.categories.some((category) => category.evidenceReferences.some((reference) => !eligibleEvidence.has(reference)))
            || result.validatedHazards.some((hazard) => hazard.evidenceReferences.some((reference) => !eligibleEvidence.has(reference))))
            return false;
        const baseline = (0, ruleBased_1.computeCategoryBasedAssessment)({ eventId, eventDetails }, assessment.contextSnapshot, assessment.createdAt);
        return (0, resourceCalculator_1.validateAssessmentResultAgainstProposal)(result, proposal).length === 0
            && (0, resourceCalculator_1.validateAssessmentResultAgainstHardRules)(result, baseline).length === 0;
    }
    catch {
        return false;
    }
}
function isSameResourceAssessment(current, expected, eventDetails) {
    if (!isResourceEligibleAssessment(current, expected.eventId, expected.versionId, eventDetails))
        return false;
    if (isManualOfficialAssessment(current) || isManualOfficialAssessment(expected)) {
        return isManualOfficialAssessment(current) && isManualOfficialAssessment(expected)
            && current.inputHash === expected.inputHash
            && current.activeManualAssessmentId === expected.activeManualAssessmentId
            && current.officialResult.officialInputHash === expected.officialResult.officialInputHash
            && current.status === expected.status;
    }
    const currentAi = current;
    const expectedAi = expected;
    return currentAi.inputHash === expectedAi.inputHash
        && currentAi.aiProposal.proposalId === expectedAi.aiProposal.proposalId
        && resourceProposalId(currentAi) === resourceProposalId(expectedAi)
        && resourceAssessmentResult(current).calculatedAt === resourceAssessmentResult(expected).calculatedAt
        && current.status === expected.status;
}
function resourceAssessmentResult(assessment) {
    return assessment.status === 'official_ready' ? assessment.officialResult : assessment.provisionalResult;
}
function resourceProposalId(assessment) {
    if (isManualOfficialAssessment(assessment))
        throw new Error('manual-official-has-no-proposal');
    return assessment.status === 'official_ready'
        ? assessment.officialResult.proposalId
        : assessment.provisionalResult.proposalId;
}
async function officialAssessmentProvenanceMatches(transaction, eventReference, event, version, value) {
    if (!value || typeof value !== 'object' || value.status !== 'official_ready')
        return true;
    if (isManualOfficialAssessment(value)) {
        const manualReference = eventReference.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(value.assessmentId)
            .collection(types_1.COLLECTIONS.MANUAL_ASSESSMENTS).doc(value.activeManualAssessmentId);
        const manualSnapshot = await transaction.get(manualReference);
        const manual = manualSnapshot.data();
        if (!manual || manual.manualAssessmentId !== value.activeManualAssessmentId)
            return false;
        try {
            const expected = (0, manualFinalisation_1.buildManualOfficialAssessmentResult)({
                assessment: value,
                manualAssessment: manual, eventDetails: version.eventDetails, eventVersionInputHash: version.inputHash,
                finalizedAt: value.officialResult.finalizedAt, finalizedBy: value.officialResult.finalizedBy,
            });
            return (0, resourceCalculator_1.stableStringify)(expected) === (0, resourceCalculator_1.stableStringify)(value.officialResult);
        }
        catch {
            return false;
        }
    }
    const assessment = value;
    const state = assessment.authorityReviewState;
    if (!state
        || (0, resourceCalculator_1.stableStringify)(state.requiredAuthorities) !== (0, resourceCalculator_1.stableStringify)(event.requiredAuthorities)
        || state.requiredAuthorities.length === 0)
        return false;
    const reviewIds = event.requiredAuthorities.map((authority) => state.activeReviewHeads[authority]?.reviewId);
    if (reviewIds.some((reviewId) => !reviewId))
        return false;
    const reviewReferences = reviewIds.map((reviewId) => eventReference.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(assessment.assessmentId)
        .collection(types_1.COLLECTIONS.SCORE_REVIEWS).doc(reviewId));
    const resolutionReference = state.activeResolutionId
        ? eventReference.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(assessment.assessmentId)
            .collection(types_1.COLLECTIONS.SCORE_RESOLUTIONS).doc(state.activeResolutionId)
        : undefined;
    const [reviewSnapshots, resolutionSnapshot] = await Promise.all([
        transaction.getAll(...reviewReferences),
        resolutionReference ? transaction.get(resolutionReference) : Promise.resolve(undefined),
    ]);
    if (reviewSnapshots.some((snapshot) => {
        const review = snapshot.data();
        return !snapshot.exists || !review || typeof review !== 'object' || Array.isArray(review) || review.reviewId !== snapshot.id;
    })
        || (resolutionReference && (!resolutionSnapshot
            || !resolutionSnapshot.exists
            || !resolutionSnapshot.data()
            || typeof resolutionSnapshot.data() !== 'object'
            || Array.isArray(resolutionSnapshot.data())
            || resolutionSnapshot.data()?.resolutionId !== resolutionSnapshot.id)))
        return false;
    try {
        const expected = (0, authorityFinalisation_1.buildOfficialAssessmentResult)({
            assessment,
            eventDetails: version.eventDetails,
            requiredAuthorities: event.requiredAuthorities,
            reviews: reviewSnapshots.map((snapshot) => snapshot.data()),
            resolution: resolutionSnapshot?.data(),
            finalizedAt: assessment.officialResult.finalizedAt,
            finalizedBy: assessment.officialResult.finalizedBy,
        });
        return (0, resourceCalculator_1.stableStringify)(expected) === (0, resourceCalculator_1.stableStringify)(assessment.officialResult);
    }
    catch {
        return false;
    }
}
function isManualOfficialAssessment(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const record = value;
    const activeManualAssessmentId = record.activeManualAssessmentId;
    const result = record.officialResult;
    return record.status === 'official_ready'
        && record.sourceKind === 'admin_manual'
        && record.authorityReviewRequired === false
        && isSafeManualAssessmentId(activeManualAssessmentId)
        && typeof result === 'object' && result !== null && !Array.isArray(result)
        && result.sourceKind === 'admin_manual'
        && result.manualAssessmentId === activeManualAssessmentId
        && (0, resourceCalculator_1.validateManualOfficialAssessmentResult)(result).length === 0;
}
function officialResourceReference(assessment) {
    return isManualOfficialAssessment(assessment)
        ? { stage: 'official', assessmentId: assessment.assessmentId, sourceKind: 'admin_manual', manualAssessmentId: assessment.activeManualAssessmentId, finalizedAt: assessment.officialResult.finalizedAt, finalizedBy: assessment.officialResult.finalizedBy }
        : { stage: 'official', assessmentId: assessment.assessmentId, proposalId: assessment.officialResult.proposalId, finalizedAt: assessment.officialResult.finalizedAt, finalizedBy: assessment.officialResult.finalizedBy };
}
function resourceReferenceMatches(resource, assessment) {
    const reference = resource.assessmentReference;
    if (isManualOfficialAssessment(assessment))
        return reference.stage === 'official' && reference.sourceKind === 'admin_manual'
            && reference.manualAssessmentId === assessment.activeManualAssessmentId
            && reference.finalizedAt === assessment.officialResult.finalizedAt
            && reference.finalizedBy === assessment.officialResult.finalizedBy;
    if (assessment.status === 'official_ready') {
        return reference.stage === 'official' && 'proposalId' in reference
            && reference.proposalId === resourceProposalId(assessment)
            && reference.finalizedAt === assessment.officialResult.finalizedAt
            && reference.finalizedBy === assessment.officialResult.finalizedBy;
    }
    return reference.stage === 'provisional'
        && reference.proposalId === resourceProposalId(assessment);
}
function resourceItemsForStage(stage, items) {
    if (stage === 'provisional')
        return items;
    return Object.fromEntries(types_1.RESOURCE_KEYS.map((key) => [key, {
            ...items[key],
            confidence: 'authority_validated',
            authorityReviewRequired: false,
        }]));
}
function resourceQuantities(resources) {
    return {
        police: resources.items.police.baseline,
        security: resources.items.security.baseline,
        medicalTeams: resources.items.medicalTeams.baseline,
        ambulances: resources.items.ambulances.baseline,
        fireOfficers: resources.items.fireOfficers.baseline,
        toilets: resources.items.toilets.baseline,
        wasteBins: resources.items.wasteBins.baseline,
    };
}
function organizerResourceRecommendation(resources) {
    return {
        resourceId: resources.resourceId,
        revision: resources.revision,
        stage: resources.stage,
        items: Object.fromEntries(Object.entries(resources.items).map(([key, item]) => [key, {
                baseline: item.baseline,
                planningRange: { ...item.planningRange },
            }])),
        disclaimer: resources.stage === 'provisional'
            ? 'Provisional internal prototype planning ranges; not statutory or authority-issued minimums.'
            : 'Official authority-validated planning ranges for the finalized assessment.',
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