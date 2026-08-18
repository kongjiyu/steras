import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EventRecord, RiskAssessment } from '@shared/types';
import { analyseWithAI } from '../engines/aiPredictor';
import { computeCategoryBasedAssessment } from '../engines/ruleBased';

const projectId = process.env.FIREBASE_PROJECT_ID ?? 'linkos-496505';
const eventId = process.env.UAT_FALLBACK_EVENT_ID ?? 'uat-approval-1784011049847-1f1eca77';
const app = initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore(app);

async function run() {
  const eventSnapshot = await db.collection(COLLECTIONS.EVENTS).doc(eventId).get();
  if (!eventSnapshot.exists) throw new Error(`Staging event ${eventId} was not found.`);
  const event = { eventId, ...eventSnapshot.data() } as EventRecord;
  const versionId = event.currentAssessmentId;
  if (!versionId) throw new Error(`Staging event ${eventId} has no current assessment.`);

  const assessmentSnapshot = await db.doc(`${COLLECTIONS.EVENTS}/${eventId}/${COLLECTIONS.ASSESSMENTS}/${versionId}`).get();
  const assessment = assessmentSnapshot.data() as RiskAssessment | undefined;
  if (!assessment?.contextSnapshot) throw new Error(`Assessment ${eventId}/${versionId} has no V3 context snapshot.`);

  const baseline = computeCategoryBasedAssessment(event, assessment.contextSnapshot);
  const startedAt = Date.now();
  const attempt = await analyseWithAI('', event, assessment.contextSnapshot, baseline);
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs >= 15_000) throw new Error(`Fallback exceeded 15 seconds: ${elapsedMs}ms.`);
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
