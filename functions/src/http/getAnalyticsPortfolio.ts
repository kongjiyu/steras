import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  COLLECTIONS,
  EVENT_STATUSES,
  EVENT_TYPES,
  RESOURCE_KEYS,
  type AuthorityDecision,
  type AuthorityType,
  type EventControl,
  type EventRecord,
  type EventStatus,
  type EventType,
  type Incident,
  type ResourceKey,
  type ResourceOverrideRecord,
  type ResourceRecommendation,
  type RiskAssessment,
  type RiskLevel,
  type UserProfile,
} from '@shared/types';
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
import { validateResourceRecommendation } from '../engines/resourceContract';

const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 500;
const MAX_FETCH = 1_000;
const MAX_RANGE_MS = 5 * 366 * 24 * 60 * 60 * 1_000;
const MAX_FILTER_VALUES = 25;
const EVENT_TYPE_VALUES = new Set(EVENT_TYPES.map((item) => item.value));
const EVENT_STATUS_VALUES = new Set(EVENT_STATUSES.map((item) => item.value));
const RISK_LEVEL_VALUES = new Set<RiskLevel>(['Low', 'Medium', 'High']);
const AUTHORITY_VALUES = new Set<AuthorityType>(['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC']);

interface AnalyticsSourceBundle {
  event: EventRecord & Record<string, unknown>;
  assessment?: RiskAssessment;
  resource?: ResourceRecommendation;
  overrides: ResourceOverrideRecord[];
  incidents: Incident[];
  controls: EventControl[];
  decisionHistory: AuthorityDecision[];
  incidentCoverageAvailable: boolean;
  includeSynthetic: boolean;
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

    const [eventSnapshot, incidentCoverageSnapshot] = await Promise.all([
      query.limit(fetchLimit).get(),
      db.collection(COLLECTIONS.INCIDENTS).limit(1).get(),
    ]);
    const eventCandidates = eventSnapshot.docs
      .map((snapshot) => ({ eventId: snapshot.id, ...snapshot.data() }) as EventRecord & Record<string, unknown>)
      .filter((event) => eventMatchesBaseFilters(event, input));

    const records = await mapWithConcurrency(eventCandidates, 10, async (event) => {
      const eventReference = db.collection(COLLECTIONS.EVENTS).doc(event.eventId);
      const assessmentReference = safeDocumentId(event.currentAssessmentId)
        ? eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId)
        : undefined;
      const resourceReference = safeDocumentId(event.currentResourceId)
        ? eventReference.collection(COLLECTIONS.RESOURCES).doc(event.currentResourceId)
        : undefined;
      const [assessmentSnapshot, resourceSnapshot, overrideSnapshot, incidentSnapshot, controlSnapshot, decisionHistorySnapshot] = await Promise.all([
        assessmentReference?.get(),
        resourceReference?.get(),
        eventReference.collection(COLLECTIONS.RESOURCE_OVERRIDES).limit(200).get(),
        db.collection(COLLECTIONS.INCIDENTS).where('eventId', '==', event.eventId).limit(200).get(),
        eventReference.collection(COLLECTIONS.EVENT_CONTROLS).limit(500).get(),
        eventReference.collection(COLLECTIONS.DECISION_HISTORY).limit(500).get(),
      ]);
      const assessmentValue = assessmentSnapshot?.data();
      const resourceValue = resourceSnapshot?.data();
      return buildAnalyticsPortfolioRecord({
        event,
        assessment: isAnalyticsAssessment(assessmentValue) ? assessmentValue : undefined,
        resource: isAnalyticsResource(resourceValue) ? resourceValue : undefined,
        overrides: overrideSnapshot.docs.map((document) => document.data()).filter(isAnalyticsOverride),
        incidents: incidentSnapshot.docs.map((document) => document.data()).filter(isAnalyticsIncident),
        controls: controlSnapshot.docs.map((document) => document.data()).filter(isAnalyticsControl),
        decisionHistory: decisionHistorySnapshot.docs.map((document) => document.data()).filter(isAnalyticsDecision),
        incidentCoverageAvailable: !incidentCoverageSnapshot.empty,
        includeSynthetic: input.includeSynthetic,
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
    if (!incidentCoverageSnapshot.size) unavailableSections.push('Incident patterns');
    if (!selected.some((record) => record.resources)) unavailableSections.push('Resource recommendations');
    if (!selected.some((record) => record.controls.available)) unavailableSections.push('Event-control verification');

    const generatedAt = Date.now();
    return {
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      metricDefinitionVersion: ANALYTICS_METRIC_DEFINITION_VERSION,
      generatedAt,
      sourceCutoff: generatedAt,
      records: selected,
      totalMatched: operationalRecords.length,
      syntheticExcluded,
      truncated: eventSnapshot.size === fetchLimit || operationalRecords.length > input.limit,
      unavailableSections,
    };
  },
);

export function assertAnalyticsAdmin(profile: UserProfile | undefined): void {
  if (!profile || profile.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only administrators can view cross-agency analytics.');
  }
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
  const { event, assessment, resource, overrides, controls, decisionHistory } = bundle;
  const incidents = bundle.incidents.filter((incident) => bundle.includeSynthetic || incident.synthetic !== true);
  const synthetic = event.synthetic === true || isRecord(event.m3Uat)
    || Boolean(assessment?.contextEvidence?.length && assessment.contextEvidence.every((item) => item.synthetic));
  const priorRejectedVersion = decisionHistory.some((decision) => decision.decision === 'Rejected'
    && decision.versionId !== event.currentVersionId);
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
    ...(['Approved', 'Rejected'].includes(event.status)
      ? { terminalDecisionAt: event.authorityReviewCompletedAt ?? event.updatedAt }
      : {}),
    updatedAt: event.updatedAt,
    synthetic,
    reapplication: event.currentVersionNumber >= 2 && priorRejectedVersion,
    ...(assessment ? { assessment: buildAssessmentSummary(assessment) } : {}),
    ...(resource ? { resources: buildResourceSummary(resource, overrides) } : {}),
    incidents: buildIncidentSummary(incidents, bundle.incidentCoverageAvailable),
    controls: buildControlSummary(controls, Boolean(event.controlListGenerated)),
  };
}

function buildAssessmentSummary(assessment: RiskAssessment): AnalyticsAssessmentSummary {
  const result = 'officialResult' in assessment
    ? assessment.officialResult
    : 'provisionalResult' in assessment ? assessment.provisionalResult : undefined;
  const categories = result?.categories ?? [];
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

function buildResourceSummary(resource: ResourceRecommendation, overrides: ResourceOverrideRecord[]): AnalyticsResourceSummary {
  const validOverrides = overrides
    .filter((override) => override.baseResourceId === resource.resourceId && Number.isFinite(override.overriddenAt))
    .sort((left, right) => left.overriddenAt - right.overriddenAt);
  const latest = validOverrides.at(-1);
  const items = Object.fromEntries(RESOURCE_KEYS.map((key) => {
    const item = resource.items[key];
    if (!item) return [key, undefined];
    const overrideCount = validOverrides.filter((override) => override.previousQuantities[key] !== override.quantities[key]).length;
    return [key, {
      baseline: item.baseline,
      minimum: item.planningRange.min,
      maximum: item.planningRange.max,
      effective: latest?.quantities[key] ?? item.baseline,
      overrideCount,
    }];
  }).filter((entry) => entry[1] !== undefined)) as Partial<Record<ResourceKey, AnalyticsResourceSummary['items'][ResourceKey]>>;
  return {
    schemaVersion: resource.schemaVersion,
    formulaVersion: resource.formulaVersion,
    items,
    overrideCount: validOverrides.length,
  };
}

function buildIncidentSummary(incidents: Incident[], available: boolean): AnalyticsIncidentSummary {
  const bySeverity = { low: 0, medium: 0, high: 0 };
  const byStatus = { verified: 0, under_review: 0, rejected: 0, unknown: 0 };
  incidents.forEach((incident) => {
    bySeverity[incident.severity] += 1;
    byStatus[incident.status ?? 'unknown'] += 1;
  });
  return {
    available,
    total: incidents.length,
    verified: byStatus.verified,
    bySeverity,
    byStatus,
  };
}

function buildControlSummary(controls: EventControl[], declaredAvailable: boolean): AnalyticsControlSummary {
  const summary: AnalyticsControlSummary = {
    available: declaredAvailable || controls.length > 0,
    total: controls.length,
    approved: 0,
    pending: 0,
    reportedUnderReview: 0,
    resubmitRequired: 0,
    usePrevious: 0,
  };
  controls.forEach((control) => {
    if (control.label === 'approved') summary.approved += 1;
    if (control.label === 'pending') summary.pending += 1;
    if (control.label === 'reported_under_review') summary.reportedUnderReview += 1;
    if (control.label === 'resubmit_required') summary.resubmitRequired += 1;
    if (control.usePreviousSourceEventId) summary.usePrevious += 1;
  });
  return summary;
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

function isAnalyticsAssessment(value: unknown): value is RiskAssessment {
  return isRecord(value)
    && typeof value.schemaVersion === 'string'
    && ['manual_review_required', 'provisional_ready', 'authority_review', 'official_ready'].includes(String(value.status))
    && ['complete', 'provisional', 'insufficient_data'].includes(String(value.assessmentReadiness))
    && ['pass', 'review_required', 'blocked'].includes(String(value.complianceStatus))
    && ['low', 'medium', 'high'].includes(String(value.dataConfidenceLevel));
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

function isAnalyticsOverride(value: unknown): value is ResourceOverrideRecord {
  if (!isRecord(value) || typeof value.baseResourceId !== 'string' || !Number.isFinite(value.overriddenAt)
    || !isRecord(value.previousQuantities) || !isRecord(value.quantities)) return false;
  const previous = value.previousQuantities;
  const quantities = value.quantities;
  return RESOURCE_KEYS.every((key) => Number.isFinite(previous[key]) && Number.isFinite(quantities[key]));
}

function isAnalyticsIncident(value: unknown): value is Incident {
  return isRecord(value) && typeof value.incidentId === 'string'
    && ['low', 'medium', 'high'].includes(String(value.severity))
    && (value.status === undefined || ['verified', 'under_review', 'rejected'].includes(String(value.status)));
}

function isAnalyticsControl(value: unknown): value is EventControl {
  return isRecord(value) && typeof value.controlId === 'string'
    && ['approved', 'pending', 'reported_under_review', 'resubmit_required'].includes(String(value.label));
}

function isAnalyticsDecision(value: unknown): value is AuthorityDecision {
  return isRecord(value) && typeof value.versionId === 'string' && ['Approved', 'Rejected'].includes(String(value.decision));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
