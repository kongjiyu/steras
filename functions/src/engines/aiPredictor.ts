import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {
  AIRefinement,
  DeterministicBaseline,
  EvidenceKey,
  EventRecord,
  MAX_AI_ADJUSTMENT,
  WeatherContext,
} from '@shared/types';
import { DEFAULT_MINIMAX_BASE_URL, DEFAULT_MINIMAX_MODEL } from '../config/minimax';

export { DEFAULT_MINIMAX_BASE_URL, DEFAULT_MINIMAX_MODEL } from '../config/minimax';
export const PROMPT_VERSION = 'v2.3.0';
export const AI_TIMEOUT_MS = 9_000;
const MAX_RESPONSE_CHARS = 16_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 200;
const EVIDENCE_KEYS = new Set<EvidenceKey>(['weather', 'crowd', 'venue', 'history', 'holiday']);
const RESPONSE_KEYS = new Set(['proposedAdjustment', 'reasoning', 'compoundEffects', 'keyConcerns', 'citedEvidenceKeys']);
const CACHE = new Map<string, { value: AIRefinement; expiresAt: number }>();

interface AIRefinementPayload {
  proposedAdjustment: number;
  reasoning: string;
  compoundEffects: string[];
  keyConcerns: string[];
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

export class AIRefinementError extends Error {
  constructor(public readonly kind: 'invalid' | 'timeout' | 'unavailable', message: string) {
    super(message);
    this.name = 'AIRefinementError';
  }
}

export async function predictWithAI(
  apiKey: string,
  event: EventRecord,
  weather: WeatherContext,
  isHoliday: boolean,
  isWeekend: boolean,
  baseline: DeterministicBaseline,
  options: PredictOptions = {},
): Promise<AIRefinement> {
  const now = options.now ?? Date.now();
  const timeoutMs = options.timeoutMs ?? AI_TIMEOUT_MS;
  const model = options.model ?? process.env.MINIMAX_MODEL ?? DEFAULT_MINIMAX_MODEL;
  const user = buildAllowedInput(event, weather, isHoliday, isWeekend, baseline);
  const cacheKey = createHash('sha256').update(JSON.stringify({ model, promptVersion: PROMPT_VERSION, user })).digest('hex');
  const cached = CACHE.get(cacheKey);
  if (cached && cached.expiresAt > now) return { ...cached.value, cacheStatus: 'hit' };

  let text: string;
  try {
    if (options.request) {
      text = await withTimeout(options.request({ model, system: buildSystemPrompt(), user, maxTokens: 800 }), timeoutMs);
    } else {
      const client = new Anthropic({
        apiKey,
        baseURL: options.baseURL ?? process.env.MINIMAX_BASE_URL ?? DEFAULT_MINIMAX_BASE_URL,
        timeout: timeoutMs,
        maxRetries: 0,
      });
      const response = await client.messages.create({
        model,
        max_tokens: 800,
        temperature: 1,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: user }],
      });
      text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
    }
  } catch (error) {
    if (error instanceof AIRefinementError) throw error;
    const message = error instanceof Error ? error.message : 'Unknown MiniMax failure';
    const isTimeout = error instanceof Error && (error.name === 'AbortError' || /timeout|timed out/i.test(error.message));
    throw new AIRefinementError(isTimeout ? 'timeout' : 'unavailable', message);
  }

  const parsed = parseAIRefinement(text);
  const value: AIRefinement = {
    model,
    promptVersion: PROMPT_VERSION,
    status: 'success',
    ...parsed,
    validatedAdjustment: parsed.proposedAdjustment,
    cacheStatus: 'miss',
    generatedAt: now,
  };
  if (CACHE.size >= MAX_CACHE_ENTRIES) CACHE.delete(CACHE.keys().next().value as string);
  CACHE.set(cacheKey, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

export async function refineWithAIOrFallback(
  apiKey: string,
  event: EventRecord,
  weather: WeatherContext,
  isHoliday: boolean,
  isWeekend: boolean,
  baseline: DeterministicBaseline,
  predictor: typeof predictWithAI = predictWithAI,
): Promise<AIRefinement> {
  if (!apiKey) return unavailableAIRefinement('unavailable', 'MiniMax was not configured; the deterministic baseline is final.');
  try {
    return await predictor(apiKey, event, weather, isHoliday, isWeekend, baseline);
  } catch (error) {
    const kind = error instanceof AIRefinementError ? error.kind : 'unavailable';
    const invalid = kind === 'invalid';
    return unavailableAIRefinement(
      invalid ? 'invalid' : 'unavailable',
      `${invalid ? 'Invalid MiniMax output' : kind === 'timeout' ? 'MiniMax timed out' : 'MiniMax unavailable'}; deterministic baseline used.`,
    );
  }
}

export function unavailableAIRefinement(status: 'unavailable' | 'invalid', reasoning: string): AIRefinement {
  return {
    model: process.env.MINIMAX_MODEL ?? DEFAULT_MINIMAX_MODEL,
    promptVersion: PROMPT_VERSION,
    status,
    proposedAdjustment: 0,
    validatedAdjustment: 0,
    reasoning,
    compoundEffects: [],
    keyConcerns: [],
    citedEvidenceKeys: [],
    cacheStatus: 'not-applicable',
    generatedAt: Date.now(),
  };
}

export function parseAIRefinement(text: string): AIRefinementPayload {
  if (text.length > MAX_RESPONSE_CHARS) throw new AIRefinementError('invalid', 'MiniMax response exceeds the allowed size.');
  let value: unknown;
  try {
    value = JSON.parse(extractJson(text));
  } catch {
    throw new AIRefinementError('invalid', 'MiniMax response is not valid JSON.');
  }
  if (!isRecord(value)) throw new AIRefinementError('invalid', 'MiniMax response must be a JSON object.');
  const unknownKeys = Object.keys(value).filter((key) => !RESPONSE_KEYS.has(key));
  if (unknownKeys.length > 0) throw new AIRefinementError('invalid', `MiniMax response contains unsupported fields: ${unknownKeys.join(', ')}.`);
  const proposedAdjustment = value.proposedAdjustment;
  if (!Number.isInteger(proposedAdjustment) || (proposedAdjustment as number) < 0 || (proposedAdjustment as number) > MAX_AI_ADJUSTMENT) {
    throw new AIRefinementError('invalid', `proposedAdjustment must be an integer from 0 to ${MAX_AI_ADJUSTMENT}.`);
  }
  if (typeof value.reasoning !== 'string' || value.reasoning.trim().length === 0 || value.reasoning.length > 2_000) {
    throw new AIRefinementError('invalid', 'reasoning must be a non-empty string of at most 2,000 characters.');
  }
  const compoundEffects = readStringArray(value.compoundEffects, 'compoundEffects');
  const keyConcerns = readStringArray(value.keyConcerns, 'keyConcerns');
  const citedEvidenceKeys = readStringArray(value.citedEvidenceKeys, 'citedEvidenceKeys');
  if (!citedEvidenceKeys.every((key): key is EvidenceKey => EVIDENCE_KEYS.has(key as EvidenceKey))) {
    throw new AIRefinementError('invalid', 'citedEvidenceKeys contains an unknown evidence key.');
  }
  return { proposedAdjustment: proposedAdjustment as number, reasoning: value.reasoning.trim(), compoundEffects, keyConcerns, citedEvidenceKeys };
}

export function buildAllowedInput(
  event: EventRecord,
  weather: WeatherContext,
  isHoliday: boolean,
  isWeekend: boolean,
  baseline: DeterministicBaseline,
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
    context: { weather, isHoliday, isWeekend },
    baseline: {
      subScores: baseline.subScores,
      weightedContributions: baseline.weightedContributions,
      score: baseline.baselineScore,
      riskLevel: baseline.baselineRiskLevel,
      evidence: baseline.evidence,
    },
  });
}

export function clearAICache(): void {
  CACHE.clear();
}

function buildSystemPrompt(): string {
  return `You refine a deterministic safety assessment for Malaysian tourism events. The baseline is authoritative. Identify only compound risks supported by the supplied evidence.

Return only one JSON object matching this exact shape:
{"proposedAdjustment":0,"reasoning":"Concise evidence-based explanation.","compoundEffects":[],"keyConcerns":[],"citedEvidenceKeys":[]}

Schema rules:
- proposedAdjustment: integer from 0 to ${MAX_AI_ADJUSTMENT}
- reasoning: non-empty string
- compoundEffects: array of strings; use [] when none
- keyConcerns: array of strings; use [] when none
- citedEvidenceKeys: array containing only weather, crowd, venue, history, or holiday; use [] when none

Do not add fields, Markdown, a final score, or resource quantities.`;
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  return first >= 0 && last > first ? text.slice(first, last + 1) : text.trim();
}

function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 10 || !value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 100)) {
    throw new AIRefinementError('invalid', `${field} must be an array of at most 10 non-empty short strings.`);
  }
  return value;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new AIRefinementError('timeout', `MiniMax request timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
