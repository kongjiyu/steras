"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignAuthorityOfficers = void 0;
/**
 * assignAuthorityOfficers — admin-only callable (M3 Workstream 1).
 *
 * Generates the default-checked officer checklist for an event's
 * `requiredAuthorities`, accepts admin overrides, then writes
 * `events/{eventId}/assignments/{assignmentId}` sub-collection docs and
 * increments each picked officer's `workloadCount`.
 *
 * Two modes:
 *   - `dryRun: true` (default): returns the proposed checklist (default-checked
 *     by workload + state-scope matching) without writing anything. Used by
 *     the admin UI to show the checklist before commit.
 *   - `dryRun: false`: writes the assignments and increments workload.
 *
 * Per the locked assumption A4: default-check is workload-based (officer
 * with fewest pending reviews wins). State-scoped officers (scopeType='state')
 * must match `venue.state` to be eligible. Federal-scoped officers
 * (scopeType='federal') are always eligible.
 *
 * Per A2: each state has 2 officers per authorityType (primary + backup).
 * The default-check picks the lowest-workload one.
 */
const firebase_admin_1 = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
exports.assignAuthorityOfficers = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before assigning officers.');
    const eventId = (request.data?.eventId ?? '').trim();
    if (!eventId)
        throw new https_1.HttpsError('invalid-argument', 'eventId is required.');
    // Profile check: admin only.
    const db = (0, firebase_admin_1.firestore)();
    const userSnap = await db.collection(types_1.COLLECTIONS.USERS).doc(request.auth.uid).get();
    const profile = userSnap.data();
    if (!profile || profile.role !== 'admin') {
        throw new https_1.HttpsError('permission-denied', 'Only admins can assign officers.');
    }
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
        throw new https_1.HttpsError('not-found', `Event ${eventId} not found.`);
    }
    const event = eventSnap.data();
    const versionId = event.currentVersionId;
    if (!versionId) {
        throw new https_1.HttpsError('failed-precondition', 'The application has no submitted version.');
    }
    const required = event.requiredAuthorities ?? [];
    if (required.length === 0) {
        throw new https_1.HttpsError('failed-precondition', 'This event has no required authorities.');
    }
    // Resolve the venue state. If the venue has no `state`, fall back to
    // 'ALL' so federal officers can still match.
    let venueState = 'ALL';
    if (event.eventDetails?.venueId) {
        const venueSnap = await db.collection(types_1.COLLECTIONS.VENUES).doc(event.eventDetails.venueId).get();
        if (venueSnap.exists) {
            venueState = venueSnap.data().state ?? 'ALL';
        }
    }
    // Load all active officers grouped by authorityType. In a real
    // production system this would be indexed / sharded; for the
    // prototype the officer pool is small.
    const allOfficers = (await db.collection(types_1.COLLECTIONS.OFFICERS).where('active', '==', true).get())
        .docs.map((d) => d.data());
    // Filter by state scope (A4).
    const isEligible = (o) => {
        if (o.scopeType === 'federal')
            return true;
        return o.state === venueState;
    };
    const byAuthority = new Map();
    for (const auth of required) {
        byAuthority.set(auth, allOfficers.filter((o) => o.authorityType === auth && isEligible(o)));
    }
    // Default-check: lowest workloadCount, then earliest lastAssignedAt.
    const defaultPick = (candidates) => {
        if (candidates.length === 0)
            return undefined;
        return [...candidates].sort((a, b) => {
            if (a.workloadCount !== b.workloadCount)
                return a.workloadCount - b.workloadCount;
            const aTime = a.lastAssignedAt ?? 0;
            const bTime = b.lastAssignedAt ?? 0;
            return aTime - bTime;
        })[0];
    };
    const checklist = required.map((auth) => {
        const candidates = byAuthority.get(auth) ?? [];
        const sorted = [...candidates].sort((a, b) => {
            if (a.workloadCount !== b.workloadCount)
                return a.workloadCount - b.workloadCount;
            const aTime = a.lastAssignedAt ?? 0;
            const bTime = b.lastAssignedAt ?? 0;
            return aTime - bTime;
        });
        const def = defaultPick(candidates);
        return {
            authorityType: auth,
            defaultOfficerUid: def?.uid ?? '',
            candidates: sorted.map((o) => ({
                officerUid: o.uid,
                state: o.state,
                scopeType: o.scopeType,
                workloadCount: o.workloadCount,
                lastAssignedAt: o.lastAssignedAt,
            })),
        };
    });
    if (request.data?.dryRun !== false) {
        return { checklist, venueState };
    }
    // Commit mode: validate the admin's assignmentMap, write assignments,
    // bump workloadCounts, set event.reviewStage='authority'.
    const assignmentMap = request.data?.assignmentMap;
    if (!assignmentMap || typeof assignmentMap !== 'object') {
        throw new https_1.HttpsError('invalid-argument', 'assignmentMap is required when dryRun=false.');
    }
    for (const item of checklist) {
        if (!assignmentMap[item.authorityType]) {
            throw new https_1.HttpsError('invalid-argument', `assignmentMap is missing an entry for required authority ${item.authorityType}.`);
        }
    }
    const now = Date.now();
    return db.runTransaction(async (tx) => {
        // Re-read the event + ALL officers inside the transaction to avoid races.
        // Firestore requires all reads to complete before any writes.
        const evSnap = await tx.get(eventRef);
        const ev = evSnap.data();
        if (ev.initialReview?.decision !== 'Approved') {
            throw new https_1.HttpsError('failed-precondition', 'Complete and approve the admin initial review before assigning officers.');
        }
        if (ev.status !== 'UnderReview') {
            throw new https_1.HttpsError('failed-precondition', 'Only applications released for authority review can be assigned.');
        }
        if (ev.reviewStage === 'authority') {
            throw new https_1.HttpsError('failed-precondition', 'Officers are already assigned for this event version. Unassign first to re-assign.');
        }
        // Pre-fetch all officer refs in the read phase.
        const officerEntries = [];
        for (const [auth, officerUid] of Object.entries(assignmentMap)) {
            if (!officerUid) {
                throw new https_1.HttpsError('invalid-argument', `Empty officerUid for ${auth}.`);
            }
            const officerRef = db.collection(types_1.COLLECTIONS.OFFICERS).doc(officerUid);
            const officerSnap = await tx.get(officerRef);
            officerEntries.push([auth, officerUid, officerRef, officerSnap.exists ? officerSnap.data() : null]);
        }
        // Validate all entries (no writes yet).
        for (const [auth, officerUid, , officer] of officerEntries) {
            if (!officer) {
                throw new https_1.HttpsError('not-found', `Officer ${officerUid} not found.`);
            }
            if (officer.authorityType !== auth) {
                throw new https_1.HttpsError('invalid-argument', `Officer ${officerUid} is ${officer.authorityType}, not ${auth}.`);
            }
            if (!officer.active) {
                throw new https_1.HttpsError('failed-precondition', `Officer ${officerUid} is inactive.`);
            }
            if (officer.scopeType === 'state' && officer.state !== venueState) {
                throw new https_1.HttpsError('permission-denied', `Officer ${officerUid} is state-scoped to ${officer.state}, but the event is at ${venueState}.`);
            }
            if (officer.workloadCount >= officer.workloadLimit) {
                throw new https_1.HttpsError('failed-precondition', `Officer ${officerUid} is at workload limit (${officer.workloadLimit}). Swap to a backup.`);
            }
        }
        // Now writes — all reads are done.
        let officerWrites = 0;
        for (const [auth, officerUid, officerRef, officer] of officerEntries) {
            const assignmentId = `${versionId}_${auth}`;
            const assignmentRef = eventRef.collection(types_1.COLLECTIONS.ASSIGNMENTS).doc(assignmentId);
            const assignment = {
                assignmentId,
                eventId,
                versionId,
                authorityType: auth,
                officerUid,
                assignedBy: request.auth.uid,
                assignedAt: now,
                status: 'pending',
            };
            tx.set(assignmentRef, assignment);
            tx.update(officerRef, {
                workloadCount: firestore_1.FieldValue.increment(1),
                lastAssignedAt: now,
                updatedAt: now,
            });
            // Audit log (FR-M3-09..12). Written in the same transaction so
            // there's no consistency window — the assignment and its audit
            // trail are committed atomically.
            const auditId = `assignment_created_${versionId}_${auth}_${now}`;
            tx.create(eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(auditId), {
                id: auditId,
                eventId,
                versionId,
                action: 'assignment_created',
                actorId: request.auth.uid,
                actorRole: 'admin',
                timestamp: now,
                notes: `Assigned ${officerUid} as ${auth} officer`,
                metadata: {
                    authorityType: auth,
                    officerUid,
                    officerState: officer?.state ?? null,
                    officerScopeType: officer?.scopeType ?? null,
                    previousWorkloadCount: officer?.workloadCount ?? 0,
                    newWorkloadCount: (officer?.workloadCount ?? 0) + 1,
                    venueState,
                },
            });
            officerWrites++;
        }
        tx.update(eventRef, {
            reviewStage: 'authority',
            assignedOfficerUids: officerEntries.map(([, officerUid]) => officerUid),
            assignedOfficerByAuthority: Object.fromEntries(officerEntries.map(([auth, officerUid]) => [auth, officerUid])),
            updatedAt: now,
        });
        return { checklist, assigned: officerWrites };
    }).then((result) => {
        return { checklist: result.checklist, assigned: result.assigned, venueState };
    });
});
//# sourceMappingURL=assignAuthorityOfficers.js.map