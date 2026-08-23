"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const minimaxModels_1 = require("./minimaxModels");
(0, vitest_1.describe)('verifyMiniMaxModel', () => {
    (0, vitest_1.it)('verifies the configured model through the Anthropic-compatible Models API', async () => {
        const model = await (0, minimaxModels_1.verifyMiniMaxModel)('secret', 'MiniMax-M3', 'https://api.minimax.io/anthropic/', async (url, apiKey) => {
            (0, vitest_1.expect)(url).toBe('https://api.minimax.io/anthropic/v1/models');
            (0, vitest_1.expect)(apiKey).toBe('secret');
            return { data: [{ id: 'MiniMax-M3', display_name: 'MiniMax-M3' }] };
        });
        (0, vitest_1.expect)(model).toEqual({ id: 'MiniMax-M3', displayName: 'MiniMax-M3' });
    });
    (0, vitest_1.it)('fails setup when the configured model is not listed', async () => {
        await (0, vitest_1.expect)((0, minimaxModels_1.verifyMiniMaxModel)('secret', 'missing', undefined, async () => ({ data: [{ id: 'MiniMax-M3' }] }))).rejects.toThrow(/unavailable/);
    });
    (0, vitest_1.it)('rejects missing credentials before making a request', async () => {
        await (0, vitest_1.expect)((0, minimaxModels_1.verifyMiniMaxModel)('')).rejects.toThrow(/API_KEY/);
    });
});
//# sourceMappingURL=minimaxModels.test.js.map