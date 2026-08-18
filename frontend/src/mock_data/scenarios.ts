/**
 * Named scenario groupings for the design-review demo.
 *
 * Use these to drive the demo mode via a query param or env flag:
 *   e.g. `?scenario=happy_path` to show only approved events,
 *        `?scenario=edge_cases` to show provisional/blocked/multi-version,
 *        `?scenario=m4_outcomes` to show the M4 trigger flow.
 */

import { AuthorityType, EventRecord } from '@shared/types';
import { mockEvents, findEventById, mockEventsById } from './events';
import { findControlsForEvent } from './controls';
import { findPublicReports, mockPublicReports } from './public_reports';
import { mockNotifications, findNotificationsForRecipient } from './notifications';
import { mockCurrentDecisionsForUi, findCurrentDecisions } from './decisions';
import { mockAuditLogs, findAuditLogsForEvent } from './audit_logs';
import { findResourceByEventVersion, mockResourceRecommendations } from './resources';
import { findAssessmentByEventVersion } from './assessments';
import { USER_IDS } from './ids';
import { categoryFor, labelForCategory } from './event_categories';
import { findOrganiserProfile, mockOrganiserProfiles } from './organiser_profiles';
import { findScheduleForEvent } from './event_schedules';
import { findDocumentSet, missingRequiredDocs, rejectedDocs, documentStatusCounts } from './event_documents';
import { triggersForEvent, additionalDocsForEvent, isHighRisk, labelForTrigger } from './event_triggers';

// ---------------------------------------------------------------------------
// Filter scenarios
// ---------------------------------------------------------------------------

/** Only approved + published events (cleanest demo). */
export const scenarioHappyPath = (): EventRecord[] =>
  mockEvents.filter((e) => e.status === 'Approved');

/** Events demonstrating the 6 known gaps. */
export const scenarioEdgeCases = (): EventRecord[] =>
  ['evt-002-pj-food-fair', 'evt-004-kl-marathon', 'evt-008-shah-alam-adventure-race', 'evt-009-pj-community-fair', 'evt-010-kl-night-market', 'evt-016-axiata-music-fest']
    .map((id) => findEventById(id))
    .filter((e): e is EventRecord => Boolean(e));

/** Events demonstrating the M4 outcome trigger flow. */
export const scenarioM4Outcomes = (): EventRecord[] =>
  ['evt-013-kl-beach-cleanup', 'evt-014-shah-alam-music-fest', 'evt-015-kl-charity-run']
    .map((id) => findEventById(id))
    .filter((e): e is EventRecord => Boolean(e));

/** Events pending manual review by the admin. */
export const scenarioManualReview = (): EventRecord[] =>
  mockEvents.filter((e) => {
    const a = findAssessmentByEventVersion(e.eventId, e.currentVersionId ?? '');
    return a?.status === 'manual_review_required';
  });

/** Events with a blocked compliance (test: should be un-approvable). */
export const scenarioBlockedCompliance = (): EventRecord[] =>
  mockEvents.filter((e) => {
    const a = findAssessmentByEventVersion(e.eventId, e.currentVersionId ?? '');
    return a?.complianceStatus === 'blocked';
  });

/** All UnderReview events - shows the most common dashboard state. */
export const scenarioUnderReview = (): EventRecord[] =>
  mockEvents.filter((e) => e.status === 'UnderReview');

/** All multi-version events (v1 rejected -> v2 pending). */
export const scenarioMultiVersion = (): EventRecord[] =>
  mockEvents.filter((e) => e.currentVersionNumber > 1);

// ---------------------------------------------------------------------------
// Pre-baked "snapshots" for page-level demos
// ---------------------------------------------------------------------------

/** Full snapshot for the AuthorityDashboard: events + decisions + resources + assessments. */
export const dashboardSnapshot = (authorityType: AuthorityType) => {
  const events = mockEvents.filter(
    (e) => e.requiredAuthorities.includes(authorityType)
      && ['Pending', 'UnderReview', 'AmendmentRequested'].includes(e.status),
  );
  return {
    events,
    decisions: mockCurrentDecisionsForUi.filter((d) => events.some((e) => e.eventId === d.eventId)),
    resources: mockResourceRecommendations.filter((r) => events.some((e) => e.eventId === r.eventId)),
    assessments: events
      .map((e) => findAssessmentByEventVersion(e.eventId, e.currentVersionId ?? ''))
      .filter((a): a is NonNullable<typeof a> => Boolean(a)),
  };
};

/** Full snapshot for the AuthorityEventReview page. */
export const eventReviewSnapshot = (eventId: string) => {
  const event = mockEventsById[eventId];
  if (!event) return null;
  return {
    event,
    version: event.currentVersionId,
    assessment: findAssessmentByEventVersion(eventId, event.currentVersionId ?? ''),
    resources: findResourceByEventVersion(eventId, event.currentVersionId ?? ''),
    decisions: findCurrentDecisions(eventId, event.currentVersionId ?? ''),
    auditLogs: findAuditLogsForEvent(eventId),
    controls: findControlsForEvent(eventId),
    publicReports: findPublicReports()
      .filter((r) => r.eventId === eventId),
  };
};

/** Snapshot for the M2 Risk Assessments portfolio page. */
export const riskPortfolioSnapshot = (authorityType: AuthorityType) => {
  const events = mockEvents.filter(
    (e) => e.requiredAuthorities.includes(authorityType)
      && ['Pending', 'UnderReview', 'AmendmentRequested', 'Approved', 'Rejected', 'Withdrawn'].includes(e.status),
  );
  return events.map((e) => ({
    event: e,
    assessment: findAssessmentByEventVersion(e.eventId, e.currentVersionId ?? ''),
    assessmentStatus: findAssessmentByEventVersion(e.eventId, e.currentVersionId ?? '')?.status,
    resources: findResourceByEventVersion(e.eventId, e.currentVersionId ?? ''),
  }));
};

/** Snapshot for the organiser notification feed. */
export const organiserNotificationSnapshot = (organiserId: string = USER_IDS.U_ORG_001) => ({
  notifications: findNotificationsForRecipient(organiserId),
  unreadCount: findNotificationsForRecipient(organiserId).filter((n) => n.readAt === null).length,
  totalReceived: findNotificationsForRecipient(organiserId).length,
});

/** Snapshot for the admin notification feed. */
export const adminNotificationSnapshot = (adminId: string = USER_IDS.U_ADM_001) => ({
  notifications: findNotificationsForRecipient(adminId),
  unreadCount: findNotificationsForRecipient(adminId).filter((n) => n.readAt === null).length,
});

// ---------------------------------------------------------------------------
// Type-safe test/inspection helpers
// ---------------------------------------------------------------------------
export const allMockDataStats = () => ({
  events: mockEvents.length,
  decisions: mockCurrentDecisionsForUi.length,
  resources: mockResourceRecommendations.length,
  auditLogs: mockAuditLogs.length,
  notifications: mockNotifications.length,
  publicReports: mockPublicReports.length,
  organiserProfiles: mockOrganiserProfiles.length,
});

// ---------------------------------------------------------------------------
// STERAS 5-category + per-event application snapshot
// ---------------------------------------------------------------------------

/** Returns the STERAS event category (5-bucket) for a given event. */
export const categoryForEvent = (eventId: string): string | null => {
  const e = mockEventsById[eventId];
  if (!e) return null;
  return labelForCategory(categoryFor(e.eventDetails.type));
};

/** Returns true if the event has any trigger that makes it high-risk. */
export const eventIsHighRisk = (eventId: string): boolean => isHighRisk(eventId);

/**
 * Full application snapshot for the M1 application review page (and for
 * M3 context panel). Aggregates event + organiser + schedule + documents +
 * triggers + assessment + decisions into one object. Use this for the
 * "open application" detail view.
 */
export const fullApplicationSnapshot = (eventId: string) => {
  const event = mockEventsById[eventId];
  if (!event) return null;
  const versionId = event.currentVersionId ?? 'v1';
  const organiser = findOrganiserProfile(event.organizerId);
  const schedule = findScheduleForEvent(eventId, versionId);
  const documentSet = findDocumentSet(eventId, versionId);
  const triggers = triggersForEvent(eventId);
  const assessment = findAssessmentByEventVersion(eventId, versionId);
  const resources = findResourceByEventVersion(eventId, versionId);
  const decisions = findCurrentDecisions(eventId, versionId);
  return {
    event,
    versionId,
    organiser,
    schedule,
    category: labelForCategory(categoryFor(event.eventDetails.type)),
    triggers: triggers.map((t) => ({ trigger: t, label: labelForTrigger(t) })),
    additionalDocs: additionalDocsForEvent(eventId),
    documents: documentSet?.documents ?? [],
    documentStatusCounts: documentStatusCounts(eventId, versionId),
    missingRequiredDocs: missingRequiredDocs(eventId, versionId),
    rejectedDocs: rejectedDocs(eventId, versionId),
    isHighRisk: isHighRisk(eventId),
    assessment,
    resources,
    decisions,
  };
};

/** All events grouped by STERAS category (for M5 reporting + filter UI). */
export const eventsByCategory = (): Record<string, EventRecord[]> => {
  const grouped: Record<string, EventRecord[]> = {};
  mockEvents.forEach((e) => {
    const cat = categoryFor(e.eventDetails.type);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(e);
  });
  return grouped;
};
