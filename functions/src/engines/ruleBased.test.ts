import { describe, expect, it } from 'vitest';
import { AssessmentContextSnapshot, EventRecord, hirarcRiskLevelFor, riskLevelFor } from '@shared/types';
import {
  buildContextEvidenceProvenance,
  buildMatchedVenueContextSnapshot,
  computeCategoryBasedAssessment,
} from './ruleBased';

const event: EventRecord = {
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

const context: AssessmentContextSnapshot = {
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

describe('computeCategoryBasedAssessment', () => {
  it('omits absent optional venue registry fields from Firestore snapshots', () => {
    const snapshot = buildMatchedVenueContextSnapshot({
      venueId: 'venue-minimal',
      active: true,
      name: 'Minimal Venue',
      address: 'Putrajaya',
      capacity: 3_000,
      location: { lat: 2.9006, lng: 101.6805 },
      incidentCount: 0,
    }, 3_000, 3_000, 123);

    expect(snapshot).toEqual({
      matched: true,
      venueId: 'venue-minimal',
      submittedCapacity: 3_000,
      registeredCapacity: 3_000,
      capacityDifference: 0,
      fetchedAt: 123,
    });
    expect(Object.values(snapshot)).not.toContain(undefined);
  });

  it('produces a deterministic HIRARC result with eight all-hazards domains', () => {
    const first = computeCategoryBasedAssessment(event, context, 123);
    const second = computeCategoryBasedAssessment(event, context, 123);
    expect(second).toEqual(first);
    expect(first.officialScore).toBe(first.officialMatrixScore! * 4);
    expect(first.officialMatrixScore).toBe(Math.max(...first.hazards!.map((hazard) => hazard.residualMatrixScore)));
    expect(first.categoryAssignments.map((category) => category.categoryId)).toEqual([
      'crowd',
      'venue_fire',
      'weather_environment',
      'public_health',
      'food_water_sanitation',
      'medical_capacity',
      'security_cbrn',
      'transport_accessibility',
    ]);
    expect(first.categorySchemaVersion).toContain('all-hazards-v2');
    expect(first.categorySchemaStatus).toBe('prototype');
  });

  it('records source status, timestamps, and unmatched venue history', () => {
    const result = computeCategoryBasedAssessment(event, {
      ...context,
      incidentHistory: { ...context.incidentHistory, matched: false, fetchedAt: 250 },
    }, 500);
    expect(result.evidence.find((item) => item.key === 'weather')).toMatchObject({ sourceTimestamp: 100, source: 'openweather', status: 'fresh' });
    expect(result.evidence.find((item) => item.key === 'history')).toMatchObject({ description: 'No stable venue match; comparable history unavailable', sourceTimestamp: 250, status: 'unmatched' });
  });

  it('uses the highest residual hazard rather than a weighted average', () => {
    const result = computeCategoryBasedAssessment(withDetails({
      expectedAttendance: 10_001,
      riskProfile: { pyrotechnics: true },
    }), context, 1);
    const dominant = result.hazards!.reduce((highest, hazard) => (
      hazard.residualMatrixScore > highest.residualMatrixScore ? hazard : highest
    ));
    expect(result.officialMatrixScore).toBe(dominant.residualMatrixScore);
    expect(result.officialRiskLevel).toBe(hirarcRiskLevelFor(dominant.residualMatrixScore));
  });

  it('does not credit organizer-declared controls as verified controls', () => {
    const declared = computeCategoryBasedAssessment(withDetails({
      riskProfile: { severeWeatherPlan: true },
    }), context, 1);
    const declaredHazard = declared.hazards!.find((hazard) => hazard.hazardId === 'weather.severe')!;
    expect(declaredHazard.residualSeverity).toBe(declaredHazard.inherentSeverity);
    expect(declaredHazard.controls.find((control) => control.controlId === 'severe-weather-plan')?.status).toBe('declared');
  });

  it('separates readiness and compliance from the risk score', () => {
    const result = computeCategoryBasedAssessment(event, {
      ...context,
      weather: { ...context.weather, freshness: 'not_assessable_yet', source: 'fallback' },
      venue: {
        ...context.venue,
        verifiedSafeCapacity: 7_000,
        fireCertificateStatus: 'unknown',
      },
    }, 1);
    expect(result.assessmentReadiness).toBe('provisional');
    expect(result.complianceStatus).toBe('blocked');
    expect(result.manualReviewRequired).toBe(true);
  });

  it('marks unavailable weather or an unmatched venue as insufficient data', () => {
    const result = computeCategoryBasedAssessment(event, {
      ...context,
      weather: { ...context.weather, freshness: 'unavailable', source: 'fallback' },
      venue: { ...context.venue, matched: false },
    }, 1);
    expect(result.assessmentReadiness).toBe('insufficient_data');
    expect(result.dataConfidenceLevel).toBe('low');
  });

  it('uses a conservative weather floor without reading placeholder measurements outside the forecast horizon', () => {
    const result = computeCategoryBasedAssessment(event, {
      ...context,
      weather: {
        data: null, measurementStatus: 'unavailable', unavailableReason: 'outside_forecast_horizon',
        source: 'fallback', freshness: 'not_assessable_yet', fetchedAt: 1, expiresAt: 1,
        forecastFor: event.eventDetails.startDatetime,
      },
    }, 1);
    expect(result.assessmentReadiness).toBe('provisional');
    expect(result.hazards?.find((hazard) => hazard.hazardId === 'weather.severe')?.inherentLikelihood).toBeGreaterThanOrEqual(3);
    expect(result.evidence.find((item) => item.key === 'weather')).toMatchObject({ eligibility: 'eligible', quality: 'declared' });
  });

  it('records immutable declarations and each category-facing profile source in context provenance', () => {
    const provenance = buildContextEvidenceProvenance(event, context, 500);
    expect(provenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidenceId: 'context.event.crowd', evidenceKey: 'crowd', sourceKind: 'submitted_declaration', eligibility: 'eligible' }),
      expect.objectContaining({ evidenceId: 'context.event.risk-profile.public_health', evidenceKey: 'public_health', eligibility: 'eligible' }),
      expect.objectContaining({ evidenceId: 'context.event.risk-profile.sanitation', evidenceKey: 'sanitation', eligibility: 'eligible' }),
      expect.objectContaining({ evidenceId: 'context.event.risk-profile.medical', evidenceKey: 'medical', eligibility: 'eligible' }),
      expect.objectContaining({ evidenceId: 'context.event.risk-profile.security', evidenceKey: 'security', eligibility: 'eligible' }),
      expect.objectContaining({ evidenceId: 'context.event.risk-profile.transport', evidenceKey: 'transport', eligibility: 'eligible' }),
    ]));
    expect(new Set(provenance.map((item) => item.evidenceId)).size).toBe(provenance.length);
  });

  it('records the verified Storage generation and does not promote missing objects', () => {
    const provenance = buildContextEvidenceProvenance(event, context, 500, [
      { path: event.draftDocumentPaths[0], status: 'missing', retrievedAt: 450, sourceVersion: 'missing', reason: 'storage_object_missing' },
    ]);
    expect(provenance.find((item) => item.sourceKind === 'submitted_document')).toMatchObject({
      eligibility: 'missing',
      eligibilityReason: 'storage_object_missing',
      retrievedAt: 450,
      sourceVersion: 'missing',
    });
  });
});

function withDetails(details: Partial<EventRecord['eventDetails']>): EventRecord {
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

describe('riskLevelFor', () => {
  it.each([[0, 'Low'], [39, 'Low'], [40, 'Medium'], [69, 'Medium'], [70, 'High'], [100, 'High']] as const)(
    'maps %i to %s',
    (score, level) => expect(riskLevelFor(score)).toBe(level),
  );
});

describe('hirarcRiskLevelFor', () => {
  it.each([[1, 'Low'], [4, 'Low'], [5, 'Medium'], [12, 'Medium'], [15, 'High'], [25, 'High']] as const)(
    'maps matrix score %i to %s',
    (score, level) => expect(hirarcRiskLevelFor(score)).toBe(level),
  );
});
