import { defineSecret } from 'firebase-functions/params';

export const MINIMAX_API_KEY = defineSecret('MINIMAX_API_KEY');
export const OPENWEATHER_API_KEY = defineSecret('OPENWEATHER_API_KEY');

export const ASSESSMENT_SECRETS = [MINIMAX_API_KEY, OPENWEATHER_API_KEY];
