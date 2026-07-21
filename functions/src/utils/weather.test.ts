import { beforeEach, describe, expect, it } from 'vitest';
import { clearWeatherCache, fetchWeather, parseWeatherResponse } from './weather';

const forecastFor = Date.parse('2026-08-31T04:00:00Z');

beforeEach(clearWeatherCache);

describe('weather context', () => {
  it('selects the daily forecast closest to the event and applies alerts', () => {
    const weather = parseWeatherResponse({
      daily: [
        { dt: forecastFor / 1_000 - 86_400, temp: { day: 30 }, humidity: 70, wind_speed: 2, pop: 0.1, weather: [{ main: 'Clear' }] },
        { dt: forecastFor / 1_000, temp: { day: 32.4 }, humidity: 88, wind_speed: 4.44, pop: 0.82, weather: [{ main: 'Thunderstorm' }] },
      ],
      alerts: [{ start: forecastFor / 1_000 - 100, end: forecastFor / 1_000 + 100 }],
    }, forecastFor);
    expect(weather).toMatchObject({ forecast: 'Thunderstorm', temperature: 32, humidity: 88, windSpeed: 4.4, precipitationProbability: 82, severeAlert: true });
  });

  it('returns fresh cache and stale cache when refresh fails', async () => {
    const location = { lat: 3.139, lng: 101.687 };
    const request = async () => ({ daily: [{ dt: forecastFor / 1_000, temp: { day: 30 }, humidity: 80, wind_speed: 3, pop: 0.5, weather: [{ main: 'Rain' }] }] });
    expect((await fetchWeather(location, 'KL', forecastFor, { now: 1_000, apiKey: 'test', request })).source).toBe('openweather');
    expect(await fetchWeather(location, 'KL', forecastFor, { now: 2_000, apiKey: 'test', request })).toMatchObject({ source: 'cache', freshness: 'fresh' });
    expect(await fetchWeather(location, 'KL', forecastFor, { now: 2_000_000, apiKey: 'test', request: async () => { throw new Error('offline'); } })).toMatchObject({ source: 'cache', freshness: 'stale' });
  });

  it('does not invent Kuala Lumpur coordinates when location is absent', async () => {
    expect(await fetchWeather(undefined, 'Unknown', forecastFor, { now: 100, apiKey: 'test' })).toMatchObject({ source: 'fallback', freshness: 'fallback' });
  });

  it('retries one transient request failure', async () => {
    let attempts = 0;
    const result = await fetchWeather({ lat: 5.4, lng: 100.3 }, 'Penang', forecastFor, {
      now: 100,
      apiKey: 'test',
      request: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary');
        return { daily: [{ dt: forecastFor / 1_000, temp: { day: 29 }, weather: [{ main: 'Clear' }] }] };
      },
    });
    expect(result.source).toBe('openweather');
    expect(attempts).toBe(2);
  });

  it('rejects a forecast outside the event window', () => {
    expect(() => parseWeatherResponse({
      daily: [{ dt: forecastFor / 1_000 - 8 * 86_400, temp: { day: 30 }, weather: [{ main: 'Clear' }] }],
    }, forecastFor)).toThrow(/forecast horizon/);
  });
});
