"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeRuleBased = computeRuleBased;
exports.fetchIncidentsForVenue = fetchIncidentsForVenue;
const firebase_admin_1 = require("firebase-admin");
const types_1 = require("../../../shared/types");
const WEIGHTS = {
    weather: 0.30,
    crowd: 0.25,
    venue: 0.20,
    history: 0.15,
    holiday: 0.10,
};
async function computeRuleBased(event, weather, isHoliday, isWeekend, incidents, now = Date.now(), sourceTimestamps = {}, historyMatched = true) {
    const subScores = {
        weather: scoreWeather(weather),
        crowd: scoreCrowd(event),
        venue: scoreVenue(event),
        history: scoreHistory(incidents),
        holiday: scoreHoliday(isHoliday, isWeekend),
    };
    const weightedContributions = {
        weather: roundContribution(subScores.weather * WEIGHTS.weather),
        crowd: roundContribution(subScores.crowd * WEIGHTS.crowd),
        venue: roundContribution(subScores.venue * WEIGHTS.venue),
        history: roundContribution(subScores.history * WEIGHTS.history),
        holiday: roundContribution(subScores.holiday * WEIGHTS.holiday),
    };
    const baselineScore = clamp(Math.round(Object.values(weightedContributions).reduce((sum, value) => sum + value, 0)), 0, 100);
    return {
        subScores,
        weightedContributions,
        baselineScore,
        baselineRiskLevel: (0, types_1.riskLevelFor)(baselineScore),
        evidence: [
            { key: 'weather', description: weather.forecast || 'Weather unavailable', sourceTimestamp: sourceTimestamps.weather ?? now },
            { key: 'crowd', description: `${event.eventDetails.expectedAttendance}/${event.eventDetails.venueCapacity} expected capacity`, sourceTimestamp: now },
            { key: 'venue', description: `${event.eventDetails.environment}, ${event.eventDetails.coverage}`, sourceTimestamp: now },
            { key: 'history', description: historyMatched ? `${incidents.length} matched historical incidents` : 'No stable venue match; history unavailable', sourceTimestamp: sourceTimestamps.history ?? now },
            { key: 'holiday', description: isHoliday ? 'On or adjacent to a public holiday' : isWeekend ? 'Weekend event' : 'Regular weekday', sourceTimestamp: sourceTimestamps.holiday ?? now },
        ],
        ruleVersion: types_1.RULE_VERSION,
        computedAt: now,
    };
}
function scoreWeather(weather) {
    let score = weather.severeAlert ? 50 : 0;
    const forecast = (weather.forecast ?? '').toLowerCase();
    if (forecast.includes('thunder'))
        score += 35;
    else if (forecast.includes('rain') || forecast.includes('shower'))
        score += 20;
    else if (forecast.includes('cloud') || forecast.includes('overcast'))
        score += 8;
    else
        score += 2;
    if (weather.precipitationProbability > 70)
        score += 15;
    if (weather.windSpeed > 10)
        score += 10;
    if (weather.temperature > 35 || weather.temperature < 18)
        score += 8;
    return clamp(Math.round(score), 0, 100);
}
function scoreCrowd(event) {
    const { venueCapacity, expectedAttendance } = event.eventDetails;
    if (venueCapacity <= 0)
        return 50;
    const utilization = expectedAttendance / venueCapacity;
    let score = utilization > 1 ? 50 : utilization > 0.9 ? 35 : utilization > 0.75 ? 20 : utilization > 0.5 ? 10 : 2;
    if (expectedAttendance > 10_000)
        score += 30;
    else if (expectedAttendance > 5_000)
        score += 20;
    else if (expectedAttendance > 1_000)
        score += 10;
    else if (expectedAttendance > 250)
        score += 4;
    return clamp(Math.round(score), 0, 100);
}
function scoreVenue(event) {
    const { venueCapacity, type, environment, coverage } = event.eventDetails;
    let score = 15;
    if (venueCapacity > 20_000)
        score += 25;
    else if (venueCapacity > 5_000)
        score += 15;
    else if (venueCapacity > 1_000)
        score += 8;
    if (type === 'concert' || type === 'religious')
        score += 15;
    if (environment !== 'indoor')
        score += 10;
    if (coverage === 'uncovered')
        score += 10;
    else if (coverage === 'partially_covered')
        score += 5;
    return clamp(Math.round(score), 0, 100);
}
function scoreHistory(incidents) {
    if (incidents.length === 0)
        return 5;
    return clamp(incidents.reduce((score, incident) => score + (incident.severity === 'high' ? 35 : incident.severity === 'medium' ? 18 : 6), 0), 0, 100);
}
function scoreHoliday(isHoliday, isWeekend) {
    return clamp((isHoliday ? 60 : 0) + (isWeekend ? 30 : 0), 0, 100);
}
function roundContribution(value) {
    return Math.round(value * 100) / 100;
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
async function fetchIncidentsForVenue(venueId, venueName, now = Date.now()) {
    const db = (0, firebase_admin_1.firestore)();
    let resolvedVenueId = venueId;
    if (!resolvedVenueId && venueName) {
        const venueSnapshot = await db.collection(types_1.COLLECTIONS.VENUES).where('name', '==', venueName.trim()).limit(1).get();
        resolvedVenueId = venueSnapshot.docs[0]?.id;
    }
    if (!resolvedVenueId)
        return { incidents: [], matched: false, fetchedAt: now };
    const snapshot = await db.collection(types_1.COLLECTIONS.INCIDENTS).where('venueId', '==', resolvedVenueId).get();
    return {
        incidents: snapshot.docs.map((document) => ({ incidentId: document.id, ...document.data() })),
        venueId: resolvedVenueId,
        matched: true,
        fetchedAt: now,
    };
}
//# sourceMappingURL=ruleBased.js.map