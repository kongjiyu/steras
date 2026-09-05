/**
 * AdminStage2Review — M3 Workstream 5 admin page (FR-M3-21, UC-14/15).
 *
 *   The admin reviews each organizer's Stage 2 image and either
 *     - Publishes it (sets `published: true`; the public can now see +
 *       👍 confirm / 🚩 report it)
 *     - Rejects it with an optional reason (the doc stays at
 *       `published: false`, with `rejectionReason/At/By` set; the
 *       organizer can re-upload)
 *     - Unpublishes a previously-published image (sets
 *       `published: false`; the image disappears from the public
 *       view; no rejection fields are set — the action is "pull it
 *       down" rather than "this is bad, start over")
 *
 *   This is the admin publish gate that lets us tighten the
 *   `stage2_docs` Firestore rule back to a per-doc `published == true`
 *   check (see firestore.rules comment on the `stage2_docs` match).
 *
 *   Per the M3 owner decision (2026-08-20 WS5 plan): minimal surface
 *   — Publish / Reject / Unpublish only. Re-reject just calls Reject
 *   again (the function overwrites the previous reason). No "edit
 *   reason" affordance.
 *
 *   Subscriptions: `event/{id}` (header), `event_controls` filtered
 *   by current `versionId` (cards), and per-control `stage2_docs/{id}`
 *   (the image + state). Admin can read all `stage2_docs` per the
 *   WS5 Firestore rule.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  Clock,
  Flag,
  Image as ImageIcon,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
  COLLECTIONS,
  EventControl,
  EventRecord,
  Stage2Doc,
} from '@shared/types';
import { db, functions } from '../../config/firebase';
import EmptyState from '../../components/ui/EmptyState';
import StatusBadge from '../../components/ui/StatusBadge';

interface PublishResponse {
  published: true;
  publishedAt: number;
}

interface UnpublishResponse {
  published: false;
  reason?: string;
  rejectedAt: number;
}

export default function AdminStage2Review() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [controls, setControls] = useState<EventControl[]>([]);
  const [stage2Docs, setStage2Docs] = useState<Record<string, Stage2Doc | null>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [rejectingControl, setRejectingControl] = useState<EventControl | null>(null);

  useEffect(() => {
    if (!eventId) return;
    return onSnapshot(doc(db, COLLECTIONS.EVENTS, eventId), (snapshot) => {
      if (snapshot.exists()) {
        setEvent({ eventId: snapshot.id, ...(snapshot.data() as Partial<EventRecord>) } as EventRecord);
      } else {
        setEvent(null);
      }
      setLoading(false);
    }, (err: unknown) => {
      console.warn('[AdminStage2Review] event subscribe failed', err);
      setLoadError('The event could not be loaded.');
      setLoading(false);
    });
  }, [eventId]);

  // Subscribe to the per-event event_controls (current version only).
  const versionId = event?.currentVersionId ?? 'v1';
  useEffect(() => {
    if (!eventId) return;
    const q = query(
      collection(db, COLLECTIONS.EVENTS, eventId, COLLECTIONS.EVENT_CONTROLS),
      where('versionId', '==', versionId),
    );
    return onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((d) => ({ controlId: d.id, ...(d.data() as Partial<EventControl>) }) as EventControl);
      list.sort((a, b) => a.authority.localeCompare(b.authority));
      setControls(list);
    }, (err) => {
      console.warn('[AdminStage2Review] controls subscribe failed', err);
    });
  }, [eventId, versionId]);

  // Subscribe to the per-control stage2_docs (admin reads all per the
  // WS5 rule). Fan-out is small (5 controls × 1 doc each in the UAT
  // fixture).
  useEffect(() => {
    if (!eventId || controls.length === 0) {
      setStage2Docs({});
      return;
    }
    const unsubs: Array<() => void> = [];
    for (const ctrl of controls) {
      const unsub = onSnapshot(
        collection(db, COLLECTIONS.EVENTS, eventId, COLLECTIONS.EVENT_CONTROLS, ctrl.controlId, COLLECTIONS.STAGE2_DOCS),
        (snapshot) => {
          setStage2Docs((prev) => {
            const next: Record<string, Stage2Doc | null> = { ...prev };
            // Singleton per control: docId is `${controlId}-s2`.
            const docId = `${ctrl.controlId}-s2`;
            next[docId] = snapshot.docs[0]
              ? (snapshot.docs[0].data() as Stage2Doc)
              : null;
            return next;
          });
        },
        (err) => {
          console.warn(`[AdminStage2Review] stage2_docs subscribe failed for ${ctrl.controlId}`, err);
        },
      );
      unsubs.push(unsub);
    }
    return () => { for (const u of unsubs) u(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, controls.map((c) => c.controlId).join('|')]);

  // Only the controls that require Stage 2 get a card.
  const reviewable = useMemo(
    () => controls.filter((c) => !!c.stage2Requirement),
    [controls],
  );

  async function handlePublish(ctrl: EventControl) {
    if (!eventId) return;
    const key = `publish:${ctrl.controlId}`;
    setBusyKey(key);
    try {
      const fn = httpsCallable<{ eventId: string; controlId: string }, PublishResponse>(functions, 'publishStage2Doc');
      await fn({ eventId, controlId: ctrl.controlId });
      toast.success(`Published ${ctrl.authority} image.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to publish.';
      toast.error(msg);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleUnpublish(ctrl: EventControl) {
    if (!eventId) return;
    const key = `unpublish:${ctrl.controlId}`;
    setBusyKey(key);
    try {
      const fn = httpsCallable<{ eventId: string; controlId: string; reason?: string }, UnpublishResponse>(functions, 'unpublishStage2Doc');
      await fn({ eventId, controlId: ctrl.controlId });
      toast.success(`Unpublished ${ctrl.authority} image.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to unpublish.';
      toast.error(msg);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleReject(ctrl: EventControl, reason: string) {
    if (!eventId) return;
    const key = `reject:${ctrl.controlId}`;
    setBusyKey(key);
    try {
      const fn = httpsCallable<{ eventId: string; controlId: string; reason?: string }, UnpublishResponse>(functions, 'unpublishStage2Doc');
      await fn({ eventId, controlId: ctrl.controlId, reason });
      toast.success(`Rejected ${ctrl.authority} image. Organiser will see the reason in their notification.`);
      setRejectingControl(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to reject.';
      toast.error(msg);
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) return <div className="p-8 text-ink-500">Loading event...</div>;
  if (loadError) return <div className="p-8"><EmptyState title="Event unavailable" description={loadError} /></div>;
  if (!event) return <div className="p-8"><EmptyState title="Event not found" description="It may have been removed or you do not have access." /></div>;

  const details = event.eventDetails;
  const venueName = details.venueName;
  const generated = event.controlListGenerated === true;
  const totalStage2 = reviewable.length;
  const publishedCount = reviewable.filter((c) => stage2Docs[`${c.controlId}-s2`]?.published === true).length;
  const pendingCount = reviewable.filter((c) => {
    const d = stage2Docs[`${c.controlId}-s2`];
    return d && d.published !== true && !d.m4TicketId;
  }).length;
  const reportedCount = reviewable.filter((c) => !!stage2Docs[`${c.controlId}-s2`]?.m4TicketId).length;

  return (
    <div className="p-5 sm:p-8">
      <Link to={`/admin/applications/${eventId}`} className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">
        <ChevronLeft size={16} /> Back to application
      </Link>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-800">Stage 2 review</h1>
          <p className="mt-1 text-sm text-ink-500">{details.name} · {venueName}</p>
          <p className="mt-1 text-xs text-ink-400">
            Version: <span className="font-semibold">{versionId}</span> ·{' '}
            {totalStage2 === 0
              ? 'No Stage 2 requirements for this event.'
              : (
                <>
                  {publishedCount} published
                  {pendingCount > 0 && <> · <span className="font-medium text-amber-700">{pendingCount} pending review</span></>}
                  {reportedCount > 0 && <> · <span className="font-medium text-red-700">{reportedCount} under incident investigation</span></>}
                  {generated && <> · of {totalStage2} Stage 2 control{totalStage2 === 1 ? '' : 's'}</>}
                </>
              )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge status={event.status} />
          {!generated && (
            <span className="text-xs font-semibold text-ink-500">Control list: not generated</span>
          )}
        </div>
      </div>

      {!generated && (
        <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          The control list hasn't been generated yet. Use <Link to={`/admin/applications/${eventId}/controls`} className="font-semibold underline">Open event control list</Link> to generate + commit the list first, then come back here.
        </div>
      )}

      {generated && totalStage2 === 0 && (
        <div className="card">
          <div className="card-body">
            <p className="text-sm text-ink-500">This event's control list has no Stage 2 requirements. Nothing to review.</p>
          </div>
        </div>
      )}

      {generated && totalStage2 > 0 && (
        <div className="space-y-4" data-testid="admin-stage2-review-list">
          {reviewable.map((ctrl) => {
            const docId = `${ctrl.controlId}-s2`;
            const doc = stage2Docs[docId] ?? null;
            const reported = !!doc?.m4TicketId;
            const published = doc?.published === true;
            const rejected = !published && !!doc?.rejectionReason;
            const pending = !published && !rejected;
            const stage2Label = ctrl.stage2Requirement?.label ?? 'Visual evidence';
            const publishKey = `publish:${ctrl.controlId}`;
            const unpublishKey = `unpublish:${ctrl.controlId}`;
            return (
              <section
                key={ctrl.controlId}
                className="card"
                data-testid={`admin-stage2-card-${ctrl.authority}`}
                data-doc-state={reported ? 'reported' : published ? 'published' : rejected ? 'rejected' : pending ? 'pending' : 'no_doc'}
              >
                <div className="card-header flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <ImageIcon size={16} className="text-brand-700" />
                    <h2 className="font-semibold">{ctrl.controlName}</h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge bg-blue-100 text-brand-700 text-xs">{ctrl.authority}</span>
                    {reported && (
                      <span className="badge bg-red-100 text-red-700 text-xs">
                        <AlertTriangle size={11} className="mr-0.5 inline" /> Under incident investigation
                      </span>
                    )}
                    {published && !reported && (
                      <span className="badge bg-status-approved/15 text-status-approved text-xs">
                        <Check size={11} className="mr-0.5 inline" /> Published
                      </span>
                    )}
                    {rejected && !reported && (
                      <span className="badge bg-red-100 text-red-700 text-xs" data-testid={`admin-stage2-rejected-badge-${ctrl.authority}`}>
                        <X size={11} className="mr-0.5 inline" /> Rejected
                      </span>
                    )}
                    {pending && !reported && (
                      <span className="badge bg-amber-100 text-amber-800 text-xs" data-testid={`admin-stage2-pending-badge-${ctrl.authority}`}>
                        <Clock size={11} className="mr-0.5 inline" /> Pending review
                      </span>
                    )}
                    {!doc && (
                      <span className="badge bg-ink-100 text-ink-600 text-xs">
                        No image uploaded
                      </span>
                    )}
                  </div>
                </div>
                <div className="card-body space-y-3">
                  {!doc ? (
                    <p className="text-sm text-ink-500">
                      The organiser hasn't uploaded a Stage 2 image for this control yet. Nothing to review.
                    </p>
                  ) : (
                    <>
                      {doc.imageUrl && (
                        <a href={doc.imageUrl} target="_blank" rel="noreferrer" className="block">
                          <img
                            src={doc.imageUrl}
                            alt={`${ctrl.authority} Stage 2 image`}
                            className="max-h-80 w-full rounded-md border border-ink-200 object-contain"
                            data-testid={`admin-stage2-image-${ctrl.authority}`}
                          />
                        </a>
                      )}
                      <p className="text-xs text-ink-500">{stage2Label}</p>
                      {rejected && doc.rejectionReason && (
                        <div
                          className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800"
                          data-testid={`admin-stage2-rejection-reason-${ctrl.authority}`}
                        >
                          <div className="font-semibold">Last rejection reason:</div>
                          <div className="mt-0.5">{doc.rejectionReason}</div>
                        </div>
                      )}
                      {reported && (
                        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">
                          A public report is open for this Stage 2 image (ticket <span className="font-mono">{doc.m4TicketId}</span>). The incident investigation owns the outcome; this approval action is locked until the ticket is resolved.
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        {!reported && !published && (
                          <button
                            type="button"
                            onClick={() => handlePublish(ctrl)}
                            disabled={busyKey === publishKey || busyKey === unpublishKey}
                            className="btn-success !py-1.5 !px-3 text-xs"
                            data-testid={`admin-stage2-publish-${ctrl.authority}`}
                          >
                            <Check size={14} />
                            {busyKey === publishKey ? 'Publishing…' : 'Publish'}
                          </button>
                        )}
                        {!reported && published && (
                          <button
                            type="button"
                            onClick={() => handleUnpublish(ctrl)}
                            disabled={busyKey === publishKey || busyKey === unpublishKey}
                            className="btn-secondary !py-1.5 !px-3 text-xs"
                            data-testid={`admin-stage2-unpublish-${ctrl.authority}`}
                          >
                            <RotateCcw size={14} />
                            {busyKey === unpublishKey ? 'Unpublishing…' : 'Unpublish'}
                          </button>
                        )}
                        {!reported && !published && (
                          <button
                            type="button"
                            onClick={() => setRejectingControl(ctrl)}
                            disabled={busyKey === publishKey}
                            className="btn-secondary !py-1.5 !px-3 text-xs"
                            data-testid={`admin-stage2-reject-${ctrl.authority}`}
                          >
                            <Flag size={14} />
                            Reject…
                          </button>
                        )}
                        {!reported && rejected && (
                          <span className="text-xs text-ink-500 italic">
                            <Upload size={11} className="mr-1 inline" />
                            Waiting for the organiser to re-upload a corrected image.
                          </span>
                        )}
                        {reported && (
                          <span className="text-xs text-ink-500 italic">
                            All actions locked while the incident ticket is open.
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {rejectingControl && (
        <RejectModal
          ctrl={rejectingControl}
          onClose={() => setRejectingControl(null)}
          onSubmit={(reason) => handleReject(rejectingControl, reason)}
          submitting={busyKey === `reject:${rejectingControl.controlId}`}
        />
      )}
    </div>
  );
}

interface RejectModalProps {
  ctrl: EventControl;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  submitting: boolean;
}

function RejectModal({ ctrl, onClose, onSubmit, submitting }: RejectModalProps) {
  const [reason, setReason] = useState('');
  const REASON_MAX = 500;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(reason.trim());
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-reject-modal-title"
      data-testid="admin-reject-modal"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
        <h3 id="admin-reject-modal-title" className="font-display text-lg font-bold text-ink-800">
          Reject {ctrl.authority} image
        </h3>
        <p className="mt-1 text-sm text-ink-600">
          Tell the organiser what to fix. The reason will appear in their notification. Leave blank to unpublish without a reason.
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <label className="block">
            <span className="text-sm font-semibold text-ink-700">Reason (optional, max {REASON_MAX} chars)</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
              maxLength={REASON_MAX}
              rows={4}
              className="mt-1 w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm"
              placeholder="e.g. The photo doesn't show the venue entrance. Please re-upload with a wider angle."
              data-testid="admin-reject-reason"
              autoFocus
            />
            <span className="mt-1 block text-xs text-ink-500">{reason.length} / {REASON_MAX}</span>
          </label>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-ink-300 bg-white px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
              data-testid="admin-reject-cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              data-testid="admin-reject-submit"
            >
              {submitting ? 'Rejecting…' : 'Reject image'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
