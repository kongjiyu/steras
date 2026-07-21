import axios from 'axios';
import { DEFAULT_MINIMAX_BASE_URL, DEFAULT_MINIMAX_MODEL } from '../config/minimax';

interface ModelRecord {
  id: string;
  displayName?: string;
}

export async function verifyMiniMaxModel(
  apiKey: string,
  model = process.env.MINIMAX_MODEL ?? DEFAULT_MINIMAX_MODEL,
  baseURL = process.env.MINIMAX_BASE_URL ?? DEFAULT_MINIMAX_BASE_URL,
  request?: (url: string, apiKey: string) => Promise<unknown>,
): Promise<ModelRecord> {
  if (!apiKey.trim()) throw new Error('MINIMAX_API_KEY is required to verify the configured model.');
  const url = `${baseURL.replace(/\/+$/, '')}/v1/models`;
  const payload = request
    ? await request(url, apiKey)
    : (await axios.get(url, { headers: { 'X-Api-Key': apiKey }, timeout: 10_000 })).data;
  if (!isRecord(payload) || !Array.isArray(payload.data)) throw new Error('MiniMax Models API returned an invalid response.');
  const match = payload.data.find((item) => isRecord(item) && item.id === model);
  if (!isRecord(match) || typeof match.id !== 'string') {
    const available = payload.data.flatMap((item) => isRecord(item) && typeof item.id === 'string' ? [item.id] : []);
    throw new Error(`Configured MiniMax model "${model}" is unavailable. Available models: ${available.join(', ') || 'none'}.`);
  }
  return { id: match.id, ...(typeof match.display_name === 'string' ? { displayName: match.display_name } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
