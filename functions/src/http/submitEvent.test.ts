import { describe, expect, it } from 'vitest';
import { EventDetails } from '@shared/types';
import { isValidEvidenceMetadata, requiredAuthoritiesFor, validateCanonicalVenueRecord, validateEventDetails, validateEvidencePaths } from './submitEvent';

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
  riskProfile: completeRiskProfile(),
};

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

  it('requires every all-hazards declaration and rejects organizer-verified controls', () => {
    const incomplete = { ...validDetails, riskProfile: { ...validDetails.riskProfile } };
    delete (incomplete.riskProfile as Record<string, unknown>).pyrotechnics;
    expect(validateEventDetails(incomplete, 1_000).join(' ')).toMatch(/pyrotechnics must be answered/i);
    expect(validateEventDetails({
      ...validDetails,
      riskProfile: { ...validDetails.riskProfile, verifiedControlIds: ['medical-plan'] },
    }, 1_000).join(' ')).toMatch(/unsupported fields: verifiedControlIds/i);
  });

  it('rejects non-finite and out-of-range risk-profile values', () => {
    expect(validateEventDetails({ ...validDetails, riskProfile: { ...validDetails.riskProfile, vulnerableAttendeesPercent: Number.NaN } }, 1_000).join(' ')).toMatch(/Vulnerable attendees percent/);
    expect(validateEventDetails({ ...validDetails, riskProfile: { ...validDetails.riskProfile, standingAttendeesPercent: 101 } }, 1_000).join(' ')).toMatch(/Standing attendees percent/);
  });
});

describe('submission evidence and registry venue integrity', () => {
  it('enforces 1-20 unique version-owned evidence paths', () => {
    expect(validateEvidencePaths('event-1', 'v1', [])).not.toEqual([]);
    expect(validateEvidencePaths('event-1', 'v1', ['event_documents/other/v1/a.pdf'])).not.toEqual([]);
    expect(validateEvidencePaths('event-1', 'v1', Array.from({ length: 21 }, (_, index) => `event_documents/event-1/v1/${index}.pdf`))).not.toEqual([]);
    expect(validateEvidencePaths('event-1', 'v1', ['event_documents/event-1/v1/a.pdf'])).toEqual([]);
  });

  it('enforces allowed MIME types and the 10 MB boundary', () => {
    expect(isValidEvidenceMetadata({ contentType: 'application/pdf', size: String(10 * 1024 * 1024), generation: '1' })).toBe(true);
    expect(isValidEvidenceMetadata({ contentType: 'text/plain', size: '100', generation: '1' })).toBe(false);
    expect(isValidEvidenceMetadata({ contentType: 'image/png', size: String(10 * 1024 * 1024 + 1), generation: '1' })).toBe(false);
    expect(isValidEvidenceMetadata({ contentType: 'image/png', size: '0', generation: '1' })).toBe(false);
    expect(isValidEvidenceMetadata({ contentType: 'image/png', size: '100' })).toBe(false);
  });

  it('requires exact identity binding to an active canonical venue', () => {
    const venue = { active: true, verificationStatus: 'verified', name: validDetails.venueName, address: validDetails.venueAddress, capacity: 2_000, location: validDetails.venueLocation };
    expect(validateCanonicalVenueRecord(validDetails, venue)).toEqual([]);
    expect(validateCanonicalVenueRecord(validDetails, { ...venue, active: false })).not.toEqual([]);
    expect(validateCanonicalVenueRecord(validDetails, { ...venue, capacity: 2_001 })).not.toEqual([]);
    expect(validateCanonicalVenueRecord(validDetails, { ...venue, location: { lat: 0, lng: 0 } })).not.toEqual([]);
  });
});

describe('requiredAuthoritiesFor', () => {
  it('adds MOTAC for cultural events and DBKL for Kuala Lumpur', () => {
    expect(requiredAuthoritiesFor(validDetails)).toEqual(['PDRM', 'BOMBA', 'KKM', 'MOTAC', 'DBKL']);
  });
});
