"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACTIVE_RESOURCE_CONFIG = exports.RESOURCE_SOURCE_REGISTRY = exports.INTERNAL_RESOURCE_SOURCE_ID = exports.RESOURCE_SOURCE_REGISTRY_VERSION = exports.RESOURCE_FORMULA_VERSION = exports.RESOURCE_CONFIG_VERSION = void 0;
const types_1 = require("../../../shared/types");
var types_2 = require("../../../shared/types");
Object.defineProperty(exports, "RESOURCE_CONFIG_VERSION", { enumerable: true, get: function () { return types_2.RESOURCE_CONFIG_VERSION; } });
Object.defineProperty(exports, "RESOURCE_FORMULA_VERSION", { enumerable: true, get: function () { return types_2.RESOURCE_FORMULA_VERSION; } });
Object.defineProperty(exports, "RESOURCE_SOURCE_REGISTRY_VERSION", { enumerable: true, get: function () { return types_2.RESOURCE_SOURCE_REGISTRY_VERSION; } });
exports.INTERNAL_RESOURCE_SOURCE_ID = 'internal.resource-baseline.v4';
exports.RESOURCE_SOURCE_REGISTRY = {
    [exports.INTERNAL_RESOURCE_SOURCE_ID]: {
        sourceId: exports.INTERNAL_RESOURCE_SOURCE_ID,
        title: 'STERAS internal prototype resource baseline assumptions',
        issuer: 'STERAS',
        kind: 'internal_prototype',
        locator: 'functions/src/config/resourceRecommendationConfig.ts',
        version: types_1.RESOURCE_CONFIG_VERSION,
        retrievedAt: Date.UTC(2026, 7, 19),
        verificationStatus: 'prototype_unverified',
    },
};
exports.ACTIVE_RESOURCE_CONFIG = {
    formulaVersion: types_1.RESOURCE_FORMULA_VERSION,
    configVersion: types_1.RESOURCE_CONFIG_VERSION,
    sourceRegistryVersion: types_1.RESOURCE_SOURCE_REGISTRY_VERSION,
    planningRangeMultiplier: 1.25,
    baselines: {
        police: { divisor: 250, minimum: 2 },
        security: { divisor: 100, minimum: 0 },
        medicalTeams: { divisor: 1_000, minimum: 1 },
        ambulances: { divisor: 5_000, minimum: 1 },
        fireOfficers: { divisor: 500, minimum: 1 },
        toilets: { divisor: 50, minimum: 0 },
        wasteBins: { divisor: 100, minimum: 0 },
    },
    toiletSecondaryDivisor: 75,
    highOverallModifiers: {
        police: 10,
        medicalTeams: 1,
        ambulances: 1,
    },
    highCategoryModifiers: {
        crowd: { police: 5, security: 5 },
        weather_environment: { medicalTeams: 1 },
        venue_fire: { fireOfficers: 2 },
    },
    indoorModifiers: { fireOfficers: 1 },
    securityEventMultipliers: {
        concert: 2,
        festival: 1.5,
        sports: 1.5,
        cultural: 1,
        religious: 1.5,
        exhibition: 1,
        fair: 1,
        conference: 1,
        other: 1,
    },
    reviewingAuthorities: {
        police: 'PDRM',
        security: 'PDRM',
        medicalTeams: 'KKM',
        ambulances: 'KKM',
        fireOfficers: 'BOMBA',
        toilets: 'KKM',
        wasteBins: 'DBKL',
    },
    numericSourceId: exports.INTERNAL_RESOURCE_SOURCE_ID,
    assessmentCategoryIds: [
        'crowd', 'venue_fire', 'weather_environment', 'public_health',
        'food_water_sanitation', 'medical_capacity', 'security_cbrn', 'transport_accessibility',
    ],
};
//# sourceMappingURL=resourceRecommendationConfig.js.map