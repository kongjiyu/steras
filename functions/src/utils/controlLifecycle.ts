import type { EventControl, EventRecord } from '@shared/types';

export function isActiveControlGeneration(
  event: EventRecord | undefined,
  control: Pick<EventControl, 'eventId' | 'versionId' | 'activityClosed'> | undefined,
  eventId: string,
): boolean {
  return Boolean(event
    && control
    && event.status === 'Approved'
    && typeof event.currentVersionId === 'string'
    && event.currentVersionId.length > 0
    && control.eventId === eventId
    && control.versionId === event.currentVersionId
    && control.activityClosed !== true);
}
