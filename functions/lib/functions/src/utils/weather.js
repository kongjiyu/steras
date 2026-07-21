"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchWeather = fetchWeather;
exports.parseWeatherResponse = parseWeatherResponse;
exports.clearWeatherCache = clearWeatherCache;
const axios_1 = __importDefault(require("axios"));
const CACHE_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 2_500;
const CACHE = new Map();
async function fetchWeather(location, fallbackName, forecastFor, options = {}) {
    const now = options.now ?? Date.now();
    if (!location)
        return fallbackSnapshot(forecastFor, now, 'Location unavailable');
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
        const request = options.request ?? (async (requestUrl) => (await axios_1.default.get(requestUrl, { timeout: REQUEST_TIMEOUT_MS })).data);
        const payload = await requestWithRetry(request, url);
        const data = parseWeatherResponse(payload, forecastFor);
        const snapshot = {
            data,
            source: 'openweather',
            freshness: 'fresh',
            fetchedAt: now,
            expiresAt: now + CACHE_TTL_MS,
            forecastFor,
        };
        CACHE.set(cacheKey, snapshot);
        return snapshot;
    }
    catch (error) {
        console.warn(`[weather] Fetch failed for ${fallbackName}:`, error instanceof Error ? error.message : error);
        return cached
            ? { ...cached, source: 'cache', freshness: 'stale' }
            : fallbackSnapshot(forecastFor, now, 'Weather unavailable');
    }
}
async function requestWithRetry(request, url) {
    try {
        return await request(url);
    }
    catch {
        return request(url);
    }
}
function parseWeatherResponse(payload, forecastFor) {
    if (!isRecord(payload))
        throw new Error('OpenWeather response is not an object.');
    const daily = Array.isArray(payload.daily) ? payload.daily.filter(isRecord) : [];
    const selected = daily.reduce((closest, item) => {
        if (typeof item.dt !== 'number')
            return closest;
        if (!closest || typeof closest.dt !== 'number')
            return item;
        return Math.abs(item.dt * 1_000 - forecastFor) < Math.abs(closest.dt * 1_000 - forecastFor) ? item : closest;
    }, undefined);
    const current = isRecord(payload.current) ? payload.current : undefined;
    const source = selected ?? current;
    if (!source)
        throw new Error('OpenWeather response has no forecast data.');
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
function clearWeatherCache() {
    CACHE.clear();
}
function fallbackSnapshot(forecastFor, now, forecast) {
    return {
        data: { forecast, temperature: 28, humidity: 70, windSpeed: 2, precipitationProbability: 20, severeAlert: false },
        source: 'fallback',
        freshness: 'fallback',
        fetchedAt: now,
        expiresAt: now,
        forecastFor,
    };
}
function localDate(epochMs) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(epochMs);
}
function roundedNumber(value, fallback, digits = 0) {
    const number = numberValue(value, fallback);
    const factor = 10 ** digits;
    return Math.round(number * factor) / factor;
}
function numberValue(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function stringValue(value) {
    return typeof value === 'string' && value.trim() ? value : undefined;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=weather.js.map