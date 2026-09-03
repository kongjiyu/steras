import { describe, expect, it, vi } from 'vitest';
import type { EventRecord } from '@shared/types';
import {
  assertEvidencePath, assertReportableEvent, assertResolutionReady, buildIncidentAiPayload,
  canPerformIncidentAction, safeIncident, sameSubmission, validateSubmission,
} from './m4Incidents';

const now = Date.UTC(2026, 8, 3, 12);
const event = (start: number, end: number, status: EventRecord['status'] = 'Approved') => ({
  status,
  eventDetails: { startDatetime: start, endDatetime: end },
}) as EventRecord;

describe('M4 incident input boundary', () => {
  it('accepts ongoing and recently completed approved events', () => {
    expect(() => assertReportableEvent(event(now - 1_000, now + 1_000), now)).not.toThrow();
    expect(() => assertReportableEvent(event(now - 10_000, now - 7 * 86_400_000), now)).not.toThrow();
  });

  it('rejects future, older-than-seven-day, withdrawn and cancelled events', () => {
    expect(() => assertReportableEvent(event(now + 1, now + 2), now)).toThrow();
    expect(() => assertReportableEvent(event(now - 9 * 86_400_000, now - 7 * 86_400_000 - 1), now)).toThrow();
    expect(() => assertReportableEvent(event(now - 1, now + 1, 'Withdrawn'), now)).toThrow();
    expect(() => assertReportableEvent(event(now - 1, now + 1, 'Cancelled'), now)).toThrow();
  });

  it('requires canonical category, occurrence, location, description and idempotency key', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const valid = { eventId: 'event-1234', category: 'medical_safety', occurredAt: now - 1, location: 'North entrance', description: 'A participant required prompt medical assistance.', idempotencyKey: 'request-1234', evidencePaths: [] };
    expect(validateSubmission(valid)).toMatchObject({ category: 'medical_safety', location: 'North entrance' });
    expect(() => validateSubmission({ ...valid, category: 'made_up' })).toThrow();
    expect(() => validateSubmission({ ...valid, description: 'too short' })).toThrow();
    expect(() => validateSubmission({ ...valid, occurredAt: Number.NaN })).toThrow();
    expect(() => validateSubmission({ ...valid, occurredAt: now + 300_001 })).toThrow();
    vi.useRealTimers();
  });

  it('rejects nested identifiers and duplicate-looking unsafe paths at the request boundary', () => {
    const valid = { eventId: 'event-1234', category: 'crowd', occurredAt: Date.now() - 1, location: 'Gate A', description: 'Crowd density increased beside the controlled entrance.', idempotencyKey: 'request-1234' };
    expect(() => validateSubmission({ ...valid, eventId: 'events/nested' })).toThrow();
    expect(() => validateSubmission({ ...valid, linkedControlId: '../control' })).toThrow();
  });

  it('removes internal assignment and authority identity from reporter-safe records', () => {
    const record = {
      organizerId: 'organizer-1', reporterUid: 'reporter-1', assignedInternalTeam: 'Venue operations',
      referredAuthorityId: 'pdrm-kl', referredAuthorityType: 'PDRM', assignedAuthorityOfficerUid: 'officer-1',
      recommendedAuthorityIds: ['pdrm-kl'],
    } as unknown as Parameters<typeof safeIncident>[0];
    const result = safeIncident(record, 'public', 'reporter-1');
    expect(result).not.toHaveProperty('organizerId');
    expect(result).not.toHaveProperty('assignedInternalTeam');
    expect(result).not.toHaveProperty('referredAuthorityId');
    expect(result).not.toHaveProperty('assignedAuthorityOfficerUid');
    expect(result.reporterUid).toBe('reporter-1');
  });

  it('enforces uploader-scoped flat evidence paths', () => {
    expect(() => assertEvidencePath('reporter-1', 'incident_evidence/reporter-1/photo.pdf')).not.toThrow();
    expect(() => assertEvidencePath('reporter-1', 'incident_evidence/other/photo.pdf')).toThrow();
    expect(() => assertEvidencePath('reporter-1', 'incident_evidence/reporter-1/nested/photo.pdf')).toThrow();
  });

  it('sends MiniMax only allowlisted evidence metadata and never a Storage path', () => {
    const input = { category: 'security' as const, description: 'A suspicious unattended item was found.', location: 'Gate A', occurredAt: now,
      evidence: [{ path: 'incident_evidence/reporter-1/private.jpg', name: 'photo.jpg', mimeType: 'image/jpeg', size: 123, uploadedBy: 'reporter-1', uploadedAt: now }] };
    const payload = buildIncidentAiPayload(input, { eventDetails: { type: 'concert', venueName: 'Demo Hall', expectedAttendance: 500 } } as EventRecord);
    expect(payload.evidence).toEqual([{ name: 'photo.jpg', mimeType: 'image/jpeg', size: 123 }]);
    expect(JSON.stringify(payload)).not.toContain('incident_evidence');
  });

  it('rejects idempotency-key reuse when any immutable submission input changes', () => {
    const input = validateSubmission({ eventId: 'event-1234', category: 'crowd', occurredAt: Date.now() - 1, location: 'Gate A', description: 'Crowd density increased beside the controlled entrance.', idempotencyKey: 'request-1234', evidencePaths: ['incident_evidence/reporter-1/a.pdf'] });
    const record = { reporterUid: 'reporter-1', eventId: input.eventId, category: input.category, description: input.description, location: input.location, occurredAt: input.occurredAt, evidence: [{ path: input.evidencePaths[0] }] } as unknown as Parameters<typeof sameSubmission>[0];
    expect(sameSubmission(record, 'reporter-1', input)).toBe(true);
    expect(sameSubmission({ ...record, location: 'Gate B' }, 'reporter-1', input)).toBe(false);
    expect(sameSubmission({ ...record, category: 'security' }, 'reporter-1', input)).toBe(false);
  });

  it('allows only the owning organizer or exactly assigned matching authority to act', () => {
    const record = { organizerId: 'organizer-1', referredAuthorityType: 'PDRM', assignedAuthorityOfficerUid: 'pdrm-1' } as Parameters<typeof canPerformIncidentAction>[0];
    const organizer = { role: 'organizer' } as Parameters<typeof canPerformIncidentAction>[1];
    const authority = { role: 'authority', authorityType: 'PDRM' } as Parameters<typeof canPerformIncidentAction>[1];
    expect(canPerformIncidentAction(record, organizer, 'organizer-1', 'record_response')).toBe(true);
    expect(canPerformIncidentAction(record, organizer, 'organizer-2', 'resolve')).toBe(false);
    expect(canPerformIncidentAction(record, authority, 'pdrm-1', 'record_investigation')).toBe(true);
    expect(canPerformIncidentAction(record, authority, 'pdrm-2', 'record_investigation')).toBe(false);
    expect(canPerformIncidentAction(record, { role: 'authority', authorityType: 'BOMBA' } as typeof authority, 'pdrm-1', 'record_investigation')).toBe(false);
  });

  it('prevents early closure before a completed response or investigation', () => {
    expect(() => assertResolutionReady({ status: 'responding' } as Parameters<typeof assertResolutionReady>[0])).toThrow();
    expect(() => assertResolutionReady({ status: 'authority_investigation' } as Parameters<typeof assertResolutionReady>[0])).toThrow();
    expect(() => assertResolutionReady({ status: 'awaiting_resolution' } as Parameters<typeof assertResolutionReady>[0])).not.toThrow();
  });
});
