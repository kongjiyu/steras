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
  return createHash('sha256').update(canonicalStringify({
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

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalStringify(entry)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
