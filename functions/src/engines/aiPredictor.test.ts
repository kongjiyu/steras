import { beforeEach, describe, expect, it } from 'vitest';
import { DeterministicBaseline, EventRecord, WeatherContext } from '@shared/types';
import { AIRefinementError, AI_TIMEOUT_MS, buildAllowedInput, clearAICache, parseAIRefinement, predictWithAI, refineWithAIOrFallback } from './aiPredictor';

const event: EventRecord = {
  eventId: 'private-event-id', organizerId: 'private-user-id', status: 'Pending', currentVersionNumber: 1,
  draftDocumentPaths: [], requiredAuthorities: ['PDRM'], createdAt: 1, updatedAt: 1,
  eventDetails: {
    name: 'Private Event Name', type: 'festival', venueName: 'Private Venue Name', venueAddress: 'Private Address',
    venueCapacity: 10_000, expectedAttendance: 8_000, environment: 'outdoor', coverage: 'uncovered', seating: 'mixed',
    startDatetime: 10_000, endDatetime: 20_000, emergencyPlanSummary: 'Private emergency plan',
    organizerName: 'Private Person', organizerEmail: 'private@example.com', organizerPhone: '+60111111111',
  },
};
const weather: WeatherContext = { forecast: 'Thunderstorm', temperature: 31, humidity: 85, windSpeed: 4, precipitationProbability: 80, severeAlert: true };
const baseline: DeterministicBaseline = {
  subScores: { weather: 50, crowd: 40, venue: 30, history: 5, holiday: 0 },
  weightedContributions: { weather: 15, crowd: 10, venue: 6, history: 0.75, holiday: 0 },
  baselineScore: 32, baselineRiskLevel: 'Low',
  evidence: [{ key: 'weather', description: 'Thunderstorm', sourceTimestamp: 1 }],
  ruleVersion: 'test', computedAt: 1,
};
const validResponse = JSON.stringify({
  proposedAdjustment: 8,
  reasoning: 'Outdoor crowd and thunderstorm risks compound.',
  compoundEffects: ['weather_and_outdoor_crowd'],
  keyConcerns: ['thunderstorm'],
  citedEvidenceKeys: ['weather', 'crowd', 'venue'],
});

beforeEach(clearAICache);

describe('parseAIRefinement', () => {
  it('accepts a valid bounded refinement', () => {
    expect(parseAIRefinement(validResponse).proposedAdjustment).toBe(8);
  });

  it.each([-1, 16, 2.5])('rejects adjustment %s', (proposedAdjustment) => {
    expect(() => parseAIRefinement(JSON.stringify({ ...JSON.parse(validResponse), proposedAdjustment }))).toThrow(/proposedAdjustment/);
  });

  it('rejects evidence keys that were not supplied by the server', () => {
    expect(() => parseAIRefinement(JSON.stringify({ ...JSON.parse(validResponse), citedEvidenceKeys: ['organizer_reputation'] }))).toThrow(/evidence key/);
  });

  it('rejects extra fields and oversized responses', () => {
    expect(() => parseAIRefinement(JSON.stringify({ ...JSON.parse(validResponse), finalScore: 99 }))).toThrow(/unsupported fields/);
    expect(() => parseAIRefinement('x'.repeat(16_001))).toThrow(/allowed size/);
  });

  it('rejects scalar values where the response contract requires arrays', () => {
    expect(() => parseAIRefinement(JSON.stringify({ ...JSON.parse(validResponse), compoundEffects: 'none' }))).toThrow(/compoundEffects/);
  });
});

describe('predictWithAI', () => {
  it('keeps the AI deadline below the 15-second fallback requirement', () => {
    expect(AI_TIMEOUT_MS).toBeLessThan(15_000);
  });
  it('sends only the approved non-PII allowlist', () => {
    const input = buildAllowedInput(event, weather, false, false, baseline);
    expect(input).not.toContain('Private');
    expect(input).not.toContain('private@');
    expect(input).not.toContain('+601');
    expect(input).not.toContain('private-user-id');
    expect(JSON.parse(input).event).toEqual({
      type: 'festival', expectedAttendance: 8_000, venueCapacity: 10_000, capacityUtilization: 0.8,
      environment: 'outdoor', coverage: 'uncovered', seating: 'mixed', durationHours: 10_000 / 3_600_000,
    });
  });

  it('caches successful parsed output by model, prompt, and allowlisted input', async () => {
    let requests = 0;
    const request = async () => { requests += 1; return validResponse; };
    const first = await predictWithAI('secret', event, weather, false, false, baseline, { now: 1_000, request });
    const second = await predictWithAI('secret', event, weather, false, false, baseline, { now: 2_000, request });
    expect(first.cacheStatus).toBe('miss');
    expect(second.cacheStatus).toBe('hit');
    expect(requests).toBe(1);
  });

  it('classifies timeout and unavailable failures without returning partial output', async () => {
    await expect(predictWithAI('secret', event, weather, false, false, baseline, {
      timeoutMs: 5,
      request: () => new Promise(() => undefined),
    })).rejects.toMatchObject({ kind: 'timeout' } satisfies Partial<AIRefinementError>);
    await expect(predictWithAI('secret', event, weather, false, false, baseline, {
      request: async () => { throw new Error('quota exceeded'); },
    })).rejects.toMatchObject({ kind: 'unavailable' } satisfies Partial<AIRefinementError>);
  });

  it.each([
    ['timeout', 'unavailable'],
    ['unavailable', 'unavailable'],
    ['invalid', 'invalid'],
  ] as const)('falls back to baseline for %s failures', async (kind, status) => {
    const result = await refineWithAIOrFallback('secret', event, weather, false, false, baseline, async () => {
      throw new AIRefinementError(kind, 'test failure');
    });
    expect(result).toMatchObject({ status, proposedAdjustment: 0, validatedAdjustment: 0, cacheStatus: 'not-applicable' });
  });
});
