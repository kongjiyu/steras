import { firestore } from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { COLLECTIONS, type EventRecord, type EventVersion, type PublicReport, type UserProfile } from '@shared/types';
import { M4_SCHEMA_VERSION, type M4IncidentHistoryEntry, type M4IncidentRecord } from '@shared/m4';
import { FUNCTION_REGION } from '../config/runtime';
import { assessIncident, assertReportableEvent } from '../http/m4Incidents';

/** Bridges the existing M3 public Stage-2 report into the real M4 queue. */
export const onPublicReportCreated = onDocumentCreated(
  { document: `${COLLECTIONS.PUBLIC_REPORTS}/{ticketId}`, region: FUNCTION_REGION },
  async (event) => {
    const report = event.data?.data() as PublicReport | undefined;
    if (!report) return;
    const db = firestore();
    const [eventSnap, versionSnap, reporterSnap] = await Promise.all([
      db.collection(COLLECTIONS.EVENTS).doc(report.eventId).get(),
      db.collection(COLLECTIONS.EVENTS).doc(report.eventId).collection(COLLECTIONS.VERSIONS).doc(report.versionId).get(),
      db.collection(COLLECTIONS.USERS).doc(report.reporterUid).get(),
    ]);
    if (!eventSnap.exists || !versionSnap.exists || !reporterSnap.exists) throw new Error('M4 bridge source event, immutable version, or reporter is missing.');
    const source = eventSnap.data() as EventRecord;
    const version = versionSnap.data() as EventVersion;
    const reporter = reporterSnap.data() as UserProfile;
    if (version.eventId !== report.eventId || version.versionId !== report.versionId) throw new Error('M4 bridge version binding is invalid.');
    const immutableSource = { ...source, eventDetails: version.eventDetails };
    try { assertReportableEvent(immutableSource, report.createdAt); }
    catch (error) { console.warn('Skipping out-of-window M3 public report bridge.', { ticketId: report.ticketId, eventId: report.eventId, reason: error instanceof Error ? error.message : 'invalid_event_window' }); return; }
    const incidentId = `m3_${report.ticketId}`.slice(0, 128);
    const now = report.createdAt;
    const aiAssessment = await assessIncident({
      category: 'event_control_discrepancy', description: report.description,
      location: version.eventDetails.venueName, occurredAt: now, evidence: [],
    }, immutableSource);
    const record: M4IncidentRecord = {
      schemaVersion: M4_SCHEMA_VERSION, incidentId, eventId: report.eventId,
      eventVersionId: report.versionId,
      venueId: version.eventDetails.venueId ?? `custom:${report.eventId}`,
      eventType: version.eventDetails.type, eventName: version.eventDetails.name, organizerId: source.organizerId,
      reporterUid: report.reporterUid, reporterRole: reporter.role, category: 'event_control_discrepancy',
      incidentType: 'event_control_discrepancy', description: report.description,
      location: version.eventDetails.venueName, occurredAt: now, evidence: [],
      aiAssessment,
      ...(aiAssessment.status === 'success' ? { severity: aiAssessment.severity, immediateActionRequired: aiAssessment.immediateActionRequired } : {}),
      status: aiAssessment.status === 'success' ? 'submitted' : 'manual_review_required', linkedControlId: report.controlId, linkedStage2DocId: report.docId,
      publicReportTicketId: report.ticketId, assessmentEligible: false, synthetic: false,
      date: now, createdAt: now, updatedAt: now,
    };
    const incidentRef = db.collection(COLLECTIONS.INCIDENTS).doc(incidentId);
    await db.runTransaction(async (tx) => {
      if ((await tx.get(incidentRef)).exists) return;
      const history: M4IncidentHistoryEntry = {
        historyId: `${incidentId}_submitted`, incidentId, action: 'incident_submitted', actorUid: report.reporterUid,
        actorRole: reporter.role, timestamp: now, summary: 'Event Control discrepancy report submitted.', evidence: [],
      };
      tx.create(incidentRef, record);
      tx.create(incidentRef.collection('history').doc(history.historyId), history);
    });
  },
);
