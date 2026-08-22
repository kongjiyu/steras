"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.proposeEventControlList = void 0;
exports.proposeControlItemsForEvent = proposeControlItemsForEvent;
exports.proposeControlItemsForEventWithMetadata = proposeControlItemsForEventWithMetadata;
/**
 * proposeEventControlList — admin-only control-list proposal callable.
 *
 * M3 uses the shared MiniMax advisory client and keeps deterministic
 * per-authority templates as an explicit fallback for unavailable or invalid
 * provider responses. The generate flow calls the shared helper directly so
 * it does not make a callable-to-callable network hop.
 */
const firebase_admin_1 = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
const secrets_1 = require("../config/secrets");
const controlListProposer_1 = require("../engines/controlListProposer");
/** Deterministic per-authority Stage 1 requirements used only as the
 * explicitly labelled fallback when the advisory provider is unavailable. */
const STAGE1_TEMPLATES = {
    PDRM: [
        { docType: 'application', label: 'PDRM event notification acknowledgement', required: true },
        { docType: 'insurance', label: 'Public liability insurance', required: true },
        { docType: 'license', label: 'Crowd management plan acknowledgement', required: false },
    ],
    BOMBA: [
        { docType: 'application', label: 'BOMBA event notification acknowledgement', required: true },
        { docType: 'license', label: 'Fire safety officer posting licence', required: true },
        { docType: 'floor_plan', label: 'Egress floor plan', required: true },
        { docType: 'insurance', label: 'Public liability insurance', required: true },
    ],
    KKM: [
        { docType: 'application', label: 'KKM medical plan acknowledgement', required: true },
        { docType: 'license', label: 'On-site medical team licence', required: true },
        { docType: 'insurance', label: 'Public liability insurance', required: true },
    ],
    DBKL: [
        { docType: 'application', label: 'DBKL venue permit acknowledgement', required: true },
        { docType: 'license', label: 'Venue operating licence', required: true },
        { docType: 'insurance', label: 'Public liability insurance', required: true },
    ],
    MOTAC: [
        { docType: 'application', label: 'MOTAC tourism permit acknowledgement', required: true },
        { docType: 'license', label: 'Tourism operator licence', required: true },
    ],
};
/** Human-readable control names per authority. */
const CONTROL_NAMES = {
    PDRM: 'PDRM presence + traffic management',
    BOMBA: 'Bomba fire safety + egress verification',
    KKM: 'KKM medical + sanitation verification',
    DBKL: 'DBKL venue + emergency access verification',
    MOTAC: 'MOTAC tourism operator compliance',
};
const STAGE2_LABEL = {
    PDRM: 'Photo of PDRM officers on-site at venue',
    BOMBA: 'Photo of BOMBA officers and fire extinguishers at venue',
    KKM: 'Photo of KKM medical team + ambulance at venue',
    DBKL: 'Photo of DBKL-approved venue setup',
    MOTAC: 'Photo of MOTAC permit displayed at venue',
};
exports.proposeEventControlList = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION, secrets: [secrets_1.MINIMAX_API_KEY] }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before requesting a control-list proposal.');
    const profileSnap = await (0, firebase_admin_1.firestore)().collection(types_1.COLLECTIONS.USERS).doc(request.auth.uid).get();
    const profile = profileSnap.data();
    if (!profile || profile.role !== 'admin')
        throw new https_1.HttpsError('permission-denied', 'Only admins can request a control-list proposal.');
    const eventId = (request.data?.eventId ?? '').trim();
    const versionId = (request.data?.versionId ?? '').trim();
    if (!eventId)
        throw new https_1.HttpsError('invalid-argument', 'eventId is required.');
    if (!versionId)
        throw new https_1.HttpsError('invalid-argument', 'versionId is required.');
    const proposal = await proposeControlItemsForEventWithMetadata(eventId, versionId);
    console.log(`[proposeEventControlList] eventId=${eventId} versionId=${versionId} source=${proposal.source} items=${proposal.items.length}`);
    return proposal;
});
/**
 * Reusable core: look up the event and return the proposed control
 * items. Exported so other Cloud Functions (e.g. `generateEventControlList`)
 * can call this without going through the onCall surface (which would
 * require a deployed URL and auth context).
 */
async function proposeControlItemsForEvent(eventId, versionId) {
    const proposal = await proposeControlItemsForEventWithMetadata(eventId, versionId);
    return proposal.items;
}
async function proposeControlItemsForEventWithMetadata(eventId, versionId) {
    const eventSnap = await (0, firebase_admin_1.firestore)().collection(types_1.COLLECTIONS.EVENTS).doc(eventId).get();
    if (!eventSnap.exists) {
        throw new Error(`Event ${eventId} not found.`);
    }
    const event = eventSnap.data();
    if (event.currentVersionId && event.currentVersionId !== versionId) {
        throw new Error(`Version ${versionId} is not the current version for event ${eventId}.`);
    }
    const required = event.requiredAuthorities ?? [];
    const fallbackItems = required.map((authority) => ({
        controlName: CONTROL_NAMES[authority] ?? `${authority} compliance`,
        authority,
        stageRequirement: 'stage1_and_stage2',
        stage1Requirements: STAGE1_TEMPLATES[authority] ?? [],
        stage2Requirement: { kind: 'image', label: STAGE2_LABEL[authority] ?? `Photo of ${authority} at venue` },
    }));
    const [assessmentSnap, resourceSnap] = await Promise.all([
        event.currentAssessmentId
            ? (0, firebase_admin_1.firestore)().collection(types_1.COLLECTIONS.EVENTS).doc(eventId).collection(types_1.COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId).get()
            : Promise.resolve(null),
        event.currentResourceId
            ? (0, firebase_admin_1.firestore)().collection(types_1.COLLECTIONS.EVENTS).doc(eventId).collection(types_1.COLLECTIONS.RESOURCES).doc(event.currentResourceId).get()
            : Promise.resolve(null),
    ]);
    let apiKey = '';
    try {
        apiKey = secrets_1.MINIMAX_API_KEY.value();
    }
    catch {
        // Secret values are unavailable in local/unit environments; the
        // deterministic fallback remains the safe result in that case.
    }
    return (0, controlListProposer_1.proposeControlListWithMiniMax)(apiKey, {
        event,
        requiredAuthorities: required,
        assessment: assessmentSnap?.exists ? assessmentSnap.data() : undefined,
        resource: resourceSnap?.exists ? resourceSnap.data() : undefined,
    }, fallbackItems);
}
//# sourceMappingURL=proposeEventControlList.js.map