/**
 * Canonical identifiers for the singleton Stage 2 evidence document.
 *
 * Every writer and reader must use the same suffix.  Keeping this in the
 * shared package prevents fixture data, Admin pages, and Cloud Functions from
 * silently drifting to a different document id.
 */
export function stage2DocumentId(controlId: string): string {
  return `${controlId}-s2`;
}

export function stage2PublicControlId(controlId: string): string {
  return `${controlId}-stage2`;
}
