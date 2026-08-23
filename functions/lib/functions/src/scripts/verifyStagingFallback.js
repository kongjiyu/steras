"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../shared/types");
const aiPredictor_1 = require("../engines/aiPredictor");
const ruleBased_1 = require("../engines/ruleBased");
const projectId = process.env.FIREBASE_PROJECT_ID ?? 'linkos-496505';
const eventId = process.env.UAT_FALLBACK_EVENT_ID ?? 'uat-approval-1784011049847-1f1eca77';
const app = (0, app_1.initializeApp)({ credential: (0, app_1.applicationDefault)(), projectId });
const db = (0, firestore_1.getFirestore)(app);
async function run() {
    const eventSnapshot = await db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId).get();
    if (!eventSnapshot.exists)
        throw new Error(`Staging event ${eventId} was not found.`);
    const event = { eventId, ...eventSnapshot.data() };
    const versionId = event.currentAssessmentId;
    if (!versionId)
        throw new Error(`Staging event ${eventId} has no current assessment.`);
    const assessmentSnapshot = await db.doc(`${types_1.COLLECTIONS.EVENTS}/${eventId}/${types_1.COLLECTIONS.ASSESSMENTS}/${versionId}`).get();
    const assessment = assessmentSnapshot.data();
    if (!assessment?.contextSnapshot)
        throw new Error(`Assessment ${eventId}/${versionId} has no V3 context snapshot.`);
    const baseline = (0, ruleBased_1.computeCategoryBasedAssessment)(event, assessment.contextSnapshot);
    const startedAt = Date.now();
    const attempt = await (0, aiPredictor_1.analyseWithAI)('', event, assessment.contextSnapshot, baseline);
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= 15_000)
        throw new Error(`Fallback exceeded 15 seconds: ${elapsedMs}ms.`);
    if (attempt.status !== 'unavailable' || !attempt.retryable || 'categories' in attempt) {
        throw new Error(`Unexpected fallback result: status=${attempt.status}.`);
    }
    console.info(JSON.stringify({
        projectId,
        eventId,
        versionId,
        elapsedMs,
        aiStatus: attempt.status,
        retryable: attempt.retryable,
        fabricatedScores: false,
        productionSecretRead: false,
        stagingWrites: false,
    }, null, 2));
}
run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
//# sourceMappingURL=verifyStagingFallback.js.map