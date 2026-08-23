"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.__testOnly = exports.retryManualOfficialFinalisation = exports.submitAdminManualAssessment = void 0;
exports.retryManualOfficialFinalisationForAdmin = retryManualOfficialFinalisationForAdmin;
exports.submitAdminManualAssessmentForUser = submitAdminManualAssessmentForUser;
exports.finalizeStoredManualAssessment = finalizeStoredManualAssessment;
const node_crypto_1 = require("node:crypto");
const firebase_admin_1 = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
const resourceCutoverLock_1 = require("../config/resourceCutoverLock");
const manualFinalisation_1 = require("../engines/manualFinalisation");
const resourceCalculator_1 = require("../engines/resourceCalculator");
const resourceContract_1 = require("../engines/resourceContract");
const onEventCreated_1 = require("../triggers/onEventCreated");
exports.submitAdminManualAssessment = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before completing a manual assessment.');
    return submitAdminManualAssessmentForUser(request.auth.uid, request.data);
});
exports.retryManualOfficialFinalisation = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before retrying manual finalisation.');
    const eventId = requiredId(request.data?.eventId, 'eventId');
    return retryManualOfficialFinalisationForAdmin(request.auth.uid, eventId);
});
async function retryManualOfficialFinalisationForAdmin(uid, eventId, now = Date.now()) {
    const identity = await recordManualRetryAttempt(uid, eventId, now);
    try {
        return await finalizeStoredManualAssessment(uid, eventId, true, now, identity);
    }
    catch (error) {
        await recordManualFailure(eventId, identity, now, error);
        throw error;
    }
}
async function submitAdminManualAssessmentForUser(uid, data, now = Date.now()) {
    const payload = isRecord(data) ? data : {};
    const eventId = requiredId(payload.eventId, 'eventId');
    const input = {
        hazards: Array.isArray(payload.hazards) ? payload.hazards : [],
        categories: Array.isArray(payload.categories) ? payload.categories : [],
        rationale: typeof payload.rationale === 'string' ? payload.rationale : '',
        idempotencyKey: typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey : '',
    };
    const db = (0, firebase_admin_1.firestore)();
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const preflightEvent = (await eventRef.get()).data();
    const preflightAssessmentId = preflightEvent?.currentAssessmentId;
    const preflightManualIds = preflightAssessmentId
        ? (await eventRef.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(preflightAssessmentId)
            .collection(types_1.COLLECTIONS.MANUAL_ASSESSMENTS).limit(2).get()).docs.map((snapshot) => snapshot.id)
        : [];
    const persisted = await db.runTransaction(async (transaction) => {
        const [profileSnap, eventSnap, lockSnap] = await Promise.all([
            transaction.get(db.collection(types_1.COLLECTIONS.USERS).doc(uid)),
            transaction.get(eventRef), transaction.get(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH)),
        ]);
        assertNoCutover(lockSnap);
        if (profileSnap.data()?.role !== 'admin') {
            throw new https_1.HttpsError('permission-denied', 'Only an administrator may submit a manual assessment.');
        }
        const event = eventSnap.data();
        const { versionId, assessmentId } = assertManualEvent(event);
        const assessmentRef = eventRef.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(assessmentId);
        const versionRef = eventRef.collection(types_1.COLLECTIONS.VERSIONS).doc(versionId);
        const [assessmentSnap, versionSnap] = await Promise.all([transaction.get(assessmentRef), transaction.get(versionRef)]);
        const assessment = assessmentSnap.data();
        const version = versionSnap.data();
        const alreadyOfficialManual = isManualOfficial(assessment, eventId, versionId, assessmentId);
        if ((!isEligibleManualAssessment(assessment, eventId, versionId, assessmentId) && !alreadyOfficialManual) || !version
            || version.eventId !== eventId || version.versionId !== versionId) {
            throw new https_1.HttpsError('failed-precondition', 'The current assessment is not eligible for Admin manual assessment.');
        }
        const manualAssessmentId = manualId(versionId, uid, input.idempotencyKey);
        const manualRef = assessmentRef.collection(types_1.COLLECTIONS.MANUAL_ASSESSMENTS).doc(manualAssessmentId);
        const existingSnap = await transaction.get(manualRef);
        const existing = existingSnap.data();
        if (preflightAssessmentId !== assessmentId || preflightManualIds.some((id) => id !== manualAssessmentId)) {
            throw new https_1.HttpsError('failed-precondition', 'This application version already contains a different manual assessment record.');
        }
        const hasManualLockField = Object.prototype.hasOwnProperty.call(assessment, 'activeManualAssessmentId');
        if (hasManualLockField && !safeIdentifier(assessment.activeManualAssessmentId)) {
            throw new https_1.HttpsError('failed-precondition', 'The Admin manual assessment lock is invalid; do not replace this generation.');
        }
        if (safeIdentifier(assessment.activeManualAssessmentId)
            && assessment.activeManualAssessmentId !== manualAssessmentId) {
            throw new https_1.HttpsError('failed-precondition', 'This application version already has a locked manual assessment.');
        }
        if (safeIdentifier(assessment.activeManualAssessmentId) && !existingSnap.exists) {
            throw new https_1.HttpsError('failed-precondition', 'The locked manual assessment record is missing.');
        }
        const inputErrors = (0, manualFinalisation_1.validateManualAssessmentInput)(input, assessment.evidence);
        if (inputErrors.length)
            throw new https_1.HttpsError('invalid-argument', `Invalid manual assessment: ${inputErrors.join(', ')}.`);
        const proposed = (0, manualFinalisation_1.buildManualAssessment)({
            assessment: assessment, eventVersionInputHash: version.inputHash, submittedBy: uid,
            manualAssessmentId, input, createdAt: existing?.createdAt ?? now,
        });
        if (existing && !(0, manualFinalisation_1.sameManualAssessment)(existing, proposed)) {
            throw new https_1.HttpsError('already-exists', 'The idempotency key is already bound to different manual assessment content.');
        }
        if (alreadyOfficialManual) {
            if (!existing || assessment.activeManualAssessmentId !== manualAssessmentId || !(0, manualFinalisation_1.sameManualAssessment)(existing, proposed)) {
                throw new https_1.HttpsError('failed-precondition', 'The manual official assessment is locked.');
            }
            return { eventId, versionId, assessmentId, manualAssessmentId, idempotent: true };
        }
        if (!existing) {
            transaction.create(manualRef, proposed);
            const auditRef = eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${manualAssessmentId}-submitted`);
            transaction.create(auditRef, audit(auditRef.id, eventId, versionId, 'manual_assessment_submitted', uid, now, {
                assessmentId, manualAssessmentId, schemaVersion: types_1.MANUAL_ASSESSMENT_SCHEMA_VERSION,
            }));
        }
        transaction.set(assessmentRef, { activeManualAssessmentId: manualAssessmentId }, { merge: true });
        transaction.update(eventRef, { updatedAt: now });
        return { eventId, versionId, assessmentId, manualAssessmentId, idempotent: Boolean(existing) };
    });
    try {
        const finalized = await finalizeStoredManualAssessment(uid, eventId, false, now, persisted);
        return { ...persisted, ...finalized };
    }
    catch (error) {
        await recordManualFailure(eventId, persisted, now, error);
        throw error;
    }
}
async function finalizeStoredManualAssessment(uid, eventId, requireAdmin = true, now = Date.now(), expectedIdentity) {
    const db = (0, firebase_admin_1.firestore)();
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    return db.runTransaction(async (transaction) => {
        const [profileSnap, eventSnap, lockSnap] = await Promise.all([
            transaction.get(db.collection(types_1.COLLECTIONS.USERS).doc(uid)), transaction.get(eventRef),
            transaction.get(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH)),
        ]);
        assertNoCutover(lockSnap);
        const profile = profileSnap.data();
        if (requireAdmin && profile?.role !== 'admin')
            throw new https_1.HttpsError('permission-denied', 'Only an administrator may retry manual finalisation.');
        if (profile?.role !== 'admin')
            throw new https_1.HttpsError('permission-denied', 'Only an administrator may finalize a manual assessment.');
        const event = eventSnap.data();
        const { versionId, assessmentId } = assertManualEvent(event, true);
        if (expectedIdentity && (versionId !== expectedIdentity.versionId || assessmentId !== expectedIdentity.assessmentId)) {
            throw new https_1.HttpsError('aborted', 'The application version changed before manual finalisation completed.');
        }
        const assessmentRef = eventRef.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(assessmentId);
        const versionRef = eventRef.collection(types_1.COLLECTIONS.VERSIONS).doc(versionId);
        const [assessmentSnap, versionSnap] = await Promise.all([transaction.get(assessmentRef), transaction.get(versionRef)]);
        const assessmentValue = assessmentSnap.data();
        const version = versionSnap.data();
        if (!version || version.eventId !== eventId || version.versionId !== versionId)
            throw new https_1.HttpsError('failed-precondition', 'The current immutable event version is missing.');
        if (isManualOfficial(assessmentValue, eventId, versionId, assessmentId)) {
            if (expectedIdentity?.manualAssessmentId
                && assessmentValue.activeManualAssessmentId !== expectedIdentity.manualAssessmentId) {
                throw new https_1.HttpsError('aborted', 'The manual assessment generation changed before finalisation completed.');
            }
            if (!event?.currentResourceId)
                throw new https_1.HttpsError('failed-precondition', 'The manual official resource is missing.');
            const summaryRef = eventRef.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).doc(versionId);
            const [resourceSnap, manualSnap, historySnap, summarySnap] = await Promise.all([
                transaction.get(eventRef.collection(types_1.COLLECTIONS.RESOURCES).doc(event.currentResourceId)),
                transaction.get(assessmentRef.collection(types_1.COLLECTIONS.MANUAL_ASSESSMENTS).doc(assessmentValue.activeManualAssessmentId)),
                transaction.get(eventRef.collection(types_1.COLLECTIONS.RESOURCES)
                    .where('versionId', '==', versionId)
                    .where('stage', '==', 'official')),
                transaction.get(summaryRef),
            ]);
            const resource = resourceSnap.data();
            const manual = manualSnap.data();
            const reference = resource?.assessmentReference;
            if (!manual || manualSnap.id !== assessmentValue.activeManualAssessmentId
                || manual.manualAssessmentId !== assessmentValue.activeManualAssessmentId) {
                throw new https_1.HttpsError('failed-precondition', 'The locked manual assessment identity is invalid.');
            }
            const expectedResult = (0, manualFinalisation_1.buildManualOfficialAssessmentResult)({
                assessment: assessmentValue,
                manualAssessment: manual, eventDetails: version.eventDetails, eventVersionInputHash: version.inputHash,
                finalizedAt: assessmentValue.officialResult.finalizedAt, finalizedBy: assessmentValue.officialResult.finalizedBy,
            });
            const expectedCalculation = (0, resourceCalculator_1.computeResources)({ eventId, versionId, assessmentId, eventDetails: version.eventDetails, assessmentResult: expectedResult });
            const history = historySnap.docs.map((snapshot) => snapshot.data());
            if (!expectedCalculation.ok || (0, resourceCalculator_1.stableStringify)(expectedResult) !== (0, resourceCalculator_1.stableStringify)(assessmentValue.officialResult)
                || !(0, resourceContract_1.validateResourceRecommendation)(resource).ok
                || resource.eventId !== eventId
                || resource.versionId !== versionId
                || resource.assessmentId !== assessmentId
                || resource.resourceInputHash !== expectedCalculation.resourceInputHash
                || !(0, resourceCalculator_1.matchesDeterministicResourceItems)(resource.items, expectedCalculation.items)
                || reference?.stage !== 'official'
                || !('sourceKind' in reference) || reference.sourceKind !== 'admin_manual'
                || reference.manualAssessmentId !== assessmentValue.activeManualAssessmentId
                || reference.finalizedAt !== assessmentValue.officialResult.finalizedAt
                || reference.finalizedBy !== assessmentValue.officialResult.finalizedBy
                || historySnap.docs.some((snapshot, index) => snapshot.id !== history[index].resourceId)
                || history.some((candidate) => !(0, resourceContract_1.validateResourceRecommendation)(candidate).ok
                    || candidate.eventId !== eventId || candidate.versionId !== versionId || candidate.stage !== 'official')
                || (0, resourceContract_1.validateResourceRevisionChain)(history, event.currentResourceId).length > 0) {
                throw new https_1.HttpsError('failed-precondition', 'The manual official output is invalid.');
            }
            const expectedSummary = organizerSummary(assessmentValue, resource, assessmentValue.officialResult.finalizedAt);
            if (!summarySnap.exists || (0, resourceCalculator_1.stableStringify)(summarySnap.data()) !== (0, resourceCalculator_1.stableStringify)(expectedSummary)) {
                transaction.set(summaryRef, expectedSummary);
            }
            return { eventId, status: 'official_ready', officialResourceId: event.currentResourceId, idempotent: true };
        }
        if (!isEligibleManualAssessment(assessmentValue, eventId, versionId, assessmentId)
            || !safeIdentifier(assessmentValue.activeManualAssessmentId))
            throw new https_1.HttpsError('failed-precondition', 'No persisted manual assessment is ready for finalisation.');
        if (expectedIdentity?.manualAssessmentId
            && assessmentValue.activeManualAssessmentId !== expectedIdentity.manualAssessmentId) {
            throw new https_1.HttpsError('aborted', 'The manual assessment generation changed before finalisation completed.');
        }
        const manualRef = assessmentRef.collection(types_1.COLLECTIONS.MANUAL_ASSESSMENTS).doc(assessmentValue.activeManualAssessmentId);
        const historyQuery = eventRef.collection(types_1.COLLECTIONS.RESOURCES).where('versionId', '==', versionId).where('stage', '==', 'official');
        const [manualSnap, historySnap] = await Promise.all([transaction.get(manualRef), transaction.get(historyQuery)]);
        const manual = manualSnap.data();
        if (!manual || manualSnap.id !== assessmentValue.activeManualAssessmentId
            || manual.manualAssessmentId !== assessmentValue.activeManualAssessmentId) {
            throw new https_1.HttpsError('failed-precondition', 'The persisted manual assessment identity is invalid.');
        }
        const officialResult = (0, manualFinalisation_1.buildManualOfficialAssessmentResult)({ assessment: assessmentValue, manualAssessment: manual, eventDetails: version.eventDetails, eventVersionInputHash: version.inputHash, finalizedAt: now, finalizedBy: uid });
        const calculation = (0, resourceCalculator_1.computeResources)({ eventId, versionId, assessmentId, eventDetails: version.eventDetails, assessmentResult: officialResult });
        if (!calculation.ok)
            throw new https_1.HttpsError('failed-precondition', `Manual official resource calculation failed: ${calculation.code}.`);
        const history = historySnap.docs.map((snapshot) => snapshot.data());
        if (historySnap.docs.some((snapshot, index) => snapshot.id !== history[index].resourceId)
            || history.some((resource) => !(0, resourceContract_1.validateResourceRecommendation)(resource).ok
                || resource.eventId !== eventId || resource.versionId !== versionId || resource.stage !== 'official')) {
            throw new https_1.HttpsError('failed-precondition', 'Official resource history is invalid.');
        }
        const tip = [...history].sort((left, right) => right.revision - left.revision)[0];
        if (tip && (0, resourceContract_1.validateResourceRevisionChain)(history, tip.resourceId).length)
            throw new https_1.HttpsError('failed-precondition', 'Official resource revision chain is invalid.');
        const resourceId = (0, onEventCreated_1.resourceDocumentId)('official', versionId, calculation.resourceInputHash);
        const existing = history.find((resource) => resource.resourceId === resourceId);
        const items = Object.fromEntries(types_1.RESOURCE_KEYS.map((key) => [key, {
                ...calculation.items[key], confidence: 'authority_validated', authorityReviewRequired: false,
            }]));
        const resource = existing ?? {
            resourceId, eventId, versionId, assessmentId, schemaVersion: types_1.RESOURCE_SCHEMA_VERSION,
            stage: 'official', revision: tip ? tip.revision + 1 : 1, supersedesResourceId: tip?.resourceId ?? null,
            assessmentReference: { stage: 'official', assessmentId, sourceKind: 'admin_manual', manualAssessmentId: manual.manualAssessmentId, finalizedAt: now, finalizedBy: uid },
            resourceInputHash: calculation.resourceInputHash, formulaVersion: types_1.RESOURCE_FORMULA_VERSION,
            configVersion: types_1.RESOURCE_CONFIG_VERSION, sourceRegistryVersion: types_1.RESOURCE_SOURCE_REGISTRY_VERSION,
            items, confidenceLevel: 'authority_validated', authorityReviewRequired: false,
            validationScope: 'official_risk_input_only',
            notes: 'Official deterministic planning ranges based on the locked Admin manual assessment.', computedAt: now,
        };
        if (existing && (existing.resourceId !== resourceId || existing.eventId !== eventId
            || existing.versionId !== versionId || existing.assessmentId !== assessmentId
            || existing.resourceInputHash !== calculation.resourceInputHash
            || existing.formulaVersion !== types_1.RESOURCE_FORMULA_VERSION || existing.configVersion !== types_1.RESOURCE_CONFIG_VERSION
            || existing.sourceRegistryVersion !== types_1.RESOURCE_SOURCE_REGISTRY_VERSION
            || existing.assessmentReference.stage !== 'official'
            || existing.assessmentReference.sourceKind !== 'admin_manual'
            || existing.assessmentReference.manualAssessmentId !== manual.manualAssessmentId
            || existing.assessmentReference.finalizedAt !== now || existing.assessmentReference.finalizedBy !== uid
            || (0, resourceCalculator_1.stableStringify)(existing.items) !== (0, resourceCalculator_1.stableStringify)(items)
            || existing.resourceId !== tip?.resourceId))
            throw new https_1.HttpsError('already-exists', 'Manual official resource identity collision.');
        const officialAssessment = {
            ...assessmentValue, status: 'official_ready', sourceKind: 'admin_manual', authorityReviewRequired: false,
            aiProposal: assessmentValue.aiProposal && assessmentValue.aiProposal.status !== 'success'
                ? assessmentValue.aiProposal
                : null,
            activeManualAssessmentId: manual.manualAssessmentId, officialResult,
        };
        if (!existing)
            transaction.create(eventRef.collection(types_1.COLLECTIONS.RESOURCES).doc(resourceId), resource);
        transaction.set(assessmentRef, officialAssessment);
        transaction.update(eventRef, { currentResourceId: resourceId, updatedAt: now });
        transaction.set(eventRef.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).doc(versionId), organizerSummary(officialAssessment, resource, now));
        const auditRef = eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${officialResult.officialInputHash}-manual-finalized`);
        transaction.create(auditRef, audit(auditRef.id, eventId, versionId, 'manual_official_assessment_finalized', uid, now, {
            assessmentId, manualAssessmentId: manual.manualAssessmentId, resourceId, officialInputHash: officialResult.officialInputHash,
        }));
        return { eventId, status: 'official_ready', officialResourceId: resourceId, idempotent: false };
    });
}
function organizerSummary(assessment, resource, now) {
    const result = assessment.officialResult;
    const projection = {
        resourceId: resource.resourceId, revision: resource.revision, stage: 'official',
        items: Object.fromEntries(types_1.RESOURCE_KEYS.map((key) => [key, { baseline: resource.items[key].baseline, planningRange: { ...resource.items[key].planningRange } }])),
        disclaimer: 'Official planning ranges based on an Admin manual assessment.',
    };
    return {
        assessmentId: assessment.assessmentId, eventId: assessment.eventId, versionId: assessment.versionId,
        schemaVersion: types_1.ASSESSMENT_SCHEMA_VERSION, status: 'official_ready', overallScore: result.overallScore,
        overallRiskLevel: result.overallRiskLevel,
        categories: result.categories.map((category) => ({ categoryId: category.categoryId, categoryName: category.categoryName, normalizedScore: category.normalizedScore, riskLevel: category.riskLevel })),
        assessmentReadiness: assessment.assessmentReadiness, complianceStatus: assessment.complianceStatus,
        authorityReviewRequired: false,
        resourceQuantities: Object.fromEntries(types_1.RESOURCE_KEYS.map((key) => [key, resource.items[key].baseline])),
        resourceRecommendation: projection, computedAt: now,
    };
}
function assertManualEvent(event, allowOfficial = false) {
    if (!event?.currentVersionId || !event.currentAssessmentId
        || !safeIdentifier(event.currentVersionId) || !safeIdentifier(event.currentAssessmentId)
        || !['Pending', 'UnderReview', 'Manual Review Required'].includes(event.status)) {
        throw new https_1.HttpsError('failed-precondition', 'The event is not open for manual assessment.');
    }
    void allowOfficial;
    return { versionId: event.currentVersionId, assessmentId: event.currentAssessmentId };
}
function safeIdentifier(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isEligibleManualAssessment(value, eventId, versionId, assessmentId) {
    if (!(0, onEventCreated_1.isCurrentManualReviewAssessment)(value, eventId, versionId, assessmentId))
        return false;
    const hasManualLockField = Boolean(value && Object.prototype.hasOwnProperty.call(value, 'activeManualAssessmentId'));
    const activeManualAssessmentId = isRecord(value) ? value.activeManualAssessmentId : undefined;
    const manualLockValid = !hasManualLockField || safeIdentifier(activeManualAssessmentId);
    return manualLockValid && (0, manualFinalisation_1.isManualAssessmentSourceEligible)(value);
}
function isManualOfficial(value, eventId, versionId, assessmentId) {
    return Boolean(value && value.status === 'official_ready' && 'sourceKind' in value && value.sourceKind === 'admin_manual'
        && value.authorityReviewRequired === false
        && ['complete', 'provisional', 'insufficient_data'].includes(value.assessmentReadiness)
        && ['pass', 'review_required', 'blocked'].includes(value.complianceStatus)
        && Number.isFinite(value.dataConfidenceScore)
        && Number.isFinite(value.createdAt)
        && ['low', 'medium', 'high'].includes(value.dataConfidenceLevel)
        && (!eventId || value.eventId === eventId)
        && (!versionId || value.versionId === versionId)
        && (!assessmentId || value.assessmentId === assessmentId)
        && safeIdentifier(value.activeManualAssessmentId)
        && value.officialResult?.sourceKind === 'admin_manual'
        && value.officialResult.manualAssessmentId === value.activeManualAssessmentId
        && (0, manualFinalisation_1.isManualAssessmentSourceEligible)(value)
        && (0, resourceCalculator_1.validateManualOfficialAssessmentResult)(value.officialResult).length === 0);
}
function manualId(versionId, uid, key) {
    return `${versionId}-manual-${(0, node_crypto_1.createHash)('sha256').update(`${uid}:${key}`).digest('hex').slice(0, 24)}`;
}
function assertNoCutover(snapshot) {
    if (snapshot.exists)
        throw new https_1.HttpsError('unavailable', 'Resource migration is in progress. Retry shortly.');
}
function requiredId(value, name) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
        throw new https_1.HttpsError('invalid-argument', `${name} is required.`);
    return value;
}
async function recordManualRetryAttempt(uid, eventId, now) {
    const db = (0, firebase_admin_1.firestore)();
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    return db.runTransaction(async (transaction) => {
        const [profileSnap, eventSnap, lockSnap] = await Promise.all([
            transaction.get(db.collection(types_1.COLLECTIONS.USERS).doc(uid)), transaction.get(eventRef), transaction.get(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH)),
        ]);
        assertNoCutover(lockSnap);
        if (profileSnap.data()?.role !== 'admin')
            throw new https_1.HttpsError('permission-denied', 'Only an administrator may retry manual finalisation.');
        const event = eventSnap.data();
        const { versionId, assessmentId } = assertManualEvent(event, true);
        const assessment = (await transaction.get(eventRef.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(assessmentId))).data();
        if (!(isManualOfficial(assessment, eventId, versionId, assessmentId)
            || (isEligibleManualAssessment(assessment, eventId, versionId, assessmentId) && assessment.activeManualAssessmentId))) {
            throw new https_1.HttpsError('failed-precondition', 'No persisted manual assessment is ready for retry.');
        }
        const ref = eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${versionId}-${now}-${(0, node_crypto_1.randomUUID)()}-manual-retry`);
        transaction.create(ref, audit(ref.id, eventId, versionId, 'manual_official_finalization_retried', uid, now, {
            assessmentId, manualAssessmentId: assessment.activeManualAssessmentId,
        }));
        return { eventId, versionId, assessmentId, manualAssessmentId: assessment.activeManualAssessmentId };
    });
}
async function recordManualFailure(eventId, identity, now, error) {
    if (!identity || error instanceof https_1.HttpsError && ['unauthenticated', 'permission-denied', 'invalid-argument', 'unavailable'].includes(error.code))
        return;
    const db = (0, firebase_admin_1.firestore)();
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const summary = error instanceof Error ? error.message.slice(0, 500) : 'Unknown manual official finalisation failure.';
    await db.runTransaction(async (transaction) => {
        const assessmentRef = eventRef.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(identity.assessmentId);
        const [eventSnap, assessmentSnap, lockSnap] = await Promise.all([
            transaction.get(eventRef), transaction.get(assessmentRef), transaction.get(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH)),
        ]);
        const event = eventSnap.data();
        const assessment = assessmentSnap.data();
        if (lockSnap.exists || !event
            || event.currentVersionId !== identity.versionId
            || event.currentAssessmentId !== identity.assessmentId
            || !['Pending', 'UnderReview'].includes(event.status))
            return;
        if (assessment?.status !== 'manual_review_required')
            return;
        if (identity.manualAssessmentId && (!assessment || !('activeManualAssessmentId' in assessment)
            || assessment.activeManualAssessmentId !== identity.manualAssessmentId))
            return;
        const ref = eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${identity.versionId}-${now}-${(0, node_crypto_1.randomUUID)()}-manual-failed`);
        transaction.create(ref, audit(ref.id, eventId, identity.versionId, 'manual_official_finalization_failed', 'system', now, {
            assessmentId: identity.assessmentId, manualAssessmentId: identity.manualAssessmentId ?? null, errorSummary: summary,
        }));
    });
}
function audit(id, eventId, versionId, action, actorId, timestamp, metadata) {
    return { id, eventId, versionId, action, actorId, actorRole: actorId === 'system' ? 'system' : 'admin', timestamp, metadata };
}
exports.__testOnly = { manualId, isEligibleManualAssessment };
//# sourceMappingURL=adminManualAssessment.js.map