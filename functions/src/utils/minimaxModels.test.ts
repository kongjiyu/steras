import { describe, expect, it } from 'vitest';
import { verifyMiniMaxModel } from './minimaxModels';

describe('verifyMiniMaxModel', () => {
  it('verifies the configured model through the Anthropic-compatible Models API', async () => {
    const model = await verifyMiniMaxModel('secret', 'MiniMax-M3', 'https://api.minimax.io/anthropic/', async (url, apiKey) => {
      expect(url).toBe('https://api.minimax.io/anthropic/v1/models');
      expect(apiKey).toBe('secret');
      return { data: [{ id: 'MiniMax-M3', display_name: 'MiniMax-M3' }] };
    });
    expect(model).toEqual({ id: 'MiniMax-M3', displayName: 'MiniMax-M3' });
  });

  it('fails setup when the configured model is not listed', async () => {
    await expect(verifyMiniMaxModel('secret', 'missing', undefined, async () => ({ data: [{ id: 'MiniMax-M3' }] }))).rejects.toThrow(/unavailable/);
  });

  it('rejects missing credentials before making a request', async () => {
    await expect(verifyMiniMaxModel('')).rejects.toThrow(/API_KEY/);
  });
});
