"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const types_1 = require("../../../shared/types");
const ruleBased_1 = require("./ruleBased");
const event = {
    eventId: 'event-1',
    organizerId: 'organizer-1',
    status: 'Pending',
    currentVersionNumber: 1,
    draftDocumentPaths: ['event_documents/event-1/v1/evidence.pdf'],
    requiredAuthorities: ['PDRM'],
    createdAt: 1,
    updatedAt: 1,
    eventDetails: {
        name: 'Test Festival',
        type: 'festival',
        venueId: 'venue-1',
        venueName: 'Test Venue',
        venueAddress: 'Kuala Lumpur',
        venueLocation: { lat: 3.139, lng: 101.687 },
        venueCapacity: 10_000,
        expectedAttendance: 8_000,
        environment: 'outdoor',
        coverage: 'uncovered',
        seating: 'mixed',
        startDatetime: 1_800_000_000_000,
        endDatetime: 1_800_021_600_000,
        emergencyPlanSummary: 'Emergency exits and first aid are documented.',
        organizerName: 'Private Organizer',
        organizerEmail: 'private@example.com',
        organizerPhone: '+60000000000',
        riskProfile: completeRiskProfile(),
    },
};
const context = {
    weather: {
        data: { forecast: 'Thunderstorm', temperature: 31, humidity: 85, windSpeed: 4, precipitationProbability: 80, severeAlert: true },
        measurementStatus: 'available',
        source: 'openweather',
        freshness: 'fresh',
        fetchedAt: 100,
        expiresAt: 200,
        forecastFor: event.eventDetails.startDatetime,
    },
    calendar: {
        localDate: '2027-01-15',
        dayOfWeek: 'Saturday',
        isWeekend: true,
        isHolidayOrAdjacent: true,
        holidayName: 'Test holiday',
        holidayDistanceDays: 0,
        sourceVersion: 'test-holidays',
        sourceTimestamp: 300,
        coverageStatus: 'verified',
    },
    venue: {
        matched: true,
        venueId: 'venue-1',
        submittedCapacity: 10_000,
        registeredCapacity: 10_000,
        capacityDifference: 0,
        fetchedAt: 150,
    },
    incidentHistory: {
        matched: true,
        venueId: 'venue-1',
        incidentIds: [],
        total: 0,
        bySeverity: { low: 0, medium: 0, high: 0 },
        syntheticStatus: 'none',
        fetchedAt: 200,
    },
};
(0, vitest_1.describe)('computeCategoryBasedAssessment', () => {
    (0, vitest_1.it)('omits absent optional venue registry fields from Firestore snapshots', () => {
        const snapshot = (0, ruleBased_1.buildMatchedVenueContextSnapshot)({
            venueId: 'venue-minimal',
            active: true,
            name: 'Minimal Venue',
            address: 'Putrajaya',
            capacity: 3_000,
            location: { lat: 2.9006, lng: 101.6805 },
            incidentCount: 0,
        }, 3_000, 3_000, 123);
        (0, vitest_1.expect)(snapshot).toEqual({
            matched: true,
            venueId: 'venue-minimal',
            submittedCapacity: 3_000,
            registeredCapacity: 3_000,
            capacityDifference: 0,
            fetchedAt: 123,
        });
        (0, vitest_1.expect)(Object.values(snapshot)).not.toContain(undefined);
    });
    (0, vitest_1.it)('produces a deterministic HIRARC result with eight all-hazards domains', () => {
        const first = (0, ruleBased_1.computeCategoryBasedAssessment)(event, context, 123);
        const second = (0, ruleBased_1.computeCategoryBasedAssessment)(event, context, 123);
        (0, vitest_1.expect)(second).toEqual(first);
        (0, vitest_1.expect)(first.officialScore).toBe(first.officialMatrixScore * 4);
        (0, vitest_1.expect)(first.officialMatrixScore).toBe(Math.max(...first.hazards.map((hazard) => hazard.residualMatrixScore)));
        (0, vitest_1.expect)(first.categoryAssignments.map((category) => category.categoryId)).toEqual([
            'crowd',
            'venue_fire',
            'weather_environment',
            'public_health',
            'food_water_sanitation',
            'medical_capacity',
            'security_cbrn',
            'transport_accessibility',
        ]);
        (0, vitest_1.expect)(first.categorySchemaVersion).toContain('all-hazards-v2');
        (0, vitest_1.expect)(first.categorySchemaStatus).toBe('prototype');
    });
    (0, vitest_1.it)('records source status, timestamps, and unmatched venue history', () => {
        const result = (0, ruleBased_1.computeCategoryBasedAssessment)(event, {
            ...context,
            incidentHistory: { ...context.incidentHistory, matched: false, fetchedAt: 250 },
        }, 500);
        (0, vitest_1.expect)(result.evidence.find((item) => item.key === 'weather')).toMatchObject({ sourceTimestamp: 100, source: 'openweather', status: 'fresh' });
        (0, vitest_1.expect)(result.evidence.find((item) => item.key === 'history')).toMatchObject({ description: 'No stable venue match; comparable history unavailable', sourceTimestamp: 250, status: 'unmatched' });
    });
    (0, vitest_1.it)('uses the highest residual hazard rather than a weighted average', () => {
        const result = (0, ruleBased_1.computeCategoryBasedAssessment)(withDetails({
            expectedAttendance: 10_001,
            riskProfile: { pyrotechnics: true },
        }), context, 1);
        const dominant = result.hazards.reduce((highest, hazard) => (hazard.residualMatrixScore > highest.residualMatrixScore ? hazard : highest));
        (0, vitest_1.expect)(result.officialMatrixScore).toBe(dominant.residualMatrixScore);
        (0, vitest_1.expect)(result.officialRiskLevel).toBe((0, types_1.hirarcRiskLevelFor)(dominant.residualMatrixScore));
    });
    (0, vitest_1.it)('does not credit organizer-declared controls as verified controls', () => {
        const declared = (0, ruleBased_1.computeCategoryBasedAssessment)(withDetails({
            riskProfile: { severeWeatherPlan: true },
        }), context, 1);
        const declaredHazard = declared.hazards.find((hazard) => hazard.hazardId === 'weather.severe');
        (0, vitest_1.expect)(declaredHazard.residualSeverity).toBe(declaredHazard.inherentSeverity);
        (0, vitest_1.expect)(declaredHazard.controls.find((control) => control.controlId === 'severe-weather-plan')?.status).toBe('declared');
    });
    (0, vitest_1.it)('separates readiness and compliance from the risk score', () => {
        const result = (0, ruleBased_1.computeCategoryBasedAssessment)(event, {
            ...context,
            weather: { ...context.weather, freshness: 'not_assessable_yet', source: 'fallback' },
            venue: {
                ...context.venue,
                verifiedSafeCapacity: 7_000,
                fireCertificateStatus: 'unknown',
            },
        }, 1);
        (0, vitest_1.expect)(result.assessmentReadiness).toBe('provisional');
        (0, vitest_1.expect)(result.complianceStatus).toBe('blocked');
        (0, vitest_1.expect)(result.manualReviewRequired).toBe(true);
    });
    (0, vitest_1.it)('marks unavailable weather or an unmatched venue as insufficient data', () => {
        const result = (0, ruleBased_1.computeCategoryBasedAssessment)(event, {
            ...context,
            weather: { ...context.weather, freshness: 'unavailable', source: 'fallback' },
            venue: { ...context.venue, matched: false },
        }, 1);
        (0, vitest_1.expect)(result.assessmentReadiness).toBe('insufficient_data');
        (0, vitest_1.expect)(result.dataConfidenceLevel).toBe('low');
    });
    (0, vitest_1.it)('uses a conservative weather floor without reading placeholder measurements outside the forecast horizon', () => {
        const result = (0, ruleBased_1.computeCategoryBasedAssessment)(event, {
            ...context,
            weather: {
                data: null, measurementStatus: 'unavailable', unavailableReason: 'outside_forecast_horizon',
                source: 'fallback', freshness: 'not_assessable_yet', fetchedAt: 1, expiresAt: 1,
                forecastFor: event.eventDetails.startDatetime,
            },
        }, 1);
        (0, vitest_1.expect)(result.assessmentReadiness).toBe('provisional');
        (0, vitest_1.expect)(result.hazards?.find((hazard) => hazard.hazardId === 'weather.severe')?.inherentLikelihood).toBeGreaterThanOrEqual(3);
        (0, vitest_1.expect)(result.evidence.find((item) => item.key === 'weather')).toMatchObject({ eligibility: 'eligible', quality: 'declared' });
    });
    (0, vitest_1.it)('records immutable declarations and each category-facing profile source in context provenance', () => {
        const provenance = (0, ruleBased_1.buildContextEvidenceProvenance)(event, context, 500);
        (0, vitest_1.expect)(provenance).toEqual(vitest_1.expect.arrayContaining([
            vitest_1.expect.objectContaining({ evidenceId: 'context.event.crowd', evidenceKey: 'crowd', sourceKind: 'submitted_declaration', eligibility: 'eligible' }),
            vitest_1.expect.objectContaining({ evidenceId: 'context.event.risk-profile.public_health', evidenceKey: 'public_health', eligibility: 'eligible' }),
            vitest_1.expect.objectContaining({ evidenceId: 'context.event.risk-profile.sanitation', evidenceKey: 'sanitation', eligibility: 'eligible' }),
            vitest_1.expect.objectContaining({ evidenceId: 'context.event.risk-profile.medical', evidenceKey: 'medical', eligibility: 'eligible' }),
            vitest_1.expect.objectContaining({ evidenceId: 'context.event.risk-profile.security', evidenceKey: 'security', eligibility: 'eligible' }),
            vitest_1.expect.objectContaining({ evidenceId: 'context.event.risk-profile.transport', evidenceKey: 'transport', eligibility: 'eligible' }),
        ]));
        (0, vitest_1.expect)(new Set(provenance.map((item) => item.evidenceId)).size).toBe(provenance.length);
    });
    (0, vitest_1.it)('records the verified Storage generation and does not promote missing objects', () => {
        const provenance = (0, ruleBased_1.buildContextEvidenceProvenance)(event, context, 500, [
            { path: event.draftDocumentPaths[0], status: 'missing', retrievedAt: 450, sourceVersion: 'missing', reason: 'storage_object_missing' },
        ]);
        (0, vitest_1.expect)(provenance.find((item) => item.sourceKind === 'submitted_document')).toMatchObject({
            eligibility: 'missing',
            eligibilityReason: 'storage_object_missing',
            retrievedAt: 450,
            sourceVersion: 'missing',
        });
    });
});
function withDetails(details) {
    return {
        ...event,
        eventDetails: {
            ...event.eventDetails,
            ...details,
            riskProfile: { ...event.eventDetails.riskProfile, ...details.riskProfile },
        },
    };
}
function completeRiskProfile() {
    return {
        internationalAttendees: false,
        alcoholServed: false,
        foodServed: false,
        freeDrinkingWater: true,
        ticketedEntry: true,
        overnightAccommodation: false,
        pyrotechnics: false,
        temporaryStructures: false,
        rivalryOrTensionExpected: false,
        crowdManagementPlan: true,
        trafficManagementPlan: true,
        severeWeatherPlan: true,
        medicalPlan: true,
        evacuationPlanTested: true,
        authorityCoordinationConfirmed: true,
        vulnerableAttendeesPercent: 10,
        standingAttendeesPercent: 20,
        nearestHospitalTravelMinutes: 15,
    };
}
(0, vitest_1.describe)('riskLevelFor', () => {
    vitest_1.it.each([[0, 'Low'], [39, 'Low'], [40, 'Medium'], [69, 'Medium'], [70, 'High'], [100, 'High']])('maps %i to %s', (score, level) => (0, vitest_1.expect)((0, types_1.riskLevelFor)(score)).toBe(level));
});
(0, vitest_1.describe)('hirarcRiskLevelFor', () => {
    vitest_1.it.each([[1, 'Low'], [4, 'Low'], [5, 'Medium'], [12, 'Medium'], [15, 'High'], [25, 'High']])('maps matrix score %i to %s', (score, level) => (0, vitest_1.expect)((0, types_1.hirarcRiskLevelFor)(score)).toBe(level));
});
//# sourceMappingURL=ruleBased.test.js.map