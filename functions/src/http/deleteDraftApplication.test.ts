import { describe, expect, it } from 'vitest';
import {
  assertCanDeleteDraft,
  deletionStoragePrefixes,
  validateDeleteDraftApplicationRequest,
} from './deleteDraftApplication';

const draft = { organizerId: 'organizer-1', status: 'Draft' as const };

describe('deleteDraftApplication validation', () => {
  it('accepts a new Draft and a revision Draft', () => {
    expect(() => assertCanDeleteDraft('organizer-1', { role: 'organizer' }, draft)).not.toThrow();
    expect(() => assertCanDeleteDraft('organizer-1', { role: 'organizer' }, {
      organizerId: 'organizer-1',
      status: 'Draft',
    })).not.toThrow();
  });

  it('rejects an unauthorised role, another owner, and a submitted application', () => {
    expect(() => assertCanDeleteDraft('organizer-1', undefined, draft)).toThrowError(/Only organizer/);
    expect(() => assertCanDeleteDraft('organizer-1', { role: 'authority' }, draft)).toThrowError(/Only organizer/);
    expect(() => assertCanDeleteDraft('organizer-2', { role: 'organizer' }, draft)).toThrowError(/do not own/);
    expect(() => assertCanDeleteDraft('organizer-1', { role: 'organizer' }, { organizerId: 'organizer-1', status: 'Pending' })).toThrowError(/Only Draft/);
  });

  it('rejects invalid event ids and unsupported request fields', () => {
    expect(validateDeleteDraftApplicationRequest({ eventId: 'event-1' })).toBe('event-1');
    expect(() => validateDeleteDraftApplicationRequest({ eventId: '../event-1' })).toThrowError(/valid eventId/);
    expect(() => validateDeleteDraftApplicationRequest({ eventId: 'event-1', force: true })).toThrowError(/unsupported fields/);
    expect(() => validateDeleteDraftApplicationRequest({})).toThrowError(/valid eventId/);
  });

  it('limits Storage cleanup to the two application-owned prefixes', () => {
    expect(deletionStoragePrefixes('event-1')).toEqual([
      'event_documents/event-1/',
      'events/event-1/',
    ]);
  });
});
