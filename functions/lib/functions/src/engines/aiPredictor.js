"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIProposalError = exports.AI_TIMEOUT_MS = exports.AI_RESPONSE_SCHEMA_VERSION = exports.PROMPT_VERSION = exports.DEFAULT_MINIMAX_MODEL = exports.DEFAULT_MINIMAX_BASE_URL = void 0;
exports.predictWithAI = predictWithAI;
exports.analyseWithAI = analyseWithAI;
exports.failedProposal = failedProposal;
exports.parseAIProposal = parseAIProposal;
exports.buildAllowedInput = buildAllowedInput;
exports.clearAICache = clearAICache;
const node_crypto_1 = require("node:crypto");
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const categorySchema_1 = require("../config/categorySchema");
const hardRuleEvaluator_1 = require("./hardRuleEvaluator");
const minimax_1 = require("../config/minimax");
const standardsRegistry_1 = require("../config/standardsRegistry");
const proposalContract_1 = require("./proposalContract");
var minimax_2 = require("../config/minimax");
Object.defineProperty(exports, "DEFAULT_MINIMAX_BASE_URL", { enumerable: true, get: function () { return minimax_2.DEFAULT_MINIMAX_BASE_URL; } });
Object.defineProperty(exports, "DEFAULT_MINIMAX_MODEL", { enumerable: true, get: function () { return minimax_2.DEFAULT_MINIMAX_MODEL; } });
exports.PROMPT_VERSION = 'v5.0.0-prd-numeric-proposal';
exports.AI_RESPONSE_SCHEMA_VERSION = '2026-08-21-m2-proposal-v4';
exports.AI_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_CHARS = 24_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 200;
const CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high']);
const RESPONSE_KEYS = new Set(['hazards', 'categories']);
const HAZARD_KEYS = new Set(['hazardId', 'hazardName', 'categoryId', 'evidenceReferences', 'rationale']);
const CATEGORY_KEYS = new Set([
    'categoryId', 'likelihood', 'severity', 'evidenceReferences', 'rationale',
    'confidence', 'concerns', 'missingInformation',
]);
const CACHE = new Map();
class AIProposalError extends Error {
    kind;
    constructor(kind, message) {
        super(message);
        this.kind = kind;
        this.name = 'AIProposalError';
    }
}
exports.AIProposalError = AIProposalError;
async function predictWithAI(apiKey, event, context, baseline, options = {}) {
    const now = options.now ?? Date.now();
    const timeoutMs = options.timeoutMs ?? exports.AI_TIMEOUT_MS;
    const model = options.model ?? process.env.MINIMAX_MODEL ?? minimax_1.DEFAULT_MINIMAX_MODEL;
    const categoryIds = categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.map((category) => category.id);
    const user = buildAllowedInput(event, context, baseline);
    const cacheKey = (0, node_crypto_1.createHash)('sha256').update(JSON.stringify({ model, promptVersion: exports.PROMPT_VERSION, user })).digest('hex');
    const cached = CACHE.get(cacheKey);
    if (cached && cached.expiresAt > now)
        return { ...cached.value, cacheStatus: 'hit' };
    let text;
    try {
        if (options.request) {
            text = await withTimeout(options.request({ model, system: buildSystemPrompt(categoryIds), user, maxTokens: 2_400 }), timeoutMs);
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
                max_tokens: 2_400,
                temperature: 0.1,
                system: buildSystemPrompt(categoryIds),
                messages: [{ role: 'user', content: user }],
            });
            text = response.content
                .filter((block) => block.type === 'text')
                .map((block) => block.text)
                .join('\n');
        }
    }
    catch (error) {
        if (error instanceof AIProposalError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown MiniMax failure';
        const timeout = error instanceof Error && (error.name === 'AbortError' || /timeout|timed out/i.test(error.message));
        throw new AIProposalError(timeout ? 'timeout' : 'unavailable', message);
    }
    const parsed = parseAIProposal(text, categoryIds);
    const value = {
        status: 'success',
        proposalId: (0, node_crypto_1.createHash)('sha256').update(`${cacheKey}:${text}`).digest('hex').slice(0, 24),
        model,
        promptVersion: exports.PROMPT_VERSION,
        responseSchemaVersion: exports.AI_RESPONSE_SCHEMA_VERSION,
        ...parsed,
        cacheStatus: 'miss',
        generatedAt: now,
    };
    if (CACHE.size >= MAX_CACHE_ENTRIES)
        CACHE.delete(CACHE.keys().next().value);
    CACHE.set(cacheKey, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
}
async function analyseWithAI(apiKey, event, context, baseline, predictor = predictWithAI) {
    if (!apiKey)
        return failedProposal('unavailable', 'MiniMax is not configured.');
    try {
        return await predictor(apiKey, event, context, baseline);
    }
    catch (error) {
        const kind = error instanceof AIProposalError ? error.kind : 'unavailable';
        const detail = error instanceof Error ? error.message : 'Unknown MiniMax failure';
        return failedProposal(kind, detail);
    }
}
function failedProposal(status, errorSummary, now = Date.now()) {
    return {
        status,
        model: process.env.MINIMAX_MODEL ?? minimax_1.DEFAULT_MINIMAX_MODEL,
        promptVersion: exports.PROMPT_VERSION,
        responseSchemaVersion: exports.AI_RESPONSE_SCHEMA_VERSION,
        retryable: true,
        errorSummary: errorSummary.slice(0, 500),
        cacheStatus: 'not-applicable',
        generatedAt: now,
    };
}
function parseAIProposal(text, allowedCategoryIds) {
    if (text.length > MAX_RESPONSE_CHARS)
        throw new AIProposalError('invalid', 'MiniMax response exceeds the allowed size.');
    let value;
    try {
        value = JSON.parse(extractJson(text));
    }
    catch {
        throw new AIProposalError('invalid', 'MiniMax response is not valid JSON.');
    }
    if (!isRecord(value))
        throw new AIProposalError('invalid', 'MiniMax response must be a JSON object.');
    rejectUnknownKeys(value, RESPONSE_KEYS, 'MiniMax response');
    return {
        hazards: readHazards(value.hazards, allowedCategoryIds),
        categories: readCategories(value.categories, allowedCategoryIds),
    };
}
function buildAllowedInput(event, context, baseline) {
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
            riskProfile: details.riskProfile ? {
                vulnerableAttendeesPercent: details.riskProfile.vulnerableAttendeesPercent,
                standingAttendeesPercent: details.riskProfile.standingAttendeesPercent,
                internationalAttendees: details.riskProfile.internationalAttendees,
                alcoholServed: details.riskProfile.alcoholServed,
                foodServed: details.riskProfile.foodServed,
                freeDrinkingWater: details.riskProfile.freeDrinkingWater,
                ticketedEntry: details.riskProfile.ticketedEntry,
                overnightAccommodation: details.riskProfile.overnightAccommodation,
                pyrotechnics: details.riskProfile.pyrotechnics,
                temporaryStructures: details.riskProfile.temporaryStructures,
                rivalryOrTensionExpected: details.riskProfile.rivalryOrTensionExpected,
                crowdManagementPlan: details.riskProfile.crowdManagementPlan,
                trafficManagementPlan: details.riskProfile.trafficManagementPlan,
                severeWeatherPlan: details.riskProfile.severeWeatherPlan,
                medicalPlan: details.riskProfile.medicalPlan,
                evacuationPlanTested: details.riskProfile.evacuationPlanTested,
                authorityCoordinationConfirmed: details.riskProfile.authorityCoordinationConfirmed,
                nearestHospitalTravelMinutes: details.riskProfile.nearestHospitalTravelMinutes,
            } : {},
        },
        context: {
            weather: {
                measurementStatus: context.weather.data ? 'available' : 'unavailable',
                ...(context.weather.data ? { data: context.weather.data } : { unavailableReason: context.weather.unavailableReason ?? 'provider_unavailable' }),
                source: context.weather.source,
                freshness: context.weather.freshness,
                forecastFor: context.weather.forecastFor,
            },
            calendar: {
                localDate: context.calendar.localDate,
                dayOfWeek: context.calendar.dayOfWeek,
                isWeekend: context.calendar.isWeekend,
                coverageStatus: context.calendar.coverageStatus,
                ...(context.calendar.coverageStatus === 'verified'
                    ? {
                        isHolidayOrAdjacent: context.calendar.isHolidayOrAdjacent,
                        holidayDistanceDays: context.calendar.holidayDistanceDays,
                        holidayName: context.calendar.holidayName,
                    }
                    : { unavailableReason: 'holiday_dataset_year_unsupported' }),
            },
            venue: {
                matched: context.venue.matched,
                submittedCapacity: context.venue.submittedCapacity,
                registeredCapacity: context.venue.registeredCapacity,
                capacityDifference: context.venue.capacityDifference,
                verifiedSafeCapacity: context.venue.verifiedSafeCapacity,
                fireCertificateStatus: context.venue.fireCertificateStatus,
                fireCertificateExpiresAt: context.venue.fireCertificateExpiresAt,
                emergencyAccessVerified: context.venue.emergencyAccessVerified,
                nearestHospitalTravelMinutes: context.venue.nearestHospitalTravelMinutes,
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
                syntheticEvidence: context.incidentHistory.syntheticEvidence,
                syntheticStatus: context.incidentHistory.syntheticStatus ?? 'none',
            },
        },
        evidence: baseline.evidence.map((item) => ({
            key: item.key,
            status: item.status,
            quality: item.quality,
            confidenceScore: item.confidenceScore,
            sourceTimestamp: item.sourceTimestamp,
        })),
        readiness: baseline.assessmentReadiness,
        compliance: baseline.complianceChecks?.map((check) => ({
            checkId: check.checkId,
            status: check.status,
            authority: check.authority,
            evidenceKeys: check.evidenceKeys,
            guidelineReference: check.guidelineReference,
        })),
        rubric: categorySchema_1.ACTIVE_CATEGORY_SCHEMA,
        hardRuleFloors: (0, hardRuleEvaluator_1.evaluateCategoryHardRules)(baseline),
        guidance: guidelinePayload(),
    });
}
function clearAICache() {
    CACHE.clear();
}
function buildSystemPrompt(categoryIds) {
    const categories = categoryIds.map((categoryId) => ({
        categoryId,
        likelihood: 1,
        severity: 1,
        evidenceReferences: [categoryEvidenceKey(categoryId)],
        rationale: `Evidence-based rationale for ${categoryId}.`,
        confidence: 'medium',
        concerns: [],
        missingInformation: [],
    }));
    return `You provide structured advisory risk proposals for Malaysian tourism events. Use only supplied evidence. Propose integer likelihood and severity ratings from 1 to 5 for every category. Do not make approval decisions, calculate official results, invent evidence, or include personal data.

Return only one JSON object matching this shape:
${JSON.stringify({
        hazards: [{ hazardId: 'hazard-id', hazardName: 'Hazard name', categoryId: categoryIds[0], evidenceReferences: [categoryEvidenceKey(categoryIds[0])], rationale: 'Evidence-based rationale.' }],
        categories,
    })}

Rules:
- categories must contain exactly these IDs once each: ${categoryIds.join(', ')}
- likelihood and severity must be integers from 1 to 5
- confidence must be low, medium, or high
- evidence references may only use: ${[...proposalContract_1.CANONICAL_EVIDENCE_KEYS].join(', ')}
- concerns and missingInformation are arrays of short strings; use [] when none
- hazards may be empty, but every hazard must belong to an allowed category
- do not add fields, Markdown, resource quantities, approval decisions, or personal data.`;
}
function readHazards(value, allowedCategoryIds) {
    if (!Array.isArray(value) || value.length > 40)
        throw new AIProposalError('invalid', 'hazards must be an array of at most 40 items.');
    const allowed = new Set(allowedCategoryIds);
    const seenHazardIds = new Set();
    return value.map((item, index) => {
        if (!isRecord(item))
            throw new AIProposalError('invalid', `hazards[${index}] must be an object.`);
        rejectUnknownKeys(item, HAZARD_KEYS, `hazards[${index}]`);
        const categoryId = readText(item.categoryId, `hazards[${index}].categoryId`, 100);
        if (!allowed.has(categoryId))
            throw new AIProposalError('invalid', `hazards[${index}] has an unknown categoryId.`);
        const hazardId = readText(item.hazardId, `hazards[${index}].hazardId`, 100);
        const normalizedHazardId = (0, proposalContract_1.canonicalHazardId)(hazardId);
        if (seenHazardIds.has(normalizedHazardId))
            throw new AIProposalError('invalid', `hazards contains a duplicate hazardId: ${hazardId}.`);
        seenHazardIds.add(normalizedHazardId);
        return {
            hazardId,
            hazardName: readText(item.hazardName, `hazards[${index}].hazardName`, 200),
            categoryId: categoryId,
            evidenceReferences: readEvidenceKeys(item.evidenceReferences, `hazards[${index}].evidenceReferences`),
            rationale: readText(item.rationale, `hazards[${index}].rationale`, 2_000),
        };
    });
}
function readCategories(value, allowedCategoryIds) {
    if (!Array.isArray(value) || value.length !== allowedCategoryIds.length) {
        throw new AIProposalError('invalid', `categories must contain exactly ${allowedCategoryIds.length} items.`);
    }
    const allowed = new Set(allowedCategoryIds);
    const seen = new Set();
    return value.map((item, index) => {
        if (!isRecord(item))
            throw new AIProposalError('invalid', `categories[${index}] must be an object.`);
        rejectUnknownKeys(item, CATEGORY_KEYS, `categories[${index}]`);
        const categoryId = readText(item.categoryId, `categories[${index}].categoryId`, 100);
        if (!allowed.has(categoryId) || seen.has(categoryId)) {
            throw new AIProposalError('invalid', `categories contains an unknown or duplicate categoryId: ${categoryId}.`);
        }
        seen.add(categoryId);
        return {
            categoryId,
            likelihood: readRating(item.likelihood, `categories[${index}].likelihood`),
            severity: readRating(item.severity, `categories[${index}].severity`),
            evidenceReferences: readEvidenceKeys(item.evidenceReferences, `categories[${index}].evidenceReferences`),
            rationale: readText(item.rationale, `categories[${index}].rationale`, 2_000),
            confidence: readConfidence(item.confidence, `categories[${index}].confidence`),
            concerns: readStringArray(item.concerns, `categories[${index}].concerns`, 10, 200),
            missingInformation: readStringArray(item.missingInformation, `categories[${index}].missingInformation`, 10, 200),
        };
    });
}
function readRating(value, field) {
    if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 5) {
        throw new AIProposalError('invalid', `${field} must be an integer from 1 to 5.`);
    }
    return value;
}
function readConfidence(value, field) {
    if (typeof value !== 'string' || !CONFIDENCE_LEVELS.has(value)) {
        throw new AIProposalError('invalid', `${field} must be low, medium, or high.`);
    }
    return value;
}
function readEvidenceKeys(value, field) {
    const keys = readStringArray(value, field, proposalContract_1.CANONICAL_EVIDENCE_KEYS.size, 100);
    if (!(0, proposalContract_1.isCanonicalEvidenceReferenceList)(keys)) {
        if (new Set(keys).size !== keys.length)
            throw new AIProposalError('invalid', `${field} contains duplicate evidence keys.`);
        throw new AIProposalError('invalid', `${field} contains an unknown evidence key.`);
    }
    return keys;
}
function readText(value, field, maxLength) {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
        throw new AIProposalError('invalid', `${field} must be a non-empty string of at most ${maxLength} characters.`);
    }
    return value.trim();
}
function readStringArray(value, field, maxItems, maxItemLength) {
    if (!Array.isArray(value) || value.length > maxItems || !value.every((item) => typeof item === 'string' && item.trim().length > 0 && item.length <= maxItemLength)) {
        throw new AIProposalError('invalid', `${field} must be an array of at most ${maxItems} non-empty short strings.`);
    }
    return value.map((item) => item.trim());
}
function rejectUnknownKeys(value, allowed, field) {
    const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key));
    if (unknownKeys.length > 0)
        throw new AIProposalError('invalid', `${field} contains unsupported fields: ${unknownKeys.join(', ')}.`);
}
function categoryEvidenceKey(categoryId) {
    const mapping = {
        crowd: 'crowd', venue_fire: 'venue', weather_environment: 'weather', public_health: 'public_health',
        food_water_sanitation: 'sanitation', medical_capacity: 'medical', security_cbrn: 'security', transport_accessibility: 'transport',
    };
    return mapping[categoryId] ?? 'compliance';
}
function guidelinePayload() {
    const ids = new Set(categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.flatMap((category) => category.guidelineChecks));
    return [...ids].map((id) => standardsRegistry_1.GUIDELINES[id]).filter(Boolean).map((guideline) => ({
        id: guideline.id,
        title: guideline.title,
        issuer: guideline.issuer,
        kind: guideline.kind,
        jurisdiction: guideline.jurisdiction,
        url: guideline.url,
        note: guideline.note,
    }));
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
    let timeout;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new AIProposalError('timeout', `MiniMax request timed out after ${timeoutMs}ms.`)), timeoutMs);
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