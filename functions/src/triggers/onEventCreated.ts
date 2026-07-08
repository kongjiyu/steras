/**
 * Triggers: onEventCreated + onEventUpdated
 *
 * Module 2 (Smart Risk) + Module 3 (Resources) auto-run when an event is
 * created or updated by the organizer (still in Pending / AmendmentRequested).
 *
 * Uses firebase-functions v2 API (onDocumentCreated / onDocumentUpdated).
 */

import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { firestore } from 'firebase-admin';
import { logger } from 'firebase-functions';
import { EventRecord, COLLECTIONS, DISAGREEMENT_THRESHOLD, RiskScoreRecord, ResourceRecommendation, WeatherContext } from '@shared/types';
import { computeRuleBased, fetchIncidentsForVenue } from '../engines/ruleBased';
import { predictWithAI } from '../engines/aiPredictor';
import { computeResources } from '../engines/resourceCalculator';
import { fetchWeather } from '../utils/weather';
import { isMalaysianPublicHoliday, isWeekendDate } from '../utils/holidays';
import { writeAuditLog } from '../utils/audit';

export async function runRiskAndResourcePipeline(eventId: string): Promise<void> {
  const db = firestore();
  const eventSnap = await db.collection(COLLECTIONS.EVENTS).doc(eventId).get();
  if (!eventSnap.exists) return;
  const event = { eventId, ...eventSnap.data() } as EventRecord;

  // Only run for events that are pending or amendment-requested.
  if (!['Pending', 'AmendmentRequested', 'UnderReview'].includes(event.status)) {
    logger.info(`[onEvent] Skipping ${eventId} (status=${event.status})`);
    return;
  }

  logger.info(`[onEvent] Running pipeline for ${eventId}`);

  // 1. Fetch context in parallel.
  const [weather, incidents] = await Promise.all([
    fetchWeather(event.eventDetails.venueLocation, event.eventDetails.venueName).catch((e) => {
      logger.warn(`[onEvent] Weather fetch failed: ${e}`);
      return defaultWeather();
    }),
    fetchIncidentsForVenue(event.eventDetails.venueName).catch((e) => {
      logger.warn(`[onEvent] Incidents fetch failed: ${e}`);
      return [];
    }),
  ]);

  const isHoliday = isMalaysianPublicHoliday(event.eventDetails.startDatetime);
  const isWeekend = isWeekendDate(event.eventDetails.startDatetime);

  // 2. Run rule-based + AI in parallel.
  const apiKey = process.env.MINIMAX_API_KEY;
  const [ruleScore, aiScore] = await Promise.all([
    computeRuleBased(event, weather, isHoliday, isWeekend, incidents),
    apiKey
      ? predictWithAI(apiKey, event, weather, isHoliday, isWeekend).catch((e) => {
          logger.error(`[onEvent] AI prediction failed: ${e}`);
          return null;
        })
      : Promise.resolve(null),
  ]);

  if (!aiScore) {
    logger.warn(`[onEvent] AI score unavailable; rule-based only for ${eventId}`);
  }

  // 3. Persist risk score (sub-collection).
  const delta = aiScore ? Math.abs(aiScore.riskScore - ruleScore.total) : 0;
  const riskRecord: RiskScoreRecord = {
    id: `${Date.now()}`,
    eventId,
    ai: aiScore ?? {
      riskLevel: ruleScore.riskLevel,
      riskScore: ruleScore.total,
      reasoning: '[AI unavailable] Rule-based score only.',
      keyConcerns: [],
      recommendedResources: {},
      model: 'unavailable',
      promptVersion: 'n/a',
      generatedAt: Date.now(),
    },
    rule: ruleScore,
    disagreementFlag: aiScore ? delta >= DISAGREEMENT_THRESHOLD : false,
    disagreementDelta: aiScore ? delta : undefined,
    createdAt: Date.now(),
  };
  await db
    .collection(COLLECTIONS.EVENTS)
    .doc(eventId)
    .collection(COLLECTIONS.RISK_SCORES)
    .doc(riskRecord.id)
    .set(riskRecord);

  const resources: ResourceRecommendation = computeResources(event.eventDetails, ruleScore.riskLevel);
  await db
    .collection(COLLECTIONS.EVENTS)
    .doc(eventId)
    .collection(COLLECTIONS.RESOURCES)
    .doc(`${Date.now()}`)
    .set(resources);

  // 5. Audit log.
  await writeAuditLog(eventId, 'risk_score_computed', 'system', {
    metadata: {
      ruleScore: ruleScore.total,
      aiScore: aiScore?.riskScore ?? null,
      delta,
      disagreement: riskRecord.disagreementFlag,
    },
  });

  logger.info(
    `[onEvent] Done ${eventId}: rule=${ruleScore.total}, ai=${aiScore?.riskScore ?? 'n/a'}, ` +
    `disagreement=${riskRecord.disagreementFlag}`,
  );
}

function defaultWeather(): WeatherContext {
  return {
    forecast: 'Unknown',
    temperature: 28,
    humidity: 70,
    windSpeed: 2,
    precipitationProbability: 20,
    severeAlert: false,
  };
}

export const onEventCreated = onDocumentCreated(
  `${COLLECTIONS.EVENTS}/{eventId}`,
  async (event) => {
    const eventId = event.params.eventId;
    try {
      await runRiskAndResourcePipeline(eventId);
    } catch (err) {
      logger.error('[onEventCreated] failed:', err);
    }
  },
);

export const onEventUpdated = onDocumentUpdated(
  `${COLLECTIONS.EVENTS}/{eventId}`,
  async (event) => {
    const eventId = event.params.eventId;
    const before = event.data?.before.data() as EventRecord | undefined;
    const after = event.data?.after.data() as EventRecord | undefined;
    if (!before || !after) return;
    // Only re-run if eventDetails changed AND status is still pending-like.
    if (
      JSON.stringify(before.eventDetails) === JSON.stringify(after.eventDetails) ||
      !['Pending', 'AmendmentRequested', 'UnderReview'].includes(after.status)
    ) {
      return;
    }
    try {
      await runRiskAndResourcePipeline(eventId);
    } catch (err) {
      logger.error('[onEventUpdated] failed:', err);
    }
  },
);
