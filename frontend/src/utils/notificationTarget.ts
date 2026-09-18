import type { Notification, NotificationType } from '@shared/types';

/** Organizer-facing control/documentation notifications should land on the
 * actionable workspace rather than the generic application summary. */
const CONTROL_WORKSPACE_TYPES = new Set<NotificationType>([
  'control_list_published',
  'control_verified',
  'control_rejected',
  'stage1_doc_submitted',
  'stage1_doc_approved',
  'stage1_doc_rejected',
  'stage1_reviewer_assigned',
  'stage2_doc_submitted',
  'stage2_doc_published',
  'stage2_doc_rejected',
  'control_resubmit_required',
  'control_restored',
]);

export function organizerNotificationPath(notification: Pick<Notification, 'eventId' | 'type'>): string {
  return CONTROL_WORKSPACE_TYPES.has(notification.type)
    ? `/organizer/events/${notification.eventId}/controls`
    : `/organizer/events/${notification.eventId}`;
}
