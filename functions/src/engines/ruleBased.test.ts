import { describe, expect, it } from 'vitest';
import { EventRecord, Incident, WeatherContext, finalScoreFor, riskLevelFor } from '@shared/types';
import { computeRuleBased } from './ruleBased';

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

const weather: WeatherContext = {
  forecast: 'Thunderstorm',
  temperature: 31,
  humidity: 85,
  windSpeed: 4,
  precipitationProbability: 80,
  severeAlert: true,
};

describe('computeRuleBased', () => {
  it('produces a deterministic weighted baseline with evidence', async () => {
    const first = await computeRuleBased(event, weather, true, true, [], 123);
    const second = await computeRuleBased(event, weather, true, true, [], 123);
    expect(second).toEqual(first);
    expect(first.baselineScore).toBe(Math.round(Object.values(first.weightedContributions).reduce((sum, value) => sum + value, 0)));
    expect(first.evidence.map((item) => item.key)).toEqual(['weather', 'crowd', 'venue', 'history', 'holiday']);
  });

  it('records independent source timestamps and unmatched venue history', async () => {
    const result = await computeRuleBased(event, weather, false, false, [], 500, { weather: 100, history: 200, holiday: 300 }, false);
    expect(result.evidence.find((item) => item.key === 'weather')?.sourceTimestamp).toBe(100);
    expect(result.evidence.find((item) => item.key === 'history')).toMatchObject({ description: 'No stable venue match; history unavailable', sourceTimestamp: 200 });
  });

  it.each([
    [5_000, 12],
    [5_001, 30],
    [7_500, 30],
    [7_501, 40],
    [9_000, 40],
    [9_001, 55],
    [10_001, 80],
  ])('applies crowd thresholds at %i attendees', async (expectedAttendance, expected) => {
    const result = await computeRuleBased(withDetails({ expectedAttendance }), weather, false, false, [], 1);
    expect(result.subScores.crowd).toBe(expected);
  });

  it.each([
    [false, false, 0],
    [false, true, 30],
    [true, false, 60],
    [true, true, 90],
  ])('scores holiday=%s and weekend=%s as %i', async (holiday, weekend, expected) => {
    const result = await computeRuleBased(event, weather, holiday, weekend, [], 1);
    expect(result.subScores.holiday).toBe(expected);
  });

  it('clamps severe compound weather and incident history to 100', async () => {
    const severeWeather = { ...weather, temperature: 36, windSpeed: 11 };
    const incidents: Incident[] = Array.from({ length: 3 }, (_, index) => ({
      incidentId: `incident-${index}`,
      venueId: 'venue-1',
      eventType: 'festival',
      incidentType: 'crowd_surge',
      severity: 'high',
      date: index,
    }));
    const result = await computeRuleBased(event, severeWeather, false, false, incidents, 1);
    expect(result.subScores.weather).toBe(100);
    expect(result.subScores.history).toBe(100);
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

describe('finalScoreFor', () => {
  it.each([
    [40, -2, 0, 40],
    [40, 8, 8, 48],
    [40, 20, 15, 55],
    [95, 15, 15, 100],
  ] as const)('validates baseline %i with adjustment %i', (baseline, proposed, adjustment, finalScore) => {
    expect(finalScoreFor(baseline, proposed)).toMatchObject({ validatedAdjustment: adjustment, finalScore });
  });
});
