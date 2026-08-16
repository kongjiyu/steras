/**
 * Event supporting documents (per `template content.md` + `steras-event-info.md`).
 *
 * M1 owns the upload flow (Firebase Storage). M3 sees the resulting
 * document list with upload status (pending / uploaded / verified /
 * rejected) during review.
 *
 * The 9 core documents are required for every event. The 14 trigger-based
 * additional documents come from the trigger map (see `event_triggers.ts`).
 *
 * Local type — promote to `@shared/types.ts` when the M1 contract is locked.
 */

import { EVENT_IDS } from './ids';
import { type EventTrigger } from './event_triggers';

// ---------------------------------------------------------------------------
// Core document types (9 documents required for every event)
// ---------------------------------------------------------------------------
export type CoreDocumentType =
  | 'organiser_identification'        // Doc 1 - MyKad / passport
  | 'organisation_registration'       // Doc 2 - SSM / ROS
  | 'venue_permission_letter'         // Doc 3 - venue consent
  | 'site_layout_plan'                // Doc 4 - floor / site plan
  | 'location_map_photos'              // Doc 5 - map + photos
  | 'event_programme_schedule'         // Doc 6 - timetable
  | 'safety_operational_plan'         // Doc 7 - safety plan
  | 'emergency_evacuation_plan'       // Doc 8 - emergency plan + map
  | 'supplier_contractor_list';       // Doc 9 - suppliers

export const CORE_DOCUMENT_TYPES: CoreDocumentType[] = [
  'organiser_identification',
  'organisation_registration',
  'venue_permission_letter',
  'site_layout_plan',
  'location_map_photos',
  'event_programme_schedule',
  'safety_operational_plan',
  'emergency_evacuation_plan',
  'supplier_contractor_list',
];

export const CORE_DOCUMENT_LABELS: Record<CoreDocumentType, string> = {
  organiser_identification:      'Organiser Identification (MyKad / Passport)',
  organisation_registration:     'Organisation Registration (SSM / ROS)',
  venue_permission_letter:       'Venue Permission Letter',
  site_layout_plan:              'Site or Layout Plan',
  location_map_photos:           'Location Map and Current Photographs',
  event_programme_schedule:       'Event Programme or Schedule',
  safety_operational_plan:       "Organiser's Safety and Operational Plan",
  emergency_evacuation_plan:     'Emergency and Evacuation Plan',
  supplier_contractor_list:       'Supplier and Contractor List',
};

export const CORE_DOCUMENT_DESCRIPTIONS: Record<CoreDocumentType, string> = {
  organiser_identification:      'Malaysian applicant: front and back of MyKad combined into one PDF. Non-Malaysian: passport biodata page.',
  organisation_registration:     'SSM certificate/company profile, ROS registration certificate, or another official registration document.',
  venue_permission_letter:       'Signed venue approval letter, booking confirmation, tenancy agreement, or landowner consent letter on official letterhead.',
  site_layout_plan:              'Annotated floor plan or site plan in PDF/JPG/PNG showing entrance/exit, stage, booths, toilets, parking, crowd zones, etc.',
  location_map_photos:           'One map showing exact event location + several recent site photographs of entrance, exit, event area, parking, surroundings.',
  event_programme_schedule:       'Timetable in table format: date, start/end time, activity, location/stage, estimated attendance, person responsible.',
  safety_operational_plan:       'Structured written plan signed by event manager: crowd, security, medical, traffic, communication, sanitation, weather response.',
  emergency_evacuation_plan:     'Written emergency procedure + evacuation map: scenarios, alarm, routes, assembly points, contacts, vulnerable persons.',
  supplier_contractor_list:       'Table of all appointed suppliers + contractors: company name, registration, service, contact, licences, appointment status.',
};

// ---------------------------------------------------------------------------
// Document record (M1 writes, M3 reads)
// ---------------------------------------------------------------------------
export type DocumentStatus = 'not_uploaded' | 'uploaded' | 'verified' | 'rejected';

export interface EventDocument {
  documentType: CoreDocumentType;
  /** Whether this is one of the 9 required core docs OR an additional trigger-based doc. */
  isCore: boolean;
  /** If additional, which trigger required it. */
  requiredByTrigger?: EventTrigger;
  status: DocumentStatus;
  uploadedAt?: number;
  uploadedBy?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  /** Storage path - real path would be `events/{eventId}/versions/{versionId}/docs/{filename}`. */
  storagePath?: string;
  /** Verifier identity (officer who checked this). */
  verifiedBy?: string;
  verifiedAt?: number;
  /** Rejection details (if status === 'rejected'). */
  rejectionReason?: string;
  /** Whether this doc is required at all for this event. */
  required: boolean;
}

export interface EventDocumentSet {
  eventId: string;
  versionId: string;
  documents: EventDocument[];
}

// ---------------------------------------------------------------------------
// Synthetic filenames (real filenames would be uploaded by organiser)
// ---------------------------------------------------------------------------
const docPath = (eventId: string, versionId: string, fileName: string): string =>
  `events/${eventId}/versions/${versionId}/docs/${encodeURIComponent(fileName)}`;

// ---------------------------------------------------------------------------
// Build the document set per event/version
// ---------------------------------------------------------------------------
import { USER_IDS, daysAgo } from './ids';

const baseCoreDocs = (eventId: string, versionId: string, statuses: Partial<Record<CoreDocumentType, DocumentStatus>>, opts: {
  uploadedBy?: string; uploadedAt?: number; verifiedBy?: string; verifiedAt?: number;
} = {}): EventDocument[] => CORE_DOCUMENT_TYPES.map((docType) => {
  const status: DocumentStatus = statuses[docType] ?? 'uploaded';
  const isVerified = status === 'verified';
  const isUploaded = status === 'uploaded' || isVerified;
  return {
    documentType: docType,
    isCore: true,
    required: true,
    status,
    uploadedAt: isUploaded ? (opts.uploadedAt ?? daysAgo(20)) : undefined,
    uploadedBy: isUploaded ? opts.uploadedBy : undefined,
    fileName: isUploaded ? `${docType}.pdf` : undefined,
    fileSize: isUploaded ? 1500000 + Math.floor(Math.random() * 500000) : undefined,
    fileType: isUploaded ? 'application/pdf' : undefined,
    storagePath: isUploaded ? docPath(eventId, versionId, `${docType}.pdf`) : undefined,
    verifiedBy: isVerified ? opts.verifiedBy : undefined,
    verifiedAt: isVerified ? (opts.verifiedAt ?? daysAgo(18)) : undefined,
  };
});

// ---------------------------------------------------------------------------
// Per-event document sets
// ---------------------------------------------------------------------------
export const mockEventDocumentSets: EventDocumentSet[] = [
  // E001 - Approved, all docs verified
  {
    eventId: EVENT_IDS.E001, versionId: 'v1',
    documents: [
      ...baseCoreDocs(EVENT_IDS.E001, 'v1', {
        organiser_identification:    'verified',
        organisation_registration:   'verified',
        venue_permission_letter:     'verified',
        site_layout_plan:            'verified',
        location_map_photos:         'verified',
        event_programme_schedule:     'verified',
        safety_operational_plan:     'verified',
        emergency_evacuation_plan:   'verified',
        supplier_contractor_list:     'verified',
      }, { uploadedBy: USER_IDS.U_ORG_001, verifiedBy: USER_IDS.U_ADM_001 }),
      // Additional: large_indoor_high_crowd docs (venue capacity, fire plan, BOMBA support)
      { documentType: 'venue_capacity_document' as never, isCore: false, requiredByTrigger: 'large_indoor_high_crowd', required: true, status: 'verified', uploadedAt: daysAgo(20), uploadedBy: USER_IDS.U_ORG_001, fileName: 'venue-capacity.pdf', fileSize: 850000, fileType: 'application/pdf', storagePath: docPath(EVENT_IDS.E001, 'v1', 'venue-capacity.pdf'), verifiedBy: USER_IDS.U_ADM_001, verifiedAt: daysAgo(18) },
      { documentType: 'fire_safety_plan' as never, isCore: false, requiredByTrigger: 'large_indoor_high_crowd', required: true, status: 'verified', uploadedAt: daysAgo(20), uploadedBy: USER_IDS.U_ORG_001, fileName: 'fire-safety-plan.pdf', fileSize: 1200000, fileType: 'application/pdf', storagePath: docPath(EVENT_IDS.E001, 'v1', 'fire-safety-plan.pdf'), verifiedBy: USER_IDS.U_OFC_BOMBA_KL_01, verifiedAt: daysAgo(18) },
      // Additional: food_beverage_vendors (vendor list, food licences)
      { documentType: 'vendor_list' as never, isCore: false, requiredByTrigger: 'food_beverage_vendors', required: true, status: 'verified', uploadedAt: daysAgo(20), uploadedBy: USER_IDS.U_ORG_001, fileName: 'vendor-list.pdf', fileSize: 600000, fileType: 'application/pdf', storagePath: docPath(EVENT_IDS.E001, 'v1', 'vendor-list.pdf'), verifiedBy: USER_IDS.U_OFC_DBKL_KL_01, verifiedAt: daysAgo(17) },
      { documentType: 'food_licences' as never, isCore: false, requiredByTrigger: 'food_beverage_vendors', required: true, status: 'verified', uploadedAt: daysAgo(20), uploadedBy: USER_IDS.U_ORG_001, fileName: 'food-licences.pdf', fileSize: 900000, fileType: 'application/pdf', storagePath: docPath(EVENT_IDS.E001, 'v1', 'food-licences.pdf'), verifiedBy: USER_IDS.U_OFC_KKM_KL_01, verifiedAt: daysAgo(17) },
      // Additional: sale_of_alcohol (liquor licence)
      { documentType: 'liquor_licence' as never, isCore: false, requiredByTrigger: 'sale_of_alcohol', required: true, status: 'verified', uploadedAt: daysAgo(20), uploadedBy: USER_IDS.U_ORG_001, fileName: 'liquor-licence.pdf', fileSize: 500000, fileType: 'application/pdf', storagePath: docPath(EVENT_IDS.E001, 'v1', 'liquor-licence.pdf'), verifiedBy: USER_IDS.U_ADM_001, verifiedAt: daysAgo(17) },
      // Additional: ticketed_event
      { documentType: 'ticket_sample' as never, isCore: false, requiredByTrigger: 'ticketed_event', required: true, status: 'verified', uploadedAt: daysAgo(20), uploadedBy: USER_IDS.U_ORG_001, fileName: 'ticket-sample.pdf', fileSize: 400000, fileType: 'application/pdf', storagePath: docPath(EVENT_IDS.E001, 'v1', 'ticket-sample.pdf'), verifiedBy: USER_IDS.U_ADM_001, verifiedAt: daysAgo(17) },
      // Additional: high_risk_large_scale (insurance, medical agreement)
      { documentType: 'public_liability_insurance' as never, isCore: false, requiredByTrigger: 'high_risk_large_scale', required: true, status: 'verified', uploadedAt: daysAgo(20), uploadedBy: USER_IDS.U_ORG_001, fileName: 'public-liability-insurance.pdf', fileSize: 1100000, fileType: 'application/pdf', storagePath: docPath(EVENT_IDS.E001, 'v1', 'public-liability-insurance.pdf'), verifiedBy: USER_IDS.U_ADM_001, verifiedAt: daysAgo(17) },
      { documentType: 'medical_provider_agreement' as never, isCore: false, requiredByTrigger: 'high_risk_large_scale', required: true, status: 'verified', uploadedAt: daysAgo(20), uploadedBy: USER_IDS.U_ORG_001, fileName: 'medical-provider-agreement.pdf', fileSize: 950000, fileType: 'application/pdf', storagePath: docPath(EVENT_IDS.E001, 'v1', 'medical-provider-agreement.pdf'), verifiedBy: USER_IDS.U_OFC_KKM_KL_01, verifiedAt: daysAgo(17) },
    ],
  },

  // E002 - UnderReview, all docs uploaded but some not yet verified
  {
    eventId: EVENT_IDS.E002, versionId: 'v1',
    documents: [
      ...baseCoreDocs(EVENT_IDS.E002, 'v1', {
        organiser_identification:    'verified',
        organisation_registration:   'verified',
        venue_permission_letter:     'verified',
        site_layout_plan:            'verified',
        location_map_photos:         'verified',
        event_programme_schedule:     'verified',
        safety_operational_plan:     'uploaded',
        emergency_evacuation_plan:   'uploaded',
        supplier_contractor_list:     'uploaded',
      }, { uploadedBy: USER_IDS.U_ORG_002, verifiedBy: USER_IDS.U_ADM_001 }),
      // Additional: government_land_park
      { documentType: 'land_authority_permission' as never, isCore: false, requiredByTrigger: 'government_land_park', required: true, status: 'uploaded', uploadedAt: daysAgo(11), uploadedBy: USER_IDS.U_ORG_002, fileName: 'mbpj-permission.pdf', fileSize: 800000, fileType: 'application/pdf', storagePath: docPath(EVENT_IDS.E002, 'v1', 'mbpj-permission.pdf') },
      { documentType: 'vendor_list' as never, isCore: false, requiredByTrigger: 'food_beverage_vendors', required: true, status: 'uploaded', uploadedAt: daysAgo(11), uploadedBy: USER_IDS.U_ORG_002, fileName: 'vendor-list.pdf', fileSize: 600000, fileType: 'application/pdf', storagePath: docPath(EVENT_IDS.E002, 'v1', 'vendor-list.pdf') },
    ],
  },

  // E003 - Pending (M2 still processing) - all core docs uploaded, not yet verified
  {
    eventId: EVENT_IDS.E003, versionId: 'v1',
    documents: [
      ...baseCoreDocs(EVENT_IDS.E003, 'v1', {
        organiser_identification:    'uploaded',
        organisation_registration:   'uploaded',
        venue_permission_letter:     'uploaded',
        site_layout_plan:            'uploaded',
        location_map_photos:         'uploaded',
        event_programme_schedule:     'uploaded',
        safety_operational_plan:     'uploaded',
        emergency_evacuation_plan:   'uploaded',
        supplier_contractor_list:     'uploaded',
      }, { uploadedBy: USER_IDS.U_ORG_003 }),
      // Additional: large_indoor_high_crowd + outdoor_route_based
      { documentType: 'venue_capacity_document' as never, isCore: false, requiredByTrigger: 'large_indoor_high_crowd', required: true, status: 'uploaded', uploadedAt: hoursAgo(5), uploadedBy: USER_IDS.U_ORG_003, fileName: 'venue-capacity.pdf', fileSize: 850000, fileType: 'application/pdf', storagePath: docPath(EVENT_IDS.E003, 'v1', 'venue-capacity.pdf') },
      { documentType: 'route_plan' as never, isCore: false, requiredByTrigger: 'outdoor_route_based', required: true, status: 'uploaded', uploadedAt: hoursAgo(5), uploadedBy: USER_IDS.U_ORG_003, fileName: 'route-plan.pdf', fileSize: 700000, fileType: 'application/pdf', storagePath: docPath(EVENT_IDS.E003, 'v1', 'route-plan.pdf') },
    ],
  },

  // E004 - v1 AmendmentRequested, with one rejected doc (rejection on BOMBA feedback)
  {
    eventId: EVENT_IDS.E004, versionId: 'v1',
    documents: [
      ...baseCoreDocs(EVENT_IDS.E004, 'v1', {
        organiser_identification:    'verified',
        organisation_registration:   'verified',
        venue_permission_letter:     'verified',
        site_layout_plan:            'verified',
        location_map_photos:         'verified',
        event_programme_schedule:     'verified',
        safety_operational_plan:     'rejected',  // <-- this is what BOMBA/KKM rejected
        emergency_evacuation_plan:   'rejected',
        supplier_contractor_list:     'verified',
      }, { uploadedBy: USER_IDS.U_ORG_004, verifiedBy: USER_IDS.U_ADM_001 }),
      // Additional: outdoor_route_based, uses_public_road, ticketed, high_risk
      { documentType: 'route_plan' as never, isCore: false, requiredByTrigger: 'outdoor_route_based', required: true, status: 'verified', uploadedAt: daysAgo(17), uploadedBy: USER_IDS.U_ORG_004, fileName: 'route-plan.pdf', fileSize: 1200000, fileType: 'application/pdf', storagePath: docPath(EVENT_IDS.E004, 'v1', 'route-plan.pdf'), verifiedBy: USER_IDS.U_OFC_PDRM_KL_01, verifiedAt: daysAgo(15) },
      { documentType: 'traffic_management_plan' as never, isCore: false, requiredByTrigger: 'uses_public_road', required: true, status: 'verified', uploadedAt: daysAgo(17), uploadedBy: USER_IDS.U_ORG_004, fileName: 'traffic-management-plan.pdf', fileSize: 900000, fileType: 'application/pdf', storagePath: docPath(EVENT_IDS.E004, 'v1', 'traffic-management-plan.pdf'), verifiedBy: USER_IDS.U_OFC_PDRM_KL_01, verifiedAt: daysAgo(15) },
      { documentType: 'public_liability_insurance' as never, isCore: false, requiredByTrigger: 'high_risk_large_scale', required: true, status: 'verified', uploadedAt: daysAgo(17), uploadedBy: USER_IDS.U_ORG_004, fileName: 'public-liability-insurance.pdf', fileSize: 1100000, fileType: 'application/pdf', storagePath: docPath(EVENT_IDS.E004, 'v1', 'public-liability-insurance.pdf'), verifiedBy: USER_IDS.U_ADM_001, verifiedAt: daysAgo(15) },
      { documentType: 'medical_provider_agreement' as never, isCore: false, requiredByTrigger: 'high_risk_large_scale', required: true, status: 'verified', uploadedAt: daysAgo(17), uploadedBy: USER_IDS.U_ORG_004, fileName: 'medical-provider-agreement.pdf', fileSize: 950000, fileType: 'application/pdf', storagePath: docPath(EVENT_IDS.E004, 'v1', 'medical-provider-agreement.pdf'), verifiedBy: USER_IDS.U_OFC_KKM_KL_01, verifiedAt: daysAgo(15) },
    ],
  },

  // E005 - Rejected (BOMBA rejected venue_permission_letter)
  {
    eventId: EVENT_IDS.E005, versionId: 'v1',
    documents: [
      ...baseCoreDocs(EVENT_IDS.E005, 'v1', {
        organiser_identification:    'verified',
        organisation_registration:   'verified',
        venue_permission_letter:     'rejected',  // <-- fire cert issue
        site_layout_plan:            'verified',
        location_map_photos:         'verified',
        event_programme_schedule:     'verified',
        safety_operational_plan:     'verified',
        emergency_evacuation_plan:   'verified',
        supplier_contractor_list:     'verified',
      }, { uploadedBy: USER_IDS.U_ORG_005, verifiedBy: USER_IDS.U_ADM_001 }),
    ],
  },

  // E008 - Blocked compliance (fire cert rejected)
  {
    eventId: EVENT_IDS.E008, versionId: 'v1',
    documents: [
      ...baseCoreDocs(EVENT_IDS.E008, 'v1', {
        organiser_identification:    'verified',
        organisation_registration:   'verified',
        venue_permission_letter:     'rejected',  // <-- blocked compliance
        site_layout_plan:            'verified',
        location_map_photos:         'verified',
        event_programme_schedule:     'verified',
        safety_operational_plan:     'verified',
        emergency_evacuation_plan:   'verified',
        supplier_contractor_list:     'verified',
      }, { uploadedBy: USER_IDS.U_ORG_003, verifiedBy: USER_IDS.U_OFC_BOMBA_SL_01 }),
    ],
  },

  // E009 - Insufficient data (some docs not uploaded)
  {
    eventId: EVENT_IDS.E009, versionId: 'v1',
    documents: [
      ...baseCoreDocs(EVENT_IDS.E009, 'v1', {
        organiser_identification:    'uploaded',
        organisation_registration:   'uploaded',
        venue_permission_letter:     'not_uploaded',  // <-- missing
        site_layout_plan:            'uploaded',
        location_map_photos:         'uploaded',
        event_programme_schedule:     'not_uploaded',  // <-- missing
        safety_operational_plan:     'uploaded',
        emergency_evacuation_plan:   'not_uploaded',  // <-- missing
        supplier_contractor_list:     'uploaded',
      }, { uploadedBy: USER_IDS.U_ORG_004 }),
    ],
  },

  // E010 - v1 (rejected) and v2 (current) - v1 has full docs, v2 fresh upload
  {
    eventId: EVENT_IDS.E010, versionId: 'v1',
    documents: [
      ...baseCoreDocs(EVENT_IDS.E010, 'v1', {
        organiser_identification:    'verified',
        organisation_registration:   'verified',
        venue_permission_letter:     'verified',
        site_layout_plan:            'verified',
        location_map_photos:         'verified',
        event_programme_schedule:     'verified',
        safety_operational_plan:     'verified',
        emergency_evacuation_plan:   'verified',
        supplier_contractor_list:     'verified',
      }, { uploadedBy: USER_IDS.U_ORG_005, verifiedBy: USER_IDS.U_ADM_001 }),
    ],
  },
  {
    eventId: EVENT_IDS.E010, versionId: 'v2',
    documents: [
      ...baseCoreDocs(EVENT_IDS.E010, 'v2', {
        organiser_identification:    'uploaded',
        organisation_registration:   'uploaded',
        venue_permission_letter:     'uploaded',
        site_layout_plan:            'uploaded',
        location_map_photos:         'uploaded',
        event_programme_schedule:     'uploaded',
        safety_operational_plan:     'uploaded',
        emergency_evacuation_plan:   'uploaded',
        supplier_contractor_list:     'uploaded',
      }, { uploadedBy: USER_IDS.U_ORG_005 }),
    ],
  },

  // E011 - Approved with override - all docs verified
  {
    eventId: EVENT_IDS.E011, versionId: 'v1',
    documents: [
      ...baseCoreDocs(EVENT_IDS.E011, 'v1', {
        organiser_identification:    'verified',
        organisation_registration:   'verified',
        venue_permission_letter:     'verified',
        site_layout_plan:            'verified',
        location_map_photos:         'verified',
        event_programme_schedule:     'verified',
        safety_operational_plan:     'verified',
        emergency_evacuation_plan:   'verified',
        supplier_contractor_list:     'verified',
      }, { uploadedBy: USER_IDS.U_ORG_001, verifiedBy: USER_IDS.U_ADM_001 }),
    ],
  },

  // E012 - High risk - all docs uploaded/verified
  {
    eventId: EVENT_IDS.E012, versionId: 'v1',
    documents: [
      ...baseCoreDocs(EVENT_IDS.E012, 'v1', {
        organiser_identification:    'verified',
        organisation_registration:   'verified',
        venue_permission_letter:     'verified',
        site_layout_plan:            'verified',
        location_map_photos:         'verified',
        event_programme_schedule:     'verified',
        safety_operational_plan:     'verified',
        emergency_evacuation_plan:   'verified',
        supplier_contractor_list:     'verified',
      }, { uploadedBy: USER_IDS.U_ORG_002, verifiedBy: USER_IDS.U_ADM_001 }),
      // Additional: fireworks, alcohol, high risk, ticketed, large, tents
      { documentType: 'fireworks_operator_appointment' as never, isCore: false, requiredByTrigger: 'fireworks_pyrotechnics', required: true, status: 'verified', uploadedAt: daysAgo(11), uploadedBy: USER_IDS.U_ORG_002, fileName: 'fireworks-operator.pdf', fileSize: 700000, fileType: 'application/pdf', storagePath: docPath(EVENT_IDS.E012, 'v1', 'fireworks-operator.pdf'), verifiedBy: USER_IDS.U_OFC_BOMBA_FED_01, verifiedAt: daysAgo(9) },
      { documentType: 'pyrotechnic_safety_zone_plan' as never, isCore: false, requiredByTrigger: 'fireworks_pyrotechnics', required: true, status: 'verified', uploadedAt: daysAgo(11), uploadedBy: USER_IDS.U_ORG_002, fileName: 'pyro-safety-zone.pdf', fileSize: 1100000, fileType: 'application/pdf', storagePath: docPath(EVENT_IDS.E012, 'v1', 'pyro-safety-zone.pdf'), verifiedBy: USER_IDS.U_OFC_BOMBA_FED_01, verifiedAt: daysAgo(9) },
      { documentType: 'public_liability_insurance' as never, isCore: false, requiredByTrigger: 'high_risk_large_scale', required: true, status: 'verified', uploadedAt: daysAgo(11), uploadedBy: USER_IDS.U_ORG_002, fileName: 'public-liability-insurance.pdf', fileSize: 1100000, fileType: 'application/pdf', storagePath: docPath(EVENT_IDS.E012, 'v1', 'public-liability-insurance.pdf'), verifiedBy: USER_IDS.U_ADM_001, verifiedAt: daysAgo(9) },
    ],
  },

  // E014 - M4 confirmed true (Stage 2 control rejected)
  {
    eventId: EVENT_IDS.E014, versionId: 'v1',
    documents: [
      ...baseCoreDocs(EVENT_IDS.E014, 'v1', {
        organiser_identification:    'verified',
        organisation_registration:   'verified',
        venue_permission_letter:     'verified',
        site_layout_plan:            'verified',
        location_map_photos:         'verified',
        event_programme_schedule:     'verified',
        safety_operational_plan:     'verified',
        emergency_evacuation_plan:   'verified',
        supplier_contractor_list:     'verified',
      }, { uploadedBy: USER_IDS.U_ORG_004, verifiedBy: USER_IDS.U_ADM_001 }),
    ],
  },

  // E017 - Draft (only some docs uploaded)
  {
    eventId: EVENT_IDS.E017, versionId: 'v1',
    documents: [
      ...baseCoreDocs(EVENT_IDS.E017, 'v1', {
        organiser_identification:    'uploaded',
        organisation_registration:   'uploaded',
        venue_permission_letter:     'not_uploaded',
        site_layout_plan:            'not_uploaded',
        location_map_photos:         'uploaded',
        event_programme_schedule:     'not_uploaded',
        safety_operational_plan:     'not_uploaded',
        emergency_evacuation_plan:   'not_uploaded',
        supplier_contractor_list:     'not_uploaded',
      }, { uploadedBy: USER_IDS.U_ORG_002 }),
    ],
  },
];

// Note: the v1 shape for additional doc types uses `as never` because
// `EventDocument.documentType` is typed as `CoreDocumentType` above. We
// acknowledge this is a mock-only relaxation. When the real types are
// landed, this can be tightened by promoting the additional doc type
// string literal to a shared enum.

import { hoursAgo } from './ids';

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
export const findDocumentSet = (eventId: string, versionId: string = 'v1'): EventDocumentSet | undefined =>
  mockEventDocumentSets.find((s) => s.eventId === eventId && s.versionId === versionId);

export const documentStatusCounts = (eventId: string, versionId: string = 'v1'): Record<DocumentStatus, number> => {
  const set = findDocumentSet(eventId, versionId);
  if (!set) return { not_uploaded: 0, uploaded: 0, verified: 0, rejected: 0 };
  const counts: Record<DocumentStatus, number> = { not_uploaded: 0, uploaded: 0, verified: 0, rejected: 0 };
  set.documents.forEach((d) => { counts[d.status] += 1; });
  return counts;
};

export const missingRequiredDocs = (eventId: string, versionId: string = 'v1'): EventDocument[] => {
  const set = findDocumentSet(eventId, versionId);
  if (!set) return [];
  return set.documents.filter((d) => d.required && d.status === 'not_uploaded');
};

export const rejectedDocs = (eventId: string, versionId: string = 'v1'): EventDocument[] => {
  const set = findDocumentSet(eventId, versionId);
  if (!set) return [];
  return set.documents.filter((d) => d.status === 'rejected');
};
