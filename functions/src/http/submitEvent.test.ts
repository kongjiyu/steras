import { describe, expect, it } from 'vitest';
import { EventDetails } from '@shared/types';
import { requiredAuthoritiesFor, validateEventDetails } from './submitEvent';

const validDetails: EventDetails = {
  name: 'KL Cultural Festival',
  type: 'cultural',
  venueName: 'Central Venue',
  venueAddress: 'Kuala Lumpur',
  venueLocation: { lat: 3.139, lng: 101.687 },
  venueCapacity: 2_000,
  expectedAttendance: 1_500,
  environment: 'outdoor',
  coverage: 'partially_covered',
  seating: 'mixed',
  startDatetime: 2_000,
  endDatetime: 3_000,
  emergencyPlanSummary: 'Emergency exits and first-aid posts are documented.',
  organizerName: 'Organizer',
  organizerEmail: 'organizer@example.com',
  organizerPhone: '+60123456789',
};

describe('validateEventDetails', () => {
  it('accepts a complete future event', () => {
    expect(validateEventDetails(validDetails, 1_000)).toEqual([]);
  });

  it('rejects invalid coordinates, dates, and capacity', () => {
    const errors = validateEventDetails({ ...validDetails, venueCapacity: 0, venueLocation: { lat: 100, lng: 0 }, startDatetime: 1_500, endDatetime: 1_400 }, 1_600);
    expect(errors.join(' ')).toMatch(/capacity/i);
    expect(errors.join(' ')).toMatch(/coordinates/i);
    expect(errors.join(' ')).toMatch(/future/i);
  });

  it('rejects non-finite dates, invalid organizer email, and attendance above capacity', () => {
    const errors = validateEventDetails({
      ...validDetails,
      organizerEmail: 'not-an-email',
      venueCapacity: 100,
      expectedAttendance: 101,
      startDatetime: Number.NaN,
      endDatetime: Number.POSITIVE_INFINITY,
    }, 1_000);
    expect(errors).toEqual(expect.arrayContaining([
      'Organizer email is invalid.',
      'Expected attendance cannot exceed venue capacity.',
      'Start datetime must be in the future.',
      'End datetime must be after the start datetime.',
    ]));
  });
});

describe('requiredAuthoritiesFor', () => {
  it('adds MOTAC for cultural events and DBKL for Kuala Lumpur', () => {
    expect(requiredAuthoritiesFor(validDetails)).toEqual(['PDRM', 'BOMBA', 'KKM', 'MOTAC', 'DBKL']);
  });
});
