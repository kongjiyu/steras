import { describe, expect, it } from 'vitest';
import { submitIncident } from '../http/m4Incidents';
import { onPublicReportCreated } from '../triggers/onPublicReportCreated';

function secretNames(fn: unknown): string[] {
  const endpoint = (fn as { __endpoint?: { secretEnvironmentVariables?: Array<{ key?: string }> } }).__endpoint;
  return endpoint?.secretEnvironmentVariables?.map((secret) => secret.key ?? '') ?? [];
}

describe('deployed function secret bindings', () => {
  it('binds MiniMax to both direct M4 reports and the M3 public-report bridge', () => {
    expect(secretNames(submitIncident)).toContain('MINIMAX_API_KEY');
    expect(secretNames(onPublicReportCreated)).toContain('MINIMAX_API_KEY');
  });
});
