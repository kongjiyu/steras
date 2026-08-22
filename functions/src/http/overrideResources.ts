import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { ResourceQuantities } from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';

interface OverrideResourcesRequest {
  eventId?: string;
  quantities?: ResourceQuantities;
  rationale?: string;
}

export const overrideResources = onCall<OverrideResourcesRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before overriding resources.');
  return overrideResourcesForUser(request.auth.uid, request.data);
});

export async function overrideResourcesForUser(_uid: string, request: OverrideResourcesRequest) {
  validateResourceOverrideRequest(request);
  throwResourceOverridesUnavailable();
}

export function throwResourceOverridesUnavailable(): never {
  throw new HttpsError(
    'failed-precondition',
    'Resource adjustments are unavailable until the append-only authority finalisation workflow is enabled.',
  );
}

export function validateResourceOverrideRequest(request: unknown): { eventId: string; quantities: ResourceQuantities; rationale: string } {
  const value = typeof request === 'object' && request !== null ? request as Record<string, unknown> : {};
  const eventId = typeof value.eventId === 'string' ? value.eventId.trim() : '';
  const rationale = typeof value.rationale === 'string' ? value.rationale.trim() : '';
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!isResourceQuantities(value.quantities)) throw new HttpsError('invalid-argument', 'Every resource quantity must be a non-negative integer.');
  if (rationale.length < 10 || rationale.length > 1_000) throw new HttpsError('invalid-argument', 'Rationale must be between 10 and 1,000 characters.');
  return { eventId, quantities: value.quantities, rationale };
}

function isResourceQuantities(value: unknown): value is ResourceQuantities {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const fields: (keyof ResourceQuantities)[] = ['police', 'medicalTeams', 'ambulances', 'toilets', 'wasteBins', 'security', 'fireOfficers'];
  return Object.keys(record).length === fields.length && fields.every((field) => Number.isInteger(record[field]) && (record[field] as number) >= 0 && (record[field] as number) <= 1_000_000);
}
