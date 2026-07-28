import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {
  AIAdvisoryAnalysis,
  AIAdvisoryCategoryAnalysis,
  AssessmentContextSnapshot,
  DeterministicCategoryResult,
  EvidenceKey,
  EventRecord,
  RESOURCE_GUIDELINE_VERSION,
  RiskLevel,
} from '@shared/types';
import { DEFAULT_MINIMAX_BASE_URL, DEFAULT_MINIMAX_MODEL } from '../config/minimax';
import { GUIDELINES } from '../config/standardsRegistry';

export { DEFAULT_MINIMAX_BASE_URL, DEFAULT_MINIMAX_MODEL } from '../config/minimax';
export const PROMPT_VERSION = 'v4.0.0-all-hazards-evidence-advisory';
export const AI_RESPONSE_SCHEMA_VERSION = '2026-07-24-all-hazards-advisory-v2';
export const AI_TIMEOUT_MS = 30_000;

const MAX_RESPONSE_CHARS = 24_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 200;
const EVIDENCE_KEYS = new Set<EvidenceKey>([
  'weather', 'crowd', 'venue', 'history', 'holiday', 'public_health',
  'sanitation', 'medical', 'security', 'transport', 'compliance',
]);
const RISK_LEVELS = new Set<RiskLevel>(['Low', 'Medium', 'High']);
const RESPONSE_KEYS = new Set(['overallBand', 'overallExplanation', 'categories', 'keyConcerns', 'resourceConsiderations', 'citedEvidenceKeys']);
const CATEGORY_KEYS = new Set(['categoryId', 'advisoryBand', 'explanation', 'evidenceReferences', 'keyConcerns', 'resourceConsiderations']);
const CACHE = new Map<string, { value: AIAdvisoryAnalysis; expiresAt: number }>();

interface AIAdvisoryPayload {
  overallBand: RiskLevel;
  overallExplanation: string;
  categories: AIAdvisoryCategoryAnalysis[];
  keyConcerns: string[];
  resourceConsiderations: string[];
  citedEvidenceKeys: EvidenceKey[];
}

interface AIRequest {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}

interface PredictOptions {
  model?: string;
  baseURL?: string;
  now?: number;
  timeoutMs?: number;
  request?: (request: AIRequest) => Promise<string>;
}

export class AIAdvisoryError extends Error {
  constructor(public readonly kind: 'invalid' | 'timeout' | 'unavailable', message: string) {
    super(message);
    this.name = 'AIAdvisoryError';
  }
}

export async function predictWithAI(
  apiKey: string,
  event: EventRecord,
  context: AssessmentContextSnapshot,
  officialResult: DeterministicCategoryResult,
  options: PredictOptions = {},
): Promise<AIAdvisoryAnalysis> {
  const now = options.now ?? Date.now();
  const timeoutMs = options.timeoutMs ?? AI_TIMEOUT_MS;
  const model = options.model ?? process.env.MINIMAX_MODEL ?? DEFAULT_MINIMAX_MODEL;
  const categoryIds = officialResult.categoryAssignments.map((category) => category.categoryId);
  const user = buildAllowedInput(event, context, officialResult);
  const cacheKey = createHash('sha256').update(JSON.stringify({ model, promptVersion: PROMPT_VERSION, user })).digest('hex');
  const cached = CACHE.get(cacheKey);
  if (cached && cached.expiresAt > now) return { ...cached.value, cacheStatus: 'hit' };

  let text: string;
  try {
    if (options.request) {
      text = await withTimeout(options.request({ model, system: buildSystemPrompt(categoryIds), user, maxTokens: 1_600 }), timeoutMs);
    } else {
      const client = new Anthropic({
        apiKey,
        baseURL: options.baseURL ?? process.env.MINIMAX_BASE_URL ?? DEFAULT_MINIMAX_BASE_URL,
        timeout: timeoutMs,
        maxRetries: 0,
      });
      const response = await client.messages.create({
        model,
        max_tokens: 1_600,
        temperature: 0.1,
        system: buildSystemPrompt(categoryIds),
        messages: [{ role: 'user', content: user }],
      });
      text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
    }
  } catch (error) {
    if (error instanceof AIAdvisoryError) throw error;
    const message = error instanceof Error ? error.message : 'Unknown MiniMax failure';
    const isTimeout = error instanceof Error && (error.name === 'AbortError' || /timeout|timed out/i.test(error.message));
    throw new AIAdvisoryError(isTimeout ? 'timeout' : 'unavailable', message);
  }

  const parsed = parseAIAdvisory(text, categoryIds);
  const value: AIAdvisoryAnalysis = {
    model,
    promptVersion: PROMPT_VERSION,
    responseSchemaVersion: AI_RESPONSE_SCHEMA_VERSION,
    status: 'success',
    label: 'advisory',
    ...parsed,
    cacheStatus: 'miss',
    generatedAt: now,
  };
  if (CACHE.size >= MAX_CACHE_ENTRIES) CACHE.delete(CACHE.keys().next().value as string);
  CACHE.set(cacheKey, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

export async function analyseWithAIOrFallback(
  apiKey: string,
  event: EventRecord,
  context: AssessmentContextSnapshot,
  officialResult: DeterministicCategoryResult,
  predictor: typeof predictWithAI = predictWithAI,
): Promise<AIAdvisoryAnalysis> {
  if (!apiKey) return unavailableAIAdvisory('unavailable', 'MiniMax was not configured; the official deterministic category result remains available.');
  try {
    return await predictor(apiKey, event, context, officialResult);
  } catch (error) {
    const kind = error instanceof AIAdvisoryError ? error.kind : 'unavailable';
    const invalid = kind === 'invalid';
    const detail = error instanceof Error ? error.message : 'Unknown MiniMax failure';
    return unavailableAIAdvisory(
      invalid ? 'invalid' : 'unavailable',
      `${invalid ? `Invalid MiniMax output: ${detail}` : kind === 'timeout' ? 'MiniMax timed out' : 'MiniMax unavailable'}; the official deterministic category result was preserved.`,
    );
  }
}

export function unavailableAIAdvisory(status: 'unavailable' | 'invalid', explanation: string): AIAdvisoryAnalysis {
  return {
    model: process.env.MINIMAX_MODEL ?? DEFAULT_MINIMAX_MODEL,
    promptVersion: PROMPT_VERSION,
    responseSchemaVersion: AI_RESPONSE_SCHEMA_VERSION,
    status,
    label: 'advisory',
    overallExplanation: explanation,
    categories: [],
    keyConcerns: [],
    resourceConsiderations: [],
    citedEvidenceKeys: [],
    cacheStatus: 'not-applicable',
    generatedAt: Date.now(),
  };
}

export function parseAIAdvisory(text: string, allowedCategoryIds: string[]): AIAdvisoryPayload {
  if (text.length > MAX_RESPONSE_CHARS) throw new AIAdvisoryError('invalid', 'MiniMax response exceeds the allowed size.');
  let value: unknown;
  try {
    value = JSON.parse(extractJson(text));
  } catch {
    throw new AIAdvisoryError('invalid', 'MiniMax response is not valid JSON.');
  }
  if (!isRecord(value)) throw new AIAdvisoryError('invalid', 'MiniMax response must be a JSON object.');
  rejectUnknownKeys(value, RESPONSE_KEYS, 'MiniMax response');

  const overallBand = readRiskLevel(value.overallBand, 'overallBand');
  const overallExplanation = readText(value.overallExplanation, 'overallExplanation', 2_000);
  const categories = readCategories(value.categories, allowedCategoryIds);
  const keyConcerns = readStringArray(value.keyConcerns, 'keyConcerns', 10, 200);
  const resourceConsiderations = readStringArray(value.resourceConsiderations, 'resourceConsiderations', 10, 300);
  const citedEvidenceKeys = readEvidenceKeys(value.citedEvidenceKeys, 'citedEvidenceKeys');
  return { overallBand, overallExplanation, categories, keyConcerns, resourceConsiderations, citedEvidenceKeys };
}

export function buildAllowedInput(
  event: EventRecord,
  context: AssessmentContextSnapshot,
  officialResult: DeterministicCategoryResult,
): string {
  const details = event.eventDetails;
  return JSON.stringify({
    event: {
      type: details.type,
      expectedAttendance: details.expectedAttendance,
      venueCapacity: details.venueCapacity,
      capacityUtilization: details.venueCapacity > 0 ? details.expectedAttendance / details.venueCapacity : null,
      environment: details.environment,
      coverage: details.coverage,
      seating: details.seating,
      durationHours: Math.max(0, details.endDatetime - details.startDatetime) / 3_600_000,
    },
    context: {
      weather: context.weather,
      calendar: context.calendar,
      venue: {
        matched: context.venue.matched,
        submittedCapacity: context.venue.submittedCapacity,
        registeredCapacity: context.venue.registeredCapacity,
        capacityDifference: context.venue.capacityDifference,
      },
      incidentHistory: {
        matched: context.incidentHistory.matched,
        total: context.incidentHistory.total,
        bySeverity: context.incidentHistory.bySeverity,
        historicalEventCount: context.incidentHistory.historicalEventCount,
        totalAttendance: context.incidentHistory.totalAttendance,
        totalAttendeeHours: context.incidentHistory.totalAttendeeHours,
        patientPresentationRatePerThousand: context.incidentHistory.patientPresentationRatePerThousand,
        hospitalTransferRatePerThousand: context.incidentHistory.hospitalTransferRatePerThousand,
        incidentRatePerThousandAttendeeHours: context.incidentHistory.incidentRatePerThousandAttendeeHours,
        comparableEvents: context.incidentHistory.comparableEvents,
        syntheticEvidence: context.incidentHistory.syntheticEvidence ?? false,
      },
    },
    officialResult: {
      score: officialResult.officialScore,
      riskLevel: officialResult.officialRiskLevel,
      categorySchemaVersion: officialResult.categorySchemaVersion,
      scoringLogicVersion: officialResult.scoringLogicVersion,
      categories: officialResult.categoryAssignments,
      evidence: officialResult.evidence,
      assessmentReadiness: officialResult.assessmentReadiness,
      complianceStatus: officialResult.complianceStatus,
      complianceChecks: officialResult.complianceChecks,
      hazards: officialResult.hazards,
      domainSummaries: officialResult.domainSummaries,
      dataConfidenceScore: officialResult.dataConfidenceScore,
      manualReviewRequired: officialResult.manualReviewRequired,
    },
    applicableGuidance: guidelinePayload(officialResult),
    resourceGuidance: {
      version: RESOURCE_GUIDELINE_VERSION,
      status: 'prototype-unverified',
    },
  });
}

export function clearAICache(): void {
  CACHE.clear();
}

function buildSystemPrompt(categoryIds: string[]): string {
  const categoryTemplate = categoryIds.map((categoryId) => ({
    categoryId,
    advisoryBand: 'Low',
    explanation: `Evidence-based explanation for ${categoryId}.`,
    evidenceReferences: [categoryEvidenceKey(categoryId)],
    keyConcerns: [],
    resourceConsiderations: [],
  }));
  return `You provide advisory all-hazards analysis for Malaysian tourism-event safety. The deterministic hazard result and compliance checks are official and immutable. Explain only supplied evidence, distinguish synthetic history from real evidence, identify missing information, and suggest contextual safety or resource considerations. Do not change any score, quantity, category assignment, compliance result, or approval outcome.

Return only one JSON object matching this exact shape:
${JSON.stringify({
    overallBand: 'Low',
    overallExplanation: 'Concise evidence-based explanation.',
    categories: categoryTemplate,
    keyConcerns: [],
    resourceConsiderations: [],
    citedEvidenceKeys: [],
  })}

Schema rules:
- overallBand and advisoryBand: Low, Medium, or High; these are advisory labels only
- categories: keep exactly the ${categoryIds.length} items in the template, with these categoryIds and no duplicates: ${categoryIds.join(', ')}
- evidenceReferences and citedEvidenceKeys: use only weather, crowd, venue, history, holiday, public_health, sanitation, medical, security, transport, or compliance; cite each relevant key at most once
- all concerns and considerations: arrays of short strings; use [] when none
- explanations: non-empty evidence-based strings

Do not add fields, Markdown, numeric scores, resource quantities, approval decisions, or personal data.`;
}

function categoryEvidenceKey(categoryId: string): EvidenceKey {
  const mapping: Record<string, EvidenceKey> = {
    crowd: 'crowd',
    venue_fire: 'venue',
    weather_environment: 'weather',
    public_health: 'public_health',
    food_water_sanitation: 'sanitation',
    medical_capacity: 'medical',
    security_cbrn: 'security',
    transport_accessibility: 'transport',
  };
  return mapping[categoryId] ?? 'compliance';
}

function guidelinePayload(officialResult: DeterministicCategoryResult) {
  const ids = new Set(officialResult.categoryAssignments.flatMap((category) => category.guidelineChecks));
  return [...ids].map((id) => GUIDELINES[id]).filter(Boolean).map((guideline) => ({
    id: guideline.id,
    title: guideline.title,
    issuer: guideline.issuer,
    kind: guideline.kind,
    jurisdiction: guideline.jurisdiction,
    url: guideline.url,
    note: guideline.note,
  }));
}

function readCategories(value: unknown, allowedCategoryIds: string[]): AIAdvisoryCategoryAnalysis[] {
  if (!Array.isArray(value) || value.length !== allowedCategoryIds.length) {
    throw new AIAdvisoryError('invalid', `categories must contain exactly ${allowedCategoryIds.length} items.`);
  }
  const allowed = new Set(allowedCategoryIds);
  const seen = new Set<string>();
  const categories = value.map((item, index) => {
    if (!isRecord(item)) throw new AIAdvisoryError('invalid', `categories[${index}] must be an object.`);
    rejectUnknownKeys(item, CATEGORY_KEYS, `categories[${index}]`);
    const categoryId = readText(item.categoryId, `categories[${index}].categoryId`, 100);
    if (!allowed.has(categoryId) || seen.has(categoryId)) throw new AIAdvisoryError('invalid', `categories contains an unknown or duplicate categoryId: ${categoryId}.`);
    seen.add(categoryId);
    return {
      categoryId,
      advisoryBand: readRiskLevel(item.advisoryBand, `categories[${index}].advisoryBand`),
      explanation: readText(item.explanation, `categories[${index}].explanation`, 2_000),
      evidenceReferences: readEvidenceKeys(item.evidenceReferences, `categories[${index}].evidenceReferences`),
      keyConcerns: readStringArray(item.keyConcerns, `categories[${index}].keyConcerns`, 10, 200),
      resourceConsiderations: readStringArray(item.resourceConsiderations, `categories[${index}].resourceConsiderations`, 10, 300),
    };
  });
  return categories;
}

function readRiskLevel(value: unknown, field: string): RiskLevel {
  if (typeof value !== 'string' || !RISK_LEVELS.has(value as RiskLevel)) throw new AIAdvisoryError('invalid', `${field} must be Low, Medium, or High.`);
  return value as RiskLevel;
}

function readEvidenceKeys(value: unknown, field: string): EvidenceKey[] {
  const keys = readStringArray(value, field, EVIDENCE_KEYS.size, 100);
  if (!keys.every((key): key is EvidenceKey => EVIDENCE_KEYS.has(key as EvidenceKey))) {
    throw new AIAdvisoryError('invalid', `${field} contains an unknown evidence key.`);
  }
  return keys;
}

function readText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new AIAdvisoryError('invalid', `${field} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value.trim();
}

function readStringArray(value: unknown, field: string, maxItems: number, maxItemLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems || !value.every((item) => typeof item === 'string' && item.trim().length > 0 && item.length <= maxItemLength)) {
    throw new AIAdvisoryError('invalid', `${field} must be an array of at most ${maxItems} non-empty short strings.`);
  }
  return value.map((item) => (item as string).trim());
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, field: string): void {
  const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) throw new AIAdvisoryError('invalid', `${field} contains unsupported fields: ${unknownKeys.join(', ')}.`);
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  return first >= 0 && last > first ? text.slice(first, last + 1) : text.trim();
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new AIAdvisoryError('timeout', `MiniMax request timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
