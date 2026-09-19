import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assignAuthorityOfficers } from './assignAuthorityOfficers';

interface Snapshot {
  id: string;
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}

const state = vi.hoisted(() => ({
  collections: new Map<string, Map<string, Record<string, unknown>>>(),
  writes: [] as Array<{ kind: string; path: string; data?: Record<string, unknown> }>,
}));

function makeSnapshot(id: string, data: Record<string, unknown> | undefined): Snapshot {
  return { id, exists: Boolean(data), data: () => data };
}

function pathFor(collection: string, id: string) {
  return `${collection}/${id}`;
}

function seed(collection: string, id: string, data: Record<string, unknown>) {
  if (!state.collections.has(collection)) state.collections.set(collection, new Map());
  state.collections.get(collection)!.set(id, data);
}

function read(collection: string, id: string) {
  return state.collections.get(collection)?.get(id);
}

function ref(collection: string, id: string, path = pathFor(collection, id)) {
  return {
    id,
    path,
    get: async () => makeSnapshot(id, read(collection, id)),
    collection: (child: string) => query(child, `${collection}/${id}/${child}`),
  };
}

function query(collection: string, prefix = collection) {
  const result = () => [...(state.collections.get(collection)?.entries() ?? [])]
    .map(([id, data]) => ({ id, data: () => data, exists: true, ref: ref(collection, id, `${prefix}/${id}`) }));
  return {
    id: collection,
    path: prefix,
    doc: (id: string) => ref(collection, id, `${prefix}/${id}`),
    where: () => query(collection, prefix),
    get: async () => ({ docs: result(), empty: result().length === 0 }),
  };
}

const db = {
  collection: (name: string) => query(name),
  getAll: async (...refs: Array<{ id: string; get: () => Promise<Snapshot> }>) => Promise.all(refs.map((item) => item.get())),
  runTransaction: async <T>(callback: (tx: {
    get: (target: { get: () => Promise<unknown> }) => Promise<unknown>;
    set: (target: { path: string }, data: Record<string, unknown>) => void;
    update: (target: { path: string }, data: Record<string, unknown>) => void;
    create: (target: { path: string }, data: Record<string, unknown>) => void;
  }) => Promise<T>) => callback({
    get: async (target) => target.get(),
    set: (target, data) => state.writes.push({ kind: 'set', path: target.path, data }),
    update: (target, data) => state.writes.push({ kind: 'update', path: target.path, data }),
    create: (target, data) => state.writes.push({ kind: 'create', path: target.path, data }),
  }),
};

vi.mock('firebase-admin', () => ({ firestore: () => db }));

describe('assignAuthorityOfficers callable', () => {
  beforeEach(() => {
    state.collections.clear();
    state.writes = [];
    const event = {
      eventId: 'event-1',
      currentVersionId: 'v1',
      status: 'UnderReview',
      reviewStage: 'initial',
      initialReview: { decision: 'Approved' },
      requiredAuthorities: ['PDRM'],
      eventDetails: {
        venueId: 'venue-1', venueName: 'Verified Hall', venueAddress: 'Kuala Lumpur, Malaysia', venueCapacity: 1000,
      },
      assignedOfficerByAuthority: {},
      assignedOfficerUids: [],
    };
    seed('users', 'admin-1', { uid: 'admin-1', role: 'admin' });
    seed('events', 'event-1', event);
    seed('versions', 'v1', { eventId: 'event-1', versionId: 'v1', eventDetails: event.eventDetails });
    seed('venues', 'venue-1', {
      venueId: 'venue-1', name: 'Verified Hall', address: 'Kuala Lumpur, Malaysia', capacity: 1000,
      state: 'Kuala Lumpur', active: true, verificationStatus: 'verified',
    });
    seed('officers', 'pdrm-1', {
      uid: 'pdrm-1', authorityType: 'PDRM', scopeType: 'state', state: 'Kuala Lumpur',
      active: true, workloadCount: 0, workloadLimit: 10,
    });
    seed('users', 'pdrm-1', { uid: 'pdrm-1', role: 'authority', authorityType: 'PDRM' });
  });

  it('assigns an officer before any current-version control items exist', async () => {
    const result = await assignAuthorityOfficers.run({
      auth: { uid: 'admin-1' },
      data: { eventId: 'event-1', assignmentMap: { PDRM: 'pdrm-1' }, dryRun: false, mode: 'initial' },
    } as never);

    expect(result).toMatchObject({ assigned: 1, authorities: ['PDRM'] });
    expect(state.writes.some((write) => write.path === 'events/event-1/assignments/v1_PDRM')).toBe(true);
    expect(state.writes.some((write) => write.path === 'events/event-1/audit_logs/assignment_created_v1_PDRM_' + (write.data?.timestamp ?? ''))).toBe(true);
    expect(state.writes.find((write) => write.path === 'officers/pdrm-1')?.data?.workloadCount).toBe(1);
    expect(state.writes.find((write) => write.path === 'events/event-1')?.data?.reviewStage).toBe('authority');
    expect(state.writes.some((write) => write.path.includes('event_controls'))).toBe(false);
  });

  it('permits replacement of a revoked assignment before controls exist', async () => {
    seed('assignments', 'v1_PDRM', { assignmentId: 'v1_PDRM', eventId: 'event-1', versionId: 'v1', authorityType: 'PDRM', officerUid: 'old-officer', status: 'revoked' });
    const result = await assignAuthorityOfficers.run({ auth: { uid: 'admin-1' }, data: { eventId: 'event-1', assignmentMap: { PDRM: 'pdrm-1' }, dryRun: false, mode: 'replacement' } } as never);
    expect(result).toMatchObject({ assigned: 1, mode: 'replacement' });
    expect(state.writes.find((write) => write.path === 'events/event-1/assignments/v1_PDRM')?.data?.officerUid).toBe('pdrm-1');
  });

  it('rejects repeated assignment without a workload or audit write', async () => {
    seed('assignments', 'v1_PDRM', { assignmentId: 'v1_PDRM', eventId: 'event-1', versionId: 'v1', authorityType: 'PDRM', officerUid: 'pdrm-1', status: 'pending' });
    await expect(assignAuthorityOfficers.run({ auth: { uid: 'admin-1' }, data: { eventId: 'event-1', assignmentMap: { PDRM: 'pdrm-1' }, dryRun: false, mode: 'initial' } } as never)).rejects.toThrow('already assigned');
    expect(state.writes).toHaveLength(0);
  });

  it('rejects exhausted officer workload without partial writes', async () => {
    seed('officers', 'pdrm-1', { ...read('officers', 'pdrm-1'), workloadCount: 10, workloadLimit: 10 });
    await expect(assignAuthorityOfficers.run({ auth: { uid: 'admin-1' }, data: { eventId: 'event-1', assignmentMap: { PDRM: 'pdrm-1' }, dryRun: false, mode: 'initial' } } as never)).rejects.toThrow('workload limit');
    expect(state.writes).toHaveLength(0);
  });
});
