import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EventRecord,
  RiskAssessment,
} from '@shared/types';
import { analyseWithAIOrFallback } from '../engines/aiPredictor';

const projectId = process.env.FIREBASE_PROJECT_ID ?? 'linkos-496505';
const eventId = process.env.UAT_FALLBACK_EVENT_ID ?? 'uat-approval-1784011049847-1f1eca77';
const app = initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore(app);

async function run() {
  const eventSnapshot = await db.collection(COLLECTIONS.EVENTS).doc(eventId).get();
  if (!eventSnapshot.exists) throw new Error(`Staging event ${eventId} was not found.`);
  const event = eventSnapshot.data() as EventRecord;
  const versionId = event.currentAssessmentId;
  if (!versionId) throw new Error(`Staging event ${eventId} has no current assessment.`);

  const assessmentSnapshot = await db.doc(`${COLLECTIONS.EVENTS}/${eventId}/${COLLECTIONS.ASSESSMENTS}/${versionId}`).get();
  const assessment = assessmentSnapshot.data() as RiskAssessment | undefined;
  if (!assessment || assessment.status !== 'ready') throw new Error(`Assessment ${eventId}/${versionId} is not ready.`);

  const officialBefore = {
    score: assessment.officialScore,
    level: assessment.officialRiskLevel,
    categories: structuredClone(assessment.categoryAssignments),
  };
  const startedAt = Date.now();
  const advisory = await analyseWithAIOrFallback('', event, assessment.contextSnapshot, assessment);
  const elapsedMs = Date.now() - startedAt;

  if (elapsedMs >= 15_000) throw new Error(`Fallback exceeded 15 seconds: ${elapsedMs}ms.`);
  if (advisory.status !== 'unavailable' || advisory.categories.length !== 0 || advisory.label !== 'advisory') {
    throw new Error(`Unexpected fallback result: status=${advisory.status}, categories=${advisory.categories.length}.`);
  }
  if (assessment.officialScore !== officialBefore.score
    || assessment.officialRiskLevel !== officialBefore.level
    || JSON.stringify(assessment.categoryAssignments) !== JSON.stringify(officialBefore.categories)) {
    throw new Error('Fallback did not preserve the official deterministic category result.');
  }

  console.info(JSON.stringify({
    projectId,
    eventId,
    versionId,
    elapsedMs,
    aiStatus: advisory.status,
    officialScore: assessment.officialScore,
    officialRiskLevel: assessment.officialRiskLevel,
    officialResultPreserved: true,
    productionSecretRead: false,
    stagingWrites: false,
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
