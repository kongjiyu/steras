import { firestore } from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { COLLECTIONS, EventControl, EventRecord, Stage2Doc } from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { isActiveControlGeneration } from '../utils/controlLifecycle';
import { counterMatchesStage2 } from '../utils/stage2Counter';

export const withdrawStage2Report = onCall({ region: FUNCTION_REGION }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  return withdrawStage2ReportForUser(request.auth.uid, request.data);
});

export async function withdrawStage2ReportForUser(uid: string, data: { eventId?: string; controlId?: string }, now = Date.now()) {
  const { eventId, controlId } = data ?? {};
  if (typeof eventId !== 'string' || typeof controlId !== 'string' || !eventId || !controlId || /\//.test(eventId + controlId)) throw new HttpsError('invalid-argument', 'Valid event and control IDs are required.');
  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const controlRef = eventRef.collection(COLLECTIONS.EVENT_CONTROLS).doc(controlId);
  const stageRef = controlRef.collection(COLLECTIONS.STAGE2_DOCS).doc(`${controlId}-s2`);
  const counters = controlRef.collection(COLLECTIONS.STAGE2_REPORTS);
  const publicRef = db.collection(COLLECTIONS.PUBLIC_EVENT_CONTROLS).doc(eventId).collection(COLLECTIONS.PUBLIC_EVENT_CONTROL_ITEMS).doc(`${controlId}-stage2`);
  return db.runTransaction(async tx => {
    const [user, event, control, stage, reports, projection] = await Promise.all([
      tx.get(db.collection(COLLECTIONS.USERS).doc(uid)), tx.get(eventRef), tx.get(controlRef), tx.get(stageRef), tx.get(counters), tx.get(publicRef),
    ]);
    if (user.data()?.role !== 'public') throw new HttpsError('permission-denied', 'Only public viewer accounts can withdraw their reports.');
    if (!event.exists || !control.exists || !stage.exists || !projection.exists || !stage.data()?.published
      || !isActiveControlGeneration(event.data() as EventRecord, control.data() as EventControl, eventId)
      || projection.data()?.versionId !== event.data()?.currentVersionId) throw new HttpsError('failed-precondition', 'This image is no longer current and published.');
    const active = reports.docs.filter(item => counterMatchesStage2(item.data(), stage.data() as Stage2Doc));
    const own = active.find(item => item.id === uid);
    if (!own) return { withdrawn: true, alreadyWithdrawn: true };
    const ticketId = own.data().ticketId as string;
    const reportRef = db.collection(COLLECTIONS.PUBLIC_REPORTS).doc(ticketId);
    const incidentId = `m3_${ticketId}`.slice(0, 128);
    const incidentRef = db.collection(COLLECTIONS.INCIDENTS).doc(incidentId);
    const [report, incident] = await Promise.all([tx.get(reportRef), tx.get(incidentRef)]);
    if (!report.exists || report.data()?.reporterUid !== uid) throw new HttpsError('failed-precondition', 'The report could not be verified.');
    tx.update(reportRef, { withdrawnAt: now, updatedAt: now });
    tx.delete(own.ref);
    const remaining = active.find(item => item.id !== uid);
    tx.update(stageRef, { m4TicketId: remaining?.data().ticketId ?? FieldValue.delete(), reportedAt: remaining?.data().reportedAt ?? FieldValue.delete() });
    tx.update(publicRef, { reported: Boolean(remaining) });
    if (incident.exists) {
      tx.update(incidentRef, { reportWithdrawnAt: now, updatedAt: now });
      const historyId = `${incidentId}_withdrawn_${now}`;
      tx.create(incidentRef.collection('history').doc(historyId), { historyId, incidentId, action: 'report_withdrawn', actorUid: uid, actorRole: 'public', timestamp: now, summary: 'Reporter withdrew their report. Investigation history is retained.', evidence: [] });
    }
    const auditId = `${controlId}_report_withdrawn_${uid}_${now}`;
    tx.create(eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId), { id: auditId, eventId, versionId: event.data()?.currentVersionId, action: 'stage2_report_withdrawn', actorId: uid, actorRole: 'public', timestamp: now, metadata: { controlId, ticketId } });
    return { withdrawn: true, alreadyWithdrawn: false };
  });
}
