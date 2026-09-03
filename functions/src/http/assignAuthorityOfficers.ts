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
import { firestore } from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  Assignment,
  AuthorityType,
  COLLECTIONS,
  EventRecord,
  EventVersion,
  OfficerProfile,
  UserProfile,
  Venue,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';

interface AssignAuthorityOfficersRequest {
  eventId?: string;
  /** Map of authorityType -> officerUid. Required when `dryRun: false`.
   *  Ignored when `dryRun: true`. */
  assignmentMap?: Partial<Record<AuthorityType, string>>;
  /** Default false. When true, just return the proposed checklist. */
  dryRun?: boolean;
}

interface ProposedChecklistItem {
  authorityType: AuthorityType;
  defaultOfficerUid: string;
  candidates: Array<{ officerUid: string; state: string; scopeType: 'state' | 'federal'; workloadCount: number; lastAssignedAt?: number }>;
}

export const assignAuthorityOfficers = onCall<AssignAuthorityOfficersRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before assigning officers.');
  const eventId = (request.data?.eventId ?? '').trim();
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');

  // Profile check: admin only.
  const db = firestore();
  const userSnap = await db.collection(COLLECTIONS.USERS).doc(request.auth.uid).get();
  const profile = userSnap.data() as UserProfile | undefined;
  if (!profile || profile.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can assign officers.');
  }

  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) {
    throw new HttpsError('not-found', `Event ${eventId} not found.`);
  }
  const event = eventSnap.data() as EventRecord;
  const versionId = event.currentVersionId;
  if (!versionId) {
    throw new HttpsError('failed-precondition', 'The application has no submitted version.');
  }
  const required = event.requiredAuthorities ?? [];
  if (required.length === 0) {
    throw new HttpsError('failed-precondition', 'This event has no required authorities.');
  }

  const versionRef = eventRef.collection(COLLECTIONS.VERSIONS).doc(versionId);
  const versionSnap = await versionRef.get();
  const version = versionSnap.data() as EventVersion | undefined;
  if (!versionSnap.exists || version?.eventId !== eventId || version.versionId !== versionId) {
    throw new HttpsError('failed-precondition', 'The immutable current application version is missing.');
  }
  // Custom venues use the state stored on the immutable submitted version.
  // Registry venues additionally fence that value against the active registry.
  let registryVenue: Venue | undefined;
  if (version.eventDetails.venueId) {
    const venueSnap = await db.collection(COLLECTIONS.VENUES).doc(version.eventDetails.venueId).get();
    registryVenue = venueSnap.data() as Venue | undefined;
  }
  const venueState = resolveSubmittedVenueState(version, registryVenue);

  // Load all active officers grouped by authorityType. In a real
  // production system this would be indexed / sharded; for the
  // prototype the officer pool is small.
  const officerDocs = (await db.collection(COLLECTIONS.OFFICERS).where('active', '==', true).get()).docs;
  const officerUsers = officerDocs.length > 0
    ? await db.getAll(...officerDocs.map((document) => db.collection(COLLECTIONS.USERS).doc(document.id)))
    : [];
  const allOfficers = officerDocs
    .map((document, index) => ({ officer: document.data() as OfficerProfile, user: officerUsers[index]?.data() as UserProfile | undefined }))
    .filter(({ officer, user }, index) => officer.uid === officerDocs[index].id
      && user?.uid === officer.uid && user.role === 'authority' && user.authorityType === officer.authorityType)
    .map(({ officer }) => officer);

  // Filter by state scope (A4).
  const isEligible = (o: OfficerProfile) => {
    if (o.scopeType === 'federal') return true;
    return o.state === venueState;
  };
  const byAuthority = new Map<AuthorityType, OfficerProfile[]>();
  for (const auth of required) {
    byAuthority.set(
      auth,
      allOfficers.filter((o) => o.authorityType === auth && isEligible(o)),
    );
  }

  // Default-check: lowest workloadCount, then earliest lastAssignedAt.
  const defaultPick = (candidates: OfficerProfile[]): OfficerProfile | undefined => {
    if (candidates.length === 0) return undefined;
    return [...candidates].sort((a, b) => {
      if (a.workloadCount !== b.workloadCount) return a.workloadCount - b.workloadCount;
      const aTime = a.lastAssignedAt ?? 0;
      const bTime = b.lastAssignedAt ?? 0;
      return aTime - bTime;
    })[0];
  };

  const checklist: ProposedChecklistItem[] = required.map((auth) => {
    const candidates = byAuthority.get(auth) ?? [];
    const sorted = [...candidates].sort((a, b) => {
      if (a.workloadCount !== b.workloadCount) return a.workloadCount - b.workloadCount;
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
    throw new HttpsError('invalid-argument', 'assignmentMap is required when dryRun=false.');
  }
  const submittedAuthorities = Object.keys(assignmentMap);
  if (submittedAuthorities.length !== required.length
    || submittedAuthorities.some((authority) => !required.includes(authority as AuthorityType))) {
    throw new HttpsError('invalid-argument', 'assignmentMap must contain exactly the event requiredAuthorities.');
  }
  for (const item of checklist) {
    if (!assignmentMap[item.authorityType]) {
      throw new HttpsError(
        'invalid-argument',
        `assignmentMap is missing an entry for required authority ${item.authorityType}.`,
      );
    }
  }

  const now = Date.now();
  return db.runTransaction(async (tx) => {
    // Re-read the event + ALL officers inside the transaction to avoid races.
    // Firestore requires all reads to complete before any writes.
    const evSnap = await tx.get(eventRef);
    const currentVersionSnap = await tx.get(versionRef);
    const ev = evSnap.data() as EventRecord;
    const currentVersion = currentVersionSnap.data() as EventVersion | undefined;
    if (!currentVersionSnap.exists || currentVersion?.eventId !== eventId || currentVersion.versionId !== versionId
      || currentVersion.eventDetails.venueState !== version.eventDetails.venueState
      || currentVersion.eventDetails.venueId !== version.eventDetails.venueId) {
      throw new HttpsError('aborted', 'The immutable application venue binding changed. Reload and retry.');
    }
    if (ev.initialReview?.decision !== 'Approved') {
      throw new HttpsError('failed-precondition', 'Complete and approve the admin initial review before assigning officers.');
    }
    if (ev.status !== 'UnderReview') {
      throw new HttpsError('failed-precondition', 'Only applications released for authority review can be assigned.');
    }
    if (ev.reviewStage === 'authority') {
      throw new HttpsError('failed-precondition', 'Officers are already assigned for this event version. Unassign first to re-assign.');
    }

    // Pre-fetch all officer refs in the read phase.
    const officerEntries: Array<[string, string, FirebaseFirestore.DocumentReference, OfficerProfile | null, UserProfile | null]> = [];
    for (const [auth, officerUid] of Object.entries(assignmentMap) as Array<[AuthorityType, string]>) {
      if (!officerUid) {
        throw new HttpsError('invalid-argument', `Empty officerUid for ${auth}.`);
      }
      const officerRef = db.collection(COLLECTIONS.OFFICERS).doc(officerUid);
      const officerUserRef = db.collection(COLLECTIONS.USERS).doc(officerUid);
      const officerSnap = await tx.get(officerRef);
      const officerUserSnap = await tx.get(officerUserRef);
      officerEntries.push([auth, officerUid, officerRef, officerSnap.exists ? officerSnap.data() as OfficerProfile : null,
        officerUserSnap.exists ? officerUserSnap.data() as UserProfile : null]);
    }

    // Validate all entries (no writes yet).
    for (const [auth, officerUid, , officer, officerUser] of officerEntries) {
      if (!officer) {
        throw new HttpsError('not-found', `Officer ${officerUid} not found.`);
      }
      if (officer.uid !== officerUid || !officerUser || officerUser.uid !== officerUid
        || officerUser.role !== 'authority' || officerUser.authorityType !== auth) {
        throw new HttpsError('failed-precondition', `Officer ${officerUid} is not bound to an active authority user profile for ${auth}.`);
      }
      if (officer.authorityType !== auth) {
        throw new HttpsError(
          'invalid-argument',
          `Officer ${officerUid} is ${officer.authorityType}, not ${auth}.`,
        );
      }
      if (!officer.active) {
        throw new HttpsError('failed-precondition', `Officer ${officerUid} is inactive.`);
      }
      if (officer.scopeType === 'state' && officer.state !== venueState) {
        throw new HttpsError(
          'permission-denied',
          `Officer ${officerUid} is state-scoped to ${officer.state}, but the event is at ${venueState}.`,
        );
      }
      if (officer.workloadCount >= officer.workloadLimit) {
        throw new HttpsError(
          'failed-precondition',
          `Officer ${officerUid} is at workload limit (${officer.workloadLimit}). Swap to a backup.`,
        );
      }
    }

    // Now writes — all reads are done.
    let officerWrites = 0;
    for (const [auth, officerUid, officerRef, officer] of officerEntries) {
      const assignmentId = `${versionId}_${auth}`;
      const assignmentRef = eventRef.collection(COLLECTIONS.ASSIGNMENTS).doc(assignmentId);
      const assignment: Assignment = {
        assignmentId,
        eventId,
        versionId,
        authorityType: auth as AuthorityType,
        officerUid,
        assignedBy: request.auth!.uid,
        assignedAt: now,
        status: 'pending',
      };
      tx.set(assignmentRef, assignment);
      tx.update(officerRef, {
        workloadCount: FieldValue.increment(1),
        lastAssignedAt: now,
        updatedAt: now,
      });

      // Audit log (FR-M3-09..12). Written in the same transaction so
      // there's no consistency window — the assignment and its audit
      // trail are committed atomically.
      const auditId = `assignment_created_${versionId}_${auth}_${now}`;
      tx.create(eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId), {
        id: auditId,
        eventId,
        versionId,
        action: 'assignment_created',
        actorId: request.auth!.uid,
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
      assignedOfficerByAuthority: Object.fromEntries(
        officerEntries.map(([auth, officerUid]) => [auth, officerUid]),
      ),
      updatedAt: now,
    });

    return { checklist, assigned: officerWrites };
  }).then((result) => {
    return { checklist: result.checklist, assigned: result.assigned, venueState };
  });
});

export function resolveSubmittedVenueState(version: EventVersion, registryVenue?: Venue): string {
  const submittedState = version.eventDetails.venueState?.trim() ?? '';
  const venueId = version.eventDetails.venueId;
  if (!venueId) {
    if (!submittedState) throw new HttpsError('failed-precondition', 'The immutable submitted venue state is required for officer assignment.');
    return submittedState;
  }
  if (!registryVenue || registryVenue.venueId !== venueId || !registryVenue.active || !registryVenue.state
    || (submittedState && submittedState !== registryVenue.state)) {
    throw new HttpsError('failed-precondition', 'The submitted registry venue state is stale or invalid.');
  }
  return registryVenue.state;
}
