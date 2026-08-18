import { beforeEach, describe, expect, it } from 'vitest';
import { AssessmentContextSnapshot, DeterministicCategoryResult, EventRecord } from '@shared/types';
import { ACTIVE_CATEGORY_SCHEMA } from '../config/categorySchema';
import {
  AIProposalError,
  AI_TIMEOUT_MS,
  analyseWithAI,
  buildAllowedInput,
  clearAICache,
  parseAIProposal,
  predictWithAI,
} from './aiPredictor';

const event = {
  eventId: 'private-event-id', organizerId: 'private-user-id', status: 'Pending', currentVersionNumber: 1,
  draftDocumentPaths: [], requiredAuthorities: ['PDRM'], createdAt: 1, updatedAt: 1,
  eventDetails: {
    name: 'Private Event Name', type: 'festival', venueName: 'Private Venue Name', venueAddress: 'Private Address',
    venueCapacity: 10_000, expectedAttendance: 8_000, environment: 'outdoor', coverage: 'uncovered', seating: 'mixed',
    startDatetime: 10_000, endDatetime: 20_000, emergencyPlanSummary: 'Private emergency plan',
    organizerName: 'Private Person', organizerEmail: 'private@example.com', organizerPhone: '+60111111111',
  },
} satisfies EventRecord;

const context: AssessmentContextSnapshot = {
  weather: { data: { forecast: 'Thunderstorm', temperature: 31, humidity: 85, windSpeed: 4, precipitationProbability: 80, severeAlert: true }, source: 'openweather', freshness: 'fresh', fetchedAt: 1, expiresAt: 2, forecastFor: 10_000 },
  calendar: { localDate: '2026-07-21', dayOfWeek: 'Tuesday', isWeekend: false, isHolidayOrAdjacent: false, sourceVersion: 'test', sourceTimestamp: 1 },
  venue: { matched: true, venueId: 'venue-1', submittedCapacity: 10_000, registeredCapacity: 10_000, capacityDifference: 0, fetchedAt: 1 },
  incidentHistory: { matched: true, venueId: 'venue-1', incidentIds: [], total: 0, bySeverity: { low: 0, medium: 0, high: 0 }, fetchedAt: 1 },
};

const categoryIds = ACTIVE_CATEGORY_SCHEMA.categories.map((category) => category.id);
const baseline = {
  categoryAssignments: [], officialScore: 20, officialRiskLevel: 'Low', evidence: [
    { key: 'weather', description: 'Thunderstorm', sourceTimestamp: 1, source: 'openweather', status: 'fresh' },
  ], categorySchemaVersion: 'test', scoringLogicVersion: 'test', categorySchemaStatus: 'prototype', computedAt: 1,
} satisfies DeterministicCategoryResult;
const validPayload = {
  hazards: [{ hazardId: 'weather.storm', hazardName: 'Storm', categoryId: 'weather_environment', evidenceReferences: ['weather'], rationale: 'Severe alert.' }],
  categories: categoryIds.map((categoryId) => ({
    categoryId, likelihood: 2, severity: 3, evidenceReferences: ['weather'], rationale: `${categoryId} rationale`, confidence: 'medium', concerns: [], missingInformation: [],
  })),
};
const validResponse = JSON.stringify(validPayload);

beforeEach(clearAICache);

describe('parseAIProposal', () => {
  it('accepts integer scores for every configured category', () => {
    expect(parseAIProposal(validResponse, categoryIds).categories).toHaveLength(categoryIds.length);
  });

  it('rejects missing, duplicate, unknown, fractional, and out-of-range scores', () => {
    expect(() => parseAIProposal(JSON.stringify({ ...validPayload, categories: validPayload.categories.slice(1) }), categoryIds)).toThrow(/exactly/);
    const duplicate = structuredClone(validPayload); duplicate.categories[1].categoryId = duplicate.categories[0].categoryId;
    expect(() => parseAIProposal(JSON.stringify(duplicate), categoryIds)).toThrow(/duplicate/);
    for (const likelihood of [0, 6, 2.5]) {
      const invalid = structuredClone(validPayload); invalid.categories[0].likelihood = likelihood;
      expect(() => parseAIProposal(JSON.stringify(invalid), categoryIds)).toThrow(/integer from 1 to 5/);
    }
  });

  it('rejects invalid JSON, unknown evidence, and unsupported fields', () => {
    expect(() => parseAIProposal('{bad', categoryIds)).toThrow(/valid JSON/);
    expect(() => parseAIProposal(JSON.stringify({ ...validPayload, officialScore: 99 }), categoryIds)).toThrow(/unsupported fields/);
    const invalid = structuredClone(validPayload); invalid.categories[0].evidenceReferences = ['organizer_reputation'];
    expect(() => parseAIProposal(JSON.stringify(invalid), categoryIds)).toThrow(/evidence key/);
  });
});

describe('predictWithAI', () => {
  it('uses the configured timeout and sends an allowlisted input without PII', () => {
    expect(AI_TIMEOUT_MS).toBe(30_000);
    const hostileContext = structuredClone(context);
    hostileContext.venue.venueId = 'internal-venue-id';
    hostileContext.venue.riskNotes = 'Call Private Person at private-context@example.com or +60129999999';
    hostileContext.incidentHistory.venueId = 'history-venue-id';
    hostileContext.incidentHistory.incidentIds = ['private-incident-id'];
    hostileContext.incidentHistory.historicalEventIds = ['private-history-id'];
    hostileContext.incidentHistory.comparableEvents = [{
      historicalEventId: 'raw-comparable-id', venueId: 'raw-venue-id', eventType: 'festival', attendance: 10,
      attendeeHours: 20, similarityScore: 5, patientPresentations: 0, hospitalTransfers: 0, incidentCount: 0, synthetic: false,
    }];
    const hostileBaseline = structuredClone(baseline);
    hostileBaseline.evidence[0].description = 'private-evidence@example.com +60128888888';
    hostileBaseline.evidence[0].source = 'private-source-id';
    const hostileEvent = structuredClone(event) as EventRecord;
    hostileEvent.eventDetails.riskProfile = {
      medicalPlan: true,
      verifiedControlIds: ['medical-plan', 'private-control@example.com'],
      hiddenContact: 'private-profile@example.com',
    } as EventRecord['eventDetails']['riskProfile'];
    const input = buildAllowedInput(hostileEvent, hostileContext, hostileBaseline);
    expect(input).not.toContain('Private');
    expect(input).not.toContain('private@');
    expect(input).not.toContain('+601');
    expect(input).not.toContain('private-user-id');
    expect(input).not.toContain('internal-venue-id');
    expect(input).not.toContain('private-incident-id');
    expect(input).not.toContain('private-history-id');
    expect(input).not.toContain('raw-comparable-id');
    expect(input).not.toContain('private-source-id');
    expect(input).not.toContain('private-profile@example.com');
    expect(input).not.toContain('private-control@example.com');
    const parsed = JSON.parse(input);
    expect(parsed).toHaveProperty('rubric');
    expect(parsed).not.toHaveProperty('officialResult');
    expect(parsed.context.venue).not.toHaveProperty('riskNotes');
    expect(parsed.context.incidentHistory).not.toHaveProperty('comparableEvents');
    expect(parsed.evidence[0]).toEqual({ key: 'weather', status: 'fresh', sourceTimestamp: 1 });
  });

  it('caches successful proposals by model, prompt, and input', async () => {
    let requests = 0;
    const request = async () => { requests += 1; return validResponse; };
    expect((await predictWithAI('secret', event, context, baseline, { now: 1_000, request })).cacheStatus).toBe('miss');
    expect((await predictWithAI('secret', event, context, baseline, { now: 2_000, request })).cacheStatus).toBe('hit');
    expect(requests).toBe(1);
  });

  it('returns failure attempts without fabricated categories', async () => {
    const result = await analyseWithAI('secret', event, context, baseline, async () => {
      throw new AIProposalError('timeout', 'test timeout');
    });
    expect(result).toMatchObject({ status: 'timeout', retryable: true, cacheStatus: 'not-applicable' });
    expect(result).not.toHaveProperty('categories');
  });

  it.each(['unavailable', 'timeout', 'invalid'] as const)(
    'marks %s output as retryable without fabricated scores',
    async (status) => {
      const result = await analyseWithAI('secret', event, context, baseline, async () => {
        throw new AIProposalError(status, `test ${status}`);
      });
      expect(result).toMatchObject({ status, retryable: true });
      expect(result).not.toHaveProperty('categories');
    },
  );
});
