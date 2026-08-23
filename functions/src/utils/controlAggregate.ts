/**
 * Shared helper for computing the aggregate Stage 1 control label.
 *
 * Used by:
 *   - `verifyStage1Doc` (officer side, after a single doc's status change)
 *   - `submitStage1Doc` (organizer side, after an upload or use_previous
 *     flag lands)
 *
 * Rule (per the M3 v4 spec + A7):
 *   - any doc rejected     -> 'resubmit_required'
 *   - all docs verified or use_previous -> 'approved'
 *   - otherwise            -> 'pending'
 *
 * `pending_submission` docs are treated as not-yet-submitted (they count
 * as "still pending" for the aggregate).
 */
import { EventControl, Stage1Doc } from '@shared/types';

export function aggregateLabel(docs: Stage1Doc[]): EventControl['label'] {
  if (docs.length === 0) return 'pending';
  if (docs.some((d) => d.status === 'rejected')) return 'resubmit_required';
  if (docs.every((d) => d.status === 'verified' || d.status === 'use_previous')) return 'approved';
  return 'pending';
}
