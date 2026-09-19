import Anthropic from '@anthropic-ai/sdk';
import { PDFDocument } from 'pdf-lib';
import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { COLLECTIONS, EventControl, EventRecord, Stage1Doc, Stage1RedactionDraft, UserProfile } from '@shared/types';
import { DEFAULT_MINIMAX_BASE_URL, DEFAULT_MINIMAX_MODEL } from '../config/minimax';
import { FUNCTION_REGION } from '../config/runtime';
import { isActiveControlGeneration } from '../utils/controlLifecycle';
import { decodeStage1Source, renderBlackRedaction, sourceHashForDeclaration, validateStage1Masks } from '../utils/stage1Redaction';

interface GenerateStage1RedactionRequest { eventId?: string; controlId?: string; docId?: string; regenerate?: boolean }

export const generateStage1Redaction = onCall<GenerateStage1RedactionRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before generating a redacted copy.');
  const eventId = (request.data?.eventId ?? '').trim();
  const controlId = (request.data?.controlId ?? '').trim();
  const docId = (request.data?.docId ?? '').trim();
  if (!eventId || !controlId || !docId) throw new HttpsError('invalid-argument', 'eventId, controlId and docId are required.');
  const db = firestore();
  const user = (await db.collection(COLLECTIONS.USERS).doc(request.auth.uid).get()).data() as UserProfile | undefined;
  if (user?.role !== 'admin') throw new HttpsError('permission-denied', 'Only admins can generate redacted copies.');
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const controlRef = eventRef.collection(COLLECTIONS.EVENT_CONTROLS).doc(controlId);
  const docRef = controlRef.collection(COLLECTIONS.STAGE1_DOCS).doc(docId);
  const [eventSnap, controlSnap, docSnap] = await Promise.all([eventRef.get(), controlRef.get(), docRef.get()]);
  if (!eventSnap.exists || !controlSnap.exists || !docSnap.exists) throw new HttpsError('not-found', 'The application, control or Stage 1 document was not found.');
  const event = eventSnap.data() as EventRecord;
  const control = controlSnap.data() as EventControl;
  const stage1Doc = docSnap.data() as Stage1Doc;
  if (!isActiveControlGeneration(event, control, eventId)) throw new HttpsError('failed-precondition', 'The control item is not active for the current version.');
  if (stage1Doc.status !== 'verified') throw new HttpsError('failed-precondition', 'Only Authority-verified Stage 1 documents can be published.');
  const versionId = event.currentVersionId!;
  const revision = stage1Doc.revision ?? 1;
  const redactionRef = docRef.collection(COLLECTIONS.STAGE1_REDACTIONS).doc(stage1Doc.revisionId ?? `${docId}-r${revision}`);
  const currentDraft = await redactionRef.get();
  if (currentDraft.exists && request.data?.regenerate !== true) return currentDraft.data() as Stage1RedactionDraft;
  const decoded = await decodeStage1Source(stage1Doc.filePath);
  const now = Date.now();
  if (!decoded) {
    const draft: Stage1RedactionDraft = {
      redactionId: redactionRef.id, eventId, versionId, controlId, docId, revision,
      sourceHash: sourceHashForDeclaration(eventId, versionId, controlId, docId, revision), status: 'ready', masks: [], pageCount: 0, reviewedPages: [], aiProvider: 'manual', generatedAt: now, generatedBy: request.auth.uid, updatedAt: now,
    };
    await redactionRef.set(draft);
    return draft;
  }
  let masks = [] as import('@shared/types').Stage1RedactionMask[];
  let aiFailureReason: string | undefined;
  let aiProvider: 'minimax' | 'manual' = 'minimax';
  let aiModel: string | undefined = process.env.MINIMAX_MODEL ?? DEFAULT_MINIMAX_MODEL;
  let pageCount = 1;
  if (decoded.mimeType === 'application/pdf') pageCount = (await PDFDocument.load(decoded.bytes)).getPageCount();
  try {
    if (decoded.mimeType === 'application/pdf') throw new Error('PDF pages require manual page-by-page review before publication.');
    masks = await requestMasksWithMiniMax(decoded.mimeType, decoded.bytes.toString('base64'), aiModel);
    masks = validateStage1Masks(masks, pageCount);
  } catch (error) {
    aiProvider = 'manual';
    aiFailureReason = error instanceof Error ? error.message.slice(0, 500) : 'MiniMax redaction failed.';
    aiModel = undefined;
    masks = [];
  }
  const draft: Stage1RedactionDraft = {
    redactionId: redactionRef.id, eventId, versionId, controlId, docId, revision,
    sourceHash: decoded.sha256, sourceFilePath: stage1Doc.filePath, status: aiProvider === 'manual' ? 'manual_required' : 'draft', masks, pageCount,
    reviewedPages: [], aiProvider, ...(aiModel ? { aiModel } : {}), ...(aiFailureReason ? { aiFailureReason } : {}), generatedAt: now, generatedBy: request.auth.uid, updatedAt: now,
  };
  await redactionRef.set(draft);
  await eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(`stage1_redaction_generated_${controlId}_${docId}_${now}`).set({ id: `stage1_redaction_generated_${controlId}_${docId}_${now}`, eventId, versionId, action: 'stage1_redaction_generated', actorId: request.auth.uid, actorRole: 'admin', timestamp: now, notes: aiFailureReason ?? 'MiniMax generated a redaction draft.', metadata: { controlId, docId, revision, sourceHash: decoded.sha256, aiProvider } });
  return draft;
});

async function requestMasksWithMiniMax(mimeType: string, base64: string, model: string): Promise<import('@shared/types').Stage1RedactionMask[]> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error('MiniMax is not configured. Use manual redaction.');
  const client = new Anthropic({ apiKey, baseURL: process.env.MINIMAX_BASE_URL ?? DEFAULT_MINIMAX_BASE_URL });
  const response = await client.messages.create({
    model,
    max_tokens: 2_000,
    system: 'You identify sensitive personal data for irreversible redaction. Return strict JSON only with {"masks":[{"page":1,"x":0,"y":0,"width":0.1,"height":0.1,"category":"contact"}]}. Coordinates are normalized 0..1. Redact only personal identifiers, IDs, contact/address, signatures, payment data, and QR/barcodes. Never redact organization names, issuer names, dates, or verification labels.',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Inspect this document and propose normalized black-box masks.' }, { type: 'image', source: { type: 'base64', media_type: mimeType as 'image/jpeg' | 'image/png', data: base64 } }] }],
  });
  const text = response.content.filter((item): item is { type: 'text'; text: string } => item.type === 'text').map((item) => item.text).join('');
  const parsed = JSON.parse(text) as { masks?: unknown };
  if (!Array.isArray(parsed.masks)) throw new Error('MiniMax returned no valid redaction masks.');
  return parsed.masks as import('@shared/types').Stage1RedactionMask[];
}

export { renderBlackRedaction };
