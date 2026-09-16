import { describe, expect, it } from 'vitest';
import type { EventRecord } from '@shared/types';
import { M4_AI_AUTHORITY_PROMPT_VERSION, type M4AuthorityDirectoryEntry } from '@shared/m4';
import {
  buildAuthorityRecommendationAiPayload,
  parseAuthorityRecommendationResponse,
  recommendAuthoritiesWithMiniMax,
} from './incidentAuthorityRecommender';
import type { IncidentAuthorityRecommendationInput } from './incidentAuthorityRecommender';

const event = {
  requiredAuthorities: ['PDRM', 'KKM'],
  eventDetails: {
    name: 'Demo Festival', type: 'festival', venueName: 'Central Venue', venueAddress: 'Kuala Lumpur', venueState: 'Kuala Lumpur',
    venueCapacity: 1_000, expectedAttendance: 800, startDatetime: 10, endDatetime: 20,
  },
} as unknown as EventRecord;

const authorities: M4AuthorityDirectoryEntry[] = [
  { authorityId: 'pdrm-kl-demo', name: 'PDRM Kuala Lumpur', authorityType: 'PDRM', serviceCategories: ['security'], coverageAreas: ['Kuala Lumpur'], contactName: 'Duty officer', contactPhone: '999', active: true, createdAt: 1, updatedAt: 1 },
  { authorityId: 'kkm-kl-demo', name: 'KKM Kuala Lumpur', authorityType: 'KKM', serviceCategories: ['security'], coverageAreas: ['Kuala Lumpur'], contactName: 'Duty officer', contactPhone: '999', active: true, createdAt: 1, updatedAt: 1 },
];

const input: IncidentAuthorityRecommendationInput = {
  category: 'security' as const,
  description: 'An unattended item was found near the main entrance.',
  location: 'Main entrance', occurredAt: 12, evidence: [], event,
  assessment: { status: 'success', model: 'MiniMax-M3', promptVersion: '2026-09-03-incident-triage-v1', severity: 'high', immediateActionRequired: true, rationale: 'Immediate review is required.', assessedAt: 12 },
  authorities,
};

describe('M4 MiniMax authority recommendation', () => {
  it('sends only directory candidates and returns validated IDs', async () => {
    let requestPayload = '';
    const result = await recommendAuthoritiesWithMiniMax('secret', input, {
      now: 12,
      request: async (request) => { requestPayload = request.user; return '{"authorityIds":["pdrm-kl-demo"],"rationale":"Security incidents in Kuala Lumpur are best reviewed by PDRM."}'; },
    });
    expect(result).toMatchObject({ status: 'success', model: 'MiniMax-M3', promptVersion: M4_AI_AUTHORITY_PROMPT_VERSION, authorityIds: ['pdrm-kl-demo'] });
    expect(requestPayload).toContain('pdrm-kl-demo');
    expect(requestPayload).not.toContain('contactPhone');
    expect(requestPayload).not.toContain('secret');
  });

  it('fails closed for unknown directory IDs and records unavailable configuration', async () => {
    expect(() => parseAuthorityRecommendationResponse('{"authorityIds":["unknown"],"rationale":"A valid rationale for review."}', ['pdrm-kl-demo'])).toThrow();
    await expect(recommendAuthoritiesWithMiniMax('', input, { now: 12 })).resolves.toMatchObject({ status: 'unavailable', reason: 'MiniMax is not configured.' });
  });

  it('returns no_match when the maintained directory has no category candidate', async () => {
    await expect(recommendAuthoritiesWithMiniMax('secret', { ...input, authorities: [] }, { now: 12 })).resolves.toMatchObject({ status: 'no_match' });
  });

  it('keeps the AI payload free of Storage paths and contact details', () => {
    const payload = buildAuthorityRecommendationAiPayload({ ...input, evidence: [{ path: 'incident_evidence/private/photo.jpg', name: 'photo.jpg', mimeType: 'image/jpeg', size: 100, uploadedBy: 'reporter', uploadedAt: 12 }] });
    expect(JSON.stringify(payload)).not.toContain('incident_evidence');
    expect(JSON.stringify(payload)).not.toContain('contactPhone');
  });
});
