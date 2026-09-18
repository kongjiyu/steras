import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { COLLECTIONS, EventControl, EventRecord, PublicStage1Document, Stage1Doc, Stage1RedactionDraft, UserProfile } from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { isActiveControlGeneration } from '../utils/controlLifecycle';
import { decodeStage1DataUrl } from '../utils/stage1Redaction';

interface Stage1PublicationRequest { eventId?: string; controlId?: string; docId?: string; }

export const publishStage1Doc = onCall<Stage1PublicationRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before publishing a Stage 1 document.');
  const eventId = (request.data?.eventId ?? '').trim();
  const controlId = (request.data?.controlId ?? '').trim();
  const docId = (request.data?.docId ?? '').trim();
  if (!eventId || !controlId || !docId) throw new HttpsError('invalid-argument', 'eventId, controlId and docId are required.');
  const db = firestore();
  const user = (await db.collection(COLLECTIONS.USERS).doc(request.auth.uid).get()).data() as UserProfile | undefined;
  if (user?.role !== 'admin') throw new HttpsError('permission-denied', 'Only admins can publish Stage 1 documents.');
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const controlRef = eventRef.collection(COLLECTIONS.EVENT_CONTROLS).doc(controlId);
  const docRef = controlRef.collection(COLLECTIONS.STAGE1_DOCS).doc(docId);
  const [eventSnap, controlSnap, docSnap] = await Promise.all([eventRef.get(), controlRef.get(), docRef.get()]);
  if (!eventSnap.exists || !controlSnap.exists || !docSnap.exists) throw new HttpsError('not-found', 'Application, control or Stage 1 document was not found.');
  const event = eventSnap.data() as EventRecord;
  const control = controlSnap.data() as EventControl;
  const stage1Doc = docSnap.data() as Stage1Doc;
  if (!isActiveControlGeneration(event, control, eventId) || stage1Doc.status !== 'verified') throw new HttpsError('failed-precondition', 'Only a current Authority-verified Stage 1 document can be published.');
  const versionId = event.currentVersionId!;
  const revision = stage1Doc.revision ?? 1;
  const revisionId = stage1Doc.revisionId ?? `${docId}-r${revision}`;
  const redactionRef = docRef.collection(COLLECTIONS.STAGE1_REDACTIONS).doc(revisionId);
  const redactionSnap = await redactionRef.get();
  const draft = redactionSnap.exists ? redactionSnap.data() as Stage1RedactionDraft : undefined;
  const isDeclaration = stage1Doc.usePreviousDeclaration === true && !stage1Doc.filePath;
  if (!isDeclaration && (!draft || draft.status !== 'ready' || !draft.redactedFilePath)) throw new HttpsError('failed-precondition', 'Generate and complete the Admin redaction review before publishing.');
  if (draft && stage1Doc.filePath) {
    const source = decodeStage1DataUrl(stage1Doc.filePath);
    if (!source || source.sha256 !== draft.sourceHash) throw new HttpsError('aborted', 'The source document changed. Generate a new redaction draft.');
  }
  const now = Date.now();
  const publicStage1Id = `${controlId}-${docId}`;
  const publicRef = db.collection(COLLECTIONS.PUBLIC_EVENT_CONTROLS).doc(eventId).collection(COLLECTIONS.PUBLIC_STAGE1_DOCS).doc(publicStage1Id);
  const projection: PublicStage1Document = {
    publicStage1Id, eventId, versionId, controlId, docId, revision, authority: control.authority, controlName: control.controlName, documentLabel: stage1Doc.label,
    status: isDeclaration ? 'use_previous' : 'verified',
    ...(isDeclaration ? {} : { fileUrl: draft!.redactedFilePath, fileMimeType: stage1Doc.filePath?.slice(5, stage1Doc.filePath.indexOf(';')) ?? 'application/octet-stream' }),
    publishedAt: now, sanitized: true, adminReviewed: true,
    disclosure: isDeclaration ? 'Verified previous-document declaration · No file published' : 'Sensitive data redacted · Admin reviewed',
  };
  await db.runTransaction(async (tx) => {
    const [freshEvent, freshControl, freshDoc] = await Promise.all([tx.get(eventRef), tx.get(controlRef), tx.get(docRef)]);
    if (!freshEvent.exists || !freshControl.exists || !freshDoc.exists) throw new HttpsError('aborted', 'The document changed. Reload before publishing.');
    const freshEventData = freshEvent.data() as EventRecord;
    const freshControlData = freshControl.data() as EventControl;
    const freshDocData = freshDoc.data() as Stage1Doc;
    if (!isActiveControlGeneration(freshEventData, freshControlData, eventId) || freshDocData.revisionId !== revisionId || freshDocData.status !== 'verified') throw new HttpsError('aborted', 'The Stage 1 revision is no longer current.');
    tx.set(publicRef, projection);
    if (draft) tx.set(redactionRef, { ...draft, status: 'published', publishedAt: now, publishedBy: request.auth!.uid, updatedAt: now });
    const auditId = `stage1_doc_published_${controlId}_${docId}_${now}`;
    tx.create(eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId), { id: auditId, eventId, versionId, action: 'stage1_doc_published', actorId: request.auth!.uid, actorRole: 'admin', timestamp: now, notes: projection.disclosure, metadata: { controlId, docId, revision, publicStage1Id } });
  });
  return projection;
});

export const unpublishStage1Doc = onCall<Stage1PublicationRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before unpublishing a Stage 1 document.');
  const eventId = (request.data?.eventId ?? '').trim();
  const controlId = (request.data?.controlId ?? '').trim();
  const docId = (request.data?.docId ?? '').trim();
  if (!eventId || !controlId || !docId) throw new HttpsError('invalid-argument', 'eventId, controlId and docId are required.');
  const db = firestore();
  const user = (await db.collection(COLLECTIONS.USERS).doc(request.auth.uid).get()).data() as UserProfile | undefined;
  if (user?.role !== 'admin') throw new HttpsError('permission-denied', 'Only admins can unpublish Stage 1 documents.');
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const publicRef = db.collection(COLLECTIONS.PUBLIC_EVENT_CONTROLS).doc(eventId).collection(COLLECTIONS.PUBLIC_STAGE1_DOCS).doc(`${controlId}-${docId}`);
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    tx.delete(publicRef);
    const auditId = `stage1_doc_unpublished_${controlId}_${docId}_${now}`;
    tx.create(eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId), { id: auditId, eventId, action: 'stage1_doc_unpublished', actorId: request.auth!.uid, actorRole: 'admin', timestamp: now, notes: 'Admin removed the Stage 1 document from public view.', metadata: { controlId, docId } });
  });
  return { eventId, controlId, docId, published: false as const };
});
