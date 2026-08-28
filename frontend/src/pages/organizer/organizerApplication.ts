import { EventDetails, EventRiskProfile, EventStatus, EventType, M1TemplateSelection } from '@shared/types';
import { isValidM1TemplateSelection, m1CategoryForEventType, m1VenueSettingMatchesEnvironment } from '@shared/m1TemplateContract';

export type RevisionRequestedStatus = 'Revision Requested';
export type OrganizerApplicationStatus = EventStatus | RevisionRequestedStatus;
export type OrganizerStatusFilter = OrganizerApplicationStatus | 'all';

export const ORGANIZER_STATUS_FILTERS: OrganizerStatusFilter[] = [
  'all',
  'Draft',
  'Pending',
  'UnderReview',
  'Revision Requested',
  'Approved',
  'Rejected',
  'Withdrawn',
  'Manual Review Required',
];

export function isEditableApplicationStatus(status: unknown): status is 'Draft' | RevisionRequestedStatus {
  return status === 'Draft' || status === 'Revision Requested';
}

export function isWithdrawableApplicationStatus(status: unknown): status is 'Draft' | 'Pending' {
  return status === 'Draft' || status === 'Pending';
}

export function applicationStatusLabel(status: string): string {
  if (status === 'UnderReview') return 'Under Review';
  return status.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function nextVersionId(currentVersionNumber: unknown): string {
  return `v${Number.isSafeInteger(currentVersionNumber) ? Number(currentVersionNumber) + 1 : 1}`;
}

export function validateEventApplication(
  details: EventDetails,
  documentPaths: string[],
  templateSelection?: M1TemplateSelection,
  now = Date.now(),
): string[] {
  const errors: string[] = [];
  errors.push(...validateTemplateCompatibility(details, templateSelection));
  requiredText(details.name, 'Event name', 200, errors);
  requiredText(details.venueName, 'Venue name', 200, errors);
  requiredText(details.venueAddress, 'Venue address', 500, errors);
  requiredText(details.organizerName, 'Organizer name', 200, errors);
  requiredText(details.organizerEmail, 'Organizer email', 320, errors);
  if (details.organizerEmail.trim() && !isEmail(details.organizerEmail)) errors.push('Organizer email is invalid.');
  requiredText(details.organizerPhone, 'Organizer phone', 50, errors);
  requiredText(details.emergencyPlanSummary, 'Emergency-plan summary', 2_000, errors);
  optionalText(details.description, 'Description', 2_000, errors);

  if (!EVENT_TYPE_VALUES.has(details.type)) errors.push('Event type is invalid.');
  if (!ENVIRONMENTS.has(details.environment)) errors.push('Environment is invalid.');
  if (!COVERAGE.has(details.coverage)) errors.push('Coverage is invalid.');
  if (!SEATING.has(details.seating)) errors.push('Seating is invalid.');

  positiveInteger(details.venueCapacity, 'Venue capacity', errors);
  positiveInteger(details.expectedAttendance, 'Expected attendance', errors);
  if (Number.isInteger(details.venueCapacity) && Number.isInteger(details.expectedAttendance)
    && details.expectedAttendance > details.venueCapacity) {
    errors.push('Expected attendance cannot exceed venue capacity.');
  }

  if (!details.venueLocation
    || !validCoordinate(details.venueLocation.lat, -90, 90)
    || !validCoordinate(details.venueLocation.lng, -180, 180)) {
    errors.push('Valid venue coordinates are required.');
  }
  if (!Number.isFinite(details.startDatetime) || details.startDatetime <= now) {
    errors.push('Start datetime must be in the future.');
  }
  if (!Number.isFinite(details.endDatetime) || !Number.isFinite(details.startDatetime)
    || details.endDatetime <= details.startDatetime) {
    errors.push('End datetime must be after the start datetime.');
  }

  validateRiskProfile(details.riskProfile, errors);

  if (documentPaths.length < 1 || documentPaths.length > 20 || new Set(documentPaths).size !== documentPaths.length) {
    errors.push('Submit between 1 and 20 unique supporting evidence files.');
  }

  return errors;
}

export function validateTemplateCompatibility(details: EventDetails, templateSelection?: M1TemplateSelection): string[] {
  if (!templateSelection) return ['Select the Core and scenario templates before submitting.'];
  if (!isValidM1TemplateSelection(templateSelection)) {
    return ['The selected template recommendation is invalid or out of date. Choose the templates again.'];
  }
  const errors: string[] = [];
  if (m1CategoryForEventType(details.type) !== templateSelection.eventCategory) {
    errors.push('Event type does not match the selected scenario template. Change the template recommendation or event type.');
  }
  if (!m1VenueSettingMatchesEnvironment(templateSelection.venueSetting, details.environment)) {
    errors.push('Event environment does not match the selected venue-setting template.');
  }
  return errors;
}

export function createInitialEventDetails(profile?: { name?: string; email?: string; phone?: string }): EventDetails {
  return {
    name: '',
    type: 'concert',
    venueName: '',
    venueAddress: '',
    venueCapacity: 0,
    expectedAttendance: 0,
    environment: 'outdoor',
    coverage: 'uncovered',
    seating: 'mixed',
    startDatetime: 0,
    endDatetime: 0,
    description: '',
    emergencyPlanSummary: '',
    riskProfile: completeRiskProfile(),
    organizerName: profile?.name ?? '',
    organizerEmail: profile?.email ?? '',
    organizerPhone: profile?.phone ?? '',
  };
}

export function completeRiskProfile(value: unknown = {}): EventRiskProfile {
  const source = value && typeof value === 'object' ? value as Partial<EventRiskProfile> : {};
  return {
    vulnerableAttendeesPercent: source.vulnerableAttendeesPercent ?? 0,
    standingAttendeesPercent: source.standingAttendeesPercent ?? 0,
    internationalAttendees: source.internationalAttendees ?? false,
    alcoholServed: source.alcoholServed ?? false,
    foodServed: source.foodServed ?? false,
    freeDrinkingWater: source.freeDrinkingWater ?? false,
    ticketedEntry: source.ticketedEntry ?? false,
    overnightAccommodation: source.overnightAccommodation ?? false,
    pyrotechnics: source.pyrotechnics ?? false,
    temporaryStructures: source.temporaryStructures ?? false,
    rivalryOrTensionExpected: source.rivalryOrTensionExpected ?? false,
    crowdManagementPlan: source.crowdManagementPlan ?? false,
    trafficManagementPlan: source.trafficManagementPlan ?? false,
    severeWeatherPlan: source.severeWeatherPlan ?? false,
    medicalPlan: source.medicalPlan ?? false,
    evacuationPlanTested: source.evacuationPlanTested ?? false,
    authorityCoordinationConfirmed: source.authorityCoordinationConfirmed ?? false,
    ...(source.nearestHospitalTravelMinutes !== undefined ? { nearestHospitalTravelMinutes: source.nearestHospitalTravelMinutes } : {}),
  };
}

const EVENT_TYPE_VALUES = new Set<EventType>([
  'concert',
  'festival',
  'sports',
  'cultural',
  'religious',
  'exhibition',
  'fair',
  'conference',
  'other',
]);
const ENVIRONMENTS = new Set(['indoor', 'outdoor', 'mixed']);
const COVERAGE = new Set(['covered', 'partially_covered', 'uncovered']);
const SEATING = new Set(['seated', 'standing', 'mixed']);
const RISK_BOOLEAN_FIELDS = [
  'internationalAttendees',
  'alcoholServed',
  'foodServed',
  'freeDrinkingWater',
  'ticketedEntry',
  'overnightAccommodation',
  'pyrotechnics',
  'temporaryStructures',
  'rivalryOrTensionExpected',
  'crowdManagementPlan',
  'trafficManagementPlan',
  'severeWeatherPlan',
  'medicalPlan',
  'evacuationPlanTested',
  'authorityCoordinationConfirmed',
] as const;

function validateRiskProfile(value: EventDetails['riskProfile'], errors: string[]): void {
  if (!value || typeof value !== 'object') {
    errors.push('A complete all-hazards profile is required.');
    return;
  }
  for (const key of RISK_BOOLEAN_FIELDS) {
    if (typeof value[key] !== 'boolean') errors.push(`${riskFieldLabel(key)} must be answered true or false.`);
  }
  boundedNumber(value.vulnerableAttendeesPercent, 'Vulnerable attendees percent', 0, 100, errors);
  boundedNumber(value.standingAttendeesPercent, 'Standing attendees percent', 0, 100, errors);
  if (value.nearestHospitalTravelMinutes !== undefined) {
    boundedNumber(value.nearestHospitalTravelMinutes, 'Nearest hospital travel time', 0, 240, errors);
  }
}

function requiredText(value: string, label: string, max: number, errors: string[]): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    errors.push(`${label} is required and must be at most ${max} characters.`);
  }
}

function optionalText(value: string | undefined, label: string, max: number, errors: string[]): void {
  if (value !== undefined && (typeof value !== 'string' || value.length > max)) {
    errors.push(`${label} must be at most ${max} characters.`);
  }
}

function positiveInteger(value: number, label: string, errors: string[]): void {
  if (!Number.isInteger(value) || value <= 0) errors.push(`${label} must be a positive integer.`);
}

function boundedNumber(value: number | undefined, label: string, min: number, max: number, errors: string[]): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    errors.push(`${label} must be between ${min} and ${max}.`);
  }
}

function validCoordinate(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function riskFieldLabel(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (char) => char.toUpperCase());
}
