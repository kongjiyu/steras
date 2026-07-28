import { beforeEach, describe, expect, it } from 'vitest';
import { AssessmentContextSnapshot, DeterministicCategoryResult, EventRecord } from '@shared/types';
import {
  AIAdvisoryError,
  AI_TIMEOUT_MS,
  analyseWithAIOrFallback,
  buildAllowedInput,
  clearAICache,
  parseAIAdvisory,
  predictWithAI,
} from './aiPredictor';

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

const context: AssessmentContextSnapshot = {
  weather: {
    data: { forecast: 'Thunderstorm', temperature: 31, humidity: 85, windSpeed: 4, precipitationProbability: 80, severeAlert: true },
    source: 'openweather', freshness: 'fresh', fetchedAt: 1, expiresAt: 2, forecastFor: 10_000,
  },
  calendar: {
    localDate: '2026-07-21', dayOfWeek: 'Tuesday', isWeekend: false, isHolidayOrAdjacent: false,
    sourceVersion: 'test', sourceTimestamp: 1,
  },
  venue: { matched: true, venueId: 'venue-1', submittedCapacity: 10_000, registeredCapacity: 10_000, capacityDifference: 0, fetchedAt: 1 },
  incidentHistory: { matched: true, venueId: 'venue-1', incidentIds: [], total: 0, bySeverity: { low: 0, medium: 0, high: 0 }, fetchedAt: 1 },
};

const categoryIds = ['weather', 'crowd', 'venue', 'history', 'holiday'];
const officialResult: DeterministicCategoryResult = {
  categoryAssignments: categoryIds.map((categoryId, index) => ({
    categoryId,
    categoryName: categoryId,
    score: 20 + index,
    riskLevel: 'Low',
    weight: 0.2,
    weightedContribution: 4 + index * 0.2,
    rationale: `${categoryId} evidence`,
    evidenceKeys: [categoryId as 'weather'],
    guidelineChecks: [`prototype.${categoryId}`],
  })),
  officialScore: 32,
  officialRiskLevel: 'Low',
  evidence: [{ key: 'weather', description: 'Thunderstorm', sourceTimestamp: 1, source: 'openweather', status: 'fresh' }],
  categorySchemaVersion: 'test-category-v1',
  scoringLogicVersion: 'test-scoring-v1',
  categorySchemaStatus: 'prototype',
  computedAt: 1,
};

const validPayload = {
  overallBand: 'Medium',
  overallExplanation: 'Outdoor crowd and thunderstorm risks require authority attention.',
  categories: categoryIds.map((categoryId) => ({
    categoryId,
    advisoryBand: categoryId === 'weather' ? 'High' : 'Low',
    explanation: `Advisory explanation for ${categoryId}.`,
    evidenceReferences: [categoryId],
    keyConcerns: [],
    resourceConsiderations: [],
  })),
  keyConcerns: ['Thunderstorm exposure'],
  resourceConsiderations: ['Review wet-weather medical positioning'],
  citedEvidenceKeys: ['weather', 'crowd', 'venue', 'history', 'holiday'],
};
const validResponse = JSON.stringify(validPayload);

beforeEach(clearAICache);

describe('parseAIAdvisory', () => {
  it('accepts structured advisory analysis for every official category', () => {
    expect(parseAIAdvisory(validResponse, categoryIds)).toMatchObject({ overallBand: 'Medium', categories: expect.arrayContaining([expect.objectContaining({ categoryId: 'weather' })]) });
  });

  it('rejects score changes, resource quantities, and other unsupported fields', () => {
    expect(() => parseAIAdvisory(JSON.stringify({ ...validPayload, officialScore: 99 }), categoryIds)).toThrow(/unsupported fields/);
    expect(() => parseAIAdvisory(JSON.stringify({ ...validPayload, police: 20 }), categoryIds)).toThrow(/unsupported fields/);
  });

  it('rejects missing, duplicate, or unknown category analyses', () => {
    expect(() => parseAIAdvisory(JSON.stringify({ ...validPayload, categories: validPayload.categories.slice(1) }), categoryIds)).toThrow(/exactly/);
    const duplicate = validPayload.categories.map((category) => ({ ...category }));
    duplicate[1].categoryId = 'weather';
    expect(() => parseAIAdvisory(JSON.stringify({ ...validPayload, categories: duplicate }), categoryIds)).toThrow(/duplicate/);
  });

  it('rejects unknown evidence keys and scalar array fields', () => {
    expect(() => parseAIAdvisory(JSON.stringify({ ...validPayload, citedEvidenceKeys: ['organizer_reputation'] }), categoryIds)).toThrow(/evidence key/);
    expect(() => parseAIAdvisory(JSON.stringify({ ...validPayload, keyConcerns: 'none' }), categoryIds)).toThrow(/keyConcerns/);
  });
});

describe('predictWithAI', () => {
  it('allows MiniMax M3 enough time to return structured advisory output', () => {
    expect(AI_TIMEOUT_MS).toBe(30_000);
  });

  it('sends only the approved non-PII allowlist and the immutable official result', () => {
    const input = buildAllowedInput(event, context, officialResult);
    expect(input).not.toContain('Private');
    expect(input).not.toContain('private@');
    expect(input).not.toContain('+601');
    expect(input).not.toContain('private-user-id');
    expect(JSON.parse(input).officialResult).toMatchObject({ score: 32, riskLevel: 'Low', categorySchemaVersion: 'test-category-v1' });
  });

  it('caches successful parsed output by model, prompt, and allowlisted input', async () => {
    let requests = 0;
    const request = async () => { requests += 1; return validResponse; };
    const first = await predictWithAI('secret', event, context, officialResult, { now: 1_000, request });
    const second = await predictWithAI('secret', event, context, officialResult, { now: 2_000, request });
    expect(first.cacheStatus).toBe('miss');
    expect(second.cacheStatus).toBe('hit');
    expect(requests).toBe(1);
  });

  it('classifies timeout and unavailable failures without returning partial output', async () => {
    await expect(predictWithAI('secret', event, context, officialResult, {
      timeoutMs: 5,
      request: () => new Promise(() => undefined),
    })).rejects.toMatchObject({ kind: 'timeout' } satisfies Partial<AIAdvisoryError>);
    await expect(predictWithAI('secret', event, context, officialResult, {
      request: async () => { throw new Error('quota exceeded'); },
    })).rejects.toMatchObject({ kind: 'unavailable' } satisfies Partial<AIAdvisoryError>);
  });

  it.each([
    ['timeout', 'unavailable'],
    ['unavailable', 'unavailable'],
    ['invalid', 'invalid'],
  ] as const)('preserves the official result for %s failures', async (kind, status) => {
    const before = structuredClone(officialResult);
    const result = await analyseWithAIOrFallback('secret', event, context, officialResult, async () => {
      throw new AIAdvisoryError(kind, 'test failure');
    });
    expect(result).toMatchObject({ status, label: 'advisory', categories: [], cacheStatus: 'not-applicable' });
    expect(officialResult).toEqual(before);
  });
});
