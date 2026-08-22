"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const weather_1 = require("./weather");
const forecastFor = Date.parse('2026-08-31T04:00:00Z');
(0, vitest_1.beforeEach)(weather_1.clearWeatherCache);
(0, vitest_1.describe)('weather context', () => {
    (0, vitest_1.it)('selects the daily forecast closest to the event and applies alerts', () => {
        const weather = (0, weather_1.parseWeatherResponse)({
            daily: [
                { dt: forecastFor / 1_000 - 86_400, temp: { day: 30 }, humidity: 70, wind_speed: 2, pop: 0.1, weather: [{ main: 'Clear' }] },
                { dt: forecastFor / 1_000, temp: { day: 32.4 }, humidity: 88, wind_speed: 4.44, pop: 0.82, weather: [{ main: 'Thunderstorm' }] },
            ],
            alerts: [{ start: forecastFor / 1_000 - 100, end: forecastFor / 1_000 + 100 }],
        }, forecastFor);
        (0, vitest_1.expect)(weather).toMatchObject({ forecast: 'Thunderstorm', temperature: 32, humidity: 88, windSpeed: 4.4, precipitationProbability: 82, severeAlert: true });
    });
    (0, vitest_1.it)('parses the subscription-free 5-day forecast shape', () => {
        const weather = (0, weather_1.parseWeatherResponse)({
            list: [{
                    dt: forecastFor / 1_000,
                    main: { temp: 31.2, humidity: 84 },
                    wind: { speed: 5.6 },
                    pop: 0.7,
                    weather: [{ main: 'Rain' }],
                }],
        }, forecastFor);
        (0, vitest_1.expect)(weather).toMatchObject({
            forecast: 'Rain',
            temperature: 31,
            humidity: 84,
            windSpeed: 5.6,
            precipitationProbability: 70,
        });
    });
    (0, vitest_1.it)('returns fresh cache and stale cache when refresh fails', async () => {
        const location = { lat: 3.139, lng: 101.687 };
        const request = async () => ({ daily: [{ dt: forecastFor / 1_000, temp: { day: 30 }, humidity: 80, wind_speed: 3, pop: 0.5, weather: [{ main: 'Rain' }] }] });
        (0, vitest_1.expect)((await (0, weather_1.fetchWeather)(location, 'KL', forecastFor, { now: 1_000, apiKey: 'test', request })).source).toBe('openweather');
        (0, vitest_1.expect)(await (0, weather_1.fetchWeather)(location, 'KL', forecastFor, { now: 2_000, apiKey: 'test', request })).toMatchObject({ source: 'cache', freshness: 'fresh' });
        (0, vitest_1.expect)(await (0, weather_1.fetchWeather)(location, 'KL', forecastFor, { now: 2_000_000, apiKey: 'test', request: async () => { throw new Error('offline'); } })).toMatchObject({ source: 'cache', freshness: 'stale' });
    });
    (0, vitest_1.it)('does not invent Kuala Lumpur coordinates when location is absent', async () => {
        const result = await (0, weather_1.fetchWeather)(undefined, 'Unknown', forecastFor, { now: 100, apiKey: 'test' });
        (0, vitest_1.expect)(result).toMatchObject({ source: 'fallback', freshness: 'unavailable', measurementStatus: 'unavailable', data: null });
        (0, vitest_1.expect)(JSON.stringify(result)).not.toMatch(/temperature|humidity|windSpeed|precipitationProbability/);
    });
    vitest_1.it.each([
        { lat: Number.NaN, lng: 101.687 },
        { lat: 91, lng: 101.687 },
        { lat: 3.139, lng: Number.POSITIVE_INFINITY },
        { lat: 3.139, lng: -181 },
    ])('UC-M2-04 rejects unusable provider coordinates without making a request: $lat,$lng', async (location) => {
        let requests = 0;
        const result = await (0, weather_1.fetchWeather)(location, 'Invalid', forecastFor, {
            now: 100,
            apiKey: 'test',
            request: async () => {
                requests += 1;
                throw new Error('must not be called');
            },
        });
        (0, vitest_1.expect)(result).toMatchObject({ source: 'fallback', freshness: 'unavailable', data: null });
        (0, vitest_1.expect)(requests).toBe(0);
    });
    (0, vitest_1.it)('retries one transient request failure', async () => {
        let attempts = 0;
        const result = await (0, weather_1.fetchWeather)({ lat: 5.4, lng: 100.3 }, 'Penang', forecastFor, {
            now: 100,
            apiKey: 'test',
            request: async () => {
                attempts += 1;
                if (attempts === 1)
                    throw new Error('temporary');
                return { daily: [{ dt: forecastFor / 1_000, temp: { day: 29 }, humidity: 70, wind_speed: 2, pop: 0, weather: [{ main: 'Clear' }] }] };
            },
        });
        (0, vitest_1.expect)(result.source).toBe('openweather');
        (0, vitest_1.expect)(attempts).toBe(2);
    });
    (0, vitest_1.it)('rejects a forecast outside the event window', () => {
        (0, vitest_1.expect)(() => (0, weather_1.parseWeatherResponse)({
            daily: [{ dt: forecastFor / 1_000 - 8 * 86_400, temp: { day: 30 }, weather: [{ main: 'Clear' }] }],
        }, forecastFor)).toThrow(/forecast horizon/);
    });
    vitest_1.it.each([
        { temp: 'hot', humidity: 80, wind_speed: 3 },
        { temp: 30, humidity: Number.NaN, wind_speed: 3 },
        { temp: 30, humidity: 80, wind_speed: -1 },
    ])('UC-M2-04 rejects malformed weather measurements instead of substituting defaults', (measurements) => {
        (0, vitest_1.expect)(() => (0, weather_1.parseWeatherResponse)({
            daily: [{ dt: forecastFor / 1_000, ...measurements, weather: [{ main: 'Rain' }] }],
        }, forecastFor)).toThrow(/weather measurement/i);
    });
});
//# sourceMappingURL=weather.test.js.map