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
 *   - Otherwise: calls the existing `proposeEventControlList` Cloud
 *     Function (M3 stub for now; M2's real version when it lands),
 *     which returns the proposed `ProposedControlItem[]`. We return
 *     them to the admin as `items` with `cached: false`. The admin
 *     can then edit and commit via `editEventControlList`.
 *
 * The commit step is a separate call — `generate` only proposes.
 * Per the M3 owner decision (2026-08-18): the admin must explicitly
 * click "Generate" and "Commit". No auto-trigger.
 */
const firebase_admin_1 = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
const proposeEventControlList_1 = require("./proposeEventControlList");
exports.generateEventControlList = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
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
        // Convert the snapshot back to ProposedControlItem shape. We
        // intentionally lose the per-Stage-1-requirement detail (we
        // stored only the count). The admin can hit `force: true` to
        // re-fetch the full proposal from the AI.
        const items = event.controlListSnapshot.map((s) => ({
            controlName: s.controlName,
            authority: s.authority,
            stageRequirement: s.stageRequirement,
            stage1Requirements: Array.from({ length: s.stage1RequirementsCount }, () => ({
                docType: 'other',
                label: '(see event_controls doc)',
                required: true,
            })),
            stage2Requirement: s.stage2Label ? { kind: 'image', label: s.stage2Label } : null,
        }));
        return { items, cached: true, source: 'cache' };
    }
    // Cache miss: call the proposal helper directly. This is the M3
    // stub for now; when M2 ships `proposeEventControlList`, the
    // import above resolves to M2's real callable (and the call site
    // stays the same).
    const items = await (0, proposeEventControlList_1.proposeControlItemsForEvent)(eventId, versionId);
    if (!items.length) {
        throw new https_1.HttpsError('failed-precondition', 'The proposal function returned no items. Check the event has required authorities.');
    }
    return { items, cached: false, source: 'proposeEventControlList' };
});
//# sourceMappingURL=generateEventControlList.js.map