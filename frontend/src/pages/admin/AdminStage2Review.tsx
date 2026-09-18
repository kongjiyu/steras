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
  ShieldCheck,
  FileText,
  Download,
  Pencil,
} from 'lucide-react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
  COLLECTIONS,
  EventControl,
  EventRecord,
  OfficerProfile,
  Stage2Doc,
  Stage1Doc,
  Stage1DocRevision,
  Stage1RedactionDraft,
  Stage1RedactionMask,
} from '@shared/types';
import { stage2DocumentId } from '@shared/stage2';
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
  const [retryKey, setRetryKey] = useState(0);
  const [controls, setControls] = useState<EventControl[]>([]);
  const [stage2Docs, setStage2Docs] = useState<Record<string, Stage2Doc | null>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [rejectingControl, setRejectingControl] = useState<EventControl | null>(null);
  const [tab, setTab] = useState<'stage1' | 'stage2'>('stage1');
  const [stage1Docs, setStage1Docs] = useState<Record<string, Stage1Doc | null>>({});
  const [stage1Revisions, setStage1Revisions] = useState<Record<string, Stage1DocRevision[]>>({});
  const [redactions, setRedactions] = useState<Record<string, Stage1RedactionDraft | null>>({});
  const [redactionBusy, setRedactionBusy] = useState<string | null>(null);
  const [reviewerBusy, setReviewerBusy] = useState<string | null>(null);
  const [officers, setOfficers] = useState<OfficerProfile[]>([]);
  const [editingRedaction, setEditingRedaction] = useState<string | null>(null);
  const [maskDraft, setMaskDraft] = useState<Stage1RedactionMask[]>([]);
  const [reviewedPages, setReviewedPages] = useState<number[]>([]);

  useEffect(() => {
    if (!eventId) return;
    setLoading(true);
    setLoadError('');
    setEvent(null);
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
  }, [eventId, retryKey]);

  useEffect(() => {
    const officersQuery = query(collection(db, COLLECTIONS.OFFICERS), where('active', '==', true));
    return onSnapshot(officersQuery, (snapshot) => {
      setOfficers(snapshot.docs.map((item) => ({ ...(item.data() as OfficerProfile), uid: item.id })));
    }, () => setLoadError('The active Stage 1 reviewer list could not be loaded.'));
  }, [retryKey]);

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
      setLoadError('Control requirements or evidence could not be loaded. Try again before taking action.');
    });
  }, [eventId, versionId, retryKey]);

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
            // Prefer the canonical singleton, but retain the actual id for
            // repaired/legacy records so publish and reject target exactly
            // what the Admin is viewing.
            const preferred = snapshot.docs.find((item) => item.id === stage2DocumentId(ctrl.controlId)) ?? snapshot.docs[0];
            next[ctrl.controlId] = preferred
              ? ({ ...(preferred.data() as Stage2Doc), docId: preferred.id })
              : null;
            return next;
          });
        },
        (err) => {
          console.warn(`[AdminStage2Review] stage2_docs subscribe failed for ${ctrl.controlId}`, err);
          setLoadError('Control requirements or evidence could not be loaded. Try again before taking action.');
        },
      );
      unsubs.push(unsub);
    }
    return () => { for (const u of unsubs) u(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, controls.map((c) => c.controlId).join('|'), retryKey]);

  // Stage 1 documentation is reviewed and published independently from the
  // Stage 2 image cards. Keep the current projection and its redaction draft
  // keyed by control/doc so a replacement immediately removes stale public
  // state from this page.
  useEffect(() => {
    if (!eventId || controls.length === 0) {
      setStage1Docs({});
      setStage1Revisions({});
      setRedactions({});
      return;
    }
    const unsubscribes: Array<() => void> = [];
    const revisionUnsubscribes: Array<() => void> = [];
    setStage1Revisions({});
    for (const control of controls) {
      const docsRef = collection(db, COLLECTIONS.EVENTS, eventId, COLLECTIONS.EVENT_CONTROLS, control.controlId, COLLECTIONS.STAGE1_DOCS);
      unsubscribes.push(onSnapshot(docsRef, (snapshot) => {
        for (const item of snapshot.docs) {
          const key = `${control.controlId}__${item.id}`;
          const stage1Doc = item.data() as Stage1Doc;
          setStage1Docs((prev) => ({ ...prev, [key]: { ...stage1Doc, docId: item.id } }));
          const revisionsRef = collection(docsRef, item.id, COLLECTIONS.STAGE1_REVISIONS);
          revisionUnsubscribes.push(onSnapshot(revisionsRef, (revisions) => setStage1Revisions((prev) => ({
            ...prev,
            [key]: revisions.docs.map((revision) => revision.data() as Stage1DocRevision).sort((left, right) => right.revision - left.revision),
          }))));
          const redactionId = stage1Doc.revisionId ?? `${item.id}-r${stage1Doc.revision ?? 1}`;
          const redactionRef = doc(db, COLLECTIONS.EVENTS, eventId, COLLECTIONS.EVENT_CONTROLS, control.controlId, COLLECTIONS.STAGE1_DOCS, item.id, COLLECTIONS.STAGE1_REDACTIONS, redactionId);
          unsubscribes.push(onSnapshot(redactionRef, (redaction) => setRedactions((prev) => ({ ...prev, [key]: redaction.exists() ? redaction.data() as Stage1RedactionDraft : null }))));
        }
      }, () => setLoadError('Stage 1 documentation could not be loaded.')));
    }
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
      for (const unsubscribe of revisionUnsubscribes) unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, controls.map((c) => c.controlId).join('|'), retryKey]);

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
      const fn = httpsCallable<{ eventId: string; controlId: string; docId?: string }, PublishResponse>(functions, 'publishStage2Doc');
      await fn({ eventId, controlId: ctrl.controlId, ...(stage2Docs[ctrl.controlId]?.docId ? { docId: stage2Docs[ctrl.controlId]!.docId } : {}) });
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
      const fn = httpsCallable<{ eventId: string; controlId: string; docId?: string; reason?: string }, UnpublishResponse>(functions, 'unpublishStage2Doc');
      await fn({ eventId, controlId: ctrl.controlId, ...(stage2Docs[ctrl.controlId]?.docId ? { docId: stage2Docs[ctrl.controlId]!.docId } : {}) });
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
      const fn = httpsCallable<{ eventId: string; controlId: string; docId?: string; reason?: string }, UnpublishResponse>(functions, 'unpublishStage2Doc');
      await fn({ eventId, controlId: ctrl.controlId, ...(stage2Docs[ctrl.controlId]?.docId ? { docId: stage2Docs[ctrl.controlId]!.docId } : {}), reason });
      toast.success(`Rejected ${ctrl.authority} image. Organiser will see the reason in their notification.`);
      setRejectingControl(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to reject.';
      toast.error(msg);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleGenerateStage1(ctrl: EventControl, stage1Doc: Stage1Doc, regenerate = false) {
    if (!eventId) return;
    const key = `stage1-generate:${ctrl.controlId}:${stage1Doc.docId}`;
    setRedactionBusy(key);
    try {
      const fn = httpsCallable<{ eventId: string; controlId: string; docId: string; regenerate?: boolean }, Stage1RedactionDraft>(functions, 'generateStage1Redaction');
      const result = await fn({ eventId, controlId: ctrl.controlId, docId: stage1Doc.docId, ...(regenerate ? { regenerate: true } : {}) });
      setRedactions((prev) => ({ ...prev, [`${ctrl.controlId}__${stage1Doc.docId}`]: result.data }));
      toast.success(result.data.status === 'manual_required' ? 'AI redaction needs manual page review.' : 'Redaction draft generated.');
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setRedactionBusy(null); }
  }

  async function handleAssignReviewer(ctrl: EventControl, reviewerUid: string) {
    if (!eventId || !reviewerUid || reviewerUid === ctrl.stage1ReviewerUid) return;
    setReviewerBusy(ctrl.controlId);
    try {
      const fn = httpsCallable<{ eventId: string; controlId: string; reviewerUid: string }, unknown>(functions, 'assignStage1Reviewer');
      await fn({ eventId, controlId: ctrl.controlId, reviewerUid });
      toast.success(`${ctrl.authority} Stage 1 reviewer updated.`);
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setReviewerBusy(null); }
  }

  function openRedactionEditor(ctrl: EventControl, stage1Doc: Stage1Doc) {
    const key = `${ctrl.controlId}__${stage1Doc.docId}`;
    const draft = redactions[key];
    if (!draft) return;
    setEditingRedaction(key);
    setMaskDraft(draft.masks ?? []);
    setReviewedPages(draft.reviewedPages ?? []);
  }

  async function saveRedaction(ctrl: EventControl, stage1Doc: Stage1Doc) {
    if (!eventId) return;
    const key = `${ctrl.controlId}__${stage1Doc.docId}`;
    setRedactionBusy(`stage1-save:${key}`);
    try {
      const fn = httpsCallable<{ eventId: string; controlId: string; docId: string; masks: Stage1RedactionMask[]; reviewedPages: number[] }, Stage1RedactionDraft>(functions, 'updateStage1Redaction');
      const result = await fn({ eventId, controlId: ctrl.controlId, docId: stage1Doc.docId, masks: maskDraft, reviewedPages });
      setRedactions((prev) => ({ ...prev, [key]: result.data }));
      setEditingRedaction(null);
      toast.success('Redaction review saved.');
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setRedactionBusy(null); }
  }

  async function handlePublishStage1(ctrl: EventControl, stage1Doc: Stage1Doc, publish: boolean) {
    if (!eventId) return;
    const key = `${publish ? 'stage1-publish' : 'stage1-unpublish'}:${ctrl.controlId}:${stage1Doc.docId}`;
    setRedactionBusy(key);
    try {
      const fn = httpsCallable<{ eventId: string; controlId: string; docId: string }, unknown>(functions, publish ? 'publishStage1Doc' : 'unpublishStage1Doc');
      await fn({ eventId, controlId: ctrl.controlId, docId: stage1Doc.docId });
      toast.success(publish ? 'Stage 1 document published to the public view.' : 'Stage 1 document unpublished.');
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setRedactionBusy(null); }
  }

  if (loading) return <div className="p-8 text-ink-500">Loading event...</div>;
  if (loadError) return <div className="p-8"><EmptyState title="Event unavailable" description={loadError}><button type="button" className="btn-secondary" onClick={() => setRetryKey((value) => value + 1)}>Try again</button></EmptyState></div>;
  if (!event) return <div className="p-8"><EmptyState title="Event not found" description="It may have been removed or you do not have access." /></div>;

  const details = event.eventDetails;
  const venueName = details.venueName;
  const generated = event.controlListGenerated === true;
  const totalStage2 = reviewable.length;
  const publishedCount = reviewable.filter((c) => stage2Docs[c.controlId]?.published === true).length;
  const pendingCount = reviewable.filter((c) => {
    const d = stage2Docs[c.controlId];
    return d && d.published !== true && !d.m4TicketId;
  }).length;
  const reportedCount = reviewable.filter((c) => !!stage2Docs[c.controlId]?.m4TicketId).length;

  return (
    <div className="p-5 sm:p-8">
      <Link to={`/admin/applications/${eventId}`} className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">
        <ChevronLeft size={16} /> Back to application
      </Link>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-800">Event documentation</h1>
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

      <div className="mb-5 flex flex-wrap gap-2 border-b border-[#ded4c1] pb-3" role="tablist" aria-label="Documentation stage">
        <button type="button" role="tab" aria-selected={tab === 'stage1'} onClick={() => setTab('stage1')} className={`min-h-11 rounded-md px-4 text-sm font-semibold ${tab === 'stage1' ? 'bg-brand-700 text-white' : 'border border-ink-200 bg-white text-ink-700'}`}><ShieldCheck size={15} /> Stage 1 · Authority verification</button>
        <button type="button" role="tab" aria-selected={tab === 'stage2'} onClick={() => setTab('stage2')} className={`min-h-11 rounded-md px-4 text-sm font-semibold ${tab === 'stage2' ? 'bg-brand-700 text-white' : 'border border-ink-200 bg-white text-ink-700'}`}><ImageIcon size={15} /> Stage 2 · Admin publication</button>
      </div>

      {tab === 'stage1' && <AdminStage1Documentation
        controls={controls}
        stage1Docs={stage1Docs}
        stage1Revisions={stage1Revisions}
        officers={officers}
        reviewerBusy={reviewerBusy}
        onAssignReviewer={handleAssignReviewer}
        redactions={redactions}
        redactionBusy={redactionBusy}
        editingRedaction={editingRedaction}
        maskDraft={maskDraft}
        reviewedPages={reviewedPages}
        onGenerate={handleGenerateStage1}
        onOpenEditor={openRedactionEditor}
        onSave={saveRedaction}
        onPublish={handlePublishStage1}
        onCancelEditor={() => setEditingRedaction(null)}
        onMasksChange={setMaskDraft}
        onReviewedPagesChange={setReviewedPages}
      />}

      {tab === 'stage2' && !generated && (
        <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          The control list hasn't been generated yet. Use <Link to={`/admin/applications/${eventId}/controls`} className="font-semibold underline">Open event control list</Link> to generate + commit the list first, then come back here.
        </div>
      )}

      {tab === 'stage2' && generated && totalStage2 === 0 && (
        <div className="card">
          <div className="card-body">
            <p className="text-sm text-ink-500">This event's control list has no Stage 2 requirements. Nothing to review.</p>
          </div>
        </div>
      )}

      {tab === 'stage2' && generated && totalStage2 > 0 && (
        <div className="space-y-4" data-testid="admin-stage2-review-list">
          {reviewable.map((ctrl) => {
            const doc = stage2Docs[ctrl.controlId] ?? null;
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

interface AdminStage1DocumentationProps {
  controls: EventControl[];
  stage1Docs: Record<string, Stage1Doc | null>;
  stage1Revisions: Record<string, Stage1DocRevision[]>;
  officers: OfficerProfile[];
  reviewerBusy: string | null;
  onAssignReviewer: (control: EventControl, reviewerUid: string) => void;
  redactions: Record<string, Stage1RedactionDraft | null>;
  redactionBusy: string | null;
  editingRedaction: string | null;
  maskDraft: Stage1RedactionMask[];
  reviewedPages: number[];
  onGenerate: (control: EventControl, stage1Doc: Stage1Doc, regenerate?: boolean) => void;
  onOpenEditor: (control: EventControl, stage1Doc: Stage1Doc) => void;
  onSave: (control: EventControl, stage1Doc: Stage1Doc) => void;
  onPublish: (control: EventControl, stage1Doc: Stage1Doc, publish: boolean) => void;
  onCancelEditor: () => void;
  onMasksChange: (masks: Stage1RedactionMask[]) => void;
  onReviewedPagesChange: (pages: number[]) => void;
}

function AdminStage1Documentation(props: AdminStage1DocumentationProps) {
  const { controls, stage1Docs, stage1Revisions, officers, reviewerBusy, onAssignReviewer, redactions, redactionBusy, editingRedaction, maskDraft, reviewedPages, onGenerate, onOpenEditor, onSave, onPublish, onCancelEditor, onMasksChange, onReviewedPagesChange } = props;
  return (
    <div className="space-y-4" data-testid="admin-stage1-documentation">
      <div className="rounded-md border border-brand-200 bg-brand-50/60 p-4 text-sm leading-6 text-brand-900">
        Authority-verified Stage 1 documents are private until an Admin generates and reviews an irreversible black-box copy. Stage 2 images remain in the separate Admin publication tab.
      </div>
      {controls.length === 0 ? <div className="card"><div className="card-body text-sm text-ink-500">No current control list is available for this application.</div></div> : controls.map((control) => {
        const documents = control.stage1Requirements.map((requirement) => {
          const docId = `${control.controlId}-s1-${requirement.docType}`;
          return { requirement, doc: stage1Docs[`${control.controlId}__${docId}`] ?? null, key: `${control.controlId}__${docId}` };
        });
        return <section key={control.controlId} className="card" data-testid={`admin-stage1-card-${control.authority}`}>
          <div className="card-header flex-wrap gap-3">
            <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-brand-700" /><h2 className="font-semibold">{control.controlName}</h2></div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge bg-blue-100 text-brand-700">{control.authority}</span>
              <label className="flex items-center gap-1 text-xs font-medium text-ink-600">
                Stage 1 reviewer
                <select className="input !min-h-9 !w-auto !py-1 text-xs" value={control.stage1ReviewerUid ?? ''} onChange={(event) => { if (event.target.value) onAssignReviewer(control, event.target.value); }} disabled={reviewerBusy === control.controlId}>
                  <option value="">Default final-review officer</option>
                  {officers.filter((officer) => officer.authorityType === control.authority).map((officer) => <option key={officer.uid} value={officer.uid}>{officer.uid}</option>)}
                </select>
              </label>
            </div>
          </div>
          <div className="card-body space-y-3">
            {documents.length === 0 ? <p className="text-sm text-ink-500">No Stage 1 files required.</p> : documents.map(({ requirement, doc: stage1Doc, key }) => {
              const draft = redactions[key];
              const revisions = stage1Revisions[key] ?? [];
              const editing = editingRedaction === key && Boolean(draft);
              const isBusy = redactionBusy?.includes(key) ?? false;
              return <article key={key} className="rounded-md border border-ink-200 bg-white p-4" data-testid={`admin-stage1-doc-${requirement.docType}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><span className="badge bg-ink-100 text-ink-700">{requirement.docType}</span><h3 className="text-sm font-semibold text-ink-800">{requirement.label}</h3></div>
                    <p className="mt-1 text-xs text-ink-500">{stage1Doc?.status === 'verified' ? `Verified ${stage1Doc.verifiedAt ? new Date(stage1Doc.verifiedAt).toLocaleString() : ''}` : stage1Doc?.status ?? 'Awaiting organizer submission'}</p>
                  </div>
                  <span className={`badge ${stage1Doc?.status === 'verified' ? 'bg-green-100 text-status-approved' : stage1Doc?.status === 'rejected' ? 'bg-red-100 text-status-rejected' : 'bg-ink-100 text-ink-600'}`}>{stage1Doc?.status === 'verified' ? 'Authority verified' : stage1Doc?.status === 'rejected' ? 'Rejected' : 'Not ready'}</span>
                </div>
                {!stage1Doc ? <p className="mt-3 text-sm text-ink-500">Organizer has not submitted this requirement.</p> : <>
                  {stage1Doc.filePath && <a href={stage1Doc.filePath} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-brand-700 hover:underline"><FileText size={15} /> View private source</a>}
                  {stage1Doc.usePreviousDeclaration && <p className="mt-3 rounded-md bg-blue-50 p-3 text-xs text-brand-800">Organizer submitted a Use Previous declaration. No file is available to publish.</p>}
                  {revisions.length > 0 && <details className="mt-3 rounded-md border border-ink-200 bg-ink-50/40 p-3 text-xs"><summary className="cursor-pointer font-semibold text-ink-700">Revision history ({revisions.length})</summary><ol className="mt-2 space-y-2 border-t border-ink-100 pt-2">{revisions.map((revision) => <li key={revision.revisionId} className="flex flex-wrap items-center justify-between gap-2"><span>Revision {revision.revision} · {revision.status}</span><span className="text-ink-500">{revision.submittedAt ? new Date(revision.submittedAt).toLocaleString() : '—'}</span>{revision.rejectionReason && <span className="w-full whitespace-pre-line text-status-rejected">{revision.rejectionReason}</span>}</li>)}</ol></details>}
                  {stage1Doc.status === 'verified' && <div className="mt-3 flex flex-wrap items-center gap-2">
                    {!draft && stage1Doc.filePath && <button type="button" className="btn-secondary !min-h-9 !px-3 !py-1.5 text-xs" onClick={() => onGenerate(control, stage1Doc)} disabled={isBusy}><ShieldCheck size={14} /> {isBusy ? 'Generating…' : 'Generate redacted copy'}</button>}
                    {draft && <span className={`badge ${draft.status === 'published' ? 'bg-green-100 text-status-approved' : draft.status === 'manual_required' ? 'bg-gold-100 text-gold-700' : 'bg-blue-100 text-brand-700'}`}>{draft.status === 'manual_required' ? 'Manual review required' : draft.status}</span>}
                    {draft && draft.status !== 'published' && <button type="button" className="btn-secondary !min-h-9 !px-3 !py-1.5 text-xs" onClick={() => onOpenEditor(control, stage1Doc)}><Pencil size={14} /> Edit redaction</button>}
                    {stage1Doc.usePreviousDeclaration && !draft?.status && <button type="button" className="btn-success !min-h-9 !px-3 !py-1.5 text-xs" onClick={() => onPublish(control, stage1Doc, true)} disabled={isBusy}>Publish verified declaration</button>}
                    {draft?.status === 'ready' && <button type="button" className="btn-success !min-h-9 !px-3 !py-1.5 text-xs" onClick={() => onPublish(control, stage1Doc, true)} disabled={isBusy}>Publish to public</button>}
                    {draft?.status === 'published' && <button type="button" className="btn-secondary !min-h-9 !px-3 !py-1.5 text-xs" onClick={() => onPublish(control, stage1Doc, false)} disabled={isBusy}>Unpublish</button>}
                  </div>}
                  {draft?.status === 'manual_required' && <p className="mt-2 text-xs leading-5 text-gold-700">{draft.aiFailureReason ?? 'AI redaction was unavailable.'} Add black boxes manually and review every page before saving.</p>}
                  {draft?.status === 'published' && draft.redactedFilePath && <a href={draft.redactedFilePath} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-2 text-xs font-semibold text-brand-700 hover:underline"><Download size={13} /> View published redacted copy</a>}
                  {editing && draft && <div className="mt-4 rounded-md border border-brand-200 bg-brand-50/40 p-3" data-testid="stage1-redaction-editor">
                    <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold text-ink-800">Manual black-box review</h4><button type="button" className="text-xs font-semibold text-ink-600" onClick={onCancelEditor}>Cancel</button></div>
                    <div className="mt-3 space-y-2">{maskDraft.map((mask, index) => <div key={`${mask.page}-${index}`} className="grid gap-2 sm:grid-cols-6"><input aria-label={`Mask ${index + 1} page`} className="input" type="number" min={1} value={mask.page} onChange={(event) => onMasksChange(maskDraft.map((item, itemIndex) => itemIndex === index ? { ...item, page: Math.max(1, Number(event.target.value) || 1) } : item))} /><input aria-label={`Mask ${index + 1} x`} className="input" type="number" min={0} max={1} step={0.01} value={mask.x} onChange={(event) => onMasksChange(maskDraft.map((item, itemIndex) => itemIndex === index ? { ...item, x: Number(event.target.value) || 0 } : item))} /><input aria-label={`Mask ${index + 1} y`} className="input" type="number" min={0} max={1} step={0.01} value={mask.y} onChange={(event) => onMasksChange(maskDraft.map((item, itemIndex) => itemIndex === index ? { ...item, y: Number(event.target.value) || 0 } : item))} /><input aria-label={`Mask ${index + 1} width`} className="input" type="number" min={0.01} max={1} step={0.01} value={mask.width} onChange={(event) => onMasksChange(maskDraft.map((item, itemIndex) => itemIndex === index ? { ...item, width: Number(event.target.value) || 0.01 } : item))} /><input aria-label={`Mask ${index + 1} height`} className="input" type="number" min={0.01} max={1} step={0.01} value={mask.height} onChange={(event) => onMasksChange(maskDraft.map((item, itemIndex) => itemIndex === index ? { ...item, height: Number(event.target.value) || 0.01 } : item))} /><button type="button" className="btn-secondary !min-h-9 !px-2 text-xs" onClick={() => onMasksChange(maskDraft.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></div>)}</div>
                    <button type="button" className="btn-secondary mt-3 !min-h-9 !px-3 !py-1.5 text-xs" onClick={() => onMasksChange([...maskDraft, { page: 1, x: 0, y: 0, width: 0.2, height: 0.1, category: 'other', source: 'admin' }])}>Add black box</button>
                    <div className="mt-3 flex flex-wrap gap-2">{Array.from({ length: Math.max(1, draft.pageCount) }, (_, pageIndex) => pageIndex + 1).map((page) => <label key={page} className="inline-flex items-center gap-1 text-xs"><input type="checkbox" checked={reviewedPages.includes(page)} onChange={(event) => onReviewedPagesChange(event.target.checked ? [...new Set([...reviewedPages, page])] : reviewedPages.filter((value) => value !== page))} /> Page {page} reviewed</label>)}</div>
                    <button type="button" className="btn-primary mt-3" onClick={() => onSave(control, stage1Doc)} disabled={redactionBusy === `stage1-save:${key}`}>{redactionBusy === `stage1-save:${key}` ? 'Saving…' : 'Save redaction review'}</button>
                  </div>}
                </>}
              </article>;
  })}
          </div>
        </section>;
      })}
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

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; details?: unknown };
    if (typeof value.details === 'string' && value.details.trim()) return value.details;
    if (typeof value.message === 'string' && value.message.trim()) return value.message;
  }
  return 'The documentation action could not be completed.';
}
