import Anthropic from '@anthropic-ai/sdk';
import type { EventRecord } from '@shared/types';
import {
  M4_AI_AUTHORITY_PROMPT_VERSION,
  type M4AIAssessment,
  type M4AuthorityDirectoryEntry,
  type M4AuthorityRecommendation,
  type M4EvidenceRef,
  type M4IncidentCategory,
} from '@shared/m4';
import { DEFAULT_MINIMAX_BASE_URL, DEFAULT_MINIMAX_MODEL } from '../config/minimax';

export const INCIDENT_AUTHORITY_RECOMMENDATION_TIMEOUT_MS = 10_000;

const MAX_RESPONSE_CHARS = 10_000;
const RESPONSE_KEYS = new Set(['authorityIds', 'rationale']);

export interface IncidentAuthorityRecommendationInput {
  category: M4IncidentCategory;
  description: string;
  location: string;
  occurredAt: number;
  evidence: M4EvidenceRef[];
  event: EventRecord;
  assessment: M4AIAssessment;
  authorities: M4AuthorityDirectoryEntry[];
}

export interface IncidentAuthorityRecommendationRequest {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}

export interface IncidentAuthorityRecommendationOptions {
  model?: string;
  baseURL?: string;
  timeoutMs?: number;
  now?: number;
  request?: (request: IncidentAuthorityRecommendationRequest) => Promise<string>;
}

export async function recommendAuthoritiesWithMiniMax(
  apiKey: string,
  input: IncidentAuthorityRecommendationInput,
  options: IncidentAuthorityRecommendationOptions = {},
): Promise<M4AuthorityRecommendation> {
  const now = options.now ?? Date.now();
  const model = options.model ?? process.env.MINIMAX_MODEL ?? DEFAULT_MINIMAX_MODEL;
  const eligibleAuthorities = input.authorities.filter((entry) => entry.active && entry.serviceCategories.includes(input.category));

  if (eligibleAuthorities.length === 0) {
    return {
      status: 'no_match', promptVersion: M4_AI_AUTHORITY_PROMPT_VERSION,
      reason: 'No active authority supports this incident category.', assessedAt: now,
    };
  }
  if (!apiKey.trim()) {
    return {
      status: 'unavailable', promptVersion: M4_AI_AUTHORITY_PROMPT_VERSION,
      reason: 'MiniMax is not configured.', assessedAt: now,
    };
  }

  let raw: string;
  try {
    const user = JSON.stringify(buildAuthorityRecommendationAiPayload(input, eligibleAuthorities));
    raw = options.request
      ? await withTimeout(options.request({
        model,
        system: buildAuthorityRecommendationSystemPrompt(),
        user,
        maxTokens: 400,
      }), options.timeoutMs ?? INCIDENT_AUTHORITY_RECOMMENDATION_TIMEOUT_MS)
      : await requestFromMiniMax(apiKey, model, user, options);
  } catch (error) {
    return {
      status: 'unavailable', promptVersion: M4_AI_AUTHORITY_PROMPT_VERSION,
      reason: errorReason(error, 'MiniMax authority recommendation was unavailable.'), assessedAt: now,
    };
  }

  try {
    const parsed = parseAuthorityRecommendationResponse(raw, eligibleAuthorities.map((entry) => entry.authorityId));
    if (parsed.authorityIds.length === 0) {
      return {
        status: 'no_match', model, promptVersion: M4_AI_AUTHORITY_PROMPT_VERSION,
        reason: parsed.rationale, assessedAt: now,
      };
    }
    return {
      status: 'success', model, promptVersion: M4_AI_AUTHORITY_PROMPT_VERSION,
      ...parsed, assessedAt: now,
    };
  } catch (error) {
    return {
      status: 'invalid', model, promptVersion: M4_AI_AUTHORITY_PROMPT_VERSION,
      reason: errorReason(error, 'MiniMax returned an invalid authority recommendation.'), assessedAt: now,
    };
  }
}

export function buildAuthorityRecommendationAiPayload(
  input: IncidentAuthorityRecommendationInput,
  authorities = input.authorities.filter((entry) => entry.active && entry.serviceCategories.includes(input.category)),
) {
  const details = input.event.eventDetails;
  return {
    incident: {
      category: input.category,
      description: input.description,
      location: input.location,
      occurredAt: input.occurredAt,
      evidence: input.evidence.map(({ name, mimeType, size }) => ({ name, mimeType, size })),
    },
    event: {
      name: details.name,
      type: details.type,
      venueName: details.venueName,
      venueAddress: details.venueAddress,
      venueState: details.venueState ?? null,
      expectedAttendance: details.expectedAttendance,
      startDatetime: details.startDatetime,
      endDatetime: details.endDatetime,
      requiredAuthorities: input.event.requiredAuthorities,
    },
    incidentAssessment: input.assessment.status === 'success'
      ? { severity: input.assessment.severity, immediateActionRequired: input.assessment.immediateActionRequired }
      : { status: input.assessment.status },
    authorities: authorities.map(({ authorityId, name, authorityType, serviceCategories, coverageAreas }) => ({
      authorityId, name, authorityType, serviceCategories, coverageAreas,
    })),
  };
}

export function parseAuthorityRecommendationResponse(raw: string, allowedAuthorityIds: readonly string[]) {
  if (raw.length > MAX_RESPONSE_CHARS) throw new Error('MiniMax response exceeds the allowed size.');
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid response object.');
  const value = parsed as Record<string, unknown>;
  if (Object.keys(value).some((key) => !RESPONSE_KEYS.has(key))) throw new Error('Invalid response schema.');
  if (!Array.isArray(value.authorityIds) || value.authorityIds.length > 5) throw new Error('authorityIds must contain at most five items.');
  if (typeof value.rationale !== 'string') throw new Error('Invalid response rationale.');
  const rationale = value.rationale.trim();
  if (rationale.length < 10 || rationale.length > 1000) throw new Error('Invalid response rationale.');

  const allowed = new Set(allowedAuthorityIds);
  const seen = new Set<string>();
  const authorityIds = value.authorityIds.map((authorityId, index) => {
    if (typeof authorityId !== 'string' || !allowed.has(authorityId)) throw new Error(`authorityIds[${index}] is not in the maintained directory.`);
    if (seen.has(authorityId)) throw new Error('authorityIds contains a duplicate.');
    seen.add(authorityId);
    return authorityId;
  });
  return { authorityIds, rationale };
}

async function requestFromMiniMax(apiKey: string, model: string, user: string, options: IncidentAuthorityRecommendationOptions): Promise<string> {
  const client = new Anthropic({
    apiKey,
    baseURL: options.baseURL ?? process.env.MINIMAX_BASE_URL ?? DEFAULT_MINIMAX_BASE_URL,
    timeout: options.timeoutMs ?? INCIDENT_AUTHORITY_RECOMMENDATION_TIMEOUT_MS,
    maxRetries: 0,
  });
  const response = await client.messages.create({
    model,
    max_tokens: 400,
    temperature: 0,
    system: buildAuthorityRecommendationSystemPrompt(),
    messages: [{ role: 'user', content: user }],
  });
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function buildAuthorityRecommendationSystemPrompt() {
  return 'You are MiniMax M3 advising a Malaysian tourism-event organizer. Choose zero or more authorityIds only from the maintained directory in the user payload, ordered from most suitable to least suitable. Consider incident category, severity, immediate-action flag, event location, event type, attendance, coverage areas, service categories, and required authorities. Return strict JSON only: {"authorityIds":["directory-id"],"rationale":"..."}. Return at most five IDs. Never invent IDs, contact details, facts, or fields. This is advisory only: do not refer an incident automatically.';
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`MiniMax request timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function errorReason(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return message.replace(/(api[-_ ]?key|authorization|bearer)\s*[:=]\s*\S+/gi, '$1 [redacted]').slice(0, 300);
}
