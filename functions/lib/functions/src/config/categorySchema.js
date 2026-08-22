"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACTIVE_CATEGORY_SCHEMA = void 0;
const types_1 = require("../../../shared/types");
/**
 * Temporary M2 configuration that preserves the existing deterministic inputs
 * behind the category-based contract required by STERAS_PRD.md.
 *
 * The team must replace the names, weights, thresholds, and guideline check IDs
 * after the category taxonomy and authority sources are approved. Until then the
 * status remains `prototype` and the UI must not present it as official guidance.
 */
exports.ACTIVE_CATEGORY_SCHEMA = {
    version: types_1.CATEGORY_SCHEMA_VERSION,
    scoringLogicVersion: types_1.SCORING_LOGIC_VERSION,
    status: types_1.CATEGORY_SCHEMA_STATUS,
    categories: [
        {
            id: 'crowd',
            name: 'Crowd safety',
            weight: 0.125,
            guidelineChecks: ['my.dosh.hirarc.2008', 'who.mass-gathering.all-hazards.2023', 'my.ubbl.state-specific'],
        },
        {
            id: 'venue_fire',
            name: 'Venue, fire and structural safety',
            weight: 0.125,
            guidelineChecks: ['my.dosh.hirarc.2008', 'my.fire-services-act.1988', 'my.ubbl.state-specific'],
        },
        {
            id: 'weather_environment',
            name: 'Weather and environmental exposure',
            weight: 0.125,
            guidelineChecks: ['my.dosh.hirarc.2008', 'who.mass-gathering.all-hazards.2023', 'my.met.warning-criteria'],
        },
        {
            id: 'public_health',
            name: 'Public health and epidemiology',
            weight: 0.125,
            guidelineChecks: ['who.mass-gathering.all-hazards.2023'],
        },
        {
            id: 'food_water_sanitation',
            name: 'Food, water and sanitation',
            weight: 0.125,
            guidelineChecks: ['who.mass-gathering.all-hazards.2023'],
        },
        {
            id: 'medical_capacity',
            name: 'Medical and health-system capacity',
            weight: 0.125,
            guidelineChecks: ['who.mass-gathering.all-hazards.2023', 'internal.resource-baseline.v3'],
        },
        {
            id: 'security_cbrn',
            name: 'Security, behaviour and CBRN',
            weight: 0.125,
            guidelineChecks: ['who.mass-gathering.all-hazards.2023'],
        },
        {
            id: 'transport_accessibility',
            name: 'Transport and accessibility',
            weight: 0.125,
            guidelineChecks: ['who.mass-gathering.all-hazards.2023', 'my.ubbl.state-specific'],
        },
    ],
};
//# sourceMappingURL=categorySchema.js.map