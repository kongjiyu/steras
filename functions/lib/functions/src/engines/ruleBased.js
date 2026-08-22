"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeCategoryBasedAssessment = computeCategoryBasedAssessment;
exports.fetchHistoricalContext = fetchHistoricalContext;
exports.fetchVenueContext = fetchVenueContext;
exports.buildMatchedVenueContextSnapshot = buildMatchedVenueContextSnapshot;
exports.buildHistoricalIncidentContext = buildHistoricalIncidentContext;
exports.buildContextEvidenceProvenance = buildContextEvidenceProvenance;
exports.riskLevelForMatrix = riskLevelForMatrix;
const firebase_admin_1 = require("firebase-admin");
const types_1 = require("../../../shared/types");
const categorySchema_1 = require("../config/categorySchema");
const LOOKBACK_MS = 36 * 30.4375 * 24 * 60 * 60 * 1_000;
function computeCategoryBasedAssessment(event, context, now = Date.now()) {
    const evidence = buildEvidence(event, context, now);
    const complianceChecks = buildComplianceChecks(event, context, now);
    const complianceStatus = highestComplianceStatus(complianceChecks);
    const assessmentReadiness = readinessFor(event, context);
    const hazards = buildHazards(event, context);
    const domainSummaries = buildDomainSummaries(hazards, context);
    const dominant = hazards.reduce((highest, hazard) => (hazard.residualMatrixScore > highest.residualMatrixScore ? hazard : highest), hazards[0]);
    const officialMatrixScore = dominant?.residualMatrixScore ?? 1;
    const officialScore = officialMatrixScore * 4;
    const officialRiskLevel = (0, types_1.hirarcRiskLevelFor)(officialMatrixScore);
    const dataConfidenceScore = Math.min(...domainSummaries.map((domain) => domain.confidenceScore));
    const dataConfidenceLevel = confidenceLevelFor(dataConfidenceScore);
    const categoryAssignments = categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.map((category) => {
        const domain = domainSummaries.find((item) => item.domain === category.id);
        const dominantHazard = hazards.find((hazard) => hazard.hazardId === domain?.dominantHazardId);
        const score = domain?.score ?? 4;
        return {
            categoryId: category.id,
            categoryName: category.name,
            score,
            riskLevel: domain?.riskLevel ?? 'Low',
            weight: category.weight,
            weightedContribution: roundContribution(score * category.weight),
            rationale: dominantHazard
                ? `${dominantHazard.hazardName} is the dominant residual hazard (${dominantHazard.residualLikelihood}×${dominantHazard.residualSeverity}); data confidence ${domain?.confidenceScore ?? 0}%.`
                : 'No domain hazard was produced.',
            evidenceKeys: dominantHazard?.evidenceKeys ?? [],
            guidelineChecks: [...category.guidelineChecks],
        };
    });
    return {
        categoryAssignments,
        officialScore,
        officialRiskLevel,
        evidence,
        categorySchemaVersion: categorySchema_1.ACTIVE_CATEGORY_SCHEMA.version,
        scoringLogicVersion: categorySchema_1.ACTIVE_CATEGORY_SCHEMA.scoringLogicVersion,
        categorySchemaStatus: categorySchema_1.ACTIVE_CATEGORY_SCHEMA.status,
        assessmentReadiness,
        complianceStatus,
        complianceChecks,
        hazards,
        domainSummaries,
        officialMatrixScore,
        dataConfidenceScore,
        dataConfidenceLevel,
        manualReviewRequired: assessmentReadiness !== 'complete' || complianceStatus !== 'pass',
        computedAt: now,
    };
}
function buildHazards(event, context) {
    const details = event.eventDetails;
    const profile = details.riskProfile ?? {};
    const attendance = Math.max(1, details.expectedAttendance);
    const safeCapacity = context.venue.verifiedSafeCapacity
        ?? context.venue.registeredCapacity
        ?? details.venueCapacity;
    const utilization = safeCapacity > 0 ? attendance / safeCapacity : 1;
    const durationHours = Math.max(1, (details.endDatetime - details.startDatetime) / 3_600_000);
    const isOutdoor = details.environment !== 'indoor';
    const control = (controlId, declared, affects, verifiedByRegistry = false) => ({
        controlId,
        status: verifiedByRegistry
            ? 'verified'
            : declared === true
                ? 'declared'
                : declared === false
                    ? 'absent'
                    : 'unknown',
        affects,
        ...(verifiedByRegistry ? { source: 'venue registry' } : {}),
    });
    return [
        hazard('crowd.capacity-pressure', 'Capacity, density and crowd pressure', 'crowd', utilization > 1 ? 5 : utilization > 0.9 ? 4 : utilization > 0.75 ? 3 : utilization > 0.5 ? 2 : 1, attendance > 20_000 ? 5 : attendance > 5_000 ? 4 : attendance > 1_000 ? 3 : attendance > 250 ? 2 : 1, [control('crowd-management-plan', profile.crowdManagementPlan, 'likelihood')], ['crowd', 'venue'], [], ['my.dosh.hirarc.2008', 'my.ubbl.state-specific']),
        hazard('crowd.flow-egress', 'Ingress, circulation, egress and dispersal', 'crowd', details.seating === 'standing' ? 4 : details.seating === 'mixed' ? 3 : 2, attendance > 10_000 ? 5 : attendance > 1_000 ? 4 : 3, [
            control('evacuation-plan-tested', profile.evacuationPlanTested, 'severity'),
            control('verified-emergency-access', context.venue.emergencyAccessVerified, 'likelihood', context.venue.emergencyAccessVerified === true),
        ], ['crowd', 'venue'], [], ['who.mass-gathering.all-hazards.2023', 'my.ubbl.state-specific']),
        hazard('venue.fire-life-safety', 'Fire, pyrotechnics and life safety', 'venue_fire', profile.pyrotechnics ? 5 : details.environment === 'indoor' ? 3 : 2, attendance > 5_000 ? 5 : attendance > 500 ? 4 : 3, [
            control('valid-fire-certificate', context.venue.fireCertificateStatus === 'valid', 'likelihood', context.venue.fireCertificateStatus === 'valid'),
            control('evacuation-plan-tested', profile.evacuationPlanTested, 'severity'),
        ], ['venue', 'compliance'], context.venue.matched ? [] : ['verified venue safety record'], ['my.fire-services-act.1988', 'my.ubbl.state-specific']),
        hazard('venue.temporary-structure', 'Temporary structure and structural exposure', 'venue_fire', profile.temporaryStructures ? 4 : 1, profile.temporaryStructures && attendance > 5_000 ? 5 : profile.temporaryStructures ? 3 : 1, [], ['venue'], [], ['my.dosh.hirarc.2008']),
        hazard('weather.severe', 'Thunderstorm, wind, heavy rain and flood exposure', 'weather_environment', weatherLikelihood(context.weather), isOutdoor ? 5 : details.environment === 'mixed' ? 4 : 2, [control('severe-weather-plan', profile.severeWeatherPlan, 'severity')], ['weather', 'venue'], weatherMissing(context.weather), ['my.met.warning-criteria', 'who.mass-gathering.all-hazards.2023']),
        hazard('weather.heat', 'Heat, humidity and exposure duration', 'weather_environment', heatLikelihood(context.weather), isOutdoor && durationHours >= 6 ? 5 : isOutdoor ? 4 : 2, [
            control('free-drinking-water', profile.freeDrinkingWater, 'severity'),
            control('severe-weather-plan', profile.severeWeatherPlan, 'severity'),
        ], ['weather', 'crowd'], weatherMissing(context.weather), ['my.met.warning-criteria', 'who.mass-gathering.all-hazards.2023']),
        hazard('public-health.communicable', 'Communicable and vector-borne disease exposure', 'public_health', durationHours >= 12 || (profile.internationalAttendees && profile.overnightAccommodation)
            ? 4
            : durationHours >= 6 || profile.internationalAttendees || profile.overnightAccommodation
                ? 3
                : 2, (profile.vulnerableAttendeesPercent ?? 0) >= 20 ? 5 : attendance > 5_000 ? 4 : 3, [control('authority-coordination', profile.authorityCoordinationConfirmed, 'likelihood')], ['public_health', 'crowd'], [], ['who.mass-gathering.all-hazards.2023']),
        hazard('sanitation.food-water', 'Food, water, toilets and waste', 'food_water_sanitation', profile.foodServed ? 4 : 2, attendance > 5_000 ? 5 : attendance > 500 ? 4 : 3, [control('free-drinking-water', profile.freeDrinkingWater, 'severity')], ['sanitation', 'crowd'], [], ['who.mass-gathering.all-hazards.2023']),
        hazard('medical.response-capacity', 'Onsite care, ambulance access and receiving capacity', 'medical_capacity', attendance > 10_000 ? 5 : attendance > 2_000 ? 4 : attendance > 500 ? 3 : 2, (profile.nearestHospitalTravelMinutes ?? context.venue.nearestHospitalTravelMinutes ?? 30) > 45 ? 5 : 4, [
            control('medical-plan', profile.medicalPlan, 'likelihood'),
            control('verified-emergency-access', context.venue.emergencyAccessVerified, 'severity', context.venue.emergencyAccessVerified === true),
        ], ['medical', 'history'], [], ['who.mass-gathering.all-hazards.2023']),
        hazard('security.behaviour', 'Security, behaviour, rivalry and deliberate threats', 'security_cbrn', profile.rivalryOrTensionExpected ? 5 : profile.alcoholServed || details.type === 'concert' ? 4 : 2, attendance > 10_000 ? 5 : attendance > 1_000 ? 4 : 3, [control('authority-coordination', profile.authorityCoordinationConfirmed, 'likelihood')], ['security', 'crowd'], [], ['who.mass-gathering.all-hazards.2023']),
        hazard('transport.emergency-access', 'Transport, pedestrian separation and emergency access', 'transport_accessibility', (context.calendar.coverageStatus !== 'unsupported_year' && context.calendar.isHolidayOrAdjacent)
            || context.calendar.isWeekend ? 4 : attendance > 5_000 ? 4 : 3, attendance > 10_000 ? 5 : attendance > 1_000 ? 4 : 3, [
            control('traffic-management-plan', profile.trafficManagementPlan, 'likelihood'),
            control('verified-emergency-access', context.venue.emergencyAccessVerified, 'severity', context.venue.emergencyAccessVerified === true),
        ], ['transport', 'holiday', 'venue'], [], ['who.mass-gathering.all-hazards.2023', 'my.ubbl.state-specific']),
    ];
}
function hazard(hazardId, hazardName, domain, inherentLikelihood, inherentSeverity, controls, evidenceKeys, missingData, guidelineChecks) {
    const likelihood = rating(inherentLikelihood);
    const severity = rating(inherentSeverity);
    const likelihoodReduction = Math.min(2, controls.filter((item) => item.status === 'verified' && item.affects === 'likelihood').length);
    const severityReduction = Math.min(2, controls.filter((item) => item.status === 'verified' && item.affects === 'severity').length);
    const residualLikelihood = rating(Math.max(1, likelihood - likelihoodReduction));
    const residualSeverity = rating(Math.max(1, severity - severityReduction));
    const residualMatrixScore = residualLikelihood * residualSeverity;
    return {
        hazardId,
        hazardName,
        domain,
        inherentLikelihood: likelihood,
        inherentSeverity: severity,
        inherentMatrixScore: likelihood * severity,
        controls,
        residualLikelihood,
        residualSeverity,
        residualMatrixScore,
        riskLevel: (0, types_1.hirarcRiskLevelFor)(residualMatrixScore),
        evidenceKeys,
        missingData,
        guidelineChecks,
    };
}
function buildDomainSummaries(hazards, context) {
    return categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.map((category) => {
        const domainHazards = hazards.filter((hazard) => hazard.domain === category.id);
        const dominant = domainHazards.reduce((highest, hazard) => (hazard.residualMatrixScore > highest.residualMatrixScore ? hazard : highest), domainHazards[0]);
        const confidenceScore = domainConfidence(category.id, context);
        return {
            domain: category.id,
            name: category.name,
            score: (dominant?.residualMatrixScore ?? 1) * 4,
            matrixScore: dominant?.residualMatrixScore ?? 1,
            riskLevel: dominant?.riskLevel ?? 'Low',
            dominantHazardId: dominant?.hazardId ?? '',
            confidenceScore,
            confidenceLevel: confidenceLevelFor(confidenceScore),
        };
    });
}
function buildComplianceChecks(event, context, now) {
    const details = event.eventDetails;
    const verifiedCapacity = context.venue.verifiedSafeCapacity ?? context.venue.registeredCapacity;
    const capacityStatus = verifiedCapacity === undefined
        ? 'review_required'
        : details.expectedAttendance > verifiedCapacity
            ? 'blocked'
            : 'pass';
    const fireStatus = context.venue.fireCertificateStatus;
    const fireCertificateStatus = fireStatus === 'expired'
        || (fireStatus === 'valid' && Boolean(context.venue.fireCertificateExpiresAt && context.venue.fireCertificateExpiresAt < now))
        ? 'blocked'
        : fireStatus === 'valid' || fireStatus === 'not_required'
            ? 'pass'
            : 'review_required';
    return [
        {
            checkId: 'compliance.verified-safe-capacity',
            name: 'Verified safe capacity',
            status: capacityStatus,
            authority: 'BOMBA',
            jurisdiction: context.venue.jurisdiction ?? 'State/PBT review required',
            rationale: verifiedCapacity === undefined
                ? 'No verified safe capacity is available.'
                : `${details.expectedAttendance} attendees against verified capacity ${verifiedCapacity}.`,
            evidenceKeys: ['venue', 'crowd'],
            guidelineReference: 'my.ubbl.state-specific',
        },
        {
            checkId: 'compliance.fire-certificate',
            name: 'Fire Certificate applicability and validity',
            status: fireCertificateStatus,
            authority: 'BOMBA',
            jurisdiction: context.venue.jurisdiction ?? 'Malaysia',
            rationale: fireStatus
                ? `Venue registry status: ${fireStatus}.`
                : 'Fire Certificate applicability has not been verified.',
            evidenceKeys: ['venue', 'compliance'],
            guidelineReference: 'my.fire-services-act.1988',
        },
        {
            checkId: 'compliance.canonical-venue',
            name: 'Canonical venue registry match',
            status: context.venue.matched ? 'pass' : 'review_required',
            authority: 'DBKL',
            jurisdiction: context.venue.jurisdiction ?? 'PBT to be determined',
            rationale: context.venue.matched
                ? `Matched venue ${context.venue.venueId}.`
                : 'Custom or unmatched venue requires manual PBT and safety verification.',
            evidenceKeys: ['venue'],
            guidelineReference: 'my.ubbl.state-specific',
        },
    ];
}
function buildEvidence(event, context, now) {
    const capacity = context.venue.verifiedSafeCapacity
        ?? context.venue.registeredCapacity
        ?? event.eventDetails.venueCapacity;
    const capacitySource = context.venue.matched ? 'verified venue registry' : 'submitted application';
    const history = context.incidentHistory;
    return [
        {
            key: 'weather',
            description: context.weather.data?.forecast || 'Weather measurements unavailable',
            sourceTimestamp: context.weather.fetchedAt,
            source: context.weather.source,
            status: context.weather.freshness,
            quality: context.weather.freshness === 'not_assessable_yet' ? 'declared' : weatherQuality(context.weather),
            confidenceScore: context.weather.freshness === 'not_assessable_yet' ? 25 : weatherConfidence(context.weather),
            eligibility: context.weather.data || context.weather.freshness === 'not_assessable_yet'
                ? 'eligible' : 'ineligible',
            syntheticStatus: 'none',
        },
        {
            key: 'crowd',
            description: `${event.eventDetails.expectedAttendance}/${capacity} expected capacity using ${capacitySource}`,
            sourceTimestamp: context.venue.fetchedAt,
            source: capacitySource,
            status: context.venue.matched ? 'matched' : 'submitted-only',
            quality: context.venue.matched ? 'verified' : 'declared',
            confidenceScore: context.venue.matched ? 100 : 60,
            eligibility: 'eligible',
            syntheticStatus: 'none',
        },
        {
            key: 'venue',
            description: `${event.eventDetails.environment}, ${event.eventDetails.coverage}, ${event.eventDetails.seating}`,
            sourceTimestamp: context.venue.fetchedAt,
            source: context.venue.matched ? 'venues collection' : 'submitted application',
            status: context.venue.matched ? 'matched' : 'unmatched',
            quality: context.venue.matched ? 'verified' : 'declared',
            confidenceScore: context.venue.matched ? 100 : 60,
            eligibility: context.venue.matched ? 'eligible' : 'ineligible',
            syntheticStatus: 'none',
        },
        {
            key: 'history',
            description: history.matched
                ? `${history.historicalEventCount ?? 0} comparable completed events; ${history.total} eligible incidents; ${history.totalAttendance ?? 0} attendance exposure`
                : 'No stable venue match; comparable history unavailable',
            sourceTimestamp: history.fetchedAt,
            source: 'historical_events/incidents collections',
            status: history.syntheticEvidence ? 'synthetic-demo-evidence' : history.matched ? 'matched' : 'unmatched',
            quality: history.syntheticEvidence ? 'stale' : history.matched ? 'verified' : 'missing',
            confidenceScore: history.syntheticEvidence ? 25 : history.matched ? 85 : 0,
            eligibility: history.matched ? 'eligible' : 'missing',
            syntheticStatus: history.syntheticStatus ?? 'none',
        },
        {
            key: 'holiday',
            description: context.calendar.coverageStatus === 'unsupported_year'
                ? `Public-holiday dataset does not cover ${context.calendar.localDate.slice(0, 4)}`
                : context.calendar.isHolidayOrAdjacent
                    ? `${context.calendar.holidayName ?? 'Public holiday'} context on ${context.calendar.dayOfWeek}`
                    : context.calendar.isWeekend
                        ? `Weekend event on ${context.calendar.dayOfWeek}`
                        : `Regular weekday on ${context.calendar.dayOfWeek}`,
            sourceTimestamp: context.calendar.sourceTimestamp,
            source: context.calendar.sourceVersion,
            status: context.calendar.coverageStatus === 'unsupported_year'
                ? 'unsupported-year'
                : context.calendar.isHolidayOrAdjacent ? 'holiday-or-adjacent' : context.calendar.isWeekend ? 'weekend' : 'weekday',
            quality: context.calendar.coverageStatus === 'unsupported_year' ? 'missing' : 'verified',
            confidenceScore: context.calendar.coverageStatus === 'unsupported_year' ? 0 : 85,
            eligibility: context.calendar.coverageStatus === 'unsupported_year' ? 'missing' : 'eligible',
            syntheticStatus: 'none',
        },
        ...[
            ['public_health', 'Public-health exposure profile', 'international attendees, vulnerable attendees, and overnight accommodation'],
            ['sanitation', 'Food, water, and sanitation profile', 'food service and drinking-water declarations'],
            ['medical', 'Medical-capacity profile', 'medical plan and hospital travel-time declarations'],
            ['security', 'Security profile', 'alcohol service, rivalry, and authority-coordination declarations'],
            ['transport', 'Transport and accessibility profile', 'traffic plan and emergency-access declarations'],
            ['compliance', 'Application and venue compliance inputs', 'submitted application and venue registry checks'],
        ].map(([key, description, source]) => ({
            key,
            description,
            sourceTimestamp: event.submittedAt ?? now,
            source,
            status: 'submitted',
            quality: 'declared',
            confidenceScore: 60,
            eligibility: profileEvidenceComplete(event, context) ? 'eligible' : 'missing',
            syntheticStatus: 'none',
        })),
    ].map((item) => ({ ...item, sourceTimestamp: item.sourceTimestamp || now }));
}
async function fetchHistoricalContext(event, now = Date.now()) {
    const db = (0, firebase_admin_1.firestore)();
    const venueId = await resolveCanonicalVenueId(event.eventDetails);
    if (!venueId)
        return emptyHistory(now);
    const [incidentsSnapshot, historicalSnapshot] = await Promise.all([
        db.collection(types_1.COLLECTIONS.INCIDENTS).where('venueId', '==', venueId).get(),
        db.collection(types_1.COLLECTIONS.HISTORICAL_EVENTS).where('venueId', '==', venueId).get(),
    ]);
    const eventStart = event.eventDetails.startDatetime;
    const lookbackStart = eventStart - LOOKBACK_MS;
    const incidents = incidentsSnapshot.docs
        .map((document) => ({ incidentId: document.id, ...document.data() }))
        .filter((incident) => incident.date < eventStart
        && incident.date >= lookbackStart
        && incident.status === 'verified'
        && incident.assessmentEligible === true);
    const historicalEvents = historicalSnapshot.docs
        .map((document) => ({ historicalEventId: document.id, ...document.data() }))
        .filter((historical) => historical.completed
        && historical.assessmentEligible
        && historical.startDatetime < eventStart
        && historical.startDatetime >= lookbackStart)
        .map((historical) => comparableEvent(historical, event, venueId))
        .filter((historical) => historical.similarityScore >= 4)
        .sort((a, b) => b.similarityScore - a.similarityScore || b.historicalEventId.localeCompare(a.historicalEventId))
        .slice(0, 20);
    const totalAttendance = historicalEvents.reduce((sum, item) => sum + item.attendance, 0);
    const totalAttendeeHours = historicalEvents.reduce((sum, item) => sum + item.attendeeHours, 0);
    const patientPresentations = historicalEvents.reduce((sum, item) => sum + item.patientPresentations, 0);
    const hospitalTransfers = historicalEvents.reduce((sum, item) => sum + item.hospitalTransfers, 0);
    const sourceSyntheticFlags = [
        ...incidents.map((item) => item.synthetic === true),
        ...historicalEvents.map((item) => item.synthetic),
    ];
    const syntheticStatus = sourceSyntheticFlags.length === 0 || sourceSyntheticFlags.every((item) => !item)
        ? 'none'
        : sourceSyntheticFlags.every(Boolean) ? 'all' : 'partial';
    return {
        matched: true,
        venueId,
        incidentIds: incidents.map((incident) => incident.incidentId),
        total: incidents.length,
        bySeverity: countIncidentSeverity(incidents),
        historicalEventIds: historicalEvents.map((item) => item.historicalEventId),
        historicalEventCount: historicalEvents.length,
        totalAttendance,
        totalAttendeeHours: roundMetric(totalAttendeeHours),
        patientPresentationRatePerThousand: rate(patientPresentations, totalAttendance),
        hospitalTransferRatePerThousand: rate(hospitalTransfers, totalAttendance),
        incidentRatePerThousandAttendeeHours: rate(incidents.length, totalAttendeeHours),
        comparableEvents: historicalEvents.slice(0, 5),
        lookbackStart,
        syntheticEvidence: syntheticStatus === 'all',
        syntheticStatus,
        incidentEvidence: incidents.map((incident) => ({
            incidentId: incident.incidentId,
            synthetic: incident.synthetic === true,
            ...(incident.datasetVersion ? { datasetVersion: incident.datasetVersion } : {}),
        })),
        fetchedAt: now,
    };
}
function comparableEvent(historical, event, resolvedVenueId) {
    const details = event.eventDetails;
    const durationHours = Math.max(1, (historical.endDatetime - historical.startDatetime) / 3_600_000);
    let similarityScore = historical.venueId === resolvedVenueId ? 4 : 0;
    if (historical.eventType === details.type)
        similarityScore += 2;
    if (historical.environment === details.environment)
        similarityScore += 1;
    if (historical.seating === details.seating)
        similarityScore += 1;
    if (attendanceBand(historical.attendance) === attendanceBand(details.expectedAttendance))
        similarityScore += 1;
    if (new Date(historical.startDatetime).getUTCMonth() / 3 === new Date(details.startDatetime).getUTCMonth() / 3)
        similarityScore += 1;
    return {
        historicalEventId: historical.historicalEventId,
        venueId: historical.venueId,
        eventType: historical.eventType,
        attendance: historical.attendance,
        attendeeHours: roundMetric(historical.attendance * durationHours),
        similarityScore,
        patientPresentations: historical.outcomes.patientPresentations,
        hospitalTransfers: historical.outcomes.hospitalTransfers,
        incidentCount: historical.incidentIds.length,
        synthetic: historical.synthetic,
    };
}
async function fetchVenueContext(details, now = Date.now()) {
    const db = (0, firebase_admin_1.firestore)();
    let venueDocument;
    if (details.venueId) {
        const snapshot = await db.collection(types_1.COLLECTIONS.VENUES).doc(details.venueId).get();
        if (snapshot.exists && snapshot.data()?.active === true && snapshot.data()?.deactivatedAt === undefined)
            venueDocument = snapshot;
    }
    const submittedCapacity = details.venueCapacity;
    if (!venueDocument?.exists || venueDocument.data()?.active !== true)
        return { matched: false, submittedCapacity, fetchedAt: now };
    const venue = { venueId: venueDocument.id, ...venueDocument.data() };
    const registeredCapacity = venue.verifiedSafeCapacity ?? venue.capacity;
    if (normalizeVenueName(venue.name) !== normalizeVenueName(details.venueName)
        || normalizeVenueName(venue.address) !== normalizeVenueName(details.venueAddress)
        || registeredCapacity !== submittedCapacity
        || !sameLocation(venue.location, details.venueLocation)) {
        return { matched: false, submittedCapacity, fetchedAt: now };
    }
    return buildMatchedVenueContextSnapshot(venue, submittedCapacity, registeredCapacity, now);
}
function buildMatchedVenueContextSnapshot(venue, submittedCapacity, registeredCapacity, now) {
    return {
        matched: true,
        venueId: venue.venueId,
        submittedCapacity,
        registeredCapacity,
        capacityDifference: submittedCapacity - registeredCapacity,
        ...(venue.verifiedSafeCapacity !== undefined ? { verifiedSafeCapacity: venue.verifiedSafeCapacity } : {}),
        ...(venue.jurisdiction !== undefined ? { jurisdiction: venue.jurisdiction } : {}),
        ...(venue.fireCertificateStatus !== undefined ? { fireCertificateStatus: venue.fireCertificateStatus } : {}),
        ...(venue.fireCertificateExpiresAt !== undefined ? { fireCertificateExpiresAt: venue.fireCertificateExpiresAt } : {}),
        ...(venue.emergencyAccessVerified !== undefined ? { emergencyAccessVerified: venue.emergencyAccessVerified } : {}),
        ...(venue.nearestHospitalTravelMinutes !== undefined ? { nearestHospitalTravelMinutes: venue.nearestHospitalTravelMinutes } : {}),
        ...(venue.riskNotes ? { riskNotes: venue.riskNotes } : {}),
        fetchedAt: now,
    };
}
async function resolveCanonicalVenueId(details) {
    if (!details.venueId)
        return undefined;
    const snapshot = await (0, firebase_admin_1.firestore)().collection(types_1.COLLECTIONS.VENUES).doc(details.venueId).get();
    if (!snapshot.exists || snapshot.data()?.active !== true || snapshot.data()?.deactivatedAt !== undefined)
        return undefined;
    const venue = { venueId: snapshot.id, ...snapshot.data() };
    return normalizeVenueName(venue.name) === normalizeVenueName(details.venueName)
        && normalizeVenueName(venue.address) === normalizeVenueName(details.venueAddress)
        && (venue.verifiedSafeCapacity ?? venue.capacity) === details.venueCapacity
        && sameLocation(venue.location, details.venueLocation)
        ? details.venueId : undefined;
}
function sameLocation(left, right) {
    return Boolean(left && right
        && Number.isFinite(left.lat) && Number.isFinite(left.lng)
        && Number.isFinite(right.lat) && Number.isFinite(right.lng)
        && Math.abs(left.lat - right.lat) <= 0.00001
        && Math.abs(left.lng - right.lng) <= 0.00001);
}
function buildHistoricalIncidentContext(snapshot) {
    return {
        matched: snapshot.matched,
        ...(snapshot.venueId ? { venueId: snapshot.venueId } : {}),
        incidentIds: snapshot.incidents.map((incident) => incident.incidentId),
        total: snapshot.incidents.length,
        bySeverity: countIncidentSeverity(snapshot.incidents),
        syntheticStatus: snapshot.incidents.length > 0 && snapshot.incidents.every((incident) => incident.synthetic === true)
            ? 'all'
            : snapshot.incidents.some((incident) => incident.synthetic === true) ? 'partial' : 'none',
        incidentEvidence: snapshot.incidents.map((incident) => ({ incidentId: incident.incidentId, synthetic: incident.synthetic === true })),
        fetchedAt: snapshot.fetchedAt,
    };
}
function readinessFor(event, context) {
    if (!context.venue.matched || !profileEvidenceComplete(event, context) || (event.draftDocumentPaths?.length ?? 0) < 1)
        return 'insufficient_data';
    if (context.weather.freshness === 'not_assessable_yet' || context.calendar.coverageStatus === 'unsupported_year')
        return 'provisional';
    if (['fallback', 'unavailable'].includes(context.weather.freshness))
        return 'insufficient_data';
    return 'complete';
}
function highestComplianceStatus(checks) {
    if (checks.some((check) => check.status === 'blocked'))
        return 'blocked';
    if (checks.some((check) => check.status === 'review_required'))
        return 'review_required';
    return 'pass';
}
function weatherLikelihood(weather) {
    if (weather.freshness === 'fallback' || weather.freshness === 'unavailable' || weather.freshness === 'not_assessable_yet')
        return 3;
    if (!weather.data)
        return 3;
    const forecast = weather.data.forecast.toLowerCase();
    if (weather.data.severeAlert || forecast.includes('thunder'))
        return 5;
    if (weather.data.precipitationProbability >= 70 || weather.data.windSpeed >= 10)
        return 4;
    if (forecast.includes('rain') || forecast.includes('shower'))
        return 3;
    return 2;
}
function heatLikelihood(weather) {
    if (!weather.data)
        return 3;
    return weather.data.temperature >= 37 ? 5
        : weather.data.temperature >= 35 ? 4
            : weather.data.temperature >= 32 && weather.data.humidity >= 70 ? 3 : 2;
}
const REQUIRED_PROFILE_BOOLEAN_FIELDS = [
    'internationalAttendees', 'alcoholServed', 'foodServed', 'freeDrinkingWater', 'ticketedEntry',
    'overnightAccommodation', 'pyrotechnics', 'temporaryStructures', 'rivalryOrTensionExpected',
    'crowdManagementPlan', 'trafficManagementPlan', 'severeWeatherPlan', 'medicalPlan',
    'evacuationPlanTested', 'authorityCoordinationConfirmed',
];
function profileEvidenceComplete(event, context) {
    const profile = event.eventDetails.riskProfile;
    return Boolean(profile
        && REQUIRED_PROFILE_BOOLEAN_FIELDS.every((key) => typeof profile[key] === 'boolean')
        && Number.isFinite(profile.vulnerableAttendeesPercent)
        && Number(profile.vulnerableAttendeesPercent) >= 0 && Number(profile.vulnerableAttendeesPercent) <= 100
        && Number.isFinite(profile.standingAttendeesPercent)
        && Number(profile.standingAttendeesPercent) >= 0 && Number(profile.standingAttendeesPercent) <= 100
        && (Number.isFinite(profile.nearestHospitalTravelMinutes)
            || Number.isFinite(context.venue.nearestHospitalTravelMinutes)));
}
function normalizeVenueName(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}
function buildContextEvidenceProvenance(event, context, now = Date.now(), submittedEvidence) {
    const weatherEligible = Boolean(context.weather.data);
    const holidayEligible = context.calendar.coverageStatus !== 'unsupported_year';
    const historyItems = context.incidentHistory.comparableEvents ?? [];
    const historySyntheticCount = historyItems.filter((item) => item.synthetic).length;
    const submittedAt = event.submittedAt ?? now;
    const profileComplete = profileEvidenceComplete(event, context);
    const base = [
        provenance('context.event.crowd', 'crowd', 'submitted_declaration', 'immutable-event-version:eventDetails.expectedAttendance', submittedAt, 'immutable-event-version', true, false),
        provenance('context.event.risk-profile', 'compliance', 'submitted_declaration', 'immutable-event-version:eventDetails.riskProfile', submittedAt, 'immutable-event-version', profileComplete, false, profileComplete ? undefined : 'all_hazards_declaration_incomplete'),
        ...['public_health', 'sanitation', 'medical', 'security', 'transport'].map((evidenceKey) => provenance(`context.event.risk-profile.${evidenceKey}`, evidenceKey, 'submitted_declaration', `immutable-event-version:eventDetails.riskProfile#${evidenceKey}`, submittedAt, 'immutable-event-version', profileComplete, false, profileComplete ? undefined : 'all_hazards_declaration_incomplete')),
        provenance('context.weather', 'weather', 'external_api', context.weather.source, context.weather.fetchedAt, context.weather.source === 'met-malaysia' ? 'met-malaysia-current' : context.weather.source === 'fallback' ? types_1.WEATHER_POLICY_VERSION : 'openweather-v3', weatherEligible, false, weatherEligible ? undefined : context.weather.unavailableReason ?? 'weather_measurements_unavailable'),
        provenance('context.calendar', 'holiday', 'official_dataset', context.calendar.sourceVersion, context.calendar.sourceTimestamp, context.calendar.sourceVersion, holidayEligible, false, holidayEligible ? undefined : 'holiday_dataset_year_unsupported'),
        provenance('context.venue', 'venue', 'official_registry', context.venue.venueId ?? 'custom-venue', context.venue.fetchedAt, types_1.VENUE_BINDING_VERSION, context.venue.matched, false, context.venue.matched ? undefined : 'canonical_venue_unmatched'),
        provenance('context.history.aggregate', 'history', 'derived', context.incidentHistory.venueId ?? 'unmatched', context.incidentHistory.fetchedAt, types_1.CONTEXT_EVIDENCE_SCHEMA_VERSION, context.incidentHistory.matched, context.incidentHistory.syntheticStatus !== 'none' || historySyntheticCount > 0, context.incidentHistory.matched ? undefined : 'canonical_venue_history_unavailable'),
    ];
    const documentEvidence = submittedEvidence ?? event.draftDocumentPaths.map((path) => ({
        path, status: 'eligible', retrievedAt: submittedAt, sourceVersion: 'immutable-event-version',
    }));
    for (const item of documentEvidence) {
        base.push(provenance(`document.${createStableEvidenceId(item.path)}`, 'compliance', 'submitted_document', item.path, item.retrievedAt, item.sourceVersion, item.status === 'eligible', false, item.reason));
    }
    for (const item of historyItems) {
        base.push(provenance(`history.${item.historicalEventId}`, 'history', 'official_registry', item.historicalEventId, context.incidentHistory.fetchedAt, 'historical-event-outcome-v1', true, item.synthetic));
    }
    const incidentEvidence = context.incidentHistory.incidentEvidence
        ?? context.incidentHistory.incidentIds.map((incidentId) => ({ incidentId, synthetic: false }));
    for (const incident of incidentEvidence) {
        base.push(provenance(`incident.${incident.incidentId}`, 'history', 'official_registry', incident.incidentId, context.incidentHistory.fetchedAt, incident.datasetVersion ?? 'closed-verified-incident-v1', true, incident.synthetic));
    }
    return base;
}
function provenance(evidenceId, evidenceKey, sourceKind, sourceLocator, retrievedAt, sourceVersion, eligible, synthetic, eligibilityReason) {
    return {
        evidenceId,
        evidenceKey,
        sourceKind,
        sourceLocator,
        retrievedAt,
        sourceVersion,
        eligibility: eligible ? 'eligible' : ['unavailable', 'unsupported', 'missing'].some((marker) => eligibilityReason?.includes(marker)) ? 'missing' : 'ineligible',
        ...(eligibilityReason ? { eligibilityReason } : {}),
        synthetic,
        visibility: 'authority_only',
    };
}
function createStableEvidenceId(value) {
    let hash = 2166136261;
    for (const character of value)
        hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(16).padStart(8, '0');
}
function weatherMissing(weather) {
    return ['fallback', 'unavailable', 'not_assessable_yet'].includes(weather.freshness)
        ? ['fresh event-period weather evidence']
        : [];
}
function weatherConfidence(weather) {
    if (weather.freshness === 'fresh' && weather.source === 'met-malaysia')
        return 100;
    if (weather.freshness === 'fresh' && weather.source === 'openweather')
        return 100;
    if (weather.source === 'cache' && weather.freshness === 'fresh')
        return 85;
    if (weather.freshness === 'stale')
        return 25;
    return 0;
}
function weatherQuality(weather) {
    const confidence = weatherConfidence(weather);
    if (confidence === 100)
        return 'official';
    if (confidence === 85)
        return 'verified';
    if (confidence === 25)
        return 'stale';
    return 'missing';
}
function domainConfidence(domain, context) {
    const venue = context.venue.matched ? 100 : 60;
    const weather = weatherConfidence(context.weather);
    const history = context.incidentHistory.syntheticStatus === 'all' ? 25
        : context.incidentHistory.syntheticStatus === 'partial' ? 55
            : context.incidentHistory.matched ? 85 : 0;
    const declared = 60;
    const calendar = 85;
    const values = {
        crowd: [venue, declared],
        venue_fire: [venue, declared],
        weather_environment: [weather, venue, declared],
        public_health: [declared],
        food_water_sanitation: [declared],
        medical_capacity: [venue, history, declared],
        security_cbrn: [declared],
        transport_accessibility: [venue, calendar, declared],
    };
    return Math.round(values[domain].reduce((sum, value) => sum + value, 0) / values[domain].length);
}
function confidenceLevelFor(score) {
    if (score >= 80)
        return 'high';
    if (score >= 60)
        return 'medium';
    return 'low';
}
function countIncidentSeverity(incidents) {
    return incidents.reduce((counts, incident) => {
        counts[incident.severity] += 1;
        return counts;
    }, { low: 0, medium: 0, high: 0 });
}
function emptyHistory(now) {
    return {
        matched: false,
        incidentIds: [],
        total: 0,
        bySeverity: { low: 0, medium: 0, high: 0 },
        historicalEventIds: [],
        historicalEventCount: 0,
        totalAttendance: 0,
        totalAttendeeHours: 0,
        comparableEvents: [],
        syntheticStatus: 'none',
        fetchedAt: now,
    };
}
function attendanceBand(attendance) {
    if (attendance > 20_000)
        return 5;
    if (attendance > 5_000)
        return 4;
    if (attendance > 1_000)
        return 3;
    if (attendance > 250)
        return 2;
    return 1;
}
function rate(numerator, denominator) {
    return denominator > 0 ? roundMetric((numerator / denominator) * 1_000) : 0;
}
function roundMetric(value) {
    return Math.round(value * 100) / 100;
}
function roundContribution(value) {
    return Math.round(value * 100) / 100;
}
function rating(value) {
    return Math.max(1, Math.min(5, Math.round(value)));
}
function riskLevelForMatrix(matrixScore) {
    return (0, types_1.hirarcRiskLevelFor)(matrixScore);
}
//# sourceMappingURL=ruleBased.js.map