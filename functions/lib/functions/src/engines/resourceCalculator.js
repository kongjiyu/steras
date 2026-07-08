"use strict";
/**
 * Module 3 — Safety Resource Recommendation (PRD §4)
 *
 * Pure-function calculator. No external calls. Takes event details + risk
 * score, returns recommended resource quantities.
 *
 * Standards cited (per PRD table):
 *   - Police:        max(2, attendance÷250) + (10 if risk=High)
 *   - Medical teams: max(1, attendance÷1000) + (1 if risk=High)
 *   - Ambulances:    max(1, attendance÷5000)
 *   - Toilets:       attendance÷50 (women) + attendance÷75 (men)
 *   - Waste bins:    attendance÷100
 *   - Security:      attendance÷100 (× event-type multiplier)
 *   - Fire officers: max(1, attendance÷500) + (1 if indoor)
 */
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
const INDOOR_TYPES = new Set(['exhibition', 'conference']);
function computeResources(eventDetails, riskLevel) {
    const att = eventDetails.expectedAttendance;
    const isHigh = riskLevel === 'High';
    const isIndoor = INDOOR_TYPES.has(eventDetails.type);
    return {
        police: Math.max(2, Math.floor(att / 250)) + (isHigh ? 10 : 0),
        medicalTeams: Math.max(1, Math.floor(att / 1000)) + (isHigh ? 1 : 0),
        ambulances: Math.max(1, Math.floor(att / 5000)),
        toilets: Math.floor(att / 50) + Math.floor(att / 75),
        wasteBins: Math.floor(att / 100),
        security: Math.floor(att / 100) * (SECURITY_MULTIPLIER[eventDetails.type] ?? 1),
        fireOfficers: Math.max(1, Math.floor(att / 500)) + (isIndoor ? 1 : 0),
        confidenceLevel: 'estimate', // prototype formula; flag for authority validation
        source: 'rule-based',
        notes: 'Prototype formula adapted from WHO Mass Gathering Guidelines + PDRM + Bomba benchmarks. Final values require authority validation.',
        computedAt: Date.now(),
    };
}
//# sourceMappingURL=resourceCalculator.js.map