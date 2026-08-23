"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const aiPredictor_1 = require("../engines/aiPredictor");
const ruleBased_1 = require("../engines/ruleBased");
const minimaxModels_1 = require("../utils/minimaxModels");
async function main() {
    const results = [];
    const minimaxKey = process.env.MINIMAX_API_KEY?.trim() ?? '';
    const openWeatherKey = process.env.OPENWEATHER_API_KEY?.trim() ?? '';
    try {
        const model = await (0, minimaxModels_1.verifyMiniMaxModel)(minimaxKey);
        results.push({ service: 'MiniMax Models API', ok: true, detail: `Configured model is available: ${model.id}` });
    }
    catch (error) {
        results.push({ service: 'MiniMax Models API', ok: false, detail: errorMessage(error) });
    }
    const { event, context } = buildSyntheticAssessmentInput();
    const officialResult = (0, ruleBased_1.computeCategoryBasedAssessment)(event, context);
    try {
        const startedAt = Date.now();
        const advisory = await (0, aiPredictor_1.predictWithAI)(minimaxKey, event, context, officialResult);
        results.push({
            service: 'MiniMax advisory API',
            ok: true,
            detail: `${advisory.model} returned schema-valid ${advisory.categories.length}-category JSON in ${Date.now() - startedAt}ms`,
        });
    }
    catch (error) {
        results.push({ service: 'MiniMax advisory API', ok: false, detail: errorMessage(error) });
    }
    if (!openWeatherKey) {
        results.push({ service: 'OpenWeather credential', ok: false, detail: 'OPENWEATHER_API_KEY is missing.' });
        results.push({ service: 'OpenWeather 5-day forecast', ok: false, detail: 'Skipped because OPENWEATHER_API_KEY is missing.' });
    }
    else {
        results.push(await checkOpenWeather('OpenWeather credential', 'https://api.openweathermap.org/data/2.5/weather', openWeatherKey));
        results.push(await checkOpenWeather('OpenWeather 5-day forecast', 'https://api.openweathermap.org/data/2.5/forecast', openWeatherKey));
    }
    for (const result of results) {
        console.log(`[${result.ok ? 'PASS' : 'FAIL'}] ${result.service}: ${result.detail}`);
    }
    console.log('[assessment] Synthetic official categories:', officialResult.categoryAssignments
        .map((category) => `${category.categoryId}=${category.score}/${category.riskLevel}`)
        .join(', '));
    if (results.some((result) => !result.ok))
        process.exitCode = 1;
}
async function checkOpenWeather(service, url, apiKey, extraParams = {}) {
    try {
        await axios_1.default.get(url, {
            params: { lat: 3.139, lon: 101.687, units: 'metric', appid: apiKey, ...extraParams },
            timeout: 10_000,
        });
        return { service, ok: true, detail: 'Request succeeded for Kuala Lumpur test coordinates.' };
    }
    catch (error) {
        if (axios_1.default.isAxiosError(error)) {
            const status = error.response?.status ?? 'network';
            const data = error.response?.data;
            const detail = isRecord(data) && typeof data.message === 'string' ? data.message : error.message;
            return { service, ok: false, detail: `HTTP ${status}: ${detail}` };
        }
        return { service, ok: false, detail: errorMessage(error) };
    }
}
function buildSyntheticAssessmentInput() {
    const now = Date.now();
    const startDatetime = now + 24 * 60 * 60 * 1_000;
    const event = {
        eventId: 'external-service-check',
        organizerId: 'synthetic-test',
        status: 'Pending',
        currentVersionNumber: 1,
        draftDocumentPaths: [],
        requiredAuthorities: ['PDRM'],
        createdAt: now,
        updatedAt: now,
        eventDetails: {
            name: 'External Service Check',
            type: 'cultural',
            venueName: 'Dataran Merdeka',
            venueAddress: 'Kuala Lumpur',
            venueLocation: { lat: 3.1478, lng: 101.6937 },
            venueCapacity: 30_000,
            expectedAttendance: 18_000,
            environment: 'outdoor',
            coverage: 'uncovered',
            seating: 'standing',
            startDatetime,
            endDatetime: startDatetime + 4 * 60 * 60 * 1_000,
            emergencyPlanSummary: 'Synthetic external-service test data.',
            organizerName: 'Synthetic Test',
            organizerEmail: 'synthetic@example.com',
            organizerPhone: '+60000000000',
        },
    };
    const context = {
        weather: {
            data: null,
            measurementStatus: 'unavailable',
            unavailableReason: 'provider_unavailable',
            source: 'fallback',
            freshness: 'fallback',
            fetchedAt: now,
            expiresAt: now,
            forecastFor: startDatetime,
        },
        calendar: {
            localDate: new Date(startDatetime).toISOString().slice(0, 10),
            dayOfWeek: 'Saturday',
            isWeekend: true,
            isHolidayOrAdjacent: false,
            sourceVersion: 'synthetic-test',
            sourceTimestamp: now,
            coverageStatus: 'verified',
        },
        venue: { matched: false, submittedCapacity: 30_000, fetchedAt: now },
        incidentHistory: {
            matched: false,
            incidentIds: [],
            total: 0,
            bySeverity: { low: 0, medium: 0, high: 0 },
            syntheticStatus: 'none',
            fetchedAt: now,
        },
    };
    return { event, context };
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
void main();
//# sourceMappingURL=verifyExternalServices.js.map