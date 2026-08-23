"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseM3UatAction = parseM3UatAction;
exports.assertSharedProjectAuthorization = assertSharedProjectAuthorization;
exports.initializeM3UatContext = initializeM3UatContext;
exports.applyM3UatDataset = applyM3UatDataset;
exports.verifyM3UatDataset = verifyM3UatDataset;
exports.prepareM3UatForPlaywright = prepareM3UatForPlaywright;
exports.resetM3UatControlVerificationForPlaywright = resetM3UatControlVerificationForPlaywright;
exports.runM3UatAction = runM3UatAction;
const node_crypto_1 = require("node:crypto");
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
const storage_1 = require("firebase-admin/storage");
const m3UatFixtures_1 = require("../../../shared/m3UatFixtures");
const types_1 = require("../../../shared/types");
const categorySchema_1 = require("../config/categorySchema");
const authorityFinalisation_1 = require("../engines/authorityFinalisation");
const resourceCalculator_1 = require("../engines/resourceCalculator");
const assessmentValidator_1 = require("../engines/assessmentValidator");
const ruleBased_1 = require("../engines/ruleBased");
const resourceContract_1 = require("../engines/resourceContract");
const onEventCreated_1 = require("../triggers/onEventCreated");
const MANAGED_BY = 'seed:m3:uat';
const VERSION_ID = 'v1';
const STORAGE_BUCKET = process.env.M3_UAT_STORAGE_BUCKET
    ?? `${m3UatFixtures_1.M3_UAT_SHARED_PROJECT_ID}.firebasestorage.app`;
const REQUIRED_AUTHORITIES = ['PDRM', 'BOMBA', 'KKM', 'DBKL'];
const SCENARIOS = [
    { id: m3UatFixtures_1.M3_UAT_EVENTS.initialReady, name: 'Initial Review Ready', status: 'Pending', requiredAuthorities: ['PDRM', 'BOMBA', 'KKM'], reviewStage: 'initial' },
    { id: m3UatFixtures_1.M3_UAT_EVENTS.complianceBlocked, name: 'Compliance Blocked', status: 'UnderReview', requiredAuthorities: ['PDRM', 'BOMBA'], reviewStage: 'authority', complianceStatus: 'blocked', assignments: 'pending' },
    { id: m3UatFixtures_1.M3_UAT_EVENTS.provisionalReview, name: 'Provisional Manual Review', status: 'Manual Review Required', requiredAuthorities: ['PDRM', 'BOMBA'], reviewStage: 'manual', assessmentReadiness: 'provisional' },
    { id: m3UatFixtures_1.M3_UAT_EVENTS.awaitingAssignment, name: 'Awaiting Officer Assignment', status: 'UnderReview', requiredAuthorities: REQUIRED_AUTHORITIES, reviewStage: 'initial' },
    { id: m3UatFixtures_1.M3_UAT_EVENTS.authorityPartial, name: 'Authority Review In Progress', status: 'UnderReview', requiredAuthorities: REQUIRED_AUTHORITIES, reviewStage: 'authority', assignments: 'partial' },
    { id: m3UatFixtures_1.M3_UAT_EVENTS.secondReview, name: 'Second Review Ready', status: 'UnderReview', requiredAuthorities: REQUIRED_AUTHORITIES, reviewStage: 'second', assignments: 'complete' },
    { id: m3UatFixtures_1.M3_UAT_EVENTS.rejected, name: 'Rejected Application', status: 'Rejected', requiredAuthorities: REQUIRED_AUTHORITIES, reviewStage: 'closed', assignments: 'complete', finalDecision: 'Rejected' },
    { id: m3UatFixtures_1.M3_UAT_EVENTS.secondReviewRejected, name: 'Second Review Rejected', status: 'Rejected', requiredAuthorities: REQUIRED_AUTHORITIES, reviewStage: 'closed', assignments: 'complete', finalDecision: 'Rejected' },
    { id: m3UatFixtures_1.M3_UAT_EVENTS.controlVerification, name: 'Stage 1 Control Verification', status: 'Approved', requiredAuthorities: REQUIRED_AUTHORITIES, reviewStage: null, controls: 'stage1' },
    { id: m3UatFixtures_1.M3_UAT_EVENTS.publicStage2, name: 'Published Stage 2 Evidence', status: 'Approved', requiredAuthorities: REQUIRED_AUTHORITIES, reviewStage: null, controls: 'stage2' },
];
const IDENTITIES = [
    { key: 'admin', email: m3UatFixtures_1.M3_UAT_ACCOUNT_EMAILS.admin, name: 'M3 UAT Admin', role: 'admin' },
    { key: 'organizer', email: m3UatFixtures_1.M3_UAT_ACCOUNT_EMAILS.organizer, name: 'M3 UAT Organizer', role: 'organizer' },
    { key: 'public', email: m3UatFixtures_1.M3_UAT_ACCOUNT_EMAILS.public, name: 'M3 UAT Public User', role: 'public' },
    ...['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'].map((authorityType) => ({
        key: authorityType,
        email: m3UatFixtures_1.M3_UAT_ACCOUNT_EMAILS[authorityType],
        name: `M3 UAT ${authorityType} Officer`,
        role: 'authority',
        authorityType,
    })),
];
function parseM3UatAction(argv) {
    const flags = argv.filter((value) => ['--dry-run', '--apply', '--verify', '--cleanup'].includes(value));
    if (flags.length !== 1) {
        throw new Error('Choose exactly one action: --dry-run, --apply, --verify, or --cleanup.');
    }
    return flags[0].slice(2);
}
function assertSharedProjectAuthorization(projectId, action) {
    if (projectId !== m3UatFixtures_1.M3_UAT_SHARED_PROJECT_ID) {
        throw new Error(`Refusing target ${projectId}. This dataset is locked to ${m3UatFixtures_1.M3_UAT_SHARED_PROJECT_ID}.`);
    }
    if (['apply', 'cleanup'].includes(action) && process.env.M3_UAT_ALLOW_SHARED_PROJECT !== 'true') {
        throw new Error('Set M3_UAT_ALLOW_SHARED_PROJECT=true to authorize writes to the shared linkos project.');
    }
    if (action === 'cleanup' && process.env.M3_UAT_CONFIRM_DATASET !== m3UatFixtures_1.M3_UAT_DATASET_ID) {
        throw new Error(`Set M3_UAT_CONFIRM_DATASET=${m3UatFixtures_1.M3_UAT_DATASET_ID} before cleanup.`);
    }
}
function initializeM3UatContext() {
    const projectId = (process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? '').trim();
    if (!projectId)
        throw new Error('Set FIREBASE_PROJECT_ID explicitly.');
    const app = (0, app_1.getApps)()[0] ?? (0, app_1.initializeApp)({
        credential: (0, app_1.applicationDefault)(),
        projectId,
        storageBucket: STORAGE_BUCKET,
    });
    return {
        projectId,
        app,
        db: (0, firestore_1.getFirestore)(app),
        auth: (0, auth_1.getAuth)(app),
        password: process.env.M3_UAT_PASSWORD?.trim() ?? process.env.STERAS_E2E_PASSWORD?.trim() ?? '',
    };
}
function marker(fixtureId) {
    return { datasetId: m3UatFixtures_1.M3_UAT_DATASET_ID, managedBy: MANAGED_BY, ...(fixtureId ? { fixtureId } : {}) };
}
function isManaged(data, fixtureId) {
    const value = data?.m3Uat;
    return value?.datasetId === m3UatFixtures_1.M3_UAT_DATASET_ID
        && value?.managedBy === MANAGED_BY
        && (!fixtureId || value.fixtureId === fixtureId);
}
async function findAuthUser(auth, email) {
    try {
        return await withTransientAuthRetry(() => auth.getUserByEmail(email));
    }
    catch (error) {
        if (error.code === 'auth/user-not-found')
            return null;
        throw error;
    }
}
async function withTransientAuthRetry(operation) {
    let lastError;
    for (const delayMs of [0, 500, 1_500]) {
        if (delayMs > 0)
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        try {
            return await operation();
        }
        catch (error) {
            lastError = error;
            const code = error.code ?? '';
            const message = error instanceof Error ? error.message : String(error);
            const transient = code === 'app/unable-to-parse-response'
                || code === 'auth/internal-error'
                || /status code:\s*"?5\d\d|\b50[234]\b/i.test(message);
            if (!transient)
                throw error;
        }
    }
    throw lastError;
}
async function assertNoCollisions(ctx) {
    for (const eventId of [...m3UatFixtures_1.M3_UAT_EVENT_IDS, ...m3UatFixtures_1.M3_UAT_RETIRED_EVENT_IDS]) {
        const snap = await ctx.db.collection('events').doc(eventId).get();
        if (snap.exists && !isManaged(snap.data(), eventId)) {
            throw new Error(`Collision at events/${eventId}: existing document is not owned by ${m3UatFixtures_1.M3_UAT_DATASET_ID}.`);
        }
    }
    for (const identity of IDENTITIES) {
        const authUser = await findAuthUser(ctx.auth, identity.email);
        if (!authUser)
            continue;
        const profile = await ctx.db.collection('users').doc(authUser.uid).get();
        if (!profile.exists || !isManaged(profile.data(), identity.email)) {
            throw new Error(`Collision for Auth identity ${identity.email}: its profile is not owned by ${m3UatFixtures_1.M3_UAT_DATASET_ID}.`);
        }
    }
}
async function ensureIdentities(ctx) {
    if (ctx.password.length < 12)
        throw new Error('Set M3_UAT_PASSWORD to at least 12 characters.');
    const now = Date.now();
    const uids = {};
    for (const identity of IDENTITIES) {
        let authUser = await findAuthUser(ctx.auth, identity.email);
        if (!authUser) {
            authUser = await withTransientAuthRetry(() => ctx.auth.createUser({ email: identity.email, password: ctx.password, displayName: identity.name }));
        }
        else {
            await withTransientAuthRetry(() => ctx.auth.updateUser(authUser.uid, { password: ctx.password, displayName: identity.name, disabled: false }));
        }
        uids[identity.key] = authUser.uid;
        await ctx.db.collection('users').doc(authUser.uid).set({
            uid: authUser.uid,
            email: identity.email,
            name: identity.name,
            role: identity.role,
            ...(identity.authorityType ? { authorityType: identity.authorityType } : {}),
            m3Uat: marker(identity.email),
            createdAt: now,
            updatedAt: now,
        });
        if (identity.authorityType) {
            await ctx.db.collection('officers').doc(authUser.uid).set({
                uid: authUser.uid,
                authorityType: identity.authorityType,
                state: 'ALL',
                scopeType: 'federal',
                workloadCount: 0,
                workloadLimit: 20,
                active: true,
                m3Uat: marker(identity.email),
                createdAt: now,
                updatedAt: now,
            });
        }
    }
    return uids;
}
function processingHash(versionInputHash) {
    return (0, node_crypto_1.createHash)('sha256').update(JSON.stringify({
        versionInputHash,
        categorySchemaVersion: '2026-07-24-all-hazards-v2',
        scoringLogicVersion: '2026-07-24-hirarc-residual-v2',
        promptVersion: 'v4.0.0-all-hazards-evidence-advisory',
        aiResponseSchemaVersion: '2026-07-24-all-hazards-advisory-v2',
        formulaVersion: '2026-07-24-prototype-range-v3',
        guidelineVersion: '2026-07-24-malaysia-research-v2',
    })).digest('hex');
}
function eventDetails(scenario, now) {
    return {
        name: `[M3 UAT] ${scenario.name}`,
        type: 'cultural',
        venueId: 'm3-uat-venue-selangor',
        venueName: 'M3 UAT Selangor Test Venue',
        venueAddress: 'Persiaran Bandar Raya, Shah Alam, Selangor',
        venueLocation: { lat: 3.0738, lng: 101.5183 },
        venueCapacity: 12_000,
        expectedAttendance: 4_000,
        environment: 'outdoor',
        coverage: 'partially_covered',
        seating: 'mixed',
        startDatetime: now + 30 * 24 * 60 * 60 * 1000,
        endDatetime: now + 30 * 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000,
        description: `Isolated ${m3UatFixtures_1.M3_UAT_DATASET_ID} scenario. Do not use as operational data.`,
        emergencyPlanSummary: 'UAT emergency, evacuation, medical, traffic and authority coordination plan.',
        riskProfile: {
            crowdManagementPlan: true,
            trafficManagementPlan: true,
            severeWeatherPlan: true,
            medicalPlan: true,
            evacuationPlanTested: true,
            authorityCoordinationConfirmed: true,
        },
        organizerName: 'M3 UAT Organizer',
        organizerEmail: m3UatFixtures_1.M3_UAT_ACCOUNT_EMAILS.organizer,
        organizerPhone: '+60 12-000 0303',
    };
}
function assessmentContext(scenario, now) {
    return {
        weather: {
            data: { forecast: 'Partly cloudy', temperature: 31, humidity: 75, windSpeed: 12, precipitationProbability: 20, severeAlert: false },
            measurementStatus: 'available',
            source: 'openweather',
            freshness: 'fresh',
            fetchedAt: now,
            expiresAt: now + 21_600_000,
            forecastFor: now + 3_600_000,
        },
        calendar: {
            localDate: new Date(now).toISOString().slice(0, 10),
            dayOfWeek: 'Saturday',
            isWeekend: true,
            isHolidayOrAdjacent: false,
            sourceVersion: 'm3-uat-v1',
            sourceTimestamp: now,
            coverageStatus: 'verified',
        },
        venue: {
            matched: true,
            venueId: 'm3-uat-venue-selangor',
            submittedCapacity: 12_000,
            registeredCapacity: 12_000,
            capacityDifference: 0,
            jurisdiction: 'MBSA',
            fireCertificateStatus: 'valid',
            fireCertificateExpiresAt: now + 31_536_000_000,
            emergencyAccessVerified: true,
            nearestHospitalTravelMinutes: 10,
            fetchedAt: now,
        },
        incidentHistory: {
            matched: false,
            venueId: 'm3-uat-venue-selangor',
            incidentIds: [],
            total: 0,
            bySeverity: { low: 0, medium: 0, high: 0 },
            syntheticStatus: 'none',
            fetchedAt: now,
        },
    };
}
function uatProposal(baseline, scenario, now) {
    const evidenceByCategory = {
        crowd: 'crowd', venue_fire: 'venue', weather_environment: 'weather', public_health: 'crowd',
        food_water_sanitation: 'venue', medical_capacity: 'venue', security_cbrn: 'crowd', transport_accessibility: 'venue',
    };
    return {
        status: 'success',
        proposalId: `m3-uat-proposal-${scenario.id}`,
        model: 'm3-uat-fixture',
        promptVersion: 'm3-uat-v1',
        responseSchemaVersion: 'm3-uat-v1',
        hazards: [],
        categories: categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({
            categoryId: category.id,
            likelihood: 2,
            severity: 2,
            evidenceReferences: [evidenceByCategory[category.id]],
            rationale: `Deterministic UAT evidence for ${category.name}.`,
            confidence: 'high',
            concerns: [],
            missingInformation: [],
        })),
        cacheStatus: 'not-applicable',
        generatedAt: now,
    };
}
function buildAssessmentArtifacts(scenario, event, uids, now) {
    const assessmentId = `assessment-${VERSION_ID}-${scenario.id}`;
    const context = assessmentContext(scenario, now);
    const baseline = (0, ruleBased_1.computeCategoryBasedAssessment)(event, context, now);
    const proposal = uatProposal(baseline, scenario, now);
    const validation = (0, assessmentValidator_1.validateAndCalculateProvisional)(proposal, baseline, now);
    if (!validation.ok)
        throw new Error(`Unable to create M2 UAT assessment: ${validation.reason}`);
    const common = {
        assessmentId,
        eventId: scenario.id,
        versionId: VERSION_ID,
        schemaVersion: types_1.ASSESSMENT_SCHEMA_VERSION,
        contextSnapshot: context,
        evidence: baseline.evidence,
        contextEvidence: [{ evidenceId: `m3-uat-${scenario.id}-context`, evidenceKey: 'compliance', sourceKind: 'submitted_document', sourceLocator: `event_documents/${scenario.id}/${VERSION_ID}/evidence.pdf`, retrievedAt: now, sourceVersion: 'm3-uat-v1', eligibility: 'eligible', synthetic: true, visibility: 'authority_only' }],
        sourceTimestamps: { weather: now, holiday: now, venue: now, incidents: now },
        contextStatuses: { weather: 'm3-uat:matched', holiday: 'm3-uat:verified', venue: 'matched', incidents: 'unmatched' },
        assessmentReadiness: scenario.assessmentReadiness ?? 'complete',
        complianceStatus: scenario.complianceStatus ?? 'pass',
        complianceChecks: baseline.complianceChecks ?? [],
        dataConfidenceScore: baseline.dataConfidenceScore ?? 100,
        dataConfidenceLevel: baseline.dataConfidenceLevel ?? 'high',
        inputHash: processingHash(`${m3UatFixtures_1.M3_UAT_DATASET_ID}:${scenario.id}:${VERSION_ID}`),
        createdAt: now,
    };
    if (scenario.id === m3UatFixtures_1.M3_UAT_EVENTS.provisionalReview) {
        const manualAssessment = {
            ...common,
            status: 'manual_review_required',
            aiProposal: null,
            warnings: [{ warningId: `m3-uat-${scenario.id}-manual`, code: 'missing_evidence', message: 'M3 UAT manual-review fixture.', evidenceReferences: [] }],
            authorityReviewRequired: true,
            manualReviewReason: 'M3 UAT fixture requires the Admin manual assessment queue.',
            assessmentReadiness: 'insufficient_data',
            m3Uat: marker(scenario.id),
        };
        const calculation = (0, resourceCalculator_1.computeResources)({ eventId: scenario.id, versionId: VERSION_ID, assessmentId, eventDetails: event.eventDetails, assessmentResult: validation.result });
        if (!calculation.ok)
            throw new Error(calculation.message);
        return { assessment: manualAssessment, resource: provisionalResource(scenario, assessmentId, calculation, now), reviews: [] };
    }
    const reviews = scenario.requiredAuthorities.map((authority) => ({
        reviewId: `${assessmentId}-${authority}-review`,
        schemaVersion: types_1.SCORE_REVIEW_SCHEMA_VERSION,
        eventId: scenario.id,
        versionId: VERSION_ID,
        assessmentId,
        proposalId: validation.result.proposalId,
        provisionalCalculatedAt: now,
        assessmentInputHash: common.inputHash,
        categorySchemaVersion: categorySchema_1.ACTIVE_CATEGORY_SCHEMA.version,
        authorityType: authority,
        reviewerId: uids[authority],
        categories: proposal.categories.map((category) => ({ categoryId: category.categoryId, likelihood: category.likelihood, severity: category.severity, decision: 'confirmed' })),
        rationale: `M3 UAT ${authority} review confirms the current assessment evidence.`,
        idempotencyKey: `${assessmentId}-${authority}-review-key`,
        createdAt: now,
    }));
    const provisional = {
        ...common,
        status: 'authority_review',
        aiProposal: proposal,
        warnings: validation.warnings,
        authorityReviewRequired: true,
        provisionalResult: validation.result,
    };
    const officialResult = (0, authorityFinalisation_1.buildOfficialAssessmentResult)({
        assessment: provisional,
        eventDetails: event.eventDetails,
        requiredAuthorities: scenario.requiredAuthorities,
        reviews,
        finalizedAt: now,
        finalizedBy: uids.admin,
    });
    const officialAssessment = {
        ...provisional,
        status: 'official_ready',
        authorityReviewRequired: false,
        authorityReviewState: (0, authorityFinalisation_1.buildAuthorityReviewState)(scenario.requiredAuthorities, reviews, now),
        officialResult,
        m3Uat: marker(scenario.id),
    };
    const calculation = (0, resourceCalculator_1.computeResources)({ eventId: scenario.id, versionId: VERSION_ID, assessmentId, eventDetails: event.eventDetails, assessmentResult: officialResult });
    if (!calculation.ok)
        throw new Error(calculation.message);
    return { assessment: officialAssessment, resource: officialResource(scenario, assessmentId, calculation, uids.admin, now), reviews };
}
function provisionalResource(scenario, assessmentId, calculation, now) {
    return {
        resourceId: (0, onEventCreated_1.resourceDocumentId)('provisional', VERSION_ID, calculation.resourceInputHash),
        eventId: scenario.id,
        versionId: VERSION_ID,
        assessmentId,
        schemaVersion: types_1.RESOURCE_SCHEMA_VERSION,
        stage: 'provisional',
        revision: 1,
        supersedesResourceId: null,
        assessmentReference: { stage: 'provisional', assessmentId, proposalId: `m3-uat-proposal-${scenario.id}` },
        resourceInputHash: calculation.resourceInputHash,
        formulaVersion: calculation.formulaVersion,
        configVersion: calculation.configVersion,
        sourceRegistryVersion: calculation.sourceRegistryVersion,
        items: calculation.items,
        confidenceLevel: 'prototype',
        authorityReviewRequired: true,
        validationScope: 'provisional_risk_input',
        notes: 'M3 UAT fixture; not an operational deployment authorisation.',
        computedAt: now,
    };
}
function officialResource(scenario, assessmentId, calculation, finalizedBy, now) {
    return {
        resourceId: (0, onEventCreated_1.resourceDocumentId)('official', VERSION_ID, calculation.resourceInputHash),
        eventId: scenario.id,
        versionId: VERSION_ID,
        assessmentId,
        schemaVersion: types_1.RESOURCE_SCHEMA_VERSION,
        stage: 'official',
        revision: 1,
        supersedesResourceId: null,
        assessmentReference: { stage: 'official', assessmentId, proposalId: `m3-uat-proposal-${scenario.id}`, finalizedAt: now, finalizedBy },
        resourceInputHash: calculation.resourceInputHash,
        formulaVersion: calculation.formulaVersion,
        configVersion: calculation.configVersion,
        sourceRegistryVersion: calculation.sourceRegistryVersion,
        items: Object.fromEntries(types_1.RESOURCE_KEYS.map((key) => [key, { ...calculation.items[key], confidence: 'authority_validated', authorityReviewRequired: false }])),
        confidenceLevel: 'authority_validated',
        authorityReviewRequired: false,
        validationScope: 'official_risk_input_only',
        notes: 'M3 UAT fixture; not an operational deployment authorisation.',
        computedAt: now,
    };
}
function assignmentDecision(authority, scenario) {
    if (scenario.assignments === 'complete') {
        if (scenario.finalDecision === 'Rejected' && authority === 'PDRM')
            return 'Rejected';
        return 'Approved';
    }
    if (scenario.assignments === 'partial' && authority === 'PDRM')
        return 'Approved';
    return undefined;
}
async function writeScenario(ctx, scenario, uids) {
    const now = Date.now();
    const details = eventDetails(scenario, now);
    const eventRef = ctx.db.collection('events').doc(scenario.id);
    const assigned = scenario.assignments && scenario.assignments !== 'none'
        ? scenario.requiredAuthorities
        : [];
    const assignedOfficerByAuthority = Object.fromEntries(assigned.map((authority) => [authority, uids[authority]]));
    const eventBase = {
        eventId: scenario.id,
        organizerId: uids.organizer,
        eventDetails: details,
        status: scenario.status,
        currentVersionId: VERSION_ID,
        currentVersionNumber: 1,
        editableVersionId: null,
        draftDocumentPaths: [],
        requiredAuthorities: scenario.requiredAuthorities,
        assignedOfficerUids: assigned.map((authority) => uids[authority]),
        assignedOfficerByAuthority,
        reviewStage: scenario.reviewStage ?? null,
        controlListGenerated: scenario.controls === 'stage1' || scenario.controls === 'stage2',
        createdAt: now,
        updatedAt: now,
        submittedAt: now,
        m3Uat: marker(scenario.id),
    };
    const artifacts = buildAssessmentArtifacts(scenario, eventBase, uids, now);
    const event = {
        ...eventBase,
        currentAssessmentId: artifacts.assessment.assessmentId,
        currentResourceId: artifacts.resource.resourceId,
    };
    if (scenario.reviewStage && ['authority', 'second', 'closed'].includes(scenario.reviewStage)) {
        event.initialReview = { decision: 'Approved', reason: 'M3 UAT initial review approved.', reviewerUid: uids.admin, reviewedAt: now, manualAssessmentRecorded: scenario.assessmentReadiness === 'provisional' };
    }
    if (scenario.finalDecision) {
        event.secondReview = { confirmedDecision: scenario.finalDecision, reviewerUid: uids.admin, reviewedAt: now, adminNote: `M3 UAT ${scenario.finalDecision} outcome.` };
    }
    const batch = ctx.db.batch();
    batch.set(eventRef, event);
    batch.set(eventRef.collection('versions').doc(VERSION_ID), { versionId: VERSION_ID, eventId: scenario.id, versionNumber: 1, eventDetails: details, documentPaths: [], submittedBy: uids.organizer, submittedAt: now, inputHash: processingHash(`${m3UatFixtures_1.M3_UAT_DATASET_ID}:${scenario.id}:version`), m3Uat: marker(scenario.id) });
    batch.set(eventRef.collection('assessments').doc(artifacts.assessment.assessmentId), artifacts.assessment);
    batch.set(eventRef.collection('resources').doc(artifacts.resource.resourceId), { ...artifacts.resource, m3Uat: marker(scenario.id) });
    for (const review of artifacts.reviews) {
        batch.set(eventRef.collection('assessments').doc(artifacts.assessment.assessmentId).collection('score_reviews').doc(review.reviewId), { ...review, m3Uat: marker(scenario.id) });
    }
    batch.set(eventRef.collection('audit_logs').doc('m3-uat-seeded'), { id: 'm3-uat-seeded', eventId: scenario.id, versionId: VERSION_ID, action: 'uat_fixture_seeded', actorId: 'system', actorRole: 'system', timestamp: now, notes: `Seeded ${m3UatFixtures_1.M3_UAT_DATASET_ID}`, m3Uat: marker(scenario.id) });
    for (const authority of assigned) {
        const decision = assignmentDecision(authority, scenario);
        const assignmentId = `${VERSION_ID}_${authority}`;
        batch.set(eventRef.collection('assignments').doc(assignmentId), {
            assignmentId,
            eventId: scenario.id,
            versionId: VERSION_ID,
            authorityType: authority,
            officerUid: uids[authority],
            assignedBy: uids.admin,
            assignedAt: now,
            status: decision ? 'completed' : 'pending',
            ...(decision ? { decision, reason: `${authority} fixture proposal for ${scenario.name}.`, suggestion: decision === 'Approved' ? 'No change required.' : 'Revise the identified safety controls.', decidedAt: now, confirmedReview: decision === 'Approved' } : {}),
            m3Uat: marker(scenario.id),
        });
    }
    await batch.commit();
    if (scenario.controls)
        await writeControls(ctx, scenario, uids, now);
    if (scenario.status === 'Approved')
        await writePublicEvent(ctx, scenario, uids, now);
}
async function writeControls(ctx, scenario, uids, now) {
    const eventRef = ctx.db.collection('events').doc(scenario.id);
    const snapshots = [];
    for (const authority of scenario.requiredAuthorities) {
        const controlId = `${scenario.id}-ctrl-${authority.toLowerCase()}-v1`;
        const controlRef = eventRef.collection('event_controls').doc(controlId);
        const stage1Requirements = [
            { docType: 'application', label: `${authority} acknowledgement`, required: true },
            { docType: 'license', label: `${authority} operating licence`, required: true },
            { docType: 'insurance', label: 'Public liability insurance', required: true },
        ];
        await controlRef.set({
            controlId,
            eventId: scenario.id,
            versionId: VERSION_ID,
            controlName: `${authority} operational compliance`,
            authority,
            stageRequirement: 'stage1_and_stage2',
            stage1Requirements,
            stage2Requirement: { kind: 'image', label: `Photo of ${authority} control at venue` },
            controlItemVersion: 1,
            label: scenario.controls === 'stage2' ? 'approved' : authority === 'PDRM' ? 'resubmit_required' : authority === 'BOMBA' ? 'approved' : 'pending',
            createdAt: now,
            updatedAt: now,
            m3Uat: marker(scenario.id),
        });
        snapshots.push({ controlId, controlName: `${authority} operational compliance`, authority, stageRequirement: 'stage1_and_stage2', stage1RequirementsCount: 3, stage2Label: `Photo of ${authority} control at venue`, controlItemVersion: 1, label: scenario.controls === 'stage2' ? 'approved' : 'pending' });
        const stageBatch = ctx.db.batch();
        for (const requirement of stage1Requirements) {
            const docId = `${controlId}-s1-${requirement.docType}`;
            const status = scenario.controls === 'stage2' || authority === 'BOMBA'
                ? 'verified'
                : authority === 'PDRM' && requirement.docType === 'application'
                    ? 'rejected'
                    : 'pending_verification';
            stageBatch.set(controlRef.collection('stage1_docs').doc(docId), {
                docId,
                docType: requirement.docType,
                label: requirement.label,
                status,
                evidencePath: `events/${scenario.id}/controls/${controlId}/stage1/${docId}.pdf`,
                uploadedAt: now,
                ...(status === 'verified' ? { verifiedBy: uids[authority], verifiedAt: now } : {}),
                ...(status === 'rejected' ? { rejectionReason: 'Fixture rejection: document expired.', rejectionSuggestion: 'Upload a current document.', rejectedBy: uids[authority], rejectedAt: now } : {}),
                m3Uat: marker(scenario.id),
            });
        }
        if (scenario.controls === 'stage2') {
            const docId = `${controlId}-s2`;
            const imageUrl = `https://placehold.co/1200x800/png?text=${encodeURIComponent(`${authority}+M3+UAT`)}`;
            stageBatch.set(controlRef.collection('stage2_docs').doc(docId), { docId, imageUrl, uploadedAt: now, uploadedBy: uids.organizer, published: true, publishedAt: now, publishedBy: uids.admin, publicConfirmCount: authority === 'PDRM' ? 1 : 0, ...(authority === 'PDRM' ? { m4TicketId: 'm3-uat-m4-ticket-001', reportedAt: now } : {}), m3Uat: marker(scenario.id) });
            stageBatch.set(ctx.db.collection('public_event_controls').doc(scenario.id).collection('items').doc(`${controlId}-stage2`), { publicControlId: `${controlId}-stage2`, eventId: scenario.id, versionId: VERSION_ID, controlId, docId, authority, controlName: `${authority} operational compliance`, stage2Label: `Photo of ${authority} control at venue`, imageUrl, publicConfirmCount: authority === 'PDRM' ? 1 : 0, reported: authority === 'PDRM', publishedAt: now, sanitized: true, sanitizedAt: now, sanitizedBy: uids.admin, m3Uat: marker(scenario.id) });
            if (authority === 'PDRM') {
                stageBatch.set(controlRef.collection('stage2_confirms').doc(uids.public), { uid: uids.public, confirmedAt: now, m3Uat: marker(scenario.id) });
                stageBatch.set(controlRef.collection('stage2_reports').doc(uids.public), { uid: uids.public, reportId: 'm3-uat-report-001', reportedAt: now, m3Uat: marker(scenario.id) });
            }
        }
        await stageBatch.commit();
    }
    await eventRef.set({ controlListGenerated: true, controlListSnapshot: snapshots, updatedAt: now }, { merge: true });
    if (scenario.controls === 'stage2') {
        await ctx.db.collection('public_event_controls').doc(scenario.id).set({ eventId: scenario.id, versionId: VERSION_ID, datasetId: m3UatFixtures_1.M3_UAT_DATASET_ID, m3Uat: marker(scenario.id), updatedAt: now });
        await ctx.db.collection('public_reports').doc('m3-uat-report-001').set({ reportId: 'm3-uat-report-001', eventId: scenario.id, versionId: VERSION_ID, controlId: `${scenario.id}-ctrl-pdrm-v1`, docId: `${scenario.id}-ctrl-pdrm-v1-s2`, reporterUid: uids.public, reason: 'UAT report for M4 handoff testing.', status: 'open', m4TicketId: 'm3-uat-m4-ticket-001', createdAt: now, m3Uat: marker(scenario.id) });
    }
}
async function writePublicEvent(ctx, scenario, uids, now) {
    const details = eventDetails(scenario, now);
    await ctx.db.collection('public_events').doc(scenario.id).set({ eventId: scenario.id, versionId: VERSION_ID, eventName: details.name, venueName: details.venueName, eventType: details.type, startDatetime: details.startDatetime, endDatetime: details.endDatetime, approvedBy: scenario.requiredAuthorities, publicStatus: 'approved', publishedBy: uids.admin, m3Uat: marker(scenario.id) });
}
async function deleteQuery(db, query) {
    const snap = await query.get();
    if (snap.empty)
        return 0;
    for (let offset = 0; offset < snap.docs.length; offset += 400) {
        const batch = db.batch();
        snap.docs.slice(offset, offset + 400).forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
    }
    return snap.size;
}
async function clearManagedDataset(ctx, includeIdentities) {
    for (const eventId of [...m3UatFixtures_1.M3_UAT_EVENT_IDS, ...m3UatFixtures_1.M3_UAT_RETIRED_EVENT_IDS]) {
        const eventRef = ctx.db.collection('events').doc(eventId);
        const eventSnap = await eventRef.get();
        const managedParent = eventSnap.exists && isManaged(eventSnap.data(), eventId);
        if (eventSnap.exists) {
            if (!managedParent)
                throw new Error(`Refusing to delete unowned events/${eventId}.`);
            await ctx.db.recursiveDelete(eventRef);
        }
        for (const collection of ['public_events', 'public_event_controls']) {
            const ref = ctx.db.collection(collection).doc(eventId);
            const snap = await ref.get();
            // Module 3 Functions can recreate these exact projections without the
            // fixture marker. They are safe to remove only when the exact parent
            // event was present and verified as dataset-owned above.
            if (snap.exists && !isManaged(snap.data(), eventId) && !managedParent) {
                throw new Error(`Refusing to delete unowned ${collection}/${eventId}.`);
            }
            if (snap.exists)
                await ctx.db.recursiveDelete(ref);
        }
        await deleteQuery(ctx.db, ctx.db.collection('notifications').where('eventId', '==', eventId));
        await deleteQuery(ctx.db, ctx.db.collection('public_reports').where('eventId', '==', eventId));
        await (0, storage_1.getStorage)(ctx.app).bucket().deleteFiles({ prefix: `events/${eventId}/`, force: true }).catch((error) => {
            if (error.code !== 404)
                throw error;
        });
    }
    if (!includeIdentities)
        return;
    for (const identity of IDENTITIES) {
        const authUser = await findAuthUser(ctx.auth, identity.email);
        if (!authUser)
            continue;
        const profileRef = ctx.db.collection('users').doc(authUser.uid);
        const profile = await profileRef.get();
        if (!profile.exists || !isManaged(profile.data(), identity.email))
            throw new Error(`Refusing to delete unowned identity ${identity.email}.`);
        const officerRef = ctx.db.collection('officers').doc(authUser.uid);
        const officer = await officerRef.get();
        if (officer.exists) {
            if (!isManaged(officer.data(), identity.email))
                throw new Error(`Refusing to delete unowned officer ${authUser.uid}.`);
            await officerRef.delete();
        }
        await profileRef.delete();
        await ctx.auth.deleteUser(authUser.uid);
    }
    const venueRef = ctx.db.collection('venues').doc('m3-uat-venue-selangor');
    const venue = await venueRef.get();
    if (venue.exists) {
        if (!isManaged(venue.data(), 'm3-uat-venue-selangor'))
            throw new Error('Refusing to delete unowned fixture venue.');
        await venueRef.delete();
    }
}
async function writeVenue(ctx) {
    const now = Date.now();
    await ctx.db.collection('venues').doc('m3-uat-venue-selangor').set({ venueId: 'm3-uat-venue-selangor', name: 'M3 UAT Selangor Test Venue', address: 'Persiaran Bandar Raya, Shah Alam, Selangor', state: 'Selangor', location: { lat: 3.0738, lng: 101.5183 }, capacity: 12_000, environment: 'outdoor', coverage: 'partially_covered', seating: 'mixed', jurisdiction: 'MBSA', fireCertificateStatus: 'valid', fireCertificateExpiresAt: now + 31_536_000_000, emergencyAccessVerified: true, nearestHospitalTravelMinutes: 10, active: true, createdAt: now, updatedAt: now, m3Uat: marker('m3-uat-venue-selangor') });
}
async function applyM3UatDataset(ctx) {
    await assertNoCollisions(ctx);
    const uids = await ensureIdentities(ctx);
    // Resolve/update Auth before destructive fixture replacement. A transient
    // Identity Toolkit failure must leave the existing Firestore dataset intact.
    await clearManagedDataset(ctx, false);
    await writeVenue(ctx);
    for (const scenario of SCENARIOS)
        await writeScenario(ctx, scenario, uids);
}
async function verifyM3UatDataset(ctx) {
    const failures = [];
    for (const scenario of SCENARIOS) {
        const eventRef = ctx.db.collection('events').doc(scenario.id);
        const event = await eventRef.get();
        const eventData = event.data();
        const assessmentId = eventData?.currentAssessmentId;
        const resourceId = eventData?.currentResourceId;
        const [version, assessmentSnap, resourceSnap, audits] = await Promise.all([
            eventRef.collection('versions').doc(VERSION_ID).get(),
            assessmentId ? eventRef.collection('assessments').doc(assessmentId).get() : Promise.resolve(undefined),
            resourceId ? eventRef.collection('resources').doc(resourceId).get() : Promise.resolve(undefined),
            eventRef.collection('audit_logs').limit(1).get(),
        ]);
        if (!event.exists || !isManaged(event.data(), scenario.id))
            failures.push(`${scenario.id}: event missing or marker invalid`);
        const assessmentData = assessmentSnap?.data();
        const resourceData = resourceSnap?.data();
        if (!version.exists || !assessmentSnap?.exists || !resourceSnap?.exists || audits.empty)
            failures.push(`${scenario.id}: core subdocuments incomplete`);
        if (eventData?.organizerId === undefined || eventData?.currentVersionId !== VERSION_ID
            || !assessmentId || !resourceId || assessmentData?.assessmentId !== assessmentId
            || assessmentData?.eventId !== scenario.id || assessmentData?.versionId !== VERSION_ID
            || resourceData?.resourceId !== resourceId || resourceData?.eventId !== scenario.id
            || resourceData?.versionId !== VERSION_ID || resourceData?.assessmentId !== assessmentId
            || !resourceData || !(0, resourceContract_1.validateResourceRecommendation)(resourceData).ok)
            failures.push(`${scenario.id}: event references invalid current M2 pointers`);
        if (scenario.controls) {
            const controls = await eventRef.collection('event_controls').get();
            if (controls.size !== scenario.requiredAuthorities.length)
                failures.push(`${scenario.id}: expected ${scenario.requiredAuthorities.length} controls, found ${controls.size}`);
        }
    }
    for (const identity of IDENTITIES) {
        const authUser = await findAuthUser(ctx.auth, identity.email);
        if (!authUser)
            failures.push(`Auth account missing: ${identity.email}`);
        else {
            const profile = await ctx.db.collection('users').doc(authUser.uid).get();
            if (!profile.exists || !isManaged(profile.data(), identity.email))
                failures.push(`Profile missing or marker invalid: ${identity.email}`);
        }
    }
    for (const eventId of m3UatFixtures_1.M3_UAT_RETIRED_EVENT_IDS) {
        if ((await ctx.db.collection('events').doc(eventId).get()).exists)
            failures.push(`${eventId}: retired fixture still exists`);
    }
    if (failures.length > 0)
        throw new Error(`M3 UAT verification failed:\n- ${failures.join('\n- ')}`);
}
async function prepareM3UatForPlaywright(ctx) {
    await applyM3UatDataset(ctx);
    const now = Date.now();
    const adminUid = (await ctx.auth.getUserByEmail(m3UatFixtures_1.M3_UAT_ACCOUNT_EMAILS.admin)).uid;
    const releaseForOfficerTests = async (eventId, authorities) => {
        const eventRef = ctx.db.collection('events').doc(eventId);
        const officerUids = {};
        for (const authority of authorities) {
            const user = await ctx.auth.getUserByEmail(m3UatFixtures_1.M3_UAT_ACCOUNT_EMAILS[authority]);
            officerUids[authority] = user.uid;
            const assignmentId = `${VERSION_ID}_${authority}`;
            await eventRef.collection('assignments').doc(assignmentId).set({ assignmentId, eventId, versionId: VERSION_ID, authorityType: authority, officerUid: user.uid, assignedBy: adminUid, assignedAt: now, status: 'pending', m3Uat: marker(eventId) });
        }
        await eventRef.set({ status: 'UnderReview', reviewStage: 'authority', initialReview: { decision: 'Approved', reason: 'Released for Playwright officer-gate coverage.', reviewerUid: adminUid, reviewedAt: now, manualAssessmentRecorded: eventId === m3UatFixtures_1.M3_UAT_EVENTS.provisionalReview }, assignedOfficerUids: Object.values(officerUids), assignedOfficerByAuthority: officerUids, updatedAt: now }, { merge: true });
    };
    await releaseForOfficerTests(m3UatFixtures_1.M3_UAT_EVENTS.provisionalReview, ['PDRM', 'BOMBA']);
    await releaseForOfficerTests(m3UatFixtures_1.M3_UAT_EVENTS.controlVerification, REQUIRED_AUTHORITIES);
    const controls = await ctx.db.collection('events').doc(m3UatFixtures_1.M3_UAT_EVENTS.controlVerification).collection('event_controls').get();
    for (const control of controls.docs) {
        const docs = await control.ref.collection('stage1_docs').get();
        const batch = ctx.db.batch();
        docs.docs.forEach((doc) => batch.set(doc.ref, { status: 'pending_verification', verifiedBy: null, verifiedAt: null, rejectionReason: '', updatedAt: now }, { merge: true }));
        if (!docs.empty)
            await batch.commit();
        await control.ref.set({ label: 'pending', updatedAt: now }, { merge: true });
    }
}
/** Rebuild only the Stage-1 verification fixture after another spec has
 * intentionally regenerated its control list. No other event is touched. */
async function resetM3UatControlVerificationForPlaywright(ctx) {
    const eventId = m3UatFixtures_1.M3_UAT_EVENTS.controlVerification;
    const scenario = SCENARIOS.find((candidate) => candidate.id === eventId);
    if (!scenario)
        throw new Error(`Missing fixture scenario ${eventId}.`);
    const eventRef = ctx.db.collection('events').doc(eventId);
    const current = await eventRef.get();
    if (!current.exists || !isManaged(current.data(), eventId)) {
        throw new Error(`Refusing to reset unowned events/${eventId}.`);
    }
    await ctx.db.recursiveDelete(eventRef);
    const publicControlsRef = ctx.db.collection('public_event_controls').doc(eventId);
    if ((await publicControlsRef.get()).exists)
        await ctx.db.recursiveDelete(publicControlsRef);
    await ctx.db.collection('public_events').doc(eventId).delete().catch(() => undefined);
    await deleteQuery(ctx.db, ctx.db.collection('notifications').where('eventId', '==', eventId));
    await deleteQuery(ctx.db, ctx.db.collection('public_reports').where('eventId', '==', eventId));
    const identityUids = await ensureIdentities(ctx);
    await writeScenario(ctx, scenario, identityUids);
    const now = Date.now();
    const assignedOfficerByAuthority = {};
    for (const authority of REQUIRED_AUTHORITIES) {
        const officerUid = identityUids[authority];
        assignedOfficerByAuthority[authority] = officerUid;
        const assignmentId = `${VERSION_ID}_${authority}`;
        await eventRef.collection('assignments').doc(assignmentId).set({
            assignmentId,
            eventId,
            versionId: VERSION_ID,
            authorityType: authority,
            officerUid,
            assignedBy: identityUids.admin,
            assignedAt: now,
            status: 'pending',
            m3Uat: marker(eventId),
        });
    }
    await eventRef.set({
        status: 'UnderReview',
        reviewStage: 'authority',
        initialReview: { decision: 'Approved', reason: 'Released for Playwright control-verification coverage.', reviewerUid: identityUids.admin, reviewedAt: now },
        assignedOfficerUids: Object.values(assignedOfficerByAuthority),
        assignedOfficerByAuthority,
        updatedAt: now,
    }, { merge: true });
    const controls = await eventRef.collection('event_controls').get();
    for (const control of controls.docs) {
        const docs = await control.ref.collection('stage1_docs').get();
        const batch = ctx.db.batch();
        docs.docs.forEach((stageDoc) => batch.set(stageDoc.ref, {
            status: 'pending_verification',
            verifiedBy: null,
            verifiedAt: null,
            rejectionReason: '',
            updatedAt: now,
        }, { merge: true }));
        if (!docs.empty)
            await batch.commit();
        await control.ref.set({ label: 'pending', updatedAt: now }, { merge: true });
    }
}
async function runM3UatAction(action, ctx = initializeM3UatContext()) {
    assertSharedProjectAuthorization(ctx.projectId, action);
    if (action === 'dry-run') {
        await assertNoCollisions(ctx);
        console.info(JSON.stringify({ projectId: ctx.projectId, action, datasetId: m3UatFixtures_1.M3_UAT_DATASET_ID, events: SCENARIOS.map(({ id, name, status }) => ({ id, name, status })), retiredEventIds: m3UatFixtures_1.M3_UAT_RETIRED_EVENT_IDS, accounts: IDENTITIES.map(({ email, role, authorityType }) => ({ email, role, authorityType })), storagePrefixes: [...m3UatFixtures_1.M3_UAT_EVENT_IDS, ...m3UatFixtures_1.M3_UAT_RETIRED_EVENT_IDS].map((id) => `events/${id}/`) }, null, 2));
        return;
    }
    if (action === 'apply')
        await applyM3UatDataset(ctx);
    if (action === 'verify')
        await verifyM3UatDataset(ctx);
    if (action === 'cleanup')
        await clearManagedDataset(ctx, true);
    console.info(`[M3 UAT] ${action} complete for ${m3UatFixtures_1.M3_UAT_DATASET_ID} on ${ctx.projectId}.`);
}
if (require.main === module) {
    const action = parseM3UatAction(process.argv.slice(2));
    runM3UatAction(action).catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
//# sourceMappingURL=seedM3Uat.js.map