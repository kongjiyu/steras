/**
 * Shared re-export of the risk+resource pipeline for HTTP-callable
 * `manualRecompute` and any other code paths that need to re-run.
 */

export { runRiskAndResourcePipeline as recomputeRiskAndResources } from './onEventCreated';
