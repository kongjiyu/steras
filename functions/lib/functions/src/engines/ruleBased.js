"use strict";
/**
 * Module 2 — Rule-Based Risk Engine (PRD §4)
 *
 * Deterministic scoring per WHO Mass Gathering / PDRM / Bomba standards.
 * Always runs — provides ground truth, even if AI fails.
 *
 * Formula:
 *   risk_score = 0.30 * weather_score
 *             + 0.25 * crowd_score
 *             + 0.20 * venue_score
 *             + 0.15 * history_score
 *             + 0.10 * holiday_score
 *
 * Each sub-score: 0-100 (higher = riskier).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeRuleBased = computeRuleBased;
exports.toRiskLevel = toRiskLevel;
exports.fetchIncidentsForVenue = fetchIncidentsForVenue;
const types_1 = require("@shared/types");
const firebase_admin_1 = require("firebase-admin");
const W = { weather: 0.30, crowd: 0.25, venue: 0.20, history: 0.15, holiday: 0.10 };
/**
 * @param event       the event record (uses eventDetails)
 * @param weather     weather context (from OpenWeather API)
 * @param isHoliday   true if event date is within 1 day of a Malaysian public holiday
 * @param isWeekend   true if event starts on Sat/Sun
 * @param incidents   past incidents at this venue (synthetic dataset)
 */
async function computeRuleBased(event, weather, isHoliday, isWeekend, incidents) {
    const weatherScore = scoreWeather(weather);
    const crowdScore = scoreCrowd(event);
    const venueScore = scoreVenue(event);
    const historyScore = scoreHistory(incidents);
    const holidayScore = scoreHoliday(isHoliday, isWeekend);
    const total = Math.round(W.weather * weatherScore +
        W.crowd * crowdScore +
        W.venue * venueScore +
        W.history * historyScore +
        W.holiday * holidayScore);
    return {
        weatherScore,
        crowdScore,
        venueScore,
        historyScore,
        holidayScore,
        total: clamp(total, 0, 100),
        riskLevel: toRiskLevel(total),
        computedAt: Date.now(),
    };
}
// =====================================================================
// Sub-scorers
// =====================================================================
/** Weather: severe weather pushes score up. */
function scoreWeather(w) {
    let s = 0;
    const text = (w.forecast ?? '').toLowerCase();
    if (w.severeAlert)
        s += 50;
    if (text.includes('thunder'))
        s += 35;
    else if (text.includes('rain') || text.includes('shower'))
        s += 20;
    else if (text.includes('cloud') || text.includes('overcast'))
        s += 8;
    else
        s += 2; // clear
    if (w.precipitationProbability > 70)
        s += 15;
    if (w.windSpeed > 10)
        s += 10;
    if (w.temperature > 35 || w.temperature < 18)
        s += 8;
    return clamp(Math.round(s), 0, 100);
}
/** Crowd: utilization + absolute size. */
function scoreCrowd(event) {
    const { venueCapacity, expectedAttendance } = event.eventDetails;
    if (venueCapacity <= 0)
        return 50; // unknown
    const utilization = expectedAttendance / venueCapacity; // 0..n
    let s = 0;
    if (utilization > 1.0)
        s += 50; // over-capacity
    else if (utilization > 0.9)
        s += 35;
    else if (utilization > 0.75)
        s += 20;
    else if (utilization > 0.5)
        s += 10;
    else
        s += 2;
    // Absolute size effect (larger = harder to manage)
    if (expectedAttendance > 10000)
        s += 30;
    else if (expectedAttendance > 5000)
        s += 20;
    else if (expectedAttendance > 1000)
        s += 10;
    else if (expectedAttendance > 250)
        s += 4;
    return clamp(Math.round(s), 0, 100);
}
/** Venue: capacity / location type. (Heuristic — replace with venue data lookup.) */
function scoreVenue(event) {
    const { venueCapacity, type } = event.eventDetails;
    let s = 20; // base
    if (venueCapacity > 20000)
        s += 25;
    else if (venueCapacity > 5000)
        s += 15;
    else if (venueCapacity > 1000)
        s += 8;
    // High-risk event types
    if (type === 'concert' || type === 'religious')
        s += 15;
    return clamp(Math.round(s), 0, 100);
}
/** History: past incidents at this venue. */
function scoreHistory(incidents) {
    if (incidents.length === 0)
        return 5;
    let s = 0;
    for (const i of incidents) {
        if (i.severity === 'high')
            s += 35;
        else if (i.severity === 'medium')
            s += 18;
        else
            s += 6;
    }
    return clamp(Math.round(s), 0, 100);
}
/** Holiday: weekend + proximity to public holiday. */
function scoreHoliday(isHoliday, isWeekend) {
    let s = 0;
    if (isHoliday)
        s += 60;
    if (isWeekend)
        s += 30;
    return clamp(s, 0, 100);
}
// =====================================================================
// Helpers
// =====================================================================
function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}
function toRiskLevel(score) {
    if (score >= 60)
        return 'High';
    if (score >= 30)
        return 'Medium';
    return 'Low';
}
/** Fetch past incidents for a venue. */
async function fetchIncidentsForVenue(venueName) {
    // Simple heuristic: lookup by venue name match. Replace with proper venueId join.
    const snap = await (0, firebase_admin_1.firestore)()
        .collection(types_1.COLLECTIONS.INCIDENTS)
        .where('venueId', '==', venueName) // synthetic — production uses venueId
        .get();
    return snap.docs.map((d) => d.data());
}
//# sourceMappingURL=ruleBased.js.map