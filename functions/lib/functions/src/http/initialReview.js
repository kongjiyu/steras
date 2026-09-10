"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeInitialReviewDecision = void 0;
exports.makeInitialReviewDecisionForUser = makeInitialReviewDecisionForUser;
exports.isReviewableProvisionalAssessment = isReviewableProvisionalAssessment;
/**
 * Admin initial-review gate (M3 FR-M3-02..08).
 *
 * The initial decision is distinct from the authority proposal and the
 * second-review outcome:
 *   - Approved means the application is released to officer assignment and
 *     the event remains `UnderReview`.
 *   - Rejected is a terminal result for the current version and carries the
 *     reason + corrective suggestion needed if the organiser starts a new application.
 *   - `Manual Review Required` applications must include a recorded manual
 *     assessment before they can be released to authority review.
 */
const firebase_admin_1 = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
const resourceContract_1 = require("../engines/resourceContract");
const resourceCalculator_1 = require("../engines/resourceCalculator");
const notifications_1 = require("../utils/notifications");
const REASON_MIN = 10;
const REASON_MAX = 1_000;
const SUGGESTION_MAX = 1_000;
exports.makeInitialReviewDecision = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before completing the initial review.');
    return makeInitialReviewDecisionForUser(request.auth.uid, request.data);
});
async function makeInitialReviewDecisionForUser(uid, data, now = Date.now()) {
    const eventId = (data.eventId ?? '').trim();
    const decision = data.decision;
    const reason = (data.reason ?? '').trim();
    const suggestion = (data.suggestion ?? '').trim();
    const attachOfficerFeedback = data.attachOfficerFeedback === true;
    const rejectionReasonCategory = data.rejectionReasonCategory;
    if (!eventId)
        throw new https_1.HttpsError('invalid-argument', 'eventId is required.');
    if (decision !== 'Approved' && decision !== 'Rejected') {
        throw new https_1.HttpsError('invalid-argument', 'decision must be Approved or Rejected.');
    }
    if ((decision === 'Rejected' && reason.length < REASON_MIN) || reason.length > REASON_MAX || (reason.length > 0 && reason.length < REASON_MIN)) {
        throw new https_1.HttpsError('invalid-argument', `reason must be ${REASON_MIN}-${REASON_MAX} characters.`);
    }
    if (suggestion.length > SUGGESTION_MAX) {
        throw new https_1.HttpsError('invalid-argument', `suggestion must be at most ${SUGGESTION_MAX} characters.`);
    }
    if (decision === 'Rejected' && suggestion.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'A suggestion is required when rejecting.');
    }
    if (decision === 'Rejected' && !types_1.REJECTION_REASON_CATEGORIES.includes(rejectionReasonCategory)) {
        throw new https_1.HttpsError('invalid-argument', 'A valid rejectionReasonCategory is required when rejecting.');
    }
    if (Object.prototype.hasOwnProperty.call(data, 'manualAssessment')) {
        throw new https_1.HttpsError('failed-precondition', 'Manual Review Required applications must be completed in the Admin manual assessment queue before initial review.');
    }
    const db = (0, firebase_admin_1.firestore)();
    const userSnap = await db.collection(types_1.COLLECTIONS.USERS).doc(uid).get();
    const profile = userSnap.data();
    if (!profile || profile.role !== 'admin') {
        throw new https_1.HttpsError('permission-denied', 'Only admins can complete an initial review.');
    }
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists)
        throw new https_1.HttpsError('not-found', `Event ${eventId} not found.`);
    const event = { eventId, ...eventSnap.data() };
    const versionId = event.currentVersionId;
    const assessmentId = event.currentAssessmentId;
    const resourceId = event.currentResourceId;
    if (!versionId || !assessmentId)
        throw new https_1.HttpsError('failed-precondition', 'The application has no current assessment generation.');
    if (!safeDocumentId(versionId) || !safeDocumentId(assessmentId)
        || (resourceId !== undefined && !safeDocumentId(resourceId))) {
        throw new https_1.HttpsError('failed-precondition', 'The application current-generation pointers are invalid.');
    }
    if (!['Pending', 'UnderReview', 'Manual Review Required'].includes(event.status)) {
        throw new https_1.HttpsError('failed-precondition', 'This application is not available for initial review.');
    }
    if (event.reviewStage === 'authority' || event.reviewStage === 'second') {
        throw new https_1.HttpsError('failed-precondition', 'Initial review is already complete for this application version.');
    }
    if ((event.assignedOfficerUids?.length ?? 0) > 0) {
        throw new https_1.HttpsError('failed-precondition', 'Officers are already assigned; use the authority or second-review workflow.');
    }
    const assessmentRef = eventRef.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(assessmentId);
    const resourceRef = resourceId ? eventRef.collection(types_1.COLLECTIONS.RESOURCES).doc(resourceId) : undefined;
    const [assessmentSnap, resourceSnap] = await Promise.all([
        assessmentRef.get(),
        resourceRef ? resourceRef.get() : Promise.resolve(undefined),
    ]);
    const assessment = assessmentSnap.data();
    const resource = resourceSnap?.data();
    const manualOfficial = isManualOfficialAssessment(assessment, eventId, versionId, assessmentId);
    const provisionalReady = isReviewableProvisionalAssessment(assessment, eventId, versionId, assessmentId);
    // Feedback is read before the decision transaction so the admin can
    // explicitly attach the completed officer rationale to an initial reject.
    // Assignments are never deleted, so this also works when a previous review
    // was revoked or the application is being re-opened for correction.
    let officerFeedback;
    if (decision === 'Rejected' && attachOfficerFeedback) {
        const assignmentSnapshot = await eventRef.collection(types_1.COLLECTIONS.ASSIGNMENTS).get();
        officerFeedback = assignmentSnapshot.docs
            .map((snapshot) => snapshot.data())
            .filter((assignment) => assignment.versionId === versionId && assignment.decision && assignment.reason)
            .map((assignment) => ({
            authorityType: assignment.authorityType,
            officerUid: assignment.officerUid,
            decision: assignment.decision,
            reason: assignment.reason,
            ...(assignment.suggestion ? { suggestion: assignment.suggestion } : {}),
            ...(assignment.decidedAt ? { decidedAt: assignment.decidedAt } : {}),
        }));
    }
    if (decision === 'Approved' && (!(manualOfficial || provisionalReady)
        || !resourceSnap?.exists || !resource || !resourceId
        || !(0, resourceContract_1.validateResourceRecommendation)(resource).ok
        || resource.resourceId !== resourceId
        || resource.eventId !== eventId
        || resource.versionId !== versionId
        || resource.assessmentId !== assessmentId
        || (provisionalReady ? resource.stage !== 'provisional' : resource.stage !== 'official'))) {
        if (event.status === 'Manual Review Required' || assessment?.status === 'manual_review_required') {
            throw new https_1.HttpsError('failed-precondition', 'Complete the Admin manual assessment queue before initial approval.');
        }
        throw new https_1.HttpsError('failed-precondition', 'Smart Risk Assessment and Safety Resource Recommendation must be ready before initial approval.');
    }
    const nextStatus = decision === 'Approved' ? 'UnderReview' : 'Rejected';
    const initialReview = {
        decision,
        reason,
        reviewStage: 'initial',
        ...(decision === 'Rejected' ? { rejectionReasonCategory } : {}),
        ...(suggestion ? { suggestion } : {}),
        reviewerUid: uid,
        reviewedAt: now,
        manualAssessmentRecorded: manualOfficial,
        ...(officerFeedback && officerFeedback.length > 0 ? { officerFeedback } : {}),
    };
    const organizerRecipientUid = decision === 'Rejected' ? await (0, notifications_1.resolveAuthUid)(event.organizerId) : null;
    const result = await db.runTransaction(async (tx) => {
        const [currentEventSnap, currentAssessmentSnap, currentResourceSnap] = await Promise.all([
            tx.get(eventRef),
            tx.get(assessmentRef),
            resourceRef ? tx.get(resourceRef) : Promise.resolve(undefined),
        ]);
        const currentEvent = { eventId, ...currentEventSnap.data() };
        if (!currentEventSnap.exists
            || currentEvent.status !== event.status
            || currentEvent.currentVersionId !== versionId
            || currentEvent.currentAssessmentId !== assessmentId
            || currentEvent.currentResourceId !== resourceId
            || currentEvent.reviewStage === 'authority'
            || currentEvent.reviewStage === 'second'
            || (currentEvent.assignedOfficerUids?.length ?? 0) > 0) {
            throw new https_1.HttpsError('failed-precondition', 'Initial review was completed by another admin.');
        }
        if (decision === 'Approved') {
            const currentAssessment = currentAssessmentSnap.data();
            const currentResource = currentResourceSnap?.data();
            const currentManualOfficial = isManualOfficialAssessment(currentAssessment, eventId, versionId, assessmentId);
            const currentProvisional = isReviewableProvisionalAssessment(currentAssessment, eventId, versionId, assessmentId);
            if (!(currentManualOfficial || currentProvisional)
                || !currentResource || !resourceId || !(0, resourceContract_1.validateResourceRecommendation)(currentResource).ok
                || currentResource.resourceId !== resourceId || currentResource.eventId !== eventId
                || currentResource.versionId !== versionId || currentResource.assessmentId !== assessmentId
                || (currentProvisional ? currentResource.stage !== 'provisional' : currentResource.stage !== 'official')) {
                throw new https_1.HttpsError('aborted', 'Assessment or resource artifacts changed before initial approval. Reload and retry.');
            }
        }
        const eventUpdate = {
            status: nextStatus,
            reviewStage: decision === 'Approved' ? 'initial' : 'closed',
            initialReview,
            updatedAt: now,
        };
        if (decision === 'Rejected') {
            eventUpdate.assignedOfficerUids = [];
            eventUpdate.assignedOfficerByAuthority = {};
            eventUpdate.editableVersionId = firestore_1.FieldValue.delete();
        }
        tx.update(eventRef, eventUpdate);
        const auditId = `initial_review_${versionId}_${now}`;
        tx.create(eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(auditId), {
            id: auditId,
            eventId,
            versionId,
            action: 'decision_made',
            actorId: uid,
            actorRole: 'admin',
            timestamp: now,
            previousStatus: event.status,
            newStatus: nextStatus,
            notes: reason,
            metadata: {
                reviewStage: 'initial',
                decision,
                suggestion: suggestion || null,
                rejectionReasonCategory: decision === 'Rejected' ? rejectionReasonCategory : null,
                attachedOfficerFeedback: officerFeedback?.length ?? 0,
                manualAssessmentRecorded: manualOfficial,
            },
        });
        if (organizerRecipientUid) {
            const notificationId = `initial_review_${versionId}`;
            tx.set(db.collection(types_1.COLLECTIONS.NOTIFICATIONS).doc(notificationId), {
                notificationId,
                recipientUid: organizerRecipientUid,
                eventId,
                versionId,
                type: 'application_rejected',
                title: 'Application rejected at initial review',
                message: `${reason}${suggestion ? `. ${suggestion}` : ''}`,
                sourceActionId: notificationId,
                reason,
                suggestion,
                read: false,
                createdAt: now,
            }, { merge: false });
        }
        return { eventId, versionId, status: nextStatus, organizerId: event.organizerId };
    });
    return { eventId, versionId, assessmentId, status: result.status, decision, manualAssessmentRecorded: manualOfficial };
}
function isReviewableProvisionalAssessment(value, eventId, versionId, assessmentId) {
    if (!value || typeof value !== 'object')
        return false;
    const assessment = value;
    if (assessment.status !== 'provisional_ready' || assessment.schemaVersion !== types_1.ASSESSMENT_SCHEMA_VERSION
        || assessment.eventId !== eventId || assessment.versionId !== versionId || assessment.assessmentId !== assessmentId
        || assessment.authorityReviewRequired !== true)
        return false;
    const proposal = assessment.aiProposal;
    const provisionalResult = assessment.provisionalResult;
    if (!proposal || proposal.status !== 'success' || !provisionalResult
        || provisionalResult.proposalId !== proposal.proposalId
        || !Array.isArray(assessment.evidence) || !Array.isArray(assessment.contextEvidence)
        || assessment.contextEvidence.length === 0)
        return false;
    return (0, resourceCalculator_1.validateProvisionalAssessmentResult)(provisionalResult).length === 0
        && (0, resourceCalculator_1.validateAssessmentResultAgainstProposal)(provisionalResult, proposal).length === 0;
}
function isManualOfficialAssessment(value, eventId, versionId, assessmentId) {
    if (!value || typeof value !== 'object')
        return false;
    const assessment = value;
    return assessment.status === 'official_ready'
        && assessment.sourceKind === 'admin_manual'
        && assessment.authorityReviewRequired === false
        && assessment.eventId === eventId
        && assessment.versionId === versionId
        && assessment.assessmentId === assessmentId
        && typeof assessment.activeManualAssessmentId === 'string'
        && assessment.activeManualAssessmentId.length > 0
        && assessment.officialResult !== undefined
        && (0, resourceCalculator_1.validateManualOfficialAssessmentResult)(assessment.officialResult).length === 0;
}
function safeDocumentId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
//# sourceMappingURL=initialReview.js.map