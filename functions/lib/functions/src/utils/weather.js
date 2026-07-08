"use strict";
/**
 * OpenWeather API integration (PRD §6).
 *
 * Free tier: 1000 calls/day. Cache results by (lat, lng, day) in memory
 * within a Cloud Function instance to reduce calls during demo bursts.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchWeather = fetchWeather;
const axios_1 = __importDefault(require("axios"));
const CACHE = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
async function fetchWeather(location, fallbackName) {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) {
        // eslint-disable-next-line no-console
        console.warn('[weather] No OPENWEATHER_API_KEY; returning default.');
        return {
            forecast: 'Unknown (no API key)',
            temperature: 28,
            humidity: 70,
            windSpeed: 2,
            precipitationProbability: 20,
            severeAlert: false,
        };
    }
    // Resolve coords — for prototype, use a default KL location if missing.
    const lat = location?.lat ?? 3.139;
    const lng = location?.lng ?? 101.6869;
    const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    const cached = CACHE.get(cacheKey);
    if (cached && Date.now() - cached._ts < CACHE_TTL_MS) {
        return cached;
    }
    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&units=metric&appid=${apiKey}`;
        const { data } = await axios_1.default.get(url, { timeout: 5000 });
        const result = {
            forecast: data?.weather?.[0]?.main ?? 'Unknown',
            temperature: Math.round(data?.main?.temp ?? 28),
            humidity: Math.round(data?.main?.humidity ?? 70),
            windSpeed: Math.round((data?.wind?.speed ?? 2) * 10) / 10,
            precipitationProbability: Math.round(((data?.clouds?.all ?? 20)) * 0.6), // rough proxy
            severeAlert: false, // TODO: parse one-call API alerts
        };
        CACHE.set(cacheKey, { ...result, _ts: Date.now() });
        return result;
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[weather] Fetch failed for ${fallbackName}:`, err instanceof Error ? err.message : err);
        return {
            forecast: 'Unavailable',
            temperature: 28,
            humidity: 70,
            windSpeed: 2,
            precipitationProbability: 20,
            severeAlert: false,
        };
    }
}
//# sourceMappingURL=weather.js.map