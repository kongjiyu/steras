import { EVENT_IDS, USER_IDS, daysAgo, hoursAgo } from './ids';

// ---------------------------------------------------------------------------
// Planned Notification shape (matches scope doc §6 audit retention + §4
// notification matrix). The `sourceActionId` is the dedupe key per A20.
//
// When the real `notifications` collection is added to shared/types.ts,
// this type should be promoted there.
// ---------------------------------------------------------------------------
export type NotificationType =
  | 'N1_assigned_to_event'
  | 'N2_officer_completed_review'
  | 'N3_ready_for_admin_second_review'
  | 'N4_review_locked'
  | 'N5_final_approved'
  | 'N6_final_rejected'
  | 'N7_control_list_changed'
  | 'N8_stage1_rejected_resubmit'
  | 'N9_stage1_verified'
  | 'N10_use_previous'   // silent
  | 'N11_stage2_uploaded'
  | 'N12_public_confirmed'   // silent
  | 'N13_public_reported'
  | 'N14_admin_published'
  | 'N15_m4_outcome_applied'
  | 'N16_stage2_resubmitted';

export interface Notification {
  notificationId: string;
  recipientId: string;
  eventId: string;
  versionId: string;
  notificationType: NotificationType;
  title: string;
  message: string;
  sourceActionId: string;
  createdAt: number;
  readAt: number | null;
}

const mkNotif = (overrides: Omit<Notification, 'notificationId'>): Notification => ({
  notificationId: `${overrides.recipientId}_${overrides.sourceActionId}`,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Notifications per recipient - covers all 16 matrix triggers
// ---------------------------------------------------------------------------
export const mockNotifications: Notification[] = [
  // ===== N1 - Admin completes initial review, officer assigned =====
  mkNotif({
    recipientId: USER_IDS.U_OFC_PDRM_KL_01, eventId: EVENT_IDS.E001, versionId: 'v1',
    notificationType: 'N1_assigned_to_event',
    title: 'You have been assigned to a new event',
    message: 'You have been assigned to review "Dataran Merdeka Music Festival 2026".',
    sourceActionId: `e001-v1-pdrm-kl-01-assigned`,
    createdAt: daysAgo(22),
    readAt: daysAgo(20),
  }),
  mkNotif({
    recipientId: USER_IDS.U_OFC_BOMBA_KL_01, eventId: EVENT_IDS.E001, versionId: 'v1',
    notificationType: 'N1_assigned_to_event',
    title: 'You have been assigned to a new event',
    message: 'You have been assigned to review "Dataran Merdeka Music Festival 2026".',
    sourceActionId: `e001-v1-bomba-kl-01-assigned`,
    createdAt: daysAgo(22),
    readAt: daysAgo(20),
  }),

  // ===== N2 - Officer completes review (silent to peers) =====
  // (no fixture - N2 is silent)

  // ===== N3 - All officers complete, ready for admin second review =====
  mkNotif({
    recipientId: USER_IDS.U_ADM_001, eventId: EVENT_IDS.E001, versionId: 'v1',
    notificationType: 'N3_ready_for_admin_second_review',
    title: 'Event ready for your second review',
    message: '"Dataran Merdeka Music Festival 2026" has all officer decisions recorded and is ready for your second review.',
    sourceActionId: `e001-v1-admin-second-review-ready`,
    createdAt: daysAgo(16),
    readAt: daysAgo(15),
  }),

  // ===== N4 - Review locked =====
  mkNotif({
    recipientId: USER_IDS.U_OFC_PDRM_KL_01, eventId: EVENT_IDS.E001, versionId: 'v1',
    notificationType: 'N4_review_locked',
    title: 'Review locked',
    message: 'Admin has started second review of "Dataran Merdeka Music Festival 2026". Your decision is final and cannot be edited.',
    sourceActionId: `e001-v1-pdrm-locked`,
    createdAt: daysAgo(16),
    readAt: daysAgo(16),
  }),

  // ===== N5 - Final approved =====
  mkNotif({
    recipientId: USER_IDS.U_ORG_001, eventId: EVENT_IDS.E001, versionId: 'v1',
    notificationType: 'N5_final_approved',
    title: 'Your event has been approved',
    message: '"Dataran Merdeka Music Festival 2026" has been Approved. The event control list will be generated next.',
    sourceActionId: `e001-v1-org-approved`,
    createdAt: daysAgo(16),
    readAt: null,
  }),

  // ===== N6 - Final rejected =====
  mkNotif({
    recipientId: USER_IDS.U_ORG_005, eventId: EVENT_IDS.E005, versionId: 'v1',
    notificationType: 'N6_final_rejected',
    title: 'Your event has been rejected',
    message: '"Shah Alam Beach Carnival" has been Rejected. Reason: No valid fire certificate on file. Suggestion: Obtain temporary fire cert from BOMBA Selangor or relocate to a venue with active cert.',
    sourceActionId: `e005-v1-org-rejected`,
    createdAt: daysAgo(12),
    readAt: null,
  }),

  // ===== N7 - Control list changed (silent in current scope) =====
  // No fixture (no admin edit log yet)

  // ===== N8 - Stage 1 rejected, resubmit required =====
  mkNotif({
    recipientId: USER_IDS.U_ORG_003, eventId: EVENT_IDS.E013, versionId: 'v1',
    notificationType: 'N8_stage1_rejected_resubmit',
    title: 'Please re-submit Stage 1 documentation',
    message: 'Control #2 (Fire Marshal) Stage 1 documentation was rejected. Reason: Photo does not show valid BOMBA marshal credential. Suggestion: Re-upload with current credential visible.',
    sourceActionId: `e013-c2-stage1-rejected`,
    createdAt: hoursAgo(20),
    readAt: null,
  }),

  // ===== N9 - Stage 1 verified =====
  mkNotif({
    recipientId: USER_IDS.U_ORG_001, eventId: EVENT_IDS.E001, versionId: 'v1',
    notificationType: 'N9_stage1_verified',
    title: 'Stage 1 documentation verified',
    message: 'Stage 1 for Control #3 (Medical Station) verified by KKM. Police presence photo accepted by PDRM.',
    sourceActionId: `e001-c3-stage1-verified`,
    createdAt: daysAgo(10),
    readAt: null,
  }),

  // ===== N10 - Use Previous (silent) =====
  // No fixture

  // ===== N11 - Stage 2 uploaded =====
  mkNotif({
    recipientId: USER_IDS.U_ORG_001, eventId: EVENT_IDS.E001, versionId: 'v1',
    notificationType: 'N11_stage2_uploaded',
    title: 'Stage 2 image uploaded',
    message: 'Stage 2 for Control #3 (Medical Station) uploaded. Now visible to public for verification.',
    sourceActionId: `e001-c3-stage2-uploaded`,
    createdAt: daysAgo(8),
    readAt: null,
  }),

  // ===== N12 - Public confirmed (silent in feed, count updates) =====
  // No fixture (count only)

  // ===== N13 - Public reported =====
  mkNotif({
    recipientId: USER_IDS.U_ORG_003, eventId: EVENT_IDS.E013, versionId: 'v1',
    notificationType: 'N13_public_reported',
    title: 'Control item has been reported',
    message: 'Control #3 (Medical Station) has been reported by a public viewer as inaccurate. M4 investigation in progress.',
    sourceActionId: `e013-c3-public-reported`,
    createdAt: daysAgo(1),
    readAt: null,
  }),
  mkNotif({
    recipientId: USER_IDS.U_ADM_001, eventId: EVENT_IDS.E013, versionId: 'v1',
    notificationType: 'N13_public_reported',
    title: 'Event Control item reported',
    message: '"KL Coastal Cleanup Day" Control #3 reported — see M4 ticket rep-001-e013-c3-staged-image.',
    sourceActionId: `e013-c3-admin-reported`,
    createdAt: daysAgo(1),
    readAt: null,
  }),

  // ===== N14 - Admin published to public view =====
  mkNotif({
    recipientId: USER_IDS.U_ORG_001, eventId: EVENT_IDS.E001, versionId: 'v1',
    notificationType: 'N14_admin_published',
    title: 'Your event controls are now public',
    message: '"Dataran Merdeka Music Festival 2026" now has public safety controls visible. 5 control items published.',
    sourceActionId: `e001-v1-publish-to-public`,
    createdAt: daysAgo(15),
    readAt: daysAgo(15),
  }),

  // ===== N15 - M4 outcome applied =====
  mkNotif({
    recipientId: USER_IDS.U_ORG_004, eventId: EVENT_IDS.E014, versionId: 'v1',
    notificationType: 'N15_m4_outcome_applied',
    title: 'Control report outcome: resubmit required',
    message: 'Control #3 (Medical Station) report outcome applied: M4 investigation confirmed discrepancy. New Stage 2 upload required.',
    sourceActionId: `e014-c3-m4-confirmed`,
    createdAt: daysAgo(5),
    readAt: null,
  }),
  mkNotif({
    recipientId: USER_IDS.U_ORG_005, eventId: EVENT_IDS.E015, versionId: 'v1',
    notificationType: 'N15_m4_outcome_applied',
    title: 'Control report outcome: dismissed',
    message: 'Control #3 (Medical Station) report outcome applied: M4 investigation dismissed as fake. Document state restored to approved.',
    sourceActionId: `e015-c3-m4-dismissed`,
    createdAt: daysAgo(5),
    readAt: null,
  }),
  mkNotif({
    recipientId: USER_IDS.U_ADM_001, eventId: EVENT_IDS.E014, versionId: 'v1',
    notificationType: 'N15_m4_outcome_applied',
    title: 'M4 outcome auto-applied to Control',
    message: 'System auto-applied M4 outcome to Control #3 of "Shah Alam Music Fest 2026": confirmed_true. You have override capability.',
    sourceActionId: `e014-c3-admin-m4-applied`,
    createdAt: daysAgo(5),
    readAt: null,
  }),

  // ===== N16 - Organiser re-uploaded Stage 2 =====
  mkNotif({
    recipientId: USER_IDS.U_ADM_001, eventId: EVENT_IDS.E014, versionId: 'v1',
    notificationType: 'N16_stage2_resubmitted',
    title: 'Organizer re-uploaded Stage 2',
    message: '"Shah Alam Music Fest 2026" Control #3 organizer re-uploaded after public report — awaiting re-verification.',
    sourceActionId: `e014-c3-resubmitted`,
    createdAt: daysAgo(2),
    readAt: null,
  }),
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
export const findNotificationsForRecipient = (recipientId: string): Notification[] =>
  mockNotifications
    .filter((n) => n.recipientId === recipientId)
    .sort((a, b) => b.createdAt - a.createdAt);

export const findUnreadNotificationsForRecipient = (recipientId: string): Notification[] =>
  findNotificationsForRecipient(recipientId).filter((n) => n.readAt === null);

export const findNotificationsForEvent = (eventId: string): Notification[] =>
  mockNotifications.filter((n) => n.eventId === eventId);
