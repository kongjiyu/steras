"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeResources = computeResources;
const SECURITY_MULTIPLIER = {
    concert: 2,
    festival: 1.5,
    sports: 1.5,
    cultural: 1,
    religious: 1.5,
    exhibition: 1,
    fair: 1,
    conference: 1,
    other: 1,
};
/**
 * Prototype-only deterministic resource mapping.
 *
 * Ratios and modifiers remain deliberately versioned as unverified prototype
 * values until the team supplies the exact WHO/PDRM/Bomba source passages and
 * an authority reviewer approves their interpretation.
 */
function computeResources(eventDetails, officialResult) {
    const attendance = Number.isFinite(eventDetails.expectedAttendance)
        ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(eventDetails.expectedAttendance)))
        : 0;
    const highOfficialRisk = officialResult.officialRiskLevel === 'High';
    const categoryRisk = new Map(officialResult.categoryAssignments.map((category) => [category.categoryId, category.riskLevel]));
    const highCrowdRisk = categoryRisk.get('crowd') === 'High';
    const highWeatherRisk = categoryRisk.get('weather_environment') === 'High';
    const highVenueRisk = categoryRisk.get('venue_fire') === 'High';
    const quantities = {
        police: Math.max(2, Math.ceil(attendance / 250)) + (highOfficialRisk ? 10 : 0) + (highCrowdRisk ? 5 : 0),
        medicalTeams: Math.max(1, Math.ceil(attendance / 1_000)) + (highOfficialRisk ? 1 : 0) + (highWeatherRisk ? 1 : 0),
        ambulances: Math.max(1, Math.ceil(attendance / 5_000)) + (highOfficialRisk ? 1 : 0),
        toilets: Math.ceil(attendance / 50) + Math.ceil(attendance / 75),
        wasteBins: Math.ceil(attendance / 100),
        security: Math.ceil(Math.ceil(attendance / 100) * (SECURITY_MULTIPLIER[eventDetails.type] ?? 1)) + (highCrowdRisk ? 5 : 0),
        fireOfficers: Math.max(1, Math.ceil(attendance / 500)) + (eventDetails.environment === 'indoor' ? 1 : 0) + (highVenueRisk ? 2 : 0),
    };
    const rationales = {
        police: rationale('police', quantities.police, [
            `Prototype attendance ratio: 1 officer per 250 attendees, minimum 2.`,
            ...(highOfficialRisk ? ['High official risk modifier: +10 officers.'] : []),
            ...(highCrowdRisk ? ['High crowd-category modifier: +5 officers.'] : []),
        ], ['internal.resource-baseline.v3', 'who.mass-gathering.all-hazards.2023']),
        medicalTeams: rationale('medicalTeams', quantities.medicalTeams, [
            `Prototype attendance ratio: 1 medical team per 1,000 attendees, minimum 1.`,
            ...(highOfficialRisk ? ['High official risk modifier: +1 team.'] : []),
            ...(highWeatherRisk ? ['High weather-category modifier: +1 team.'] : []),
        ], ['internal.resource-baseline.v3', 'who.mass-gathering.all-hazards.2023']),
        ambulances: rationale('ambulances', quantities.ambulances, [
            `Prototype attendance ratio: 1 ambulance per 5,000 attendees, minimum 1.`,
            ...(highOfficialRisk ? ['High official risk modifier: +1 ambulance.'] : []),
        ], ['internal.resource-baseline.v3']),
        toilets: rationale('toilets', quantities.toilets, [
            'Prototype sanitation ratio combines 1 unit per 50 and 1 unit per 75 attendees.',
        ], ['internal.resource-baseline.v3']),
        wasteBins: rationale('wasteBins', quantities.wasteBins, [
            'Prototype waste ratio: 1 bin per 100 attendees.',
        ], ['internal.resource-baseline.v3']),
        security: rationale('security', quantities.security, [
            `Prototype base ratio: 1 guard per 100 attendees with ${SECURITY_MULTIPLIER[eventDetails.type] ?? 1}x ${eventDetails.type} multiplier.`,
            ...(highCrowdRisk ? ['High crowd-category modifier: +5 personnel.'] : []),
        ], ['internal.resource-baseline.v3', 'who.mass-gathering.all-hazards.2023']),
        fireOfficers: rationale('fireOfficers', quantities.fireOfficers, [
            'Prototype attendance ratio: 1 fire-safety officer per 500 attendees, minimum 1.',
            ...(eventDetails.environment === 'indoor' ? ['Indoor-event modifier: +1 officer.'] : []),
            ...(highVenueRisk ? ['High venue-category modifier: +2 officers.'] : []),
        ], ['internal.resource-baseline.v3', 'my.fire-services-act.1988']),
    };
    return {
        quantities,
        rationales,
        items: Object.keys(quantities).map((resource) => resourceItem(resource, quantities[resource], rationales[resource])),
    };
}
function resourceItem(resource, baseline, rationaleValue) {
    const authority = resource === 'medicalTeams' || resource === 'ambulances' || resource === 'toilets'
        ? 'KKM'
        : resource === 'fireOfficers'
            ? 'BOMBA'
            : 'PDRM';
    return {
        resource,
        baseline,
        planningRange: { min: baseline, max: Math.ceil(baseline * 1.25) },
        assumptions: rationaleValue.factors,
        riskModifiers: rationaleValue.factors.filter((factor) => /modifier/i.test(factor)),
        confidence: 'prototype',
        guidelineReferences: rationaleValue.guidelineReferences,
        reviewingAuthority: authority,
        authorityReviewRequired: true,
    };
}
function rationale(resource, baselineQuantity, factors, guidelineReferences) {
    return { resource, baselineQuantity, factors, guidelineReferences };
}
//# sourceMappingURL=resourceCalculator.js.map