import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  COLLECTIONS,
  EVENT_STATUSES,
  EVENT_TYPES,
  OFFICIAL_FORMULA_VERSION,
  REJECTION_REASON_CATEGORIES,
  RESOURCE_KEYS,
  RESOURCE_OVERRIDE_REASON_CATEGORIES,
  type Assignment,
  type AuthorityDecision,
  type AISuccessfulProposal,
  type AuthorityType,
  type EventControl,
  type EventRecord,
  type EventStatus,
  type EventType,
  type EventVersion,
  type Incident,
  type ManualOfficialAssessmentResult,
  type OfficialAssessmentResult,
  type RejectionReasonCategory,
  type ResourceKey,
  type ResourceOverrideReasonCategory,
  type ResourceOverrideRecord,
  type ResourceRecommendation,
  type RiskAssessment,
  type RiskLevel,
  type Stage1Doc,
  type UserProfile,
} from '@shared/types';
import { M4_SCHEMA_VERSION, type M4IncidentRecord } from '@shared/m4';
import {
  ANALYTICS_METRIC_DEFINITION_VERSION,
  ANALYTICS_SCHEMA_VERSION,
  type AnalyticsAssessmentSummary,
  type AnalyticsControlSummary,
  type AnalyticsIncidentSummary,
  type AnalyticsPortfolioRecord,
  type AnalyticsPortfolioRequest,
  type AnalyticsPortfolioResponse,
  type AnalyticsResourceSummary,
} from '@shared/analytics';
import { FUNCTION_REGION } from '../config/runtime';
import { ACTIVE_CATEGORY_SCHEMA } from '../config/categorySchema';
import { validateResourceRecommendation } from '../engines/resourceContract';
import {
  validateAssessmentResultAgainstProposal,
  validateManualOfficialAssessmentResult,
  validateProvisionalAssessmentResult,
} from '../engines/resourceCalculator';

const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 500;
const MAX_FETCH = 1_000;
const MAX_RANGE_MS = 5 * 366 * 24 * 60 * 60 * 1_000;
const MAX_FILTER_VALUES = 25;
const OVERRIDE_LIMIT = 200;
const INCIDENT_LIMIT = 200;
const CONTROL_LIMIT = 500;
const DECISION_LIMIT = 500;
const ASSIGNMENT_LIMIT = 100;
const REVIEW_DECISION_LIMIT = 500;
const STAGE1_DOC_LIMIT = 100;
const EVENT_TYPE_VALUES = new Set(EVENT_TYPES.map((item) => item.value));
const EVENT_STATUS_VALUES = new Set(EVENT_STATUSES.map((item) => item.value));
const RISK_LEVEL_VALUES = new Set<RiskLevel>(['Low', 'Medium', 'High']);
const AUTHORITY_VALUES = new Set<AuthorityType>(['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC']);

interface AnalyticsSourceBundle {
  event: EventRecord & Record<string, unknown>;
  assessment?: RiskAssessment;
  resource?: ResourceRecommendation;
  overrides: ResourceOverrideRecord[];
  incidents: Array<Incident | M4IncidentRecord>;
  controls: EventControl[];
  stage1Docs: Stage1Doc[];
  currentVersion?: EventVersion;
  assignments?: Assignment[];
  reviewDecisions?: AnalyticsReviewDecision[];
  decisionHistory: AuthorityDecision[];
  incidentCoverageAvailable: boolean;
  includeSynthetic: boolean;
  sourceCoverage: AnalyticsPortfolioRecord['sourceCoverage'];
}

interface AnalyticsReviewDecision {
  versionId: string;
  reviewStage: 'initial' | 'second';
  decision: 'Approved' | 'Rejected';
  rejectionReasonCategory?: RejectionReasonCategory;
}

export const getAnalyticsPortfolio = onCall<AnalyticsPortfolioRequest | undefined>(
  { region: FUNCTION_REGION, timeoutSeconds: 60, memory: '512MiB' },
  async (request): Promise<AnalyticsPortfolioResponse> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to view analytics.');
    const db = firestore();
    const profileSnapshot = await db.collection(COLLECTIONS.USERS).doc(request.auth.uid).get();
    assertAnalyticsAdmin(profileSnapshot.data() as UserProfile | undefined);

    const input = validateAnalyticsPortfolioRequest(request.data);
    const fetchLimit = Math.min(MAX_FETCH, Math.max(input.limit * 2, DEFAULT_LIMIT));
    let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.EVENTS).orderBy('createdAt', 'desc');
    if (input.from !== undefined) query = query.where('createdAt', '>=', input.from);
    if (input.to !== undefined) query = query.where('createdAt', '<=', input.to);

    const eventSnapshot = await query.limit(fetchLimit).get();
    const eventCandidates = eventSnapshot.docs
      .map((snapshot) => canonicalEventDocument(snapshot.id, snapshot.data()))
      .filter((event) => eventMatchesBaseFilters(event, input));

    const records = await mapWithConcurrency(eventCandidates, 10, async (event) => {
      const eventReference = db.collection(COLLECTIONS.EVENTS).doc(event.eventId);
      const assessmentReference = safeDocumentId(event.currentAssessmentId)
        ? eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId)
        : undefined;
      const resourceReference = safeDocumentId(event.currentResourceId)
        ? eventReference.collection(COLLECTIONS.RESOURCES).doc(event.currentResourceId)
        : undefined;
      const versionReference = safeDocumentId(event.currentVersionId)
        ? eventReference.collection(COLLECTIONS.VERSIONS).doc(event.currentVersionId)
        : undefined;
      const [assessmentSnapshot, resourceSnapshot, versionSnapshot, overrideSnapshot, incidentSnapshot, controlSnapshot, decisionHistorySnapshot, assignmentSnapshot, reviewDecisionSnapshot] = await Promise.all([
        assessmentReference?.get(),
        resourceReference?.get(),
        versionReference?.get(),
        eventReference.collection(COLLECTIONS.RESOURCE_OVERRIDES).limit(OVERRIDE_LIMIT + 1).get(),
        db.collection(COLLECTIONS.INCIDENTS).where('eventId', '==', event.eventId).limit(INCIDENT_LIMIT + 1).get(),
        eventReference.collection(COLLECTIONS.EVENT_CONTROLS).limit(CONTROL_LIMIT + 1).get(),
        eventReference.collection(COLLECTIONS.DECISION_HISTORY).limit(DECISION_LIMIT + 1).get(),
        eventReference.collection(COLLECTIONS.ASSIGNMENTS).limit(ASSIGNMENT_LIMIT + 1).get(),
        eventReference.collection(COLLECTIONS.AUDIT_LOGS).where('action', '==', 'decision_made').limit(REVIEW_DECISION_LIMIT + 1).get(),
      ]);
      const currentControls = controlSnapshot.docs.slice(0, CONTROL_LIMIT)
        .map((document) => canonicalControlDocument(document.id, document.data())).filter(isAnalyticsControl)
        .filter((control) => control.versionId === event.currentVersionId);
      const stage1Snapshots = await mapWithConcurrency(currentControls, 10, (control) => eventReference
        .collection(COLLECTIONS.EVENT_CONTROLS).doc(control.controlId)
        .collection(COLLECTIONS.STAGE1_DOCS).limit(STAGE1_DOC_LIMIT + 1).get());
      const stage1Truncated = stage1Snapshots.some((snapshot) => snapshot.size > STAGE1_DOC_LIMIT);
      const stage1DocsByControl = stage1Snapshots.map((snapshot) => snapshot.docs.slice(0, STAGE1_DOC_LIMIT)
        .map((document) => canonicalStage1Document(document.id, document.data())));
      const rawStage1Docs = stage1DocsByControl.flat();
      const persistedStage1Docs = rawStage1Docs.filter(isAnalyticsStage1Doc);
      const pendingStage1Docs: Stage1Doc[] = currentControls.flatMap((control, controlIndex) => {
        const submitted = stage1DocsByControl[controlIndex].filter(isAnalyticsStage1Doc);
        return deriveMissingStage1Docs(control, submitted);
      });
      const stage1Docs = [...persistedStage1Docs, ...pendingStage1Docs];
      const rawOverrides = overrideSnapshot.docs.slice(0, OVERRIDE_LIMIT)
        .map((document) => ({ ...document.data(), overrideId: document.id }));
      const rawIncidents = incidentSnapshot.docs.slice(0, INCIDENT_LIMIT)
        .map((document) => ({ ...document.data(), incidentId: document.id }));
      const rawDecisions = decisionHistorySnapshot.docs.slice(0, DECISION_LIMIT).map((document) => document.data());
      const rawAssignments = assignmentSnapshot.docs.slice(0, ASSIGNMENT_LIMIT)
        .map((document) => ({ ...document.data(), assignmentId: document.id }));
      const rawReviewDecisions = reviewDecisionSnapshot.docs.slice(0, REVIEW_DECISION_LIMIT)
        .map((document) => document.data()).filter(isRelevantAdminReviewAudit);
      const rawCurrentControls = controlSnapshot.docs.slice(0, CONTROL_LIMIT)
        .map((document) => canonicalControlDocument(document.id, document.data()))
        .filter((control) => isRecord(control) && control.versionId === event.currentVersionId);
      const coverage = (truncated: boolean, rawCount: number, validCount: number) => truncated
        ? 'truncated' as const : rawCount === validCount ? 'complete' as const : 'unavailable' as const;
      const assessmentValue = assessmentSnapshot?.data();
      const resourceValue = resourceSnapshot?.data();
      const validOverrides = rawOverrides.filter(isAnalyticsOverride);
      const validIncidents = selectValidAnalyticsIncidents(rawIncidents);
      const validDecisions = rawDecisions.filter(isAnalyticsDecision);
      const validAssignments = rawAssignments.filter(isAnalyticsAssignment);
      const validReviewDecisions = rawReviewDecisions.map(parseAnalyticsReviewDecision).filter((value): value is AnalyticsReviewDecision => Boolean(value));
      const currentVersion = isAnalyticsEventVersion(versionSnapshot?.data(), event) ? versionSnapshot?.data() as EventVersion : undefined;
      const sourceCoverage: AnalyticsPortfolioRecord['sourceCoverage'] = {
        overrides: coverage(overrideSnapshot.size > OVERRIDE_LIMIT, rawOverrides.length, validOverrides.length),
        incidents: coverage(incidentSnapshot.size > INCIDENT_LIMIT, rawIncidents.length, rawIncidents.filter(isAnalyticsIncident).length),
        controls: coverage(controlSnapshot.size > CONTROL_LIMIT, rawCurrentControls.length, currentControls.length),
        decisionHistory: coverage(decisionHistorySnapshot.size > DECISION_LIMIT, rawDecisions.length, validDecisions.length),
        assignments: coverage(assignmentSnapshot.size > ASSIGNMENT_LIMIT, rawAssignments.length, validAssignments.length),
        reviewDecisions: coverage(reviewDecisionSnapshot.size > REVIEW_DECISION_LIMIT, rawReviewDecisions.length, validReviewDecisions.length),
        currentVersion: currentVersion ? 'complete' : 'unavailable',
        stage1Documents: coverage(controlSnapshot.size > CONTROL_LIMIT || stage1Truncated, rawStage1Docs.length, persistedStage1Docs.length),
      };
      const assessment = isAnalyticsAssessment(assessmentValue)
        && assessmentMatchesCurrentEvent(assessmentValue, event) ? assessmentValue : undefined;
      const resource = isAnalyticsResource(resourceValue)
        && resourceMatchesCurrentEvent(resourceValue, event) ? resourceValue : undefined;
      return buildAnalyticsPortfolioRecord({
        event,
        assessment,
        resource,
        overrides: validOverrides,
        incidents: validIncidents,
        controls: currentControls,
        stage1Docs,
        ...(currentVersion ? { currentVersion } : {}),
        assignments: validAssignments,
        reviewDecisions: validReviewDecisions,
        decisionHistory: validDecisions,
        incidentCoverageAvailable: sourceCoverage.incidents !== 'unavailable',
        includeSynthetic: input.includeSynthetic,
        sourceCoverage,
      });
    });

    const filteredByAnalytics = records.filter((record) => {
      if (input.riskLevels?.length && (!record.assessment?.officialRiskLevel
        || !input.riskLevels.includes(record.assessment.officialRiskLevel))) return false;
      if (input.assessmentSchemaVersions?.length && (!record.assessment?.schemaVersion
        || !input.assessmentSchemaVersions.includes(record.assessment.schemaVersion))) return false;
      return true;
    });
    const syntheticExcluded = input.includeSynthetic ? 0 : filteredByAnalytics.filter((record) => record.synthetic).length;
    const operationalRecords = filteredByAnalytics.filter((record) => input.includeSynthetic || !record.synthetic);
    const selected = operationalRecords.slice(0, input.limit);
    const unavailableSections: string[] = [];
    if (!selected.some((record) => record.assessment)) unavailableSections.push('Risk assessments');
    if (!selected.some((record) => record.incidents.available)) unavailableSections.push('Incident patterns');
    if (!selected.some((record) => record.resources)) unavailableSections.push('Resource recommendations');
    if (!selected.some((record) => record.controls.available)) unavailableSections.push('Event-control verification');

    const generatedAt = Date.now();
    const childCollectionsTruncated = selected.some((record) => Object.values(record.sourceCoverage).includes('truncated'));
    const childCollectionsUnavailable = selected.some((record) => Object.values(record.sourceCoverage).includes('unavailable'));
    const eventScanTruncated = eventSnapshot.size === fetchLimit;
    const limitations = [
      ...(eventScanTruncated ? ['Event scan reached the server cap; totalMatched is a lower bound.'] : []),
      ...(childCollectionsTruncated ? ['One or more child collections reached a server cap; affected record metrics are incomplete.'] : []),
      ...(childCollectionsUnavailable ? ['Malformed child records were excluded; affected record metrics are unavailable.'] : []),
    ];
    return {
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      metricDefinitionVersion: ANALYTICS_METRIC_DEFINITION_VERSION,
      generatedAt,
      sourceCutoff: generatedAt,
      records: selected,
      totalMatched: operationalRecords.length,
      syntheticExcluded,
      truncated: eventScanTruncated || childCollectionsTruncated || operationalRecords.length > input.limit,
      unavailableSections,
      coverage: {
        eventScan: eventScanTruncated ? 'truncated' : 'complete',
        childCollections: childCollectionsTruncated ? 'truncated' : childCollectionsUnavailable ? 'unavailable' : 'complete',
        totalMatchedExact: !eventScanTruncated,
        limitations,
      },
    };
  },
);

export function assertAnalyticsAdmin(profile: UserProfile | undefined): void {
  if (!profile || profile.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only administrators can view cross-agency analytics.');
  }
}

export function canonicalEventDocument(
  documentId: string,
  data: FirebaseFirestore.DocumentData,
): EventRecord & Record<string, unknown> {
  return { ...data, eventId: documentId } as EventRecord & Record<string, unknown>;
}

export function canonicalControlDocument(
  documentId: string,
  data: FirebaseFirestore.DocumentData,
): FirebaseFirestore.DocumentData & { controlId: string } {
  return { ...data, controlId: documentId };
}

export function canonicalStage1Document(
  documentId: string,
  data: FirebaseFirestore.DocumentData,
): FirebaseFirestore.DocumentData & { docId: string } {
  return { ...data, docId: documentId };
}

export function validateAnalyticsPortfolioRequest(value: unknown): Required<Pick<AnalyticsPortfolioRequest, 'includeSynthetic' | 'limit'>> & AnalyticsPortfolioRequest {
  const record = isRecord(value) ? value : {};
  const from = optionalTimestamp(record.from, 'from');
  const to = optionalTimestamp(record.to, 'to');
  if (from !== undefined && to !== undefined && from > to) {
    throw new HttpsError('invalid-argument', 'from must be earlier than or equal to to.');
  }
  if (from !== undefined && to !== undefined && to - from > MAX_RANGE_MS) {
    throw new HttpsError('invalid-argument', 'Analytics date range cannot exceed five years.');
  }
  const limit = record.limit === undefined ? DEFAULT_LIMIT : Number(record.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new HttpsError('invalid-argument', `limit must be an integer from 1 to ${MAX_LIMIT}.`);
  }
  return {
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    eventTypes: optionalEnumArray(record.eventTypes, EVENT_TYPE_VALUES, 'eventTypes') as EventType[] | undefined,
    statuses: optionalEnumArray(record.statuses, EVENT_STATUS_VALUES, 'statuses') as EventStatus[] | undefined,
    venueIds: optionalIdentifierArray(record.venueIds, 'venueIds'),
    riskLevels: optionalEnumArray(record.riskLevels, RISK_LEVEL_VALUES, 'riskLevels') as RiskLevel[] | undefined,
    authorityTypes: optionalEnumArray(record.authorityTypes, AUTHORITY_VALUES, 'authorityTypes') as AuthorityType[] | undefined,
    assessmentSchemaVersions: optionalIdentifierArray(record.assessmentSchemaVersions, 'assessmentSchemaVersions'),
    includeSynthetic: record.includeSynthetic === true,
    limit,
  };
}

export function buildAnalyticsPortfolioRecord(bundle: AnalyticsSourceBundle): AnalyticsPortfolioRecord {
  const { event, assessment, resource, overrides, controls, stage1Docs, assignments = [], reviewDecisions = [], currentVersion, decisionHistory } = bundle;
  const incidents = bundle.incidents.filter((incident) => bundle.includeSynthetic || incident.synthetic !== true);
  const synthetic = event.synthetic === true || isRecord(event.m3Uat)
    || Boolean(assessment?.contextEvidence?.length && assessment.contextEvidence.every((item) => item.synthetic));
  const priorRejectedVersion = decisionHistory.some((decision) => decision.decision === 'Rejected'
    && decision.versionId !== event.currentVersionId)
    || assignments.some((assignment) => assignment.decision === 'Rejected' && assignment.versionId !== event.currentVersionId)
    || reviewDecisions.some((review) => review.decision === 'Rejected' && review.versionId !== event.currentVersionId);
  const currentAssignments = assignments.filter((assignment) => assignment.versionId === event.currentVersionId);
  const rejections = buildRejectionSummaries(event, assignments, reviewDecisions);
  const rejectionTaxonomyAvailable = bundle.sourceCoverage.assignments !== 'unavailable'
    && bundle.sourceCoverage.reviewDecisions !== 'unavailable'
    && rejectedSourcesHaveTaxonomy(event, currentAssignments, reviewDecisions);
  const lifecycle = buildLifecycleSummary(event);
  const terminalDecisionAt = lifecycle.secondReviewAt
    ?? (event.status === 'Rejected' && event.initialReview?.decision === 'Rejected' ? lifecycle.initialReviewAt : undefined);
  return {
    eventId: event.eventId,
    eventName: event.eventDetails.name,
    eventType: event.eventDetails.type,
    ...(event.eventDetails.venueId ? { venueId: event.eventDetails.venueId } : {}),
    venueName: event.eventDetails.venueName,
    status: event.status,
    requiredAuthorities: [...event.requiredAuthorities],
    currentVersionNumber: event.currentVersionNumber,
    createdAt: event.createdAt,
    ...(event.submittedAt ? { submittedAt: event.submittedAt } : {}),
    ...(terminalDecisionAt !== undefined ? { terminalDecisionAt } : {}),
    updatedAt: event.updatedAt,
    lifecycle,
    sourceCoverage: bundle.sourceCoverage,
    synthetic,
    reapplication: event.currentVersionNumber >= 2 && priorRejectedVersion,
    revisionOutcome: event.currentVersionNumber === 1
      ? 'initial_submission'
      : event.currentVersionNumber === 0
        ? 'unavailable'
      : currentVersion?.revisionSource?.kind === 'rejected_revision' || priorRejectedVersion
        ? 'resubmitted_after_rejection'
        : currentVersion?.revisionSource?.kind === 'pending_edit'
          ? 'revised_without_recorded_rejection'
          : 'unavailable',
    rejectionTaxonomyAvailable,
    rejections,
    ...(assessment ? { assessment: buildAssessmentSummary(assessment) } : {}),
    ...(resource ? { resources: buildResourceSummary(resource, overrides, bundle.sourceCoverage.overrides) } : {}),
    incidents: buildIncidentSummary(incidents, bundle.incidentCoverageAvailable),
    controls: buildControlSummary(
      controls,
      stage1Docs,
      Boolean(event.controlListGenerated),
      bundle.sourceCoverage.controls,
      bundle.sourceCoverage.stage1Documents,
    ),
  };
}

export function deriveMissingStage1Docs(control: EventControl, submitted: Stage1Doc[]): Stage1Doc[] {
  const remaining = [...submitted];
  return control.stage1Requirements.flatMap((requirement, requirementIndex) => {
    const matchIndex = remaining.findIndex((document) => document.docType === requirement.docType
      && document.label === requirement.label);
    if (matchIndex >= 0) {
      remaining.splice(matchIndex, 1);
      return [];
    }
    if (!requirement.required) return [];
    return [{
      docId: `pending-${control.controlId}-${requirementIndex}`,
      docType: requirement.docType,
      label: requirement.label,
      status: 'pending_submission' as const,
    }];
  });
}

function buildAssessmentSummary(assessment: RiskAssessment): AnalyticsAssessmentSummary {
  const result = assessment.status === 'official_ready' && isAnalyticsOfficialResult(assessment.officialResult)
    ? assessment.officialResult
    : undefined;
  const categories = result?.categories ?? [];
  const hazards = result
    ? ('manualHazards' in result ? result.manualHazards : result.validatedHazards)
    : [];
  const dominant = [...categories].sort((left, right) => right.normalizedScore - left.normalizedScore)[0];
  const comparable = assessment.aiProposal?.status === 'success'
    && categories.length > 0
    && categories.every((category) => 'proposedLikelihood' in category && 'proposedSeverity' in category);
  const aiAgreement = comparable
    ? categories.every((category) => 'proposedLikelihood' in category
      && category.proposedLikelihood === category.validatedLikelihood
      && category.proposedSeverity === category.validatedSeverity)
    : undefined;
  return {
    status: assessment.status,
    ...(result ? { officialScore: result.overallScore, officialRiskLevel: result.overallRiskLevel } : {}),
    readiness: assessment.assessmentReadiness,
    compliance: assessment.complianceStatus,
    confidence: assessment.dataConfidenceLevel,
    ...(dominant ? { dominantHazard: dominant.categoryId as AnalyticsAssessmentSummary['dominantHazard'] } : {}),
    identifiedHazardCategories: hazards.map((hazard) => hazard.categoryId),
    schemaVersion: assessment.schemaVersion,
    ...(result?.categorySchemaVersion ? { categorySchemaVersion: result.categorySchemaVersion } : {}),
    ...(result?.formulaVersion ? { formulaVersion: result.formulaVersion } : {}),
    ...(result?.hardRuleVersion ? { hardRuleVersion: result.hardRuleVersion } : {}),
    aiStatus: assessment.aiProposal?.status ?? 'not_attempted',
    ...(aiAgreement !== undefined ? { aiAgreement } : {}),
    hardRuleAdjustments: categories.reduce((sum, category) => sum + category.appliedHardRules.length, 0),
    manualReview: assessment.status === 'manual_review_required'
      || (assessment.status === 'official_ready' && 'sourceKind' in assessment && assessment.sourceKind === 'admin_manual'),
  };
}

function buildResourceSummary(
  resource: ResourceRecommendation,
  overrides: ResourceOverrideRecord[],
  overrideCoverage: AnalyticsPortfolioRecord['sourceCoverage']['overrides'],
): AnalyticsResourceSummary {
  const validOverrides = overrides
    .filter((override) => override.baseResourceId === resource.resourceId
      && override.eventId === resource.eventId && override.versionId === resource.versionId
      && override.assessmentId === resource.assessmentId && Number.isFinite(override.overriddenAt))
    .sort((left, right) => left.overriddenAt - right.overriddenAt);
  const latest = validOverrides.at(-1);
  const overrideReasonCategories: Partial<Record<ResourceOverrideReasonCategory, number>> = {};
  for (const override of validOverrides) {
    const category = override.overrideReasonCategory;
    if (!category) continue;
    overrideReasonCategories[category] = (overrideReasonCategories[category] ?? 0) + 1;
  }
  const items = Object.fromEntries(RESOURCE_KEYS.map((key) => {
    const item = resource.items[key];
    if (!item) return [key, undefined];
    const itemOverrides = validOverrides.filter((override) => override.previousQuantities[key] !== override.quantities[key]);
    const itemReasonCategories: Partial<Record<ResourceOverrideReasonCategory, number>> = {};
    for (const override of itemOverrides) {
      const category = override.overrideReasonCategory;
      if (!category) continue;
      itemReasonCategories[category] = (itemReasonCategories[category] ?? 0) + 1;
    }
    return [key, {
      baseline: item.baseline,
      minimum: item.planningRange.min,
      maximum: item.planningRange.max,
      ...(overrideCoverage === 'complete' ? { effective: latest?.quantities[key] ?? item.baseline } : {}),
      overrideCount: itemOverrides.length,
      overrideReasonCategories: itemReasonCategories,
    }];
  }).filter((entry) => entry[1] !== undefined)) as Partial<Record<ResourceKey, AnalyticsResourceSummary['items'][ResourceKey]>>;
  return {
    schemaVersion: resource.schemaVersion,
    formulaVersion: resource.formulaVersion,
    items,
    overrideCount: validOverrides.length,
    overrideReasonCategoriesAvailable: overrideCoverage === 'complete',
    overrideReasonCategories,
  };
}

function buildRejectionSummaries(event: EventRecord, assignments: Assignment[], reviews: AnalyticsReviewDecision[]): AnalyticsPortfolioRecord['rejections'] {
  const summaries: AnalyticsPortfolioRecord['rejections'] = [];
  const hasCurrentInitialAudit = reviews.some((review) => review.versionId === event.currentVersionId && review.reviewStage === 'initial');
  const hasCurrentSecondAudit = reviews.some((review) => review.versionId === event.currentVersionId && review.reviewStage === 'second');
  for (const review of reviews) {
    if (review.decision === 'Rejected' && review.rejectionReasonCategory) {
      summaries.push({ reasonCategory: review.rejectionReasonCategory, reviewStage: review.reviewStage });
    }
  }
  if (!hasCurrentInitialAudit && event.initialReview?.decision === 'Rejected' && isRejectionReasonCategory(event.initialReview.rejectionReasonCategory)) {
    summaries.push({ reasonCategory: event.initialReview.rejectionReasonCategory, reviewStage: 'initial' });
  }
  for (const assignment of assignments) {
    if (assignment.decision === 'Rejected' && isRejectionReasonCategory(assignment.rejectionReasonCategory)) {
      summaries.push({ reasonCategory: assignment.rejectionReasonCategory, reviewStage: 'authority' });
    }
  }
  if (!hasCurrentSecondAudit && event.secondReview?.confirmedDecision === 'Rejected' && isRejectionReasonCategory(event.secondReview.rejectionReasonCategory)) {
    summaries.push({ reasonCategory: event.secondReview.rejectionReasonCategory, reviewStage: 'second' });
  }
  return summaries;
}

function rejectedSourcesHaveTaxonomy(event: EventRecord, assignments: Assignment[], reviews: AnalyticsReviewDecision[]): boolean {
  const hasCurrentInitialAudit = reviews.some((review) => review.versionId === event.currentVersionId && review.reviewStage === 'initial');
  const hasCurrentSecondAudit = reviews.some((review) => review.versionId === event.currentVersionId && review.reviewStage === 'second');
  if (!hasCurrentInitialAudit && event.initialReview?.decision === 'Rejected' && !isRejectionReasonCategory(event.initialReview.rejectionReasonCategory)) return false;
  if (!hasCurrentSecondAudit && event.secondReview?.confirmedDecision === 'Rejected' && !isRejectionReasonCategory(event.secondReview.rejectionReasonCategory)) return false;
  return assignments.every((assignment) => assignment.decision !== 'Rejected'
    || isRejectionReasonCategory(assignment.rejectionReasonCategory));
}

function isRelevantAdminReviewAudit(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.metadata)) return false;
  return value.action === 'decision_made' && ['initial', 'second'].includes(String(value.metadata.reviewStage));
}

function parseAnalyticsReviewDecision(value: unknown): AnalyticsReviewDecision | undefined {
  if (!isRecord(value) || !safeDocumentId(value.versionId) || !isRecord(value.metadata)) return undefined;
  const reviewStage = value.metadata.reviewStage;
  const decision = reviewStage === 'initial' ? value.metadata.decision : value.metadata.finalDecision;
  if (!['initial', 'second'].includes(String(reviewStage)) || !['Approved', 'Rejected'].includes(String(decision))) return undefined;
  const rejectionReasonCategory = value.metadata.rejectionReasonCategory;
  if (decision === 'Rejected' && !isRejectionReasonCategory(rejectionReasonCategory)) return undefined;
  return {
    versionId: value.versionId,
    reviewStage: reviewStage as AnalyticsReviewDecision['reviewStage'],
    decision: decision as AnalyticsReviewDecision['decision'],
    ...(decision === 'Rejected' ? { rejectionReasonCategory: rejectionReasonCategory as RejectionReasonCategory } : {}),
  };
}

function isRejectionReasonCategory(value: unknown): value is RejectionReasonCategory {
  return REJECTION_REASON_CATEGORIES.includes(value as RejectionReasonCategory);
}

function buildIncidentSummary(incidents: Array<Incident | M4IncidentRecord>, available: boolean): AnalyticsIncidentSummary {
  const bySeverity = { low: 0, medium: 0, high: 0 };
  const byStatus = { verified: 0, under_review: 0, rejected: 0, unknown: 0 };
  incidents.forEach((incident) => {
    if (incident.severity) bySeverity[incident.severity] += 1;
    if (isM4AnalyticsIncident(incident)) {
      if (incident.status === 'resolved' && incident.discrepancyOutcome === 'dismissed_fake') byStatus.rejected += 1;
      else if (incident.status === 'resolved') byStatus.verified += 1;
      else byStatus.under_review += 1;
    } else {
      byStatus[incident.status === 'resolved' ? 'verified' : incident.status ?? 'unknown'] += 1;
    }
  });
  const allM4 = incidents.every(isM4AnalyticsIncident);
  const immediateAvailable = available && allM4
    && incidents.every((incident) => typeof incident.immediateActionRequired === 'boolean');
  return {
    available,
    total: incidents.length,
    verified: byStatus.verified,
    severityAvailable: available && incidents.every((incident) => Boolean(incident.severity)),
    bySeverity,
    byStatus,
    immediateActionRequired: immediateAvailable
      ? { available: true, count: incidents.filter((incident) => incident.immediateActionRequired === true).length }
      : { available: false },
    externalEscalations: available && allM4
      ? { available: true, count: incidents.filter((incident) => Boolean(incident.referredAuthorityId)).length }
      : { available: false },
  };
}

function buildControlSummary(
  controls: EventControl[],
  stage1Docs: Stage1Doc[],
  declaredAvailable: boolean,
  controlCoverage: AnalyticsPortfolioRecord['sourceCoverage']['controls'],
  stage1Coverage: AnalyticsPortfolioRecord['sourceCoverage']['stage1Documents'],
): AnalyticsControlSummary {
  const summary: AnalyticsControlSummary = {
    available: controlCoverage !== 'unavailable' && (declaredAvailable || controls.length > 0),
    total: controls.length,
    approved: 0,
    pending: 0,
    reportedUnderReview: 0,
    resubmitRequired: 0,
    usePrevious: 0,
    stage1: {
      available: controlCoverage === 'complete' && stage1Coverage === 'complete' && declaredAvailable,
      total: stage1Docs.length,
      pendingSubmission: 0,
      pendingVerification: 0,
      verified: 0,
      rejected: 0,
      usePrevious: 0,
    },
  };
  controls.forEach((control) => {
    if (control.label === 'approved') summary.approved += 1;
    if (control.label === 'pending') summary.pending += 1;
    if (control.label === 'reported_under_review') summary.reportedUnderReview += 1;
    if (control.label === 'resubmit_required') summary.resubmitRequired += 1;
    if (control.usePreviousSourceEventId) summary.usePrevious += 1;
  });
  stage1Docs.forEach((document) => {
    if (document.status === 'pending_submission') summary.stage1.pendingSubmission += 1;
    if (document.status === 'pending_verification') summary.stage1.pendingVerification += 1;
    if (document.status === 'verified') summary.stage1.verified += 1;
    if (document.status === 'rejected') summary.stage1.rejected += 1;
    if (document.status === 'use_previous') summary.stage1.usePrevious += 1;
  });
  return summary;
}

function buildLifecycleSummary(event: EventRecord & Record<string, unknown>): AnalyticsPortfolioRecord['lifecycle'] {
  const initialReviewAt = isRecord(event.initialReview) && validTimestamp(event.initialReview.reviewedAt)
    ? event.initialReview.reviewedAt : undefined;
  const authorityReviewAt = validTimestamp(event.authorityReviewCompletedAt)
    && event.authorityReviewCompletedVersionId === event.currentVersionId
    ? event.authorityReviewCompletedAt : undefined;
  const secondReviewAt = ['Approved', 'Rejected'].includes(event.status) && isRecord(event.secondReview)
    && event.secondReview.confirmedDecision === event.status && validTimestamp(event.secondReview.decidedAt)
    ? event.secondReview.decidedAt : undefined;
  const terminalAt = secondReviewAt
    ?? (event.status === 'Rejected' && isRecord(event.initialReview)
      && event.initialReview.decision === 'Rejected' ? initialReviewAt : undefined);
  return {
    ...(initialReviewAt !== undefined ? { initialReviewAt } : {}),
    ...(authorityReviewAt !== undefined ? { authorityReviewAt } : {}),
    ...(secondReviewAt !== undefined ? { secondReviewAt } : {}),
    ...duration('submissionToInitialReviewMs', event.submittedAt, initialReviewAt),
    ...duration('initialToAuthorityReviewMs', initialReviewAt, authorityReviewAt),
    ...duration('authorityToSecondReviewMs', authorityReviewAt, secondReviewAt),
    ...duration('submissionToTerminalDecisionMs', event.submittedAt, terminalAt),
  };
}

function duration<K extends keyof AnalyticsPortfolioRecord['lifecycle']>(key: K, from: unknown, to: unknown): Partial<AnalyticsPortfolioRecord['lifecycle']> {
  if (!validTimestamp(from) || !validTimestamp(to) || to < from) return {};
  return { [key]: to - from } as Partial<AnalyticsPortfolioRecord['lifecycle']>;
}

function eventMatchesBaseFilters(event: EventRecord, input: AnalyticsPortfolioRequest): boolean {
  if (!isAnalyticsEvent(event)) return false;
  if (input.eventTypes?.length && !input.eventTypes.includes(event.eventDetails.type)) return false;
  if (input.statuses?.length && !input.statuses.includes(event.status)) return false;
  if (input.venueIds?.length && (!event.eventDetails.venueId || !input.venueIds.includes(event.eventDetails.venueId))) return false;
  if (input.authorityTypes?.length && !event.requiredAuthorities.some((authority) => input.authorityTypes?.includes(authority))) return false;
  return Number.isFinite(event.createdAt) && Number.isFinite(event.updatedAt);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function optionalTimestamp(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isFinite(value) || Number(value) < 0) throw new HttpsError('invalid-argument', `${field} must be a valid timestamp.`);
  return Number(value);
}

function optionalEnumArray<T extends string>(value: unknown, allowed: Set<T>, field: string): T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_FILTER_VALUES || !value.every((item) => typeof item === 'string' && allowed.has(item as T))) {
    throw new HttpsError('invalid-argument', `${field} contains an unsupported value.`);
  }
  return [...new Set(value as T[])];
}

function optionalIdentifierArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_FILTER_VALUES || !value.every(safeFilterValue)) {
    throw new HttpsError('invalid-argument', `${field} contains an invalid value.`);
  }
  return [...new Set(value as string[])];
}

function safeDocumentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function safeFilterValue(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && !/[/\\]/.test(value);
}

export function assessmentMatchesCurrentEvent(
  assessment: RiskAssessment,
  event: EventRecord,
): boolean {
  return assessment.assessmentId === event.currentAssessmentId
    && assessment.eventId === event.eventId
    && assessment.versionId === event.currentVersionId;
}

export function resourceMatchesCurrentEvent(
  resource: ResourceRecommendation,
  event: EventRecord,
): boolean {
  return resource.resourceId === event.currentResourceId
    && resource.eventId === event.eventId
    && resource.versionId === event.currentVersionId
    && resource.assessmentId === event.currentAssessmentId;
}

export function isAnalyticsAssessment(value: unknown): value is RiskAssessment {
  if (!isRecord(value)
    || typeof value.schemaVersion !== 'string'
    || !['manual_review_required', 'provisional_ready', 'authority_review', 'official_ready'].includes(String(value.status))
  ) return false;
  if (!['complete', 'provisional', 'insufficient_data'].includes(String(value.assessmentReadiness))
    || !['pass', 'review_required', 'blocked'].includes(String(value.complianceStatus))
    || !['low', 'medium', 'high'].includes(String(value.dataConfidenceLevel))
    || (value.contextEvidence !== undefined && (!Array.isArray(value.contextEvidence)
      || !value.contextEvidence.every((item) => isRecord(item) && typeof item.synthetic === 'boolean')))) return false;
  if (value.status !== 'official_ready' || !isAnalyticsOfficialResult(value.officialResult)) {
    return value.status !== 'official_ready';
  }
  if (value.officialResult.sourceKind === 'admin_manual') {
    return value.sourceKind === 'admin_manual'
      && safeDocumentId(value.activeManualAssessmentId)
      && value.activeManualAssessmentId === value.officialResult.manualAssessmentId;
  }
  return value.sourceKind === undefined
    && isRecord(value.aiProposal)
    && value.aiProposal.status === 'success'
    && value.aiProposal.proposalId === value.officialResult.proposalId
    && value.officialResult.officialFormulaVersion === OFFICIAL_FORMULA_VERSION
    && validateProvisionalAssessmentResult(value.officialResult).length === 0
    && validateAssessmentResultAgainstProposal(
      value.officialResult,
      value.aiProposal as unknown as AISuccessfulProposal,
    ).length === 0;
}

function isAnalyticsOfficialResult(
  value: unknown,
): value is OfficialAssessmentResult | ManualOfficialAssessmentResult {
  if (!isRecord(value) || !Number.isFinite(value.overallScore)
    || Number(value.overallScore) < 0 || Number(value.overallScore) > 100
    || !RISK_LEVEL_VALUES.has(value.overallRiskLevel as RiskLevel)
    || !RISK_LEVEL_VALUES.has(value.weightedRiskLevel as RiskLevel)
    || !RISK_LEVEL_VALUES.has(value.highestCategoryRiskLevel as RiskLevel)
    || typeof value.categorySchemaVersion !== 'string' || typeof value.formulaVersion !== 'string'
    || typeof value.hardRuleVersion !== 'string' || typeof value.officialInputHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.officialInputHash) || !validTimestamp(value.finalizedAt)
    || typeof value.finalizedBy !== 'string' || value.finalizedBy.length === 0
    || !Array.isArray(value.categories)) return false;
  if (value.sourceKind === 'admin_manual') {
    if (!safeDocumentId(value.manualAssessmentId)
      || validateManualOfficialAssessmentResult(value as unknown as ManualOfficialAssessmentResult).length > 0) return false;
  } else if ((value.sourceKind !== undefined && value.sourceKind !== 'ai_authority')
    || !safeDocumentId(value.proposalId)
    || !Array.isArray(value.validatedHazards)
    || !value.validatedHazards.every((hazard) => isRecord(hazard)
      && ACTIVE_CATEGORY_SCHEMA.categories.some((category) => category.id === hazard.categoryId))
    || !Array.isArray(value.reviewIds) || value.reviewIds.length === 0
    || new Set(value.reviewIds).size !== value.reviewIds.length
    || !value.reviewIds.every(safeDocumentId)) return false;
  const reviewIds = value.sourceKind === 'admin_manual' ? undefined : new Set(value.reviewIds as string[]);
  const expected = new Set(ACTIVE_CATEGORY_SCHEMA.categories.map((category) => category.id));
  const seen = new Set<string>();
  for (const category of value.categories) {
    if (!isRecord(category) || typeof category.categoryId !== 'string' || !expected.has(category.categoryId as never)
      || seen.has(category.categoryId) || !Number.isFinite(category.normalizedScore)
      || Number(category.normalizedScore) < 4 || Number(category.normalizedScore) > 100
      || !scoreRating(category.validatedLikelihood) || !scoreRating(category.validatedSeverity)
      || !RISK_LEVEL_VALUES.has(category.riskLevel as RiskLevel)
      || !Number.isFinite(category.weightedContribution)
      || !Array.isArray(category.appliedHardRules)) return false;
    if (reviewIds && (!scoreRating(category.authorityLikelihood)
      || !scoreRating(category.authoritySeverity)
      || !Array.isArray(category.sourceReviewIds) || category.sourceReviewIds.length === 0
      || new Set(category.sourceReviewIds).size !== category.sourceReviewIds.length
      || !category.sourceReviewIds.every((reviewId) => safeDocumentId(reviewId) && reviewIds.has(reviewId)))) return false;
    seen.add(category.categoryId);
  }
  return seen.size === expected.size;
}

function scoreRating(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5;
}

function isAnalyticsResource(value: unknown): value is ResourceRecommendation {
  return validateResourceRecommendation(value).ok;
}

/** Analytics skips malformed or legacy event rows instead of failing the whole report. */
export function isAnalyticsEvent(value: unknown): value is EventRecord & Record<string, unknown> {
  if (!isRecord(value) || !safeDocumentId(value.eventId) || !EVENT_STATUS_VALUES.has(value.status as EventStatus)
    || !Number.isSafeInteger(value.currentVersionNumber) || Number(value.currentVersionNumber) < 0
    || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)
    || !Array.isArray(value.requiredAuthorities)
    || !value.requiredAuthorities.every((authority) => AUTHORITY_VALUES.has(authority as AuthorityType))
    || !isRecord(value.eventDetails)) return false;
  const details = value.eventDetails;
  return typeof details.name === 'string' && details.name.trim().length > 0
    && EVENT_TYPE_VALUES.has(details.type as EventType)
    && typeof details.venueName === 'string' && details.venueName.trim().length > 0;
}

export function isAnalyticsOverride(value: unknown): value is ResourceOverrideRecord {
  if (!isRecord(value)
    || !safeDocumentId(value.overrideId) || !safeDocumentId(value.eventId)
    || !safeDocumentId(value.versionId) || !safeDocumentId(value.assessmentId)
    || !safeDocumentId(value.baseResourceId) || value.resourceId !== value.baseResourceId
    || !AUTHORITY_VALUES.has(value.authorityType as AuthorityType)
    || typeof value.reviewerId !== 'string' || value.reviewerId.length === 0
    || typeof value.rationale !== 'string' || value.rationale.trim().length === 0
    || typeof value.idempotencyKey !== 'string' || value.idempotencyKey.length === 0
    || !RESOURCE_OVERRIDE_REASON_CATEGORIES.includes(value.overrideReasonCategory as ResourceOverrideReasonCategory)
    || (value.supersedesOverrideId !== undefined && !safeDocumentId(value.supersedesOverrideId))
    || !Number.isFinite(value.overriddenAt)
    || !isRecord(value.previousQuantities) || !isRecord(value.quantities)) return false;
  const previous = value.previousQuantities;
  const quantities = value.quantities;
  return exactResourceKeys(previous) && exactResourceKeys(quantities)
    && RESOURCE_KEYS.every((key) => Number.isSafeInteger(previous[key]) && Number(previous[key]) >= 0
    && Number.isSafeInteger(quantities[key]) && Number(quantities[key]) >= 0);
}

function exactResourceKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === RESOURCE_KEYS.length && RESOURCE_KEYS.every((key) => Object.hasOwn(value, key));
}

function isAnalyticsIncident(value: unknown): value is Incident | M4IncidentRecord {
  if (!isRecord(value) || !safeDocumentId(value.incidentId)) return false;
  if (value.schemaVersion === M4_SCHEMA_VERSION) {
    return safeDocumentId(value.eventId) && safeDocumentId(value.eventVersionId)
      && typeof value.synthetic === 'boolean' && value.synthetic === false
      && ['submitted', 'manual_review_required', 'organizer_review', 'responding', 'authority_investigation', 'awaiting_resolution', 'resolved'].includes(String(value.status))
      && (value.severity === undefined || ['low', 'medium', 'high'].includes(String(value.severity)))
      && (value.immediateActionRequired === undefined || typeof value.immediateActionRequired === 'boolean')
      && (value.referredAuthorityId === undefined || safeDocumentId(value.referredAuthorityId));
  }
  return ['low', 'medium', 'high'].includes(String(value.severity))
    && (value.status === undefined || ['verified', 'under_review', 'rejected', 'resolved'].includes(String(value.status)));
}

function isM4AnalyticsIncident(value: Incident | M4IncidentRecord): value is M4IncidentRecord {
  return 'schemaVersion' in value && value.schemaVersion === M4_SCHEMA_VERSION;
}

export function selectValidAnalyticsIncidents(values: unknown[]): Array<Incident | M4IncidentRecord> {
  return values.filter(isAnalyticsIncident);
}

function isAnalyticsControl(value: unknown): value is EventControl {
  return isRecord(value) && safeDocumentId(value.controlId) && safeDocumentId(value.versionId)
    && ['approved', 'pending', 'reported_under_review', 'resubmit_required'].includes(String(value.label))
    && ['stage1_only', 'stage1_and_stage2'].includes(String(value.stageRequirement))
    && Array.isArray(value.stage1Requirements)
    && value.stage1Requirements.every((requirement) => isRecord(requirement)
      && ['receipt', 'application', 'floor_plan', 'license', 'insurance', 'other'].includes(String(requirement.docType))
      && typeof requirement.label === 'string' && requirement.label.length > 0 && typeof requirement.required === 'boolean');
}

function isAnalyticsDecision(value: unknown): value is AuthorityDecision {
  return isRecord(value) && safeDocumentId(value.versionId) && ['Approved', 'Rejected'].includes(String(value.decision))
    && (value.decidedAt === undefined || validTimestamp(value.decidedAt));
}

function isAnalyticsAssignment(value: unknown): value is Assignment {
  if (!isRecord(value) || !safeDocumentId(value.assignmentId) || !safeDocumentId(value.eventId)
    || !safeDocumentId(value.versionId) || !AUTHORITY_VALUES.has(value.authorityType as AuthorityType)
    || typeof value.officerUid !== 'string' || value.officerUid.length === 0
    || !['pending', 'in_progress', 'completed', 'revoked'].includes(String(value.status))) return false;
  if (value.decision !== undefined && !['Approved', 'Rejected'].includes(String(value.decision))) return false;
  return value.decision !== 'Rejected' || isRejectionReasonCategory(value.rejectionReasonCategory);
}

function isAnalyticsEventVersion(value: unknown, event: EventRecord): value is EventVersion {
  if (!isRecord(value) || value.eventId !== event.eventId || value.versionId !== event.currentVersionId
    || value.versionNumber !== event.currentVersionNumber || !validTimestamp(value.submittedAt)) return false;
  if (event.currentVersionNumber < 2) return value.revisionSource === undefined;
  return isRecord(value.revisionSource)
    && ['pending_edit', 'rejected_revision'].includes(String(value.revisionSource.kind))
    && safeDocumentId(value.revisionSource.sourceVersionId)
    && validTimestamp(value.revisionSource.startedAt);
}

function isAnalyticsStage1Doc(value: unknown): value is Stage1Doc {
  return isRecord(value) && safeDocumentId(value.docId)
    && ['receipt', 'application', 'floor_plan', 'license', 'insurance', 'other'].includes(String(value.docType))
    && typeof value.label === 'string' && value.label.length > 0
    && ['pending_submission', 'pending_verification', 'verified', 'rejected', 'use_previous'].includes(String(value.status));
}

function validTimestamp(value: unknown): value is number {
  return Number.isFinite(value) && Number(value) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
