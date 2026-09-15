import Anthropic from '@anthropic-ai/sdk';
import type { EventRecord, ProposedControlItem, Stage1Doc } from '@shared/types';
import { DEFAULT_MINIMAX_BASE_URL, DEFAULT_MINIMAX_MODEL } from '../config/minimax';

export const CONTROL_LIST_PROMPT_VERSION = 'v1.0.0-m3-control-list';
export const CONTROL_LIST_TIMEOUT_MS = 20_000;

const MAX_RESPONSE_CHARS = 20_000;
const DOC_TYPES = new Set<Stage1Doc['docType']>([
  'receipt', 'application', 'floor_plan', 'license', 'insurance', 'other',
]);
const RESPONSE_KEYS = new Set(['controls']);
const CONTROL_KEYS = new Set(['controlName', 'authority', 'stageRequirement', 'stage1Requirements', 'stage2Requirement']);
const STAGE1_KEYS = new Set(['docType', 'label', 'required']);
const STAGE2_KEYS = new Set(['kind', 'label']);

export interface ControlListProposalInput {
  event: EventRecord;
  assessment?: Record<string, unknown>;
  resource?: Record<string, unknown>;
  requiredAuthorities: string[];
}

export interface ControlListProposalResult {
  items: ProposedControlItem[];
  source: 'minimax' | 'deterministic_fallback';
  model: string;
  promptVersion: string;
  generatedAt: number;
  fallbackReason?: string;
}

export class ControlListProposalError extends Error {
  constructor(public readonly kind: 'invalid' | 'timeout' | 'unavailable', message: string) {
    super(message);
    this.name = 'ControlListProposalError';
  }
}

interface RequestOptions {
  model?: string;
  baseURL?: string;
  timeoutMs?: number;
  now?: number;
  request?: (request: { model: string; system: string; user: string; maxTokens: number }) => Promise<string>;
}

/**
 * Request a validated control list from MiniMax. The deterministic fallback
 * is supplied by M3 so the official workflow remains usable when the
 * advisory provider is unavailable; the result explicitly records which
 * source was used.
 */
export async function proposeControlListWithMiniMax(
  apiKey: string,
  input: ControlListProposalInput,
  fallback: ProposedControlItem[],
  options: RequestOptions = {},
): Promise<ControlListProposalResult> {
  const now = options.now ?? Date.now();
  const model = options.model ?? process.env.MINIMAX_MODEL ?? DEFAULT_MINIMAX_MODEL;
  if (!apiKey.trim()) {
    return {
      items: fallback,
      source: 'deterministic_fallback',
      model,
      promptVersion: CONTROL_LIST_PROMPT_VERSION,
      generatedAt: now,
      fallbackReason: 'MINIMAX_API_KEY is not configured.',
    };
  }

  try {
    const user = buildAllowedControlListInput(input);
    const text = options.request
      ? await withTimeout(options.request({
        model,
        system: buildSystemPrompt(input.requiredAuthorities),
        user,
        maxTokens: 2_000,
      }), options.timeoutMs ?? CONTROL_LIST_TIMEOUT_MS)
      : await requestFromMiniMax(apiKey, model, user, input.requiredAuthorities, options);
    const items = parseControlListProposal(text, input.requiredAuthorities);
    return {
      items,
      source: 'minimax',
      model,
      promptVersion: CONTROL_LIST_PROMPT_VERSION,
      generatedAt: now,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      items: fallback,
      source: 'deterministic_fallback',
      model,
      promptVersion: CONTROL_LIST_PROMPT_VERSION,
      generatedAt: now,
      fallbackReason: detail.slice(0, 500),
    };
  }
}

export function buildAllowedControlListInput(input: ControlListProposalInput): string {
  const details = input.event.eventDetails;
  const assessment = isRecord(input.assessment) ? input.assessment : undefined;
  const officialResult = assessment && assessment.status === 'official_ready' && isRecord(assessment.officialResult)
    ? assessment.officialResult : undefined;
  const resource = isRecord(input.resource) && input.resource.stage === 'official' && isRecord(input.resource.items)
    ? input.resource : undefined;
  const categories = officialResult && Array.isArray(officialResult.categories)
    ? officialResult.categories.filter(isRecord).map((category) => ({
      categoryId: category.categoryId,
      likelihood: category.validatedLikelihood ?? category.officialLikelihood,
      severity: category.validatedSeverity ?? category.officialSeverity,
      riskLevel: category.riskLevel,
      matrixScore: category.matrixScore,
    })) : [];
  const hazards = officialResult && Array.isArray(officialResult.manualHazards)
    ? officialResult.manualHazards.filter(isRecord).map((hazard) => ({
      hazardId: hazard.hazardId, categoryId: hazard.categoryId, hazardName: hazard.hazardName,
    }))
    : assessment && isRecord(assessment.aiProposal) && Array.isArray(assessment.aiProposal.hazards)
      ? assessment.aiProposal.hazards.filter(isRecord).map((hazard) => ({
        hazardId: hazard.hazardId, categoryId: hazard.categoryId, hazardName: hazard.hazardName,
      })) : [];
  const resourceItems = resource
    ? Object.fromEntries(Object.entries(resource.items as Record<string, unknown>).flatMap(([key, value]) => {
      if (!isRecord(value)) return [];
      return [[key, { baseline: value.baseline, planningRange: value.planningRange }]];
    })) : null;
  return JSON.stringify({
    event: {
      type: details.type,
      expectedAttendance: details.expectedAttendance,
      venueCapacity: details.venueCapacity,
      environment: details.environment,
      coverage: details.coverage,
      seating: details.seating,
      durationHours: Math.max(0, details.endDatetime - details.startDatetime) / 3_600_000,
    },
    requiredAuthorities: input.requiredAuthorities,
    assessment: officialResult ? {
      overallScore: officialResult.overallScore,
      overallRiskLevel: officialResult.overallRiskLevel,
      assessmentReadiness: assessment?.assessmentReadiness,
      complianceStatus: assessment?.complianceStatus,
      sourceKind: assessment?.sourceKind ?? 'ai_authority',
      hazards,
      categories,
    } : null,
    resources: resource ? {
      stage: resource.stage,
      confidenceLevel: resource.confidenceLevel,
      validationScope: resource.validationScope,
      items: resourceItems,
    } : null,
  });
}

export function parseControlListProposal(text: string, requiredAuthorities: string[]): ProposedControlItem[] {
  if (text.length > MAX_RESPONSE_CHARS) throw new ControlListProposalError('invalid', 'MiniMax response exceeds the allowed size.');
  let value: unknown;
  try {
    value = JSON.parse(extractJson(text));
  } catch {
    throw new ControlListProposalError('invalid', 'MiniMax response is not valid JSON.');
  }
  if (!isRecord(value)) throw new ControlListProposalError('invalid', 'MiniMax response must be an object.');
  rejectUnknownKeys(value, RESPONSE_KEYS, 'MiniMax response');
  if (!Array.isArray(value.controls) || value.controls.length !== requiredAuthorities.length) {
    throw new ControlListProposalError('invalid', `controls must contain exactly ${requiredAuthorities.length} items.`);
  }

  const allowedAuthorities = new Set(requiredAuthorities);
  const seen = new Set<string>();
  return value.controls.map((raw, index) => {
    if (!isRecord(raw)) throw new ControlListProposalError('invalid', `controls[${index}] must be an object.`);
    rejectUnknownKeys(raw, CONTROL_KEYS, `controls[${index}]`);
    const controlName = readText(raw.controlName, `controls[${index}].controlName`, 200);
    const authority = readText(raw.authority, `controls[${index}].authority`, 40);
    if (!allowedAuthorities.has(authority)) throw new ControlListProposalError('invalid', `controls[${index}] contains an unrequired authority: ${authority}.`);
    if (seen.has(authority)) throw new ControlListProposalError('invalid', `controls contains duplicate authority: ${authority}.`);
    seen.add(authority);

    const stageRequirement = raw.stageRequirement;
    if (stageRequirement !== 'stage1_only' && stageRequirement !== 'stage1_and_stage2') {
      throw new ControlListProposalError('invalid', `controls[${index}].stageRequirement is invalid.`);
    }
    if (!Array.isArray(raw.stage1Requirements) || raw.stage1Requirements.length > 20) {
      throw new ControlListProposalError('invalid', `controls[${index}].stage1Requirements is invalid.`);
    }
    const stage1Requirements = raw.stage1Requirements.map((slot, slotIndex) => {
      if (!isRecord(slot)) throw new ControlListProposalError('invalid', `controls[${index}].stage1Requirements[${slotIndex}] must be an object.`);
      rejectUnknownKeys(slot, STAGE1_KEYS, `controls[${index}].stage1Requirements[${slotIndex}]`);
      const docType = readText(slot.docType, `controls[${index}].stage1Requirements[${slotIndex}].docType`, 40) as Stage1Doc['docType'];
      if (!DOC_TYPES.has(docType)) throw new ControlListProposalError('invalid', `Unsupported Stage 1 document type: ${docType}.`);
      if (typeof slot.required !== 'boolean') throw new ControlListProposalError('invalid', `controls[${index}].stage1Requirements[${slotIndex}].required must be boolean.`);
      return { docType, label: readText(slot.label, `controls[${index}].stage1Requirements[${slotIndex}].label`, 300), required: slot.required };
    });

    let stage2Requirement: ProposedControlItem['stage2Requirement'] = null;
    if (raw.stage2Requirement !== null) {
      if (!isRecord(raw.stage2Requirement)) throw new ControlListProposalError('invalid', `controls[${index}].stage2Requirement must be null or an object.`);
      rejectUnknownKeys(raw.stage2Requirement, STAGE2_KEYS, `controls[${index}].stage2Requirement`);
      if (raw.stage2Requirement.kind !== 'image') throw new ControlListProposalError('invalid', `controls[${index}].stage2Requirement.kind must be image.`);
      stage2Requirement = { kind: 'image', label: readText(raw.stage2Requirement.label, `controls[${index}].stage2Requirement.label`, 300) };
    }
    if (stageRequirement === 'stage1_and_stage2' && stage2Requirement === null) {
      throw new ControlListProposalError('invalid', `controls[${index}] requires Stage 2 but returned no Stage 2 requirement.`);
    }
    return { controlName, authority: authority as ProposedControlItem['authority'], stageRequirement, stage1Requirements, stage2Requirement };
  });
}

async function requestFromMiniMax(apiKey: string, model: string, user: string, requiredAuthorities: string[], options: RequestOptions): Promise<string> {
  try {
    const client = new Anthropic({
      apiKey,
      baseURL: options.baseURL ?? process.env.MINIMAX_BASE_URL ?? DEFAULT_MINIMAX_BASE_URL,
      timeout: options.timeoutMs ?? CONTROL_LIST_TIMEOUT_MS,
      maxRetries: 0,
    });
    const response = await client.messages.create({
      model,
      max_tokens: 2_000,
      temperature: 0.1,
      system: buildSystemPrompt(requiredAuthorities),
      messages: [{ role: 'user', content: user }],
    });
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  } catch (error) {
    if (error instanceof ControlListProposalError) throw error;
    const detail = error instanceof Error ? error.message : 'Unknown MiniMax failure';
    const timeout = error instanceof Error && (error.name === 'AbortError' || /timeout|timed out/i.test(error.message));
    throw new ControlListProposalError(timeout ? 'timeout' : 'unavailable', detail);
  }
}

function buildSystemPrompt(requiredAuthorities: string[]): string {
  const authorityInstruction = requiredAuthorities.length
    ? `Required authorities for this proposal are: ${requiredAuthorities.join(', ')}.`
    : 'Use the requiredAuthorities array from the user payload.';
  return `You propose event control requirements for a Malaysian tourism-event approval workflow. ${authorityInstruction}
Return only one JSON object with this exact shape: {"controls":[{"controlName":"...","authority":"PDRM","stageRequirement":"stage1_and_stage2","stage1Requirements":[{"docType":"application","label":"...","required":true}],"stage2Requirement":{"kind":"image","label":"..."}}]}
Rules: return exactly one control for every required authority and no other authority; use only document types receipt, application, floor_plan, license, insurance, or other; stage2Requirement is null only when stageRequirement is stage1_only; do not include personal data, approval decisions, risk-score changes, or resource quantities; keep labels concise and operationally testable; do not add fields.`;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, field: string): void {
  const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) throw new ControlListProposalError('invalid', `${field} contains unsupported fields: ${unknownKeys.join(', ')}.`);
}

function readText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new ControlListProposalError('invalid', `${field} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value.trim();
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  return first >= 0 && last > first ? text.slice(first, last + 1) : text.trim();
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new ControlListProposalError('timeout', `MiniMax request timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
