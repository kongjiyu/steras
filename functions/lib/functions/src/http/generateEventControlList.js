"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateEventControlList = void 0;
/**
 * generateEventControlList — admin-only callable (M3 Workstream 2).
 *
 * The proposal entry point for the per-authority event control list.
 * Admin opens `AdminControlListEditor`, clicks "Generate proposal", and
 * this function:
 *   - If the event already has a published list (`controlListGenerated
 *     === true`): returns the cached snapshot from the event doc,
 *     marked `cached: true`. Does NOT call MiniMax again (A23: don't
 *     regenerate without explicit reason).
 *   - Otherwise: calls M3's shared MiniMax-backed, schema-validated
 *     proposal engine with an explicit deterministic fallback, and
 *     returns the provenance metadata alongside the proposed items.
 *
 * The commit step is a separate call — `generate` only proposes.
 * Per the M3 owner decision (2026-08-18): the admin must explicitly
 * click "Generate" and "Commit". No auto-trigger.
 */
const firebase_admin_1 = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
const secrets_1 = require("../config/secrets");
const proposeEventControlList_1 = require("./proposeEventControlList");
exports.generateEventControlList = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION, secrets: [secrets_1.MINIMAX_API_KEY] }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before generating the control list.');
    const eventId = (request.data?.eventId ?? '').trim();
    if (!eventId)
        throw new https_1.HttpsError('invalid-argument', 'eventId is required.');
    // Profile check: admin only.
    const db = (0, firebase_admin_1.firestore)();
    const userSnap = await db.collection(types_1.COLLECTIONS.USERS).doc(request.auth.uid).get();
    const profile = userSnap.data();
    if (!profile || profile.role !== 'admin') {
        throw new https_1.HttpsError('permission-denied', 'Only admins can generate the control list.');
    }
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
        throw new https_1.HttpsError('not-found', `Event ${eventId} not found.`);
    }
    const event = eventSnap.data();
    const versionId = (request.data?.versionId ?? event.currentVersionId ?? '').trim();
    if (!versionId) {
        throw new https_1.HttpsError('failed-precondition', 'The event has no submitted version.');
    }
    if (!['UnderReview', 'Approved'].includes(event.status)) {
        throw new https_1.HttpsError('failed-precondition', `Control list can only be generated for events in UnderReview or Approved status (current: ${event.status}).`);
    }
    const force = request.data?.force === true;
    // Cache hit: controlListGenerated is true AND the snapshot is for the
    // current version. The snapshot was written by editEventControlList.
    if (!force && event.controlListGenerated && event.controlListSnapshot && event.controlListSnapshot.length > 0) {
        // Rehydrate from the committed controls so cached proposals preserve the
        // exact Stage 1 document types/labels and Stage 2 requirement. Legacy
        // snapshots only stored a count, so retain a bounded placeholder fallback
        // for records whose control subcollection is unavailable.
        const controlsSnap = await eventRef.collection(types_1.COLLECTIONS.EVENT_CONTROLS).get();
        const currentControls = controlsSnap.docs
            .map((doc) => doc.data())
            .filter((control) => control.versionId === versionId);
        if (currentControls.length > 0) {
            const items = currentControls.map((control) => ({
                controlName: control.controlName,
                authority: control.authority,
                stageRequirement: control.stageRequirement,
                stage1Requirements: control.stage1Requirements,
                stage2Requirement: control.stage2Requirement,
            }));
            return { items, cached: true, source: 'cache' };
        }
        const items = event.controlListSnapshot.map((s) => ({
            controlName: s.controlName,
            authority: s.authority,
            stageRequirement: s.stageRequirement,
            stage1Requirements: Array.from({ length: s.stage1RequirementsCount }, () => ({
                docType: 'other',
                label: '(legacy control requirement)',
                required: true,
            })),
            stage2Requirement: s.stage2Label ? { kind: 'image', label: s.stage2Label } : null,
        }));
        return { items, cached: true, source: 'cache' };
    }
    // Cache miss: call the shared proposal helper directly. This avoids a
    // callable-to-callable network hop while preserving the same contract as
    // the admin-facing `proposeEventControlList` endpoint.
    const proposal = await (0, proposeEventControlList_1.proposeControlItemsForEventWithMetadata)(eventId, versionId);
    if (!proposal.items.length) {
        throw new https_1.HttpsError('failed-precondition', 'The proposal function returned no items. Check the event has required authorities.');
    }
    return { ...proposal, cached: false };
});
//# sourceMappingURL=generateEventControlList.js.map