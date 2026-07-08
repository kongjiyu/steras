"use strict";
/**
 * Triggers: onEventCreated + onEventUpdated
 *
 * Module 2 (Smart Risk) + Module 3 (Resources) auto-run when an event is
 * created or updated by the organizer (still in Pending / AmendmentRequested).
 *
 * Uses firebase-functions v2 API (onDocumentCreated / onDocumentUpdated).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.onEventUpdated = exports.onEventCreated = void 0;
exports.runRiskAndResourcePipeline = runRiskAndResourcePipeline;
const firestore_1 = require("firebase-functions/v2/firestore");
const firebase_admin_1 = require("firebase-admin");
const firebase_functions_1 = require("firebase-functions");
const types_1 = require("@shared/types");
const ruleBased_1 = require("../engines/ruleBased");
const aiPredictor_1 = require("../engines/aiPredictor");
const resourceCalculator_1 = require("../engines/resourceCalculator");
const weather_1 = require("../utils/weather");
const holidays_1 = require("../utils/holidays");
const audit_1 = require("../utils/audit");
async function runRiskAndResourcePipeline(eventId) {
    const db = (0, firebase_admin_1.firestore)();
    const eventSnap = await db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId).get();
    if (!eventSnap.exists)
        return;
    const event = { eventId, ...eventSnap.data() };
    // Only run for events that are pending or amendment-requested.
    if (!['Pending', 'AmendmentRequested', 'UnderReview'].includes(event.status)) {
        firebase_functions_1.logger.info(`[onEvent] Skipping ${eventId} (status=${event.status})`);
        return;
    }
    firebase_functions_1.logger.info(`[onEvent] Running pipeline for ${eventId}`);
    // 1. Fetch context in parallel.
    const [weather, incidents] = await Promise.all([
        (0, weather_1.fetchWeather)(event.eventDetails.venueLocation, event.eventDetails.venueName).catch((e) => {
            firebase_functions_1.logger.warn(`[onEvent] Weather fetch failed: ${e}`);
            return defaultWeather();
        }),
        (0, ruleBased_1.fetchIncidentsForVenue)(event.eventDetails.venueName).catch((e) => {
            firebase_functions_1.logger.warn(`[onEvent] Incidents fetch failed: ${e}`);
            return [];
        }),
    ]);
    const isHoliday = (0, holidays_1.isMalaysianPublicHoliday)(event.eventDetails.startDatetime);
    const isWeekend = (0, holidays_1.isWeekendDate)(event.eventDetails.startDatetime);
    // 2. Run rule-based + AI in parallel.
    const apiKey = process.env.MINIMAX_API_KEY;
    const [ruleScore, aiScore] = await Promise.all([
        (0, ruleBased_1.computeRuleBased)(event, weather, isHoliday, isWeekend, incidents),
        apiKey
            ? (0, aiPredictor_1.predictWithAI)(apiKey, event, weather, isHoliday, isWeekend).catch((e) => {
                firebase_functions_1.logger.error(`[onEvent] AI prediction failed: ${e}`);
                return null;
            })
            : Promise.resolve(null),
    ]);
    if (!aiScore) {
        firebase_functions_1.logger.warn(`[onEvent] AI score unavailable; rule-based only for ${eventId}`);
    }
    // 3. Persist risk score (sub-collection).
    const delta = aiScore ? Math.abs(aiScore.riskScore - ruleScore.total) : 0;
    const riskRecord = {
        id: `${Date.now()}`,
        eventId,
        ai: aiScore ?? {
            riskLevel: ruleScore.riskLevel,
            riskScore: ruleScore.total,
            reasoning: '[AI unavailable] Rule-based score only.',
            keyConcerns: [],
            recommendedResources: {},
            model: 'unavailable',
            promptVersion: 'n/a',
            generatedAt: Date.now(),
        },
        rule: ruleScore,
        disagreementFlag: aiScore ? delta >= types_1.DISAGREEMENT_THRESHOLD : false,
        disagreementDelta: aiScore ? delta : undefined,
        createdAt: Date.now(),
    };
    await db
        .collection(types_1.COLLECTIONS.EVENTS)
        .doc(eventId)
        .collection(types_1.COLLECTIONS.RISK_SCORES)
        .doc(riskRecord.id)
        .set(riskRecord);
    const resources = (0, resourceCalculator_1.computeResources)(event.eventDetails, ruleScore.riskLevel);
    await db
        .collection(types_1.COLLECTIONS.EVENTS)
        .doc(eventId)
        .collection(types_1.COLLECTIONS.RESOURCES)
        .doc(`${Date.now()}`)
        .set(resources);
    // 5. Audit log.
    await (0, audit_1.writeAuditLog)(eventId, 'risk_score_computed', 'system', {
        metadata: {
            ruleScore: ruleScore.total,
            aiScore: aiScore?.riskScore ?? null,
            delta,
            disagreement: riskRecord.disagreementFlag,
        },
    });
    firebase_functions_1.logger.info(`[onEvent] Done ${eventId}: rule=${ruleScore.total}, ai=${aiScore?.riskScore ?? 'n/a'}, ` +
        `disagreement=${riskRecord.disagreementFlag}`);
}
function defaultWeather() {
    return {
        forecast: 'Unknown',
        temperature: 28,
        humidity: 70,
        windSpeed: 2,
        precipitationProbability: 20,
        severeAlert: false,
    };
}
exports.onEventCreated = (0, firestore_1.onDocumentCreated)(`${types_1.COLLECTIONS.EVENTS}/{eventId}`, async (event) => {
    const eventId = event.params.eventId;
    try {
        await runRiskAndResourcePipeline(eventId);
    }
    catch (err) {
        firebase_functions_1.logger.error('[onEventCreated] failed:', err);
    }
});
exports.onEventUpdated = (0, firestore_1.onDocumentUpdated)(`${types_1.COLLECTIONS.EVENTS}/{eventId}`, async (event) => {
    const eventId = event.params.eventId;
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after)
        return;
    // Only re-run if eventDetails changed AND status is still pending-like.
    if (JSON.stringify(before.eventDetails) === JSON.stringify(after.eventDetails) ||
        !['Pending', 'AmendmentRequested', 'UnderReview'].includes(after.status)) {
        return;
    }
    try {
        await runRiskAndResourcePipeline(eventId);
    }
    catch (err) {
        firebase_functions_1.logger.error('[onEventUpdated] failed:', err);
    }
});
//# sourceMappingURL=onEventCreated.js.map