import { Venue } from '@shared/types';
import { VENUE_IDS, daysAhead } from './ids';

/**
 * Venue fixtures. 10 Malaysian venues — 6 actively used by mock events,
 * 4 reserved for future expansion (Penang/Johor/Sabah).
 *
 * All fields match the shared/types.ts `Venue` contract. Synthetic data
 * marker is set on each so M5 analytics can exclude them by default.
 */

export const mockVenues: Venue[] = [
  // --------------------------------------------------------------------------
  // V001 - Dataran Merdeka (KL) - outdoor, used by E001/E010/E013
  // --------------------------------------------------------------------------
  {
    venueId: VENUE_IDS.V001,
    name: 'Dataran Merdeka',
    address: 'Jalan Raja, 50050 Kuala Lumpur, Wilayah Persekutuan',
    capacity: 50000,
    location: { lat: 3.1478, lng: 101.6932 },
    jurisdiction: 'DBKL - Wilayah Persekutuan',
    usableAreaM2: 18000,
    fixedSeats: 0,
    verifiedSafeCapacity: 45000,
    exitCount: 8,
    totalExitWidthMm: 12000,
    fireCertificateStatus: 'valid',
    fireCertificateExpiresAt: daysAhead(420),
    nearestHospitalTravelMinutes: 8,
    emergencyAccessVerified: true,
    synthetic: true,
    datasetVersion: '2026-07-24-malaysia-venues-v1',
    riskNotes: 'Open field; multiple ingress/egress points; large crowd pressure during national events.',
    incidentCount: 3,
  },

  // --------------------------------------------------------------------------
  // V002 - Bukit Jalil National Stadium (KL) - outdoor, used by E004/E011/E012/E015
  // --------------------------------------------------------------------------
  {
    venueId: VENUE_IDS.V002,
    name: 'Bukit Jalil National Stadium',
    address: 'Jalan Merah Cagar, Bukit Jalil, 57000 Kuala Lumpur',
    capacity: 87411,
    location: { lat: 3.0560, lng: 101.6923 },
    jurisdiction: 'DBKL - Wilayah Persekutuan',
    usableAreaM2: 32000,
    fixedSeats: 87411,
    verifiedSafeCapacity: 80000,
    exitCount: 24,
    totalExitWidthMm: 48000,
    fireCertificateStatus: 'valid',
    fireCertificateExpiresAt: daysAhead(180),
    nearestHospitalTravelMinutes: 12,
    emergencyAccessVerified: true,
    synthetic: true,
    datasetVersion: '2026-07-24-malaysia-venues-v1',
    riskNotes: 'Seated venue; high density during sports/concerts; tested evacuation plan.',
    incidentCount: 5,
  },

  // --------------------------------------------------------------------------
  // V003 - KLCC Convention Centre (KL) - indoor, used by E003/E006
  // --------------------------------------------------------------------------
  {
    venueId: VENUE_IDS.V003,
    name: 'KLCC Convention Centre',
    address: 'Kuala Lumpur City Centre, 50088 Kuala Lumpur',
    capacity: 20000,
    location: { lat: 3.1578, lng: 101.7117 },
    jurisdiction: 'DBKL - Wilayah Persekutuan',
    usableAreaM2: 12000,
    fixedSeats: 5000,
    verifiedSafeCapacity: 18000,
    exitCount: 12,
    totalExitWidthMm: 18000,
    fireCertificateStatus: 'valid',
    fireCertificateExpiresAt: daysAhead(300),
    nearestHospitalTravelMinutes: 6,
    emergencyAccessVerified: true,
    synthetic: true,
    datasetVersion: '2026-07-24-malaysia-venues-v1',
    riskNotes: 'Indoor; tiered seating; covered by hotel medical team within minutes.',
    incidentCount: 2,
  },

  // --------------------------------------------------------------------------
  // V004 - Axiata Arena (KL) - indoor, used by E007/E016
  // --------------------------------------------------------------------------
  {
    venueId: VENUE_IDS.V004,
    name: 'Axiata Arena',
    address: 'Stadium Bukit Jalil, Lingkaran Syed Putra, 57000 Kuala Lumpur',
    capacity: 16000,
    location: { lat: 3.0552, lng: 101.6938 },
    jurisdiction: 'DBKL - Wilayah Persekutuan',
    usableAreaM2: 9000,
    fixedSeats: 16000,
    verifiedSafeCapacity: 15000,
    exitCount: 16,
    totalExitWidthMm: 22000,
    fireCertificateStatus: 'valid',
    fireCertificateExpiresAt: daysAhead(540),
    nearestHospitalTravelMinutes: 10,
    emergencyAccessVerified: true,
    synthetic: true,
    datasetVersion: '2026-07-24-malaysia-venues-v1',
    riskNotes: 'Indoor arena; high vertical density; pyrotechnics typical for concerts.',
    incidentCount: 4,
  },

  // --------------------------------------------------------------------------
  // V005 - Shah Alam Stadium (Selangor) - outdoor, used by E005/E008/E014
  // --------------------------------------------------------------------------
  {
    venueId: VENUE_IDS.V005,
    name: 'Shah Alam Stadium',
    address: 'Persiaran Sukan, Seksyen 13, 40100 Shah Alam, Selangor',
    capacity: 80000,
    location: { lat: 3.0823, lng: 101.5461 },
    jurisdiction: 'MBSA - Selangor',
    usableAreaM2: 28000,
    fixedSeats: 80000,
    verifiedSafeCapacity: 75000,
    exitCount: 32,
    totalExitWidthMm: 64000,
    fireCertificateStatus: 'valid',
    fireCertificateExpiresAt: daysAhead(120),
    nearestHospitalTravelMinutes: 15,
    emergencyAccessVerified: true,
    synthetic: true,
    datasetVersion: '2026-07-24-malaysia-venues-v1',
    riskNotes: 'Seated stadium; known crowd surges on goal events; established crowd control SOPs.',
    incidentCount: 6,
  },

  // --------------------------------------------------------------------------
  // V006 - MBPJ Civic Centre (Selangor) - indoor, used by E002/E009/E017
  // --------------------------------------------------------------------------
  {
    venueId: VENUE_IDS.V006,
    name: 'MBPJ Civic Centre',
    address: 'Jalan Yong Shook Lin, 46675 Petaling Jaya, Selangor',
    capacity: 3000,
    location: { lat: 3.1050, lng: 101.6427 },
    jurisdiction: 'MBPJ - Selangor',
    usableAreaM2: 2400,
    fixedSeats: 1500,
    verifiedSafeCapacity: 2800,
    exitCount: 8,
    totalExitWidthMm: 9000,
    fireCertificateStatus: 'valid',
    fireCertificateExpiresAt: daysAhead(60),  // <-- tight: needs renewal check
    nearestHospitalTravelMinutes: 9,
    emergencyAccessVerified: true,
    synthetic: true,
    datasetVersion: '2026-07-24-malaysia-venues-v1',
    riskNotes: 'Mixed indoor/outdoor pavilion; community event space.',
    incidentCount: 1,
  },

  // --------------------------------------------------------------------------
  // V007 - Penang International Sports Arena (PISA) - indoor, reserved
  // --------------------------------------------------------------------------
  {
    venueId: VENUE_IDS.V007,
    name: 'Penang International Sports Arena (PISA)',
    address: 'Jalan Tun Dr Awang, 11900 Bayan Lepas, Penang',
    capacity: 12000,
    location: { lat: 5.3345, lng: 100.2906 },
    jurisdiction: 'MBPP - Penang',
    usableAreaM2: 8000,
    fixedSeats: 12000,
    verifiedSafeCapacity: 11000,
    exitCount: 14,
    totalExitWidthMm: 18000,
    fireCertificateStatus: 'valid',
    fireCertificateExpiresAt: daysAhead(365),
    nearestHospitalTravelMinutes: 18,
    emergencyAccessVerified: true,
    synthetic: true,
    datasetVersion: '2026-07-24-malaysia-venues-v1',
    riskNotes: 'Northern region flagship indoor arena; occasional pyrotechnics for concerts.',
    incidentCount: 2,
  },

  // --------------------------------------------------------------------------
  // V008 - Penang Esplanade - outdoor, reserved
  // --------------------------------------------------------------------------
  {
    venueId: VENUE_IDS.V008,
    name: 'Esplanade Penang',
    address: 'Jalan Tun Syed Sheh Barakbah, 10200 George Town, Penang',
    capacity: 15000,
    location: { lat: 5.4244, lng: 100.3456 },
    jurisdiction: 'MBPP - Penang',
    usableAreaM2: 6000,
    fixedSeats: 0,
    verifiedSafeCapacity: 12000,
    exitCount: 6,
    totalExitWidthMm: 9000,
    fireCertificateStatus: 'not_required',
    nearestHospitalTravelMinutes: 10,
    emergencyAccessVerified: true,
    synthetic: true,
    datasetVersion: '2026-07-24-malaysia-venues-v1',
    riskNotes: 'Open field; heritage event space; high humidity exposure.',
    incidentCount: 1,
  },

  // --------------------------------------------------------------------------
  // V009 - Anantara Desaru Coast (Johor) - private resort, reserved
  // --------------------------------------------------------------------------
  {
    venueId: VENUE_IDS.V009,
    name: 'Anantara Desaru Coast',
    address: 'Persiaran Pantai, Desaru Coast, 81930 Bandar Penawar, Johor',
    capacity: 5000,
    location: { lat: 1.5408, lng: 104.2626 },
    jurisdiction: 'MDL - Johor',
    usableAreaM2: 4000,
    fixedSeats: 800,
    verifiedSafeCapacity: 4500,
    exitCount: 6,
    totalExitWidthMm: 7500,
    fireCertificateStatus: 'valid',
    fireCertificateExpiresAt: daysAhead(250),
    nearestHospitalTravelMinutes: 35,  // <-- far from city hospital
    emergencyAccessVerified: false,     // <-- flagged: limited access
    synthetic: true,
    datasetVersion: '2026-07-24-malaysia-venues-v1',
    riskNotes: 'Private resort; mixed indoor/outdoor; remote from major medical facilities.',
    incidentCount: 0,
  },

  // --------------------------------------------------------------------------
  // V010 - Sutera Harbour Resort (Sabah) - private resort, reserved
  // --------------------------------------------------------------------------
  {
    venueId: VENUE_IDS.V010,
    name: 'Sutera Harbour Resort',
    address: '1 Sutera Harbour Boulevard, 88100 Kota Kinabalu, Sabah',
    capacity: 2500,
    location: { lat: 5.9581, lng: 116.0644 },
    jurisdiction: 'DBKK - Sabah',
    usableAreaM2: 3000,
    fixedSeats: 500,
    verifiedSafeCapacity: 2200,
    exitCount: 5,
    totalExitWidthMm: 6000,
    fireCertificateStatus: 'expired',  // <-- expired: would block compliance
    fireCertificateExpiresAt: daysAhead(-15),
    nearestHospitalTravelMinutes: 20,
    emergencyAccessVerified: true,
    synthetic: true,
    datasetVersion: '2026-07-24-malaysia-venues-v1',
    riskNotes: 'Tourism property; waterfront; fire cert expired, awaiting renewal.',
    incidentCount: 0,
  },
];

// ============================================================================
// Lookups
// ============================================================================
export const findVenueById = (venueId: string): Venue | undefined =>
  mockVenues.find((v) => v.venueId === venueId);

export const mockVenuesById: Record<string, Venue> = Object.fromEntries(
  mockVenues.map((v) => [v.venueId, v]),
);
