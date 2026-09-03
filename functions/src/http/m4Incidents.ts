import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { firestore } from 'firebase-admin';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { COLLECTIONS, type EventRecord, type OfficerProfile, type PublicReport, type UserProfile } from '@shared/types';
import {
  INCIDENT_CATEGORIES, M4_AI_PROMPT_VERSION, M4_EVIDENCE_MAX_BYTES, M4_SCHEMA_VERSION,
  type M4AIAssessment, type M4AuthorityDirectoryEntry, type M4EvidenceRef,
  type M4IncidentCategory, type M4IncidentHistoryEntry, type M4IncidentRecord, type M4IncidentSeverity,
} from '@shared/m4';
import { FUNCTION_REGION } from '../config/runtime';
import { DEFAULT_MINIMAX_BASE_URL, DEFAULT_MINIMAX_MODEL } from '../config/minimax';
import { MINIMAX_API_KEY } from '../config/secrets';
import { createNotification, resolveAuthUid, type NotificationInput } from '../utils/notifications';

const DAY = 86_400_000;
const HISTORY = 'history';
const DIRECTORY = 'authority_directory';
const ALLOWED_EVIDENCE = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export const submitIncident = onCall({ region: FUNCTION_REGION, timeoutSeconds: 60, memory: '512MiB', secrets: [MINIMAX_API_KEY] }, async (request) => {
  const { uid, profile } = await requireProfile(request.auth?.uid);
  const input = validateSubmission(request.data);
  const db = firestore();
  const eventSnap = await db.collection(COLLECTIONS.EVENTS).doc(input.eventId).get();
  if (!eventSnap.exists) throw new HttpsError('not-found', 'Event not found.');
  const event = eventSnap.data() as EventRecord;
  assertReportableEvent(event, Date.now());
  if (input.occurredAt < event.eventDetails.startDatetime || input.occurredAt > event.eventDetails.endDatetime) {
    throw new HttpsError('invalid-argument', 'Occurrence time must fall within the selected event.');
  }
  if (input.linkedControlId) {
    const controlRef = db.collection(COLLECTIONS.EVENTS).doc(input.eventId).collection(COLLECTIONS.EVENT_CONTROLS).doc(input.linkedControlId);
    const stage2Id = input.linkedStage2DocId ?? `${input.linkedControlId}-s2`;
    const [control, stage2] = await Promise.all([controlRef.get(), controlRef.collection(COLLECTIONS.STAGE2_DOCS).doc(stage2Id).get()]);
    if (!control.exists || !stage2.exists || stage2.data()?.published !== true) throw new HttpsError('failed-precondition', 'Linked Event Control evidence is not published.');
  }
  const incidentId = createHash('sha256').update(`${uid}:${input.idempotencyKey}`).digest('hex').slice(0, 28);
  const ref = db.collection(COLLECTIONS.INCIDENTS).doc(incidentId);
  const capturedVersionId = event.currentVersionId ?? `v${event.currentVersionNumber}`;
  const existing = await ref.get();
  if (existing.exists) {
    const prior = existing.data() as M4IncidentRecord;
    if (!sameSubmission(prior, uid, input)) throw new HttpsError('already-exists', 'Idempotency key was already used for another report.');
    await reconcileSubmitNotification(prior);
    return { incidentId, status: prior.status, aiAssessment: prior.aiAssessment };
  }
  const evidence = await validateEvidence(uid, input.evidencePaths);
  const authoritySnapshot = await db.collection(DIRECTORY).where('active', '==', true).limit(100).get();
  const aiAssessment = await assessIncident({ ...input, evidence }, event);
  const recommendedAuthorityIds = rankRecommendedAuthorities(
    authoritySnapshot.docs.map((doc) => doc.data() as M4AuthorityDirectoryEntry),
    input.category,
    aiAssessment,
    event,
  ).slice(0, 5).map((entry) => entry.authorityId);
  const now = Date.now();
  const record: M4IncidentRecord = {
    schemaVersion: M4_SCHEMA_VERSION, incidentId, eventId: input.eventId,
    eventVersionId: capturedVersionId,
    venueId: event.eventDetails.venueId ?? `custom:${event.eventId}`,
    eventType: event.eventDetails.type, eventName: event.eventDetails.name, organizerId: event.organizerId,
    reporterUid: uid, reporterRole: profile.role, category: input.category, incidentType: input.category,
    description: input.description, location: input.location, occurredAt: input.occurredAt, evidence,
    aiAssessment, ...(aiAssessment.status === 'success' ? { severity: aiAssessment.severity, immediateActionRequired: aiAssessment.immediateActionRequired } : {}),
    status: aiAssessment.status === 'success' ? 'submitted' : 'manual_review_required',
    ...(input.linkedControlId ? { linkedControlId: input.linkedControlId } : {}),
    ...(input.linkedStage2DocId ? { linkedStage2DocId: input.linkedStage2DocId } : {}),
    recommendedAuthorityIds,
    assessmentEligible: false, synthetic: false, date: input.occurredAt, createdAt: now, updatedAt: now,
  };
  const organizerUid = await resolveAuthUid(event.organizerId);
  const submitNotification = organizerUid ? incidentNotification({ recipientUid: organizerUid, eventId: event.eventId, versionId: record.eventVersionId, type: 'incident_reported', title: 'New incident report', message: `${event.eventDetails.name}: ${aiAssessment.status === 'success' && aiAssessment.immediateActionRequired ? 'immediate action recommended' : 'organizer review required'}.`, sourceActionId: incidentId, notificationId: `${incidentId}_organizer` }) : undefined;
  await db.runTransaction(async (tx) => {
    const [existing, currentEventSnap] = await Promise.all([tx.get(ref), tx.get(db.collection(COLLECTIONS.EVENTS).doc(input.eventId))]);
    if (existing.exists) {
      const prior = existing.data() as M4IncidentRecord;
      if (!sameSubmission(prior, uid, input)) {
        throw new HttpsError('already-exists', 'Idempotency key was already used for another report.');
      }
      return;
    }
    if (!currentEventSnap.exists) throw new HttpsError('failed-precondition', 'Event is no longer available.');
    assertSubmissionGeneration(currentEventSnap.data() as EventRecord, capturedVersionId, input, Date.now());
    if (input.linkedControlId) {
      const controlRef = db.collection(COLLECTIONS.EVENTS).doc(input.eventId)
        .collection(COLLECTIONS.EVENT_CONTROLS).doc(input.linkedControlId);
      const stage2Id = input.linkedStage2DocId ?? `${input.linkedControlId}-s2`;
      const [currentControl, currentStage2] = await Promise.all([
        tx.get(controlRef),
        tx.get(controlRef.collection(COLLECTIONS.STAGE2_DOCS).doc(stage2Id)),
      ]);
      if (!currentControl.exists || !currentStage2.exists || currentStage2.data()?.published !== true) {
        throw new HttpsError('failed-precondition', 'Linked Event Control evidence is no longer published.');
      }
    }
    tx.create(ref, record);
    appendHistory(tx, ref, incidentId, uid, profile.role, 'incident_submitted', 'Incident report submitted.', evidence, now);
    if (submitNotification) queueIncidentNotification(tx, submitNotification, now);
  });
  if (submitNotification) await deliverIncidentNotification(submitNotification.notificationId!);
  return { incidentId, status: record.status, aiAssessment };
});

export const listIncidents = onCall({ region: FUNCTION_REGION }, async (request) => {
  const { uid, profile } = await requireProfile(request.auth?.uid);
  const db = firestore();
  let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.INCIDENTS).where('schemaVersion', '==', M4_SCHEMA_VERSION);
  if (profile.role === 'organizer') query = query.where('organizerId', '==', uid);
  else if (profile.role === 'authority') query = query.where('assignedAuthorityOfficerUid', '==', uid);
  else if (profile.role !== 'admin') query = query.where('reporterUid', '==', uid);
  const snap = await query.limit(100).get();
  const records = snap.docs.map((doc) => doc.data() as M4IncidentRecord).sort((a, b) => b.createdAt - a.createdAt);
  const histories = profile.role === 'public' ? new Map<string, M4IncidentHistoryEntry[]>() : new Map(await Promise.all(records.map(async (record) => {
    const history = await db.collection(COLLECTIONS.INCIDENTS).doc(record.incidentId).collection(HISTORY).orderBy('timestamp').limit(200).get();
    return [record.incidentId, history.docs.map((doc) => doc.data() as M4IncidentHistoryEntry)] as const;
  })));
  const reportable = profile.role === 'public'
    ? await db.collection(COLLECTIONS.PUBLIC_EVENTS).limit(100).get()
    : profile.role === 'organizer'
      ? await db.collection(COLLECTIONS.EVENTS).where('organizerId', '==', uid).where('status', '==', 'Approved').limit(100).get()
      : undefined;
  const events = reportable?.docs.map((doc) => {
    const value = doc.data() as EventRecord & { startDatetime?: number; endDatetime?: number; eventName?: string };
    const details = value.eventDetails;
    return details
      ? { eventId: doc.id, name: details.name, startDatetime: details.startDatetime, endDatetime: details.endDatetime }
      : { eventId: doc.id, name: value.eventName ?? doc.id, startDatetime: value.startDatetime ?? 0, endDatetime: value.endDatetime ?? 0 };
  }).filter((event) => event.startDatetime <= Date.now() && event.endDatetime >= Date.now() - 7 * DAY) ?? [];
  return { incidents: records.map((record) => ({ ...safeIncident(record, profile.role, uid), ...(profile.role === 'public' ? {} : { history: histories.get(record.incidentId) ?? [] }) })), reportableEvents: events };
});

export const manageIncident = onCall({ region: FUNCTION_REGION }, async (request) => {
  const { uid, profile } = await requireProfile(request.auth?.uid);
  const input = request.data as Record<string, unknown>;
  const incidentId = identifier(input.incidentId, 'incidentId');
  const action = text(input.action, 'action', 3, 40);
  const idempotencyKey = identifier(input.idempotencyKey, 'idempotencyKey');
  const now = Date.now();
  const db = firestore();
  const ref = db.collection(COLLECTIONS.INCIDENTS).doc(incidentId);
  const actionEvidencePaths = Array.isArray(input.evidencePaths) ? input.evidencePaths.map(String) : [];
  const requestHash = actionRequestHash(action, input, actionEvidencePaths);
  const actionEvidence = await validateEvidence(uid, actionEvidencePaths);
  let notify: { uid?: string; record: M4IncidentRecord; summary: string } | undefined;
  let replayed = false;
  const historyId = createHash('sha256').update(`${incidentId}:${action}:${uid}:${idempotencyKey}`).digest('hex').slice(0, 24);
  const historyRef = ref.collection(HISTORY).doc(historyId);
  const outboxId = `${incidentId}_${action}_${idempotencyKey}`;
  await db.runTransaction(async (tx) => {
    const [snap, historySnap] = await Promise.all([tx.get(ref), tx.get(historyRef)]);
    if (!snap.exists) throw new HttpsError('not-found', 'Incident not found.');
    if (historySnap.exists) {
      if ((historySnap.data() as M4IncidentHistoryEntry).requestHash !== requestHash) throw new HttpsError('already-exists', 'Idempotency key was already used for another incident action.');
      replayed = true;
      return;
    }
    const record = snap.data() as M4IncidentRecord;
    const currentEventSnap = await tx.get(db.collection(COLLECTIONS.EVENTS).doc(record.eventId));
    const currentEvent = currentEventSnap.data() as EventRecord | undefined;
    if (!currentEventSnap.exists || currentEvent?.status !== 'Approved'
      || (currentEvent.currentVersionId ?? `v${currentEvent.currentVersionNumber}`) !== record.eventVersionId
      || record.activityClosed === true) {
      throw new HttpsError('failed-precondition', 'Incident activity is closed because the event is no longer active.');
    }
    if (record.status === 'resolved') throw new HttpsError('failed-precondition', 'Resolved incidents are immutable.');
    const evidence = actionEvidence;
    let patch: Partial<M4IncidentRecord> = { updatedAt: now };
    let summary = '';
    if (action === 'assign_internal') {
      if (!canPerformIncidentAction(record, profile, uid, action)) deny();
      const team = text(input.team, 'team', 2, 100); const note = text(input.note, 'note', 10, 1000);
      patch = { ...patch, assignedInternalTeam: team, status: 'responding' }; summary = `Assigned ${team}: ${note}`;
    } else if (action === 'record_response') {
      if (!canPerformIncidentAction(record, profile, uid, action)) deny();
      summary = text(input.note, 'note', 10, 2000); patch = { ...patch, status: 'awaiting_resolution' };
    } else if (action === 'refer_authority') {
      if (!canPerformIncidentAction(record, profile, uid, action)) deny();
      const authorityId = identifier(input.authorityId, 'authorityId');
      const directory = await tx.get(db.collection(DIRECTORY).doc(authorityId));
      const entry = directory.data() as M4AuthorityDirectoryEntry | undefined;
      if (!entry?.active || !entry.serviceCategories.includes(record.category)) throw new HttpsError('failed-precondition', 'Authority is not active for this incident category.');
      patch = { ...patch, referredAuthorityId: entry.authorityId, referredAuthorityType: entry.authorityType, status: 'authority_investigation' };
      summary = `Referred to ${entry.name}: ${text(input.note, 'note', 10, 1000)}`;
      const officerRegistry = await tx.get(db.collection(COLLECTIONS.OFFICERS)
        .where('active', '==', true).where('authorityType', '==', entry.authorityType).limit(100));
      const officerUsers = officerRegistry.empty ? [] : await tx.getAll(
        ...officerRegistry.docs.map((document) => db.collection(COLLECTIONS.USERS).doc(document.id)),
      );
      const officerUid = officerRegistry.docs.map((document, index) => ({ officer: document.data() as OfficerProfile, user: officerUsers[index]?.data() as UserProfile | undefined }))
        .filter(({ officer, user }, index) => officer.uid === officerRegistry.docs[index].id && user?.uid === officer.uid
          && user.role === 'authority' && user.authorityType === entry.authorityType)
        .sort((a, b) => a.officer.workloadCount - b.officer.workloadCount || (a.officer.lastAssignedAt ?? 0) - (b.officer.lastAssignedAt ?? 0) || a.officer.uid.localeCompare(b.officer.uid))[0]?.officer.uid;
      if (!officerUid) throw new HttpsError('failed-precondition', 'No active authority officer is available for this referral.');
      patch = { ...patch, assignedAuthorityOfficerUid: officerUid };
      notify = { uid: officerUid, record, summary };
    } else if (action === 'record_investigation') {
      if (!canPerformIncidentAction(record, profile, uid, action)) deny();
      summary = text(input.note, 'note', 10, 2000); patch = { ...patch, status: 'awaiting_resolution' };
      notify = { uid: await resolveAuthUid(record.organizerId) ?? undefined, record, summary: 'Authority investigation finding is ready.' };
    } else if (action === 'resolve') {
      if (!canPerformIncidentAction(record, profile, uid, action)) deny();
      const resolution = text(input.resolution, 'resolution', 10, 2000);
      const severity = record.severity ?? severityValue(input.manualSeverity);
      if (record.linkedControlId && input.discrepancyOutcome !== 'confirmed_true' && input.discrepancyOutcome !== 'dismissed_fake') throw new HttpsError('invalid-argument', 'Event Control discrepancy outcome is required.');
      assertResolutionReady(record);
      const discrepancyOutcome = input.discrepancyOutcome as 'confirmed_true' | 'dismissed_fake' | undefined;
      let publicReportRef: FirebaseFirestore.DocumentReference | undefined;
      if (record.publicReportTicketId) {
        publicReportRef = db.collection(COLLECTIONS.PUBLIC_REPORTS).doc(record.publicReportTicketId);
        const publicReport = (await tx.get(publicReportRef)).data() as PublicReport | undefined;
        if (!publicReport || publicReport.ticketId !== record.publicReportTicketId
          || publicReport.eventId !== record.eventId || publicReport.versionId !== record.eventVersionId
          || publicReport.controlId !== record.linkedControlId || publicReport.docId !== record.linkedStage2DocId
          || (publicReport.outcome !== undefined && publicReport.outcome !== 'under_review')) {
          throw new HttpsError('failed-precondition', 'The linked Event Control report is missing, stale, or already resolved.');
        }
      }
      patch = { ...patch, severity, status: 'resolved', finalResolution: resolution,
        assessmentEligible: record.linkedControlId ? discrepancyOutcome === 'confirmed_true' : true, resolvedAt: now,
        ...(record.linkedControlId ? { discrepancyOutcome: discrepancyOutcome! } : {}) };
      summary = `Final resolution: ${resolution}`;
      if (publicReportRef) tx.update(publicReportRef, { outcome: input.discrepancyOutcome, outcomeSetAt: now, outcomeSetBy: uid, updatedAt: now });
      notify = { uid: record.reporterUid, record, summary: 'Your incident report has been resolved.' };
    } else throw new HttpsError('invalid-argument', 'Unsupported incident action.');
    tx.update(ref, patch);
    appendHistory(tx, ref, incidentId, uid, profile.role, action, summary, evidence, now, { historyId, idempotencyKey, requestHash });
    if (notify?.uid) queueIncidentNotification(tx, incidentNotification({ recipientUid: notify.uid, eventId: notify.record.eventId, versionId: notify.record.eventVersionId, type: 'incident_updated', title: 'Incident update', message: notify.summary, sourceActionId: outboxId, notificationId: `${outboxId}_${notify.uid}` }), now, outboxId);
  });
  await deliverIncidentNotification(outboxId);
  return { incidentId, action, updatedAt: now, replayed };
});

export const listAuthorityDirectory = onCall({ region: FUNCTION_REGION }, async (request) => {
  const { profile } = await requireProfile(request.auth?.uid);
  if (profile.role === 'public') return { authorities: [] };
  const snap = await firestore().collection(DIRECTORY).where('active', '==', true).limit(100).get();
  return { authorities: snap.docs.map((doc) => doc.data()) };
});

export const getIncidentEvidenceDownloadUrl = onCall({ region: FUNCTION_REGION }, async (request) => {
  const { uid, profile } = await requireProfile(request.auth?.uid);
  const value = request.data as Record<string, unknown>;
  const incidentId = identifier(value.incidentId, 'incidentId');
  const path = text(value.path, 'path', 10, 400);
  const db = firestore();
  const incidentSnap = await db.collection(COLLECTIONS.INCIDENTS).doc(incidentId).get();
  if (!incidentSnap.exists) throw new HttpsError('not-found', 'Incident not found.');
  const incident = incidentSnap.data() as M4IncidentRecord;
  const canReview = profile.role === 'admin'
    || (profile.role === 'organizer' && incident.organizerId === uid)
    || (profile.role === 'authority' && incident.assignedAuthorityOfficerUid === uid);
  const canViewOwnReport = profile.role === 'public' && incident.reporterUid === uid;
  if (!canReview && !canViewOwnReport) deny();
  let allowed = incident.evidence.some((item) => item.path === path);
  if (!allowed && canReview) {
    const bounded = await db.collection(COLLECTIONS.INCIDENTS).doc(incidentId).collection(HISTORY).limit(200).get();
    allowed = bounded.docs.some((doc) => (doc.data() as M4IncidentHistoryEntry).evidence.some((item) => item.path === path));
  }
  if (!allowed) throw new HttpsError('permission-denied', 'Evidence does not belong to this incident.');
  const [url] = await getStorage().bucket().file(path).getSignedUrl({ action: 'read', expires: Date.now() + 10 * 60_000 });
  return { url, expiresAt: Date.now() + 10 * 60_000 };
});

export const saveAuthorityDirectoryEntry = onCall({ region: FUNCTION_REGION }, async (request) => {
  const { profile } = await requireProfile(request.auth?.uid);
  if (profile.role !== 'admin') deny();
  const value = request.data as Partial<M4AuthorityDirectoryEntry>;
  const authorityId = identifier(value.authorityId, 'authorityId');
  if (!['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'].includes(String(value.authorityType))) throw new HttpsError('invalid-argument', 'Invalid authority type.');
  if (!Array.isArray(value.serviceCategories) || !value.serviceCategories.every((item) => INCIDENT_CATEGORIES.includes(item))) throw new HttpsError('invalid-argument', 'Invalid service categories.');
  const now = Date.now();
  const ref = firestore().collection(DIRECTORY).doc(authorityId); const prior = await ref.get();
  const entry: M4AuthorityDirectoryEntry = { authorityId, name: text(value.name, 'name', 2, 120), authorityType: value.authorityType!, serviceCategories: value.serviceCategories,
    coverageAreas: arrayText(value.coverageAreas, 'coverageAreas'), contactName: text(value.contactName, 'contactName', 2, 120), contactPhone: text(value.contactPhone, 'contactPhone', 5, 40),
    ...(value.contactEmail ? { contactEmail: text(value.contactEmail, 'contactEmail', 5, 200) } : {}), active: value.active !== false, createdAt: prior.exists ? (prior.data()?.createdAt ?? now) : now, updatedAt: now };
  await ref.set(entry); return entry;
});

async function requireProfile(uid?: string) { if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.'); const snap = await firestore().collection(COLLECTIONS.USERS).doc(uid).get(); const profile = snap.data() as UserProfile | undefined; if (!profile) throw new HttpsError('permission-denied', 'Registered profile required.'); return { uid, profile }; }
export function validateSubmission(value: unknown) { const v = value as Record<string, unknown>; const category = String(v?.category ?? '') as M4IncidentCategory; if (!INCIDENT_CATEGORIES.includes(category)) throw new HttpsError('invalid-argument', 'Invalid incident category.'); const occurredAt = Number(v.occurredAt); if (!Number.isFinite(occurredAt) || occurredAt <= 0 || occurredAt > Date.now() + 300_000) throw new HttpsError('invalid-argument', 'Invalid occurrence time.'); return { eventId: identifier(v.eventId, 'eventId'), category, description: text(v.description, 'description', 20, 2000), location: text(v.location, 'location', 3, 300), occurredAt, idempotencyKey: identifier(v.idempotencyKey, 'idempotencyKey'), evidencePaths: Array.isArray(v.evidencePaths) ? v.evidencePaths.map(String) : [], linkedControlId: v.linkedControlId ? identifier(v.linkedControlId, 'linkedControlId') : undefined, linkedStage2DocId: v.linkedStage2DocId ? identifier(v.linkedStage2DocId, 'linkedStage2DocId') : undefined }; }
export function assertReportableEvent(event: EventRecord, now: number) { if (event.status !== 'Approved' || event.eventDetails.startDatetime > now || event.eventDetails.endDatetime < now - 7 * DAY) throw new HttpsError('failed-precondition', 'Incidents may only be reported for ongoing events or events completed within seven days.'); }
export function assertSubmissionGeneration(event: EventRecord, capturedVersionId: string, input: Pick<ReturnType<typeof validateSubmission>, 'occurredAt'>, now: number) { assertReportableEvent(event, now); if ((event.currentVersionId ?? `v${event.currentVersionNumber}`) !== capturedVersionId) throw new HttpsError('aborted', 'Event generation changed while the incident was being assessed.'); if (input.occurredAt < event.eventDetails.startDatetime || input.occurredAt > event.eventDetails.endDatetime) throw new HttpsError('failed-precondition', 'Occurrence is no longer valid for the current event generation.'); }
async function validateEvidence(uid: string, paths: string[]): Promise<M4EvidenceRef[]> { if (paths.length > 10 || new Set(paths).size !== paths.length) throw new HttpsError('invalid-argument', 'Up to 10 unique evidence files are allowed.'); return Promise.all(paths.map(async (path) => { assertEvidencePath(uid, path); const [metadata] = await getStorage().bucket().file(path).getMetadata(); const size = Number(metadata.size); const mimeType = metadata.contentType ?? ''; if (!Number.isFinite(size) || size <= 0 || size > M4_EVIDENCE_MAX_BYTES || !ALLOWED_EVIDENCE.has(mimeType)) throw new HttpsError('failed-precondition', 'Evidence metadata is invalid.'); return { path, name: path.split('/').pop()!, mimeType, size, uploadedBy: uid, uploadedAt: Date.parse(metadata.timeCreated ?? '') || Date.now() }; })); }
export async function assessIncident(input: Pick<ReturnType<typeof validateSubmission>, 'category' | 'description' | 'location' | 'occurredAt'> & { evidence: M4EvidenceRef[] }, event: EventRecord): Promise<M4AIAssessment> { const now = Date.now(); const key = process.env.MINIMAX_API_KEY ?? ''; if (!key) return { status: 'unavailable', promptVersion: M4_AI_PROMPT_VERSION, reason: 'MiniMax is not configured.', assessedAt: now }; try { const client = new Anthropic({ apiKey: key, baseURL: process.env.MINIMAX_BASE_URL ?? DEFAULT_MINIMAX_BASE_URL, timeout: 20_000, maxRetries: 0 }); const response = await client.messages.create({ model: process.env.MINIMAX_MODEL ?? DEFAULT_MINIMAX_MODEL, max_tokens: 300, temperature: 0, system: 'Return strict JSON only: {"severity":"low|medium|high","immediateActionRequired":boolean,"rationale":string}. Do not invent facts.', messages: [{ role: 'user', content: JSON.stringify(buildIncidentAiPayload(input, event)) }] }); const raw = response.content.filter((block): block is Anthropic.TextBlock => block.type === 'text').map((block) => block.text).join(''); const parsed = parseIncidentAiResponse(raw); return { status: 'success', model: process.env.MINIMAX_MODEL ?? DEFAULT_MINIMAX_MODEL, promptVersion: M4_AI_PROMPT_VERSION, ...parsed, assessedAt: now }; } catch (error) { return { status: 'invalid', promptVersion: M4_AI_PROMPT_VERSION, reason: error instanceof Error ? error.message.slice(0, 300) : 'Invalid AI response.', assessedAt: now }; } }

export function parseIncidentAiResponse(raw: string): Pick<Extract<M4AIAssessment, { status: 'success' }>, 'severity' | 'immediateActionRequired' | 'rationale'> {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid response object.');
  const value = parsed as Record<string, unknown>;
  const allowed = new Set(['severity', 'immediateActionRequired', 'rationale']);
  if (Object.keys(value).some((key) => !allowed.has(key))
    || !['low', 'medium', 'high'].includes(String(value.severity))
    || typeof value.immediateActionRequired !== 'boolean'
    || typeof value.rationale !== 'string') throw new Error('Invalid response schema.');
  const rationale = value.rationale.trim();
  if (rationale.length < 10 || rationale.length > 1000) throw new Error('Invalid response rationale.');
  return { severity: value.severity as M4IncidentSeverity, immediateActionRequired: value.immediateActionRequired, rationale };
}
function appendHistory(tx: FirebaseFirestore.Transaction, ref: FirebaseFirestore.DocumentReference, incidentId: string, actorUid: string, actorRole: UserProfile['role'] | 'system', action: string, summary: string, evidence: M4EvidenceRef[], timestamp: number, dedupe?: { historyId: string; idempotencyKey: string; requestHash: string }) { const historyId = dedupe?.historyId ?? createHash('sha256').update(`${incidentId}:${action}:${actorUid}:${timestamp}`).digest('hex').slice(0, 24); const entry: M4IncidentHistoryEntry = { historyId, incidentId, action, actorUid, actorRole, timestamp, summary, evidence, ...(dedupe ? { idempotencyKey: dedupe.idempotencyKey, requestHash: dedupe.requestHash } : {}) }; tx.create(ref.collection(HISTORY).doc(historyId), entry); }
export function safeIncident(record: M4IncidentRecord, role: UserProfile['role'], uid: string) {
  if (role !== 'public' && !(role === 'organizer' && record.organizerId !== uid)) return record;
  const {
    schemaVersion, incidentId, eventId, eventVersionId, eventType, eventName, reporterUid, reporterRole,
    category, incidentType, description, location, occurredAt, evidence, aiAssessment, severity,
    immediateActionRequired, status, linkedControlId, linkedStage2DocId, publicReportTicketId,
    finalResolution, discrepancyOutcome, assessmentEligible, synthetic, date, createdAt, updatedAt, resolvedAt,
    activityClosed, closureReason, closedAt,
  } = record;
  return {
    schemaVersion, incidentId, eventId, eventVersionId, eventType, eventName, reporterUid, reporterRole,
    category, incidentType, description, location, occurredAt, evidence, aiAssessment, status,
    assessmentEligible, synthetic, date, createdAt, updatedAt,
    ...(severity ? { severity } : {}),
    ...(immediateActionRequired !== undefined ? { immediateActionRequired } : {}),
    ...(linkedControlId ? { linkedControlId } : {}),
    ...(linkedStage2DocId ? { linkedStage2DocId } : {}),
    ...(publicReportTicketId ? { publicReportTicketId } : {}),
    ...(finalResolution ? { finalResolution } : {}),
    ...(discrepancyOutcome ? { discrepancyOutcome } : {}),
    ...(resolvedAt ? { resolvedAt } : {}),
    ...(activityClosed ? { activityClosed, closureReason, closedAt } : {}),
  };
}
function identifier(value: unknown, field: string) { const result = String(value ?? '').trim(); if (!/^[A-Za-z0-9_-]{8,128}$/.test(result)) throw new HttpsError('invalid-argument', `${field} is invalid.`); return result; }
function text(value: unknown, field: string, min: number, max: number) { const result = String(value ?? '').trim(); if (result.length < min || result.length > max) throw new HttpsError('invalid-argument', `${field} must be ${min}-${max} characters.`); return result; }
function arrayText(value: unknown, field: string) { if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw new HttpsError('invalid-argument', `${field} is invalid.`); return value.map((item) => text(item, field, 2, 100)); }
function severityValue(value: unknown): M4IncidentSeverity { if (!['low', 'medium', 'high'].includes(String(value))) throw new HttpsError('invalid-argument', 'Manual severity is required because AI assessment is unavailable.'); return value as M4IncidentSeverity; }
export function sameSubmission(record: M4IncidentRecord, uid: string, input: ReturnType<typeof validateSubmission>) {
  return record.reporterUid === uid && record.eventId === input.eventId && record.category === input.category
    && record.description === input.description && record.location === input.location && record.occurredAt === input.occurredAt
    && record.linkedControlId === input.linkedControlId && record.linkedStage2DocId === input.linkedStage2DocId
    && record.evidence.map((item) => item.path).join('\n') === input.evidencePaths.join('\n');
}
export function assertEvidencePath(uid: string, path: string) { if (!new RegExp(`^incident_evidence/${uid}/[A-Za-z0-9._-]{1,200}$`).test(path)) throw new HttpsError('invalid-argument', 'Invalid evidence path.'); }
export function canPerformIncidentAction(record: M4IncidentRecord, profile: UserProfile, uid: string, action: string) {
  if (record.activityClosed === true) return false;
  const organizer = profile.role === 'organizer' && record.organizerId === uid;
  if (action === 'assign_internal' || action === 'refer_authority') return organizer && ['submitted', 'manual_review_required', 'organizer_review'].includes(record.status);
  if (action === 'record_response') return organizer && !record.referredAuthorityId && ['submitted', 'manual_review_required', 'organizer_review', 'responding'].includes(record.status);
  if (action === 'resolve') return organizer && record.status === 'awaiting_resolution';
  if (action === 'record_investigation') return record.status === 'authority_investigation' && profile.role === 'authority' && profile.authorityType === record.referredAuthorityType && record.assignedAuthorityOfficerUid === uid;
  return false;
}
export function assertResolutionReady(record: M4IncidentRecord) { if (record.status !== 'awaiting_resolution') throw new HttpsError('failed-precondition', 'Record a completed response or authority finding before resolution.'); }
export function buildIncidentAiPayload(input: Pick<ReturnType<typeof validateSubmission>, 'category' | 'description' | 'location' | 'occurredAt'> & { evidence: M4EvidenceRef[] }, event: EventRecord) { return { category: input.category, description: input.description, location: input.location, occurredAt: input.occurredAt, evidence: input.evidence.map(({ name, mimeType, size }) => ({ name, mimeType, size })), event: { type: event.eventDetails.type, venueName: event.eventDetails.venueName, attendance: event.eventDetails.expectedAttendance } }; }
export function rankRecommendedAuthorities(entries: M4AuthorityDirectoryEntry[], category: M4IncidentCategory, assessment: M4AIAssessment, event: EventRecord) {
  const locationText = `${event.eventDetails.venueName} ${event.eventDetails.venueAddress} ${event.eventDetails.venueState}`.toLocaleLowerCase();
  const emergencyTypes = new Set(['PDRM', 'BOMBA', 'KKM']);
  const urgent = assessment.status === 'success' && (assessment.severity === 'high' || assessment.immediateActionRequired);
  const score = (entry: M4AuthorityDirectoryEntry) =>
    (entry.coverageAreas.some((area) => locationText.includes(area.toLocaleLowerCase())) ? 4 : 0)
    + (event.requiredAuthorities.includes(entry.authorityType) ? 2 : 0)
    + (urgent && emergencyTypes.has(entry.authorityType) ? 1 : 0);
  return entries.filter((entry) => entry.active && entry.serviceCategories.includes(category))
    .sort((left, right) => score(right) - score(left) || left.name.localeCompare(right.name) || left.authorityId.localeCompare(right.authorityId));
}
export function actionRequestHash(action: string, input: Record<string, unknown>, evidencePaths: string[]) { return createHash('sha256').update(JSON.stringify({ action, note: input.note ?? null, team: input.team ?? null, authorityId: input.authorityId ?? null, resolution: input.resolution ?? null, manualSeverity: input.manualSeverity ?? null, discrepancyOutcome: input.discrepancyOutcome ?? null, evidencePaths })).digest('hex'); }
const OUTBOX = 'incident_notification_outbox';
function incidentNotification(input: NotificationInput) { return input; }
function queueIncidentNotification(tx: FirebaseFirestore.Transaction, input: NotificationInput, createdAt: number, outboxId = input.notificationId ?? input.sourceActionId) { tx.set(firestore().collection(OUTBOX).doc(outboxId), { outboxId, input, createdAt, deliveredAt: null }, { merge: true }); }
async function deliverIncidentNotification(outboxId: string) { const ref = firestore().collection(OUTBOX).doc(outboxId); const snap = await ref.get(); if (!snap.exists || snap.data()?.deliveredAt) return; const input = snap.data()?.input as NotificationInput | undefined; if (!input) throw new Error('Incident notification outbox payload is missing.'); await createNotification(input, snap.data()?.createdAt ?? Date.now()); await ref.update({ deliveredAt: Date.now() }); }
async function reconcileSubmitNotification(record: M4IncidentRecord) { const organizerUid = await resolveAuthUid(record.organizerId); if (!organizerUid) return; const input = incidentNotification({ recipientUid: organizerUid, eventId: record.eventId, versionId: record.eventVersionId, type: 'incident_reported', title: 'New incident report', message: `${record.eventName}: ${record.aiAssessment.status === 'success' && record.aiAssessment.immediateActionRequired ? 'immediate action recommended' : 'organizer review required'}.`, sourceActionId: record.incidentId, notificationId: `${record.incidentId}_organizer` }); const outboxId = input.notificationId!; const ref = firestore().collection(OUTBOX).doc(outboxId); await firestore().runTransaction(async (tx) => { if (!(await tx.get(ref)).exists) queueIncidentNotification(tx, input, record.createdAt); }); await deliverIncidentNotification(outboxId); }
function deny(): never { throw new HttpsError('permission-denied', 'This action is not permitted.'); }
