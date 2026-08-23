"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlListProposalError = exports.CONTROL_LIST_TIMEOUT_MS = exports.CONTROL_LIST_PROMPT_VERSION = void 0;
exports.proposeControlListWithMiniMax = proposeControlListWithMiniMax;
exports.buildAllowedControlListInput = buildAllowedControlListInput;
exports.parseControlListProposal = parseControlListProposal;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const minimax_1 = require("../config/minimax");
exports.CONTROL_LIST_PROMPT_VERSION = 'v1.0.0-m3-control-list';
exports.CONTROL_LIST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_CHARS = 20_000;
const DOC_TYPES = new Set([
    'receipt', 'application', 'floor_plan', 'license', 'insurance', 'other',
]);
const RESPONSE_KEYS = new Set(['controls']);
const CONTROL_KEYS = new Set(['controlName', 'authority', 'stageRequirement', 'stage1Requirements', 'stage2Requirement']);
const STAGE1_KEYS = new Set(['docType', 'label', 'required']);
const STAGE2_KEYS = new Set(['kind', 'label']);
class ControlListProposalError extends Error {
    kind;
    constructor(kind, message) {
        super(message);
        this.kind = kind;
        this.name = 'ControlListProposalError';
    }
}
exports.ControlListProposalError = ControlListProposalError;
/**
 * Request a validated control list from MiniMax. The deterministic fallback
 * is supplied by M3 so the official workflow remains usable when the
 * advisory provider is unavailable; the result explicitly records which
 * source was used.
 */
async function proposeControlListWithMiniMax(apiKey, input, fallback, options = {}) {
    const now = options.now ?? Date.now();
    const model = options.model ?? process.env.MINIMAX_MODEL ?? minimax_1.DEFAULT_MINIMAX_MODEL;
    if (!apiKey.trim()) {
        return {
            items: fallback,
            source: 'deterministic_fallback',
            model,
            promptVersion: exports.CONTROL_LIST_PROMPT_VERSION,
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
            }), options.timeoutMs ?? exports.CONTROL_LIST_TIMEOUT_MS)
            : await requestFromMiniMax(apiKey, model, user, input.requiredAuthorities, options);
        const items = parseControlListProposal(text, input.requiredAuthorities);
        return {
            items,
            source: 'minimax',
            model,
            promptVersion: exports.CONTROL_LIST_PROMPT_VERSION,
            generatedAt: now,
        };
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
            items: fallback,
            source: 'deterministic_fallback',
            model,
            promptVersion: exports.CONTROL_LIST_PROMPT_VERSION,
            generatedAt: now,
            fallbackReason: detail.slice(0, 500),
        };
    }
}
function buildAllowedControlListInput(input) {
    const details = input.event.eventDetails;
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
        assessment: input.assessment ? {
            officialScore: input.assessment.officialScore,
            officialRiskLevel: input.assessment.officialRiskLevel,
            assessmentReadiness: input.assessment.assessmentReadiness,
            complianceStatus: input.assessment.complianceStatus,
            hazards: input.assessment.hazards,
            categoryAssignments: input.assessment.categoryAssignments,
        } : null,
        resources: input.resource ? {
            police: input.resource.police,
            security: input.resource.security,
            medicalTeams: input.resource.medicalTeams,
            ambulances: input.resource.ambulances,
            toilets: input.resource.toilets,
            wasteBins: input.resource.wasteBins,
            fireOfficers: input.resource.fireOfficers,
            confidenceLevel: input.resource.confidenceLevel,
            guidelineStatus: input.resource.guidelineStatus,
        } : null,
    });
}
function parseControlListProposal(text, requiredAuthorities) {
    if (text.length > MAX_RESPONSE_CHARS)
        throw new ControlListProposalError('invalid', 'MiniMax response exceeds the allowed size.');
    let value;
    try {
        value = JSON.parse(extractJson(text));
    }
    catch {
        throw new ControlListProposalError('invalid', 'MiniMax response is not valid JSON.');
    }
    if (!isRecord(value))
        throw new ControlListProposalError('invalid', 'MiniMax response must be an object.');
    rejectUnknownKeys(value, RESPONSE_KEYS, 'MiniMax response');
    if (!Array.isArray(value.controls) || value.controls.length !== requiredAuthorities.length) {
        throw new ControlListProposalError('invalid', `controls must contain exactly ${requiredAuthorities.length} items.`);
    }
    const allowedAuthorities = new Set(requiredAuthorities);
    const seen = new Set();
    return value.controls.map((raw, index) => {
        if (!isRecord(raw))
            throw new ControlListProposalError('invalid', `controls[${index}] must be an object.`);
        rejectUnknownKeys(raw, CONTROL_KEYS, `controls[${index}]`);
        const controlName = readText(raw.controlName, `controls[${index}].controlName`, 200);
        const authority = readText(raw.authority, `controls[${index}].authority`, 40);
        if (!allowedAuthorities.has(authority))
            throw new ControlListProposalError('invalid', `controls[${index}] contains an unrequired authority: ${authority}.`);
        if (seen.has(authority))
            throw new ControlListProposalError('invalid', `controls contains duplicate authority: ${authority}.`);
        seen.add(authority);
        const stageRequirement = raw.stageRequirement;
        if (stageRequirement !== 'stage1_only' && stageRequirement !== 'stage1_and_stage2') {
            throw new ControlListProposalError('invalid', `controls[${index}].stageRequirement is invalid.`);
        }
        if (!Array.isArray(raw.stage1Requirements) || raw.stage1Requirements.length > 20) {
            throw new ControlListProposalError('invalid', `controls[${index}].stage1Requirements is invalid.`);
        }
        const stage1Requirements = raw.stage1Requirements.map((slot, slotIndex) => {
            if (!isRecord(slot))
                throw new ControlListProposalError('invalid', `controls[${index}].stage1Requirements[${slotIndex}] must be an object.`);
            rejectUnknownKeys(slot, STAGE1_KEYS, `controls[${index}].stage1Requirements[${slotIndex}]`);
            const docType = readText(slot.docType, `controls[${index}].stage1Requirements[${slotIndex}].docType`, 40);
            if (!DOC_TYPES.has(docType))
                throw new ControlListProposalError('invalid', `Unsupported Stage 1 document type: ${docType}.`);
            if (typeof slot.required !== 'boolean')
                throw new ControlListProposalError('invalid', `controls[${index}].stage1Requirements[${slotIndex}].required must be boolean.`);
            return { docType, label: readText(slot.label, `controls[${index}].stage1Requirements[${slotIndex}].label`, 300), required: slot.required };
        });
        let stage2Requirement = null;
        if (raw.stage2Requirement !== null) {
            if (!isRecord(raw.stage2Requirement))
                throw new ControlListProposalError('invalid', `controls[${index}].stage2Requirement must be null or an object.`);
            rejectUnknownKeys(raw.stage2Requirement, STAGE2_KEYS, `controls[${index}].stage2Requirement`);
            if (raw.stage2Requirement.kind !== 'image')
                throw new ControlListProposalError('invalid', `controls[${index}].stage2Requirement.kind must be image.`);
            stage2Requirement = { kind: 'image', label: readText(raw.stage2Requirement.label, `controls[${index}].stage2Requirement.label`, 300) };
        }
        if (stageRequirement === 'stage1_and_stage2' && stage2Requirement === null) {
            throw new ControlListProposalError('invalid', `controls[${index}] requires Stage 2 but returned no Stage 2 requirement.`);
        }
        return { controlName, authority: authority, stageRequirement, stage1Requirements, stage2Requirement };
    });
}
async function requestFromMiniMax(apiKey, model, user, requiredAuthorities, options) {
    try {
        const client = new sdk_1.default({
            apiKey,
            baseURL: options.baseURL ?? process.env.MINIMAX_BASE_URL ?? minimax_1.DEFAULT_MINIMAX_BASE_URL,
            timeout: options.timeoutMs ?? exports.CONTROL_LIST_TIMEOUT_MS,
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
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('\n');
    }
    catch (error) {
        if (error instanceof ControlListProposalError)
            throw error;
        const detail = error instanceof Error ? error.message : 'Unknown MiniMax failure';
        const timeout = error instanceof Error && (error.name === 'AbortError' || /timeout|timed out/i.test(error.message));
        throw new ControlListProposalError(timeout ? 'timeout' : 'unavailable', detail);
    }
}
function buildSystemPrompt(requiredAuthorities) {
    const authorityInstruction = requiredAuthorities.length
        ? `Required authorities for this proposal are: ${requiredAuthorities.join(', ')}.`
        : 'Use the requiredAuthorities array from the user payload.';
    return `You propose event control requirements for a Malaysian tourism-event approval workflow. ${authorityInstruction}
Return only one JSON object with this exact shape: {"controls":[{"controlName":"...","authority":"PDRM","stageRequirement":"stage1_and_stage2","stage1Requirements":[{"docType":"application","label":"...","required":true}],"stage2Requirement":{"kind":"image","label":"..."}}]}
Rules: return exactly one control for every required authority and no other authority; use only document types receipt, application, floor_plan, license, insurance, or other; stage2Requirement is null only when stageRequirement is stage1_only; do not include personal data, approval decisions, risk-score changes, or resource quantities; keep labels concise and operationally testable; do not add fields.`;
}
function rejectUnknownKeys(value, allowed, field) {
    const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key));
    if (unknownKeys.length > 0)
        throw new ControlListProposalError('invalid', `${field} contains unsupported fields: ${unknownKeys.join(', ')}.`);
}
function readText(value, field, maxLength) {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
        throw new ControlListProposalError('invalid', `${field} must be a non-empty string of at most ${maxLength} characters.`);
    }
    return value.trim();
}
function extractJson(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced)
        return fenced[1].trim();
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    return first >= 0 && last > first ? text.slice(first, last + 1) : text.trim();
}
async function withTimeout(promise, timeoutMs) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new ControlListProposalError('timeout', `MiniMax request timed out after ${timeoutMs}ms.`)), timeoutMs);
            }),
        ]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=controlListProposer.js.map