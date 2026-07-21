import { createHash, randomUUID } from 'node:crypto';
import { firestore } from 'firebase-admin';
import { logger } from 'firebase-functions';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import {
  AssessmentJob,
  AssessmentRecord,
  COLLECTIONS,
  EventRecord,
  EventVersion,
  RESOURCE_FORMULA_VERSION,
  RULE_VERSION,
  ResourceRecommendation,
  RiskAssessment,
  finalScoreFor,
} from '@shared/types';
import { PROMPT_VERSION, refineWithAIOrFallback } from '../engines/aiPredictor';
import { computeResources } from '../engines/resourceCalculator';
import { computeRuleBased, fetchIncidentsForVenue } from '../engines/ruleBased';
import { getHolidayContext, isWeekendDate } from '../utils/holidays';
import { fetchWeather } from '../utils/weather';
import { ASSESSMENT_SECRETS, MINIMAX_API_KEY, OPENWEATHER_API_KEY } from '../config/secrets';
import { FUNCTION_REGION } from '../config/runtime';

const CLAIM_LEASE_MS = 2 * 60 * 1000;

export interface PipelineResult {
  status: 'processed' | 'skipped';
  eventId: string;
  versionId?: string;
  reason?: string;
}

export async function runRiskAndResourcePipeline(eventId: string, now = Date.now()): Promise<PipelineResult> {
  const db = firestore();
  const eventReference = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const eventSnapshot = await eventReference.get();
  if (!eventSnapshot.exists) return { status: 'skipped', eventId, reason: 'event-not-found' };
  const event = { eventId, ...eventSnapshot.data() } as EventRecord;
  if (event.status !== 'Pending' || !event.currentVersionId) {
    return { status: 'skipped', eventId, reason: 'event-not-pending' };
  }

  const versionId = event.currentVersionId;
  const versionReference = eventReference.collection(COLLECTIONS.VERSIONS).doc(versionId);
  const versionSnapshot = await versionReference.get();
  if (!versionSnapshot.exists) throw new Error(`Immutable event version ${versionId} was not found.`);
  const version = versionSnapshot.data() as EventVersion;
  const inputHash = processingHash(version.inputHash);
  const assessmentReference = eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(versionId);
  const resourceReference = eventReference.collection(COLLECTIONS.RESOURCES).doc(versionId);
  const claimId = randomUUID();

  const claimed = await db.runTransaction(async (transaction) => {
    const [currentEventSnapshot, existingSnapshot] = await Promise.all([
      transaction.get(eventReference),
      transaction.get(assessmentReference),
    ]);
    const currentEvent = currentEventSnapshot.data() as EventRecord | undefined;
    if (!currentEvent || currentEvent.status !== 'Pending' || currentEvent.currentVersionId !== versionId) return false;
    const existing = existingSnapshot.data() as AssessmentRecord | undefined;
    if (existing?.status === 'ready' && existing.inputHash === inputHash) return false;
    if (existing?.status === 'processing' && existing.inputHash === inputHash && existing.leaseExpiresAt > now) return false;
    const job: AssessmentJob = {
      assessmentId: versionId,
      eventId,
      versionId,
      status: 'processing',
      inputHash,
      claimId,
      claimedAt: now,
      leaseExpiresAt: now + CLAIM_LEASE_MS,
      createdAt: existing?.createdAt ?? now,
    };
    transaction.set(assessmentReference, job);
    return true;
  });
  if (!claimed) return { status: 'skipped', eventId, versionId, reason: 'already-claimed-or-ready' };

  try {
    const assessedEvent: EventRecord = { ...event, eventDetails: version.eventDetails };
    const [weather, incidentContext] = await Promise.all([
      fetchWeather(version.eventDetails.venueLocation, version.eventDetails.venueName, version.eventDetails.startDatetime, { apiKey: OPENWEATHER_API_KEY.value() }),
      fetchIncidentsForVenue(version.eventDetails.venueId, version.eventDetails.venueName),
    ]);
    const holiday = getHolidayContext(version.eventDetails.startDatetime);
    const isWeekend = isWeekendDate(version.eventDetails.startDatetime);
    const computedAt = Date.now();
    const baseline = await computeRuleBased(
      assessedEvent,
      weather.data,
      holiday.isHolidayOrAdjacent,
      isWeekend,
      incidentContext.incidents,
      computedAt,
      { weather: weather.fetchedAt, history: incidentContext.fetchedAt, holiday: holiday.sourceTimestamp },
      incidentContext.matched,
    );

    const apiKey = MINIMAX_API_KEY.value();
    let ai = await refineWithAIOrFallback(apiKey, assessedEvent, weather.data, holiday.isHolidayOrAdjacent, isWeekend, baseline);

    const { validatedAdjustment, finalScore, finalRiskLevel } = finalScoreFor(baseline.baselineScore, ai.validatedAdjustment);
    ai = { ...ai, validatedAdjustment };
    const createdAt = Date.now();
    const assessment: RiskAssessment = {
      assessmentId: versionId,
      eventId,
      versionId,
      status: 'ready',
      ...baseline,
      ai,
      finalScore,
      finalRiskLevel,
      sourceTimestamps: { weather: weather.fetchedAt, holiday: holiday.sourceTimestamp, incidents: incidentContext.fetchedAt },
      contextStatuses: {
        weather: `${weather.source}:${weather.freshness}`,
        holiday: holiday.sourceVersion,
        incidents: incidentContext.matched ? 'matched' : 'unmatched',
        ai: ai.cacheStatus,
      },
      inputHash,
      createdAt,
    };
    const resources: ResourceRecommendation = {
      resourceId: versionId,
      eventId,
      versionId,
      assessmentId: versionId,
      ...computeResources(version.eventDetails, assessment.finalRiskLevel),
      formulaVersion: RESOURCE_FORMULA_VERSION,
      confidenceLevel: 'prototype',
      notes: 'Prototype heuristics pending authority validation.',
      computedAt: createdAt,
    };

    const finalized = await db.runTransaction(async (transaction) => {
      const [claimSnapshot, currentEventSnapshot] = await Promise.all([
        transaction.get(assessmentReference),
        transaction.get(eventReference),
      ]);
      const claim = claimSnapshot.data() as AssessmentRecord | undefined;
      const currentEvent = currentEventSnapshot.data() as EventRecord | undefined;
      if (claim?.status !== 'processing' || claim.claimId !== claimId) return false;
      if (!currentEvent || currentEvent.status !== 'Pending' || currentEvent.currentVersionId !== versionId) return false;
      transaction.set(assessmentReference, assessment);
      transaction.set(resourceReference, resources);
      transaction.update(eventReference, { currentAssessmentId: versionId, currentResourceId: versionId, updatedAt: createdAt });
      transaction.set(eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(`${versionId}-risk-score-computed`), {
        id: `${versionId}-risk-score-computed`, eventId, versionId, action: 'risk_score_computed', actorId: 'system', actorRole: 'system', timestamp: createdAt,
        metadata: { baselineScore: baseline.baselineScore, aiStatus: ai.status, aiCacheStatus: ai.cacheStatus, model: ai.model, promptVersion: ai.promptVersion, validatedAdjustment, finalScore, inputHash },
      });
      transaction.set(eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(`${versionId}-resource-recommended`), {
        id: `${versionId}-resource-recommended`, eventId, versionId, action: 'resource_recommended', actorId: 'system', actorRole: 'system', timestamp: createdAt,
        metadata: { resourceId: versionId, formulaVersion: RESOURCE_FORMULA_VERSION },
      });
      return true;
    });
    if (!finalized) return { status: 'skipped', eventId, versionId, reason: 'claim-lost-or-version-changed' };
    logger.info(`[assessment] ${eventId}/${versionId}: baseline=${baseline.baselineScore}, adjustment=${validatedAdjustment}, final=${finalScore}`);
    return { status: 'processed', eventId, versionId };
  } catch (error) {
    await markFailed(assessmentReference, claimId, inputHash, error);
    throw error;
  }
}

function processingHash(versionInputHash: string): string {
  return createHash('sha256').update(JSON.stringify({ versionInputHash, ruleVersion: RULE_VERSION, promptVersion: PROMPT_VERSION, formulaVersion: RESOURCE_FORMULA_VERSION })).digest('hex');
}

async function markFailed(reference: FirebaseFirestore.DocumentReference, claimId: string, inputHash: string, error: unknown): Promise<void> {
  const db = firestore();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.data() as AssessmentRecord | undefined;
    if (current?.status !== 'processing' || current.claimId !== claimId) return;
    transaction.set(reference, {
      ...current,
      status: 'failed',
      inputHash,
      error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown assessment failure',
      leaseExpiresAt: Date.now(),
    } satisfies AssessmentJob);
  });
}

export const onEventCreated = onDocumentCreated({ document: `${COLLECTIONS.EVENTS}/{eventId}`, region: FUNCTION_REGION, secrets: ASSESSMENT_SECRETS }, async (trigger) => {
  try {
    await runRiskAndResourcePipeline(trigger.params.eventId);
  } catch (error) {
    logger.error('[onEventCreated] failed', error);
  }
});

export const onEventUpdated = onDocumentUpdated({ document: `${COLLECTIONS.EVENTS}/{eventId}`, region: FUNCTION_REGION, secrets: ASSESSMENT_SECRETS }, async (trigger) => {
  const before = trigger.data?.before.data() as EventRecord | undefined;
  const after = trigger.data?.after.data() as EventRecord | undefined;
  if (!before || !after || after.status !== 'Pending') return;
  if (before.status === 'Pending' && before.currentVersionId === after.currentVersionId) return;
  try {
    await runRiskAndResourcePipeline(trigger.params.eventId);
  } catch (error) {
    logger.error('[onEventUpdated] failed', error);
  }
});
