import axios from 'axios';
import { VenueLocation, WeatherContext, WeatherSnapshot } from '@shared/types';

const CACHE_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 2_500;
const CACHE = new Map<string, WeatherSnapshot>();

interface WeatherOptions {
  now?: number;
  apiKey?: string;
  request?: (url: string) => Promise<unknown>;
}

export async function fetchWeather(
  location: VenueLocation | undefined,
  fallbackName: string,
  forecastFor: number,
  options: WeatherOptions = {},
): Promise<WeatherSnapshot> {
  const now = options.now ?? Date.now();
  if (!location) return fallbackSnapshot(forecastFor, now, 'Location unavailable');

  const cacheKey = `${location.lat.toFixed(2)},${location.lng.toFixed(2)},${localDate(forecastFor)}`;
  const cached = CACHE.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return { ...cached, source: 'cache', freshness: 'fresh' };
  }

  const apiKey = options.apiKey ?? process.env.OPENWEATHER_API_KEY;
  if (!apiKey || apiKey === 'disabled') {
    return cached
      ? { ...cached, source: 'cache', freshness: 'stale' }
      : fallbackSnapshot(forecastFor, now, 'Weather API not configured');
  }

  try {
    const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${location.lat}&lon=${location.lng}&exclude=minutely,hourly&units=metric&appid=${apiKey}`;
    const request = options.request ?? (async (requestUrl: string) => (await axios.get(requestUrl, { timeout: REQUEST_TIMEOUT_MS })).data);
    const payload = await requestWithRetry(request, url);
    const data = parseWeatherResponse(payload, forecastFor);
    const snapshot: WeatherSnapshot = {
      data,
      source: 'openweather',
      freshness: 'fresh',
      fetchedAt: now,
      expiresAt: now + CACHE_TTL_MS,
      forecastFor,
    };
    CACHE.set(cacheKey, snapshot);
    return snapshot;
  } catch (error) {
    console.warn(`[weather] Fetch failed for ${fallbackName}:`, error instanceof Error ? error.message : error);
    return cached
      ? { ...cached, source: 'cache', freshness: 'stale' }
      : fallbackSnapshot(forecastFor, now, 'Weather unavailable');
  }
}

async function requestWithRetry(request: (url: string) => Promise<unknown>, url: string): Promise<unknown> {
  try {
    return await request(url);
  } catch {
    return request(url);
  }
}

export function parseWeatherResponse(payload: unknown, forecastFor: number): WeatherContext {
  if (!isRecord(payload)) throw new Error('OpenWeather response is not an object.');
  const daily = Array.isArray(payload.daily) ? payload.daily.filter(isRecord) : [];
  const selected = daily.reduce<Record<string, unknown> | undefined>((closest, item) => {
    if (typeof item.dt !== 'number') return closest;
    if (!closest || typeof closest.dt !== 'number') return item;
    return Math.abs(item.dt * 1_000 - forecastFor) < Math.abs(closest.dt * 1_000 - forecastFor) ? item : closest;
  }, undefined);
  const current = isRecord(payload.current) ? payload.current : undefined;
  const source = selected ?? current;
  if (!source) throw new Error('OpenWeather response has no forecast data.');
  if (typeof source.dt !== 'number' || Math.abs(source.dt * 1_000 - forecastFor) > 36 * 60 * 60 * 1_000) {
    throw new Error('Event is outside the available weather forecast horizon.');
  }
  const temperature = isRecord(source.temp) ? source.temp.day : source.temp;
  const weather = Array.isArray(source.weather) && isRecord(source.weather[0]) ? source.weather[0] : undefined;
  const alerts = Array.isArray(payload.alerts) ? payload.alerts.filter(isRecord) : [];
  const severeAlert = alerts.some((alert) => {
    const start = typeof alert.start === 'number' ? alert.start * 1_000 : 0;
    const end = typeof alert.end === 'number' ? alert.end * 1_000 : Number.MAX_SAFE_INTEGER;
    return forecastFor >= start && forecastFor <= end;
  });
  return {
    forecast: stringValue(weather?.main) ?? stringValue(weather?.description) ?? 'Unknown',
    temperature: roundedNumber(temperature, 28),
    humidity: roundedNumber(source.humidity, 70),
    windSpeed: roundedNumber(source.wind_speed, 2, 1),
    precipitationProbability: Math.round(numberValue(source.pop, 0.2) * 100),
    severeAlert,
  };
}

export function clearWeatherCache(): void {
  CACHE.clear();
}

function fallbackSnapshot(forecastFor: number, now: number, forecast: string): WeatherSnapshot {
  return {
    data: { forecast, temperature: 28, humidity: 70, windSpeed: 2, precipitationProbability: 20, severeAlert: false },
    source: 'fallback',
    freshness: 'fallback',
    fetchedAt: now,
    expiresAt: now,
    forecastFor,
  };
}

function localDate(epochMs: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(epochMs);
}

function roundedNumber(value: unknown, fallback: number, digits = 0): number {
  const number = numberValue(value, fallback);
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
