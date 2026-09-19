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
const m3FixedWorkflowPreset_1 = require("../utils/m3FixedWorkflowPreset");
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
    if (event.status !== 'Approved') {
        throw new Error('The Admin second review must approve the current application before generating controls.');
    }
    if (!event.currentAssessmentId || !event.currentResourceId) {
        throw new Error('The current official assessment/resource pointers are missing.');
    }
    const required = event.requiredAuthorities ?? [];
    const [assessmentSnap, resourceSnap] = await Promise.all([
        event.currentAssessmentId
            ? (0, firebase_admin_1.firestore)().collection(types_1.COLLECTIONS.EVENTS).doc(eventId).collection(types_1.COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId).get()
            : Promise.resolve(null),
        event.currentResourceId
            ? (0, firebase_admin_1.firestore)().collection(types_1.COLLECTIONS.EVENTS).doc(eventId).collection(types_1.COLLECTIONS.RESOURCES).doc(event.currentResourceId).get()
            : Promise.resolve(null),
    ]);
    const assessment = assessmentSnap?.data();
    const resource = resourceSnap?.data();
    if (!assessmentSnap?.exists || assessment?.status !== 'official_ready'
        || assessment.eventId !== eventId || assessment.versionId !== versionId
        || !resourceSnap?.exists || resource?.stage !== 'official'
        || resource.eventId !== eventId || resource.versionId !== versionId
        || resource.assessmentId !== event.currentAssessmentId) {
        throw new Error('The control list requires a current official risk assessment and safety resource recommendation.');
    }
    // Production Module 3 uses a deterministic, fixture-derived contract. The
    // selected template is persisted by generateEventControlList on its first
    // write, so later calls cannot silently change requirements.
    const selected = (0, m3FixedWorkflowPreset_1.fixedPresetForEvent)(event, (0, m3FixedWorkflowPreset_1.riskLevelFromAssessment)(assessment));
    const controlsByAuthority = new Map(selected.preset.controls.map((item) => [item.authority, item]));
    const fixedItems = required.map((authority) => controlsByAuthority.get(authority) ?? ({
        controlName: CONTROL_NAMES[authority] ?? `${authority} compliance`,
        authority,
        stageRequirement: 'stage1_and_stage2',
        stage1Requirements: STAGE1_TEMPLATES[authority] ?? [],
        stage2Requirement: { kind: 'image', label: STAGE2_LABEL[authority] ?? `Photo of ${authority} at venue` },
    }));
    // The direct proposal callable is also a valid first operation. Persist the
    // selected template here (inside a version fence) so a later Generate or
    // Commit cannot rematch the event after a risk update.
    if (event.fixedWorkflowPreset?.version !== m3FixedWorkflowPreset_1.FIXED_WORKFLOW_PRESET_VERSION) {
        const eventRef = (0, firebase_admin_1.firestore)().collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
        await (0, firebase_admin_1.firestore)().runTransaction(async (tx) => {
            const currentSnap = await tx.get(eventRef);
            const current = currentSnap.data();
            if (!currentSnap.exists || current?.currentVersionId !== versionId || current.status !== 'Approved') {
                throw new Error('The application changed while the fixed workflow was being selected. Reload and try again.');
            }
            if (current.fixedWorkflowPreset?.version !== m3FixedWorkflowPreset_1.FIXED_WORKFLOW_PRESET_VERSION) {
                tx.update(eventRef, { fixedWorkflowPreset: selected.selection, updatedAt: Date.now() });
            }
        });
    }
    return {
        items: fixedItems,
        source: 'deterministic_fallback',
        model: 'fixed-presentation-template',
        promptVersion: m3FixedWorkflowPreset_1.FIXED_WORKFLOW_PRESET_VERSION,
        generatedAt: Date.now(),
        fallbackReason: `Selected fixed workflow preset ${selected.preset.id}.`,
    };
}
//# sourceMappingURL=proposeEventControlList.js.map