/**
 * Stable ID constants for all M3 mock fixtures.
 *
 * Use these instead of inline strings so the fixtures are grep-friendly and
 * one ID change propagates everywhere. When the data is wired to live
 * Firestore, the real event/version/etc. IDs will replace these.
 */

// ----- Events (E001..E017) -----
export const EVENT_IDS = {
  E001: 'evt-001-kl-music-festival',           // Approved + published
  E002: 'evt-002-pj-food-fair',                // UnderReview, mid (provisional)
  E003: 'evt-003-kl-mountain-run',             // Pending (M2 processing)
  E004: 'evt-004-kl-marathon',                 // Rejected (terminal application decision)
  E005: 'evt-005-shah-alam-beach-carnival',    // Rejected (final)
  E006: 'evt-006-kl-tech-conference',          // Withdrawn
  E007: 'evt-007-kl-cultural-night',            // Pending, manual review required
  E008: 'evt-008-shah-alam-adventure-race',    // UnderReview, blocked compliance
  E009: 'evt-009-pj-community-fair',           // UnderReview, insufficient_data
  E010: 'evt-010-kl-night-market',             // UnderReview, multi-version
  E011: 'evt-011-kl-corporate-run',            // Approved + override applied
  E012: 'evt-012-kl-concert',                  // UnderReview, high risk, 5 auths
  E013: 'evt-013-kl-beach-cleanup',            // Approved, Stage 2 reported (M4 ticket)
  E014: 'evt-014-shah-alam-music-fest',        // Approved, M4 confirmed_true
  E015: 'evt-015-kl-charity-run',              // Approved, M4 dismissed
  E016: 'evt-016-axiata-music-fest',           // UnderReview, legacy assessment
  E017: 'evt-017-pj-wedding-expo',             // Draft (organiser not yet submitted)
} as const;

// ----- Event versions (used as document IDs) -----
export const VERSION_IDS = {
  // v1-only events
  V1_E001: 'v1',
  V1_E002: 'v1',
  V1_E003: 'v1',
  V1_E005: 'v1',
  V1_E006: 'v1',
  V1_E007: 'v1',
  V1_E008: 'v1',
  V1_E009: 'v1',
  V1_E011: 'v1',
  V1_E012: 'v1',
  V1_E013: 'v1',
  V1_E014: 'v1',
  V1_E015: 'v1',
  V1_E016: 'v1',
  V1_E017: 'v1',
  // v2 events (multi-version)
  V1_E004: 'v1',
  V2_E004: 'v2',
  V1_E010: 'v1',
  V2_E010: 'v2',
} as const;

// ----- Users -----
// Organisers (using the team roster from the user profile)
export const USER_IDS = {
  // Organisers
  U_ORG_001: 'usr-org-001',  // Chia Yu Xin (M3 owner)
  U_ORG_002: 'usr-org-002',  // Anny Wong (M1 use case diagram)
  U_ORG_003: 'usr-org-003',  // Yap Ern Tong (M4 owner)
  U_ORG_004: 'usr-org-004',  // Oh Wan Ting (M5 owner)
  U_ORG_005: 'usr-org-005',  // Kong Ji Yu (M2 owner / integrator)

  // Admin (role='authority', no authorityType)
  U_ADM_001: 'usr-adm-001',   // Ahmad Razak

  // Authority officers - 5 federal (1 per type)
  U_OFC_PDRM_FED_01: 'usr-ofc-pdrm-fed-01',
  U_OFC_BOMBA_FED_01: 'usr-ofc-bomba-fed-01',
  U_OFC_KKM_FED_01: 'usr-ofc-kkm-fed-01',
  U_OFC_DBKL_FED_01: 'usr-ofc-dbkl-fed-01',
  U_OFC_MOTAC_FED_01: 'usr-ofc-motac-fed-01',

  // Authority officers - Kuala Lumpur state (10 = 5 types x 2)
  U_OFC_PDRM_KL_01: 'usr-ofc-pdrm-kl-01',
  U_OFC_PDRM_KL_02: 'usr-ofc-pdrm-kl-02',
  U_OFC_BOMBA_KL_01: 'usr-ofc-bomba-kl-01',
  U_OFC_BOMBA_KL_02: 'usr-ofc-bomba-kl-02',
  U_OFC_KKM_KL_01: 'usr-ofc-kkm-kl-01',
  U_OFC_KKM_KL_02: 'usr-ofc-kkm-kl-02',
  U_OFC_DBKL_KL_01: 'usr-ofc-dbkl-kl-01',
  U_OFC_DBKL_KL_02: 'usr-ofc-dbkl-kl-02',
  U_OFC_MOTAC_KL_01: 'usr-ofc-motac-kl-01',
  U_OFC_MOTAC_KL_02: 'usr-ofc-motac-kl-02',

  // Authority officers - Selangor state (10)
  U_OFC_PDRM_SL_01: 'usr-ofc-pdrm-sl-01',
  U_OFC_PDRM_SL_02: 'usr-ofc-pdrm-sl-02',
  U_OFC_BOMBA_SL_01: 'usr-ofc-bomba-sl-01',
  U_OFC_BOMBA_SL_02: 'usr-ofc-bomba-sl-02',
  U_OFC_KKM_SL_01: 'usr-ofc-kkm-sl-01',
  U_OFC_KKM_SL_02: 'usr-ofc-kkm-sl-02',
  U_OFC_DBKL_SL_01: 'usr-ofc-dbkl-sl-01',
  U_OFC_DBKL_SL_02: 'usr-ofc-dbkl-sl-02',
  U_OFC_MOTAC_SL_01: 'usr-ofc-motac-sl-01',
  U_OFC_MOTAC_SL_02: 'usr-ofc-motac-sl-02',

  // Registered public viewers
  U_PUB_001: 'usr-pub-001',   // Lim Wei Jian
  U_PUB_002: 'usr-pub-002',   // Tan Mei Ling
  U_PUB_003: 'usr-pub-003',   // Goh Kar Ying
} as const;

// ----- Venues (V001..V010) -----
export const VENUE_IDS = {
  V001: 'ven-001-dataran-merdeka',
  V002: 'ven-002-bukit-jalil-stadium',
  V003: 'ven-003-klcc-convention',
  V004: 'ven-004-axiata-arena',
  V005: 'ven-005-shah-alam-stadium',
  V006: 'ven-006-mbpj-civic-centre',
  V007: 'ven-007-pisa-penang',
  V008: 'ven-008-esplanade-penang',
  V009: 'ven-009-anantara-desaru',
  V010: 'ven-010-sutera-harbour',
} as const;

// ----- Event controls (C001..C0N per event) -----
// Each approved event has 5 control items (police, security, medical, fire, sanitation)
export const CONTROL_IDS = {
  // E001 controls
  E001_C1: 'ctrl-e001-01-police-presence',
  E001_C2: 'ctrl-e001-02-fire-marshal',
  E001_C3: 'ctrl-e001-03-medical-station',
  E001_C4: 'ctrl-e001-04-crowd-control',
  E001_C5: 'ctrl-e001-05-waste-mgmt',

  // E011 controls
  E011_C1: 'ctrl-e011-01-police-presence',
  E011_C2: 'ctrl-e011-02-fire-marshal',
  E011_C3: 'ctrl-e011-03-medical-station',
  E011_C4: 'ctrl-e011-04-crowd-control',
  E011_C5: 'ctrl-e011-05-waste-mgmt',

  // E012 controls
  E012_C1: 'ctrl-e012-01-police-presence',
  E012_C2: 'ctrl-e012-02-fire-marshal',
  E012_C3: 'ctrl-e012-03-medical-station',
  E012_C4: 'ctrl-e012-04-crowd-control',
  E012_C5: 'ctrl-e012-05-waste-mgmt',

  // E013 controls (with reported item)
  E013_C1: 'ctrl-e013-01-police-presence',
  E013_C2: 'ctrl-e013-02-fire-marshal',
  E013_C3: 'ctrl-e013-03-medical-station',  // <-- reported, under review
  E013_C4: 'ctrl-e013-04-crowd-control',
  E013_C5: 'ctrl-e013-05-waste-mgmt',

  // E014 controls (M4 confirmed true)
  E014_C1: 'ctrl-e014-01-police-presence',
  E014_C2: 'ctrl-e014-02-fire-marshal',
  E014_C3: 'ctrl-e014-03-medical-station',  // <-- resubmit_required
  E014_C4: 'ctrl-e014-04-crowd-control',
  E014_C5: 'ctrl-e014-05-waste-mgmt',

  // E015 controls (M4 dismissed)
  E015_C1: 'ctrl-e015-01-police-presence',
  E015_C2: 'ctrl-e015-02-fire-marshal',
  E015_C3: 'ctrl-e015-03-medical-station',  // <-- dismissed, back to approved
  E015_C4: 'ctrl-e015-04-crowd-control',
  E015_C5: 'ctrl-e015-05-waste-mgmt',
} as const;

// ----- M4 public report tickets (R001..R003) -----
export const REPORT_IDS = {
  R001: 'rep-001-e013-c3-staged-image',  // Under investigation
  R002: 'rep-002-e014-c3-confirmed',     // Confirmed true
  R003: 'rep-003-e015-c3-dismissed',     // Dismissed as fake
} as const;

// ----- M4 incidents (INC001..INC010) -----
export const INCIDENT_IDS = {
  INC001: 'inc-001-overcrowding',
  INC002: 'inc-002-medical',
  INC003: 'inc-003-fire-alarm',
  INC004: 'inc-004-lost-child',
  INC005: 'inc-005-food-poisoning',
  INC006: 'inc-006-security',
  INC007: 'inc-007-weather',
  INC008: 'inc-008-traffic',
  INC009: 'inc-009-facility-damage',
  INC010: 'inc-010-suspicious',
} as const;

// ----- Historical events (H001..H010) -----
export const HISTORICAL_EVENT_IDS = {
  H001: 'hist-001-pj-food-fair-2024',
  H002: 'hist-002-kl-run-2024',
  H003: 'hist-003-kl-concert-2024',
  H004: 'hist-004-sl-festival-2024',
  H005: 'hist-005-kl-cultural-2024',
  H006: 'hist-006-pg-sports-2024',
  H007: 'hist-007-kl-fair-2024',
  H008: 'hist-008-sl-religious-2024',
  H009: 'hist-009-kl-exhibition-2024',
  H010: 'hist-010-pg-concert-2024',
} as const;

// ----- Default time helpers (deterministic timestamps for snapshot diffing) -----
// All "now" is anchored at this base time so mock data is reproducible.
export const MOCK_NOW = new Date('2026-08-16T10:00:00+08:00').getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const timeAgo = (ms: number) => MOCK_NOW - ms;
export const hoursAgo = (h: number) => MOCK_NOW - h * HOUR;
export const daysAgo = (d: number) => MOCK_NOW - d * DAY;
export const daysAhead = (d: number) => MOCK_NOW + d * DAY;
export const hoursAhead = (h: number) => MOCK_NOW + h * HOUR;
