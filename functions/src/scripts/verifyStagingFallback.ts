import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EventRecord,
  RiskAssessment,
  WeatherContext,
  finalScoreFor,
} from '@shared/types';
import { refineWithAIOrFallback } from '../engines/aiPredictor';

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

  const weather: WeatherContext = {
    forecast: 'Fallback verification context',
    temperature: 28,
    humidity: 70,
    windSpeed: 2,
    precipitationProbability: 20,
    severeAlert: false,
  };
  const startedAt = Date.now();
  const refinement = await refineWithAIOrFallback('', event, weather, false, false, assessment);
  const elapsedMs = Date.now() - startedAt;
  const final = finalScoreFor(assessment.baselineScore, refinement.validatedAdjustment);

  if (elapsedMs >= 15_000) throw new Error(`Fallback exceeded 15 seconds: ${elapsedMs}ms.`);
  if (refinement.status !== 'unavailable' || refinement.validatedAdjustment !== 0) {
    throw new Error(`Unexpected fallback result: status=${refinement.status}, adjustment=${refinement.validatedAdjustment}.`);
  }
  if (final.finalScore !== assessment.baselineScore || final.finalRiskLevel !== assessment.baselineRiskLevel) {
    throw new Error('Fallback did not preserve the deterministic baseline result.');
  }

  console.info(JSON.stringify({
    projectId,
    eventId,
    versionId,
    elapsedMs,
    aiStatus: refinement.status,
    validatedAdjustment: refinement.validatedAdjustment,
    baselineScore: assessment.baselineScore,
    finalScore: final.finalScore,
    baselinePreserved: true,
    productionSecretRead: false,
    stagingWrites: false,
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
