import { EventDetails, EventRiskProfile, EventStatus, EventType, M1_DOCUMENT_SCHEMA_VERSION, M1_EVIDENCE_MANIFEST_SCHEMA_VERSION, M1DocumentExtraction, M1DraftDocument, M1EvidenceRequirementResponse, M1ExtractedField, M1TemplateSelection } from '@shared/types';
import { isValidM1TemplateSelection, m1CategoryForEventType, m1VenueSettingMatchesEnvironment } from '@shared/m1TemplateContract';
import { isM1EvidenceForcedRequired, m1EvidenceRequirementsFor } from '@shared/m1EvidenceContract';

export type OrganizerApplicationStatus = EventStatus;
export type OrganizerStatusFilter = OrganizerApplicationStatus | 'all';

export const ORGANIZER_STATUS_FILTERS: OrganizerStatusFilter[] = [
  'all',
  'Draft',
  'Pending',
  'UnderReview',
  'Approved',
  'Rejected',
  'Cancelled',
  'Withdrawn',
  'Manual Review Required',
];

export function isEditableApplicationStatus(status: unknown): status is 'Draft' {
  return status === 'Draft';
}

export function isWithdrawableApplicationStatus(status: unknown): status is 'UnderReview' | 'Approved' | 'Manual Review Required' {
  return status === 'UnderReview' || status === 'Approved' || status === 'Manual Review Required';
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
  draftDocuments?: M1DraftDocument[],
  currentExtractionId?: string,
  evidenceManifest?: M1EvidenceRequirementResponse[],
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
  if (draftDocuments !== undefined) {
    if (draftDocuments.filter((document) => document.role === 'core_template').length !== 1) errors.push('Upload exactly one completed Core DOCX.');
    if (draftDocuments.filter((document) => document.role === 'scenario_template').length !== 1) errors.push('Upload exactly one completed scenario DOCX.');
    if (!currentExtractionId) errors.push('Extract and review the completed application documents before submission.');
    if (templateSelection) errors.push(...validateM1EvidenceChecklist(details, templateSelection, draftDocuments, evidenceManifest));
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

export function createM1DraftRecord(organizerId: string, eventDetails: EventDetails, templateSelection: M1TemplateSelection, now: number) {
  return {
    organizerId,
    eventDetails,
    templateSelection,
    status: 'Draft' as const,
    currentVersionNumber: 0,
    editableVersionId: 'v1',
    draftDocumentPaths: [] as string[],
    draftDocuments: [] as M1DraftDocument[],
    documentSchemaVersion: M1_DOCUMENT_SCHEMA_VERSION,
    draftEvidenceManifest: reconcileM1EvidenceManifest(templateSelection, eventDetails, []),
    evidenceManifestSchemaVersion: M1_EVIDENCE_MANIFEST_SCHEMA_VERSION,
    requiredAuthorities: [] as const,
    createdAt: now,
    updatedAt: now,
  };
}

export function reconcileM1EvidenceManifest(
  selection: M1TemplateSelection,
  details: EventDetails,
  current: M1EvidenceRequirementResponse[],
): M1EvidenceRequirementResponse[] {
  const previous = new Map(current.map((response) => [response.requirementId, response]));
  return m1EvidenceRequirementsFor(selection.scenarioTemplateId).map((definition) => {
    const existing = previous.get(definition.id);
    if (isM1EvidenceForcedRequired(definition, details.riskProfile)) {
      return {
        requirementId: definition.id,
        applicability: 'required',
        ...(existing?.documentPath ? { documentPath: existing.documentPath } : {}),
      };
    }
    return existing ?? { requirementId: definition.id, applicability: 'not_applicable', notApplicableReason: '' };
  });
}

export function validateM1EvidenceChecklist(
  details: EventDetails,
  selection: M1TemplateSelection,
  documents: M1DraftDocument[],
  manifest: M1EvidenceRequirementResponse[] | undefined,
): string[] {
  const definitions = m1EvidenceRequirementsFor(selection.scenarioTemplateId);
  if (!manifest || manifest.length !== definitions.length) return ['Complete every supporting-evidence checklist item.'];
  const responses = new Map(manifest.map((response) => [response.requirementId, response]));
  const supportingPaths = new Set(documents.filter((document) => document.role === 'supporting_evidence').map((document) => document.path));
  const referencedPaths = new Set(manifest.flatMap((response) => response.documentPath ? [response.documentPath] : []));
  const errors: string[] = [];
  for (const definition of definitions) {
    const response = responses.get(definition.id);
    if (!response) { errors.push(`Complete supporting-evidence item ${definition.id}.`); continue; }
    if (isM1EvidenceForcedRequired(definition, details.riskProfile) && response.applicability !== 'required') {
      errors.push(`${definition.id} is required for the current event declarations.`);
    } else if (response.applicability === 'required' && (!response.documentPath || !supportingPaths.has(response.documentPath))) {
      errors.push(`Attach a supporting-evidence file to ${definition.id}.`);
    } else if (response.applicability === 'not_applicable' && (response.notApplicableReason?.trim().length ?? 0) < 10) {
      errors.push(`Explain why ${definition.id} is not applicable (at least 10 characters).`);
    }
  }
  if ([...supportingPaths].some((path) => !referencedPaths.has(path))) errors.push('Every uploaded supporting-evidence file must be linked to a checklist item.');
  return errors;
}

export function applyM1ExtractedFields(details: EventDetails, fields: M1ExtractedField[]): EventDetails {
  const next: EventDetails = { ...details, riskProfile: completeRiskProfile(details.riskProfile) };
  for (const field of fields) {
    switch (field.target) {
      case 'name': case 'description': case 'venueAddress': case 'emergencyPlanSummary':
      case 'organizerName': case 'organizerEmail': case 'organizerPhone':
        if (typeof field.value === 'string') Object.assign(next, { [field.target]: field.value });
        break;
      case 'venueCapacity': case 'expectedAttendance': case 'startDatetime': case 'endDatetime':
        if (typeof field.value === 'number' && Number.isFinite(field.value)) Object.assign(next, { [field.target]: field.value });
        break;
      case 'riskProfile.pyrotechnics': case 'riskProfile.temporaryStructures': case 'riskProfile.foodServed':
      case 'riskProfile.alcoholServed': case 'riskProfile.ticketedEntry': {
        if (typeof field.value !== 'boolean') break;
        const key = field.target.slice('riskProfile.'.length) as keyof EventRiskProfile;
        next.riskProfile = { ...next.riskProfile, [key]: field.value };
        break;
      }
    }
  }
  return next;
}

export function extractionMatchesDraftDocuments(extraction: M1DocumentExtraction, documents: M1DraftDocument[]): boolean {
  const current = documents
    .filter((document) => document.role === 'core_template' || document.role === 'scenario_template')
    .map((document) => `${document.role}:${document.path}:${document.originalName}:${document.mimeType}:${document.sizeBytes}`)
    .sort();
  const extracted = Array.isArray(extraction.sourceDocuments)
    ? extraction.sourceDocuments
      .map((document) => `${document.role}:${document.path}:${document.originalName}:${document.mimeType}:${document.sizeBytes}`)
      .sort()
    : [];
  return current.length === 2 && extracted.length === 2 && JSON.stringify(current) === JSON.stringify(extracted);
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
