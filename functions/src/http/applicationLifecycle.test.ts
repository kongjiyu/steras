import { describe, expect, it } from 'vitest';
import { EventRecord } from '@shared/types';
import { hasCanonicalCurrentVersion, hasValidActiveRevision, isBeforeAdminReview, isMatchingSubmittedVersion, lifecycleRevisionSource, validateEventId } from './applicationLifecycle';

function event(status: EventRecord['status'], overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    eventId: 'event-1', organizerId: 'organizer-1', status,
    currentVersionId: 'v1', currentVersionNumber: 1, editableVersionId: null,
    eventDetails: {} as EventRecord['eventDetails'], draftDocumentPaths: [], requiredAuthorities: [],
    createdAt: 1, updatedAt: 1, ...overrides,
  };
}

describe('M1 application lifecycle guards', () => {
  it('allows Pending edit/cancel only before any Admin or officer review state exists', () => {
    expect(isBeforeAdminReview(event('Pending', { reviewStage: 'initial' }))).toBe(true);
    expect(isBeforeAdminReview(event('Pending', { initialReview: { decision: 'Approved', reason: 'ok', reviewStage: 'initial', reviewerUid: 'admin', reviewedAt: 2 } }))).toBe(false);
    expect(isBeforeAdminReview(event('Pending', { assignedOfficerUids: ['officer'] }))).toBe(false);
    expect(isBeforeAdminReview(event('Pending', { assignedOfficerByAuthority: { PDRM: 'officer' } }))).toBe(false);
    expect(isBeforeAdminReview(event('UnderReview'))).toBe(false);
  });

  it('creates traceable sources for Pending edits and rejected revisions only', () => {
    expect(lifecycleRevisionSource(event('Pending'), 10)).toEqual({ kind: 'pending_edit', sourceVersionId: 'v1', startedAt: 10 });
    expect(lifecycleRevisionSource(event('Rejected', {
      initialReview: { decision: 'Rejected', reason: 'Missing route plan.', reviewStage: 'initial', suggestion: 'Attach a signed plan.', reviewerUid: 'admin', reviewedAt: 5 },
    }), 10)).toEqual({
      kind: 'rejected_revision', sourceVersionId: 'v1', startedAt: 10,
      rejectionReason: 'Missing route plan.', rejectionSuggestion: 'Attach a signed plan.',
    });
    expect(lifecycleRevisionSource(event('Approved'), 10)).toBeUndefined();
    expect(lifecycleRevisionSource(event('Rejected', {
      initialReview: { decision: 'Approved', reason: 'Initial gate passed.', reviewStage: 'initial', reviewerUid: 'admin', reviewedAt: 5 },
      secondReview: { confirmedDecision: 'Rejected', reason: 'Unsafe final resource plan.', suggestion: 'Revise the deployment plan.', reviewerUid: 'admin', decidedAt: 9 },
    }), 10)).toMatchObject({
      kind: 'rejected_revision', rejectionReason: 'Unsafe final resource plan.', rejectionSuggestion: 'Revise the deployment plan.',
    });
    expect(lifecycleRevisionSource(event('Rejected', { initialReview: undefined }), 10)).toBeUndefined();
    expect(hasCanonicalCurrentVersion(event('Pending', { currentVersionId: 'v2', currentVersionNumber: 1 }))).toBe(false);
    expect(hasValidActiveRevision(event('Draft', {
      editableVersionId: 'v2', activeRevision: { kind: 'pending_edit', sourceVersionId: 'v1', startedAt: 10 },
    }))).toBe(true);
    expect(hasValidActiveRevision(event('Draft', {
      editableVersionId: 'v2', activeRevision: { kind: 'pending_edit', sourceVersionId: 'v404', startedAt: 10 },
    }))).toBe(false);
    expect(isMatchingSubmittedVersion('event-1', event('Pending'), { eventId: 'event-1', versionId: 'v1', versionNumber: 1 })).toBe(true);
    expect(isMatchingSubmittedVersion('event-1', event('Pending'), { eventId: 'other', versionId: 'v1', versionNumber: 1 })).toBe(false);
  });

  it('rejects malformed IDs and request smuggling fields', () => {
    expect(validateEventId({ eventId: ' event-1 ' })).toBe('event-1');
    expect(() => validateEventId({ eventId: '../event' })).toThrow('A valid eventId is required.');
    expect(() => validateEventId({ eventId: 'event-1', status: 'Draft' })).toThrow('unsupported fields');
  });
});
