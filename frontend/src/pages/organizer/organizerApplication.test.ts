import { describe, expect, it } from 'vitest';
import { EventDetails } from '@shared/types';
import { isEditableApplicationStatus, validateEventApplication } from './organizerApplication';

const future = Date.now() + 7 * 24 * 60 * 60 * 1000;

function validDetails(overrides: Partial<EventDetails> = {}): EventDetails {
  return {
    name: 'Tourism Forum',
    type: 'conference',
    venueName: 'PICC',
    venueAddress: 'Putrajaya, Malaysia',
    venueLocation: { lat: 2.9264, lng: 101.6964 },
    venueCapacity: 1000,
    expectedAttendance: 500,
    environment: 'indoor',
    coverage: 'covered',
    seating: 'seated',
    startDatetime: future,
    endDatetime: future + 4 * 60 * 60 * 1000,
    emergencyPlanSummary: 'Medical desk, evacuation exits, traffic marshals, and authority coordination.',
    riskProfile: {
      vulnerableAttendeesPercent: 0,
      standingAttendeesPercent: 0,
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
      evacuationPlanTested: false,
      authorityCoordinationConfirmed: true,
    },
    organizerName: 'Test Organizer',
    organizerEmail: 'organizer@example.com',
    organizerPhone: '+60 12-345 6789',
    ...overrides,
  };
}

describe('organizer application lifecycle helpers', () => {
  it('treats draft and revision-requested applications as editable', () => {
    expect(isEditableApplicationStatus('Draft')).toBe(true);
    expect(isEditableApplicationStatus('Revision Requested')).toBe(true);
    expect(isEditableApplicationStatus('Pending')).toBe(false);
  });

  it('accepts a complete application with version-scoped evidence', () => {
    expect(validateEventApplication(validDetails(), ['event_documents/event-1/v1/plan.pdf'])).toEqual([]);
  });

  it('blocks attendance above capacity and missing evidence before submit', () => {
    expect(validateEventApplication(validDetails({ expectedAttendance: 1200 }), [])).toEqual(expect.arrayContaining([
      'Expected attendance cannot exceed venue capacity.',
      'Submit between 1 and 20 unique supporting evidence files.',
    ]));
  });
});
