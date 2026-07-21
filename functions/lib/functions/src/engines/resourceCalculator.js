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
function computeResources(eventDetails, riskLevel) {
    const attendance = Number.isFinite(eventDetails.expectedAttendance)
        ? Math.max(0, Math.floor(eventDetails.expectedAttendance))
        : 0;
    const highRisk = riskLevel === 'High';
    return {
        police: Math.max(2, Math.ceil(attendance / 250)) + (highRisk ? 10 : 0),
        medicalTeams: Math.max(1, Math.ceil(attendance / 1_000)) + (highRisk ? 1 : 0),
        ambulances: Math.max(1, Math.ceil(attendance / 5_000)),
        toilets: Math.ceil(attendance / 50) + Math.ceil(attendance / 75),
        wasteBins: Math.ceil(attendance / 100),
        security: Math.ceil(Math.ceil(attendance / 100) * (SECURITY_MULTIPLIER[eventDetails.type] ?? 1)),
        fireOfficers: Math.max(1, Math.ceil(attendance / 500)) + (eventDetails.environment === 'indoor' ? 1 : 0),
    };
}
//# sourceMappingURL=resourceCalculator.js.map