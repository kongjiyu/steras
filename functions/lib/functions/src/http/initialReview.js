"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeInitialReviewDecision = void 0;
exports.makeInitialReviewDecisionForUser = makeInitialReviewDecisionForUser;
exports.validateManualAssessment = validateManualAssessment;
/**
 * Admin initial-review gate (M3 FR-M3-02..08).
 *
 * The initial decision is distinct from the authority proposal and the
 * second-review outcome:
 *   - Approved means the application is released to officer assignment and
 *     the event remains `UnderReview`.
 *   - Rejected is a terminal result for the current version and carries the
 *     reason + corrective suggestion needed by the organiser for resubmission.
 *   - `Manual Review Required` applications must include a recorded manual
 *     assessment before they can be released to authority review.
 */
const firebase_admin_1 = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
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
    if (!eventId)
        throw new https_1.HttpsError('invalid-argument', 'eventId is required.');
    if (decision !== 'Approved' && decision !== 'Rejected') {
        throw new https_1.HttpsError('invalid-argument', 'decision must be Approved or Rejected.');
    }
    if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
        throw new https_1.HttpsError('invalid-argument', `reason must be ${REASON_MIN}-${REASON_MAX} characters.`);
    }
    if (suggestion.length > SUGGESTION_MAX) {
        throw new https_1.HttpsError('invalid-argument', `suggestion must be at most ${SUGGESTION_MAX} characters.`);
    }
    if (decision === 'Rejected' && suggestion.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'A suggestion is required when rejecting.');
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
    if (!versionId)
        throw new https_1.HttpsError('failed-precondition', 'The application has no submitted version.');
    if (!['Pending', 'UnderReview', 'Manual Review Required', 'AmendmentRequested'].includes(event.status)) {
        throw new https_1.HttpsError('failed-precondition', 'This application is not available for initial review.');
    }
    if (event.reviewStage === 'authority' || event.reviewStage === 'second') {
        throw new https_1.HttpsError('failed-precondition', 'Initial review is already complete for this application version.');
    }
    if ((event.assignedOfficerUids?.length ?? 0) > 0) {
        throw new https_1.HttpsError('failed-precondition', 'Officers are already assigned; use the authority or second-review workflow.');
    }
    const assessmentRef = eventRef.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(versionId);
    const resourceRef = eventRef.collection(types_1.COLLECTIONS.RESOURCES).doc(versionId);
    const [assessmentSnap, resourceSnap] = await Promise.all([assessmentRef.get(), resourceRef.get()]);
    const manualRequired = event.status === 'Manual Review Required' || data.manualAssessment !== undefined;
    const manual = manualRequired ? validateManualAssessment(data.manualAssessment) : undefined;
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
    if (manualRequired && !manual) {
        throw new https_1.HttpsError('invalid-argument', 'A complete manual assessment is required for this application.');
    }
    if (decision === 'Approved' && !manualRequired) {
        if (!isReadyAssessment(assessmentSnap.data()) || !resourceSnap.exists) {
            throw new https_1.HttpsError('failed-precondition', 'Smart Risk Assessment and Safety Resource Recommendation must be ready before initial approval.');
        }
    }
    if (decision === 'Approved' && manualRequired && !resourceSnap.exists && !hasCompleteResourceQuantities(manual?.resourceQuantities)) {
        throw new https_1.HttpsError('invalid-argument', 'Manual approval must include all safety-resource quantities when no recommendation exists.');
    }
    const nextStatus = decision === 'Approved' ? 'UnderReview' : 'Rejected';
    const initialReview = {
        decision,
        reason,
        ...(suggestion ? { suggestion } : {}),
        reviewerUid: uid,
        reviewedAt: now,
        manualAssessmentRecorded: Boolean(manual),
        ...(officerFeedback && officerFeedback.length > 0 ? { officerFeedback } : {}),
    };
    const result = await db.runTransaction(async (tx) => {
        const currentEventSnap = await tx.get(eventRef);
        const currentEvent = { eventId, ...currentEventSnap.data() };
        if (currentEvent.reviewStage === 'authority' || currentEvent.reviewStage === 'second' || (currentEvent.assignedOfficerUids?.length ?? 0) > 0) {
            throw new https_1.HttpsError('failed-precondition', 'Initial review was completed by another admin.');
        }
        if (manual) {
            const manualAssessment = buildManualAssessment(event, versionId, manual, uid, now);
            tx.set(assessmentRef, manualAssessment);
            if (!resourceSnap.exists) {
                tx.set(resourceRef, buildManualResources(event, versionId, manual.resourceQuantities, uid, now));
            }
        }
        const eventUpdate = {
            status: nextStatus,
            reviewStage: decision === 'Approved' ? 'initial' : 'closed',
            initialReview,
            updatedAt: now,
        };
        if (manual) {
            eventUpdate.manualAssessment = {
                score: manual.score,
                riskLevel: manual.riskLevel,
                inputs: manual.inputs,
                rationale: manual.rationale,
                completedBy: uid,
                completedAt: now,
            };
            eventUpdate.currentAssessmentId = versionId;
            if (!resourceSnap.exists)
                eventUpdate.currentResourceId = versionId;
        }
        if (decision === 'Rejected') {
            eventUpdate.reviewStage = 'closed';
            eventUpdate.editableVersionId = `v${event.currentVersionNumber + 1}`;
            eventUpdate.draftDocumentPaths = [];
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
                attachedOfficerFeedback: officerFeedback?.length ?? 0,
                manualAssessmentRecorded: Boolean(manual),
            },
        });
        return { eventId, versionId, status: nextStatus, organizerId: event.organizerId };
    });
    if (decision === 'Rejected' && result.organizerId) {
        try {
            const recipientUid = await (0, notifications_1.resolveAuthUid)(result.organizerId);
            if (recipientUid) {
                await (0, notifications_1.createNotification)({
                    recipientUid,
                    eventId,
                    versionId,
                    type: 'application_rejected',
                    title: 'Application rejected at initial review',
                    message: `${reason}${suggestion ? `. ${suggestion}` : ''}`,
                    sourceActionId: `initial_review_${versionId}`,
                    reason,
                    suggestion,
                });
            }
        }
        catch (error) {
            console.warn('[makeInitialReviewDecision] organiser notification failed (non-fatal):', error);
        }
    }
    return { eventId, versionId, status: result.status, decision, manualAssessmentRecorded: Boolean(manual) };
}
function validateManualAssessment(input) {
    if (!input)
        return undefined;
    const score = input.score;
    const riskLevel = input.riskLevel;
    const rationale = (input.rationale ?? '').trim();
    const inputs = input.inputs;
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
        throw new https_1.HttpsError('invalid-argument', 'Manual assessment score must be a number from 0 to 100.');
    }
    if (riskLevel !== 'Low' && riskLevel !== 'Medium' && riskLevel !== 'High') {
        throw new https_1.HttpsError('invalid-argument', 'Manual assessment riskLevel must be Low, Medium, or High.');
    }
    if ((0, types_1.riskLevelFor)(score) !== riskLevel) {
        throw new https_1.HttpsError('invalid-argument', `Manual risk level must match the score band (${(0, types_1.riskLevelFor)(score)}).`);
    }
    if (rationale.length < REASON_MIN || rationale.length > REASON_MAX) {
        throw new https_1.HttpsError('invalid-argument', `Manual assessment rationale must be ${REASON_MIN}-${REASON_MAX} characters.`);
    }
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs) || Object.keys(inputs).length === 0
        || Object.values(inputs).some((value) => !['string', 'number', 'boolean'].includes(typeof value))) {
        throw new https_1.HttpsError('invalid-argument', 'Manual assessment inputs must contain at least one primitive value.');
    }
    return { ...input, score, riskLevel, inputs, rationale };
}
function isReadyAssessment(value) {
    if (!value || typeof value !== 'object')
        return false;
    const assessment = value;
    return assessment.status === 'ready'
        && typeof assessment.officialScore === 'number'
        && ['Low', 'Medium', 'High'].includes(assessment.officialRiskLevel ?? '')
        && Array.isArray(assessment.categoryAssignments)
        && Array.isArray(assessment.evidence);
}
function buildManualAssessment(event, versionId, input, uid, now) {
    return {
        assessmentId: versionId,
        eventId: event.eventId,
        versionId,
        status: 'ready',
        officialScore: input.score,
        officialRiskLevel: input.riskLevel,
        categoryAssignments: [{
                categoryId: 'manual_review',
                categoryName: 'Manual administrator assessment',
                score: input.score,
                riskLevel: input.riskLevel,
                weight: 1,
                weightedContribution: input.score,
                rationale: input.rationale,
                evidenceKeys: [],
                guidelineChecks: [],
            }],
        evidence: [],
        categorySchemaVersion: 'manual-review-v1',
        scoringLogicVersion: 'manual-review-v1',
        categorySchemaStatus: 'authorityValidated',
        assessmentReadiness: 'complete',
        complianceStatus: 'review_required',
        complianceChecks: [],
        computedAt: now,
        aiAdvisory: {
            model: 'manual-review',
            promptVersion: 'manual-review-v1',
            responseSchemaVersion: 'manual-review-v1',
            status: 'unavailable',
            label: 'advisory',
            overallBand: input.riskLevel,
            overallExplanation: `Manual assessment recorded by admin ${uid}.`,
            categories: [],
            keyConcerns: [],
            resourceConsiderations: [],
            citedEvidenceKeys: [],
            cacheStatus: 'not-applicable',
            generatedAt: now,
        },
        contextSnapshot: {
            weather: { data: { forecast: 'Not assessed', temperature: 0, humidity: 0, windSpeed: 0, precipitationProbability: 0, severeAlert: false }, source: 'fallback', freshness: 'unavailable', fetchedAt: now, expiresAt: now, forecastFor: now },
            calendar: { localDate: new Date(now).toISOString().slice(0, 10), dayOfWeek: 'Unknown', isWeekend: false, isHolidayOrAdjacent: false, sourceVersion: 'manual-review-v1', sourceTimestamp: now },
            venue: { matched: false, venueId: event.eventDetails.venueId, submittedCapacity: event.eventDetails.venueCapacity, fetchedAt: now },
            incidentHistory: { matched: false, venueId: event.eventDetails.venueId, incidentIds: [], total: 0, bySeverity: { low: 0, medium: 0, high: 0 }, fetchedAt: now },
        },
        sourceTimestamps: { manual: now },
        contextStatuses: { manual: 'recorded' },
        inputHash: `manual-${event.eventId}-${versionId}-${now}`,
        createdAt: now,
    };
}
function hasCompleteResourceQuantities(value) {
    if (!value)
        return false;
    return ['police', 'medicalTeams', 'ambulances', 'toilets', 'wasteBins', 'security', 'fireOfficers']
        .every((key) => Number.isInteger(value[key]) && Number(value[key]) >= 0);
}
function buildManualResources(event, versionId, quantities, uid, now) {
    const full = quantities;
    const rationales = Object.fromEntries(Object.keys(full).map((key) => [key, {
            resource: key,
            baselineQuantity: full[key],
            factors: [`Manual review by ${uid}`],
            guidelineReferences: ['manual-review-v1'],
        }]));
    return {
        ...full,
        resourceId: versionId,
        eventId: event.eventId,
        versionId,
        assessmentId: versionId,
        formulaVersion: 'manual-review-v1',
        guidelineVersion: 'manual-review-v1',
        guidelineStatus: 'authorityValidated',
        rationales,
        aiConsiderations: ['No AI resource recommendation was available; quantities were recorded during manual review.'],
        confidenceLevel: 'authorityValidated',
        notes: `Manual resource recommendation recorded by ${uid}.`,
        computedAt: now,
    };
}
//# sourceMappingURL=initialReview.js.map