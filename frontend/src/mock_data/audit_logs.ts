import { AuditAction, AuditLog, EventStatus } from '@shared/types';
import { EVENT_IDS, USER_IDS, daysAgo, hoursAgo } from './ids';

interface AuditOverrides {
  eventId: string;
  action: AuditAction;
  actorId: string;
  actorRole: 'organizer' | 'authority' | 'public' | 'system';
  timestamp: number;
  versionId?: string;
  previousStatus?: EventStatus;
  newStatus?: EventStatus;
  notes?: string;
  metadata?: Record<string, unknown>;
}

const mkAudit = (o: AuditOverrides, index: number): AuditLog => ({
  id: `audit-${o.eventId}-${o.timestamp}-${String(index).padStart(4, '0')}`,
  eventId: o.eventId,
  versionId: o.versionId,
  action: o.action,
  actorId: o.actorId,
  actorRole: o.actorRole,
  timestamp: o.timestamp,
  previousStatus: o.previousStatus,
  newStatus: o.newStatus,
  notes: o.notes,
  metadata: o.metadata,
});

// ---------------------------------------------------------------------------
// Audit logs per event
// ---------------------------------------------------------------------------
const auditByEvent: Record<string, AuditOverrides[]> = {
  // E001 - Approved + Published
  [EVENT_IDS.E001]: [
    { eventId: EVENT_IDS.E001, action: 'event_created', actorId: USER_IDS.U_ORG_001, actorRole: 'organizer', timestamp: daysAgo(30) },
    { eventId: EVENT_IDS.E001, action: 'event_submitted', actorId: USER_IDS.U_ORG_001, actorRole: 'organizer', timestamp: daysAgo(28), versionId: 'v1', newStatus: 'Pending' },
    { eventId: EVENT_IDS.E001, action: 'risk_score_computed', actorId: 'system', actorRole: 'system', timestamp: daysAgo(28), versionId: 'v1', metadata: { officialScore: 55, officialRiskLevel: 'Medium' } },
    { eventId: EVENT_IDS.E001, action: 'resource_recommended', actorId: 'system', actorRole: 'system', timestamp: daysAgo(28), versionId: 'v1' },
    { eventId: EVENT_IDS.E001, action: 'status_changed', actorId: USER_IDS.U_OFC_PDRM_KL_01, actorRole: 'authority', timestamp: daysAgo(20), versionId: 'v1', previousStatus: 'Pending', newStatus: 'UnderReview' },
    { eventId: EVENT_IDS.E001, action: 'decision_made', actorId: USER_IDS.U_OFC_PDRM_KL_01, actorRole: 'authority', timestamp: daysAgo(20), versionId: 'v1', newStatus: 'UnderReview', notes: 'Crowd management plan verified.', metadata: { authorityType: 'PDRM', decision: 'Approved' } },
    { eventId: EVENT_IDS.E001, action: 'decision_made', actorId: USER_IDS.U_OFC_BOMBA_KL_01, actorRole: 'authority', timestamp: daysAgo(19), versionId: 'v1', notes: 'Fire safety inspection completed.', metadata: { authorityType: 'BOMBA', decision: 'Approved' } },
    { eventId: EVENT_IDS.E001, action: 'decision_made', actorId: USER_IDS.U_OFC_KKM_KL_01, actorRole: 'authority', timestamp: daysAgo(18), versionId: 'v1', notes: 'Medical team allocation within guideline.', metadata: { authorityType: 'KKM', decision: 'Approved' } },
    { eventId: EVENT_IDS.E001, action: 'decision_made', actorId: USER_IDS.U_OFC_DBKL_KL_01, actorRole: 'authority', timestamp: daysAgo(17), versionId: 'v1', notes: 'Capacity within safe envelope.', metadata: { authorityType: 'DBKL', decision: 'Approved' } },
    { eventId: EVENT_IDS.E001, action: 'decision_made', actorId: USER_IDS.U_OFC_MOTAC_KL_01, actorRole: 'authority', timestamp: daysAgo(16), versionId: 'v1', notes: 'Tourism registration complete.', metadata: { authorityType: 'MOTAC', decision: 'Approved' } },
    { eventId: EVENT_IDS.E001, action: 'status_changed', actorId: 'system', actorRole: 'system', timestamp: daysAgo(16), versionId: 'v1', previousStatus: 'UnderReview', newStatus: 'Approved' },
    { eventId: EVENT_IDS.E001, action: 'public_published', actorId: 'system', actorRole: 'system', timestamp: daysAgo(16), versionId: 'v1', metadata: { approvedBy: ['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'] } },
  ],

  // E002 - UnderReview
  [EVENT_IDS.E002]: [
    { eventId: EVENT_IDS.E002, action: 'event_created', actorId: USER_IDS.U_ORG_002, actorRole: 'organizer', timestamp: daysAgo(14) },
    { eventId: EVENT_IDS.E002, action: 'event_submitted', actorId: USER_IDS.U_ORG_002, actorRole: 'organizer', timestamp: daysAgo(12), versionId: 'v1', newStatus: 'Pending' },
    { eventId: EVENT_IDS.E002, action: 'risk_score_computed', actorId: 'system', actorRole: 'system', timestamp: daysAgo(12), versionId: 'v1', metadata: { officialScore: 38, officialRiskLevel: 'Low', readiness: 'provisional' } },
    { eventId: EVENT_IDS.E002, action: 'resource_recommended', actorId: 'system', actorRole: 'system', timestamp: daysAgo(12), versionId: 'v1' },
    { eventId: EVENT_IDS.E002, action: 'status_changed', actorId: USER_IDS.U_OFC_PDRM_SL_01, actorRole: 'authority', timestamp: daysAgo(5), versionId: 'v1', previousStatus: 'Pending', newStatus: 'UnderReview' },
    { eventId: EVENT_IDS.E002, action: 'decision_made', actorId: USER_IDS.U_OFC_PDRM_SL_01, actorRole: 'authority', timestamp: daysAgo(5), versionId: 'v1', newStatus: 'UnderReview', notes: 'Indoor venue, low crowd flow risk.', metadata: { authorityType: 'PDRM', decision: 'Approved' } },
    { eventId: EVENT_IDS.E002, action: 'decision_made', actorId: USER_IDS.U_OFC_BOMBA_SL_01, actorRole: 'authority', timestamp: daysAgo(3), versionId: 'v1', notes: 'Indoor venue with verified fire cert.', metadata: { authorityType: 'BOMBA', decision: 'Approved' } },
    { eventId: EVENT_IDS.E002, action: 'decision_made', actorId: USER_IDS.U_OFC_KKM_SL_01, actorRole: 'authority', timestamp: daysAgo(1), versionId: 'v1', notes: 'Food sampling protocol acceptable.', metadata: { authorityType: 'KKM', decision: 'Approved' } },
  ],

  // E003 - Pending (no decisions yet)
  [EVENT_IDS.E003]: [
    { eventId: EVENT_IDS.E003, action: 'event_created', actorId: USER_IDS.U_ORG_003, actorRole: 'organizer', timestamp: hoursAgo(18) },
    { eventId: EVENT_IDS.E003, action: 'event_submitted', actorId: USER_IDS.U_ORG_003, actorRole: 'organizer', timestamp: hoursAgo(6), versionId: 'v1', newStatus: 'Pending' },
  ],

  // E004 - Rejected current version (a correction would create a new version)
  [EVENT_IDS.E004]: [
    { eventId: EVENT_IDS.E004, action: 'event_created', actorId: USER_IDS.U_ORG_004, actorRole: 'organizer', timestamp: daysAgo(21) },
    { eventId: EVENT_IDS.E004, action: 'event_submitted', actorId: USER_IDS.U_ORG_004, actorRole: 'organizer', timestamp: daysAgo(18), versionId: 'v1', newStatus: 'Pending' },
    { eventId: EVENT_IDS.E004, action: 'risk_score_computed', actorId: 'system', actorRole: 'system', timestamp: daysAgo(18), versionId: 'v1', metadata: { officialScore: 65, officialRiskLevel: 'Medium' } },
    { eventId: EVENT_IDS.E004, action: 'resource_recommended', actorId: 'system', actorRole: 'system', timestamp: daysAgo(18), versionId: 'v1' },
    { eventId: EVENT_IDS.E004, action: 'decision_made', actorId: USER_IDS.U_OFC_PDRM_KL_01, actorRole: 'authority', timestamp: daysAgo(15), versionId: 'v1', notes: 'Traffic plan approved.', metadata: { authorityType: 'PDRM', decision: 'Approved' } },
    { eventId: EVENT_IDS.E004, action: 'decision_made', actorId: USER_IDS.U_OFC_BOMBA_KL_01, actorRole: 'authority', timestamp: daysAgo(12), versionId: 'v1', notes: 'Insufficient medical plan.', metadata: { authorityType: 'BOMBA', decision: 'Rejected' } },
    { eventId: EVENT_IDS.E004, action: 'decision_made', actorId: USER_IDS.U_OFC_KKM_KL_01, actorRole: 'authority', timestamp: daysAgo(11), versionId: 'v1', notes: 'Medical staffing plan is insufficient for this event scale.', metadata: { authorityType: 'KKM', decision: 'Rejected' } },
    { eventId: EVENT_IDS.E004, action: 'status_changed', actorId: 'system', actorRole: 'system', timestamp: daysAgo(11), versionId: 'v1', previousStatus: 'UnderReview', newStatus: 'Rejected', notes: 'Version v1 is rejected and immutable; any correction must be submitted as a new application version.' },
  ],

  // E005 - Rejected
  [EVENT_IDS.E005]: [
    { eventId: EVENT_IDS.E005, action: 'event_created', actorId: USER_IDS.U_ORG_005, actorRole: 'organizer', timestamp: daysAgo(30) },
    { eventId: EVENT_IDS.E005, action: 'event_submitted', actorId: USER_IDS.U_ORG_005, actorRole: 'organizer', timestamp: daysAgo(28), versionId: 'v1', newStatus: 'Pending' },
    { eventId: EVENT_IDS.E005, action: 'risk_score_computed', actorId: 'system', actorRole: 'system', timestamp: daysAgo(28), versionId: 'v1', metadata: { officialScore: 72, officialRiskLevel: 'High' } },
    { eventId: EVENT_IDS.E005, action: 'decision_made', actorId: USER_IDS.U_OFC_PDRM_SL_01, actorRole: 'authority', timestamp: daysAgo(15), versionId: 'v1', metadata: { authorityType: 'PDRM', decision: 'Approved' } },
    { eventId: EVENT_IDS.E005, action: 'decision_made', actorId: USER_IDS.U_OFC_BOMBA_SL_01, actorRole: 'authority', timestamp: daysAgo(13), versionId: 'v1', notes: 'No valid fire certificate.', metadata: { authorityType: 'BOMBA', decision: 'Rejected' } },
    { eventId: EVENT_IDS.E005, action: 'decision_made', actorId: USER_IDS.U_OFC_KKM_SL_01, actorRole: 'authority', timestamp: daysAgo(12), versionId: 'v1', metadata: { authorityType: 'KKM', decision: 'Approved' } },
    { eventId: EVENT_IDS.E005, action: 'status_changed', actorId: 'system', actorRole: 'system', timestamp: daysAgo(12), versionId: 'v1', previousStatus: 'UnderReview', newStatus: 'Rejected' },
  ],

  // E006 - Withdrawn
  [EVENT_IDS.E006]: [
    { eventId: EVENT_IDS.E006, action: 'event_created', actorId: USER_IDS.U_ORG_001, actorRole: 'organizer', timestamp: daysAgo(60) },
    { eventId: EVENT_IDS.E006, action: 'event_submitted', actorId: USER_IDS.U_ORG_001, actorRole: 'organizer', timestamp: daysAgo(55), versionId: 'v1', newStatus: 'Pending' },
    { eventId: EVENT_IDS.E006, action: 'decision_made', actorId: USER_IDS.U_OFC_DBKL_KL_01, actorRole: 'authority', timestamp: daysAgo(48), versionId: 'v1', metadata: { authorityType: 'DBKL', decision: 'Approved' } },
    { eventId: EVENT_IDS.E006, action: 'event_withdrawn', actorId: USER_IDS.U_ORG_001, actorRole: 'organizer', timestamp: daysAgo(40), previousStatus: 'UnderReview', newStatus: 'Withdrawn', notes: 'Organiser withdrew due to venue scheduling conflict.' },
  ],

  // E010 - Multi-version
  [EVENT_IDS.E010]: [
    { eventId: EVENT_IDS.E010, action: 'event_created', actorId: USER_IDS.U_ORG_005, actorRole: 'organizer', timestamp: daysAgo(25) },
    { eventId: EVENT_IDS.E010, action: 'event_submitted', actorId: USER_IDS.U_ORG_005, actorRole: 'organizer', timestamp: daysAgo(22), versionId: 'v1', newStatus: 'Pending' },
    { eventId: EVENT_IDS.E010, action: 'risk_score_computed', actorId: 'system', actorRole: 'system', timestamp: daysAgo(22), versionId: 'v1', metadata: { officialScore: 70, officialRiskLevel: 'High' } },
    { eventId: EVENT_IDS.E010, action: 'decision_made', actorId: USER_IDS.U_OFC_PDRM_KL_01, actorRole: 'authority', timestamp: daysAgo(18), versionId: 'v1', notes: 'Crowd flow inadequate.', metadata: { authorityType: 'PDRM', decision: 'Rejected' } },
    { eventId: EVENT_IDS.E010, action: 'decision_made', actorId: USER_IDS.U_OFC_BOMBA_KL_01, actorRole: 'authority', timestamp: daysAgo(15), versionId: 'v1', metadata: { authorityType: 'BOMBA', decision: 'Approved' } },
    { eventId: EVENT_IDS.E010, action: 'decision_made', actorId: USER_IDS.U_OFC_DBKL_KL_01, actorRole: 'authority', timestamp: daysAgo(14), versionId: 'v1', metadata: { authorityType: 'DBKL', decision: 'Approved' } },
    { eventId: EVENT_IDS.E010, action: 'status_changed', actorId: 'system', actorRole: 'system', timestamp: daysAgo(18), versionId: 'v1', previousStatus: 'UnderReview', newStatus: 'Rejected' },
    { eventId: EVENT_IDS.E010, action: 'event_updated', actorId: USER_IDS.U_ORG_005, actorRole: 'organizer', timestamp: daysAgo(2), versionId: 'v1', notes: 'Legacy version history retained for audit; new rejected applications cannot be edited.' },
    { eventId: EVENT_IDS.E010, action: 'event_submitted', actorId: USER_IDS.U_ORG_005, actorRole: 'organizer', timestamp: daysAgo(2), versionId: 'v2', newStatus: 'Pending' },
    { eventId: EVENT_IDS.E010, action: 'risk_score_computed', actorId: 'system', actorRole: 'system', timestamp: daysAgo(2), versionId: 'v2', metadata: { officialScore: 45, officialRiskLevel: 'Medium' } },
    { eventId: EVENT_IDS.E010, action: 'decision_made', actorId: USER_IDS.U_OFC_PDRM_KL_02, actorRole: 'authority', timestamp: daysAgo(1), versionId: 'v2', notes: 'v2 crowd flow plan acceptable.', metadata: { authorityType: 'PDRM', decision: 'Approved' } },
  ],

  // E011 - Approved with override
  [EVENT_IDS.E011]: [
    { eventId: EVENT_IDS.E011, action: 'event_created', actorId: USER_IDS.U_ORG_001, actorRole: 'organizer', timestamp: daysAgo(30) },
    { eventId: EVENT_IDS.E011, action: 'event_submitted', actorId: USER_IDS.U_ORG_001, actorRole: 'organizer', timestamp: daysAgo(28), versionId: 'v1', newStatus: 'Pending' },
    { eventId: EVENT_IDS.E011, action: 'risk_score_computed', actorId: 'system', actorRole: 'system', timestamp: daysAgo(28), versionId: 'v1' },
    { eventId: EVENT_IDS.E011, action: 'resource_recommended', actorId: 'system', actorRole: 'system', timestamp: daysAgo(28), versionId: 'v1' },
    { eventId: EVENT_IDS.E011, action: 'resource_overridden', actorId: USER_IDS.U_OFC_PDRM_FED_01, actorRole: 'authority', timestamp: daysAgo(10), versionId: 'v1', notes: 'Police increased 12 -> 18 for Parliament session.', metadata: { authorityType: 'PDRM', previous: { police: 12 }, updated: { police: 18 } } },
    { eventId: EVENT_IDS.E011, action: 'decision_made', actorId: USER_IDS.U_OFC_PDRM_KL_01, actorRole: 'authority', timestamp: daysAgo(20), versionId: 'v1', metadata: { authorityType: 'PDRM', decision: 'Approved' } },
    { eventId: EVENT_IDS.E011, action: 'decision_made', actorId: USER_IDS.U_OFC_BOMBA_KL_01, actorRole: 'authority', timestamp: daysAgo(18), versionId: 'v1', metadata: { authorityType: 'BOMBA', decision: 'Approved' } },
    { eventId: EVENT_IDS.E011, action: 'decision_made', actorId: USER_IDS.U_OFC_KKM_KL_01, actorRole: 'authority', timestamp: daysAgo(17), versionId: 'v1', metadata: { authorityType: 'KKM', decision: 'Approved' } },
    { eventId: EVENT_IDS.E011, action: 'status_changed', actorId: 'system', actorRole: 'system', timestamp: daysAgo(17), versionId: 'v1', previousStatus: 'UnderReview', newStatus: 'Approved' },
    { eventId: EVENT_IDS.E011, action: 'public_published', actorId: 'system', actorRole: 'system', timestamp: daysAgo(17), versionId: 'v1', metadata: { approvedBy: ['PDRM', 'BOMBA', 'KKM'] } },
  ],

  // E012 - High risk
  [EVENT_IDS.E012]: [
    { eventId: EVENT_IDS.E012, action: 'event_created', actorId: USER_IDS.U_ORG_002, actorRole: 'organizer', timestamp: daysAgo(14) },
    { eventId: EVENT_IDS.E012, action: 'event_submitted', actorId: USER_IDS.U_ORG_002, actorRole: 'organizer', timestamp: daysAgo(12), versionId: 'v1', newStatus: 'Pending' },
    { eventId: EVENT_IDS.E012, action: 'risk_score_computed', actorId: 'system', actorRole: 'system', timestamp: daysAgo(12), versionId: 'v1', metadata: { officialScore: 85, officialRiskLevel: 'High' } },
    { eventId: EVENT_IDS.E012, action: 'decision_made', actorId: USER_IDS.U_OFC_PDRM_FED_01, actorRole: 'authority', timestamp: daysAgo(5), versionId: 'v1', notes: 'Comprehensive traffic plan.', metadata: { authorityType: 'PDRM', decision: 'Approved' } },
  ],

  // E013 - Approved, reported
  [EVENT_IDS.E013]: [
    { eventId: EVENT_IDS.E013, action: 'event_created', actorId: USER_IDS.U_ORG_003, actorRole: 'organizer', timestamp: daysAgo(60) },
    { eventId: EVENT_IDS.E013, action: 'event_submitted', actorId: USER_IDS.U_ORG_003, actorRole: 'organizer', timestamp: daysAgo(55), versionId: 'v1', newStatus: 'Pending' },
    { eventId: EVENT_IDS.E013, action: 'decision_made', actorId: USER_IDS.U_OFC_PDRM_KL_01, actorRole: 'authority', timestamp: daysAgo(45), versionId: 'v1', metadata: { authorityType: 'PDRM', decision: 'Approved' } },
    { eventId: EVENT_IDS.E013, action: 'decision_made', actorId: USER_IDS.U_OFC_BOMBA_KL_01, actorRole: 'authority', timestamp: daysAgo(44), versionId: 'v1', metadata: { authorityType: 'BOMBA', decision: 'Approved' } },
    { eventId: EVENT_IDS.E013, action: 'public_published', actorId: 'system', actorRole: 'system', timestamp: daysAgo(44), versionId: 'v1', metadata: { approvedBy: ['PDRM', 'BOMBA'] } },
  ],

  // E014 - Approved, M4 confirmed true
  [EVENT_IDS.E014]: [
    { eventId: EVENT_IDS.E014, action: 'event_created', actorId: USER_IDS.U_ORG_004, actorRole: 'organizer', timestamp: daysAgo(90) },
    { eventId: EVENT_IDS.E014, action: 'event_submitted', actorId: USER_IDS.U_ORG_004, actorRole: 'organizer', timestamp: daysAgo(85), versionId: 'v1', newStatus: 'Pending' },
    { eventId: EVENT_IDS.E014, action: 'decision_made', actorId: USER_IDS.U_OFC_PDRM_SL_01, actorRole: 'authority', timestamp: daysAgo(80), versionId: 'v1', metadata: { authorityType: 'PDRM', decision: 'Approved' } },
    { eventId: EVENT_IDS.E014, action: 'decision_made', actorId: USER_IDS.U_OFC_BOMBA_SL_01, actorRole: 'authority', timestamp: daysAgo(78), versionId: 'v1', metadata: { authorityType: 'BOMBA', decision: 'Approved' } },
    { eventId: EVENT_IDS.E014, action: 'decision_made', actorId: USER_IDS.U_OFC_KKM_SL_01, actorRole: 'authority', timestamp: daysAgo(76), versionId: 'v1', metadata: { authorityType: 'KKM', decision: 'Approved' } },
    { eventId: EVENT_IDS.E014, action: 'public_published', actorId: 'system', actorRole: 'system', timestamp: daysAgo(76), versionId: 'v1', metadata: { approvedBy: ['PDRM', 'BOMBA', 'KKM'] } },
    // M4 outcome applied - control #3 set to resubmit_required
    { eventId: EVENT_IDS.E014, action: 'status_changed', actorId: 'system', actorRole: 'system', timestamp: daysAgo(5), versionId: 'v1', notes: 'M4 confirmed_true applied via public_reports trigger.', metadata: { trigger: 'public_reports', reportId: 'rep-002', previousState: 'approved', newState: 'resubmit_required', controlId: 'ctrl-e014-03-medical-station' } },
  ],

  // E015 - Approved, M4 dismissed
  [EVENT_IDS.E015]: [
    { eventId: EVENT_IDS.E015, action: 'event_created', actorId: USER_IDS.U_ORG_005, actorRole: 'organizer', timestamp: daysAgo(90) },
    { eventId: EVENT_IDS.E015, action: 'event_submitted', actorId: USER_IDS.U_ORG_005, actorRole: 'organizer', timestamp: daysAgo(85), versionId: 'v1', newStatus: 'Pending' },
    { eventId: EVENT_IDS.E015, action: 'decision_made', actorId: USER_IDS.U_OFC_PDRM_KL_01, actorRole: 'authority', timestamp: daysAgo(78), versionId: 'v1', metadata: { authorityType: 'PDRM', decision: 'Approved' } },
    { eventId: EVENT_IDS.E015, action: 'decision_made', actorId: USER_IDS.U_OFC_BOMBA_KL_01, actorRole: 'authority', timestamp: daysAgo(76), versionId: 'v1', metadata: { authorityType: 'BOMBA', decision: 'Approved' } },
    { eventId: EVENT_IDS.E015, action: 'public_published', actorId: 'system', actorRole: 'system', timestamp: daysAgo(76), versionId: 'v1', metadata: { approvedBy: ['PDRM', 'BOMBA'] } },
    { eventId: EVENT_IDS.E015, action: 'status_changed', actorId: 'system', actorRole: 'system', timestamp: daysAgo(5), versionId: 'v1', notes: 'M4 dismissed as fake applied via public_reports trigger.', metadata: { trigger: 'public_reports', reportId: 'rep-003', previousState: 'reported_under_review', newState: 'approved', controlId: 'ctrl-e015-03-medical-station' } },
  ],
};

// Flatten and sort by timestamp asc
const flattened: AuditOverrides[] = [];
Object.values(auditByEvent).forEach((entries) => flattened.push(...entries));
flattened.sort((a, b) => a.timestamp - b.timestamp);

export const mockAuditLogs: AuditLog[] = flattened.map((o, i) => mkAudit(o, i));

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
export const findAuditLogsForEvent = (eventId: string): AuditLog[] =>
  mockAuditLogs
    .filter((l) => l.eventId === eventId)
    .sort((a, b) => a.timestamp - b.timestamp);

export const findAuditLogsForEventByAction = (eventId: string, action: AuditAction): AuditLog[] =>
  mockAuditLogs.filter((l) => l.eventId === eventId && l.action === action);
