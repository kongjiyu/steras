"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASSESSMENT_SECRETS = exports.OPENWEATHER_API_KEY = exports.MINIMAX_API_KEY = void 0;
const params_1 = require("firebase-functions/params");
exports.MINIMAX_API_KEY = (0, params_1.defineSecret)('MINIMAX_API_KEY');
exports.OPENWEATHER_API_KEY = (0, params_1.defineSecret)('OPENWEATHER_API_KEY');
exports.ASSESSMENT_SECRETS = [exports.MINIMAX_API_KEY, exports.OPENWEATHER_API_KEY];
//# sourceMappingURL=secrets.js.map