import { describe, expect, it } from 'vitest';
import { EventDetails } from '@shared/types';
import { computeResources } from './resourceCalculator';

const details: EventDetails = {
  name: 'Indoor Conference',
  type: 'conference',
  venueName: 'Convention Centre',
  venueAddress: 'Kuala Lumpur',
  venueCapacity: 1_000,
  expectedAttendance: 251,
  environment: 'indoor',
  coverage: 'covered',
  seating: 'seated',
  startDatetime: 1,
  endDatetime: 2,
  emergencyPlanSummary: 'Plan',
  organizerName: 'Organizer',
  organizerEmail: 'organizer@example.com',
  organizerPhone: '+60000000000',
};

describe('computeResources', () => {
  it('uses ceiling formulas and event environment', () => {
    const result = computeResources(details, 'Low');
    expect(result.police).toBe(2);
    expect(result.toilets).toBe(10);
    expect(result.fireOfficers).toBe(2);
  });

  it('adds high-risk staffing', () => {
    const result = computeResources(details, 'High');
    expect(result.police).toBe(12);
    expect(result.medicalTeams).toBe(2);
  });

  it('never returns negative or non-finite quantities for malformed attendance', () => {
    for (const attendance of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = computeResources({ ...details, expectedAttendance: attendance }, 'Low');
      expect(Object.values(result).every((value) => Number.isInteger(value) && value >= 0)).toBe(true);
    }
  });
});
