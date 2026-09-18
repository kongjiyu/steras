import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { COLLECTIONS, EventControl, EventRecord, Stage1Doc, Stage1RedactionDraft, UserProfile } from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { isActiveControlGeneration } from '../utils/controlLifecycle';
import { decodeStage1DataUrl, renderBlackRedaction, validateStage1Masks } from '../utils/stage1Redaction';

interface UpdateStage1RedactionRequest { eventId?: string; controlId?: string; docId?: string; masks?: unknown; reviewedPages?: unknown; }

export const updateStage1Redaction = onCall<UpdateStage1RedactionRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before saving a redaction review.');
  const eventId = (request.data?.eventId ?? '').trim();
  const controlId = (request.data?.controlId ?? '').trim();
  const docId = (request.data?.docId ?? '').trim();
  if (!eventId || !controlId || !docId) throw new HttpsError('invalid-argument', 'eventId, controlId and docId are required.');
  const db = firestore();
  const user = (await db.collection(COLLECTIONS.USERS).doc(request.auth.uid).get()).data() as UserProfile | undefined;
  if (user?.role !== 'admin') throw new HttpsError('permission-denied', 'Only admins can save redaction reviews.');
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const controlRef = eventRef.collection(COLLECTIONS.EVENT_CONTROLS).doc(controlId);
  const docRef = controlRef.collection(COLLECTIONS.STAGE1_DOCS).doc(docId);
  const [eventSnap, controlSnap, docSnap] = await Promise.all([eventRef.get(), controlRef.get(), docRef.get()]);
  if (!eventSnap.exists || !controlSnap.exists || !docSnap.exists) throw new HttpsError('not-found', 'Application, control or Stage 1 document was not found.');
  const event = eventSnap.data() as EventRecord;
  const control = controlSnap.data() as EventControl;
  const stage1Doc = docSnap.data() as Stage1Doc;
  if (!isActiveControlGeneration(event, control, eventId) || stage1Doc.status !== 'verified') throw new HttpsError('failed-precondition', 'The Stage 1 document is no longer current and verified.');
  const revisionId = stage1Doc.revisionId ?? `${docId}-r${stage1Doc.revision ?? 1}`;
  const redactionRef = docRef.collection(COLLECTIONS.STAGE1_REDACTIONS).doc(revisionId);
  const draftSnap = await redactionRef.get();
  if (!draftSnap.exists) throw new HttpsError('failed-precondition', 'Generate a redaction draft before editing it.');
  const draft = draftSnap.data() as Stage1RedactionDraft;
  const masks = validateStage1Masks(request.data?.masks ?? draft.masks, draft.pageCount);
  if (!Array.isArray(request.data?.reviewedPages) || request.data.reviewedPages.length !== draft.pageCount
    || new Set(request.data.reviewedPages).size !== draft.pageCount
    || request.data.reviewedPages.some((page) => !Number.isInteger(page) || Number(page) < 1 || Number(page) > draft.pageCount)) {
    throw new HttpsError('invalid-argument', `Review every page before saving (${draft.pageCount} page${draft.pageCount === 1 ? '' : 's'}).`);
  }
  const decoded = decodeStage1DataUrl(stage1Doc.filePath);
  let redactedFilePath = draft.redactedFilePath;
  if (decoded) {
    if (decoded.sha256 !== draft.sourceHash) throw new HttpsError('aborted', 'The source document changed. Generate a new redaction draft.');
    redactedFilePath = (await renderBlackRedaction(decoded, masks)).dataUrl;
  }
  const now = Date.now();
  const updated: Stage1RedactionDraft = { ...draft, status: 'ready', masks, reviewedPages: request.data.reviewedPages as number[], redactedFilePath, updatedAt: now };
  await redactionRef.set(updated);
  await eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(`stage1_redaction_reviewed_${controlId}_${docId}_${now}`).set({ id: `stage1_redaction_reviewed_${controlId}_${docId}_${now}`, eventId, versionId: event.currentVersionId, action: 'stage1_redaction_reviewed', actorId: request.auth.uid, actorRole: 'admin', timestamp: now, notes: 'Admin reviewed every redaction page.', metadata: { controlId, docId, revision: draft.revision, maskCount: masks.length } });
  return updated;
});
