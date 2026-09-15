import { describe, expect, it } from 'vitest';
import type { EventControl, EventRecord } from '@shared/types';
import { isActiveControlGeneration } from './controlLifecycle';

const event = { status: 'Approved', currentVersionId: 'version-1' } as EventRecord;
const control = { eventId: 'event-1234', versionId: 'version-1', activityClosed: false } as EventControl;

describe('event-control lifecycle fence', () => {
  it('accepts only an approved current-generation control', () => {
    expect(isActiveControlGeneration(event, control, 'event-1234')).toBe(true);
    expect(isActiveControlGeneration({ ...event, status: 'Withdrawn' }, control, 'event-1234')).toBe(false);
    expect(isActiveControlGeneration({ ...event, status: 'Cancelled' }, control, 'event-1234')).toBe(false);
    expect(isActiveControlGeneration(event, { ...control, versionId: 'version-2' }, 'event-1234')).toBe(false);
    expect(isActiveControlGeneration(event, { ...control, activityClosed: true }, 'event-1234')).toBe(false);
    expect(isActiveControlGeneration(event, { ...control, eventId: 'other-event' }, 'event-1234')).toBe(false);
  });
});
