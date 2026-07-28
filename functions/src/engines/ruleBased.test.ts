import { describe, expect, it } from 'vitest';
import { AssessmentContextSnapshot, EventRecord, hirarcRiskLevelFor, riskLevelFor } from '@shared/types';
import { computeCategoryBasedAssessment } from './ruleBased';

const event: EventRecord = {
  eventId: 'event-1',
  organizerId: 'organizer-1',
  status: 'Pending',
  currentVersionNumber: 1,
  draftDocumentPaths: [],
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
  },
};

const context: AssessmentContextSnapshot = {
  weather: {
    data: { forecast: 'Thunderstorm', temperature: 31, humidity: 85, windSpeed: 4, precipitationProbability: 80, severeAlert: true },
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
    fetchedAt: 200,
  },
};

describe('computeCategoryBasedAssessment', () => {
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

  it('does not credit declared-only controls, but credits verified controls', () => {
    const declared = computeCategoryBasedAssessment(withDetails({
      riskProfile: { severeWeatherPlan: true },
    }), context, 1);
    const verified = computeCategoryBasedAssessment(withDetails({
      riskProfile: {
        severeWeatherPlan: true,
        verifiedControlIds: ['severe-weather-plan'],
      },
    }), context, 1);
    const declaredHazard = declared.hazards!.find((hazard) => hazard.hazardId === 'weather.severe')!;
    const verifiedHazard = verified.hazards!.find((hazard) => hazard.hazardId === 'weather.severe')!;
    expect(declaredHazard.residualSeverity).toBe(declaredHazard.inherentSeverity);
    expect(verifiedHazard.residualSeverity).toBe(declaredHazard.inherentSeverity - 1);
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
});

function withDetails(details: Partial<EventRecord['eventDetails']>): EventRecord {
  return { ...event, eventDetails: { ...event.eventDetails, ...details } };
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
