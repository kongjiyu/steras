import { describe, expect, it } from 'vitest';
import { organizerNotificationPath } from './notificationTarget';

describe('organizerNotificationPath', () => {
  it('routes control and document updates to the actionable workspace', () => {
    expect(organizerNotificationPath({ eventId: 'evt-1', type: 'control_list_published' })).toBe('/organizer/events/evt-1/controls');
    expect(organizerNotificationPath({ eventId: 'evt-1', type: 'stage2_doc_rejected' })).toBe('/organizer/events/evt-1/controls');
  });

  it('keeps decision notifications on the application summary', () => {
    expect(organizerNotificationPath({ eventId: 'evt-1', type: 'application_approved' })).toBe('/organizer/events/evt-1');
  });
});
