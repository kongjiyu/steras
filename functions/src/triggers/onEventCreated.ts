import { createHash, randomUUID } from 'node:crypto';
import { firestore } from 'firebase-admin';
import { logger } from 'firebase-functions';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import {
  ASSESSMENT_SCHEMA_VERSION,
  AdminManualAssessment,
  AdminManualOfficialRiskAssessment,
  AssessmentJob,
  AssessmentRecord,
  AIFailedProposal,
  AISuccessfulProposal,
  AuthorityScoreResolution,
  AuthorityScoreReview,
  CATEGORY_SCHEMA_VERSION,
  COLLECTIONS,
  EventRecord,
  EventVersion,
  HARD_RULE_VERSION,
  ManualReviewRiskAssessment,
  OrganizerAssessmentSummary,
  OrganizerResourceRecommendation,
  OFFICIAL_FORMULA_VERSION,
  OfficialRiskAssessment,
  PROVISIONAL_FORMULA_VERSION,
  ProvisionalRiskAssessment,
  RESOURCE_CONFIG_VERSION,
  RESOURCE_FORMULA_VERSION,
  RESOURCE_KEYS,
  RESOURCE_SCHEMA_VERSION,
  RESOURCE_SOURCE_REGISTRY_VERSION,
  SCORING_LOGIC_VERSION,
  ResourceRecommendation,
  RiskAssessment,
  UserProfile,
  ValidationWarning,
} from '@shared/types';
import { AI_RESPONSE_SCHEMA_VERSION, PROMPT_VERSION, analyseWithAI } from '../engines/aiPredictor';
import { validateAndCalculateProvisional } from '../engines/assessmentValidator';
import { buildOfficialAssessmentResult } from '../engines/authorityFinalisation';
import { buildManualOfficialAssessmentResult } from '../engines/manualFinalisation';
import {
  computeResources,
  ResourceCalculationResult,
  stableStringify,
  validateAssessmentResultAgainstHardRules,
  validateAssessmentResultAgainstProposal,
  validateProvisionalAssessmentResult,
  validateManualOfficialAssessmentResult,
} from '../engines/resourceCalculator';
import { validateResourceRecommendation, validateResourceRevisionChain } from '../engines/resourceContract';
import { computeCategoryBasedAssessment, fetchHistoricalContext, fetchVenueContext } from '../engines/ruleBased';
import { getCalendarContext } from '../utils/holidays';
import { fetchWeather } from '../utils/weather';
import { ASSESSMENT_SECRETS, MINIMAX_API_KEY, OPENWEATHER_API_KEY } from '../config/secrets';
import { FUNCTION_REGION } from '../config/runtime';
import { createResourceCutoverQueueToken, RESOURCE_CUTOVER_LOCK_PATH } from '../config/resourceCutoverLock';

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
  if (!isSafeDocumentId(event.currentVersionId)) return { status: 'skipped', eventId, reason: 'invalid-current-version' };

  const versionId = event.currentVersionId;
  const versionReference = eventReference.collection(COLLECTIONS.VERSIONS).doc(versionId);
  const assessmentReference = eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(versionId);
  const summaryReference = eventReference.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).doc(versionId);
  const versionSnapshot = await versionReference.get();
  if (!versionSnapshot.exists) {
    await recordMissingVersionFailure(eventReference, assessmentReference, summaryReference, eventId, versionId, now);
    return { status: 'processed', eventId, versionId, reason: 'version-not-found' };
  }
  const version = versionSnapshot.data() as EventVersion;
  if (!isPipelineEventVersion(version, eventId, versionId)) {
    await recordMissingVersionFailure(eventReference, assessmentReference, summaryReference, eventId, versionId, now, 'invalid-version-contract');
    return { status: 'processed', eventId, versionId, reason: 'invalid-version-contract' };
  }
  const inputHash = processingHash(version.inputHash);
  const claimId = randomUUID();

  const claimed = await db.runTransaction(async (transaction) => {
    const retryUserReference = retryAuthorization
      ? db.collection(COLLECTIONS.USERS).doc(retryAuthorization.uid)
      : undefined;
    const [currentEventSnapshot, existingSnapshot, retryUserSnapshot, cutoverLockSnapshot] = await Promise.all([
      transaction.get(eventReference),
      transaction.get(assessmentReference),
      retryUserReference ? transaction.get(retryUserReference) : Promise.resolve(undefined),
      transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
    ]);
    if (cutoverLockSnapshot.exists) return false;
    const currentEvent = currentEventSnapshot.data() as EventRecord | undefined;
    if (!currentEvent || currentEvent.status !== 'Pending' || currentEvent.currentVersionId !== versionId
      || (currentEvent.currentAssessmentId !== undefined && currentEvent.currentAssessmentId !== versionId)) return false;
    if (retryManual) {
      const retryUser = retryUserSnapshot?.data() as UserProfile | undefined;
      if (!retryAuthorization
        || retryUser?.role !== 'authority'
        || retryUser.authorityType !== retryAuthorization.authorityType
        || !retryUser.authorityType
        || !Array.isArray(currentEvent.requiredAuthorities)
        || !currentEvent.requiredAuthorities.includes(retryUser.authorityType)) return 'retry-not-authorized';
    }
    const existing = existingSnapshot.data() as AssessmentRecord | undefined;
    if (retryManual && existing?.status !== 'manual_review_required' && existing?.status !== 'failed') {
      return 'retry-not-retryable';
    }
    const existingManualLock = manualLockState(existing);
    if (existingManualLock === 'invalid') return 'retry-not-retryable';
    if (existingManualLock === 'valid') return retryManual ? 'retry-not-retryable' : false;
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
  if (!claimed) {
    const resourceResult = await recomputeResourceForStoredAssessment(eventId, now);
    return {
      status: 'skipped',
      eventId,
      versionId,
      reason: resourceResult.status === 'failed' ? 'already-claimed-or-ready' : `assessment-ready-resource-${resourceResult.status}`,
    };
  }

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
    let resourceCalculation: ResourceCalculationResult | undefined;
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
            invalidAiProposalForManualRecovery(aiProposal, validation.reason),
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
          resourceCalculation = computeResources({
            eventId,
            versionId,
            assessmentId: assessment.assessmentId,
            eventDetails: version.eventDetails,
            assessmentResult: validation.result,
          });
        }
      }
    }

    const finalized = await db.runTransaction(async (transaction) => {
      const [claimSnapshot, currentEventSnapshot, cutoverLockSnapshot] = await Promise.all([
        transaction.get(assessmentReference),
        transaction.get(eventReference),
        transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
      ]);
      const claim = claimSnapshot.data() as AssessmentRecord | undefined;
      const currentEvent = currentEventSnapshot.data() as EventRecord | undefined;
      if (claim?.status !== 'processing' || claim.claimId !== claimId) return false;
      if (!currentEvent || currentEvent.status !== 'Pending' || currentEvent.currentVersionId !== versionId
        || (currentEvent.currentAssessmentId !== undefined && currentEvent.currentAssessmentId !== assessment.assessmentId)) return false;
      // A manual assessment is an exclusive recovery path for this generation.
      // Never let a late AI transaction overwrite its persisted manual lock or
      // publish a provisional resource after Admin has claimed the assessment.
      if (manualLockState(claim) !== 'absent') return false;
      if (cutoverLockSnapshot.exists) {
        transaction.update(db.doc(RESOURCE_CUTOVER_LOCK_PATH), {
          queuedEvents: firestore.FieldValue.arrayUnion(createResourceCutoverQueueToken({
            eventId,
            currentVersionId: versionId,
            currentAssessmentId: assessment.assessmentId,
            assessmentInputHash: assessment.inputHash,
            generationId: claimId,
            queuedAt: createdAt,
          })),
        });
      }
      transaction.set(assessmentReference, assessment);
      transaction.set(summaryReference, organizerSummary(assessment, undefined, createdAt));
      transaction.update(eventReference, {
        currentAssessmentId: versionId,
        currentResourceId: firestore.FieldValue.delete(),
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
      return true;
    });
    if (!finalized) return { status: 'skipped', eventId, versionId, reason: 'claim-lost-or-version-changed' };
    if (assessment.status === 'provisional_ready' && resourceCalculation) {
      await persistResourceCalculation(eventReference, version, assessment, resourceCalculation, createdAt);
    }
    logger.info(`[assessment] ${eventId}/${versionId}: status=${assessment.status}, ai=${assessment.aiProposal?.status ?? 'not-attempted'}`);
    return { status: 'processed', eventId, versionId };
  } catch (error) {
    await markFailed(eventReference, assessmentReference, summaryReference, claimId, inputHash, error);
    throw error;
  }
}

async function recordMissingVersionFailure(
  eventReference: FirebaseFirestore.DocumentReference,
  assessmentReference: FirebaseFirestore.DocumentReference,
  summaryReference: FirebaseFirestore.DocumentReference,
  eventId: string,
  versionId: string,
  now: number,
  reason: 'version-not-found' | 'invalid-version-contract' = 'version-not-found',
): Promise<void> {
  const db = firestore();
  const inputHash = processingHash(`${reason}:${versionId}`);
  const claimId = randomUUID();
  await db.runTransaction(async (transaction) => {
    const [currentSnapshot, assessmentSnapshot, cutoverLockSnapshot] = await Promise.all([
      transaction.get(eventReference),
      transaction.get(assessmentReference),
      transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
    ]);
    const current = currentSnapshot.data() as EventRecord | undefined;
    if (!current || current.status !== 'Pending' || current.currentVersionId !== versionId
      || (current.currentAssessmentId !== undefined && current.currentAssessmentId !== versionId)) return;
    if (manualLockState(assessmentSnapshot.data()) !== 'absent') return;
    if (cutoverLockSnapshot.exists) transaction.update(db.doc(RESOURCE_CUTOVER_LOCK_PATH), {
      queuedEvents: firestore.FieldValue.arrayUnion(createResourceCutoverQueueToken({
        eventId, currentVersionId: versionId, currentAssessmentId: versionId,
        assessmentInputHash: inputHash, generationId: claimId, queuedAt: now,
      })),
    });
    transaction.set(assessmentReference, {
      assessmentId: versionId,
      eventId,
      versionId,
      status: 'failed',
      inputHash,
      claimId,
      claimedAt: now,
      leaseExpiresAt: now,
      error: reason === 'version-not-found'
        ? `Immutable event version ${versionId} was not found.`
        : `Immutable event version ${versionId} failed runtime contract validation.`,
      createdAt: now,
    } satisfies AssessmentJob);
    transaction.set(summaryReference, {
      assessmentId: versionId, eventId, versionId, schemaVersion: ASSESSMENT_SCHEMA_VERSION,
      status: 'failed', categories: [], authorityReviewRequired: true, computedAt: now,
    } satisfies OrganizerAssessmentSummary);
    transaction.update(eventReference, {
      currentAssessmentId: versionId,
      currentResourceId: firestore.FieldValue.delete(),
      updatedAt: now,
    });
    transaction.set(eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(`${versionId}-risk-score-computed-v3`), {
      id: `${versionId}-risk-score-computed-v3`, eventId, versionId, action: 'risk_score_computed',
      actorId: 'system', actorRole: 'system', timestamp: now,
      metadata: { assessmentStatus: 'failed', schemaVersion: ASSESSMENT_SCHEMA_VERSION, inputHash, reason },
    });
  });
}

function isPipelineEventVersion(value: unknown, eventId: string, versionId: string): value is EventVersion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const version = value as Record<string, unknown>;
  const details = version.eventDetails;
  if (version.eventId !== eventId || version.versionId !== versionId
    || !Number.isSafeInteger(version.versionNumber) || Number(version.versionNumber) < 1
    || !Array.isArray(version.documentPaths) || !version.documentPaths.every((path) => typeof path === 'string')
    || typeof version.submittedBy !== 'string' || !version.submittedBy.trim()
    || !Number.isFinite(version.submittedAt)
    || typeof version.inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(version.inputHash)
    || !details || typeof details !== 'object' || Array.isArray(details)) return false;
  const eventDetails = details as Record<string, unknown>;
  return typeof eventDetails.name === 'string' && Boolean(eventDetails.name.trim())
    && typeof eventDetails.type === 'string' && Boolean(eventDetails.type.trim())
    && typeof eventDetails.venueName === 'string' && Boolean(eventDetails.venueName.trim())
    && typeof eventDetails.venueAddress === 'string' && Boolean(eventDetails.venueAddress.trim())
    && Number.isFinite(eventDetails.venueCapacity) && Number(eventDetails.venueCapacity) >= 0
    && Number.isFinite(eventDetails.expectedAttendance) && Number(eventDetails.expectedAttendance) >= 0
    && ['indoor', 'outdoor', 'mixed'].includes(String(eventDetails.environment))
    && ['covered', 'partially_covered', 'uncovered'].includes(String(eventDetails.coverage))
    && ['seated', 'standing', 'mixed'].includes(String(eventDetails.seating))
    && Number.isFinite(eventDetails.startDatetime) && Number.isFinite(eventDetails.endDatetime)
    && Number(eventDetails.endDatetime) >= Number(eventDetails.startDatetime)
    && typeof eventDetails.emergencyPlanSummary === 'string';
}

function manualAssessment(
  common: Omit<ManualReviewRiskAssessment, 'status' | 'aiProposal' | 'warnings' | 'authorityReviewRequired' | 'manualReviewReason'>,
  aiProposal: ManualReviewRiskAssessment['aiProposal'],
  warnings: ValidationWarning[],
  reason: string,
): ManualReviewRiskAssessment {
  return { ...common, status: 'manual_review_required', aiProposal, warnings, authorityReviewRequired: true, manualReviewReason: reason };
}

type ManualLockState = 'absent' | 'valid' | 'invalid';

function manualLockState(value: unknown): ManualLockState {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Object.prototype.hasOwnProperty.call(value, 'activeManualAssessmentId')) return 'absent';
  const id = (value as { activeManualAssessmentId?: unknown }).activeManualAssessmentId;
  return isSafeManualAssessmentId(id) ? 'valid' : 'invalid';
}

function isSafeManualAssessmentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function isSafeDocumentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/**
 * A syntactically valid MiniMax response can still fail deterministic validation
 * (for example, because all of a category's evidence references are unsupported).
 * Do not persist that response as a successful proposal: its scores are not an
 * eligible input for manual recovery. Preserve only the attempt metadata and a
 * bounded validation error so Admin can retry or provide an assessment without
 * treating invalid AI output as an authoritative proposal.
 */
export function invalidAiProposalForManualRecovery(
  proposal: AISuccessfulProposal,
  reason: string,
): AIFailedProposal {
  const model = typeof proposal.model === 'string' && proposal.model.trim() ? proposal.model : 'unknown';
  const promptVersion = typeof proposal.promptVersion === 'string' && proposal.promptVersion.trim()
    ? proposal.promptVersion
    : PROMPT_VERSION;
  const responseSchemaVersion = typeof proposal.responseSchemaVersion === 'string' && proposal.responseSchemaVersion.trim()
    ? proposal.responseSchemaVersion
    : AI_RESPONSE_SCHEMA_VERSION;
  return {
    status: 'invalid',
    model,
    promptVersion,
    responseSchemaVersion,
    retryable: true,
    errorSummary: `MiniMax proposal failed deterministic validation: ${reason}`.slice(0, 500),
    cacheStatus: 'not-applicable',
    generatedAt: Number.isFinite(proposal.generatedAt) ? proposal.generatedAt : Date.now(),
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
  })).digest('hex');
}

async function markFailed(
  eventReference: FirebaseFirestore.DocumentReference,
  reference: FirebaseFirestore.DocumentReference,
  summaryReference: FirebaseFirestore.DocumentReference,
  claimId: string,
  inputHash: string,
  error: unknown,
): Promise<void> {
  const db = firestore();
  await db.runTransaction(async (transaction) => {
    const [snapshot, cutoverLockSnapshot, eventSnapshot] = await Promise.all([
      transaction.get(reference),
      transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
      transaction.get(eventReference),
    ]);
    const current = snapshot.data() as AssessmentRecord | undefined;
    if (current?.status !== 'processing' || current.claimId !== claimId) return;
    if (manualLockState(current) !== 'absent') return;
    const event = eventSnapshot.data() as EventRecord | undefined;
    const failureAssessment = {
      ...current,
      status: 'failed' as const,
      inputHash,
      error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown assessment failure',
      leaseExpiresAt: Date.now(),
    } satisfies AssessmentJob;
    if (!event || event.status !== 'Pending' || event.currentVersionId !== current.versionId
      || (event.currentAssessmentId !== undefined && event.currentAssessmentId !== current.assessmentId)) {
      transaction.set(reference, failureAssessment);
      return;
    }
    if (cutoverLockSnapshot.exists) transaction.update(db.doc(RESOURCE_CUTOVER_LOCK_PATH), {
      queuedEvents: firestore.FieldValue.arrayUnion(createResourceCutoverQueueToken({
        eventId: current.eventId, currentVersionId: current.versionId, currentAssessmentId: current.assessmentId,
        assessmentInputHash: inputHash, generationId: claimId, queuedAt: Date.now(),
      })),
    });
    transaction.set(reference, failureAssessment);
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
    transaction.update(eventReference, {
      currentAssessmentId: current.assessmentId,
      currentResourceId: firestore.FieldValue.delete(),
      updatedAt: Date.now(),
    });
  });
}

/** Transaction-level race harness; not exported from the deployed Functions entrypoint. */
export const __testOnlyMarkFailed = markFailed;
export const __testOnlyManualLockState = manualLockState;

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
  const reviewState = 'authorityReviewState' in assessment ? assessment.authorityReviewState : undefined;
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
    ...(assessment.assessmentReadiness ? { assessmentReadiness: assessment.assessmentReadiness } : {}),
    ...(assessment.complianceStatus ? { complianceStatus: assessment.complianceStatus } : {}),
    authorityReviewRequired: (assessment as { authorityReviewRequired?: boolean }).authorityReviewRequired
      ?? assessment.status !== 'official_ready',
    ...(reviewState ? {
      authorityReviewProgress: {
        completed: Object.keys(reviewState.activeReviewHeads).length,
        required: reviewState.requiredAuthorities.length,
      },
    } : {}),
    ...(resources ? {
      resourceQuantities: resourceQuantities(resources),
      resourceRecommendation: organizerResourceRecommendation(resources),
    } : {}),
    computedAt,
  };
}

export async function recomputeResourceForStoredAssessment(
  eventId: string,
  now = Date.now(),
  hooks: { beforePersist?: () => Promise<void>; cutoverSessionId?: string } = {},
): Promise<{ status: 'created' | 'reused' | 'failed'; resourceId?: string; reason?: string }> {
  const db = firestore();
  const eventReference = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const eventSnapshot = await eventReference.get();
  const event = eventSnapshot.exists ? { eventId, ...eventSnapshot.data() } as EventRecord : undefined;
  if (!event?.currentVersionId || !event.currentAssessmentId) return { status: 'failed', reason: 'missing-current-input' };
  if (!isSafeDocumentId(event.currentVersionId) || !isSafeDocumentId(event.currentAssessmentId)
    || (event.currentResourceId !== undefined && !isSafeDocumentId(event.currentResourceId))) {
    return { status: 'failed', reason: 'invalid-current-pointers' };
  }
  const [versionSnapshot, assessmentSnapshot] = await Promise.all([
    eventReference.collection(COLLECTIONS.VERSIONS).doc(event.currentVersionId).get(),
    eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId).get(),
  ]);
  const version = versionSnapshot.data() as EventVersion | undefined;
  const assessment = assessmentSnapshot.data();
  if (!version
    || version.versionId !== event.currentVersionId
    || version.eventId !== eventId
    || !isResourceEligibleAssessment(assessment, eventId, version.versionId, version.eventDetails)) {
    return { status: 'failed', reason: 'provisional-assessment-not-ready' };
  }
  const assessmentResult = resourceAssessmentResult(assessment);
  const calculation = computeResources({
    eventId,
    versionId: version.versionId,
    assessmentId: assessment.assessmentId,
    eventDetails: version.eventDetails,
    assessmentResult,
  });
  await hooks.beforePersist?.();
  return persistResourceCalculation(eventReference, version, assessment, calculation, now, hooks.cutoverSessionId);
}

async function persistResourceCalculation(
  eventReference: FirebaseFirestore.DocumentReference,
  version: EventVersion,
  assessment: ProvisionalRiskAssessment | OfficialRiskAssessment | AdminManualOfficialRiskAssessment,
  calculation: ResourceCalculationResult,
  computedAt: number,
  cutoverSessionId?: string,
): Promise<{ status: 'created' | 'reused' | 'failed'; resourceId?: string; reason?: string }> {
  const db = firestore();
  if (!calculation.ok) {
    const failureId = `${version.versionId}-resource-calculation-${calculation.code}-${computedAt}-${randomUUID()}`;
    const failurePersisted = await db.runTransaction(async (transaction) => {
      const assessmentReference = eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(assessment.assessmentId);
      const [currentSnapshot, currentAssessmentSnapshot, cutoverLockSnapshot] = await Promise.all([
        transaction.get(eventReference),
        transaction.get(assessmentReference),
        transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
      ]);
      const current = currentSnapshot.data() as EventRecord | undefined;
      const currentAssessment = currentAssessmentSnapshot.data();
      const leaseNow = Date.now();
      const cutoverAllowed = cutoverSessionId
        ? cutoverLockSnapshot.exists
          && cutoverLockSnapshot.data()?.active === true
          && cutoverLockSnapshot.data()?.sessionId === cutoverSessionId
          && Number.isFinite(cutoverLockSnapshot.data()?.leaseExpiresAt)
          && cutoverLockSnapshot.data()!.leaseExpiresAt > leaseNow
        : !cutoverLockSnapshot.exists;
      if (!cutoverAllowed) return false;
      if (!(current?.currentVersionId === version.versionId
        && current.currentAssessmentId === assessment.assessmentId
        && isSameResourceAssessment(currentAssessment, assessment, version.eventDetails))) return false;
      if (!await officialAssessmentProvenanceMatches(transaction, eventReference, current, version, currentAssessment)) return false;
      transaction.update(eventReference, { currentResourceId: firestore.FieldValue.delete(), updatedAt: computedAt });
      transaction.set(
        eventReference.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).doc(version.versionId),
        organizerSummary(assessment, undefined, computedAt),
      );
      transaction.create(eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(failureId), {
        id: failureId,
        eventId: version.eventId,
        versionId: version.versionId,
        action: 'resource_recommended',
        actorId: 'system',
        actorRole: 'system',
        timestamp: computedAt,
        metadata: { outcome: 'failed', code: calculation.code, reason: calculation.message, schemaVersion: RESOURCE_SCHEMA_VERSION },
      });
      return true;
    });
    if (!failurePersisted) return { status: 'failed', reason: 'resource-cutover-fencing-failed' };
    return { status: 'failed', reason: calculation.code };
  }
  const stage = assessment.status === 'official_ready' ? 'official' : 'provisional';
  const resourceId = resourceDocumentId(stage, version.versionId, calculation.resourceInputHash);
  return db.runTransaction(async (transaction) => {
    const assessmentReference = eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(assessment.assessmentId);
    const [currentEventSnapshot, currentAssessmentSnapshot, cutoverLockSnapshot] = await Promise.all([
      transaction.get(eventReference),
      transaction.get(assessmentReference),
      transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
    ]);
    const currentEvent = currentEventSnapshot.data() as EventRecord | undefined;
    const currentAssessment = currentAssessmentSnapshot.data();
    const leaseNow = Date.now();
    const cutoverAllowed = cutoverSessionId
      ? cutoverLockSnapshot.exists
        && cutoverLockSnapshot.data()?.active === true
        && cutoverLockSnapshot.data()?.sessionId === cutoverSessionId
        && Number.isFinite(cutoverLockSnapshot.data()?.leaseExpiresAt)
        && cutoverLockSnapshot.data()!.leaseExpiresAt > leaseNow
      : !cutoverLockSnapshot.exists;
    if (!cutoverAllowed) {
      return { status: 'failed' as const, reason: cutoverSessionId
        ? 'resource-cutover-fencing-failed'
        : 'resource-cutover-in-progress' };
    }
    if (!currentEvent
      || !['Pending', 'UnderReview'].includes(currentEvent.status)
      || currentEvent.currentVersionId !== version.versionId
      || currentEvent.currentAssessmentId !== assessment.assessmentId
      || !isResourceEligibleAssessment(currentAssessment, version.eventId, version.versionId, version.eventDetails)
      || !isSameResourceAssessment(currentAssessment, assessment, version.eventDetails)) {
      return { status: 'failed' as const, reason: 'event-or-assessment-changed' };
    }
    if (!await officialAssessmentProvenanceMatches(transaction, eventReference, currentEvent, version, currentAssessment)) {
      return { status: 'failed' as const, reason: 'official-provenance-invalid' };
    }
    const currentCalculation = computeResources({
      eventId: version.eventId,
      versionId: version.versionId,
      assessmentId: currentAssessment.assessmentId,
      eventDetails: version.eventDetails,
      assessmentResult: resourceAssessmentResult(currentAssessment),
    });
    if (!currentCalculation.ok || currentCalculation.resourceInputHash !== calculation.resourceInputHash) {
      return { status: 'failed' as const, reason: 'event-or-assessment-changed' };
    }
    const resourceReference = eventReference.collection(COLLECTIONS.RESOURCES).doc(resourceId);
    const [existingSnapshot, historicalSnapshot] = await Promise.all([
      transaction.get(resourceReference),
      transaction.get(eventReference.collection(COLLECTIONS.RESOURCES)
        .where('versionId', '==', version.versionId)
        .where('stage', '==', stage)),
    ]);
    const history = historicalSnapshot.docs
      .map((document) => validateResourceRecommendation(document.data()).ok
        ? document.data() as ResourceRecommendation
        : undefined)
      .filter((resource): resource is ResourceRecommendation => Boolean(resource));
    if (history.length !== historicalSnapshot.size
      || historicalSnapshot.docs.some((document) => document.data()?.resourceId !== document.id)
      || history.some((resource) => resource.eventId !== version.eventId
        || resource.versionId !== version.versionId || resource.stage !== stage)) {
      return { status: 'failed' as const, reason: 'invalid-resource-history' };
    }
    const historyTip = latestValidHistoricalResource(history);
    const chainPointer = currentEvent.currentResourceId ?? historyTip?.resourceId;
    if (history.length > 0 && (!chainPointer
      || validateResourceRevisionChain(history, chainPointer).length > 0)) {
      return { status: 'failed' as const, reason: 'invalid-resource-revision-chain' };
    }
    if (existingSnapshot.exists) {
      const existing = existingSnapshot.data() as ResourceRecommendation;
      if (existing.resourceInputHash !== calculation.resourceInputHash
        || existing.stage !== stage
        || existing.eventId !== version.eventId
        || existing.versionId !== version.versionId
        || existing.assessmentId !== currentAssessment.assessmentId
        || existing.assessmentReference.stage !== stage
        || !resourceReferenceMatches(existing, currentAssessment)
        || existing.formulaVersion !== calculation.formulaVersion
        || existing.configVersion !== calculation.configVersion
        || existing.sourceRegistryVersion !== calculation.sourceRegistryVersion
        || stableStringify(existing.items) !== stableStringify(resourceItemsForStage(stage, calculation.items))) {
        return { status: 'failed' as const, reason: 'resource-id-collision' };
      }
      if (!validateResourceRecommendation(existing).ok) return { status: 'failed' as const, reason: 'invalid-existing-resource' };
      const pointedResource = chainPointer && chainPointer !== resourceId
        ? history.find((resource) => resource.resourceId === chainPointer)
        : undefined;
      if (pointedResource && (!validateResourceRecommendation(pointedResource).ok
        || pointedResource.eventId !== version.eventId
        || pointedResource.versionId !== version.versionId
        || pointedResource.stage !== stage)) {
        return { status: 'failed' as const, reason: 'invalid-current-resource' };
      }
      if (pointedResource && pointedResource.revision === existing.revision
        && pointedResource.resourceId !== existing.resourceId) {
        return { status: 'failed' as const, reason: 'ambiguous-resource-revision' };
      }
      if (pointedResource && pointedResource.revision > existing.revision) {
        transaction.set(
          eventReference.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).doc(version.versionId),
          organizerSummary(currentAssessment, pointedResource, computedAt),
        );
        return { status: 'reused' as const, resourceId: pointedResource.resourceId };
      }
      if (currentEvent.currentResourceId !== resourceId) {
        transaction.update(eventReference, { currentResourceId: resourceId, updatedAt: computedAt });
      }
      transaction.set(
        eventReference.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).doc(version.versionId),
        organizerSummary(currentAssessment, existing, computedAt),
      );
      return { status: 'reused' as const, resourceId };
    }
    const previousId = currentEvent.currentResourceId && currentEvent.currentResourceId !== resourceId
      ? currentEvent.currentResourceId
      : undefined;
    const previousSnapshot = previousId
      ? await transaction.get(eventReference.collection(COLLECTIONS.RESOURCES).doc(previousId))
      : undefined;
    if (previousId && !previousSnapshot?.exists) {
      return { status: 'failed' as const, reason: 'dangling-current-resource' };
    }
    const previousCandidate = previousSnapshot?.exists ? previousSnapshot.data() : undefined;
    if (previousCandidate && (!validateResourceRecommendation(previousCandidate).ok
      || previousCandidate.eventId !== version.eventId
      || previousCandidate.versionId !== version.versionId
      || previousCandidate.stage !== stage)) {
      return { status: 'failed' as const, reason: 'invalid-current-resource' };
    }
    const previous = previousCandidate
      ? previousCandidate as ResourceRecommendation
      : historyTip;
    if (previous?.revision === Number.MAX_SAFE_INTEGER) {
      return { status: 'failed' as const, reason: 'resource-revision-overflow' };
    }
    const nextRevision = nextResourceRevision(previous);
    const recommendationItems = resourceItemsForStage(stage, calculation.items);
    const recommendationBase: Omit<ResourceRecommendation, 'stage' | 'assessmentReference' | 'confidenceLevel' | 'authorityReviewRequired'> = {
      resourceId,
      eventId: version.eventId,
      versionId: version.versionId,
      assessmentId: currentAssessment.assessmentId,
      schemaVersion: RESOURCE_SCHEMA_VERSION,
      revision: nextRevision.revision,
      supersedesResourceId: nextRevision.supersedesResourceId,
      resourceInputHash: calculation.resourceInputHash,
      formulaVersion: calculation.formulaVersion,
      configVersion: calculation.configVersion,
      sourceRegistryVersion: calculation.sourceRegistryVersion,
      items: recommendationItems,
      computedAt,
    };
    const recommendation: ResourceRecommendation = stage === 'official'
      ? {
          ...recommendationBase,
          stage: 'official',
          assessmentReference: officialResourceReference(currentAssessment as OfficialRiskAssessment | AdminManualOfficialRiskAssessment),
          confidenceLevel: 'authority_validated',
          authorityReviewRequired: false,
          notes: 'Official deterministic planning ranges based on finalized human-reviewed risk scores.',
        }
      : {
          ...recommendationBase,
          stage: 'provisional',
          assessmentReference: {
            stage: 'provisional',
            assessmentId: currentAssessment.assessmentId,
            proposalId: resourceProposalId(currentAssessment),
          },
          confidenceLevel: 'prototype',
          authorityReviewRequired: true,
          notes: 'Provisional internal prototype planning ranges; authority validation and official assessment are pending.',
        };
    transaction.create(resourceReference, recommendation);
    transaction.update(eventReference, { currentResourceId: resourceId, updatedAt: computedAt });
    transaction.set(
      eventReference.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).doc(version.versionId),
      organizerSummary(currentAssessment, recommendation, computedAt),
    );
    const auditReference = eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(`${resourceId}-recommended`);
    transaction.create(auditReference, {
      id: auditReference.id,
      eventId: version.eventId,
      versionId: version.versionId,
      action: 'resource_recommended',
      actorId: 'system',
      actorRole: 'system',
      timestamp: computedAt,
      metadata: {
        resourceId,
        previousResourceId: previous?.resourceId ?? null,
        assessmentId: currentAssessment.assessmentId,
        stage,
        schemaVersion: RESOURCE_SCHEMA_VERSION,
        formulaVersion: RESOURCE_FORMULA_VERSION,
        configVersion: RESOURCE_CONFIG_VERSION,
        sourceRegistryVersion: RESOURCE_SOURCE_REGISTRY_VERSION,
        resourceInputHash: calculation.resourceInputHash,
      },
    });
    return { status: 'created' as const, resourceId };
  });
}

export function resourceDocumentId(stage: 'provisional' | 'official', versionId: string, resourceInputHash: string): string {
  return `${stage}-${versionId}-${resourceInputHash}`;
}

export function nextResourceRevision(previous?: Pick<ResourceRecommendation, 'resourceId' | 'revision'>): {
  revision: number;
  supersedesResourceId: string | null;
} {
  if (previous && (!Number.isSafeInteger(previous.revision)
    || previous.revision < 1
    || previous.revision >= Number.MAX_SAFE_INTEGER)) {
    throw new Error('Cannot create a resource revision after an invalid or exhausted revision number.');
  }
  return {
    revision: previous ? previous.revision + 1 : 1,
    supersedesResourceId: previous?.resourceId ?? null,
  };
}

export function latestValidHistoricalResource(values: unknown[] | undefined): ResourceRecommendation | undefined {
  return values
    ?.map((value) => validateResourceRecommendation(value).ok ? value as ResourceRecommendation : undefined)
    .filter((value): value is ResourceRecommendation => Boolean(value))
    .sort((left, right) => right.revision - left.revision || right.computedAt - left.computedAt)[0];
}

export function isResourceEligibleAssessment(
  value: unknown,
  eventId: string,
  versionId: string,
  eventDetails: EventVersion['eventDetails'],
): value is ProvisionalRiskAssessment | OfficialRiskAssessment | AdminManualOfficialRiskAssessment {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  if (raw.status === 'official_ready' && raw.sourceKind === 'admin_manual') {
    const assessment = value as AdminManualOfficialRiskAssessment;
    try {
      return assessment.schemaVersion === ASSESSMENT_SCHEMA_VERSION
        && assessment.eventId === eventId && assessment.versionId === versionId
        && assessment.authorityReviewRequired === false
        && Number.isFinite(assessment.createdAt)
        && ['complete', 'provisional', 'insufficient_data'].includes(assessment.assessmentReadiness)
        && ['pass', 'review_required', 'blocked'].includes(assessment.complianceStatus)
        && Number.isFinite(assessment.dataConfidenceScore)
        && ['low', 'medium', 'high'].includes(assessment.dataConfidenceLevel)
        && typeof assessment.assessmentId === 'string' && Boolean(assessment.assessmentId)
        && isSafeManualAssessmentId(assessment.activeManualAssessmentId)
        && assessment.officialResult?.sourceKind === 'admin_manual'
        && assessment.officialResult.manualAssessmentId === assessment.activeManualAssessmentId
        && (assessment.aiProposal === null
          ? assessment.assessmentReadiness === 'insufficient_data'
          : (assessment.aiProposal as { status?: string }).status !== 'success')
        && Boolean(assessment.contextSnapshot) && Array.isArray(assessment.evidence)
        && validateManualOfficialAssessmentResult(assessment.officialResult).length === 0;
    } catch {
      return false;
    }
  }
  const assessment = value as Partial<ProvisionalRiskAssessment | OfficialRiskAssessment>;
  const isCalculatedStatus = assessment.status === 'provisional_ready'
    || assessment.status === 'authority_review'
    || assessment.status === 'official_ready';
  if (!(isCalculatedStatus
    && assessment.schemaVersion === ASSESSMENT_SCHEMA_VERSION
    && assessment.eventId === eventId
    && assessment.versionId === versionId
    && typeof assessment.assessmentId === 'string' && assessment.assessmentId.length > 0
    && assessment.aiProposal?.status === 'success'
    && Array.isArray(assessment.aiProposal.categories)
    && Array.isArray(assessment.aiProposal.hazards)
    && assessment.aiProposal.proposalId === assessment.provisionalResult?.proposalId
    && Boolean(assessment.provisionalResult)
    && assessment.contextSnapshot
    && Array.isArray(assessment.evidence)
    && validateProvisionalAssessmentResult(assessment.provisionalResult as ProvisionalRiskAssessment['provisionalResult']).length === 0)) return false;
  if (assessment.status === 'official_ready' && (!assessment.officialResult
    || assessment.officialResult.officialFormulaVersion !== OFFICIAL_FORMULA_VERSION
    || assessment.officialResult.proposalId !== assessment.aiProposal?.proposalId
    || !/^[a-f0-9]{64}$/.test(assessment.officialResult.officialInputHash))) return false;
  const result = assessment.status === 'official_ready'
    ? assessment.officialResult as OfficialRiskAssessment['officialResult']
    : assessment.provisionalResult as ProvisionalRiskAssessment['provisionalResult'];
  const proposal = assessment.aiProposal as ProvisionalRiskAssessment['aiProposal'];
  if (validateProvisionalAssessmentResult(result).length > 0) return false;
  try {
    const eligibleEvidence = new Set(assessment.evidence
      .filter((item) => item && typeof item.status === 'string'
        && item.quality !== 'missing'
        && !['unavailable', 'unmatched', 'missing'].includes(item.status.trim().toLowerCase()))
      .map((item) => item.key));
    if (result.categories.some((category) => category.evidenceReferences.some((reference) => !eligibleEvidence.has(reference)))
      || result.validatedHazards.some((hazard) => hazard.evidenceReferences.some((reference) => !eligibleEvidence.has(reference)))) return false;
    const baseline = computeCategoryBasedAssessment(
      { eventId, eventDetails } as EventRecord,
      assessment.contextSnapshot,
      assessment.createdAt,
    );
    return validateAssessmentResultAgainstProposal(result, proposal).length === 0
      && validateAssessmentResultAgainstHardRules(result, baseline).length === 0;
  } catch {
    return false;
  }
}

function isSameResourceAssessment(
  current: unknown,
  expected: ProvisionalRiskAssessment | OfficialRiskAssessment | AdminManualOfficialRiskAssessment,
  eventDetails: EventVersion['eventDetails'],
): current is ProvisionalRiskAssessment | OfficialRiskAssessment | AdminManualOfficialRiskAssessment {
  if (!isResourceEligibleAssessment(current, expected.eventId, expected.versionId, eventDetails)) return false;
  if (isManualOfficialAssessment(current) || isManualOfficialAssessment(expected)) {
    return isManualOfficialAssessment(current) && isManualOfficialAssessment(expected)
      && current.inputHash === expected.inputHash
      && current.activeManualAssessmentId === expected.activeManualAssessmentId
      && current.officialResult.officialInputHash === expected.officialResult.officialInputHash
      && current.status === expected.status;
  }
  const currentAi = current as ProvisionalRiskAssessment | OfficialRiskAssessment;
  const expectedAi = expected as ProvisionalRiskAssessment | OfficialRiskAssessment;
  return currentAi.inputHash === expectedAi.inputHash
    && currentAi.aiProposal.proposalId === expectedAi.aiProposal.proposalId
    && resourceProposalId(currentAi) === resourceProposalId(expectedAi)
    && resourceAssessmentResult(current).calculatedAt === resourceAssessmentResult(expected).calculatedAt
    && current.status === expected.status;
}

function resourceAssessmentResult(assessment: ProvisionalRiskAssessment | OfficialRiskAssessment | AdminManualOfficialRiskAssessment) {
  return assessment.status === 'official_ready' ? assessment.officialResult : assessment.provisionalResult;
}

function resourceProposalId(assessment: ProvisionalRiskAssessment | OfficialRiskAssessment | AdminManualOfficialRiskAssessment): string {
  if (isManualOfficialAssessment(assessment)) throw new Error('manual-official-has-no-proposal');
  return assessment.status === 'official_ready'
    ? (assessment as OfficialRiskAssessment).officialResult.proposalId
    : assessment.provisionalResult.proposalId;
}

async function officialAssessmentProvenanceMatches(
  transaction: FirebaseFirestore.Transaction,
  eventReference: FirebaseFirestore.DocumentReference,
  event: EventRecord,
  version: EventVersion,
  value: unknown,
): Promise<boolean> {
  if (!value || typeof value !== 'object' || (value as AssessmentRecord).status !== 'official_ready') return true;
  if (isManualOfficialAssessment(value)) {
    const manualReference = eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(value.assessmentId)
      .collection(COLLECTIONS.MANUAL_ASSESSMENTS).doc(value.activeManualAssessmentId);
    const manualSnapshot = await transaction.get(manualReference);
    const manual = manualSnapshot.data() as AdminManualAssessment | undefined;
    if (!manual || manual.manualAssessmentId !== value.activeManualAssessmentId) return false;
    try {
      const expected = buildManualOfficialAssessmentResult({
        assessment: value as unknown as ManualReviewRiskAssessment,
        manualAssessment: manual, eventDetails: version.eventDetails, eventVersionInputHash: version.inputHash,
        finalizedAt: value.officialResult.finalizedAt, finalizedBy: value.officialResult.finalizedBy,
      });
      return stableStringify(expected) === stableStringify(value.officialResult);
    } catch { return false; }
  }
  const assessment = value as OfficialRiskAssessment;
  const state = assessment.authorityReviewState;
  if (!state
    || stableStringify(state.requiredAuthorities) !== stableStringify(event.requiredAuthorities)
    || state.requiredAuthorities.length === 0) return false;
  const reviewIds = event.requiredAuthorities.map((authority) => state.activeReviewHeads[authority]?.reviewId);
  if (reviewIds.some((reviewId) => !reviewId)) return false;
  const reviewReferences = reviewIds.map((reviewId) =>
    eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(assessment.assessmentId)
      .collection(COLLECTIONS.SCORE_REVIEWS).doc(reviewId!));
  const resolutionReference = state.activeResolutionId
    ? eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(assessment.assessmentId)
      .collection(COLLECTIONS.SCORE_RESOLUTIONS).doc(state.activeResolutionId)
    : undefined;
  const [reviewSnapshots, resolutionSnapshot] = await Promise.all([
    transaction.getAll(...reviewReferences),
    resolutionReference ? transaction.get(resolutionReference) : Promise.resolve(undefined),
  ]);
  if (reviewSnapshots.some((snapshot) => {
      const review = snapshot.data();
      return !snapshot.exists || !review || typeof review !== 'object' || Array.isArray(review) || review.reviewId !== snapshot.id;
    })
    || (resolutionReference && (!resolutionSnapshot
      || !resolutionSnapshot.exists
      || !resolutionSnapshot.data()
      || typeof resolutionSnapshot.data() !== 'object'
      || Array.isArray(resolutionSnapshot.data())
      || resolutionSnapshot.data()?.resolutionId !== resolutionSnapshot.id))) return false;
  try {
    const expected = buildOfficialAssessmentResult({
      assessment,
      eventDetails: version.eventDetails,
      requiredAuthorities: event.requiredAuthorities,
      reviews: reviewSnapshots.map((snapshot) => snapshot.data() as AuthorityScoreReview),
      resolution: resolutionSnapshot?.data() as AuthorityScoreResolution | undefined,
      finalizedAt: assessment.officialResult.finalizedAt,
      finalizedBy: assessment.officialResult.finalizedBy,
    });
    return stableStringify(expected) === stableStringify(assessment.officialResult);
  } catch {
    return false;
  }
}

function isManualOfficialAssessment(value: unknown): value is AdminManualOfficialRiskAssessment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const activeManualAssessmentId = record.activeManualAssessmentId;
  const result = record.officialResult;
  return record.status === 'official_ready'
    && record.sourceKind === 'admin_manual'
    && record.authorityReviewRequired === false
    && isSafeManualAssessmentId(activeManualAssessmentId)
    && typeof result === 'object' && result !== null && !Array.isArray(result)
    && (result as Record<string, unknown>).sourceKind === 'admin_manual'
    && (result as Record<string, unknown>).manualAssessmentId === activeManualAssessmentId
    && validateManualOfficialAssessmentResult(result as AdminManualOfficialRiskAssessment['officialResult']).length === 0;
}

function officialResourceReference(assessment: OfficialRiskAssessment | AdminManualOfficialRiskAssessment): Extract<ResourceRecommendation['assessmentReference'], { stage: 'official' }> {
  return isManualOfficialAssessment(assessment)
    ? { stage: 'official', assessmentId: assessment.assessmentId, sourceKind: 'admin_manual', manualAssessmentId: assessment.activeManualAssessmentId, finalizedAt: assessment.officialResult.finalizedAt, finalizedBy: assessment.officialResult.finalizedBy }
    : { stage: 'official', assessmentId: assessment.assessmentId, proposalId: assessment.officialResult.proposalId, finalizedAt: assessment.officialResult.finalizedAt, finalizedBy: assessment.officialResult.finalizedBy };
}

function resourceReferenceMatches(resource: ResourceRecommendation, assessment: ProvisionalRiskAssessment | OfficialRiskAssessment | AdminManualOfficialRiskAssessment): boolean {
  const reference = resource.assessmentReference;
  if (isManualOfficialAssessment(assessment)) return reference.stage === 'official' && reference.sourceKind === 'admin_manual'
    && reference.manualAssessmentId === assessment.activeManualAssessmentId
    && reference.finalizedAt === assessment.officialResult.finalizedAt
    && reference.finalizedBy === assessment.officialResult.finalizedBy;
  if (assessment.status === 'official_ready') {
    return reference.stage === 'official' && 'proposalId' in reference
      && reference.proposalId === resourceProposalId(assessment)
      && reference.finalizedAt === assessment.officialResult.finalizedAt
      && reference.finalizedBy === assessment.officialResult.finalizedBy;
  }
  return reference.stage === 'provisional'
    && reference.proposalId === resourceProposalId(assessment);
}

function resourceItemsForStage(
  stage: 'provisional' | 'official',
  items: ResourceRecommendation['items'],
): ResourceRecommendation['items'] {
  if (stage === 'provisional') return items;
  return Object.fromEntries(RESOURCE_KEYS.map((key) => [key, {
    ...items[key],
    confidence: 'authority_validated' as const,
    authorityReviewRequired: false,
  }])) as ResourceRecommendation['items'];
}

function resourceQuantities(resources: ResourceRecommendation) {
  return {
    police: resources.items.police.baseline,
    security: resources.items.security.baseline,
    medicalTeams: resources.items.medicalTeams.baseline,
    ambulances: resources.items.ambulances.baseline,
    fireOfficers: resources.items.fireOfficers.baseline,
    toilets: resources.items.toilets.baseline,
    wasteBins: resources.items.wasteBins.baseline,
  };
}

function organizerResourceRecommendation(resources: ResourceRecommendation): OrganizerResourceRecommendation {
  return {
    resourceId: resources.resourceId,
    revision: resources.revision,
    stage: resources.stage,
    items: Object.fromEntries(Object.entries(resources.items).map(([key, item]) => [key, {
      baseline: item.baseline,
      planningRange: { ...item.planningRange },
    }])) as OrganizerResourceRecommendation['items'],
    disclaimer: resources.stage === 'provisional'
      ? 'Provisional internal prototype planning ranges; not statutory or authority-issued minimums.'
      : 'Official authority-validated planning ranges for the finalized assessment.',
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
