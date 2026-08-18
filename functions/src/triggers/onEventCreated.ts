import { createHash, randomUUID } from 'node:crypto';
import { firestore } from 'firebase-admin';
import { logger } from 'firebase-functions';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import {
  ASSESSMENT_SCHEMA_VERSION,
  AssessmentJob,
  AssessmentRecord,
  CATEGORY_SCHEMA_VERSION,
  COLLECTIONS,
  DeterministicCategoryResult,
  EventRecord,
  EventVersion,
  HARD_RULE_VERSION,
  ManualReviewRiskAssessment,
  OrganizerAssessmentSummary,
  PROVISIONAL_FORMULA_VERSION,
  ProvisionalRiskAssessment,
  RESOURCE_FORMULA_VERSION,
  RESOURCE_GUIDELINE_VERSION,
  SCORING_LOGIC_VERSION,
  ResourceRecommendation,
  RiskAssessment,
  UserProfile,
  ValidationWarning,
} from '@shared/types';
import { AI_RESPONSE_SCHEMA_VERSION, PROMPT_VERSION, analyseWithAI } from '../engines/aiPredictor';
import { validateAndCalculateProvisional } from '../engines/assessmentValidator';
import { computeResources } from '../engines/resourceCalculator';
import { computeCategoryBasedAssessment, fetchHistoricalContext, fetchVenueContext } from '../engines/ruleBased';
import { getCalendarContext } from '../utils/holidays';
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

export interface RetryAuthorization {
  uid: string;
  authorityType: UserProfile['authorityType'];
}

export async function runRiskAndResourcePipeline(
  eventId: string,
  now = Date.now(),
  retryManual = false,
  retryAuthorization?: RetryAuthorization,
): Promise<PipelineResult> {
  const db = firestore();
  const eventReference = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const eventSnapshot = await eventReference.get();
  if (!eventSnapshot.exists) return { status: 'skipped', eventId, reason: 'event-not-found' };
  const event = { eventId, ...eventSnapshot.data() } as EventRecord;
  if (event.status !== 'Pending' || !event.currentVersionId) return { status: 'skipped', eventId, reason: 'event-not-pending' };

  const versionId = event.currentVersionId;
  const versionReference = eventReference.collection(COLLECTIONS.VERSIONS).doc(versionId);
  const assessmentReference = eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(versionId);
  const summaryReference = eventReference.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).doc(versionId);
  const resourceReference = eventReference.collection(COLLECTIONS.RESOURCES).doc(versionId);
  const versionSnapshot = await versionReference.get();
  if (!versionSnapshot.exists) {
    await recordMissingVersionFailure(eventReference, assessmentReference, summaryReference, resourceReference, eventId, versionId, now);
    return { status: 'processed', eventId, versionId, reason: 'version-not-found' };
  }
  const version = versionSnapshot.data() as EventVersion;
  const inputHash = processingHash(version.inputHash);
  const claimId = randomUUID();

  const claimed = await db.runTransaction(async (transaction) => {
    const retryUserReference = retryAuthorization
      ? db.collection(COLLECTIONS.USERS).doc(retryAuthorization.uid)
      : undefined;
    const [currentEventSnapshot, existingSnapshot, retryUserSnapshot] = await Promise.all([
      transaction.get(eventReference),
      transaction.get(assessmentReference),
      retryUserReference ? transaction.get(retryUserReference) : Promise.resolve(undefined),
    ]);
    const currentEvent = currentEventSnapshot.data() as EventRecord | undefined;
    if (!currentEvent || currentEvent.status !== 'Pending' || currentEvent.currentVersionId !== versionId) return false;
    if (retryManual) {
      const retryUser = retryUserSnapshot?.data() as UserProfile | undefined;
      if (!retryAuthorization
        || retryUser?.role !== 'authority'
        || retryUser.authorityType !== retryAuthorization.authorityType
        || !retryUser.authorityType
        || !currentEvent.requiredAuthorities.includes(retryUser.authorityType)) return 'retry-not-authorized';
    }
    const existing = existingSnapshot.data() as AssessmentRecord | undefined;
    if (retryManual && existing?.status !== 'manual_review_required' && existing?.status !== 'failed') {
      return 'retry-not-retryable';
    }
    if (existing && ['provisional_ready', 'authority_review', 'official_ready'].includes(existing.status) && existing.inputHash === inputHash) return false;
    if (existing?.status === 'manual_review_required' && existing.inputHash === inputHash && !retryManual) return false;
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
  if (claimed === 'retry-not-authorized') return { status: 'skipped', eventId, versionId, reason: claimed };
  if (claimed === 'retry-not-retryable') return { status: 'skipped', eventId, versionId, reason: claimed };
  if (!claimed) return { status: 'skipped', eventId, versionId, reason: 'already-claimed-or-ready' };

  try {
    const assessedEvent: EventRecord = { ...event, eventDetails: version.eventDetails };
    const [weather, incidentHistory, venue] = await Promise.all([
      fetchWeather(version.eventDetails.venueLocation, version.eventDetails.venueName, version.eventDetails.startDatetime, { apiKey: OPENWEATHER_API_KEY.value() }),
      fetchHistoricalContext(assessedEvent),
      fetchVenueContext(version.eventDetails.venueId, version.eventDetails.venueName, version.eventDetails.venueCapacity),
    ]);
    const calendar = getCalendarContext(version.eventDetails.startDatetime);
    const contextSnapshot = { weather, calendar, venue, incidentHistory };
    const baseline = computeCategoryBasedAssessment(assessedEvent, contextSnapshot, Date.now());
    const createdAt = Date.now();
    const common = {
      assessmentId: versionId,
      eventId,
      versionId,
      schemaVersion: ASSESSMENT_SCHEMA_VERSION,
      contextSnapshot,
      evidence: baseline.evidence,
      sourceTimestamps: { weather: weather.fetchedAt, holiday: calendar.sourceTimestamp, venue: venue.fetchedAt, incidents: incidentHistory.fetchedAt },
      contextStatuses: {
        weather: `${weather.source}:${weather.freshness}`,
        holiday: calendar.sourceVersion,
        venue: venue.matched ? 'matched' : 'unmatched',
        incidents: incidentHistory.matched ? 'matched' : 'unmatched',
      },
      assessmentReadiness: baseline.assessmentReadiness ?? 'insufficient_data',
      complianceStatus: baseline.complianceStatus ?? 'review_required',
      complianceChecks: baseline.complianceChecks ?? [],
      dataConfidenceScore: baseline.dataConfidenceScore ?? 0,
      dataConfidenceLevel: baseline.dataConfidenceLevel ?? 'low',
      inputHash,
      createdAt,
    } as const;

    let assessment: RiskAssessment;
    let resources: ResourceRecommendation | undefined;
    const readinessWarnings: ValidationWarning[] = [];
    if (common.assessmentReadiness === 'provisional') readinessWarnings.push({
      warningId: 'missing_evidence.assessment.provisional',
      code: 'missing_evidence',
      message: 'The assessment is provisional because one or more evidence sources are incomplete or stale.',
      evidenceReferences: [],
    });
    if (common.complianceStatus === 'blocked') readinessWarnings.push({
      warningId: 'rubric_conflict.compliance.blocked',
      code: 'rubric_conflict',
      message: 'A blocked compliance check prevents approval even when a provisional score is available.',
      evidenceReferences: ['compliance'],
    });
    if (common.assessmentReadiness === 'insufficient_data') {
      assessment = manualAssessment(common, null, [{
        warningId: 'missing_evidence.assessment',
        code: 'missing_evidence',
        message: 'The application does not contain sufficient eligible evidence for AI assessment.',
        evidenceReferences: [],
      }], 'Insufficient application evidence requires manual review.');
    } else {
      const aiProposal = await analyseWithAI(MINIMAX_API_KEY.value(), assessedEvent, contextSnapshot, baseline);
      if (aiProposal.status !== 'success') {
        const failureWarnings: ValidationWarning[] = aiProposal.status === 'invalid' ? [{
          warningId: 'invalid_calculation.ai.invalid-output',
          code: 'invalid_calculation',
          message: 'MiniMax returned output that did not satisfy the required assessment schema.',
          evidenceReferences: [],
        }] : [];
        assessment = manualAssessment(common, aiProposal, [...readinessWarnings, ...failureWarnings], `MiniMax ${aiProposal.status}: ${aiProposal.errorSummary}`);
      } else {
        const validation = validateAndCalculateProvisional(aiProposal, baseline, createdAt);
        if (!validation.ok) {
          assessment = manualAssessment(
            common,
            aiProposal,
            [...readinessWarnings, ...validation.warnings],
            validation.reason,
          );
        } else {
          assessment = {
            ...common,
            status: 'provisional_ready',
            aiProposal,
            warnings: [...readinessWarnings, ...validation.warnings],
            authorityReviewRequired: true,
            provisionalResult: validation.result,
          } satisfies ProvisionalRiskAssessment;
          resources = provisionalResources(version, validation.result, baseline, aiProposal.categories.flatMap((category) => category.concerns), createdAt);
        }
      }
    }

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
      transaction.set(summaryReference, organizerSummary(assessment, resources, createdAt));
      if (resources) transaction.set(resourceReference, resources);
      else transaction.delete(resourceReference);
      transaction.update(eventReference, {
        currentAssessmentId: versionId,
        currentResourceId: resources ? versionId : firestore.FieldValue.delete(),
        updatedAt: createdAt,
      });
      transaction.set(eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(`${versionId}-risk-score-computed-v3`), {
        id: `${versionId}-risk-score-computed-v3`, eventId, versionId, action: 'risk_score_computed', actorId: 'system', actorRole: 'system', timestamp: createdAt,
        metadata: {
          assessmentStatus: assessment.status,
          schemaVersion: ASSESSMENT_SCHEMA_VERSION,
          provisionalScore: assessment.status === 'provisional_ready' ? assessment.provisionalResult.overallScore : null,
          provisionalRiskLevel: assessment.status === 'provisional_ready' ? assessment.provisionalResult.overallRiskLevel : null,
          aiStatus: assessment.aiProposal?.status ?? 'not-attempted',
          inputHash,
        },
      });
      if (resources) transaction.set(eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(`${versionId}-resource-recommended-v3`), {
        id: `${versionId}-resource-recommended-v3`, eventId, versionId, action: 'resource_recommended', actorId: 'system', actorRole: 'system', timestamp: createdAt,
        metadata: { resourceId: versionId, assessmentStage: 'provisional', formulaVersion: RESOURCE_FORMULA_VERSION, guidelineVersion: RESOURCE_GUIDELINE_VERSION },
      });
      return true;
    });
    if (!finalized) return { status: 'skipped', eventId, versionId, reason: 'claim-lost-or-version-changed' };
    logger.info(`[assessment] ${eventId}/${versionId}: status=${assessment.status}, ai=${assessment.aiProposal?.status ?? 'not-attempted'}`);
    return { status: 'processed', eventId, versionId };
  } catch (error) {
    await markFailed(assessmentReference, summaryReference, claimId, inputHash, error);
    throw error;
  }
}

async function recordMissingVersionFailure(
  eventReference: FirebaseFirestore.DocumentReference,
  assessmentReference: FirebaseFirestore.DocumentReference,
  summaryReference: FirebaseFirestore.DocumentReference,
  resourceReference: FirebaseFirestore.DocumentReference,
  eventId: string,
  versionId: string,
  now: number,
): Promise<void> {
  const inputHash = processingHash(`missing-version:${versionId}`);
  const claimId = randomUUID();
  await firestore().runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(eventReference);
    const current = currentSnapshot.data() as EventRecord | undefined;
    if (!current || current.status !== 'Pending' || current.currentVersionId !== versionId) return;
    transaction.set(assessmentReference, {
      assessmentId: versionId,
      eventId,
      versionId,
      status: 'failed',
      inputHash,
      claimId,
      claimedAt: now,
      leaseExpiresAt: now,
      error: `Immutable event version ${versionId} was not found.`,
      createdAt: now,
    } satisfies AssessmentJob);
    transaction.set(summaryReference, {
      assessmentId: versionId, eventId, versionId, schemaVersion: ASSESSMENT_SCHEMA_VERSION,
      status: 'failed', categories: [], authorityReviewRequired: true, computedAt: now,
    } satisfies OrganizerAssessmentSummary);
    transaction.delete(resourceReference);
    transaction.update(eventReference, {
      currentAssessmentId: versionId,
      currentResourceId: firestore.FieldValue.delete(),
      updatedAt: now,
    });
    transaction.set(eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(`${versionId}-risk-score-computed-v3`), {
      id: `${versionId}-risk-score-computed-v3`, eventId, versionId, action: 'risk_score_computed',
      actorId: 'system', actorRole: 'system', timestamp: now,
      metadata: { assessmentStatus: 'failed', schemaVersion: ASSESSMENT_SCHEMA_VERSION, inputHash, reason: 'version-not-found' },
    });
  });
}

function manualAssessment(
  common: Omit<ManualReviewRiskAssessment, 'status' | 'aiProposal' | 'warnings' | 'authorityReviewRequired' | 'manualReviewReason'>,
  aiProposal: ManualReviewRiskAssessment['aiProposal'],
  warnings: ValidationWarning[],
  reason: string,
): ManualReviewRiskAssessment {
  return { ...common, status: 'manual_review_required', aiProposal, warnings, authorityReviewRequired: true, manualReviewReason: reason };
}

function provisionalResources(
  version: EventVersion,
  provisional: ProvisionalRiskAssessment['provisionalResult'],
  baseline: DeterministicCategoryResult,
  aiConsiderations: string[],
  computedAt: number,
): ResourceRecommendation {
  const compatible: DeterministicCategoryResult = {
    ...baseline,
    categoryAssignments: provisional.categories.map((category) => ({
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      score: category.normalizedScore,
      riskLevel: category.riskLevel,
      weight: category.weight,
      weightedContribution: category.weightedContribution,
      rationale: category.rationale,
      evidenceKeys: category.evidenceReferences,
      guidelineChecks: category.guidelineChecks,
    })),
    officialScore: provisional.overallScore,
    officialRiskLevel: provisional.overallRiskLevel,
    computedAt,
  };
  const calculation = computeResources(version.eventDetails, compatible);
  return {
    resourceId: version.versionId,
    eventId: version.eventId,
    versionId: version.versionId,
    assessmentId: version.versionId,
    ...calculation.quantities,
    rationales: calculation.rationales,
    items: calculation.items,
    formulaVersion: RESOURCE_FORMULA_VERSION,
    guidelineVersion: RESOURCE_GUIDELINE_VERSION,
    guidelineStatus: 'prototype',
    aiConsiderations,
    confidenceLevel: 'prototype',
    assessmentStage: 'provisional',
    notes: 'Provisional planning ranges; authority validation and official assessment are pending.',
    computedAt,
  };
}

function processingHash(versionInputHash: string): string {
  return createHash('sha256').update(JSON.stringify({
    versionInputHash,
    assessmentSchemaVersion: ASSESSMENT_SCHEMA_VERSION,
    categorySchemaVersion: CATEGORY_SCHEMA_VERSION,
    scoringLogicVersion: SCORING_LOGIC_VERSION,
    hardRuleVersion: HARD_RULE_VERSION,
    provisionalFormulaVersion: PROVISIONAL_FORMULA_VERSION,
    promptVersion: PROMPT_VERSION,
    aiResponseSchemaVersion: AI_RESPONSE_SCHEMA_VERSION,
    resourceFormulaVersion: RESOURCE_FORMULA_VERSION,
    resourceGuidelineVersion: RESOURCE_GUIDELINE_VERSION,
  })).digest('hex');
}

async function markFailed(
  reference: FirebaseFirestore.DocumentReference,
  summaryReference: FirebaseFirestore.DocumentReference,
  claimId: string,
  inputHash: string,
  error: unknown,
): Promise<void> {
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
    transaction.set(summaryReference, {
      assessmentId: current.assessmentId,
      eventId: current.eventId,
      versionId: current.versionId,
      schemaVersion: ASSESSMENT_SCHEMA_VERSION,
      status: 'failed',
      categories: [],
      authorityReviewRequired: true,
      computedAt: Date.now(),
    } satisfies OrganizerAssessmentSummary);
  });
}

function organizerSummary(
  assessment: RiskAssessment,
  resources: ResourceRecommendation | undefined,
  computedAt: number,
): OrganizerAssessmentSummary {
  const result = assessment.status === 'official_ready'
    ? assessment.officialResult
    : assessment.status === 'provisional_ready' || assessment.status === 'authority_review'
      ? assessment.provisionalResult
      : undefined;
  return {
    assessmentId: assessment.assessmentId,
    eventId: assessment.eventId,
    versionId: assessment.versionId,
    schemaVersion: assessment.schemaVersion,
    status: assessment.status,
    ...(result ? { overallScore: result.overallScore, overallRiskLevel: result.overallRiskLevel } : {}),
    categories: result?.categories.map((category) => ({
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      normalizedScore: category.normalizedScore,
      riskLevel: category.riskLevel,
    })) ?? [],
    assessmentReadiness: assessment.assessmentReadiness,
    complianceStatus: assessment.complianceStatus,
    authorityReviewRequired: assessment.authorityReviewRequired,
    ...(resources ? { resourceQuantities: {
      police: resources.police,
      security: resources.security,
      medicalTeams: resources.medicalTeams,
      ambulances: resources.ambulances,
      fireOfficers: resources.fireOfficers,
      toilets: resources.toilets,
      wasteBins: resources.wasteBins,
    } } : {}),
    computedAt,
  };
}

export const onEventCreated = onDocumentCreated({ document: `${COLLECTIONS.EVENTS}/{eventId}`, region: FUNCTION_REGION, secrets: ASSESSMENT_SECRETS }, async (trigger) => {
  try { await runRiskAndResourcePipeline(trigger.params.eventId); } catch (error) { logger.error('[onEventCreated] failed', error); }
});

export const onEventUpdated = onDocumentUpdated({ document: `${COLLECTIONS.EVENTS}/{eventId}`, region: FUNCTION_REGION, secrets: ASSESSMENT_SECRETS }, async (trigger) => {
  const before = trigger.data?.before.data() as EventRecord | undefined;
  const after = trigger.data?.after.data() as EventRecord | undefined;
  if (!before || !after || after.status !== 'Pending') return;
  if (before.status === 'Pending' && before.currentVersionId === after.currentVersionId) return;
  try { await runRiskAndResourcePipeline(trigger.params.eventId); } catch (error) { logger.error('[onEventUpdated] failed', error); }
});
