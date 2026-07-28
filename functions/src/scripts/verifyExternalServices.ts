import axios from 'axios';
import { AssessmentContextSnapshot, EventRecord } from '@shared/types';
import { predictWithAI } from '../engines/aiPredictor';
import { computeCategoryBasedAssessment } from '../engines/ruleBased';
import { verifyMiniMaxModel } from '../utils/minimaxModels';

interface CheckResult {
  service: string;
  ok: boolean;
  detail: string;
}

async function main(): Promise<void> {
  const results: CheckResult[] = [];
  const minimaxKey = process.env.MINIMAX_API_KEY?.trim() ?? '';
  const openWeatherKey = process.env.OPENWEATHER_API_KEY?.trim() ?? '';

  try {
    const model = await verifyMiniMaxModel(minimaxKey);
    results.push({ service: 'MiniMax Models API', ok: true, detail: `Configured model is available: ${model.id}` });
  } catch (error) {
    results.push({ service: 'MiniMax Models API', ok: false, detail: errorMessage(error) });
  }

  const { event, context } = buildSyntheticAssessmentInput();
  const officialResult = computeCategoryBasedAssessment(event, context);
  try {
    const startedAt = Date.now();
    const advisory = await predictWithAI(minimaxKey, event, context, officialResult);
    results.push({
      service: 'MiniMax advisory API',
      ok: true,
      detail: `${advisory.model} returned schema-valid ${advisory.categories.length}-category JSON in ${Date.now() - startedAt}ms`,
    });
  } catch (error) {
    results.push({ service: 'MiniMax advisory API', ok: false, detail: errorMessage(error) });
  }

  if (!openWeatherKey) {
    results.push({ service: 'OpenWeather credential', ok: false, detail: 'OPENWEATHER_API_KEY is missing.' });
    results.push({ service: 'OpenWeather 5-day forecast', ok: false, detail: 'Skipped because OPENWEATHER_API_KEY is missing.' });
  } else {
    results.push(await checkOpenWeather(
      'OpenWeather credential',
      'https://api.openweathermap.org/data/2.5/weather',
      openWeatherKey,
    ));
    results.push(await checkOpenWeather(
      'OpenWeather 5-day forecast',
      'https://api.openweathermap.org/data/2.5/forecast',
      openWeatherKey,
    ));
  }

  for (const result of results) {
    console.log(`[${result.ok ? 'PASS' : 'FAIL'}] ${result.service}: ${result.detail}`);
  }
  console.log('[assessment] Synthetic official categories:', officialResult.categoryAssignments
    .map((category) => `${category.categoryId}=${category.score}/${category.riskLevel}`)
    .join(', '));

  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

async function checkOpenWeather(
  service: string,
  url: string,
  apiKey: string,
  extraParams: Record<string, string> = {},
): Promise<CheckResult> {
  try {
    await axios.get(url, {
      params: { lat: 3.139, lon: 101.687, units: 'metric', appid: apiKey, ...extraParams },
      timeout: 10_000,
    });
    return { service, ok: true, detail: 'Request succeeded for Kuala Lumpur test coordinates.' };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? 'network';
      const data = error.response?.data;
      const detail = isRecord(data) && typeof data.message === 'string' ? data.message : error.message;
      return { service, ok: false, detail: `HTTP ${status}: ${detail}` };
    }
    return { service, ok: false, detail: errorMessage(error) };
  }
}

function buildSyntheticAssessmentInput(): { event: EventRecord; context: AssessmentContextSnapshot } {
  const now = Date.now();
  const startDatetime = now + 24 * 60 * 60 * 1_000;
  const event: EventRecord = {
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
  const context: AssessmentContextSnapshot = {
    weather: {
      data: {
        forecast: 'Weather API unavailable',
        temperature: 28,
        humidity: 70,
        windSpeed: 2,
        precipitationProbability: 20,
        severeAlert: false,
      },
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
    },
    venue: { matched: false, submittedCapacity: 30_000, fetchedAt: now },
    incidentHistory: {
      matched: false,
      incidentIds: [],
      total: 0,
      bySeverity: { low: 0, medium: 0, high: 0 },
      fetchedAt: now,
    },
  };
  return { event, context };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

void main();
