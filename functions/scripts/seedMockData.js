/**
 * STERAS — Mock Data Seeder
 * =====================================================================
 * Uploads the M3 mock dataset to Firestore so the admin dashboard can
 * be developed against real data instead of mock imports.
 *
 * Per project decision: images are stored as base64 strings inside
 * Firestore documents (not in Firebase Storage), so they travel with
 * the control record and can be re-rendered as data URLs.
 *
 * Run from: steras/functions/
 *   node scripts/seedMockData.js
 *
 * Idempotent: re-running will overwrite existing documents in the same
 * path. The seeder also wipes sub-collections it owns before re-seeding.
 * =====================================================================
 */

const path = require('node:path');
const fs = require('node:fs');
const admin = require('firebase-admin');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SERVICE_ACCOUNT_PATH = path.join(
  PROJECT_ROOT,
  'linkos-496505-firebase-adminsdk-fbsvc-a951ea775c.json',
);
const PROJECT_ID = 'linkos-496505';
const MOCK_DATA_IMAGES = path.join(
  PROJECT_ROOT,
  'frontend',
  'src',
  'mock_data',
  'images',
);

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function loadImageBase64(filename, maxBytes = 900_000) {
  const filePath = path.join(MOCK_DATA_IMAGES, filename);
  const buf = fs.readFileSync(filePath);
  if (buf.length > maxBytes) {
    console.warn(
      `  ⚠ ${filename} is ${(buf.length / 1024).toFixed(0)}KB, ` +
      `exceeds ${(maxBytes / 1024).toFixed(0)}KB. Storing a scaled-down JPEG ` +
      `by re-encoding through sharp if available; otherwise skipping.`,
    );
    // Try to use sharp if available
    try {
      // Lazy require to avoid hard dep
      // eslint-disable-next-line global-require, import/no-unresolved
      const sharp = require('sharp');
      return sharp(buf)
        .resize({ width: 1200, withoutEnlargement: true })
        .jpeg({ quality: 78, progressive: true })
        .toBuffer()
        .then((out) => `data:image/jpeg;base64,${out.toString('base64')}`)
        .catch(() => null);
    } catch {
      return null;
    }
  }
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

async function loadAllImages() {
  const files = ['police-presence.jpg', 'fire-marshal.jpg', 'medical-station.jpg', 'crowd-control.jpg', 'waste-mgmt.jpg'];
  const out = {};
  for (const f of files) {
    const result = loadImageBase64(f);
    out[f.replace('.jpg', '')] = result instanceof Promise ? await result : result;
    console.log(`  • ${f}: ${out[f.replace('.jpg', '')] ? 'loaded' : 'SKIPPED'}`);
  }
  return out;
}

function daysAgo(d) {
  return Date.now() - d * 24 * 60 * 60 * 1000;
}
function daysAhead(d) {
  return Date.now() + d * 24 * 60 * 60 * 1000;
}
function hoursAgo(h) {
  return Date.now() - h * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------
const VENUES = [
  { venueId: 'ven-001-dataran-merdeka', name: 'Dataran Merdeka', address: 'Jalan Raja, 50050 Kuala Lumpur', capacity: 30000, jurisdiction: 'DBKL', location: { lat: 3.1478, lng: 101.6953 }, verifiedSafeCapacity: 25000, exitCount: 8, totalExitWidthMm: 9600, fireCertificateStatus: 'valid', emergencyAccessVerified: true, nearestHospitalTravelMinutes: 8 },
  { venueId: 'ven-002-bukit-jalil-stadium', name: 'Bukit Jalil National Stadium', address: 'Jalan Barat, Bukit Jalil, 57000 KL', capacity: 87411, jurisdiction: 'DBKL', location: { lat: 3.0560, lng: 101.6921 }, verifiedSafeCapacity: 80000, exitCount: 24, totalExitWidthMm: 28800, fireCertificateStatus: 'valid', emergencyAccessVerified: true, nearestHospitalTravelMinutes: 12 },
  { venueId: 'ven-003-klcc-convention', name: 'KLCC Convention Centre', address: 'Kuala Lumpur City Centre, 50088 KL', capacity: 15000, jurisdiction: 'DBKL', location: { lat: 3.1578, lng: 101.7117 }, verifiedSafeCapacity: 14000, exitCount: 12, totalExitWidthMm: 14400, fireCertificateStatus: 'valid', emergencyAccessVerified: true, nearestHospitalTravelMinutes: 5 },
  { venueId: 'ven-004-axiata-arena', name: 'Axiata Arena', address: 'Bukit Jalil, 57000 KL', capacity: 16000, jurisdiction: 'DBKL', location: { lat: 3.0576, lng: 101.6936 }, verifiedSafeCapacity: 15000, exitCount: 14, totalExitWidthMm: 16800, fireCertificateStatus: 'valid', emergencyAccessVerified: true, nearestHospitalTravelMinutes: 10 },
  { venueId: 'ven-005-shah-alam-stadium', name: 'Shah Alam Stadium', address: 'Shah Alam, Selangor', capacity: 80000, jurisdiction: 'MBSA', location: { lat: 3.0851, lng: 101.5386 }, verifiedSafeCapacity: 70000, exitCount: 20, totalExitWidthMm: 24000, fireCertificateStatus: 'valid', emergencyAccessVerified: true, nearestHospitalTravelMinutes: 15 },
  { venueId: 'ven-006-mbpj-civic-centre', name: 'MBPJ Civic Centre', address: 'Jalan Yong Shook Lin, 46050 PJ', capacity: 5000, jurisdiction: 'MBPJ', location: { lat: 3.1073, lng: 101.6230 }, verifiedSafeCapacity: 4500, exitCount: 8, totalExitWidthMm: 9600, fireCertificateStatus: 'valid', emergencyAccessVerified: true, nearestHospitalTravelMinutes: 7 },
  { venueId: 'ven-007-pisa-penang', name: 'PISA Penang', address: 'Jalan Tun Dr Awang, 11900 Bayan Lepas', capacity: 6500, jurisdiction: 'MPPP', location: { lat: 5.3360, lng: 100.3060 }, verifiedSafeCapacity: 6000, exitCount: 8, totalExitWidthMm: 9600, fireCertificateStatus: 'valid', emergencyAccessVerified: true, nearestHospitalTravelMinutes: 14 },
  { venueId: 'ven-008-esplanade-penang', name: 'Penang Esplanade', address: 'Jalan Tun Syed Sheh Barakbah, 10200 Penang', capacity: 10000, jurisdiction: 'MBPP', location: { lat: 5.4244, lng: 100.3270 }, verifiedSafeCapacity: 9000, exitCount: 6, totalExitWidthMm: 7200, fireCertificateStatus: 'valid', emergencyAccessVerified: true, nearestHospitalTravelMinutes: 6 },
  { venueId: 'ven-009-anantara-desaru', name: 'Anantara Desaru Coast Resort', address: 'Desaru Coast, 81930 Bandar Penawar, Johor', capacity: 4000, jurisdiction: 'MDL', location: { lat: 1.5576, lng: 104.2670 }, verifiedSafeCapacity: 3800, exitCount: 6, totalExitWidthMm: 7200, fireCertificateStatus: 'valid', emergencyAccessVerified: true, nearestHospitalTravelMinutes: 20 },
  { venueId: 'ven-010-sutera-harbour', name: 'Sutera Harbour Resort', address: '1 Sutera Harbour Boulevard, 88100 Kota Kinabalu', capacity: 5500, jurisdiction: 'DBKK', location: { lat: 5.9780, lng: 116.0710 }, verifiedSafeCapacity: 5000, exitCount: 8, totalExitWidthMm: 9600, fireCertificateStatus: 'valid', emergencyAccessVerified: true, nearestHospitalTravelMinutes: 12 },
];

// USERS is intentionally NOT hard-coded here. Per project decision, the
// `users` collection must mirror the Firebase Auth accounts exactly —
// no fake profiles. Use `scripts/syncUserProfiles.js` to (re)build it.
//
// (This block is kept for reference only and is no longer executed.)

const USERS = [
  // Organisers
  { uid: 'usr-org-001', name: 'Chia Yu Xin', email: 'chia.yuxin@steras.test', role: 'organizer', authorityType: null, phone: '+60 12-101 0001' },
  { uid: 'usr-org-002', name: 'Anny Wong', email: 'anny.wong@steras.test', role: 'organizer', authorityType: null, phone: '+60 12-101 0002' },
  { uid: 'usr-org-003', name: 'Yap Ern Tong', email: 'yap.erntong@steras.test', role: 'organizer', authorityType: null, phone: '+60 12-101 0003' },
  { uid: 'usr-org-004', name: 'Oh Wan Ting', email: 'oh.wanting@steras.test', role: 'organizer', authorityType: null, phone: '+60 12-101 0004' },
  { uid: 'usr-org-005', name: 'Kong Ji Yu', email: 'kong.jiyu@steras.test', role: 'organizer', authorityType: null, phone: '+60 12-101 0005' },
  // Admin
  { uid: 'usr-adm-001', name: 'Ahmad Razak', email: 'ahmad.razak@steras.test', role: 'admin', authorityType: null, phone: '+60 12-900 0001' },
  // Authority officers - federal
  { uid: 'usr-ofc-pdrm-fed-01', name: 'Inspector Tan Wei Ming', email: 'tan.weiming@steras.test', role: 'authority', authorityType: 'PDRM', phone: '+60 12-201 0001' },
  { uid: 'usr-ofc-bomba-fed-01', name: 'Haji Sulaiman Bin Ahmad', email: 'sulaiman@steras.test', role: 'authority', authorityType: 'BOMBA', phone: '+60 12-201 0002' },
  { uid: 'usr-ofc-kkm-fed-01', name: 'Dr. Lim Mei Yee', email: 'lim.meiyee@steras.test', role: 'authority', authorityType: 'KKM', phone: '+60 12-201 0003' },
  { uid: 'usr-ofc-dbkl-fed-01', name: 'Encik Razali Bin Osman', email: 'razali.osman@steras.test', role: 'authority', authorityType: 'DBKL', phone: '+60 12-201 0004' },
  { uid: 'usr-ofc-motac-fed-01', name: 'Puan Fatimah Az-Zahra', email: 'fatimah@steras.test', role: 'authority', authorityType: 'MOTAC', phone: '+60 12-201 0005' },
  // KL state officers (2 per type)
  ...['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'].flatMap((auth, typeIdx) => {
    const names = [
      ['Sergeant Wong Jia Hao', 'Corporal Lim Kah Seng'],
      ['Fire Officer Goh Boon Kiat', 'Fire Officer Tan Chee Hong'],
      ['Dr. Chong Mei Lin', 'Dr. Yap Sook Yan'],
      ['Tuan Haji Ismail Bin Ali', 'Tuan Ng Chong Wei'],
      ['Puan Aishah Bt Mohd Noor', 'Puan Theresa Fernandez'],
    ];
    return names[typeIdx].map((name, i) => ({
      uid: `usr-ofc-${auth.toLowerCase()}-kl-0${i + 1}`,
      name,
      email: `${name.toLowerCase().replace(/[^a-z]/g, '.')}@steras.test`,
      role: 'authority',
      authorityType: auth,
      phone: `+60 12-30${typeIdx + 1} 000${i + 1}`,
    }));
  }),
  // Public viewers
  { uid: 'usr-pub-001', name: 'Lim Wei Jian', email: 'lim.weijian@steras.test', role: 'public', authorityType: null, phone: '+60 12-501 0001' },
  { uid: 'usr-pub-002', name: 'Tan Mei Ling', email: 'tan.meiling@steras.test', role: 'public', authorityType: null, phone: '+60 12-501 0002' },
  { uid: 'usr-pub-003', name: 'Goh Kar Ying', email: 'goh.karying@steras.test', role: 'public', authorityType: null, phone: '+60 12-501 0003' },
];

// ---------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------
const NOW = Date.now();

function buildEventDetails(name, type, venueId, organiserUid, startDatetime, endDatetime, expectedAttendance) {
  const venue = VENUES.find((v) => v.venueId === venueId);
  // organiser details are denormalised into the event doc (organizerName/Email/Phone).
  // We do NOT require the organiser to exist in the `users` collection — the seed
  // data references mock organisers by uid; admin pages read the denormalised fields.
  const org = { name: 'STERAS Organiser', email: `${organiserUid}@steras.test`, phone: '+60 12-000 0000' };
  return {
    name, type,
    venueId,
    venueName: venue.name,
    venueAddress: venue.address,
    venueLocation: venue.location,
    venueCapacity: venue.verifiedSafeCapacity ?? venue.capacity,
    expectedAttendance,
    environment: 'outdoor',
    coverage: 'uncovered',
    seating: 'mixed',
    startDatetime, endDatetime,
    emergencyPlanSummary: 'Standard event emergency response plan including crowd control, medical standby, evacuation routes and coordination with on-site authorities.',
    organizerName: org.name,
    organizerEmail: org.email,
    organizerPhone: org.phone,
  };
}

const EVENTS = [
  {
    eventId: 'evt-001-kl-music-festival',
    organiserUid: 'usr-org-001',
    status: 'Approved',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'],
    name: 'Dataran Merdeka Music Festival 2026',
    type: 'festival',
    venueId: 'ven-001-dataran-merdeka',
    start: daysAhead(75), end: daysAhead(75) + 8 * 3600_000,
    expectedAttendance: 15000,
    currentVersionId: 'v1',
    currentAssessmentId: 'v1',
    currentResourceId: 'v1',
    daysAgoCreated: 28,
    daysAgoSubmitted: 25,
  },
  {
    eventId: 'evt-002-pj-food-fair',
    organiserUid: 'usr-org-002',
    status: 'UnderReview',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM', 'DBKL'],
    name: 'PJ Food & Culture Fair 2026',
    type: 'fair',
    venueId: 'ven-006-mbpj-civic-centre',
    start: daysAhead(30), end: daysAhead(30) + 6 * 3600_000,
    expectedAttendance: 3500,
    currentVersionId: 'v1',
    currentAssessmentId: 'v1',
    currentResourceId: 'v1',
    daysAgoCreated: 12,
    daysAgoSubmitted: 9,
  },
  {
    eventId: 'evt-003-kl-mountain-run',
    organiserUid: 'usr-org-003',
    status: 'Pending',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM'],
    name: 'KL Mountain Trail Run 2026',
    type: 'sports',
    venueId: 'ven-001-dataran-merdeka',
    start: daysAhead(50), end: daysAhead(50) + 6 * 3600_000,
    expectedAttendance: 1200,
    currentVersionId: 'v1',
    currentAssessmentId: 'v1',
    currentResourceId: 'v1',
    daysAgoCreated: 5,
    daysAgoSubmitted: 1,
  },
  {
    eventId: 'evt-004-kl-marathon',
    organiserUid: 'usr-org-004',
    status: 'AmendmentRequested',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM', 'DBKL'],
    name: 'KL International Marathon 2026',
    type: 'sports',
    venueId: 'ven-001-dataran-merdeka',
    start: daysAhead(60), end: daysAhead(60) + 8 * 3600_000,
    expectedAttendance: 25000,
    currentVersionId: 'v2',
    currentAssessmentId: 'v2',
    currentResourceId: 'v2',
    daysAgoCreated: 40,
    daysAgoSubmitted: 35,
  },
  {
    eventId: 'evt-005-shah-alam-beach-carnival',
    organiserUid: 'usr-org-005',
    status: 'Rejected',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM', 'MOTAC'],
    name: 'Shah Alam Beach Carnival 2026',
    type: 'festival',
    venueId: 'ven-005-shah-alam-stadium',
    start: daysAhead(40), end: daysAhead(40) + 6 * 3600_000,
    expectedAttendance: 8000,
    currentVersionId: 'v1',
    currentAssessmentId: 'v1',
    currentResourceId: 'v1',
    daysAgoCreated: 30,
    daysAgoSubmitted: 25,
  },
  {
    eventId: 'evt-006-kl-tech-conference',
    organiserUid: 'usr-org-001',
    status: 'Withdrawn',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM'],
    name: 'KL Tech Conference 2026',
    type: 'conference',
    venueId: 'ven-003-klcc-convention',
    start: daysAhead(20), end: daysAhead(20) + 6 * 3600_000,
    expectedAttendance: 4000,
    currentVersionId: 'v1',
    currentAssessmentId: 'v1',
    currentResourceId: 'v1',
    daysAgoCreated: 18,
    daysAgoSubmitted: 15,
  },
  {
    eventId: 'evt-011-kl-corporate-run',
    organiserUid: 'usr-org-002',
    status: 'Approved',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM'],
    name: 'Bukit Jalil Corporate Charity Run 2026',
    type: 'sports',
    venueId: 'ven-002-bukit-jalil-stadium',
    start: daysAhead(35), end: daysAhead(35) + 4 * 3600_000,
    expectedAttendance: 5000,
    currentVersionId: 'v1',
    currentAssessmentId: 'v1',
    currentResourceId: 'v1',
    daysAgoCreated: 50,
    daysAgoSubmitted: 45,
  },
  {
    eventId: 'evt-017-pj-wedding-expo',
    organiserUid: 'usr-org-003',
    status: 'Draft',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM'],
    name: 'PJ Wedding Expo 2026',
    type: 'exhibition',
    venueId: 'ven-006-mbpj-civic-centre',
    start: daysAhead(60), end: daysAhead(60) + 6 * 3600_000,
    expectedAttendance: 2500,
    currentVersionId: null,
    currentAssessmentId: null,
    currentResourceId: null,
    daysAgoCreated: 2,
    daysAgoSubmitted: null,
  },
];

const OFFICIAL_ASSESSMENT = {
  status: 'ready',
  categorySchemaVersion: '2026-07-24-all-hazards-v2',
  scoringLogicVersion: '2026-07-24-hirarc-residual-v2',
  categorySchemaStatus: 'prototype',
  readiness: 'complete',
  complianceStatus: 'pass',
  dataConfidenceScore: 0.82,
  dataConfidenceLevel: 'medium',
  officialMatrixScore: 16,
  officialScore: 62,
  officialRiskLevel: 'Medium',
  manualReviewRequired: false,
  computedAt: NOW,
  hazards: [],
  domainSummaries: [],
  complianceChecks: [],
  categoryAssignments: [
    { categoryId: 'crowd', categoryName: 'Crowd management', score: 18, riskLevel: 'Medium', weight: 0.25, weightedContribution: 4.5, rationale: 'Expected attendance 15k. Outdoor with no fixed seating requires active crowd flow management.', evidenceKeys: ['weather', 'history'], guidelineChecks: ['mass-gathering-2024'] },
    { categoryId: 'medical', categoryName: 'Medical capacity', score: 14, riskLevel: 'Medium', weight: 0.20, weightedContribution: 2.8, rationale: 'Within KKM mass-gathering guideline for 15k. Hospital transfer within 8 minutes.', evidenceKeys: ['history', 'public_health'], guidelineChecks: ['kkm-mg-2023'] },
    { categoryId: 'fire', categoryName: 'Fire & venue safety', score: 10, riskLevel: 'Low', weight: 0.20, weightedContribution: 2.0, rationale: 'Fire cert valid, exit count sufficient. No temporary high-risk structures.', evidenceKeys: ['venue'], guidelineChecks: ['bomba-2024'] },
    { categoryId: 'security', categoryName: 'Security & access', score: 12, riskLevel: 'Medium', weight: 0.15, weightedContribution: 1.8, rationale: 'Outdoor public gathering. Multiple access points require coordinated PDRM presence.', evidenceKeys: ['history'], guidelineChecks: ['pdrm-mg-2023'] },
    { categoryId: 'transport', categoryName: 'Transport & traffic', score: 8, riskLevel: 'Low', weight: 0.10, weightedContribution: 0.8, rationale: 'TMP required given central KL location. Public transport available.', evidenceKeys: ['weather', 'history'], guidelineChecks: ['jpj-2024'] },
    { categoryId: 'sanitation', categoryName: 'Sanitation & waste', score: 6, riskLevel: 'Low', weight: 0.10, weightedContribution: 0.6, rationale: 'Adequate bin allocation. Toilet-to-attendee ratio within guideline.', evidenceKeys: ['history'], guidelineChecks: ['kkm-mg-2023'] },
  ],
  evidence: [
    { key: 'weather', description: 'OpenWeather 5-day forecast snapshot.', sourceTimestamp: hoursAgo(2), source: 'openweather', status: 'matched', quality: 'official', confidenceScore: 0.85 },
    { key: 'holiday', description: 'Malaysian public holiday dataset v2026.07.24.', sourceTimestamp: daysAgo(7), source: 'malaysia-holidays-dataset', status: 'matched', quality: 'official' },
    { key: 'venue', description: 'Dataran Merdeka registry record.', sourceTimestamp: daysAgo(30), source: 'venue-database', status: 'matched', quality: 'official' },
    { key: 'history', description: 'Comparable Dataran Merdeka events 2024-2025.', sourceTimestamp: daysAgo(7), source: 'steras-history', status: 'matched', quality: 'verified' },
    { key: 'incidents', description: '50 historical incidents matched.', sourceTimestamp: daysAgo(1), source: 'steras-incidents', status: 'matched', quality: 'verified' },
  ],
};

const OFFICIAL_RESOURCE = {
  resourceId: 'v1',
  eventId: 'evt-001-kl-music-festival',
  versionId: 'v1',
  assessmentId: 'v1',
  police: 60, security: 90, medicalTeams: 12, ambulances: 6, toilets: 120, wasteBins: 200, fireOfficers: 12,
  formulaVersion: '2026-07-24-prototype-range-v3',
  guidelineVersion: '2026-07-24-malaysia-research-v2',
  guidelineStatus: 'prototype',
  confidenceLevel: 'prototype',
  notes: 'Prototype planning ranges, not statutory minimums. PDRM, BOMBA, and KKM reviewers must validate in their remit.',
  computedAt: NOW,
  rationales: {
    police: { resource: 'police', baselineQuantity: 60, factors: ['15k attendance', 'outdoor', 'KL central'], guidelineReferences: ['pdrm-mg-2023'] },
    medicalTeams: { resource: 'medicalTeams', baselineQuantity: 12, factors: ['mass-gathering threshold'], guidelineReferences: ['kkm-mg-2023'] },
    ambulances: { resource: 'ambulances', baselineQuantity: 6, factors: ['hospital within 8min'], guidelineReferences: ['kkm-mg-2023'] },
    security: { resource: 'security', baselineQuantity: 90, factors: ['access points 4', 'VIP zone'], guidelineReferences: ['kpdnhep-2023'] },
    toilets: { resource: 'toilets', baselineQuantity: 120, factors: ['1:125 ratio'], guidelineReferences: ['kkm-mg-2023'] },
    wasteBins: { resource: 'wasteBins', baselineQuantity: 200, factors: ['1:75 ratio'], guidelineReferences: ['kkm-mg-2023'] },
    fireOfficers: { resource: 'fireOfficers', baselineQuantity: 12, factors: ['BOMBA standing ratio'], guidelineReferences: ['bomba-2024'] },
  },
  items: [
    { resource: 'police', baseline: 60, planningRange: { min: 50, max: 80 }, assumptions: ['PDRM baseline'], riskModifiers: ['high profile'], confidence: 'prototype', guidelineReferences: ['pdrm-mg-2023'], reviewingAuthority: 'PDRM', authorityReviewRequired: true },
    { resource: 'medicalTeams', baseline: 12, planningRange: { min: 10, max: 15 }, assumptions: ['mass-gathering'], riskModifiers: ['outdoor heat'], confidence: 'prototype', guidelineReferences: ['kkm-mg-2023'], reviewingAuthority: 'KKM', authorityReviewRequired: true },
    { resource: 'fireOfficers', baseline: 12, planningRange: { min: 10, max: 16 }, assumptions: ['outdoor stage'], riskModifiers: ['pyrotechnics none'], confidence: 'prototype', guidelineReferences: ['bomba-2024'], reviewingAuthority: 'BOMBA', authorityReviewRequired: true },
  ],
  aiConsiderations: [],
};

// ---------------------------------------------------------------------
// Firestore writes
// ---------------------------------------------------------------------
async function clearCollection(db, collectionPath) {
  const snap = await db.collection(collectionPath).get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

async function clearSubcollections(db, parentCollection, subcollection) {
  const parents = await db.collection(parentCollection).get();
  let count = 0;
  for (const parent of parents.docs) {
    const subs = await parent.ref.collection(subcollection).get();
    if (!subs.empty) {
      const batch = db.batch();
      subs.docs.forEach((s) => batch.delete(s.ref));
      await batch.commit();
      count += subs.size;
    }
  }
  return count;
}

async function main() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    throw new Error(`Service account key not found: ${SERVICE_ACCOUNT_PATH}`);
  }
  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  const app = admin.initializeApp(
    { credential: admin.credential.cert(serviceAccount), projectId: PROJECT_ID },
    'seed-mock-data',
  );
  const db = app.firestore();

  console.log('--- Loading images (base64) ---');
  const images = await loadAllImages();

  console.log('\n--- Clearing existing data (users collection is left to syncUserProfiles) ---');
  // Note: we deliberately do NOT clear `users` here — that collection is
  // managed by scripts/syncUserProfiles.js to keep it in lock-step with
  // Firebase Auth.
  console.log('  users: (skipped — handled by syncUserProfiles.js)');
  console.log(`  venues: ${await clearCollection(db, 'venues')} cleared`);
  console.log(`  events: ${await clearCollection(db, 'events')} cleared`);
  console.log(`  public_events: ${await clearCollection(db, 'public_events')} cleared`);
  console.log(`  events/*/versions: ${await clearSubcollections(db, 'events', 'versions')} cleared`);
  console.log(`  events/*/assessments: ${await clearSubcollections(db, 'events', 'assessments')} cleared`);
  console.log(`  events/*/resources: ${await clearSubcollections(db, 'events', 'resources')} cleared`);
  console.log(`  events/*/decisions: ${await clearSubcollections(db, 'events', 'decisions')} cleared`);
  console.log(`  events/*/decision_history: ${await clearSubcollections(db, 'events', 'decision_history')} cleared`);
  console.log(`  events/*/resource_overrides: ${await clearSubcollections(db, 'events', 'resource_overrides')} cleared`);
  console.log(`  events/*/audit_logs: ${await clearSubcollections(db, 'events', 'audit_logs')} cleared`);

  console.log('\n--- Skipping users write — run scripts/syncUserProfiles.js to populate from Auth ---');

  console.log('\n--- Writing venues ---');
  let batch = db.batch();
  let count = 0;
  for (const v of VENUES) {
    batch.set(db.collection('venues').doc(v.venueId), v);
    count += 1;
    if (count % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();
  console.log(`  ${count} venues written`);

  console.log('\n--- Writing events + sub-collections ---');
  for (const e of EVENTS) {
    const details = buildEventDetails(e.name, e.type, e.venueId, e.organiserUid, e.start, e.end, e.expectedAttendance);
    const eventDoc = {
      eventId: e.eventId,
      organizerId: e.organiserUid,
      eventDetails: details,
      status: e.status,
      currentVersionId: e.currentVersionId,
      currentVersionNumber: 1,
      currentAssessmentId: e.currentAssessmentId,
      currentResourceId: e.currentResourceId,
      editableVersionId: e.status === 'Draft' ? 'v1' : null,
      draftDocumentPaths: [],
      requiredAuthorities: e.requiredAuthorities,
      createdAt: daysAgo(e.daysAgoCreated),
      updatedAt: e.daysAgoSubmitted !== null ? daysAgo(e.daysAgoSubmitted - 1) : daysAgo(e.daysAgoCreated - 1),
      submittedAt: e.daysAgoSubmitted !== null ? daysAgo(e.daysAgoSubmitted) : null,
    };
    // Filter out null/undefined so set() works without FieldValue.delete()
    for (const key of Object.keys(eventDoc)) {
      if (eventDoc[key] === null || eventDoc[key] === undefined) delete eventDoc[key];
    }
    await db.collection('events').doc(e.eventId).set(eventDoc);

    // Version
    if (e.currentVersionId) {
      await db.collection('events').doc(e.eventId).collection('versions').doc(e.currentVersionId).set({
        versionId: e.currentVersionId,
        eventId: e.eventId,
        versionNumber: 1,
        eventDetails: details,
        documentPaths: [],
        submittedBy: e.organiserUid,
        submittedAt: daysAgo(e.daysAgoSubmitted ?? e.daysAgoCreated),
        inputHash: 'mock-hash-' + e.eventId,
      });
    }

    // Assessment (only for events that have one)
    if (e.currentAssessmentId && e.status !== 'Draft') {
      const riskLevel = e.status === 'Rejected' ? 'High' : e.status === 'Approved' ? 'Medium' : 'Medium';
      await db.collection('events').doc(e.eventId).collection('assessments').doc(e.currentAssessmentId).set({
        assessmentId: e.currentAssessmentId,
        eventId: e.eventId,
        versionId: e.currentVersionId,
        status: 'ready',
        ...OFFICIAL_ASSESSMENT,
        officialRiskLevel: riskLevel,
        aiAdvisory: {
          model: 'minimax-m3',
          promptVersion: 'v1',
          responseSchemaVersion: 'v1',
          status: 'success',
          label: 'advisory',
          overallBand: riskLevel,
          overallExplanation: 'Advisory assessment based on MiniMax M3 hazard proposals and validated contextual evidence. See official category assessment for deterministic result.',
          categories: [],
          keyConcerns: ['High attendance density', 'Outdoor venue weather exposure'],
          resourceConsiderations: ['Review baseline for outdoor exposure'],
          citedEvidenceKeys: ['weather', 'history', 'venue'],
          cacheStatus: 'miss',
          generatedAt: NOW,
        },
        contextSnapshot: {
          weather: { data: { forecast: 'Partly cloudy', temperature: 31, humidity: 75, windSpeed: 12, precipitationProbability: 30, severeAlert: false }, source: 'openweather', freshness: 'fresh', fetchedAt: hoursAgo(2), expiresAt: hoursAgo(-22), forecastFor: e.start },
          calendar: { localDate: new Date(e.start).toISOString().slice(0, 10), dayOfWeek: 'Saturday', isWeekend: true, isHolidayOrAdjacent: false, sourceVersion: 'demo-calendar-v1', sourceTimestamp: daysAgo(7) },
          venue: { matched: true, venueId: e.venueId, submittedCapacity: e.expectedAttendance, registeredCapacity: VENUES.find((v) => v.venueId === e.venueId).capacity, capacityDifference: 0, jurisdiction: VENUES.find((v) => v.venueId === e.venueId).jurisdiction, fireCertificateStatus: VENUES.find((v) => v.venueId === e.venueId).fireCertificateStatus, fireCertificateExpiresAt: NOW + 200 * 24 * 3600_000, emergencyAccessVerified: VENUES.find((v) => v.venueId === e.venueId).emergencyAccessVerified, nearestHospitalTravelMinutes: VENUES.find((v) => v.venueId === e.venueId).nearestHospitalTravelMinutes, fetchedAt: hoursAgo(2) },
          incidentHistory: { matched: true, venueId: e.venueId, incidentIds: [], total: 2, bySeverity: { low: 2, medium: 0, high: 0 }, historicalEventCount: 8, totalAttendance: 80000, totalAttendeeHours: 400000, patientPresentationRatePerThousand: 1.8, hospitalTransferRatePerThousand: 0.2, incidentRatePerThousandAttendeeHours: 0.08, comparableEvents: [], lookbackStart: NOW - 3 * 365 * 24 * 3600_000, syntheticEvidence: false, fetchedAt: hoursAgo(2) },
        },
        sourceTimestamps: { weather: hoursAgo(2), holiday: daysAgo(7), venue: daysAgo(30), incidents: hoursAgo(2) },
        contextStatuses: { weather: 'matched', venue: 'matched', incidents: 'matched', ai: 'success' },
        inputHash: 'mock-hash-' + e.eventId,
        createdAt: daysAgo(e.daysAgoSubmitted ?? e.daysAgoCreated),
      });
    }

    // Resource recommendation
    // M3 reviewers need a resource plan visible even when an event is not yet
    // Approved (reviewers see "Wait for assessment and resources" otherwise).
    // Write a mock resource doc for EVERY event that has a currentResourceId.
    if (e.currentResourceId) {
      await db.collection('events').doc(e.eventId).collection('resources').doc(e.currentResourceId).set({
        ...OFFICIAL_RESOURCE,
        resourceId: e.currentResourceId,
        eventId: e.eventId,
        versionId: e.currentVersionId,
        assessmentId: e.currentAssessmentId,
      });
    }

    // Decisions (only for approved events)
    if (e.status === 'Approved') {
      for (const auth of e.requiredAuthorities) {
        const officerId = `usr-ofc-${auth.toLowerCase()}-kl-01`;
        const decisionId = `${e.currentVersionId}_${auth}`;
        await db.collection('events').doc(e.eventId).collection('decisions').doc(decisionId).set({
          decisionId,
          eventId: e.eventId,
          versionId: e.currentVersionId,
          authorityType: auth,
          decision: 'Approved',
          rationale: `${auth} review complete. All required materials reviewed. No outstanding concerns.`,
          reviewerId: officerId,
          decidedAt: daysAgo(e.daysAgoSubmitted + 2),
          current: true,
        });
      }
    }

    // Audit log entries
    const auditEntries = [
      { eventId: e.eventId, action: 'event_created', actorId: e.organiserUid, actorRole: 'organizer', timestamp: daysAgo(e.daysAgoCreated), notes: 'Application created in Draft.' },
    ];
    if (e.daysAgoSubmitted !== null) {
      auditEntries.push({ eventId: e.eventId, action: 'event_submitted', actorId: e.organiserUid, actorRole: 'organizer', timestamp: daysAgo(e.daysAgoSubmitted), notes: 'Application submitted for review.' });
    }
    if (e.status === 'Approved') {
      auditEntries.push({ eventId: e.eventId, action: 'status_changed', actorId: 'usr-adm-001', actorRole: 'authority', previousStatus: 'Pending', newStatus: 'Approved', timestamp: daysAgo(e.daysAgoSubmitted + 5), notes: 'Application approved by admin after authority reviews.' });
    }
    if (e.status === 'Rejected') {
      auditEntries.push({ eventId: e.eventId, action: 'status_changed', actorId: 'usr-adm-001', actorRole: 'authority', previousStatus: 'Pending', newStatus: 'Rejected', timestamp: daysAgo(e.daysAgoSubmitted + 4), notes: 'Application rejected. Insufficient safety planning. Suggest revision.' });
    }
    if (e.status === 'Withdrawn') {
      auditEntries.push({ eventId: e.eventId, action: 'event_withdrawn', actorId: e.organiserUid, actorRole: 'organizer', previousStatus: 'Pending', newStatus: 'Withdrawn', timestamp: daysAgo(e.daysAgoSubmitted + 2), notes: 'Organiser withdrew the application.' });
    }
    for (const a of auditEntries) {
      const auditId = `audit-${a.eventId}-${a.timestamp}-${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`;
      await db.collection('events').doc(e.eventId).collection('audit_logs').doc(auditId).set({ id: auditId, ...a });
    }

    console.log(`  ✓ ${e.eventId} (${e.status}) — ${e.requiredAuthorities.length} auths, ${e.status === 'Approved' ? 'with decisions' : 'no decisions'}`);
  }

  // Public events projection (only approved events get listed)
  console.log('\n--- Writing public_events (only Approved) ---');
  const publicEvents = EVENTS.filter((e) => e.status === 'Approved').map((e) => ({
    eventId: e.eventId,
    versionId: e.currentVersionId,
    eventName: e.name,
    venueName: VENUES.find((v) => v.venueId === e.venueId).name,
    eventType: e.type,
    startDatetime: e.start,
    endDatetime: e.end,
    approvedBy: e.requiredAuthorities,
    publicStatus: 'approved',
  }));
  for (const pe of publicEvents) {
    await db.collection('public_events').doc(pe.eventId).set(pe);
  }
  console.log(`  ${publicEvents.length} public events written`);

  // Event controls (Stage 1 / Stage 2) — for approved events with images
  console.log('\n--- Writing event controls (with base64 images) ---');
  for (const e of EVENTS.filter((ev) => ev.status === 'Approved')) {
    const controls = [
      { controlId: `${e.eventId}-ctrl-police`, controlName: 'Police presence at venue', authority: 'PDRM', image: 'police-presence' },
      { controlId: `${e.eventId}-ctrl-fire`, controlName: 'Fire marshal posting', authority: 'BOMBA', image: 'fire-marshal' },
      { controlId: `${e.eventId}-ctrl-medical`, controlName: 'On-site medical station', authority: 'KKM', image: 'medical-station' },
      { controlId: `${e.eventId}-ctrl-crowd`, controlName: 'Crowd control checkpoint', authority: 'PDRM', image: 'crowd-control' },
      { controlId: `${e.eventId}-ctrl-waste`, controlName: 'Waste management setup', authority: 'DBKL', image: 'waste-mgmt' },
    ];
    for (const c of controls) {
      const controlDoc = {
        controlId: c.controlId,
        eventId: e.eventId,
        versionId: e.currentVersionId,
        controlName: c.controlName,
        authority: c.authority,
        stageRequirement: 'stage1_and_stage2',
        stage1Docs: [
          { docId: `${c.controlId}-s1-1`, docType: 'application', label: `${c.authority} event notification acknowledgement`, status: 'verified', uploadedAt: daysAgo(e.daysAgoSubmitted + 3), uploadedBy: e.organiserUid, verifiedBy: `usr-ofc-${c.authority.toLowerCase()}-kl-01`, verifiedAt: daysAgo(e.daysAgoSubmitted + 4) },
        ],
        stage2Docs: [
          { docId: `${c.controlId}-s2-1`, imageUrl: images[c.image] || null, uploadedAt: daysAgo(e.daysAgoSubmitted + 5), uploadedBy: e.organiserUid, publicConfirmCount: Math.floor(Math.random() * 30), published: true, publishedAt: daysAgo(e.daysAgoSubmitted + 6), publishedBy: 'usr-adm-001' },
        ],
        controlItemVersion: 1,
        publicConfirmCount: Math.floor(Math.random() * 30),
        published: true,
        publishedAt: daysAgo(e.daysAgoSubmitted + 6),
        publishedBy: 'usr-adm-001',
        label: 'approved',
        labelAddedAt: daysAgo(e.daysAgoSubmitted + 6),
      };
      await db.collection('events').doc(e.eventId).collection('event_controls').doc(c.controlId).set(controlDoc);
    }
    console.log(`  ✓ ${e.eventId}: 5 controls written`);
  }

  await app.delete();
  console.log('\n✅ Seeding complete.');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
