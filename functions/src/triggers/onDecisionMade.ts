/**
 * Triggers: onDecisionMade
 *
 * Module 4 — when authority sets status to Approved/Rejected/AmendmentRequested,
 * append an audit log and (if Approved) publish to public_events.
 *
 * Uses firebase-functions v2 API.
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { firestore } from 'firebase-admin';
import { logger } from 'firebase-functions';
import { EventRecord, COLLECTIONS, PublicEvent } from '@shared/types';
import { writeAuditLog } from '../utils/audit';

export const onDecisionMade = onDocumentUpdated(
  `${COLLECTIONS.EVENTS}/{eventId}`,
  async (event) => {
    const before = event.data?.before.data() as EventRecord | undefined;
    const afterData = event.data?.after.data();
    if (!before || !afterData) return;
    const after = { eventId: event.params.eventId, ...afterData } as EventRecord;
    if (before.status === after.status) return;

    // Decision transitions only.
    const decisionStates = ['Approved', 'Rejected', 'AmendmentRequested', 'UnderReview', 'Withdrawn'];
    if (!decisionStates.includes(after.status)) return;

    const db = firestore();

    // Audit log.
    await writeAuditLog(after.eventId, 'decision_made', after.decidedBy ?? 'unknown', {
      eventId: after.eventId,
      previousStatus: before.status,
      newStatus: after.status,
      actorId: after.decidedBy,
    });

    // If approved, publish to public_events (Module 3 — public calendar).
    if (after.status === 'Approved') {
      const publicEvent: PublicEvent = {
        eventId: after.eventId,
        eventName: after.eventDetails.name,
        venueName: after.eventDetails.venueName,
        eventType: after.eventDetails.type,
        startDatetime: after.eventDetails.startDatetime,
        endDatetime: after.eventDetails.endDatetime,
        approvedBy: [], // TODO: track which authority types signed off
        publicStatus: 'approved',
      };
      await db.collection(COLLECTIONS.PUBLIC_EVENTS).doc(after.eventId).set(publicEvent);

      await writeAuditLog(after.eventId, 'public_published', 'system', { eventId: after.eventId });
    }

    // If rejected/withdrawn, remove from public_events (if present).
    if (after.status === 'Rejected' || after.status === 'Withdrawn') {
      await db.collection(COLLECTIONS.PUBLIC_EVENTS).doc(after.eventId).delete().catch(() => undefined);
    }

    logger.info(`[onDecisionMade] ${after.eventId}: ${before.status} → ${after.status}`);
  },
);
