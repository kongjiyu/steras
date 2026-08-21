import { createHash, randomUUID } from 'node:crypto';
import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  AdminManualAssessment,
  AdminManualOfficialRiskAssessment,
  ASSESSMENT_SCHEMA_VERSION,
  AssessmentRecord,
  COLLECTIONS,
  EventRecord,
  EventVersion,
  MANUAL_ASSESSMENT_SCHEMA_VERSION,
  ManualReviewRiskAssessment,
  OrganizerAssessmentSummary,
  OrganizerResourceRecommendation,
  RESOURCE_CONFIG_VERSION,
  RESOURCE_FORMULA_VERSION,
  RESOURCE_KEYS,
  RESOURCE_SCHEMA_VERSION,
  RESOURCE_SOURCE_REGISTRY_VERSION,
  ResourceRecommendation,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { RESOURCE_CUTOVER_LOCK_PATH } from '../config/resourceCutoverLock';
import {
  ManualAssessmentInput,
  buildManualAssessment,
  buildManualOfficialAssessmentResult,
  isManualAssessmentSourceEligible,
  sameManualAssessment,
  validateManualAssessmentInput,
} from '../engines/manualFinalisation';
import { computeResources, matchesDeterministicResourceItems, stableStringify, validateManualOfficialAssessmentResult } from '../engines/resourceCalculator';
import { validateResourceRecommendation, validateResourceRevisionChain } from '../engines/resourceContract';
import { resourceDocumentId } from '../triggers/onEventCreated';

interface SubmitManualRequest extends Partial<ManualAssessmentInput> { eventId?: string }
interface RetryManualRequest { eventId?: string }

export const submitAdminManualAssessment = onCall<SubmitManualRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before completing a manual assessment.');
  return submitAdminManualAssessmentForUser(request.auth.uid, request.data as SubmitManualRequest);
});

export const retryManualOfficialFinalisation = onCall<RetryManualRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before retrying manual finalisation.');
  const eventId = requiredId(request.data?.eventId, 'eventId');
  return retryManualOfficialFinalisationForAdmin(request.auth.uid, eventId);
});

export async function retryManualOfficialFinalisationForAdmin(uid: string, eventId: string, now = Date.now()) {
  const identity = await recordManualRetryAttempt(uid, eventId, now);
  try {
    return await finalizeStoredManualAssessment(uid, eventId, true, now, identity);
  } catch (error) {
    await recordManualFailure(eventId, identity, now, error);
    throw error;
  }
}

export async function submitAdminManualAssessmentForUser(uid: string, data: SubmitManualRequest, now = Date.now()) {
  const payload: SubmitManualRequest = isRecord(data) ? data as SubmitManualRequest : {};
  const eventId = requiredId(payload.eventId, 'eventId');
  const input: ManualAssessmentInput = {
    hazards: Array.isArray(payload.hazards) ? payload.hazards : [],
    categories: Array.isArray(payload.categories) ? payload.categories : [],
    rationale: typeof payload.rationale === 'string' ? payload.rationale : '',
    idempotencyKey: typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey : '',
  };
  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const persisted = await db.runTransaction(async (transaction) => {
    const [profileSnap, eventSnap, lockSnap] = await Promise.all([
      transaction.get(db.collection(COLLECTIONS.USERS).doc(uid)),
      transaction.get(eventRef), transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
    ]);
    assertNoCutover(lockSnap);
    if ((profileSnap.data() as UserProfile | undefined)?.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Only an administrator may submit a manual assessment.');
    }
    const event = eventSnap.data() as EventRecord | undefined;
    const { versionId, assessmentId } = assertManualEvent(event);
    const assessmentRef = eventRef.collection(COLLECTIONS.ASSESSMENTS).doc(assessmentId);
    const versionRef = eventRef.collection(COLLECTIONS.VERSIONS).doc(versionId);
    const [assessmentSnap, versionSnap] = await Promise.all([transaction.get(assessmentRef), transaction.get(versionRef)]);
    const assessment = assessmentSnap.data() as AssessmentRecord | undefined;
    const version = versionSnap.data() as EventVersion | undefined;
    const alreadyOfficialManual = isManualOfficial(assessment, eventId, versionId, assessmentId);
    if ((!isEligibleManualAssessment(assessment, eventId, versionId, assessmentId) && !alreadyOfficialManual) || !version
      || version.eventId !== eventId || version.versionId !== versionId) {
      throw new HttpsError('failed-precondition', 'The current assessment is not eligible for Admin manual assessment.');
    }
    const manualAssessmentId = manualId(versionId, uid, input.idempotencyKey);
    const manualRef = assessmentRef.collection(COLLECTIONS.MANUAL_ASSESSMENTS).doc(manualAssessmentId);
    const [existingSnap, manualHistorySnap] = await Promise.all([
      transaction.get(manualRef),
      transaction.get(assessmentRef.collection(COLLECTIONS.MANUAL_ASSESSMENTS).limit(2)),
    ]);
    const existing = existingSnap.data() as AdminManualAssessment | undefined;
    if (manualHistorySnap.docs.some((snapshot) => snapshot.id !== manualAssessmentId)) {
      throw new HttpsError('failed-precondition', 'This application version already contains a different manual assessment record.');
    }
    const hasManualLockField = Object.prototype.hasOwnProperty.call(assessment, 'activeManualAssessmentId');
    if (hasManualLockField && !safeIdentifier(assessment.activeManualAssessmentId)) {
      throw new HttpsError('failed-precondition', 'The Admin manual assessment lock is invalid; do not replace this generation.');
    }
    if (safeIdentifier(assessment.activeManualAssessmentId)
      && assessment.activeManualAssessmentId !== manualAssessmentId) {
      throw new HttpsError('failed-precondition', 'This application version already has a locked manual assessment.');
    }
    if (safeIdentifier(assessment.activeManualAssessmentId) && !existingSnap.exists) {
      throw new HttpsError('failed-precondition', 'The locked manual assessment record is missing.');
    }
    const inputErrors = validateManualAssessmentInput(input, assessment.evidence);
    if (inputErrors.length) throw new HttpsError('invalid-argument', `Invalid manual assessment: ${inputErrors.join(', ')}.`);
    const proposed = buildManualAssessment({
      assessment: assessment as unknown as ManualReviewRiskAssessment, eventVersionInputHash: version.inputHash, submittedBy: uid,
      manualAssessmentId, input, createdAt: existing?.createdAt ?? now,
    });
    if (existing && !sameManualAssessment(existing, proposed)) {
      throw new HttpsError('already-exists', 'The idempotency key is already bound to different manual assessment content.');
    }
    if (alreadyOfficialManual) {
      if (!existing || assessment.activeManualAssessmentId !== manualAssessmentId || !sameManualAssessment(existing, proposed)) {
        throw new HttpsError('failed-precondition', 'The manual official assessment is locked.');
      }
      return { eventId, versionId, assessmentId, manualAssessmentId, idempotent: true };
    }
    if (!existing) {
      transaction.create(manualRef, proposed);
      const auditRef = eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(`${manualAssessmentId}-submitted`);
      transaction.create(auditRef, audit(auditRef.id, eventId, versionId, 'manual_assessment_submitted', uid, now, {
        assessmentId, manualAssessmentId, schemaVersion: MANUAL_ASSESSMENT_SCHEMA_VERSION,
      }));
    }
    transaction.set(assessmentRef, { activeManualAssessmentId: manualAssessmentId }, { merge: true });
    transaction.update(eventRef, { updatedAt: now });
    return { eventId, versionId, assessmentId, manualAssessmentId, idempotent: Boolean(existing) };
  });
  try {
    const finalized = await finalizeStoredManualAssessment(uid, eventId, false, now, persisted);
    return { ...persisted, ...finalized };
  } catch (error) {
    await recordManualFailure(eventId, persisted, now, error);
    throw error;
  }
}

interface ManualFinalisationIdentity {
  versionId: string;
  assessmentId: string;
  manualAssessmentId?: string;
}

export async function finalizeStoredManualAssessment(
  uid: string,
  eventId: string,
  requireAdmin = true,
  now = Date.now(),
  expectedIdentity?: ManualFinalisationIdentity,
) {
  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  return db.runTransaction(async (transaction) => {
    const [profileSnap, eventSnap, lockSnap] = await Promise.all([
      transaction.get(db.collection(COLLECTIONS.USERS).doc(uid)), transaction.get(eventRef),
      transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
    ]);
    assertNoCutover(lockSnap);
    const profile = profileSnap.data() as UserProfile | undefined;
    if (requireAdmin && profile?.role !== 'admin') throw new HttpsError('permission-denied', 'Only an administrator may retry manual finalisation.');
    if (profile?.role !== 'admin') throw new HttpsError('permission-denied', 'Only an administrator may finalize a manual assessment.');
    const event = eventSnap.data() as EventRecord | undefined;
    const { versionId, assessmentId } = assertManualEvent(event, true);
    if (expectedIdentity && (versionId !== expectedIdentity.versionId || assessmentId !== expectedIdentity.assessmentId)) {
      throw new HttpsError('aborted', 'The application version changed before manual finalisation completed.');
    }
    const assessmentRef = eventRef.collection(COLLECTIONS.ASSESSMENTS).doc(assessmentId);
    const versionRef = eventRef.collection(COLLECTIONS.VERSIONS).doc(versionId);
    const [assessmentSnap, versionSnap] = await Promise.all([transaction.get(assessmentRef), transaction.get(versionRef)]);
    const assessmentValue = assessmentSnap.data() as AssessmentRecord | undefined;
    const version = versionSnap.data() as EventVersion | undefined;
    if (!version || version.eventId !== eventId || version.versionId !== versionId) throw new HttpsError('failed-precondition', 'The current immutable event version is missing.');
    if (isManualOfficial(assessmentValue, eventId, versionId, assessmentId)) {
      if (expectedIdentity?.manualAssessmentId
        && assessmentValue.activeManualAssessmentId !== expectedIdentity.manualAssessmentId) {
        throw new HttpsError('aborted', 'The manual assessment generation changed before finalisation completed.');
      }
      if (!event?.currentResourceId) throw new HttpsError('failed-precondition', 'The manual official resource is missing.');
      const summaryRef = eventRef.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).doc(versionId);
      const [resourceSnap, manualSnap, historySnap, summarySnap] = await Promise.all([
        transaction.get(eventRef.collection(COLLECTIONS.RESOURCES).doc(event.currentResourceId)),
        transaction.get(assessmentRef.collection(COLLECTIONS.MANUAL_ASSESSMENTS).doc(assessmentValue.activeManualAssessmentId)),
        transaction.get(eventRef.collection(COLLECTIONS.RESOURCES)
          .where('versionId', '==', versionId)
          .where('stage', '==', 'official')),
        transaction.get(summaryRef),
      ]);
      const resource = resourceSnap.data();
      const manual = manualSnap.data() as AdminManualAssessment | undefined;
      const reference = (resource as ResourceRecommendation | undefined)?.assessmentReference;
      if (!manual || manualSnap.id !== assessmentValue.activeManualAssessmentId
        || manual.manualAssessmentId !== assessmentValue.activeManualAssessmentId) {
        throw new HttpsError('failed-precondition', 'The locked manual assessment identity is invalid.');
      }
      const expectedResult = buildManualOfficialAssessmentResult({
        assessment: assessmentValue as unknown as ManualReviewRiskAssessment,
        manualAssessment: manual, eventDetails: version.eventDetails, eventVersionInputHash: version.inputHash,
        finalizedAt: assessmentValue.officialResult.finalizedAt, finalizedBy: assessmentValue.officialResult.finalizedBy,
      });
      const expectedCalculation = computeResources({ eventId, versionId, assessmentId, eventDetails: version.eventDetails, assessmentResult: expectedResult });
      const history = historySnap.docs.map((snapshot) => snapshot.data() as ResourceRecommendation);
      if (!expectedCalculation.ok || stableStringify(expectedResult) !== stableStringify(assessmentValue.officialResult)
        || !validateResourceRecommendation(resource).ok
        || (resource as ResourceRecommendation).eventId !== eventId
        || (resource as ResourceRecommendation).versionId !== versionId
        || (resource as ResourceRecommendation).assessmentId !== assessmentId
        || (resource as ResourceRecommendation).resourceInputHash !== expectedCalculation.resourceInputHash
        || !matchesDeterministicResourceItems((resource as ResourceRecommendation).items, expectedCalculation.items)
        || reference?.stage !== 'official'
        || !('sourceKind' in reference) || reference.sourceKind !== 'admin_manual'
        || reference.manualAssessmentId !== assessmentValue.activeManualAssessmentId
        || reference.finalizedAt !== assessmentValue.officialResult.finalizedAt
        || reference.finalizedBy !== assessmentValue.officialResult.finalizedBy
        || historySnap.docs.some((snapshot, index) => snapshot.id !== history[index].resourceId)
        || history.some((candidate) => !validateResourceRecommendation(candidate).ok
          || candidate.eventId !== eventId || candidate.versionId !== versionId || candidate.stage !== 'official')
        || validateResourceRevisionChain(history, event.currentResourceId).length > 0) {
        throw new HttpsError('failed-precondition', 'The manual official output is invalid.');
      }
      const expectedSummary = organizerSummary(assessmentValue, resource as ResourceRecommendation, assessmentValue.officialResult.finalizedAt);
      if (!summarySnap.exists || stableStringify(summarySnap.data()) !== stableStringify(expectedSummary)) {
        transaction.set(summaryRef, expectedSummary);
      }
      return { eventId, status: 'official_ready' as const, officialResourceId: event.currentResourceId, idempotent: true };
    }
    if (!isEligibleManualAssessment(assessmentValue, eventId, versionId, assessmentId)
      || !safeIdentifier(assessmentValue.activeManualAssessmentId)) throw new HttpsError('failed-precondition', 'No persisted manual assessment is ready for finalisation.');
    if (expectedIdentity?.manualAssessmentId
      && assessmentValue.activeManualAssessmentId !== expectedIdentity.manualAssessmentId) {
      throw new HttpsError('aborted', 'The manual assessment generation changed before finalisation completed.');
    }
    const manualRef = assessmentRef.collection(COLLECTIONS.MANUAL_ASSESSMENTS).doc(assessmentValue.activeManualAssessmentId);
    const historyQuery = eventRef.collection(COLLECTIONS.RESOURCES).where('versionId', '==', versionId).where('stage', '==', 'official');
    const [manualSnap, historySnap] = await Promise.all([transaction.get(manualRef), transaction.get(historyQuery)]);
    const manual = manualSnap.data() as AdminManualAssessment | undefined;
    if (!manual || manualSnap.id !== assessmentValue.activeManualAssessmentId
      || manual.manualAssessmentId !== assessmentValue.activeManualAssessmentId) {
      throw new HttpsError('failed-precondition', 'The persisted manual assessment identity is invalid.');
    }
    const officialResult = buildManualOfficialAssessmentResult({ assessment: assessmentValue, manualAssessment: manual, eventDetails: version.eventDetails, eventVersionInputHash: version.inputHash, finalizedAt: now, finalizedBy: uid });
    const calculation = computeResources({ eventId, versionId, assessmentId, eventDetails: version.eventDetails, assessmentResult: officialResult });
    if (!calculation.ok) throw new HttpsError('failed-precondition', `Manual official resource calculation failed: ${calculation.code}.`);
    const history = historySnap.docs.map((snapshot) => snapshot.data() as ResourceRecommendation);
    if (historySnap.docs.some((snapshot, index) => snapshot.id !== history[index].resourceId)
      || history.some((resource) => !validateResourceRecommendation(resource).ok
        || resource.eventId !== eventId || resource.versionId !== versionId || resource.stage !== 'official')) {
      throw new HttpsError('failed-precondition', 'Official resource history is invalid.');
    }
    const tip = [...history].sort((left, right) => right.revision - left.revision)[0];
    if (tip && validateResourceRevisionChain(history, tip.resourceId).length) throw new HttpsError('failed-precondition', 'Official resource revision chain is invalid.');
    const resourceId = resourceDocumentId('official', versionId, calculation.resourceInputHash);
    const existing = history.find((resource) => resource.resourceId === resourceId);
    const items = Object.fromEntries(RESOURCE_KEYS.map((key) => [key, {
      ...calculation.items[key], confidence: 'authority_validated' as const, authorityReviewRequired: false,
    }])) as ResourceRecommendation['items'];
    const resource: ResourceRecommendation = existing ?? {
      resourceId, eventId, versionId, assessmentId, schemaVersion: RESOURCE_SCHEMA_VERSION,
      stage: 'official', revision: tip ? tip.revision + 1 : 1, supersedesResourceId: tip?.resourceId ?? null,
      assessmentReference: { stage: 'official', assessmentId, sourceKind: 'admin_manual', manualAssessmentId: manual.manualAssessmentId, finalizedAt: now, finalizedBy: uid },
      resourceInputHash: calculation.resourceInputHash, formulaVersion: RESOURCE_FORMULA_VERSION,
      configVersion: RESOURCE_CONFIG_VERSION, sourceRegistryVersion: RESOURCE_SOURCE_REGISTRY_VERSION,
      items, confidenceLevel: 'authority_validated', authorityReviewRequired: false,
      notes: 'Official deterministic planning ranges based on the locked Admin manual assessment.', computedAt: now,
    };
    if (existing && (existing.resourceId !== resourceId || existing.eventId !== eventId
      || existing.versionId !== versionId || existing.assessmentId !== assessmentId
      || existing.resourceInputHash !== calculation.resourceInputHash
      || existing.formulaVersion !== RESOURCE_FORMULA_VERSION || existing.configVersion !== RESOURCE_CONFIG_VERSION
      || existing.sourceRegistryVersion !== RESOURCE_SOURCE_REGISTRY_VERSION
      || existing.assessmentReference.stage !== 'official'
      || existing.assessmentReference.sourceKind !== 'admin_manual'
      || existing.assessmentReference.manualAssessmentId !== manual.manualAssessmentId
      || existing.assessmentReference.finalizedAt !== now || existing.assessmentReference.finalizedBy !== uid
      || stableStringify(existing.items) !== stableStringify(items)
      || existing.resourceId !== tip?.resourceId)) throw new HttpsError('already-exists', 'Manual official resource identity collision.');
    const officialAssessment: AdminManualOfficialRiskAssessment = {
      ...assessmentValue, status: 'official_ready', sourceKind: 'admin_manual', authorityReviewRequired: false,
      aiProposal: assessmentValue.aiProposal && assessmentValue.aiProposal.status !== 'success'
        ? assessmentValue.aiProposal
        : null,
      activeManualAssessmentId: manual.manualAssessmentId, officialResult,
    };
    if (!existing) transaction.create(eventRef.collection(COLLECTIONS.RESOURCES).doc(resourceId), resource);
    transaction.set(assessmentRef, officialAssessment);
    transaction.update(eventRef, { currentResourceId: resourceId, updatedAt: now });
    transaction.set(eventRef.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).doc(versionId), organizerSummary(officialAssessment, resource, now));
    const auditRef = eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(`${officialResult.officialInputHash}-manual-finalized`);
    transaction.create(auditRef, audit(auditRef.id, eventId, versionId, 'manual_official_assessment_finalized', uid, now, {
      assessmentId, manualAssessmentId: manual.manualAssessmentId, resourceId, officialInputHash: officialResult.officialInputHash,
    }));
    return { eventId, status: 'official_ready' as const, officialResourceId: resourceId, idempotent: false };
  });
}

function organizerSummary(assessment: AdminManualOfficialRiskAssessment, resource: ResourceRecommendation, now: number): OrganizerAssessmentSummary {
  const result = assessment.officialResult;
  const projection: OrganizerResourceRecommendation = {
    resourceId: resource.resourceId, revision: resource.revision, stage: 'official',
    items: Object.fromEntries(RESOURCE_KEYS.map((key) => [key, { baseline: resource.items[key].baseline, planningRange: { ...resource.items[key].planningRange } }])) as OrganizerResourceRecommendation['items'],
    disclaimer: 'Official planning ranges based on an Admin manual assessment.',
  };
  return {
    assessmentId: assessment.assessmentId, eventId: assessment.eventId, versionId: assessment.versionId,
    schemaVersion: ASSESSMENT_SCHEMA_VERSION, status: 'official_ready', overallScore: result.overallScore,
    overallRiskLevel: result.overallRiskLevel,
    categories: result.categories.map((category) => ({ categoryId: category.categoryId, categoryName: category.categoryName, normalizedScore: category.normalizedScore, riskLevel: category.riskLevel })),
    assessmentReadiness: assessment.assessmentReadiness, complianceStatus: assessment.complianceStatus,
    authorityReviewRequired: false,
    resourceQuantities: Object.fromEntries(RESOURCE_KEYS.map((key) => [key, resource.items[key].baseline])) as unknown as OrganizerAssessmentSummary['resourceQuantities'],
    resourceRecommendation: projection, computedAt: now,
  };
}

function assertManualEvent(event: EventRecord | undefined, allowOfficial = false) {
  if (!event?.currentVersionId || !event.currentAssessmentId
    || !safeIdentifier(event.currentVersionId) || !safeIdentifier(event.currentAssessmentId)
    || !['Pending', 'UnderReview'].includes(event.status)) {
    throw new HttpsError('failed-precondition', 'The event is not open for manual assessment.');
  }
  void allowOfficial;
  return { versionId: event.currentVersionId, assessmentId: event.currentAssessmentId };
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEligibleManualAssessment(value: AssessmentRecord | undefined, eventId: string, versionId: string, assessmentId: string): value is ManualReviewRiskAssessment {
  const hasManualLockField = Boolean(value && Object.prototype.hasOwnProperty.call(value, 'activeManualAssessmentId'));
  const activeManualAssessmentId = isRecord(value) ? value.activeManualAssessmentId : undefined;
  const manualLockValid = !hasManualLockField || safeIdentifier(activeManualAssessmentId);
  return Boolean(value && value.status === 'manual_review_required' && value.schemaVersion === ASSESSMENT_SCHEMA_VERSION
    && value.eventId === eventId && value.versionId === versionId && value.assessmentId === assessmentId
    && typeof value.inputHash === 'string' && Boolean(value.inputHash)
    && Number.isFinite(value.createdAt)
    && ['complete', 'provisional', 'insufficient_data'].includes(value.assessmentReadiness)
    && ['pass', 'review_required', 'blocked'].includes(value.complianceStatus)
    && Number.isFinite(value.dataConfidenceScore)
    && ['low', 'medium', 'high'].includes(value.dataConfidenceLevel)
    && typeof value.manualReviewReason === 'string' && value.manualReviewReason.trim().length > 0
    && isManualContextSnapshot(value.contextSnapshot)
    && Array.isArray(value.evidence) && value.evidence.every(isManualEvidence)
    && Array.isArray(value.warnings) && value.warnings.every(isManualWarning)
    && manualLockValid
    && isManualAssessmentSourceEligible(value));
}

function isManualContextSnapshot(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const weather = value.weather;
  const calendar = value.calendar;
  const venue = value.venue;
  const history = value.incidentHistory;
  return isRecord(weather) && isRecord(weather.data)
    && typeof weather.data.forecast === 'string'
    && [weather.data.temperature, weather.data.humidity, weather.data.windSpeed, weather.data.precipitationProbability,
      weather.fetchedAt, weather.expiresAt, weather.forecastFor].every(Number.isFinite)
    && typeof weather.data.severeAlert === 'boolean'
    && ['met-malaysia', 'openweather', 'cache', 'fallback'].includes(String(weather.source))
    && ['fresh', 'stale', 'fallback', 'not_assessable_yet', 'unavailable'].includes(String(weather.freshness))
    && isRecord(calendar)
    && typeof calendar.localDate === 'string' && typeof calendar.dayOfWeek === 'string'
    && typeof calendar.isWeekend === 'boolean' && typeof calendar.isHolidayOrAdjacent === 'boolean'
    && Number.isFinite(calendar.sourceTimestamp) && typeof calendar.sourceVersion === 'string'
    && isRecord(venue) && typeof venue.matched === 'boolean'
    && Number.isFinite(venue.submittedCapacity) && Number.isFinite(venue.fetchedAt)
    && optionalFinite(venue.registeredCapacity) && optionalFinite(venue.capacityDifference)
    && optionalFinite(venue.verifiedSafeCapacity) && optionalFinite(venue.nearestHospitalTravelMinutes)
    && optionalBoolean(venue.emergencyAccessVerified)
    && isRecord(history) && typeof history.matched === 'boolean'
    && Array.isArray(history.incidentIds) && history.incidentIds.every((id) => typeof id === 'string')
    && Number.isFinite(history.total) && isRecord(history.bySeverity)
    && [history.bySeverity.low, history.bySeverity.medium, history.bySeverity.high, history.fetchedAt].every(Number.isFinite);
}

function isManualEvidence(value: unknown): boolean {
  return isRecord(value)
    && ['weather', 'crowd', 'venue', 'history', 'holiday', 'public_health', 'sanitation', 'medical', 'security', 'transport', 'compliance'].includes(String(value.key))
    && typeof value.description === 'string' && typeof value.source === 'string' && typeof value.status === 'string'
    && Number.isFinite(value.sourceTimestamp);
}

function isManualWarning(value: unknown): boolean {
  return isRecord(value)
    && typeof value.warningId === 'string' && value.warningId.trim().length > 0
    && typeof value.code === 'string' && value.code.trim().length > 0
    && typeof value.message === 'string' && value.message.trim().length > 0
    && Array.isArray(value.evidenceReferences)
    && value.evidenceReferences.every((reference) => typeof reference === 'string');
}

function optionalFinite(value: unknown): boolean {
  return value === undefined || Number.isFinite(value);
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function isManualOfficial(value: AssessmentRecord | undefined, eventId?: string, versionId?: string, assessmentId?: string): value is AdminManualOfficialRiskAssessment {
  return Boolean(value && value.status === 'official_ready' && 'sourceKind' in value && value.sourceKind === 'admin_manual'
    && value.authorityReviewRequired === false
    && ['complete', 'provisional', 'insufficient_data'].includes(value.assessmentReadiness)
    && ['pass', 'review_required', 'blocked'].includes(value.complianceStatus)
    && Number.isFinite(value.dataConfidenceScore)
    && Number.isFinite(value.createdAt)
    && ['low', 'medium', 'high'].includes(value.dataConfidenceLevel)
    && (!eventId || value.eventId === eventId)
    && (!versionId || value.versionId === versionId)
    && (!assessmentId || value.assessmentId === assessmentId)
    && safeIdentifier(value.activeManualAssessmentId)
    && value.officialResult?.sourceKind === 'admin_manual'
    && value.officialResult.manualAssessmentId === value.activeManualAssessmentId
    && isManualAssessmentSourceEligible(value)
    && validateManualOfficialAssessmentResult(value.officialResult).length === 0);
}

function manualId(versionId: string, uid: string, key: string) {
  return `${versionId}-manual-${createHash('sha256').update(`${uid}:${key}`).digest('hex').slice(0, 24)}`;
}

function assertNoCutover(snapshot: FirebaseFirestore.DocumentSnapshot) {
  if (snapshot.exists) throw new HttpsError('unavailable', 'Resource migration is in progress. Retry shortly.');
}

function requiredId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new HttpsError('invalid-argument', `${name} is required.`);
  return value;
}

async function recordManualRetryAttempt(uid: string, eventId: string, now: number) {
  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  return db.runTransaction(async (transaction) => {
    const [profileSnap, eventSnap, lockSnap] = await Promise.all([
      transaction.get(db.collection(COLLECTIONS.USERS).doc(uid)), transaction.get(eventRef), transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
    ]);
    assertNoCutover(lockSnap);
    if ((profileSnap.data() as UserProfile | undefined)?.role !== 'admin') throw new HttpsError('permission-denied', 'Only an administrator may retry manual finalisation.');
    const event = eventSnap.data() as EventRecord | undefined;
    const { versionId, assessmentId } = assertManualEvent(event, true);
    const assessment = (await transaction.get(eventRef.collection(COLLECTIONS.ASSESSMENTS).doc(assessmentId))).data() as AssessmentRecord | undefined;
    if (!(isManualOfficial(assessment, eventId, versionId, assessmentId)
      || (isEligibleManualAssessment(assessment, eventId, versionId, assessmentId) && assessment.activeManualAssessmentId))) {
      throw new HttpsError('failed-precondition', 'No persisted manual assessment is ready for retry.');
    }
    const ref = eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(`${versionId}-${now}-${randomUUID()}-manual-retry`);
    transaction.create(ref, audit(ref.id, eventId, versionId, 'manual_official_finalization_retried', uid, now, {
      assessmentId, manualAssessmentId: assessment.activeManualAssessmentId,
    }));
    return { eventId, versionId, assessmentId, manualAssessmentId: assessment.activeManualAssessmentId };
  });
}

async function recordManualFailure(eventId: string, identity: { versionId: string; assessmentId: string; manualAssessmentId?: string } | undefined, now: number, error: unknown) {
  if (!identity || error instanceof HttpsError && ['unauthenticated', 'permission-denied', 'invalid-argument', 'unavailable'].includes(error.code)) return;
  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const summary = error instanceof Error ? error.message.slice(0, 500) : 'Unknown manual official finalisation failure.';
  await db.runTransaction(async (transaction) => {
    const assessmentRef = eventRef.collection(COLLECTIONS.ASSESSMENTS).doc(identity.assessmentId);
    const [eventSnap, assessmentSnap, lockSnap] = await Promise.all([
      transaction.get(eventRef), transaction.get(assessmentRef), transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
    ]);
    const event = eventSnap.data() as EventRecord | undefined;
    const assessment = assessmentSnap.data() as AssessmentRecord | undefined;
    if (lockSnap.exists || !event
      || event.currentVersionId !== identity.versionId
      || event.currentAssessmentId !== identity.assessmentId
      || !['Pending', 'UnderReview'].includes(event.status)) return;
    if (assessment?.status !== 'manual_review_required') return;
    if (identity.manualAssessmentId && (!assessment || !('activeManualAssessmentId' in assessment)
      || assessment.activeManualAssessmentId !== identity.manualAssessmentId)) return;
    const ref = eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(`${identity.versionId}-${now}-${randomUUID()}-manual-failed`);
    transaction.create(ref, audit(ref.id, eventId, identity.versionId, 'manual_official_finalization_failed', 'system', now, {
      assessmentId: identity.assessmentId, manualAssessmentId: identity.manualAssessmentId ?? null, errorSummary: summary,
    }));
  });
}

function audit(id: string, eventId: string, versionId: string, action: string, actorId: string, timestamp: number, metadata: Record<string, unknown>) {
  return { id, eventId, versionId, action, actorId, actorRole: actorId === 'system' ? 'system' : 'admin', timestamp, metadata };
}

export const __testOnly = { manualId, isEligibleManualAssessment };
