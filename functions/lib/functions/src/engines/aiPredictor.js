"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIRefinementError = exports.AI_TIMEOUT_MS = exports.PROMPT_VERSION = exports.DEFAULT_MINIMAX_MODEL = exports.DEFAULT_MINIMAX_BASE_URL = void 0;
exports.predictWithAI = predictWithAI;
exports.refineWithAIOrFallback = refineWithAIOrFallback;
exports.unavailableAIRefinement = unavailableAIRefinement;
exports.parseAIRefinement = parseAIRefinement;
exports.buildAllowedInput = buildAllowedInput;
exports.clearAICache = clearAICache;
const node_crypto_1 = require("node:crypto");
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const types_1 = require("../../../shared/types");
const minimax_1 = require("../config/minimax");
var minimax_2 = require("../config/minimax");
Object.defineProperty(exports, "DEFAULT_MINIMAX_BASE_URL", { enumerable: true, get: function () { return minimax_2.DEFAULT_MINIMAX_BASE_URL; } });
Object.defineProperty(exports, "DEFAULT_MINIMAX_MODEL", { enumerable: true, get: function () { return minimax_2.DEFAULT_MINIMAX_MODEL; } });
exports.PROMPT_VERSION = 'v2.3.0';
exports.AI_TIMEOUT_MS = 9_000;
const MAX_RESPONSE_CHARS = 16_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 200;
const EVIDENCE_KEYS = new Set(['weather', 'crowd', 'venue', 'history', 'holiday']);
const RESPONSE_KEYS = new Set(['proposedAdjustment', 'reasoning', 'compoundEffects', 'keyConcerns', 'citedEvidenceKeys']);
const CACHE = new Map();
class AIRefinementError extends Error {
    kind;
    constructor(kind, message) {
        super(message);
        this.kind = kind;
        this.name = 'AIRefinementError';
    }
}
exports.AIRefinementError = AIRefinementError;
async function predictWithAI(apiKey, event, weather, isHoliday, isWeekend, baseline, options = {}) {
    const now = options.now ?? Date.now();
    const timeoutMs = options.timeoutMs ?? exports.AI_TIMEOUT_MS;
    const model = options.model ?? process.env.MINIMAX_MODEL ?? minimax_1.DEFAULT_MINIMAX_MODEL;
    const user = buildAllowedInput(event, weather, isHoliday, isWeekend, baseline);
    const cacheKey = (0, node_crypto_1.createHash)('sha256').update(JSON.stringify({ model, promptVersion: exports.PROMPT_VERSION, user })).digest('hex');
    const cached = CACHE.get(cacheKey);
    if (cached && cached.expiresAt > now)
        return { ...cached.value, cacheStatus: 'hit' };
    let text;
    try {
        if (options.request) {
            text = await withTimeout(options.request({ model, system: buildSystemPrompt(), user, maxTokens: 800 }), timeoutMs);
        }
        else {
            const client = new sdk_1.default({
                apiKey,
                baseURL: options.baseURL ?? process.env.MINIMAX_BASE_URL ?? minimax_1.DEFAULT_MINIMAX_BASE_URL,
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
                .filter((block) => block.type === 'text')
                .map((block) => block.text)
                .join('\n');
        }
    }
    catch (error) {
        if (error instanceof AIRefinementError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown MiniMax failure';
        const isTimeout = error instanceof Error && (error.name === 'AbortError' || /timeout|timed out/i.test(error.message));
        throw new AIRefinementError(isTimeout ? 'timeout' : 'unavailable', message);
    }
    const parsed = parseAIRefinement(text);
    const value = {
        model,
        promptVersion: exports.PROMPT_VERSION,
        status: 'success',
        ...parsed,
        validatedAdjustment: parsed.proposedAdjustment,
        cacheStatus: 'miss',
        generatedAt: now,
    };
    if (CACHE.size >= MAX_CACHE_ENTRIES)
        CACHE.delete(CACHE.keys().next().value);
    CACHE.set(cacheKey, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
}
async function refineWithAIOrFallback(apiKey, event, weather, isHoliday, isWeekend, baseline, predictor = predictWithAI) {
    if (!apiKey)
        return unavailableAIRefinement('unavailable', 'MiniMax was not configured; the deterministic baseline is final.');
    try {
        return await predictor(apiKey, event, weather, isHoliday, isWeekend, baseline);
    }
    catch (error) {
        const kind = error instanceof AIRefinementError ? error.kind : 'unavailable';
        const invalid = kind === 'invalid';
        return unavailableAIRefinement(invalid ? 'invalid' : 'unavailable', `${invalid ? 'Invalid MiniMax output' : kind === 'timeout' ? 'MiniMax timed out' : 'MiniMax unavailable'}; deterministic baseline used.`);
    }
}
function unavailableAIRefinement(status, reasoning) {
    return {
        model: process.env.MINIMAX_MODEL ?? minimax_1.DEFAULT_MINIMAX_MODEL,
        promptVersion: exports.PROMPT_VERSION,
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
function parseAIRefinement(text) {
    if (text.length > MAX_RESPONSE_CHARS)
        throw new AIRefinementError('invalid', 'MiniMax response exceeds the allowed size.');
    let value;
    try {
        value = JSON.parse(extractJson(text));
    }
    catch {
        throw new AIRefinementError('invalid', 'MiniMax response is not valid JSON.');
    }
    if (!isRecord(value))
        throw new AIRefinementError('invalid', 'MiniMax response must be a JSON object.');
    const unknownKeys = Object.keys(value).filter((key) => !RESPONSE_KEYS.has(key));
    if (unknownKeys.length > 0)
        throw new AIRefinementError('invalid', `MiniMax response contains unsupported fields: ${unknownKeys.join(', ')}.`);
    const proposedAdjustment = value.proposedAdjustment;
    if (!Number.isInteger(proposedAdjustment) || proposedAdjustment < 0 || proposedAdjustment > types_1.MAX_AI_ADJUSTMENT) {
        throw new AIRefinementError('invalid', `proposedAdjustment must be an integer from 0 to ${types_1.MAX_AI_ADJUSTMENT}.`);
    }
    if (typeof value.reasoning !== 'string' || value.reasoning.trim().length === 0 || value.reasoning.length > 2_000) {
        throw new AIRefinementError('invalid', 'reasoning must be a non-empty string of at most 2,000 characters.');
    }
    const compoundEffects = readStringArray(value.compoundEffects, 'compoundEffects');
    const keyConcerns = readStringArray(value.keyConcerns, 'keyConcerns');
    const citedEvidenceKeys = readStringArray(value.citedEvidenceKeys, 'citedEvidenceKeys');
    if (!citedEvidenceKeys.every((key) => EVIDENCE_KEYS.has(key))) {
        throw new AIRefinementError('invalid', 'citedEvidenceKeys contains an unknown evidence key.');
    }
    return { proposedAdjustment: proposedAdjustment, reasoning: value.reasoning.trim(), compoundEffects, keyConcerns, citedEvidenceKeys };
}
function buildAllowedInput(event, weather, isHoliday, isWeekend, baseline) {
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
function clearAICache() {
    CACHE.clear();
}
function buildSystemPrompt() {
    return `You refine a deterministic safety assessment for Malaysian tourism events. The baseline is authoritative. Identify only compound risks supported by the supplied evidence.

Return only one JSON object matching this exact shape:
{"proposedAdjustment":0,"reasoning":"Concise evidence-based explanation.","compoundEffects":[],"keyConcerns":[],"citedEvidenceKeys":[]}

Schema rules:
- proposedAdjustment: integer from 0 to ${types_1.MAX_AI_ADJUSTMENT}
- reasoning: non-empty string
- compoundEffects: array of strings; use [] when none
- keyConcerns: array of strings; use [] when none
- citedEvidenceKeys: array containing only weather, crowd, venue, history, or holiday; use [] when none

Do not add fields, Markdown, a final score, or resource quantities.`;
}
function extractJson(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced)
        return fenced[1].trim();
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    return first >= 0 && last > first ? text.slice(first, last + 1) : text.trim();
}
function readStringArray(value, field) {
    if (!Array.isArray(value) || value.length > 10 || !value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 100)) {
        throw new AIRefinementError('invalid', `${field} must be an array of at most 10 non-empty short strings.`);
    }
    return value;
}
async function withTimeout(promise, timeoutMs) {
    let timeout;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new AIRefinementError('timeout', `MiniMax request timed out after ${timeoutMs}ms.`)), timeoutMs);
            }),
        ]);
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=aiPredictor.js.map