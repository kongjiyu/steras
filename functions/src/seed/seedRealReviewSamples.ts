import { createHash } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';
import {
  ASSESSMENT_SCHEMA_VERSION,
  Assignment,
  AuthorityScoreReview,
  AuthorityType,
  AssessmentContextSnapshot,
  EventDetails,
  EventRecord,
  EventVersion,
  M1_DOCUMENT_SCHEMA_VERSION,
  M1_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  RESOURCE_KEYS,
  RESOURCE_SCHEMA_VERSION,
  ResourceRecommendation,
  RiskAssessment,
  ProvisionalRiskAssessment,
  SCORE_REVIEW_SCHEMA_VERSION,
  Venue,
} from '@shared/types';
import {
  REAL_REVIEW_SAMPLE_AS_OF,
  REAL_REVIEW_SAMPLE_DATASET_ID,
  REAL_REVIEW_SAMPLE_EVENT_IDS,
  REAL_REVIEW_SAMPLES,
  type RealReviewSampleDefinition,
  type RealReviewSampleId,
} from '@shared/realReviewSamples';
import { resolveApplicationDisplayState } from '@shared/applicationState';
import { STERAS_TEST_ACCOUNT_EMAILS } from '@shared/sterasTestFixtures';
import { ACTIVE_CATEGORY_SCHEMA } from '../config/categorySchema';
import { buildAuthorityReviewState, buildOfficialAssessmentResult } from '../engines/authorityFinalisation';
import { validateAndCalculateProvisional } from '../engines/assessmentValidator';
import { computeCategoryBasedAssessment } from '../engines/ruleBased';
import { computeResources } from '../engines/resourceCalculator';
import { resourceDocumentId } from '../triggers/onEventCreated';
import { requiredAuthoritiesFor } from '../http/submitEvent';
import { initializeSterasTestContext, type SterasTestContext } from './seedSterasTest';

const MANAGED_BY = 'seed:steras:real-review-samples' as const;
const VERSION_ID = 'v1';
const FIXTURE_DESCRIPTION = 'STERAS TEST FIXTURE — not an actual permit application.';
const PRODUCTION_PROJECT_ID = 'linkos-496505';
const ALLOW_PRODUCTION_ENV = 'STERAS_REAL_SAMPLES_ALLOW_PRODUCTION';
const CONFIRM_DATASET_ENV = 'STERAS_REAL_SAMPLES_CONFIRM_DATASET';
const STORAGE_PREFIX = 'event_documents';

type Action = 'dry-run' | 'apply' | 'verify';

interface ManagedMarker {
  datasetId: typeof REAL_REVIEW_SAMPLE_DATASET_ID;
  managedBy: typeof MANAGED_BY;
  fixtureId: RealReviewSampleId;
  workflow: RealReviewSampleDefinition['workflow'];
  sourceUrls: string[];
  asOf: string;
  publicFacts: string;
  syntheticCapacityNote: string;
}

interface UserIds {
  admin: string;
  organizer: string;
  authorities: Record<AuthorityType, string>;
}

function venueRecord(sample: RealReviewSampleDefinition, now: number): Venue & { sterasFixture: ManagedMarker } {
  const venueId = `fixture-venue-${sample.id}`;
  return {
    venueId,
    active: true,
    name: sample.venueName,
    address: sample.venueAddress,
    capacity: sample.venueCapacity,
    location: sample.venueLocation,
    state: stateForSample(sample),
    jurisdiction: sample.venueAddress.includes('Kuala Lumpur') ? 'DBKL' : 'PBT',
    verifiedSafeCapacity: sample.venueCapacity,
    fireCertificateStatus: 'valid',
    fireCertificateExpiresAt: now + 31_536_000_000,
    nearestHospitalTravelMinutes: 20,
    emergencyAccessVerified: true,
    synthetic: true,
    datasetVersion: `${REAL_REVIEW_SAMPLE_DATASET_ID}:${REAL_REVIEW_SAMPLE_AS_OF}`,
    verificationStatus: 'verified',
    revision: 1,
    createdBy: MANAGED_BY,
    createdAt: now,
    updatedBy: MANAGED_BY,
    updatedAt: now,
    verifiedBy: MANAGED_BY,
    verifiedAt: now,
    sterasFixture: marker(sample),
  };
}

function stateForSample(sample: RealReviewSampleDefinition): string {
  if (sample.id === 'steras-sample-klscm-2026') return 'Kuala Lumpur';
  if (sample.id === 'steras-sample-malaysian-motogp-2026') return 'Selangor';
  return 'Kedah';
}

/**
 * Some production sandboxes already contain the reserved showcase accounts
 * rather than the Playwright account aliases.  They are safe fixture owners
 * because every fallback is explicitly restricted to the `.test` domain and
 * still has its role/authority profile checked below.
 */
const SHOWCASE_ACCOUNT_EMAILS: Partial<Record<'admin' | 'organizer' | AuthorityType, string>> = {
  admin: 'admin.showcase@steras.test',
  PDRM: 'pdrm.showcase@steras.test',
  BOMBA: 'bomba.showcase@steras.test',
  KKM: 'kkm.showcase@steras.test',
  DBKL: 'dbkl.showcase@steras.test',
  MOTAC: 'motac.showcase@steras.test',
};

function parseAction(argv: string[]): Action {
  const flags = argv.filter((value): value is Action => value === '--dry-run' || value === '--apply' || value === '--verify');
  if (flags.length !== 1) throw new Error('Choose exactly one action: --dry-run, --apply, or --verify.');
  return flags[0].slice(2) as Action;
}

function assertProductionGuard(projectId: string, action: Action): void {
  if (projectId !== PRODUCTION_PROJECT_ID) {
    throw new Error(`Refusing target ${projectId || '(unset)'}. Real review samples are locked to ${PRODUCTION_PROJECT_ID}.`);
  }
  if (action === 'apply' && process.env[ALLOW_PRODUCTION_ENV] !== 'true') {
    throw new Error(`Set ${ALLOW_PRODUCTION_ENV}=true to authorize writes to the production project.`);
  }
  if (process.env[CONFIRM_DATASET_ENV] && process.env[CONFIRM_DATASET_ENV] !== REAL_REVIEW_SAMPLE_DATASET_ID) {
    throw new Error(`Set ${CONFIRM_DATASET_ENV}=${REAL_REVIEW_SAMPLE_DATASET_ID}, or unset it.`);
  }
}

function marker(sample: RealReviewSampleDefinition): ManagedMarker {
  return {
    datasetId: REAL_REVIEW_SAMPLE_DATASET_ID,
    managedBy: MANAGED_BY,
    fixtureId: sample.id,
    workflow: sample.workflow,
    sourceUrls: [...sample.sourceUrls],
    asOf: REAL_REVIEW_SAMPLE_AS_OF,
    publicFacts: sample.publicFacts,
    syntheticCapacityNote: sample.syntheticCapacityNote,
  };
}

function isManaged(value: FirebaseFirestore.DocumentData | undefined, sampleId?: RealReviewSampleId): boolean {
  const candidate = value?.sterasFixture as Partial<ManagedMarker> | undefined;
  return candidate?.datasetId === REAL_REVIEW_SAMPLE_DATASET_ID
    && candidate?.managedBy === MANAGED_BY
    && (!sampleId || candidate.fixtureId === sampleId);
}

async function resolveRequiredUsers(ctx: SterasTestContext): Promise<UserIds> {
  const authorityEmails: Record<AuthorityType, string> = {
    PDRM: STERAS_TEST_ACCOUNT_EMAILS.PDRM,
    BOMBA: STERAS_TEST_ACCOUNT_EMAILS.BOMBA,
    KKM: STERAS_TEST_ACCOUNT_EMAILS.KKM,
    DBKL: STERAS_TEST_ACCOUNT_EMAILS.DBKL,
    MOTAC: STERAS_TEST_ACCOUNT_EMAILS.MOTAC,
  };
  const required = [
    { key: 'admin', email: STERAS_TEST_ACCOUNT_EMAILS.admin, role: 'admin' },
    { key: 'organizer', email: STERAS_TEST_ACCOUNT_EMAILS.organizer, role: 'organizer' },
    ...Object.entries(authorityEmails).filter(([, email]) => Boolean(email)).map(([authority, email]) => ({ key: authority as AuthorityType, email, role: 'authority' })),
  ];
  const userIds: UserIds = { admin: '', organizer: '', authorities: {} as Record<AuthorityType, string> };
  const missing: string[] = [];
  for (const identity of required) {
    const candidates = [identity.email, SHOWCASE_ACCOUNT_EMAILS[identity.key as 'admin' | 'organizer' | AuthorityType]]
      .filter((email): email is string => Boolean(email));
    let authUser: Awaited<ReturnType<typeof ctx.auth.getUserByEmail>> | undefined;
    let selectedEmail = identity.email;
    let invalidCandidate = '';
    for (const candidate of candidates) {
      if (!candidate.endsWith('@steras.test')) {
        invalidCandidate = candidate;
        continue;
      }
      try {
        const candidateUser = await ctx.auth.getUserByEmail(candidate);
        const profile = await ctx.db.collection('users').doc(candidateUser.uid).get();
        if (profile.exists && profile.data()?.role === identity.role
          && (identity.role !== 'authority' || profile.data()?.authorityType === identity.key)) {
          authUser = candidateUser;
          selectedEmail = candidate;
          break;
        }
        invalidCandidate = `${candidate} (users/${candidateUser.uid} profile role/authority mismatch)`;
      } catch (error) {
        if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
      }
    }
    if (!authUser) {
      missing.push(invalidCandidate || `${selectedEmail} (no matching reserved test account)`);
      continue;
    }
    if (identity.key === 'admin') userIds.admin = authUser.uid;
    else if (identity.key === 'organizer') userIds.organizer = authUser.uid;
    else userIds.authorities[identity.key as AuthorityType] = authUser.uid;
  }
  if (missing.length > 0) {
    throw new Error(`Required test users are missing or invalid; no fixture writes were made:\n- ${missing.join('\n- ')}`);
  }
  return userIds;
}

async function assertNoCollisions(ctx: SterasTestContext): Promise<void> {
  for (const sampleId of REAL_REVIEW_SAMPLE_EVENT_IDS) {
    const event = await ctx.db.collection('events').doc(sampleId).get();
    if (event.exists && !isManaged(event.data(), sampleId)) {
      throw new Error(`Collision at events/${sampleId}: existing document is not owned by ${REAL_REVIEW_SAMPLE_DATASET_ID}.`);
    }
    const publicEvent = await ctx.db.collection('public_events').doc(sampleId).get();
    if (publicEvent.exists && !isManaged(publicEvent.data(), sampleId)) {
      throw new Error(`Collision at public_events/${sampleId}: existing document is not owned by ${REAL_REVIEW_SAMPLE_DATASET_ID}.`);
    }
    const venue = await ctx.db.collection('venues').doc(`fixture-venue-${sampleId}`).get();
    if (venue.exists && !isManaged(venue.data(), sampleId)) {
      throw new Error(`Collision at venues/fixture-venue-${sampleId}: existing document is not owned by ${REAL_REVIEW_SAMPLE_DATASET_ID}.`);
    }
  }
}

function eventDetails(sample: RealReviewSampleDefinition): EventDetails {
  return {
    name: sample.name,
    type: sample.type,
    venueId: `fixture-venue-${sample.id}`,
    venueName: sample.venueName,
    venueAddress: sample.venueAddress,
    venueLocation: sample.venueLocation,
    venueCapacity: sample.venueCapacity,
    expectedAttendance: sample.expectedAttendance,
    environment: 'outdoor',
    coverage: 'uncovered',
    seating: 'standing',
    startDatetime: Date.parse(sample.startIso),
    endDatetime: Date.parse(sample.endIso),
    description: `${FIXTURE_DESCRIPTION}\n${sample.publicFacts}\n${sample.syntheticCapacityNote}`,
    emergencyPlanSummary: 'Synthetic fixture emergency plan: establish incident command, route public evacuation, stage medical response, coordinate traffic closure, and contact the named authorities. This text is for validation only.',
    riskProfile: {
      vulnerableAttendeesPercent: 5,
      standingAttendeesPercent: 80,
      internationalAttendees: true,
      alcoholServed: false,
      foodServed: true,
      freeDrinkingWater: true,
      ticketedEntry: true,
      overnightAccommodation: false,
      pyrotechnics: false,
      temporaryStructures: true,
      rivalryOrTensionExpected: false,
      crowdManagementPlan: true,
      trafficManagementPlan: true,
      severeWeatherPlan: true,
      medicalPlan: true,
      evacuationPlanTested: true,
      authorityCoordinationConfirmed: true,
      nearestHospitalTravelMinutes: 20,
    },
    organizerName: sample.organizerName,
    organizerEmail: `${sample.id}@steras.test`,
    organizerPhone: '+60 12-555 0199',
  };
}

function assessmentContext(sample: RealReviewSampleDefinition, now: number): AssessmentContextSnapshot {
  const start = Date.parse(sample.startIso);
  return {
    weather: {
      data: { forecast: 'Partly cloudy', temperature: 31, humidity: 75, windSpeed: 12, precipitationProbability: 20, severeAlert: false },
      measurementStatus: 'available', source: 'openweather', freshness: 'fresh', fetchedAt: now,
      expiresAt: now + 21_600_000, forecastFor: start,
    },
    calendar: {
      localDate: sample.startIso.slice(0, 10), dayOfWeek: 'Saturday', isWeekend: true, isHolidayOrAdjacent: false,
      sourceVersion: `${REAL_REVIEW_SAMPLE_DATASET_ID}:${REAL_REVIEW_SAMPLE_AS_OF}`, sourceTimestamp: now,
      coverageStatus: 'verified',
    },
    venue: {
      matched: true, venueId: `fixture-venue-${sample.id}`, submittedCapacity: sample.venueCapacity,
      registeredCapacity: sample.venueCapacity, capacityDifference: 0, jurisdiction: sample.venueAddress.includes('Kuala Lumpur') ? 'DBKL' : 'PBT',
      fireCertificateStatus: 'valid', fireCertificateExpiresAt: now + 31_536_000_000,
      emergencyAccessVerified: true, nearestHospitalTravelMinutes: 20, fetchedAt: now,
    },
    incidentHistory: {
      matched: false, venueId: `fixture-venue-${sample.id}`, incidentIds: [], total: 0,
      bySeverity: { low: 0, medium: 0, high: 0 }, syntheticStatus: 'all', syntheticEvidence: true, fetchedAt: now,
    },
  };
}

function proposalFor(sample: RealReviewSampleDefinition, now: number, event: EventRecord) {
  const baseline = computeCategoryBasedAssessment(event, assessmentContext(sample, now), now);
  const evidenceByCategory: Record<string, 'crowd' | 'venue' | 'weather'> = {
    crowd: 'crowd', venue_fire: 'venue', weather_environment: 'weather', public_health: 'crowd',
    food_water_sanitation: 'venue', medical_capacity: 'venue', security_cbrn: 'crowd', transport_accessibility: 'venue',
  };
  return {
    status: 'success' as const,
    proposalId: `proposal-${sample.id}-${VERSION_ID}`,
    model: 'steras-real-review-fixture', promptVersion: `${REAL_REVIEW_SAMPLE_DATASET_ID}:public-facts`,
    responseSchemaVersion: 'fixture-v1', hazards: [],
    categories: ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({
      categoryId: category.id, likelihood: 2 as const, severity: 2 as const,
      evidenceReferences: [evidenceByCategory[category.id]],
      rationale: `Synthetic validation proposal grounded in the submitted ${sample.name} fixture details.`,
      confidence: 'high' as const, concerns: [], missingInformation: [],
    })),
    cacheStatus: 'not-applicable' as const, generatedAt: now,
    baseline,
  };
}

function buildArtifacts(sample: RealReviewSampleDefinition, event: EventRecord, userIds: UserIds, now: number, evidenceGeneration: string): {
  assessment: RiskAssessment;
  resource?: ResourceRecommendation;
  reviews: AuthorityScoreReview[];
} {
  const assessmentId = `assessment-${sample.id}-${VERSION_ID}`;
  const context = assessmentContext(sample, now);
  const generated = proposalFor(sample, now, event);
  const derivedAuthorities = requiredAuthoritiesFor(event.eventDetails);
  const fixtureAuthorities = new Set(sample.requiredAuthorities);
  const missingDerivedAuthorities = derivedAuthorities.filter((authority) => !fixtureAuthorities.has(authority));
  const expectedFiveAuthorities: AuthorityType[] = ['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'];
  if (sample.requiredAuthorities.length !== expectedFiveAuthorities.length
    || expectedFiveAuthorities.some((authority) => !fixtureAuthorities.has(authority))
    || missingDerivedAuthorities.length > 0) {
    throw new Error(`Required-authority fixture mismatch for ${sample.id}: ${sample.requiredAuthorities.join(', ')} (derived baseline: ${derivedAuthorities.join(', ')}).`);
  }
  const validation = validateAndCalculateProvisional(generated, generated.baseline, now);
  if (!validation.ok) throw new Error(`Unable to create assessment for ${sample.id}: ${validation.reason}`);
  const evidencePath = `${STORAGE_PREFIX}/${sample.id}/${VERSION_ID}/application-evidence.txt`;
  const common = {
    assessmentId, eventId: sample.id, versionId: VERSION_ID, schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    contextSnapshot: context, evidence: generated.baseline.evidence,
    contextEvidence: [{
      evidenceId: `context-${sample.id}`, evidenceKey: 'compliance' as const, sourceKind: 'submitted_document' as const,
       sourceLocator: evidencePath, retrievedAt: now, sourceVersion: `storage-generation:${evidenceGeneration}`,
      eligibility: 'eligible' as const, synthetic: true, visibility: 'authority_only' as const,
    }],
    sourceTimestamps: { weather: now, holiday: now, venue: now, incidents: now },
    contextStatuses: { weather: 'fixture:public-facts-plus-synthetic', holiday: 'fixture:verified-date', venue: 'fixture:matched', incidents: 'fixture:synthetic-none' },
    assessmentReadiness: sample.workflow === 'manual_review_required' ? 'insufficient_data' as const : 'complete' as const,
    complianceStatus: 'pass' as const, complianceChecks: generated.baseline.complianceChecks ?? [],
    dataConfidenceScore: sample.workflow === 'manual_review_required' ? 45 : 92,
    dataConfidenceLevel: sample.workflow === 'manual_review_required' ? 'medium' as const : 'high' as const,
    inputHash: hash(`${REAL_REVIEW_SAMPLE_DATASET_ID}:${sample.id}:${VERSION_ID}`), createdAt: now,
  };
  if (sample.workflow === 'manual_review_required') {
    const assessment = {
      ...common,
      status: 'manual_review_required' as const, aiProposal: null, warnings: [{
        warningId: `manual-${sample.id}`, code: 'missing_evidence' as const,
        message: 'Official automated assessment is unavailable in this guarded fixture; Admin manual review is required.', evidenceReferences: [],
      }],
      authorityReviewRequired: true as const,
      manualReviewReason: `Synthetic manual-review gate for ${sample.name}; replace with a human assessment before approval.`,
      sterasFixture: marker(sample),
    } as unknown as RiskAssessment;
    return { assessment, reviews: [] };
  }
  const reviews = sample.requiredAuthorities.map((authority) => ({
    reviewId: `review-${sample.id}-${authority}`,
    schemaVersion: SCORE_REVIEW_SCHEMA_VERSION,
    eventId: sample.id, versionId: VERSION_ID, assessmentId,
    proposalId: generated.proposalId, provisionalCalculatedAt: now,
    assessmentInputHash: common.inputHash, categorySchemaVersion: ACTIVE_CATEGORY_SCHEMA.version,
    authorityType: authority, reviewerId: userIds.authorities[authority],
    categories: generated.categories.map((category) => ({ categoryId: category.categoryId, likelihood: category.likelihood, severity: category.severity, decision: 'confirmed' as const })),
    rationale: `Synthetic ${authority} score review retained for the ${sample.name} fixture.`,
    idempotencyKey: `review-key-${sample.id}-${authority}`, createdAt: now,
  })) as AuthorityScoreReview[];
  const provisional = {
    ...common, status: 'authority_review' as const, aiProposal: generated,
    warnings: validation.warnings, authorityReviewRequired: true as const, provisionalResult: validation.result,
  } as unknown as ProvisionalRiskAssessment;
  if (sample.workflow === 'initial_review') {
    // Initial review precedes authority score confirmation. Keep this
    // fixture genuinely pre-assignment: no score-review heads, decisions, or
    // officer assignments are written until Admin releases the application.
    const calculation = computeResources({ eventId: sample.id, versionId: VERSION_ID, assessmentId, eventDetails: event.eventDetails, assessmentResult: validation.result });
    if (!calculation.ok) throw new Error(`Unable to create resources for ${sample.id}: ${calculation.message}`);
    const assessment = {
      ...provisional, status: 'provisional_ready' as const,
      sterasFixture: marker(sample),
    } as unknown as RiskAssessment;
    return { assessment, resource: resourceRecord(sample, assessmentId, calculation, 'provisional', now, undefined), reviews: [] };
  }
  const officialResult = buildOfficialAssessmentResult({
    assessment: provisional, eventDetails: event.eventDetails, requiredAuthorities: sample.requiredAuthorities,
    reviews, finalizedAt: now, finalizedBy: userIds.admin,
  });
  const calculation = computeResources({ eventId: sample.id, versionId: VERSION_ID, assessmentId, eventDetails: event.eventDetails, assessmentResult: officialResult });
  if (!calculation.ok) throw new Error(`Unable to create resources for ${sample.id}: ${calculation.message}`);
  const assessment = {
    ...provisional, status: 'official_ready' as const, authorityReviewRequired: false as const,
    authorityReviewState: buildAuthorityReviewState(sample.requiredAuthorities, reviews, now), officialResult,
    sterasFixture: marker(sample),
  } as unknown as RiskAssessment;
  return { assessment, resource: resourceRecord(sample, assessmentId, calculation, 'official', now, userIds.admin), reviews };
}

function resourceRecord(
  sample: RealReviewSampleDefinition,
  assessmentId: string,
  calculation: Extract<ReturnType<typeof computeResources>, { ok: true }>,
  stage: 'provisional' | 'official',
  now: number,
  finalizedBy: string | undefined,
): ResourceRecommendation {
  const resourceId = resourceDocumentId(stage, VERSION_ID, calculation.resourceInputHash);
  const items = stage === 'official'
    ? Object.fromEntries(RESOURCE_KEYS.map((key) => [key, { ...calculation.items[key], confidence: 'authority_validated' as const, authorityReviewRequired: false }]))
    : calculation.items;
  return {
    resourceId, eventId: sample.id, versionId: VERSION_ID, assessmentId, schemaVersion: RESOURCE_SCHEMA_VERSION,
    stage, revision: 1, supersedesResourceId: null,
    assessmentReference: stage === 'official'
      ? { stage: 'official', assessmentId, proposalId: `proposal-${sample.id}-${VERSION_ID}`, finalizedAt: now, finalizedBy: finalizedBy! }
      : { stage: 'provisional', assessmentId, proposalId: `proposal-${sample.id}-${VERSION_ID}` },
    resourceInputHash: calculation.resourceInputHash, formulaVersion: calculation.formulaVersion,
    configVersion: calculation.configVersion, sourceRegistryVersion: calculation.sourceRegistryVersion,
    items: items as ResourceRecommendation['items'],
    confidenceLevel: stage === 'official' ? 'authority_validated' : 'prototype',
    authorityReviewRequired: stage !== 'official', validationScope: stage === 'official' ? 'official_risk_input_only' : 'provisional_risk_input',
    notes: `${FIXTURE_DESCRIPTION} Resource quantities are synthetic validation values.`, computedAt: now,
  } as unknown as ResourceRecommendation;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sampleEvent(sample: RealReviewSampleDefinition, userIds: UserIds, artifacts: ReturnType<typeof buildArtifacts>, now: number, evidenceSizeBytes: number): EventRecord {
  const details = eventDetails(sample);
  const version: EventVersion = {
    versionId: VERSION_ID, eventId: sample.id, versionNumber: 1, eventDetails: details,
    documentPaths: [`${STORAGE_PREFIX}/${sample.id}/${VERSION_ID}/application-evidence.txt`],
    documentUploads: [{
      path: `${STORAGE_PREFIX}/${sample.id}/${VERSION_ID}/application-evidence.txt`, role: 'supporting_evidence', originalName: 'synthetic-event-evidence.txt',
       mimeType: 'text/plain', sizeBytes: evidenceSizeBytes, uploadedAt: now, schemaVersion: M1_DOCUMENT_SCHEMA_VERSION,
    }],
    evidenceManifest: [], evidenceManifestSchemaVersion: M1_EVIDENCE_MANIFEST_SCHEMA_VERSION,
    submittedBy: userIds.organizer, submittedAt: now - 86_400_000, inputHash: hash(`${sample.id}:version:${VERSION_ID}`),
  };
  const assignments = sample.workflow === 'final_review'
    ? sample.requiredAuthorities.map((authority) => ({
      assignmentId: `${VERSION_ID}_${authority}`, eventId: sample.id, versionId: VERSION_ID, authorityType: authority,
      officerUid: userIds.authorities[authority], assignedBy: userIds.admin, assignedAt: now - 43_200_000,
      status: 'completed' as const, decision: 'Approved' as const,
      reason: `Synthetic ${authority} review completed for the fixture.`, suggestion: 'No corrective action required for this fixture.', decidedAt: now - 21_600_000,
    }))
    : [];
  const assignedOfficerByAuthority = Object.fromEntries(assignments.map((assignment) => [assignment.authorityType, assignment.officerUid]));
  return {
    eventId: sample.id, organizerId: userIds.organizer, eventDetails: details,
    status: sample.workflow === 'manual_review_required' ? 'Manual Review Required' : sample.workflow === 'initial_review' ? 'Pending' : 'UnderReview',
    currentVersionId: VERSION_ID, currentVersionNumber: 1,
    currentAssessmentId: artifacts.assessment.assessmentId,
    ...(artifacts.resource ? { currentResourceId: artifacts.resource.resourceId } : {}),
    editableVersionId: null, draftDocumentPaths: [], draftDocuments: [], requiredAuthorities: sample.requiredAuthorities,
    ...(assignments.length > 0 ? {
      assignedOfficerUids: assignments.map((assignment) => assignment.officerUid), assignedOfficerByAuthority,
    } : {}),
    reviewStage: sample.workflow === 'initial_review' ? 'initial' : sample.workflow === 'manual_review_required' ? 'manual' : 'second',
    ...(sample.workflow === 'final_review' ? {
      initialReview: { decision: 'Approved' as const, reason: 'Synthetic initial review release for final-review fixture.', reviewerUid: userIds.admin, reviewedAt: now - 64_800_000 },
    } : {}),
    controlListGenerated: false, createdAt: now - 86_400_000, updatedAt: now, submittedAt: now - 86_400_000,
    sterasFixture: marker(sample),
    _fixtureVersion: version,
    _fixtureAssignments: assignments,
  } as unknown as EventRecord;
}

async function removeOwnedExternalDocs(ctx: SterasTestContext, sampleId: RealReviewSampleId): Promise<void> {
  for (const collection of ['public_events', 'public_event_controls'] as const) {
    const reference = ctx.db.collection(collection).doc(sampleId);
    const snapshot = await reference.get();
    if (snapshot.exists) {
      if (!isManaged(snapshot.data(), sampleId)) throw new Error(`Refusing to remove unowned ${collection}/${sampleId}.`);
      await ctx.db.recursiveDelete(reference);
    }
  }
}

async function writeSample(ctx: SterasTestContext, sample: RealReviewSampleDefinition, userIds: UserIds): Promise<void> {
  const eventReference = ctx.db.collection('events').doc(sample.id);
  const existing = await eventReference.get();
  if (existing.exists && !isManaged(existing.data(), sample.id)) throw new Error(`Refusing to replace unowned events/${sample.id}.`);
  if (existing.exists) await ctx.db.recursiveDelete(eventReference);
  await removeOwnedExternalDocs(ctx, sample.id);
  const now = Date.now();
  const evidencePath = `${STORAGE_PREFIX}/${sample.id}/${VERSION_ID}/application-evidence.txt`;
  const evidenceBody = `${FIXTURE_DESCRIPTION}\n${sample.publicFacts}\n${sample.syntheticCapacityNote}\nSynthetic emergency-plan and permit evidence for validation only.`;
  const evidenceFile = getStorage(ctx.app).bucket().file(evidencePath);
  await evidenceFile.save(Buffer.from(evidenceBody, 'utf8'), {
    resumable: false,
    metadata: { contentType: 'text/plain', metadata: { datasetId: REAL_REVIEW_SAMPLE_DATASET_ID, managedBy: MANAGED_BY, fixtureId: sample.id, asOf: REAL_REVIEW_SAMPLE_AS_OF } },
  });
  const [evidenceMetadata] = await evidenceFile.getMetadata();
  const evidenceGeneration = String(evidenceMetadata.generation ?? '');
  if (!/^\d+$/.test(evidenceGeneration)) throw new Error(`Storage generation missing for ${evidencePath}.`);
  const placeholderEvent = { eventId: sample.id, organizerId: userIds.organizer, eventDetails: eventDetails(sample) } as EventRecord;
  const artifacts = buildArtifacts(sample, placeholderEvent, userIds, now, evidenceGeneration);
  const event = sampleEvent(sample, userIds, artifacts, now, Number(evidenceMetadata.size ?? Buffer.byteLength(evidenceBody))) as EventRecord & { _fixtureVersion: EventVersion; _fixtureAssignments: Array<Record<string, unknown>> };
  const { _fixtureVersion: version, _fixtureAssignments: assignments, ...eventData } = event;
  const batch = ctx.db.batch();
  batch.set(eventReference, eventData);
  batch.set(eventReference.collection('versions').doc(VERSION_ID), version);
  batch.set(eventReference.collection('assessments').doc(artifacts.assessment.assessmentId), artifacts.assessment);
  if (artifacts.resource) batch.set(eventReference.collection('resources').doc(artifacts.resource.resourceId), artifacts.resource);
  batch.set(ctx.db.collection('venues').doc(`fixture-venue-${sample.id}`), venueRecord(sample, now));
  for (const assignment of assignments) {
    batch.set(eventReference.collection('assignments').doc(String(assignment.assignmentId)), assignment);
  }
  for (const review of artifacts.reviews) {
    batch.set(eventReference.collection('assessments').doc(artifacts.assessment.assessmentId).collection('score_reviews').doc(review.reviewId), review);
  }
  batch.set(eventReference.collection('audit_logs').doc(`fixture-${sample.id}-created`), {
    id: `fixture-${sample.id}-created`, eventId: sample.id, versionId: VERSION_ID, action: 'fixture_seeded', actorId: userIds.admin,
    actorRole: 'admin', timestamp: now, notes: `${FIXTURE_DESCRIPTION} ${sample.publicFacts}`, metadata: marker(sample),
  });
  for (const assignment of assignments) {
    batch.set(eventReference.collection('decisions').doc(String(assignment.assignmentId)), {
      decisionId: assignment.assignmentId, eventId: sample.id, versionId: VERSION_ID, authorityType: assignment.authorityType,
      decision: assignment.decision, rationale: assignment.reason, suggestion: assignment.suggestion, reviewerId: assignment.officerUid,
      decidedAt: assignment.decidedAt, current: true, sterasFixture: marker(sample),
    });
    batch.set(eventReference.collection('decision_history').doc(`${assignment.assignmentId}_initial`), {
      decisionId: `${assignment.assignmentId}_initial`, eventId: sample.id, versionId: VERSION_ID, authorityType: assignment.authorityType,
      decision: assignment.decision, rationale: assignment.reason, suggestion: assignment.suggestion, reviewerId: assignment.officerUid,
      decidedAt: assignment.decidedAt, current: false, sterasFixture: marker(sample),
    });
  }
  await batch.commit();
}

async function verifySample(ctx: SterasTestContext, sample: RealReviewSampleDefinition): Promise<string[]> {
  const failures: string[] = [];
  const eventReference = ctx.db.collection('events').doc(sample.id);
  const eventSnapshot = await eventReference.get();
  const event = eventSnapshot.data() as Partial<EventRecord> | undefined;
  const expectedLabel = sample.workflow === 'initial_review' ? 'Initial Review' : sample.workflow === 'manual_review_required' ? 'Manual Review Required' : 'Final Review';
  if (!eventSnapshot.exists || !isManaged(eventSnapshot.data(), sample.id)) failures.push(`${sample.id}: event missing or marker invalid`);
  if (event?.eventDetails?.name !== sample.name) failures.push(`${sample.id}: official event name changed`);
  if (event?.eventDetails?.description?.includes(FIXTURE_DESCRIPTION) !== true) failures.push(`${sample.id}: fixture warning missing`);
  if (event?.status !== (sample.workflow === 'manual_review_required' ? 'Manual Review Required' : sample.workflow === 'initial_review' ? 'Pending' : 'UnderReview')) failures.push(`${sample.id}: persisted status is invalid`);
  if (event?.reviewStage !== (sample.workflow === 'initial_review' ? 'initial' : sample.workflow === 'manual_review_required' ? 'manual' : 'second')) failures.push(`${sample.id}: review stage is invalid`);
  const requiredAuthorities = event?.requiredAuthorities ?? [];
  const expectedAuthorities = [...sample.requiredAuthorities].sort().join(',');
  if ([...requiredAuthorities].sort().join(',') !== expectedAuthorities) failures.push(`${sample.id}: required authority set is invalid`);
  const [version, assessment, resource, assignments, venue, publicEvent, decisions] = await Promise.all([
    eventReference.collection('versions').doc(VERSION_ID).get(),
    event?.currentAssessmentId ? eventReference.collection('assessments').doc(event.currentAssessmentId).get() : Promise.resolve(undefined),
    event?.currentResourceId ? eventReference.collection('resources').doc(event.currentResourceId).get() : Promise.resolve(undefined),
    eventReference.collection('assignments').get(),
    ctx.db.collection('venues').doc(`fixture-venue-${sample.id}`).get(),
    ctx.db.collection('public_events').doc(sample.id).get(),
    eventReference.collection('decisions').get(),
  ]);
  if (!version?.exists || !assessment?.exists) failures.push(`${sample.id}: current version or assessment is missing`);
  const venueData = venue.data() as (Partial<Venue> & { sterasFixture?: ManagedMarker }) | undefined;
  if (!venue.exists || !venueData) {
    failures.push(`${sample.id}: verified fixture venue registry record is missing or invalid`);
  } else if (!isManaged(venueData, sample.id)
    || venueData.active !== true || venueData.verificationStatus !== 'verified'
    || venueData.state !== stateForSample(sample)
    || venueData.name !== sample.venueName || venueData.address !== sample.venueAddress
    || venueData.capacity !== sample.venueCapacity) {
    failures.push(`${sample.id}: verified fixture venue registry record is missing or invalid`);
  }
  if (publicEvent.exists) failures.push(`${sample.id}: managed fixture must not be present in public_events`);
  if (sample.workflow !== 'manual_review_required' && !resource?.exists) failures.push(`${sample.id}: current resource is missing`);
  if (sample.workflow === 'manual_review_required' && event?.currentResourceId) failures.push(`${sample.id}: manual-review fixture unexpectedly has a resource pointer`);
  const assessmentData = assessment?.data() as Partial<RiskAssessment> | undefined;
  const evidencePath = `${STORAGE_PREFIX}/${sample.id}/${VERSION_ID}/application-evidence.txt`;
  const evidenceFile = getStorage(ctx.app).bucket().file(evidencePath);
  const [evidenceExists, evidenceMetadata] = await Promise.all([
    evidenceFile.exists().then(([exists]) => exists),
    evidenceFile.getMetadata().then(([metadata]) => metadata).catch(() => undefined),
  ]);
  const contextEvidence = assessmentData?.contextEvidence?.find((item) => item.sourceLocator === evidencePath);
  if (!evidenceExists || !evidenceMetadata?.generation || contextEvidence?.sourceVersion !== `storage-generation:${evidenceMetadata.generation}`) {
    failures.push(`${sample.id}: submitted evidence generation provenance is invalid`);
  }
  const actualAssignmentCount = assignments.docs.filter((doc) => doc.data().versionId === VERSION_ID).length;
  if (sample.workflow === 'final_review' && actualAssignmentCount !== sample.requiredAuthorities.length) failures.push(`${sample.id}: final-review assignments are incomplete`);
  if (sample.workflow !== 'final_review' && actualAssignmentCount !== 0) failures.push(`${sample.id}: non-final fixture unexpectedly has assignments`);
  if (sample.workflow !== 'final_review' && (event?.assignedOfficerUids?.length ?? 0) !== 0) failures.push(`${sample.id}: non-final fixture has assigned officer ids`);
  if (sample.workflow === 'final_review') {
    const currentAssignments = assignments.docs
      .map((doc) => doc.data() as Partial<Assignment>)
      .filter((assignment) => assignment.versionId === VERSION_ID);
    const currentDecisions = decisions.docs
      .map((doc) => doc.data() as Partial<AuthorityScoreReview> & { current?: boolean })
      .filter((decision) => decision.versionId === VERSION_ID && decision.current !== false);
    if (currentAssignments.some((assignment) => assignment.status !== 'completed' || !assignment.decision)) {
      failures.push(`${sample.id}: final-review assignments are not all completed with decisions`);
    }
    if (currentDecisions.length !== sample.requiredAuthorities.length) {
      failures.push(`${sample.id}: final-review decision records are incomplete`);
    }
  }
  if (sample.workflow === 'initial_review') {
    const scoreReviews = assessment?.exists
      ? await assessment.ref.collection('score_reviews').get()
      : undefined;
    if (assessmentData?.status !== 'provisional_ready') failures.push(`${sample.id}: initial fixture assessment is not provisional_ready`);
    if (assessmentData && 'authorityReviewState' in assessmentData && assessmentData.authorityReviewState) failures.push(`${sample.id}: initial fixture contains authority review state`);
    if (scoreReviews && !scoreReviews.empty) failures.push(`${sample.id}: initial fixture contains score reviews`);
  }
  if (sample.workflow === 'manual_review_required') {
    const scoreReviews = assessment?.exists ? await assessment.ref.collection('score_reviews').get() : undefined;
    const resources = await eventReference.collection('resources').get();
    if (scoreReviews && !scoreReviews.empty) failures.push(`${sample.id}: manual-review fixture contains premature score reviews`);
    if (!resources.empty) failures.push(`${sample.id}: manual-review fixture contains a resource document`);
  }
  const displayState = resolveApplicationDisplayState({
    status: event?.status ?? 'Pending', reviewStage: event?.reviewStage, currentVersionId: event?.currentVersionId,
    currentAssessmentId: event?.currentAssessmentId, currentResourceId: event?.currentResourceId,
    controlListGenerated: event?.controlListGenerated, initialReview: event?.initialReview,
    requiredAuthorities: event?.requiredAuthorities, assignedOfficerUids: event?.assignedOfficerUids,
    assessmentStatus: (assessment?.data() as Partial<RiskAssessment> | undefined)?.status,
    assessmentReadiness: (assessment?.data() as Partial<RiskAssessment> | undefined)?.assessmentReadiness,
    assignments: assignments.docs.map((doc) => doc.data() as Pick<Assignment, 'versionId' | 'authorityType' | 'status' | 'decision'>),
  });
  if (displayState !== expectedLabel) failures.push(`${sample.id}: derived state ${displayState}, expected ${expectedLabel}`);
  return failures;
}

export async function runRealReviewSampleSeed(action: Action, ctx = initializeSterasTestContext()): Promise<void> {
  assertProductionGuard(ctx.projectId, action);
  await assertNoCollisions(ctx);
  if (action === 'dry-run') {
    console.info(JSON.stringify({ projectId: ctx.projectId, datasetId: REAL_REVIEW_SAMPLE_DATASET_ID, asOf: REAL_REVIEW_SAMPLE_AS_OF, events: REAL_REVIEW_SAMPLE_EVENT_IDS.map((id) => ({ ...REAL_REVIEW_SAMPLES[id], startIso: REAL_REVIEW_SAMPLES[id].startIso, endIso: REAL_REVIEW_SAMPLES[id].endIso })), guardedWrites: `requires ${ALLOW_PRODUCTION_ENV}=true`, requiredAccounts: [STERAS_TEST_ACCOUNT_EMAILS.admin, STERAS_TEST_ACCOUNT_EMAILS.organizer, STERAS_TEST_ACCOUNT_EMAILS.PDRM, STERAS_TEST_ACCOUNT_EMAILS.BOMBA, STERAS_TEST_ACCOUNT_EMAILS.KKM, STERAS_TEST_ACCOUNT_EMAILS.DBKL, STERAS_TEST_ACCOUNT_EMAILS.MOTAC] }, null, 2));
    return;
  }
  const userIds = await resolveRequiredUsers(ctx);
  if (action === 'apply') {
    for (const sampleId of REAL_REVIEW_SAMPLE_EVENT_IDS) await writeSample(ctx, REAL_REVIEW_SAMPLES[sampleId], userIds);
    console.info(`[${MANAGED_BY}] applied ${REAL_REVIEW_SAMPLE_EVENT_IDS.length} samples to ${ctx.projectId}.`);
    return;
  }
  const failures = (await Promise.all(REAL_REVIEW_SAMPLE_EVENT_IDS.map((sampleId) => verifySample(ctx, REAL_REVIEW_SAMPLES[sampleId])))).flat();
  if (failures.length > 0) throw new Error(`Real review sample verification failed:\n- ${failures.join('\n- ')}`);
  console.info(`[${MANAGED_BY}] verification complete for ${ctx.projectId}.`);
}

if (require.main === module) {
  runRealReviewSampleSeed(parseAction(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
