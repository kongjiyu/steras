"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.M1_VENUE_SETTING_VALUES = exports.M1_EVENT_CATEGORY_VALUES = void 0;
exports.m1ScenarioTemplateIdFor = m1ScenarioTemplateIdFor;
exports.m1CategoryForEventType = m1CategoryForEventType;
exports.m1VenueSettingMatchesEnvironment = m1VenueSettingMatchesEnvironment;
exports.isValidM1TemplateSelection = isValidM1TemplateSelection;
const types_1 = require("./types");
exports.M1_EVENT_CATEGORY_VALUES = [
    'entertainment_performance',
    'sports_recreational',
    'cultural_heritage_festival',
    'exhibition_convention_promotional',
    'carnival_public_celebration',
];
exports.M1_VENUE_SETTING_VALUES = [
    'indoor',
    'outdoor_fixed_site',
    'outdoor_route_based',
];
const TEMPLATE_MATRIX = {
    entertainment_performance: {
        indoor: 'STERAS-T01-ENT-IN-v2.0',
        outdoor_fixed_site: 'STERAS-T02-ENT-OF-v1.0',
        outdoor_route_based: 'STERAS-T03-ENT-OR-v1.0',
    },
    sports_recreational: {
        indoor: 'STERAS-T04-SPT-IN-v1.0',
        outdoor_fixed_site: 'STERAS-T05-SPT-OF-v1.0',
        outdoor_route_based: 'STERAS-T06-SPT-OR-v1.0',
    },
    cultural_heritage_festival: {
        indoor: 'STERAS-T07-CUL-IN-v1.0',
        outdoor_fixed_site: 'STERAS-T08-CUL-OF-v1.0',
        outdoor_route_based: 'STERAS-T09-CUL-OR-v1.0',
    },
    exhibition_convention_promotional: {
        indoor: 'STERAS-T10-EXP-IN-v1.0',
        outdoor_fixed_site: 'STERAS-T11-EXP-OF-v1.0',
        outdoor_route_based: 'STERAS-T12-EXP-OR-v1.0',
    },
    carnival_public_celebration: {
        indoor: 'STERAS-T13-CAR-IN-v1.0',
        outdoor_fixed_site: 'STERAS-T14-CAR-OF-v1.0',
        outdoor_route_based: 'STERAS-T15-CAR-OR-v1.0',
    },
};
function m1ScenarioTemplateIdFor(eventCategory, venueSetting) {
    return TEMPLATE_MATRIX[eventCategory][venueSetting];
}
function m1CategoryForEventType(eventType) {
    return EVENT_TYPE_CATEGORY[eventType];
}
function m1VenueSettingMatchesEnvironment(venueSetting, environment) {
    return venueSetting === 'indoor' ? environment === 'indoor' : environment !== 'indoor';
}
function isValidM1TemplateSelection(value) {
    if (!isRecord(value) || Object.keys(value).some((key) => !SELECTION_KEYS.has(key)))
        return false;
    if (!exports.M1_EVENT_CATEGORY_VALUES.includes(value.eventCategory)
        || !exports.M1_VENUE_SETTING_VALUES.includes(value.venueSetting)
        || value.coreTemplateId !== 'STERAS-CORE'
        || value.templateRegistryVersion !== types_1.M1_TEMPLATE_REGISTRY_VERSION
        || typeof value.selectedAt !== 'number'
        || !Number.isSafeInteger(value.selectedAt)
        || value.selectedAt <= 0
        || typeof value.scenarioTemplateId !== 'string')
        return false;
    return m1ScenarioTemplateIdFor(value.eventCategory, value.venueSetting) === value.scenarioTemplateId;
}
const SELECTION_KEYS = new Set([
    'eventCategory',
    'venueSetting',
    'coreTemplateId',
    'scenarioTemplateId',
    'templateRegistryVersion',
    'selectedAt',
]);
const EVENT_TYPE_CATEGORY = {
    concert: 'entertainment_performance',
    festival: 'cultural_heritage_festival',
    sports: 'sports_recreational',
    cultural: 'cultural_heritage_festival',
    religious: 'cultural_heritage_festival',
    exhibition: 'exhibition_convention_promotional',
    fair: 'carnival_public_celebration',
    conference: 'exhibition_convention_promotional',
    other: 'carnival_public_celebration',
};
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=m1TemplateContract.js.map