"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshAssessmentContext = void 0;
exports.refreshGenerationFor = refreshGenerationFor;
exports.shouldRefreshAssessmentContext = shouldRefreshAssessmentContext;
const firebase_admin_1 = require("firebase-admin");
const firebase_functions_1 = require("firebase-functions");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const types_1 = require("../../../shared/types");
const secrets_1 = require("../config/secrets");
const runtime_1 = require("../config/runtime");
const resourceCutoverLock_1 = require("../config/resourceCutoverLock");
const onEventCreated_1 = require("./onEventCreated");
const SIX_HOURS_MS = 6 * 60 * 60 * 1_000;
const FORECAST_REFRESH_WINDOW_MS = 8 * 24 * 60 * 60 * 1_000;
exports.refreshAssessmentContext = (0, scheduler_1.onSchedule)({
    schedule: 'every 6 hours',
    region: runtime_1.FUNCTION_REGION,
    secrets: secrets_1.ASSESSMENT_SECRETS,
    timeoutSeconds: 540,
}, async () => {
    const db = (0, firebase_admin_1.firestore)();
    if ((await db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH).get()).exists) {
        firebase_functions_1.logger.info('[assessment-refresh] skipped while the M2 cutover lock exists');
        return;
    }
    const now = Date.now();
    const candidates = (await Promise.all(['Pending', 'UnderReview'].map((status) => (db.collection(types_1.COLLECTIONS.EVENTS).where('status', '==', status).get())))).flatMap((snapshot) => snapshot.docs);
    for (const document of candidates) {
        const event = { eventId: document.id, ...document.data() };
        if (!event.currentAssessmentId || !event.currentVersionId)
            continue;
        const assessmentSnapshot = await document.ref.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId).get();
        const assessment = assessmentSnapshot.data();
        if (!shouldRefreshAssessmentContext(event, assessment, now))
            continue;
        const contextGeneration = refreshGenerationFor(now);
        try {
            await (0, onEventCreated_1.runRiskAndResourcePipeline)(event.eventId, now, false, undefined, {
                contextGeneration,
                expectedCurrentAssessmentId: event.currentAssessmentId,
                allowUnderReview: true,
            });
        }
        catch (error) {
            firebase_functions_1.logger.error(`[assessment-refresh] ${event.eventId} failed`, error);
        }
    }
});
function refreshGenerationFor(now) {
    return String(Math.floor(now / SIX_HOURS_MS));
}
function shouldRefreshAssessmentContext(event, assessment, now) {
    if (!assessment || !['Pending', 'UnderReview'].includes(event.status)
        || assessment.eventId !== event.eventId || assessment.versionId !== event.currentVersionId
        || assessment.assessmentId !== event.currentAssessmentId
        || !('contextSnapshot' in assessment)
        || assessment.status === 'official_ready'
        || ('activeManualAssessmentId' in assessment && Boolean(assessment.activeManualAssessmentId)))
        return false;
    if ('authorityReviewState' in assessment
        && Object.keys(assessment.authorityReviewState?.activeReviewHeads ?? {}).length > 0)
        return false;
    const start = event.eventDetails.startDatetime;
    if (!Number.isFinite(start) || start <= now || start - now > FORECAST_REFRESH_WINDOW_MS)
        return false;
    return assessment.contextSnapshot.weather.data === null
        || assessment.contextSnapshot.weather.freshness === 'not_assessable_yet'
        || assessment.contextSnapshot.weather.freshness === 'unavailable';
}
//# sourceMappingURL=refreshAssessmentContext.js.map