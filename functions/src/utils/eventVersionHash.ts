import { createHash } from 'node:crypto';
import { EventVersion } from '@shared/types';

export type EventVersionHashInput = Pick<EventVersion,
  | 'eventDetails'
  | 'templateSelection'
  | 'documentPaths'
  | 'documentUploads'
  | 'extractionId'
  | 'evidenceManifest'
  | 'evidenceManifestSchemaVersion'
  | 'revisionSource'>;

/** Canonical integrity hash for an immutable submitted application version. */
export function eventVersionInputHash(input: EventVersionHashInput): string {
  return createHash('sha256').update(JSON.stringify({
    eventDetails: input.eventDetails,
    templateSelection: input.templateSelection,
    documentPaths: input.documentPaths,
    documentUploads: input.documentUploads,
    extractionId: input.extractionId,
    evidenceManifest: input.evidenceManifest,
    evidenceManifestSchemaVersion: input.evidenceManifestSchemaVersion,
    revisionSource: input.revisionSource,
  })).digest('hex');
}

/** Attach the integrity hash to the exact immutable payload persisted by submitEvent. */
export function buildSubmittedEventVersion(input: Omit<EventVersion, 'inputHash'>): EventVersion {
  return { ...input, inputHash: eventVersionInputHash(input) };
}
