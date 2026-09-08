import type { EventRecord } from '@shared/types';

export type AdminWorkflowStage = 'Initial decision' | 'Assign officers' | 'Authority review' | 'Final decision' | 'Publish controls' | 'Awaiting organiser documentation' | 'Closed';
export type AdminPriority = 'High' | 'Medium' | 'Normal';
export interface AdminWorkflowState { stage: AdminWorkflowStage; needsAction: boolean; complete: boolean; priority: AdminPriority; actionLabel: string; actionPath: string; }

export function adminWorkflowState(event: EventRecord, now = Date.now()): AdminWorkflowState {
  let stage: AdminWorkflowStage = 'Closed';
  let actionLabel = 'View';
  let actionPath = `/admin/applications/${event.eventId}`;
  let needsAction = false;
  if (event.status === 'Pending' && !event.initialReview) {
    stage = 'Initial decision'; needsAction = true; actionLabel = 'Review';
  } else if (event.status === 'UnderReview' && event.reviewStage === 'second') {
    stage = 'Final decision'; needsAction = true; actionLabel = 'Decide'; actionPath += '/assign';
  } else if (event.status === 'UnderReview' && (event.reviewStage === 'initial' || !event.assignedOfficerUids?.length)) {
    stage = 'Assign officers'; needsAction = true; actionLabel = 'Assign'; actionPath += '/assign';
  } else if (event.status === 'UnderReview' && event.reviewStage === 'authority') {
    stage = 'Authority review'; actionLabel = 'Monitor'; actionPath += '/assign';
  } else if (event.status === 'Approved' && !event.controlListGenerated) {
    stage = 'Publish controls'; needsAction = true; actionLabel = 'Prepare controls';
  } else if (event.status === 'Approved') {
    stage = 'Awaiting organiser documentation'; actionLabel = 'View controls';
  }
  const complete = ['Rejected', 'Cancelled', 'Withdrawn'].includes(event.status)
    || (event.status === 'Approved' && event.controlListGenerated === true);
  const age = now - (event.updatedAt || event.submittedAt || event.createdAt);
  const startsWithinSevenDays = event.eventDetails.startDatetime >= now && event.eventDetails.startDatetime - now <= 7 * 86_400_000;
  const priority: AdminPriority = !needsAction ? 'Normal' : startsWithinSevenDays || age >= 3 * 86_400_000 ? 'High' : 'Medium';
  return { stage, needsAction, complete, priority, actionLabel, actionPath };
}
