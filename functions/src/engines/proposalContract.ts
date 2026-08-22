import { EvidenceKey } from '@shared/types';

export const CANONICAL_EVIDENCE_KEYS = new Set<EvidenceKey>([
  'weather', 'crowd', 'venue', 'history', 'holiday', 'public_health',
  'sanitation', 'medical', 'security', 'transport', 'compliance',
]);

export function canonicalHazardId(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

export function hasCanonicalDuplicateHazardIds(values: readonly string[]): boolean {
  const canonical = values.map(canonicalHazardId);
  return new Set(canonical).size !== canonical.length;
}

export function isCanonicalEvidenceReferenceList(value: unknown): value is EvidenceKey[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item) => typeof item === 'string' && CANONICAL_EVIDENCE_KEYS.has(item as EvidenceKey))
    && new Set(value).size === value.length;
}
