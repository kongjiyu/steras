import { getStorage } from 'firebase-admin/storage';

export type StorageEvidenceStatus = 'eligible' | 'ineligible' | 'missing';

export interface StorageEvidenceInspection {
  path: string;
  status: StorageEvidenceStatus;
  retrievedAt: number;
  sourceVersion: string;
  reason?: string;
}

const EVIDENCE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const MAX_EVIDENCE_SIZE = 10 * 1024 * 1024;

export async function inspectStorageEvidence(paths: string[], now = Date.now()): Promise<StorageEvidenceInspection[]> {
  const bucket = getStorage().bucket();
  return Promise.all(paths.map(async (path) => {
    try {
      const metadata = (await bucket.file(path).getMetadata())[0];
      if (!isValidEvidenceMetadata(metadata)) {
        return { path, status: 'ineligible', retrievedAt: now, sourceVersion: storageGeneration(metadata), reason: 'storage_metadata_invalid' };
      }
      return { path, status: 'eligible', retrievedAt: now, sourceVersion: storageGeneration(metadata) };
    } catch {
      return { path, status: 'missing', retrievedAt: now, sourceVersion: 'missing', reason: 'storage_object_missing' };
    }
  }));
}

export function isValidEvidenceMetadata(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const size = Number(value.size);
  return EVIDENCE_MIME_TYPES.has(String(value.contentType))
    && Number.isSafeInteger(size) && size >= 1 && size <= MAX_EVIDENCE_SIZE
    && typeof value.generation === 'string' && /^\d+$/.test(value.generation);
}

function storageGeneration(value: unknown): string {
  return isRecord(value) && typeof value.generation === 'string' && /^\d+$/.test(value.generation)
    ? `storage-generation:${value.generation}`
    : 'storage-generation:unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
