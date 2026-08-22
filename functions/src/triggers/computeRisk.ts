/**
 * Shared re-export of the risk+resource pipeline for HTTP-callable
 * `manualRecompute` and any other code paths that need to re-run.
 */

import { RetryAuthorization, runRiskAndResourcePipeline } from './onEventCreated';

export function recomputeRiskAndResources(eventId: string, authorization: RetryAuthorization) {
  return runRiskAndResourcePipeline(eventId, Date.now(), true, authorization);
}
