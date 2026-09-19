import { createHash } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';
import { COLLECTIONS, EventControl, UserProfile } from '@shared/types';
import { stage1DocumentId, stage1RevisionId } from '@shared/stage1';
import { stage2DocumentId } from '@shared/stage2';

const SOURCE_VERSION = 'v1';
const SOURCE_EVENT = 'presentation-heritage-night';
const IMAGE_BY_AUTHORITY: Record<string, string> = {
  PDRM: 'stage2-pdrm-crowd-entry.jpg',
  BOMBA: 'stage2-bomba-fire-egress.jpg',
  KKM: 'stage2-kkm-medical-point.jpg',
  DBKL: 'stage2-dbkl-venue-setup.jpg',
  MOTAC: 'm4-crowd-arrival-surge.jpg',
};

interface FixedEvidenceCopyResult {
  stage1Copied: number;
  stage2Copied: number;
}

function downloadUrl(bucketName: string, path: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

async function copyObject(sourcePath: string, destinationPath: string, fixtureId: string): Promise<string | null> {
  const bucket = getStorage().bucket();
  const source = bucket.file(sourcePath);
  const [exists] = await source.exists();
  if (!exists) return null;
  const destination = bucket.file(destinationPath);
  await source.copy(destination);
  const token = createHash('sha256').update(`m3-fixed-evidence-v1:${fixtureId}:${destinationPath}`).digest('hex').slice(0, 32);
  await destination.setMetadata({ metadata: { fixedPresetSource: SOURCE_EVENT, firebaseStorageDownloadTokens: token } });
  const url = downloadUrl(bucket.name, destinationPath, token);
  // Never let a fixture repair silently seed a placeholder service URL or an
  // empty/non-Firebase record.  The destination is always a Storage URL;
  // retaining this guard makes the invariant explicit for future mappings.
  if (!url.startsWith('https://firebasestorage.googleapis.com/') || /placehold(?:\.co|er)/i.test(url)) return null;
  return url;
}

/**
 * Copies the committed presentation assets into per-event Storage paths and
 * creates private pending evidence projections only when the target slots are
 * empty. Storage copies happen before the Firestore transaction; a missing
 * managed source is treated as unavailable so normal organizer upload remains
 * the safe fallback.
 */
export async function seedFixedEvidenceCopies(
  db: FirebaseFirestore.Firestore,
  eventId: string,
  versionId: string,
  controls: EventControl[],
  organizer: Pick<UserProfile, 'uid'>,
): Promise<FixedEvidenceCopyResult> {
  let stage1Copied = 0;
  let stage2Copied = 0;
  const stage1Files = new Map<string, string>();
  const stage2Files = new Map<string, string>();
  for (const control of controls) {
    const sourceControlId = `${SOURCE_EVENT}-ctrl-${control.authority.toLowerCase()}-v1`;
    const applicationSource = await copyObject(
      `event_documents/${SOURCE_EVENT}/${SOURCE_VERSION}/application-evidence.pdf`,
      `events/${eventId}/controls/${control.controlId}/stage1/fixed-application-evidence.pdf`,
      eventId,
    );
    if (applicationSource) stage1Files.set(control.controlId, applicationSource);
    const imageName = IMAGE_BY_AUTHORITY[control.authority];
    if (imageName) {
      const imageSource = await copyObject(
        `events/${SOURCE_EVENT}/controls/${sourceControlId}/stage2/${imageName}`,
        `events/${eventId}/controls/${control.controlId}/stage2/${imageName}`,
        eventId,
      );
      if (imageSource) stage2Files.set(control.controlId, imageSource);
    }
  }
  if (stage1Files.size === 0 && stage2Files.size === 0) return { stage1Copied, stage2Copied };

  await db.runTransaction(async (tx) => {
    const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
    const eventSnap = await tx.get(eventRef);
    if (!eventSnap.exists || (eventSnap.data() as { currentVersionId?: string }).currentVersionId !== versionId) return;
    const pendingWrites: Array<{ ref: FirebaseFirestore.DocumentReference; value: Record<string, unknown> }> = [];
    for (const control of controls) {
      const controlRef = eventRef.collection(COLLECTIONS.EVENT_CONTROLS).doc(control.controlId);
      const stage1Snapshot = await tx.get(controlRef.collection(COLLECTIONS.STAGE1_DOCS));
      if (stage1Files.has(control.controlId) && stage1Snapshot.empty) {
        const filePath = stage1Files.get(control.controlId)!;
        for (const requirement of control.stage1Requirements.filter((item) => item.required)) {
          const docId = stage1DocumentId(control.controlId, requirement.docType);
          pendingWrites.push({
            ref: controlRef.collection(COLLECTIONS.STAGE1_DOCS).doc(docId),
            value: {
              docId,
              docType: requirement.docType,
              label: requirement.label,
              status: 'pending_verification',
              revision: 1,
              revisionId: `${docId}-r1`,
              uploadedAt: Date.now(),
              uploadedBy: organizer.uid,
              filePath,
              fixedPresetSource: SOURCE_EVENT,
            },
          });
          const revisionId = stage1RevisionId(docId, 1);
          pendingWrites.push({
            ref: controlRef.collection(COLLECTIONS.STAGE1_DOCS).doc(docId).collection(COLLECTIONS.STAGE1_REVISIONS).doc(revisionId),
            value: {
              revisionId,
              eventId,
              versionId,
              controlId: control.controlId,
              docId,
              revision: 1,
              docType: requirement.docType,
              label: requirement.label,
              filePath,
              fileName: 'fixed-application-evidence.pdf',
              mimeType: 'application/pdf',
              usePreviousDeclaration: false,
              submittedBy: organizer.uid,
              submittedAt: Date.now(),
              status: 'pending_verification',
              fixedPresetSource: SOURCE_EVENT,
            },
          });
          stage1Copied++;
        }
      }
      const stage2Ref = controlRef.collection(COLLECTIONS.STAGE2_DOCS).doc(stage2DocumentId(control.controlId));
      const stage2Snapshot = await tx.get(stage2Ref);
      if (stage2Files.has(control.controlId) && !stage2Snapshot.exists) {
        pendingWrites.push({
          ref: stage2Ref,
          value: {
            docId: stage2DocumentId(control.controlId),
            imageUrl: stage2Files.get(control.controlId)!,
            uploadedAt: Date.now(),
            uploadedBy: organizer.uid,
            publicConfirmCount: 0,
            published: false,
            fixedPresetSource: SOURCE_EVENT,
          } as unknown as Record<string, unknown>,
        });
        stage2Copied++;
      }
    }
    for (const pending of pendingWrites) tx.create(pending.ref, pending.value);
  });
  return { stage1Copied, stage2Copied };
}
