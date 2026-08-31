import { firestore } from 'firebase-admin';
import { logger } from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { AssessmentRecord, COLLECTIONS, EventRecord } from '@shared/types';
import { ASSESSMENT_SECRETS } from '../config/secrets';
import { FUNCTION_REGION } from '../config/runtime';
import { RESOURCE_CUTOVER_LOCK_PATH } from '../config/resourceCutoverLock';
import { runRiskAndResourcePipeline } from './onEventCreated';

const SIX_HOURS_MS = 6 * 60 * 60 * 1_000;
const FORECAST_REFRESH_WINDOW_MS = 8 * 24 * 60 * 60 * 1_000;

export const refreshAssessmentContext = onSchedule({
  schedule: 'every 6 hours',
  region: FUNCTION_REGION,
  secrets: ASSESSMENT_SECRETS,
  timeoutSeconds: 540,
}, async () => {
  const db = firestore();
  if ((await db.doc(RESOURCE_CUTOVER_LOCK_PATH).get()).exists) {
    logger.info('[assessment-refresh] skipped while the M2 cutover lock exists');
    return;
  }
  const now = Date.now();
  const candidates = (await Promise.all(['Pending', 'UnderReview'].map((status) => (
    db.collection(COLLECTIONS.EVENTS).where('status', '==', status).get()
  )))).flatMap((snapshot) => snapshot.docs);
  for (const document of candidates) {
    const event = { eventId: document.id, ...document.data() } as EventRecord;
    if (!event.currentAssessmentId || !event.currentVersionId) continue;
    const assessmentSnapshot = await document.ref.collection(COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId).get();
    const assessment = assessmentSnapshot.data() as AssessmentRecord | undefined;
    if (!shouldRefreshAssessmentContext(event, assessment, now)) continue;
    const contextGeneration = refreshGenerationFor(now);
    try {
      await runRiskAndResourcePipeline(event.eventId, now, false, undefined, {
        contextGeneration,
        expectedCurrentAssessmentId: event.currentAssessmentId,
        allowUnderReview: true,
      });
    } catch (error) {
      logger.error(`[assessment-refresh] ${event.eventId} failed`, error);
    }
  }
});

export function refreshGenerationFor(now: number): string {
  return String(Math.floor(now / SIX_HOURS_MS));
}

export function shouldRefreshAssessmentContext(
  event: EventRecord,
  assessment: AssessmentRecord | undefined,
  now: number,
): boolean {
  if (!assessment || !['Pending', 'UnderReview'].includes(event.status)
    || assessment.eventId !== event.eventId || assessment.versionId !== event.currentVersionId
    || assessment.assessmentId !== event.currentAssessmentId
    || !('contextSnapshot' in assessment)
    || assessment.status === 'official_ready'
    || ('activeManualAssessmentId' in assessment && Boolean(assessment.activeManualAssessmentId))) return false;
  if ('authorityReviewState' in assessment
    && Object.keys(assessment.authorityReviewState?.activeReviewHeads ?? {}).length > 0) return false;
  const start = event.eventDetails.startDatetime;
  if (!Number.isFinite(start) || start <= now || start - now > FORECAST_REFRESH_WINDOW_MS) return false;
  return assessment.contextSnapshot.weather.data === null
    || assessment.contextSnapshot.weather.freshness === 'not_assessable_yet'
    || assessment.contextSnapshot.weather.freshness === 'unavailable';
}
