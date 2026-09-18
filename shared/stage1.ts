/**
 * Canonical identifiers for Stage 1 control-document projections.
 *
 * The document id is part of the current-version contract: every reader,
 * writer and fixture must resolve the same slot from the control and
 * requirement type instead of inventing a suffix locally.
 */
export function stage1DocumentId(controlId: string, docType: string): string {
  return `${controlId}-s1-${docType}`;
}

export function stage1RevisionId(docId: string, revision: number): string {
  return `${docId}-r${revision}`;
}
