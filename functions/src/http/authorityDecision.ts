import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  ASSESSMENT_SCHEMA_VERSION,
  AssessmentRecord,
  AuthorityDecision,
  AuthorityType,
  COLLECTIONS,
  DecisionValue,
  EventRecord,
  EventVersion,
  HARD_RULE_VERSION,
  PROVISIONAL_FORMULA_VERSION,
  ProvisionalAssessmentResult,
  PublicEvent,
  RESOURCE_CONFIG_VERSION,
  RESOURCE_FORMULA_VERSION,
  RESOURCE_SOURCE_REGISTRY_VERSION,
  ResourceRecommendation,
  RiskLevel,
  UserProfile,
  hirarcRiskLevelFor,
  riskLevelFor,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { RESOURCE_CUTOVER_LOCK_PATH } from '../config/resourceCutoverLock';
import { ACTIVE_CATEGORY_SCHEMA } from '../config/categorySchema';
import {
  computeResources,
  matchesDeterministicResourceItems,
  validateAssessmentResultAgainstHardRules,
  validateAssessmentResultAgainstProposal,
  validateProvisionalAssessmentResult,
} from '../engines/resourceCalculator';
import { validateResourceRecommendation, validateResourceRevisionChain } from '../engines/resourceContract';
import { computeCategoryBasedAssessment } from '../engines/ruleBased';
import { evaluateCategoryHardRules } from '../engines/hardRuleEvaluator';

interface AuthorityDecisionRequest {
  eventId?: string;
  decision?: DecisionValue;
  rationale?: string;
}

export const makeAuthorityDecision = onCall<AuthorityDecisionRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before reviewing an application.');
  return makeAuthorityDecisionForUser(request.auth.uid, request.data);
});

export async function makeAuthorityDecisionForUser(
  uid: string,
  request: AuthorityDecisionRequest,
  now = Date.now(),
) {
  const { eventId, decision, rationale } = validateDecisionRequest(request);

  const db = firestore();
  const eventReference = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const userReference = db.collection(COLLECTIONS.USERS).doc(uid);
  const publicReference = db.collection(COLLECTIONS.PUBLIC_EVENTS).doc(eventId);

  return db.runTransaction(async (transaction) => {
    const [userSnapshot, eventSnapshot, cutoverLockSnapshot] = await Promise.all([
      transaction.get(userReference),
      transaction.get(eventReference),
      transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
    ]);
    if (cutoverLockSnapshot.exists) {
      throw new HttpsError('unavailable', 'Resource migration is in progress. Retry the decision shortly.');
    }
    const profile = userSnapshot.data() as UserProfile | undefined;
    if (!profile || profile.role !== 'authority' || !profile.authorityType) {
      throw new HttpsError('permission-denied', 'Only provisioned authority accounts can make decisions.');
    }
    if (!eventSnapshot.exists) throw new HttpsError('not-found', 'Event application was not found.');
    const event = { eventId, ...eventSnapshot.data() } as EventRecord;
    const versionId = event.currentVersionId;
    if (!versionId) throw new HttpsError('failed-precondition', 'The application has no submitted version.');
    if (!event.requiredAuthorities.includes(profile.authorityType)) {
      throw new HttpsError('permission-denied', 'Your authority is not assigned to this application.');
    }

    const decisionId = currentDecisionId(versionId, profile.authorityType);
    const currentReference = eventReference.collection(COLLECTIONS.DECISIONS).doc(decisionId);
    const versionReference = eventReference.collection(COLLECTIONS.VERSIONS).doc(versionId);
    const assessmentReference = eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(versionId);
    const resourceReference = eventReference.collection(COLLECTIONS.RESOURCES).doc(event.currentResourceId ?? versionId);
    const resourceHistoryQuery = eventReference.collection(COLLECTIONS.RESOURCES)
      .where('versionId', '==', versionId);
    const [currentSnapshot, versionSnapshot, assessmentSnapshot, resourceSnapshot, resourceHistorySnapshot] = await Promise.all([
      transaction.get(currentReference),
      transaction.get(versionReference),
      transaction.get(assessmentReference),
      transaction.get(resourceReference),
      transaction.get(resourceHistoryQuery),
    ]);
    const current = currentSnapshot.data() as AuthorityDecision | undefined;
    const version = versionSnapshot.data() as EventVersion | undefined;
    assertOfficialAssessmentReady(
      event,
      versionId,
      assessmentSnapshot.data() as AssessmentRecord | undefined,
      resourceSnapshot.data() as ResourceRecommendation | undefined,
      version,
      resourceHistorySnapshot.docs.map((document) => document.data() as ResourceRecommendation),
    );
    if (current && current.decision === decision && current.rationale === rationale && current.reviewerId === uid) {
      return { eventId, versionId, decisionId, decision, status: event.status, idempotent: true };
    }
    if (!['Pending', 'UnderReview'].includes(event.status)) {
      throw new HttpsError('failed-precondition', 'This application version is no longer open for review.');
    }
    if (!versionSnapshot.exists) throw new HttpsError('failed-precondition', 'The immutable application version is missing.');

    const decisionReferences = event.requiredAuthorities.map((authority) =>
      eventReference.collection(COLLECTIONS.DECISIONS).doc(currentDecisionId(versionId, authority)));
    const decisionSnapshots = await transaction.getAll(...decisionReferences);
    const decisions = new Map<AuthorityType, DecisionValue>();
    decisionSnapshots.forEach((snapshot) => {
      const value = snapshot.data() as AuthorityDecision | undefined;
      if (value?.versionId === versionId && value.current) decisions.set(value.authorityType, value.decision);
    });
    decisions.set(profile.authorityType, decision);
    const aggregateStatus = aggregateDecisionStatus(event.requiredAuthorities, decisions);
    if (!version) throw new HttpsError('failed-precondition', 'The immutable application version is missing.');
    const authorityDecision: AuthorityDecision = {
      decisionId,
      eventId,
      versionId,
      authorityType: profile.authorityType,
      decision,
      rationale,
      reviewerId: uid,
      decidedAt: now,
      current: true,
    };
    const historyId = `${decisionId}_${now}`;
    const historyReference = eventReference.collection(COLLECTIONS.DECISION_HISTORY).doc(historyId);
    const auditReference = eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(`${historyId}_decision`);

    transaction.set(currentReference, authorityDecision);
    transaction.create(historyReference, { ...authorityDecision, decisionId: historyId, current: false });
    transaction.update(eventReference, {
      status: aggregateStatus,
      editableVersionId: aggregateStatus === 'AmendmentRequested' ? `v${event.currentVersionNumber + 1}` : null,
      ...(aggregateStatus === 'AmendmentRequested' ? { draftDocumentPaths: [] } : {}),
      updatedAt: now,
    });
    transaction.create(auditReference, {
      id: auditReference.id,
      eventId,
      versionId,
      action: 'decision_made',
      actorId: uid,
      actorRole: 'authority',
      timestamp: now,
      previousStatus: event.status,
      newStatus: aggregateStatus,
      notes: rationale,
      metadata: { authorityType: profile.authorityType, decision },
    });

    if (aggregateStatus === 'Approved') {
      const details = version.eventDetails;
      const publicEvent: PublicEvent = {
        eventId,
        versionId,
        eventName: details.name,
        venueName: details.venueName,
        eventType: details.type,
        startDatetime: details.startDatetime,
        endDatetime: details.endDatetime,
        approvedBy: event.requiredAuthorities,
        publicStatus: 'approved',
      };
      transaction.set(publicReference, publicEvent);
      const publishAudit = eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(`${versionId}_public_published`);
      transaction.set(publishAudit, {
        id: publishAudit.id, eventId, versionId, action: 'public_published', actorId: 'system', actorRole: 'system', timestamp: now,
        metadata: { approvedBy: event.requiredAuthorities },
      });
    } else {
      transaction.delete(publicReference);
    }

    return { eventId, versionId, decisionId, decision, status: aggregateStatus, idempotent: false };
  });
}

export function assertOfficialAssessmentReady(
  event: Pick<EventRecord, 'eventId' | 'currentAssessmentId' | 'currentResourceId'>,
  versionId: string,
  assessment: AssessmentRecord | undefined,
  resources: ResourceRecommendation | undefined,
  version: EventVersion | undefined,
  resourceHistory: ResourceRecommendation[] = resources ? [resources] : [],
): void {
  const validAssessment = isValidOfficialAssessment(assessment, event.eventId, versionId);
  const validHardRuleFloors = assessment?.status === 'official_ready' && version
    ? assessmentSatisfiesCurrentHardRules(assessment, event.eventId, version)
    : false;
  const officialAssessment = assessment?.status === 'official_ready' ? assessment : undefined;
  const expectedCalculation = officialAssessment && version
    ? computeResources({
        eventId: event.eventId,
        versionId,
        assessmentId: officialAssessment.assessmentId,
        eventDetails: version.eventDetails,
        assessmentResult: officialAssessment.officialResult,
      })
    : undefined;
  const expectedHash = expectedCalculation?.ok ? expectedCalculation.resourceInputHash : undefined;
  const validResources = isValidOfficialResources(
    resources,
    event.eventId,
    versionId,
    expectedHash,
    expectedCalculation?.ok ? expectedCalculation.items : undefined,
  );
  const official = isRecord(assessment) && isRecord(assessment.officialResult) ? assessment.officialResult : undefined;
  const proposal = isRecord(assessment) && isRecord(assessment.aiProposal) ? assessment.aiProposal : undefined;
  const reference = resources?.assessmentReference;
  const boundToAssessment = Boolean(reference?.stage === 'official'
    && reference.assessmentId === assessment?.assessmentId
    && reference.proposalId === proposal?.proposalId
    && reference.finalizedAt === official?.finalizedAt
    && reference.finalizedBy === official?.finalizedBy);
  if (event.currentAssessmentId !== versionId
    || !event.currentResourceId
    || event.currentResourceId !== resources?.resourceId
    || version?.eventId !== event.eventId
    || version?.versionId !== versionId
    || !validAssessment
    || !validHardRuleFloors
    || !validResources
    || validateResourceRevisionChain(resourceHistory, resources?.resourceId ?? '').length > 0
    || !boundToAssessment) {
    throw new HttpsError('failed-precondition', 'An official risk assessment and resources are required before a final decision.');
  }
}

function assessmentSatisfiesCurrentHardRules(
  assessment: Extract<AssessmentRecord, { status: 'official_ready' }>,
  eventId: string,
  version: EventVersion,
): boolean {
  try {
    if (!assessment.contextSnapshot) return false;
    const baseline = computeCategoryBasedAssessment(
      { eventId, eventDetails: version.eventDetails } as EventRecord,
      assessment.contextSnapshot,
      assessment.createdAt,
    );
    const floors = new Map<string, ReturnType<typeof evaluateCategoryHardRules>[number]>(
      evaluateCategoryHardRules(baseline).map((rule) => [rule.categoryId, rule]),
    );
    return validateAssessmentResultAgainstProposal(assessment.provisionalResult, assessment.aiProposal).length === 0
      && validateAssessmentResultAgainstHardRules(assessment.provisionalResult, baseline).length === 0
      && [assessment.provisionalResult, assessment.officialResult].every((result) =>
      result.categories.every((category) => {
        const floor = floors.get(category.categoryId);
        return Boolean(floor
          && category.validatedLikelihood >= floor.likelihoodFloor
          && category.validatedSeverity >= floor.severityFloor);
      }));
  } catch {
    return false;
  }
}

function isValidOfficialAssessment(assessment: AssessmentRecord | undefined, eventId: string, versionId: string): boolean {
  if (!isRecord(assessment)) return false;
  const aiProposal = isRecord(assessment.aiProposal) ? assessment.aiProposal : undefined;
  const provisional = isRecord(assessment.provisionalResult) ? assessment.provisionalResult : undefined;
  const official = isRecord(assessment.officialResult) ? assessment.officialResult : undefined;
  if (assessment.status !== 'official_ready'
    || assessment.schemaVersion !== ASSESSMENT_SCHEMA_VERSION
    || assessment.complianceStatus === 'blocked'
    || assessment.assessmentId !== versionId
    || assessment.eventId !== eventId
    || assessment.versionId !== versionId
    || aiProposal?.status !== 'success'
    || typeof aiProposal.proposalId !== 'string'
    || typeof aiProposal.model !== 'string' || !aiProposal.model.trim()
    || typeof aiProposal.promptVersion !== 'string' || !aiProposal.promptVersion.trim()
    || typeof aiProposal.responseSchemaVersion !== 'string' || !aiProposal.responseSchemaVersion.trim()
    || !['hit', 'miss', 'not-applicable'].includes(String(aiProposal.cacheStatus))
    || !Number.isFinite(aiProposal.generatedAt)
    || !Array.isArray(aiProposal.categories)
    || !Array.isArray(aiProposal.hazards)
    || !Array.isArray(assessment.evidence)
    || provisional?.proposalId !== aiProposal.proposalId
    || official?.proposalId !== aiProposal.proposalId
    || official.formulaVersion !== PROVISIONAL_FORMULA_VERSION
    || official.hardRuleVersion !== HARD_RULE_VERSION
    || official.categorySchemaVersion !== ACTIVE_CATEGORY_SCHEMA.version
    || !Array.isArray(official.validatedHazards)
    || !Number.isFinite(official.finalizedAt)
    || typeof official.finalizedBy !== 'string'
    || !official.finalizedBy.trim()
    || !Array.isArray(official.categories)
    || validateProvisionalAssessmentResult(provisional as unknown as ProvisionalAssessmentResult).length > 0
    || validateProvisionalAssessmentResult(official as unknown as ProvisionalAssessmentResult).length > 0) return false;
  const expectedCategories = new Map<string, number>(
    ACTIVE_CATEGORY_SCHEMA.categories.map((category) => [category.id, category.weight]),
  );
  const seen = new Set<string>();
  const provisionalCategories = new Map(
    (provisional as unknown as ProvisionalAssessmentResult).categories.map((category) => [category.categoryId, category]),
  );
  const proposalCategories = new Map(
    (aiProposal.categories as unknown[])
      .filter(isRecord)
      .map((category) => [category.categoryId, category]),
  );
  if (proposalCategories.size !== expectedCategories.size) return false;
  for (const category of provisionalCategories.values()) {
    const proposed = proposalCategories.get(category.categoryId);
    if (!proposed
      || proposed.likelihood !== category.proposedLikelihood
      || proposed.severity !== category.proposedSeverity
      || proposed.rationale !== category.rationale
      || proposed.confidence !== category.confidence
      || JSON.stringify(proposed.concerns) !== JSON.stringify(category.concerns)
      || JSON.stringify(proposed.missingInformation) !== JSON.stringify(category.missingInformation)
      || !referencesAreSubset(category.evidenceReferences, proposed.evidenceReferences)) return false;
  }
  const proposalHazards = new Map(
    (aiProposal.hazards as unknown[])
      .filter(isRecord)
      .map((hazard) => [hazard.hazardId, hazard]),
  );
  for (const hazard of (provisional as unknown as ProvisionalAssessmentResult).validatedHazards) {
    const proposed = proposalHazards.get(hazard.hazardId);
    if (!proposed
      || proposed.hazardName !== hazard.hazardName
      || proposed.categoryId !== hazard.categoryId
      || proposed.rationale !== hazard.rationale
      || !referencesAreSubset(hazard.evidenceReferences, proposed.evidenceReferences)) return false;
  }
  const eligibleEvidence = new Set((assessment.evidence as unknown[])
    .filter(isRecord)
    .filter((item) => typeof item.key === 'string'
      && typeof item.status === 'string'
      && item.quality !== 'missing'
      && !['unavailable', 'unmatched', 'missing'].includes(item.status.trim().toLowerCase()))
    .map((item) => item.key as string));
  if (eligibleEvidence.size === 0
    || (provisional as unknown as ProvisionalAssessmentResult).categories.some((category) =>
      category.evidenceReferences.some((reference) => !eligibleEvidence.has(reference)))
    || (provisional as unknown as ProvisionalAssessmentResult).validatedHazards.some((hazard) =>
      hazard.evidenceReferences.some((reference) => !eligibleEvidence.has(reference)))) return false;
  if (JSON.stringify(official.validatedHazards) !== JSON.stringify(provisional.validatedHazards)) return false;
  let weightedScore = 0;
  let highestCategoryRiskLevel: RiskLevel = 'Low';
  if (official.categories.length !== expectedCategories.size) return false;
  for (const value of official.categories) {
    if (!isRecord(value) || typeof value.categoryId !== 'string') return false;
    const expectedWeight = expectedCategories.get(value.categoryId);
    const provisionalCategory = provisionalCategories.get(value.categoryId);
    if (expectedWeight === undefined || seen.has(value.categoryId)) return false;
    seen.add(value.categoryId);
    if (!provisionalCategory
      || value.proposedLikelihood !== provisionalCategory.proposedLikelihood
      || value.proposedSeverity !== provisionalCategory.proposedSeverity
      || value.categoryName !== provisionalCategory.categoryName
      || JSON.stringify(value.evidenceReferences) !== JSON.stringify(provisionalCategory.evidenceReferences)
      || value.rationale !== provisionalCategory.rationale
      || value.confidence !== provisionalCategory.confidence
      || JSON.stringify(value.concerns) !== JSON.stringify(provisionalCategory.concerns)
      || JSON.stringify(value.missingInformation) !== JSON.stringify(provisionalCategory.missingInformation)
      || JSON.stringify(value.appliedHardRules) !== JSON.stringify(provisionalCategory.appliedHardRules)
      || JSON.stringify(value.guidelineChecks) !== JSON.stringify(provisionalCategory.guidelineChecks)
      || Number(value.validatedLikelihood) < provisionalCategory.validatedLikelihood
      || Number(value.validatedSeverity) < provisionalCategory.validatedSeverity
      || !isScoreRating(value.validatedLikelihood)
      || !isScoreRating(value.validatedSeverity)
      || value.matrixScore !== value.validatedLikelihood * value.validatedSeverity
      || value.normalizedScore !== value.matrixScore * 4
      || value.weight !== expectedWeight
      || value.weightedContribution !== round(value.normalizedScore * expectedWeight)
      || value.riskLevel !== hirarcRiskLevelFor(value.matrixScore)) return false;
    const categoryRiskLevel = hirarcRiskLevelFor(value.matrixScore);
    weightedScore += value.normalizedScore * expectedWeight;
    highestCategoryRiskLevel = higherRisk(highestCategoryRiskLevel, categoryRiskLevel);
  }
  const overallScore = round(weightedScore);
  const weightedRiskLevel = riskLevelFor(overallScore);
  return official.overallScore === overallScore
    && official.weightedRiskLevel === weightedRiskLevel
    && official.highestCategoryRiskLevel === highestCategoryRiskLevel
    && official.overallRiskLevel === higherRisk(weightedRiskLevel, highestCategoryRiskLevel);
}

function referencesAreSubset(actual: string[], proposed: unknown): boolean {
  return Array.isArray(proposed)
    && proposed.every((reference) => typeof reference === 'string')
    && actual.every((reference) => proposed.includes(reference));
}

function isValidOfficialResources(
  resources: ResourceRecommendation | undefined,
  eventId: string,
  versionId: string,
  expectedHash: string | undefined,
  expectedItems: ResourceRecommendation['items'] | undefined,
): boolean {
  return Boolean(resources
    && expectedHash
    && resources.eventId === eventId
    && resources.versionId === versionId
    && resources.assessmentId === versionId
    && resources.stage === 'official'
    && resources.formulaVersion === RESOURCE_FORMULA_VERSION
    && resources.configVersion === RESOURCE_CONFIG_VERSION
    && resources.sourceRegistryVersion === RESOURCE_SOURCE_REGISTRY_VERSION
    && resources.resourceInputHash === expectedHash
    && expectedItems
    && matchesDeterministicResourceItems(resources.items, expectedItems)
    && validateResourceRecommendation(resources).ok);
}

function isScoreRating(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function higherRisk(left: RiskLevel, right: RiskLevel): RiskLevel {
  const order: Record<RiskLevel, number> = { Low: 0, Medium: 1, High: 2 };
  return order[left] >= order[right] ? left : right;
}

export function validateDecisionRequest(request: unknown): { eventId: string; decision: DecisionValue; rationale: string } {
  const value = typeof request === 'object' && request !== null ? request as Record<string, unknown> : {};
  const eventId = typeof value.eventId === 'string' ? value.eventId.trim() : '';
  const decision = value.decision;
  const rationale = typeof value.rationale === 'string' ? value.rationale.trim() : '';
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!isDecision(decision)) throw new HttpsError('invalid-argument', 'A valid decision is required.');
  if (rationale.length < 10 || rationale.length > 1_000) {
    throw new HttpsError('invalid-argument', 'Rationale must be between 10 and 1,000 characters.');
  }
  return { eventId, decision, rationale };
}

export function aggregateDecisionStatus(
  requiredAuthorities: AuthorityType[],
  decisions: ReadonlyMap<AuthorityType, DecisionValue>,
): EventRecord['status'] {
  if (requiredAuthorities.some((authority) => decisions.get(authority) === 'Rejected')) return 'Rejected';
  if (requiredAuthorities.some((authority) => decisions.get(authority) === 'AmendmentRequested')) return 'AmendmentRequested';
  if (requiredAuthorities.length > 0 && requiredAuthorities.every((authority) => decisions.get(authority) === 'Approved')) return 'Approved';
  return 'UnderReview';
}

function currentDecisionId(versionId: string, authorityType: AuthorityType): string {
  return `${versionId}_${authorityType}`;
}

function isDecision(value: unknown): value is DecisionValue {
  return value === 'Approved' || value === 'Rejected' || value === 'AmendmentRequested';
}
