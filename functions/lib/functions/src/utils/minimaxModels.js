"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyMiniMaxModel = verifyMiniMaxModel;
const axios_1 = __importDefault(require("axios"));
const minimax_1 = require("../config/minimax");
async function verifyMiniMaxModel(apiKey, model = process.env.MINIMAX_MODEL ?? minimax_1.DEFAULT_MINIMAX_MODEL, baseURL = process.env.MINIMAX_BASE_URL ?? minimax_1.DEFAULT_MINIMAX_BASE_URL, request) {
    if (!apiKey.trim())
        throw new Error('MINIMAX_API_KEY is required to verify the configured model.');
    const url = `${baseURL.replace(/\/+$/, '')}/v1/models`;
    const payload = request
        ? await request(url, apiKey)
        : (await axios_1.default.get(url, { headers: { 'X-Api-Key': apiKey }, timeout: 10_000 })).data;
    if (!isRecord(payload) || !Array.isArray(payload.data))
        throw new Error('MiniMax Models API returned an invalid response.');
    const match = payload.data.find((item) => isRecord(item) && item.id === model);
    if (!isRecord(match) || typeof match.id !== 'string') {
        const available = payload.data.flatMap((item) => isRecord(item) && typeof item.id === 'string' ? [item.id] : []);
        throw new Error(`Configured MiniMax model "${model}" is unavailable. Available models: ${available.join(', ') || 'none'}.`);
    }
    return { id: match.id, ...(typeof match.display_name === 'string' ? { displayName: match.display_name } : {}) };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=minimaxModels.js.map