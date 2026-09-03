import { HttpsError } from 'firebase-functions/v2/https';
import type { EventRecord } from '@shared/types';

const DAY = 86_400_000;

/** Keep public-control reports and M4 incidents on the same event window. */
export function assertEventReportableAt(event: EventRecord, now: number): void {
  if (event.status !== 'Approved'
    || event.eventDetails.startDatetime > now
    || event.eventDetails.endDatetime < now - 7 * DAY) {
    throw new HttpsError(
      'failed-precondition',
      'Incidents may only be reported for ongoing events or events completed within seven days.',
    );
  }
}
