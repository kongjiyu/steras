"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const minimaxModels_1 = require("../utils/minimaxModels");
async function main() {
    const model = await (0, minimaxModels_1.verifyMiniMaxModel)(process.env.MINIMAX_API_KEY ?? '');
    console.log(`[minimax] Verified model: ${model.id}`);
}
main().catch((error) => {
    console.error(`[minimax] Verification failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
});
//# sourceMappingURL=verifyMiniMaxModel.js.map