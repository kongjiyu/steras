import { createHash, randomUUID } from 'node:crypto';
import { firestore } from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/logger';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import {
  ASSESSMENT_SCHEMA_VERSION,
  CONTEXT_EVIDENCE_SCHEMA_VERSION,
  EVIDENCE_SUFFICIENCY_VERSION,
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
  EventEnvironment,
  EventRecord,
  EventType,
  EventVersion,
  HARD_RULE_VERSION,
  ManualReviewRiskAssessment,
  M1_EVIDENCE_MANIFEST_SCHEMA_VERSION,
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
  VENUE_BINDING_VERSION,
  WEATHER_POLICY_VERSION,
  ResourceRecommendation,
  RiskAssessment,
  UserProfile,
  ValidationWarning,
} from '@shared/types';
import { AI_RESPONSE_SCHEMA_VERSION, PROMPT_VERSION, analyseWithAI } from '../engines/aiPredictor';
import { validateAndCalculateProvisional } from '../engines/assessmentValidator';
import { buildOfficialAssessmentResult } from '../engines/authorityFinalisation';
import { buildManualOfficialAssessmentResult } from '../engines/manualFinalisation';
import { STERAS_TEST_DATASET_ID, STERAS_TEST_EVENT_IDS } from '@shared/sterasTestFixtures';
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
import { buildContextEvidenceProvenance, computeCategoryBasedAssessment, fetchHistoricalContext, fetchVenueContext } from '../engines/ruleBased';
import { getCalendarContext } from '../utils/holidays';
import { fetchWeather } from '../utils/weather';
import { ASSESSMENT_SECRETS, MINIMAX_API_KEY, OPENWEATHER_API_KEY } from '../config/secrets';
import { FUNCTION_REGION } from '../config/runtime';
import { createResourceCutoverQueueToken, RESOURCE_CUTOVER_LOCK_PATH } from '../config/resourceCutoverLock';
import { validateEventDetails, validateEvidencePaths } from '../http/submitEvent';
import { validateDraftDocuments } from '../http/extractApplicationDocuments';
import { validateM1EvidenceManifest } from '../engines/m1EvidenceManifest';
import { inspectStorageEvidence } from '../utils/storageEvidence';
import { CANONICAL_EVIDENCE_KEYS } from '../engines/proposalContract';
import {
  isValidM1TemplateSelection,
  m1CategoryForEventType,
  m1VenueSettingMatchesEnvironment,
} from '@shared/m1TemplateContract';
import { eventVersionInputHash } from '../utils/eventVersionHash';

const CLAIM_LEASE_MS = 2 * 60 * 1000;

export interface PipelineResult {
  status: 'processed' | 'skipped';
  eventId: string;
  versionId?: string;
  assessmentId?: string;
  assessmentStatus?: AssessmentRecord['status'];
  resourceStatus?: 'created' | 'reused' | 'failed';
  reason?: string;
}

export interface RetryAuthorization {
  uid: string;
  role: 'admin' | 'authority';
  authorityType?: UserProfile['authorityType'];
}

export interface PipelineExecutionOptions {
  /** A deterministic six-hour bucket used only by the scheduled weather refresh. */
  contextGeneration?: string;
  expectedCurrentAssessmentId?: string;
  allowUnderReview?: boolean;
  cutoverSessionId?: string;
  /** Only the non-destructive hardening cutover may detach a new V3 chain from a legacy resource pointer. */
  allowLegacyResourcePointer?: boolean;
  /** Cutover-only permission to supersede a reviewed legacy generation without mutating its records. */
  allowLegacyAssessmentReplacement?: boolean;
}

export async function runRiskAndResourcePipeline(
  eventId: string,
  now = Date.now(),
  retryManual = false,
  retryAuthorization?: RetryAuthorization,
  options: PipelineExecutionOptions = {},
): Promise<PipelineResult> {
  const db = firestore();
  const eventReference = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const eventSnapshot = await eventReference.get();
  if (!eventSnapshot.exists) return { status: 'skipped', eventId, reason: 'event-not-found' };
  const event = { eventId, ...eventSnapshot.data() } as EventRecord;
  const allowedStatuses = options.allowUnderReview ? ['Pending', 'UnderReview'] : ['Pending'];
  if (!allowedStatuses.includes(event.status) || !event.currentVersionId) return { status: 'skipped', eventId, reason: 'event-not-pending' };
  if (!isSafeDocumentId(event.currentVersionId)) return { status: 'skipped', eventId, reason: 'invalid-current-version' };

  const versionId = event.currentVersionId;
  const versionReference = eventReference.collection(COLLECTIONS.VERSIONS).doc(versionId);
  const summaryReference = eventReference.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).doc(versionId);
  const versionSnapshot = await versionReference.get();
  if (!versionSnapshot.exists) {
    if (options.expectedCurrentAssessmentId) return { status: 'skipped', eventId, versionId, reason: 'version-not-found' };
    const assessmentReference = eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(assessmentDocumentId(versionId, processingHash(`version-not-found:${versionId}`)));
    await recordMissingVersionFailure(eventReference, assessmentReference, summaryReference, eventId, versionId, now);
    return { status: 'processed', eventId, versionId, reason: 'version-not-found' };
  }
  const version = versionSnapshot.data() as EventVersion;
  if (!isPipelineEventVersion(version, eventId, versionId)) {
    if (options.expectedCurrentAssessmentId) return { status: 'skipped', eventId, versionId, reason: 'invalid-version-contract' };
    const assessmentReference = eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(assessmentDocumentId(versionId, processingHash(`invalid-version-contract:${versionId}`)));
    await recordMissingVersionFailure(eventReference, assessmentReference, summaryReference, eventId, versionId, now, 'invalid-version-contract');
    return { status: 'processed', eventId, versionId, reason: 'invalid-version-contract' };
  }
  const inputHash = assessmentInputHashForVersion(version.inputHash, options.contextGeneration);
  const assessmentId = assessmentDocumentId(versionId, inputHash);
  const assessmentReference = eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(assessmentId);
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
    if (!cutoverFenceAllows(cutoverLockSnapshot, options.cutoverSessionId, now)) return false;
    const currentEvent = currentEventSnapshot.data() as EventRecord | undefined;
    const expectedAssessmentId = options.expectedCurrentAssessmentId ?? assessmentId;
    if (!currentEvent || !allowedStatuses.includes(currentEvent.status) || currentEvent.currentVersionId !== versionId
      || (options.expectedCurrentAssessmentId
        ? currentEvent.currentAssessmentId !== expectedAssessmentId
        : currentEvent.currentAssessmentId !== undefined && currentEvent.currentAssessmentId !== assessmentId)) return false;
    if (retryManual) {
      const retryUser = retryUserSnapshot?.data() as UserProfile | undefined;
      const adminAuthorized = retryAuthorization?.role === 'admin' && retryUser?.role === 'admin';
      const authorityAuthorized = retryAuthorization?.role === 'authority'
        && retryUser?.role === 'authority'
        && retryUser.authorityType === retryAuthorization.authorityType
        && Boolean(retryUser.authorityType)
        && Array.isArray(currentEvent.requiredAuthorities)
        && currentEvent.requiredAuthorities.includes(retryUser.authorityType as NonNullable<UserProfile['authorityType']>);
      if (!adminAuthorized && !authorityAuthorized) return 'retry-not-authorized';
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
      assessmentId,
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
    const submittedEvidence = await inspectStorageEvidence(version.documentPaths);
    const assessedEvent: EventRecord = {
      ...event,
      eventDetails: version.eventDetails,
      draftDocumentPaths: submittedEvidence.filter((item) => item.status === 'eligible').map((item) => item.path),
    };
    const [weather, incidentHistory, venue] = await Promise.all([
      fetchWeather(version.eventDetails.venueLocation, version.eventDetails.venueName, version.eventDetails.startDatetime, { apiKey: OPENWEATHER_API_KEY.value() }),
      fetchHistoricalContext(assessedEvent),
      fetchVenueContext(version.eventDetails),
    ]);
    const calendar = getCalendarContext(version.eventDetails.startDatetime);
    const contextSnapshot = { weather, calendar, venue, incidentHistory };
    const baseline = computeCategoryBasedAssessment(assessedEvent, contextSnapshot, Date.now());
    const createdAt = Date.now();
    const common = {
      assessmentId,
      eventId,
      versionId,
      schemaVersion: ASSESSMENT_SCHEMA_VERSION,
      contextSnapshot,
      evidence: baseline.evidence,
      contextEvidence: buildContextEvidenceProvenance(assessedEvent, contextSnapshot, createdAt, submittedEvidence),
      sourceTimestamps: { weather: weather.fetchedAt, holiday: calendar.sourceTimestamp, venue: venue.fetchedAt, incidents: incidentHistory.fetchedAt },
      contextStatuses: {
        weather: `${weather.source}:${weather.freshness}`,
        holiday: `${calendar.sourceVersion}:${calendar.coverageStatus}`,
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
    if (submittedEvidence.some((item) => item.status !== 'eligible')) readinessWarnings.push({
      warningId: 'missing_evidence.storage-object',
      code: 'missing_evidence',
      message: 'One or more submitted evidence objects are missing or no longer satisfy the verified Storage contract.',
      evidenceReferences: ['compliance'],
    });
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
      }, ...readinessWarnings], 'Insufficient application evidence requires manual review.');
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

    if (assessment.status === 'provisional_ready' && (!resourceCalculation || !resourceCalculation.ok)) {
      throw new Error(`Validated assessment could not produce a complete resource recommendation: ${resourceCalculation?.ok === false ? resourceCalculation.code : 'missing-calculation'}`);
    }
    const deferProvisionalPublication = assessment.status === 'provisional_ready';

    const finalized = await db.runTransaction(async (transaction) => {
      const previousAssessmentReference = options.expectedCurrentAssessmentId
        ? eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(options.expectedCurrentAssessmentId)
        : undefined;
      const [claimSnapshot, currentEventSnapshot, cutoverLockSnapshot, previousAssessmentSnapshot] = await Promise.all([
        transaction.get(assessmentReference),
        transaction.get(eventReference),
        transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
        previousAssessmentReference ? transaction.get(previousAssessmentReference) : Promise.resolve(undefined),
      ]);
      const claim = claimSnapshot.data() as AssessmentRecord | undefined;
      const currentEvent = currentEventSnapshot.data() as EventRecord | undefined;
      if (claim?.status !== 'processing' || claim.claimId !== claimId || claim.leaseExpiresAt <= now) return false;
      if (!currentEvent || !allowedStatuses.includes(currentEvent.status) || currentEvent.currentVersionId !== versionId
        || (options.expectedCurrentAssessmentId
          ? currentEvent.currentAssessmentId !== options.expectedCurrentAssessmentId
          : currentEvent.currentAssessmentId !== undefined && currentEvent.currentAssessmentId !== assessment.assessmentId)) return false;
      if (options.cutoverSessionId && !cutoverFenceAllows(cutoverLockSnapshot, options.cutoverSessionId, Date.now())) return false;
      if (previousAssessmentSnapshot && !assessmentGenerationCanRefresh(previousAssessmentSnapshot.data())
        && !(options.cutoverSessionId && options.allowLegacyAssessmentReplacement
          && previousAssessmentSnapshot.data()?.schemaVersion !== ASSESSMENT_SCHEMA_VERSION)) return false;
      // A manual assessment is an exclusive recovery path for this generation.
      // Never let a late AI transaction overwrite its persisted manual lock or
      // publish a provisional resource after Admin has claimed the assessment.
      if (manualLockState(claim) !== 'absent') return false;
      if (cutoverLockSnapshot.exists && !options.cutoverSessionId) {
        transaction.update(db.doc(RESOURCE_CUTOVER_LOCK_PATH), {
          queuedEvents: FieldValue.arrayUnion(createResourceCutoverQueueToken({
            eventId,
            currentVersionId: versionId,
            currentAssessmentId: assessment.assessmentId,
            assessmentInputHash: assessment.inputHash,
            generationId: claimId,
            queuedAt: createdAt,
          })),
        });
      }
      if (!deferProvisionalPublication) transaction.set(assessmentReference, assessment);
      if (!deferProvisionalPublication && !options.expectedCurrentAssessmentId) {
        transaction.set(summaryReference, organizerSummary(assessment, undefined, createdAt));
        transaction.update(eventReference, {
          currentAssessmentId: assessmentId,
          currentResourceId: FieldValue.delete(),
          updatedAt: createdAt,
        });
      }
      if (!deferProvisionalPublication) transaction.set(eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(`${assessmentId}-risk-score-computed`), {
        id: `${assessmentId}-risk-score-computed`, eventId, versionId, action: 'risk_score_computed', actorId: 'system', actorRole: 'system', timestamp: createdAt,
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
    let resourceStatus: PipelineResult['resourceStatus'];
    let resourceReason: string | undefined;
    if (assessment.status === 'provisional_ready' && resourceCalculation) {
      const resourceResult = await persistResourceCalculation(
        eventReference,
        version,
        assessment,
        resourceCalculation,
        createdAt,
        options.cutoverSessionId,
        options.expectedCurrentAssessmentId,
        options.allowLegacyResourcePointer,
        options.allowLegacyAssessmentReplacement,
        claimId,
      );
      resourceStatus = resourceResult.status;
      resourceReason = resourceResult.reason;
      if (resourceResult.status === 'failed') {
        throw new Error(`Atomic provisional publication failed: ${resourceResult.reason ?? 'unknown-resource-error'}`);
      }
    }
    logger.info(`[assessment] ${eventId}/${versionId}: status=${assessment.status}, ai=${assessment.aiProposal?.status ?? 'not-attempted'}`);
    return {
      status: 'processed', eventId, versionId, assessmentId, assessmentStatus: assessment.status,
      ...(resourceStatus ? { resourceStatus } : {}),
      ...(resourceReason ? { reason: resourceReason } : {}),
    };
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
  const assessmentId = assessmentReference.id;
  const claimId = randomUUID();
  await db.runTransaction(async (transaction) => {
    const [currentSnapshot, assessmentSnapshot, cutoverLockSnapshot] = await Promise.all([
      transaction.get(eventReference),
      transaction.get(assessmentReference),
      transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
    ]);
    const current = currentSnapshot.data() as EventRecord | undefined;
    if (!current || current.status !== 'Pending' || current.currentVersionId !== versionId
      || (!cutoverLockSnapshot.exists && current.currentAssessmentId !== undefined && current.currentAssessmentId !== assessmentId)) return;
    if (manualLockState(assessmentSnapshot.data()) !== 'absent') return;
    // Missing/corrupt immutable input cannot be repaired by the resource queue.
    // While maintenance owns the fence, leave all current pointers and summaries untouched.
    if (cutoverLockSnapshot.exists) return;
    transaction.set(assessmentReference, {
      assessmentId,
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
      assessmentId, eventId, versionId, schemaVersion: ASSESSMENT_SCHEMA_VERSION,
      status: 'failed', categories: [], authorityReviewRequired: true, computedAt: now,
    } satisfies OrganizerAssessmentSummary);
    transaction.update(eventReference, {
      currentAssessmentId: assessmentId,
      currentResourceId: FieldValue.delete(),
      updatedAt: now,
    });
    transaction.set(eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(`${assessmentId}-risk-score-computed`), {
      id: `${assessmentId}-risk-score-computed`, eventId, versionId, action: 'risk_score_computed',
      actorId: 'system', actorRole: 'system', timestamp: now,
      metadata: { assessmentStatus: 'failed', schemaVersion: ASSESSMENT_SCHEMA_VERSION, inputHash, reason },
    });
  });
}

export function isPipelineEventVersion(value: unknown, eventId: string, versionId: string): value is EventVersion {
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
  const templateSelection = version.templateSelection;
  const contractValid = typeof eventDetails.name === 'string' && Boolean(eventDetails.name.trim())
    && typeof eventDetails.type === 'string' && Boolean(eventDetails.type.trim())
    && typeof eventDetails.venueName === 'string' && Boolean(eventDetails.venueName.trim())
    && typeof eventDetails.venueAddress === 'string' && Boolean(eventDetails.venueAddress.trim())
    && typeof eventDetails.venueState === 'string' && Boolean(eventDetails.venueState.trim())
    && Number.isFinite(eventDetails.venueCapacity) && Number(eventDetails.venueCapacity) >= 0
    && Number.isFinite(eventDetails.expectedAttendance) && Number(eventDetails.expectedAttendance) >= 0
    && ['indoor', 'outdoor', 'mixed'].includes(String(eventDetails.environment))
    && ['covered', 'partially_covered', 'uncovered'].includes(String(eventDetails.coverage))
    && ['seated', 'standing', 'mixed'].includes(String(eventDetails.seating))
    && Number.isFinite(eventDetails.startDatetime) && Number.isFinite(eventDetails.endDatetime)
    && Number(eventDetails.endDatetime) >= Number(eventDetails.startDatetime)
    && typeof eventDetails.emergencyPlanSummary === 'string';
  if (!contractValid
    || !isValidM1TemplateSelection(templateSelection)
    || m1CategoryForEventType(eventDetails.type as EventType) !== templateSelection.eventCategory
    || !m1VenueSettingMatchesEnvironment(templateSelection.venueSetting, eventDetails.environment as EventEnvironment)
    || validateEventDetails(eventDetails, Number(version.submittedAt) - 1).length > 0
    || validateEvidencePaths(eventId, versionId, version.documentPaths).length > 0) return false;
  if (version.evidenceManifestSchemaVersion !== M1_EVIDENCE_MANIFEST_SCHEMA_VERSION
    || typeof version.extractionId !== 'string' || !isSafeDocumentId(version.extractionId)
    || !Array.isArray(version.evidenceManifest)) return false;
  try {
    const documents = validateDraftDocuments(eventId, versionId, version.documentUploads);
    const documentPaths = [...new Set(documents.map((document) => document.path))].sort();
    if (stableStringify(documentPaths) !== stableStringify([...version.documentPaths].sort())) return false;
    const manifest = validateM1EvidenceManifest(
      eventDetails as unknown as EventVersion['eventDetails'],
      templateSelection,
      documents,
      version.evidenceManifest,
    );
    if (manifest.errors.length > 0
      || stableStringify(manifest.manifest) !== stableStringify(version.evidenceManifest)) return false;
  } catch {
    return false;
  }
  const expectedInputHash = eventVersionInputHash(value as EventVersion);
  return version.inputHash === expectedInputHash;
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
    contextEvidenceSchemaVersion: CONTEXT_EVIDENCE_SCHEMA_VERSION,
    evidenceSufficiencyVersion: EVIDENCE_SUFFICIENCY_VERSION,
    venueBindingVersion: VENUE_BINDING_VERSION,
    weatherPolicyVersion: WEATHER_POLICY_VERSION,
  })).digest('hex');
}

export function assessmentInputHashForVersion(versionInputHash: string, contextGeneration?: string): string {
  return processingHash(contextGeneration
    ? `${versionInputHash}:context-generation:${contextGeneration}`
    : versionInputHash);
}

export function assessmentDocumentId(versionId: string, inputHash: string): string {
  return `${versionId}-assessment-${inputHash.slice(0, 24)}`;
}

function cutoverFenceAllows(
  snapshot: FirebaseFirestore.DocumentSnapshot,
  cutoverSessionId: string | undefined,
  now: number,
): boolean {
  if (!cutoverSessionId) return !snapshot.exists;
  const lock = snapshot.data();
  return snapshot.exists && lock?.active === true && lock.sessionId === cutoverSessionId
    && Number.isFinite(lock.leaseExpiresAt) && lock.leaseExpiresAt > now;
}

function assessmentGenerationCanRefresh(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const assessment = value as Partial<AssessmentRecord> & {
    authorityReviewState?: { activeReviewHeads?: Record<string, unknown> };
    activeManualAssessmentId?: unknown;
  };
  return assessment.status !== 'official_ready'
    && !assessment.activeManualAssessmentId
    && Object.keys(assessment.authorityReviewState?.activeReviewHeads ?? {}).length === 0;
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
    if (cutoverLockSnapshot.exists) {
      transaction.update(db.doc(RESOURCE_CUTOVER_LOCK_PATH), {
        queuedEvents: FieldValue.arrayUnion(createResourceCutoverQueueToken({
          eventId: current.eventId, currentVersionId: current.versionId, currentAssessmentId: current.assessmentId,
          assessmentInputHash: inputHash, generationId: claimId, queuedAt: Date.now(),
        })),
      });
      transaction.set(reference, failureAssessment);
      return;
    }
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
      currentResourceId: FieldValue.delete(),
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

function publishPendingAssessment(
  transaction: FirebaseFirestore.Transaction,
  eventReference: FirebaseFirestore.DocumentReference,
  assessment: ProvisionalRiskAssessment | OfficialRiskAssessment | AdminManualOfficialRiskAssessment,
  pendingClaimMatches: boolean,
  computedAt: number,
  pendingClaimId: string | undefined,
  baseAuditExists: boolean,
): void {
  if (!pendingClaimMatches || !pendingClaimId) return;
  transaction.set(
    eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(assessment.assessmentId),
    assessment,
  );
  const auditReference = eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(
    riskScoreAuditId(assessment.assessmentId, pendingClaimId, baseAuditExists),
  );
  transaction.create(auditReference, {
    id: auditReference.id,
    eventId: assessment.eventId,
    versionId: assessment.versionId,
    action: 'risk_score_computed',
    actorId: 'system',
    actorRole: 'system',
    timestamp: computedAt,
    metadata: {
      assessmentStatus: assessment.status,
      schemaVersion: ASSESSMENT_SCHEMA_VERSION,
      provisionalScore: assessment.status === 'provisional_ready' ? assessment.provisionalResult.overallScore : null,
      provisionalRiskLevel: assessment.status === 'provisional_ready' ? assessment.provisionalResult.overallRiskLevel : null,
      aiStatus: assessment.aiProposal?.status ?? 'not-attempted',
      inputHash: assessment.inputHash,
    },
  });
}

export function riskScoreAuditId(assessmentId: string, claimId: string, baseAuditExists: boolean): string {
  const baseId = `${assessmentId}-risk-score-computed`;
  return baseAuditExists ? `${baseId}-retry-${claimId}` : baseId;
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
  expectedCurrentAssessmentId?: string,
  allowLegacyResourcePointer = false,
  allowLegacyAssessmentReplacement = false,
  pendingClaimId?: string,
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
        && current.currentAssessmentId === (expectedCurrentAssessmentId ?? assessment.assessmentId)
        && isSameResourceAssessment(currentAssessment, assessment, version.eventDetails))) return false;
      if (!await officialAssessmentProvenanceMatches(transaction, eventReference, current, version, currentAssessment)) return false;
      if (!expectedCurrentAssessmentId) {
        transaction.update(eventReference, { currentResourceId: FieldValue.delete(), updatedAt: computedAt });
        transaction.set(
          eventReference.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).doc(version.versionId),
          organizerSummary(assessment, undefined, computedAt),
        );
      }
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
    const riskAuditBaseReference = eventReference.collection(COLLECTIONS.AUDIT_LOGS)
      .doc(`${assessment.assessmentId}-risk-score-computed`);
    const previousAssessmentReference = expectedCurrentAssessmentId
      ? eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(expectedCurrentAssessmentId)
      : undefined;
    const [currentEventSnapshot, currentAssessmentSnapshot, cutoverLockSnapshot, previousAssessmentSnapshot, riskAuditBaseSnapshot] = await Promise.all([
      transaction.get(eventReference),
      transaction.get(assessmentReference),
      transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
      previousAssessmentReference ? transaction.get(previousAssessmentReference) : Promise.resolve(undefined),
      transaction.get(riskAuditBaseReference),
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
    if (previousAssessmentSnapshot && !assessmentGenerationCanRefresh(previousAssessmentSnapshot.data())
      && !(cutoverSessionId && allowLegacyAssessmentReplacement
        && previousAssessmentSnapshot.data()?.schemaVersion !== ASSESSMENT_SCHEMA_VERSION)) {
      return { status: 'failed' as const, reason: 'review-or-manual-assessment-started' };
    }
    const pendingClaimMatches = Boolean(pendingClaimId && currentAssessment?.status === 'processing'
      && currentAssessment.claimId === pendingClaimId && currentAssessment.inputHash === assessment.inputHash
      && currentAssessment.assessmentId === assessment.assessmentId);
    const currentPointerMatches = currentAssessmentPointerMatches(
      currentEvent?.currentAssessmentId,
      assessment.assessmentId,
      pendingClaimMatches,
      expectedCurrentAssessmentId,
    );
    if (!currentEvent
      || !['Pending', 'UnderReview'].includes(currentEvent.status)
      || currentEvent.currentVersionId !== version.versionId
      || !currentPointerMatches
      || (!pendingClaimMatches && (!isResourceEligibleAssessment(currentAssessment, version.eventId, version.versionId, version.eventDetails)
        || !isSameResourceAssessment(currentAssessment, assessment, version.eventDetails)))) {
      return { status: 'failed' as const, reason: 'event-or-assessment-changed' };
    }
    const effectiveAssessment = (pendingClaimMatches ? assessment : currentAssessment) as
      ProvisionalRiskAssessment | OfficialRiskAssessment | AdminManualOfficialRiskAssessment;
    if (!await officialAssessmentProvenanceMatches(transaction, eventReference, currentEvent, version, effectiveAssessment)) {
      return { status: 'failed' as const, reason: 'official-provenance-invalid' };
    }
    const currentCalculation = computeResources({
      eventId: version.eventId,
      versionId: version.versionId,
      assessmentId: effectiveAssessment.assessmentId,
      eventDetails: version.eventDetails,
      assessmentResult: resourceAssessmentResult(effectiveAssessment),
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
        || existing.assessmentId !== effectiveAssessment.assessmentId
        || existing.assessmentReference.stage !== stage
        || !resourceReferenceMatches(existing, effectiveAssessment)
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
          organizerSummary(effectiveAssessment, pointedResource, computedAt),
        );
        publishPendingAssessment(
          transaction, eventReference, effectiveAssessment, pendingClaimMatches, computedAt,
          pendingClaimId, riskAuditBaseSnapshot.exists,
        );
        if (expectedCurrentAssessmentId || pendingClaimMatches) transaction.update(eventReference, {
          currentAssessmentId: assessment.assessmentId,
          currentResourceId: pointedResource.resourceId,
          updatedAt: computedAt,
        });
        return { status: 'reused' as const, resourceId: pointedResource.resourceId };
      }
      if (currentEvent.currentResourceId !== resourceId || expectedCurrentAssessmentId) {
        transaction.update(eventReference, {
          ...(expectedCurrentAssessmentId || pendingClaimMatches ? { currentAssessmentId: assessment.assessmentId } : {}),
          currentResourceId: resourceId,
          updatedAt: computedAt,
        });
      }
      transaction.set(
        eventReference.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).doc(version.versionId),
        organizerSummary(effectiveAssessment, existing, computedAt),
      );
      publishPendingAssessment(
        transaction, eventReference, effectiveAssessment, pendingClaimMatches, computedAt,
        pendingClaimId, riskAuditBaseSnapshot.exists,
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
    const previousIsValid = previousCandidate && validateResourceRecommendation(previousCandidate).ok
      && previousCandidate.eventId === version.eventId
      && previousCandidate.versionId === version.versionId
      && previousCandidate.stage === stage;
    if (previousCandidate && !previousIsValid && !(
      allowLegacyResourcePointer && cutoverSessionId && expectedCurrentAssessmentId
    )) {
      return { status: 'failed' as const, reason: 'invalid-current-resource' };
    }
    const previous = previousCandidate && previousIsValid
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
      assessmentId: effectiveAssessment.assessmentId,
      schemaVersion: RESOURCE_SCHEMA_VERSION,
      revision: nextRevision.revision,
      supersedesResourceId: nextRevision.supersedesResourceId,
      resourceInputHash: calculation.resourceInputHash,
      formulaVersion: calculation.formulaVersion,
      configVersion: calculation.configVersion,
      sourceRegistryVersion: calculation.sourceRegistryVersion,
      items: recommendationItems,
      validationScope: stage === 'official' ? 'official_risk_input_only' : 'provisional_risk_input',
      computedAt,
    };
    const recommendation: ResourceRecommendation = stage === 'official'
      ? {
          ...recommendationBase,
          stage: 'official',
          assessmentReference: officialResourceReference(effectiveAssessment as OfficialRiskAssessment | AdminManualOfficialRiskAssessment),
          confidenceLevel: 'authority_validated',
          authorityReviewRequired: false,
          notes: 'Official deterministic planning ranges based on finalized human-reviewed risk scores.',
        }
      : {
          ...recommendationBase,
          stage: 'provisional',
          assessmentReference: {
            stage: 'provisional',
            assessmentId: effectiveAssessment.assessmentId,
            proposalId: resourceProposalId(effectiveAssessment),
          },
          confidenceLevel: 'prototype',
          authorityReviewRequired: true,
          notes: 'Provisional internal prototype planning ranges; authority validation and official assessment are pending.',
        };
    transaction.create(resourceReference, recommendation);
    transaction.update(eventReference, {
      ...(expectedCurrentAssessmentId || pendingClaimMatches ? { currentAssessmentId: assessment.assessmentId } : {}),
      currentResourceId: resourceId,
      updatedAt: computedAt,
    });
    transaction.set(
      eventReference.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).doc(version.versionId),
      organizerSummary(effectiveAssessment, recommendation, computedAt),
    );
    publishPendingAssessment(
      transaction, eventReference, effectiveAssessment, pendingClaimMatches, computedAt,
      pendingClaimId, riskAuditBaseSnapshot.exists,
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
        assessmentId: effectiveAssessment.assessmentId,
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

/** Emulator-only atomic publication harness; not exported from the deployed Functions entrypoint. */
export const __testOnlyPersistResourceCalculation = persistResourceCalculation;

export function __testOnlyCurrentAssessmentPointerMatches(
  currentAssessmentId: string | undefined,
  assessmentId: string,
  pendingClaimMatches: boolean,
  expectedCurrentAssessmentId?: string,
): boolean {
  return currentAssessmentPointerMatches(currentAssessmentId, assessmentId, pendingClaimMatches, expectedCurrentAssessmentId);
}

function currentAssessmentPointerMatches(
  currentAssessmentId: string | undefined,
  assessmentId: string,
  pendingClaimMatches: boolean,
  expectedCurrentAssessmentId?: string,
): boolean {
  if (expectedCurrentAssessmentId !== undefined) return currentAssessmentId === expectedCurrentAssessmentId;
  if (pendingClaimMatches) return currentAssessmentId === undefined || currentAssessmentId === assessmentId;
  return currentAssessmentId === assessmentId;
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
        && validAssessmentContext(assessment.contextSnapshot) && validScoreEvidence(assessment.evidence)
        && validContextEvidence(assessment.contextEvidence)
        && hasEligibleStorageEvidence(assessment.contextEvidence)
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
    && validAssessmentContext(assessment.contextSnapshot)
    && validScoreEvidence(assessment.evidence)
    && validContextEvidence(assessment.contextEvidence)
    && hasEligibleStorageEvidence(assessment.contextEvidence)
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
      .filter((item) => item && item.eligibility === 'eligible' && typeof item.status === 'string'
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

export function isCurrentManualReviewAssessment(
  value: unknown,
  eventId: string,
  versionId: string,
  assessmentId: string,
): value is ManualReviewRiskAssessment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const assessment = value as Partial<ManualReviewRiskAssessment>;
  const proposal = assessment.aiProposal as Partial<AIFailedProposal> | null | undefined;
  const proposalValid = proposal === null
    ? assessment.assessmentReadiness === 'insufficient_data'
    : Boolean(proposal && ['unavailable', 'timeout', 'invalid'].includes(proposal.status ?? '')
      && typeof proposal.model === 'string' && Boolean(proposal.model)
      && typeof proposal.promptVersion === 'string' && Boolean(proposal.promptVersion)
      && typeof proposal.responseSchemaVersion === 'string' && Boolean(proposal.responseSchemaVersion)
      && typeof proposal.retryable === 'boolean'
      && typeof proposal.errorSummary === 'string' && Boolean(proposal.errorSummary)
      && proposal.cacheStatus === 'not-applicable' && Number.isFinite(proposal.generatedAt));
  return assessment.status === 'manual_review_required'
    && assessment.schemaVersion === ASSESSMENT_SCHEMA_VERSION
    && assessment.assessmentId === assessmentId && assessment.eventId === eventId && assessment.versionId === versionId
    && typeof assessment.inputHash === 'string' && /^[a-f0-9]{64}$/.test(assessment.inputHash)
    && Number.isFinite(assessment.createdAt)
    && ['complete', 'provisional', 'insufficient_data'].includes(assessment.assessmentReadiness ?? '')
    && ['pass', 'review_required', 'blocked'].includes(assessment.complianceStatus ?? '')
    && Number.isFinite(assessment.dataConfidenceScore) && Number(assessment.dataConfidenceScore) >= 0
    && Number(assessment.dataConfidenceScore) <= 100
    && ['low', 'medium', 'high'].includes(assessment.dataConfidenceLevel ?? '')
    && assessment.authorityReviewRequired === true
    && typeof assessment.manualReviewReason === 'string' && Boolean(assessment.manualReviewReason.trim())
    && validAssessmentContext(assessment.contextSnapshot)
    && validScoreEvidence(assessment.evidence)
    && validContextEvidence(assessment.contextEvidence)
    && Array.isArray(assessment.warnings) && assessment.warnings.every((warning) => warning
      && typeof warning.warningId === 'string' && Boolean(warning.warningId)
      && typeof warning.code === 'string' && Boolean(warning.code)
      && typeof warning.message === 'string' && Boolean(warning.message)
      && Array.isArray(warning.evidenceReferences)
      && warning.evidenceReferences.every((reference) => CANONICAL_EVIDENCE_KEYS.has(reference)))
    && (assessment.activeManualAssessmentId === undefined || isSafeManualAssessmentId(assessment.activeManualAssessmentId))
    && hasEligibleStorageEvidence(assessment.contextEvidence)
    && proposalValid;
}

function validContextEvidence(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  const ids = value.map((item) => item && typeof item === 'object' ? (item as { evidenceId?: unknown }).evidenceId : undefined);
  return ids.every((id) => typeof id === 'string' && Boolean(id)) && new Set(ids).size === ids.length
    && value.every((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const evidence = item as Record<string, unknown>;
      return CANONICAL_EVIDENCE_KEYS.has(evidence.evidenceKey as never)
        && ['external_api', 'official_registry', 'official_dataset', 'submitted_document', 'submitted_declaration', 'derived'].includes(String(evidence.sourceKind))
        && typeof evidence.sourceLocator === 'string' && Boolean(evidence.sourceLocator)
        && Number.isFinite(evidence.retrievedAt)
        && typeof evidence.sourceVersion === 'string' && Boolean(evidence.sourceVersion)
        && ['eligible', 'ineligible', 'missing'].includes(String(evidence.eligibility))
        && (evidence.eligibility === 'eligible'
          ? evidence.eligibilityReason === undefined
          : typeof evidence.eligibilityReason === 'string' && Boolean(evidence.eligibilityReason))
        && (evidence.sourceKind !== 'submitted_document' || evidence.eligibility !== 'eligible'
          || (typeof evidence.sourceVersion === 'string' && /^storage-generation:\d+$/.test(evidence.sourceVersion)))
        && typeof evidence.synthetic === 'boolean'
        && ['authority_only', 'organizer_safe'].includes(String(evidence.visibility));
    });
}

function hasEligibleStorageEvidence(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => item && typeof item === 'object'
    && (item as Record<string, unknown>).sourceKind === 'submitted_document'
    && (item as Record<string, unknown>).eligibility === 'eligible');
}

function validScoreEvidence(value: unknown): value is ProvisionalRiskAssessment['evidence'] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const evidence = item as Record<string, unknown>;
    return CANONICAL_EVIDENCE_KEYS.has(evidence.key as never)
      && typeof evidence.description === 'string'
      && typeof evidence.source === 'string'
      && typeof evidence.status === 'string'
      && ['official', 'verified', 'declared', 'stale', 'missing'].includes(String(evidence.quality))
      && ['eligible', 'ineligible', 'missing'].includes(String(evidence.eligibility))
      && ['none', 'partial', 'all'].includes(String(evidence.syntheticStatus))
      && Number.isFinite(evidence.sourceTimestamp)
      && Number.isFinite(evidence.confidenceScore)
      && Number(evidence.confidenceScore) >= 0 && Number(evidence.confidenceScore) <= 100;
  });
}

function validAssessmentContext(value: unknown): value is ProvisionalRiskAssessment['contextSnapshot'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const context = value as Record<string, unknown>;
  const weather = context.weather as Record<string, unknown> | undefined;
  const calendar = context.calendar as Record<string, unknown> | undefined;
  const venue = context.venue as Record<string, unknown> | undefined;
  const history = context.incidentHistory as Record<string, unknown> | undefined;
  if (!weather || !calendar || !venue || !history) return false;
  const weatherData = weather.data;
  const weatherKeysValid = Object.keys(weather).every((key) => [
    'data', 'measurementStatus', 'unavailableReason', 'source', 'freshness',
    'fetchedAt', 'expiresAt', 'forecastFor',
  ].includes(key));
  const weatherValid = weatherKeysValid && (weather.measurementStatus === 'available'
    ? validWeatherMeasurements(weatherData) && weather.unavailableReason === undefined
    : weather.measurementStatus === 'unavailable' && weatherData === null
      && ['outside_forecast_horizon', 'provider_unavailable'].includes(String(weather.unavailableReason)));
  return weatherValid
    && ['met-malaysia', 'openweather', 'cache', 'fallback'].includes(String(weather.source))
    && ['fresh', 'stale', 'fallback', 'not_assessable_yet', 'unavailable'].includes(String(weather.freshness))
    && [weather.fetchedAt, weather.expiresAt, weather.forecastFor].every(Number.isFinite)
    && typeof calendar.localDate === 'string' && typeof calendar.dayOfWeek === 'string'
    && typeof calendar.isWeekend === 'boolean' && typeof calendar.isHolidayOrAdjacent === 'boolean'
    && typeof calendar.sourceVersion === 'string' && Boolean(calendar.sourceVersion)
    && Number.isFinite(calendar.sourceTimestamp)
    && ['verified', 'unsupported_year'].includes(String(calendar.coverageStatus))
    && typeof venue.matched === 'boolean' && Number.isFinite(venue.submittedCapacity)
    && Number.isFinite(venue.fetchedAt)
    && (!venue.matched || (typeof venue.venueId === 'string' && Boolean(venue.venueId)
      && Number.isFinite(venue.registeredCapacity)))
    && typeof history.matched === 'boolean' && Array.isArray(history.incidentIds)
    && history.incidentIds.every((id) => typeof id === 'string')
    && Number.isFinite(history.total) && history.bySeverity !== null
    && typeof history.bySeverity === 'object' && !Array.isArray(history.bySeverity)
    && ['low', 'medium', 'high'].every((key) => Number.isFinite((history.bySeverity as Record<string, unknown>)[key]))
    && ['none', 'partial', 'all'].includes(String(history.syntheticStatus))
    && Number.isFinite(history.fetchedAt);
}

function validWeatherMeasurements(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const weather = value as Record<string, unknown>;
  return typeof weather.forecast === 'string' && Boolean(weather.forecast)
    && finiteRange(weather.temperature, -100, 70)
    && finiteRange(weather.humidity, 0, 100)
    && finiteRange(weather.windSpeed, 0, Number.MAX_SAFE_INTEGER)
    && finiteRange(weather.precipitationProbability, 0, 100)
    && typeof weather.severeAlert === 'boolean';
}

function finiteRange(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
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
      : 'Planning ranges derived from an official risk assessment; resource ratios remain internal prototype inputs.',
  };
}

export const onEventCreated = onDocumentCreated({ document: `${COLLECTIONS.EVENTS}/{eventId}`, region: FUNCTION_REGION, secrets: ASSESSMENT_SECRETS, timeoutSeconds: 240 }, async (trigger) => {
  const eventId = trigger.params.eventId;
  const createdData = trigger.data?.data() as { sterasTest?: { datasetId?: string; managedBy?: string } } | undefined;
  const legacyM3FixtureIds = new Set([
    'evt-compliance-blocked',
    'evt-provisional-readiness',
    'evt-control-verification',
  ]);
  const isManagedUatFixture = (STERAS_TEST_EVENT_IDS as readonly string[]).includes(eventId)
    && createdData?.sterasTest?.datasetId === STERAS_TEST_DATASET_ID
    && createdData?.sterasTest?.managedBy === 'seed:steras:test';
  if (legacyM3FixtureIds.has(eventId) || isManagedUatFixture) {
    logger.info(`[onEventCreated] skipped M3 test fixture: ${eventId}`);
    return;
  }
  try { await runRiskAndResourcePipeline(eventId); } catch (error) { logger.error('[onEventCreated] failed', error); }
});

export const onEventUpdated = onDocumentUpdated({ document: `${COLLECTIONS.EVENTS}/{eventId}`, region: FUNCTION_REGION, secrets: ASSESSMENT_SECRETS, timeoutSeconds: 240 }, async (trigger) => {
  const before = trigger.data?.before.data() as EventRecord | undefined;
  const after = trigger.data?.after.data() as EventRecord | undefined;
  if (!before || !after || after.status !== 'Pending') return;
  if (before.status === 'Pending' && before.currentVersionId === after.currentVersionId) return;
  try { await runRiskAndResourcePipeline(trigger.params.eventId); } catch (error) { logger.error('[onEventUpdated] failed', error); }
});
