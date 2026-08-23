"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewAssessmentScores = void 0;
exports.reviewAssessmentScoresForUser = reviewAssessmentScoresForUser;
/**
 * Record an authority officer's human confirmation or override of residual
 * hazard likelihood/severity (FR-M3-14).
 *
 * M2's deterministic assessment is immutable. This callable stores the
 * authority's scoped review artifact, including original and revised values,
 * so a later M2 recomputation can consume it without allowing an officer to
 * silently mutate the official score.
 */
const firebase_admin_1 = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
const RATIONALE_MIN = 10;
const RATIONALE_MAX = 1_000;
exports.reviewAssessmentScores = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before recording an assessment review.');
    return reviewAssessmentScoresForUser(request.auth.uid, request.data);
});
async function reviewAssessmentScoresForUser(uid, data, now = Date.now()) {
    const eventId = (data.eventId ?? '').trim();
    const rationale = (data.rationale ?? '').trim();
    const overrides = Array.isArray(data.overrides) ? data.overrides : [];
    const resourceConfirmed = data.resourceConfirmed === true;
    if (!eventId)
        throw new https_1.HttpsError('invalid-argument', 'eventId is required.');
    if (rationale.length < RATIONALE_MIN || rationale.length > RATIONALE_MAX) {
        throw new https_1.HttpsError('invalid-argument', `Rationale must be between ${RATIONALE_MIN} and ${RATIONALE_MAX} characters.`);
    }
    if (overrides.length > 100)
        throw new https_1.HttpsError('invalid-argument', 'Too many hazard overrides.');
    const db = (0, firebase_admin_1.firestore)();
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const userRef = db.collection(types_1.COLLECTIONS.USERS).doc(uid);
    const userSnap = await userRef.get();
    const profile = userSnap.data();
    if (!profile || profile.role !== 'authority' || !profile.authorityType) {
        throw new https_1.HttpsError('permission-denied', 'Only provisioned authority officers can review scores.');
    }
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists)
        throw new https_1.HttpsError('not-found', 'Event application was not found.');
    const event = eventSnap.data();
    const versionId = event.currentVersionId;
    if (!versionId)
        throw new https_1.HttpsError('failed-precondition', 'The application has no submitted version.');
    if (!['Pending', 'UnderReview'].includes(event.status)) {
        throw new https_1.HttpsError('failed-precondition', 'Scores can only be reviewed during active authority review.');
    }
    const assignmentSnapshot = await eventRef.collection(types_1.COLLECTIONS.ASSIGNMENTS).get();
    const assignment = assignmentSnapshot.docs
        .map((snapshot) => ({ ...snapshot.data(), assignmentId: snapshot.id }))
        .find((candidate) => candidate.versionId === versionId
        && candidate.authorityType === profile.authorityType
        && candidate.officerUid === uid
        && (candidate.status === 'pending' || candidate.status === 'in_progress'));
    if (!assignment)
        throw new https_1.HttpsError('permission-denied', 'You are not the named officer assigned to this application.');
    const assessmentSnapshot = await eventRef.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(versionId).get();
    const assessment = assessmentSnapshot.data();
    if (!assessment || !['provisional_ready', 'authority_review', 'official_ready'].includes(assessment.status)) {
        throw new https_1.HttpsError('failed-precondition', 'A current assessment is required before score review.');
    }
    const hazards = extractReviewHazards(assessment);
    if (overrides.length > 0 && hazards.length === 0) {
        throw new https_1.HttpsError('failed-precondition', 'A current all-hazards assessment is required before recording score overrides.');
    }
    const hazardsById = new Map(hazards.map((hazard) => [hazard.hazardId, hazard]));
    const normalizedOverrides = [];
    const seen = new Set();
    for (const input of overrides) {
        const hazardId = (input.hazardId ?? '').trim();
        if (!hazardId || seen.has(hazardId))
            throw new https_1.HttpsError('invalid-argument', 'Each hazard override must have a unique hazardId.');
        seen.add(hazardId);
        const hazard = hazardsById.get(hazardId);
        if (!hazard)
            throw new https_1.HttpsError('invalid-argument', `Hazard ${hazardId} is not in the current assessment.`);
        if (!isMatrixValue(input.residualLikelihood) || !isMatrixValue(input.residualSeverity)) {
            throw new https_1.HttpsError('invalid-argument', 'Residual likelihood and severity must be whole numbers from 1 to 5.');
        }
        normalizedOverrides.push({
            hazardId,
            hazardName: hazard.hazardName,
            originalResidualLikelihood: hazard.residualLikelihood,
            originalResidualSeverity: hazard.residualSeverity,
            revisedResidualLikelihood: input.residualLikelihood,
            revisedResidualSeverity: input.residualSeverity,
        });
    }
    const reviewId = `${versionId}_${profile.authorityType}`;
    const reviewRef = eventRef.collection(types_1.COLLECTIONS.ASSESSMENT_REVIEWS).doc(reviewId);
    const auditRef = eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${reviewId}_assessment_review`);
    const review = {
        reviewId,
        eventId,
        versionId,
        authorityType: profile.authorityType,
        reviewerUid: uid,
        rationale,
        reviewedAt: now,
        resourceConfirmed,
        overrides: normalizedOverrides,
    };
    await db.runTransaction(async (tx) => {
        const [currentEvent, currentAssignment] = await Promise.all([tx.get(eventRef), tx.get(eventRef.collection(types_1.COLLECTIONS.ASSIGNMENTS).doc(assignment.assignmentId))]);
        const current = currentEvent.data();
        const currentAssignmentData = currentAssignment.data();
        if (!current || current.currentVersionId !== versionId || !['Pending', 'UnderReview'].includes(current.status)) {
            throw new https_1.HttpsError('failed-precondition', 'The application changed while the score review was being recorded.');
        }
        if (!currentAssignmentData || currentAssignmentData.officerUid !== uid || currentAssignmentData.status === 'revoked' || currentAssignmentData.status === 'completed') {
            throw new https_1.HttpsError('failed-precondition', 'This assignment is no longer open for score review.');
        }
        tx.set(reviewRef, review);
        tx.set(auditRef, {
            id: auditRef.id,
            eventId,
            versionId,
            action: 'assessment_reviewed',
            actorId: uid,
            actorRole: 'authority',
            timestamp: now,
            notes: rationale,
            metadata: {
                authorityType: profile.authorityType,
                overrideCount: normalizedOverrides.length,
                resourceConfirmed,
                overrides: normalizedOverrides,
            },
        });
    });
    return { eventId, versionId, reviewId, overrideCount: normalizedOverrides.length, resourceConfirmed, reviewedAt: now };
}
function isMatrixValue(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}
function extractReviewHazards(assessment) {
    const candidate = assessment.hazards;
    if (!Array.isArray(candidate))
        return [];
    return candidate.filter((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return false;
        const record = value;
        return typeof record.hazardId === 'string'
            && typeof record.hazardName === 'string'
            && Number.isInteger(record.residualLikelihood)
            && Number.isInteger(record.residualSeverity)
            && Number(record.residualLikelihood) >= 1
            && Number(record.residualLikelihood) <= 5
            && Number(record.residualSeverity) >= 1
            && Number(record.residualSeverity) <= 5;
    });
}
//# sourceMappingURL=reviewAssessmentScores.js.map