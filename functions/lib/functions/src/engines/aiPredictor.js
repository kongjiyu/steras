"use strict";
/**
 * Module 2 — AI Risk Predictor (PRD §4)
 *
 * Wraps MiniMax M3 (Anthropic-compatible LLM) for contextual risk reasoning.
 * Always returns structured JSON. Logs raw prompt+response for audit.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.predictWithAI = predictWithAI;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const MODEL = process.env.MINIMAX_MODEL ?? 'MiniMax-M3';
const PROMPT_VERSION = 'v1.0'; // bump when system prompt changes
/**
 * @param apiKey  MiniMax M3 API key (from env / secret)
 * @param event   the event record
 * @param weather weather context
 * @param isHoliday, isWeekend context flags
 */
async function predictWithAI(apiKey, event, weather, isHoliday, isWeekend) {
    const client = new sdk_1.default({ apiKey });
    const userMessage = buildUserPrompt(event, weather, isHoliday, isWeekend);
    const systemPrompt = buildSystemPrompt();
    const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
            {
                role: 'user',
                content: userMessage,
            },
        ],
    });
    // Extract text content (Anthropic SDK returns content as array of blocks).
    const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
    // Parse JSON from the response. Be defensive — LLM might wrap in code fences.
    const jsonText = extractJson(text);
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    }
    catch {
        throw new Error(`[AI Predictor] Failed to parse LLM JSON response. Raw text: ${text.slice(0, 500)}`);
    }
    // Validate required fields; fall back to safe defaults if missing.
    const riskScore = clampInt(parsed.riskScore ?? 0, 0, 100);
    const riskLevel = parsed.riskLevel ?? toRiskLevel(riskScore);
    return {
        riskLevel,
        riskScore,
        reasoning: parsed.reasoning ?? 'No reasoning provided by AI.',
        keyConcerns: Array.isArray(parsed.keyConcerns) ? parsed.keyConcerns : [],
        recommendedResources: parsed.recommendedResources ?? {},
        rawResponse: text,
        model: MODEL,
        promptVersion: PROMPT_VERSION,
        generatedAt: Date.now(),
    };
}
// =====================================================================
// Prompts
// =====================================================================
function buildSystemPrompt() {
    return `You are an event safety risk assessment expert for Malaysian tourism events.

Your task: given event details, weather forecast, public-holiday context, and venue history, produce a structured JSON risk assessment that Malaysian authorities (PDRM, Bomba, KKM, DBKL) can use to inform their decision.

Always respond with ONLY a valid JSON object (no prose, no markdown fences) with these exact fields:
{
  "riskLevel": "Low" | "Medium" | "High",
  "riskScore": <integer 0-100>,
  "reasoning": "<2-4 sentence explanation grounded in the inputs>",
  "keyConcerns": [<string>, ...],  // 1-5 short tags, e.g. "thunderstorm", "over_capacity", "high_attendance", "outdoor_uncovered", "public_holiday"
  "recommendedResources": {        // best-guess resource counts
    "police": <integer>,
    "medicalTeams": <integer>,
    "ambulances": <integer>,
    "toilets": <integer>,
    "security": <integer>,
    "fireOfficers": <integer>,
    "wasteBins": <integer>
  }
}

Risk calibration:
- 0-29: Low — small indoor event, mild weather, no concerning history
- 30-59: Medium — moderate crowd, mixed signals, weekend or near-holiday
- 60-100: High — large outdoor crowd, severe weather, over-capacity, recent incidents, public holiday

Use Malaysian public-holiday and WHO Mass Gathering guidelines as your reference standards. Be specific, not generic.`;
}
function buildUserPrompt(event, weather, isHoliday, isWeekend) {
    return JSON.stringify({
        event: {
            name: event.eventDetails.name,
            type: event.eventDetails.type,
            venueName: event.eventDetails.venueName,
            venueAddress: event.eventDetails.venueAddress,
            venueCapacity: event.eventDetails.venueCapacity,
            expectedAttendance: event.eventDetails.expectedAttendance,
            utilization: event.eventDetails.venueCapacity > 0
                ? +(event.eventDetails.expectedAttendance / event.eventDetails.venueCapacity).toFixed(2)
                : null,
            startDatetime: new Date(event.eventDetails.startDatetime).toISOString(),
            endDatetime: new Date(event.eventDetails.endDatetime).toISOString(),
            durationHours: +((event.eventDetails.endDatetime - event.eventDetails.startDatetime) /
                3600000).toFixed(1),
            description: event.eventDetails.description ?? null,
        },
        context: {
            weather: {
                forecast: weather.forecast,
                temperatureC: weather.temperature,
                humidityPct: weather.humidity,
                windSpeedMs: weather.windSpeed,
                precipitationProbabilityPct: weather.precipitationProbability,
                severeAlert: weather.severeAlert,
            },
            isPublicHoliday: isHoliday,
            isWeekend,
        },
    }, null, 2);
}
// =====================================================================
// Helpers
// =====================================================================
function extractJson(text) {
    // Strip markdown code fences if present.
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch)
        return fenceMatch[1].trim();
    // Find first { ... last }.
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first)
        return text.slice(first, last + 1);
    return text.trim();
}
function clampInt(n, lo, hi) {
    const i = Math.round(n);
    return Math.max(lo, Math.min(hi, i));
}
function toRiskLevel(score) {
    if (score >= 60)
        return 'High';
    if (score >= 30)
        return 'Medium';
    return 'Low';
}
//# sourceMappingURL=aiPredictor.js.map