/**
 * PublicEventDetail — M3 Workstream 4 public viewer.
 *
 *   Shows the approved event + its per-authority Stage 2 images
 *   (visual evidence of items at the venue). Any signed-in user
 *   can 👍 confirm or 🚩 report a Stage 2 image.
 *
 *   The data lives in:
 *     - public_events/{eventId}                     (the event metadata)
 *     - events/{id}/event_controls (per-authority container)
 *     - events/{id}/event_controls/{controlId}/stage2_docs (the published images)
 *     - events/{id}/event_controls/{controlId}/stage2_confirms/{uid}
 *     - events/{id}/event_controls/{controlId}/stage2_reports/{uid}
 *
 *   The Stage 2 cards show "X confirms" + the per-user state ("You
 *   confirmed" / "You reported"). Anonymous users can see the
 *   images + counts but not the buttons.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { collection, doc as firestoreDoc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  Flag,
  Image as ImageIcon,
  MapPin,
  ShieldCheck,
  ThumbsUp,
} from 'lucide-react';
import {
  COLLECTIONS,
  PublicEventControl,
  PublicEvent,
  Stage2Doc,
} from '@shared/types';
import { auth, db, functions, isFirebaseConfigured } from '../../config/firebase';
import PublicHeader from '../../components/layout/PublicHeader';
import EmptyState from '../../components/ui/EmptyState';
import { findPublicEventById } from '../../mock_data/public_events';

export default function PublicEventDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [controls, setControls] = useState<PublicEventControl[]>([]);
  const [stage2Docs, setStage2Docs] = useState<Record<string, Stage2Doc | null>>({});
  const [currentUid, setCurrentUid] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  // Watch the current auth user.
  useEffect(() => {
    if (!isFirebaseConfigured) return;
    return onAuthStateChanged(auth, (u) => setCurrentUid(u?.uid ?? null));
  }, []);

  useEffect(() => {
    if (!eventId) {
      setLoading(false);
      return;
    }
    if (!isFirebaseConfigured) {
      setEvent(findPublicEventById(eventId) ?? null);
      setError('');
      setLoading(false);
      return;
    }
    return onSnapshot(firestoreDoc(db, COLLECTIONS.PUBLIC_EVENTS, eventId), (snapshot) => {
      setEvent(snapshot.exists() ? snapshot.data() as PublicEvent : null);
      setError('');
      setLoading(false);
    }, () => {
      setError('The approved event could not be loaded.');
      setLoading(false);
    });
  }, [eventId, retryKey]);

  // Subscribe only to the server-written sanitised projection. Public
  // viewers never read organiser evidence or private event_controls.
  useEffect(() => {
    if (!isFirebaseConfigured || !eventId) return;
    return onSnapshot(collection(db, COLLECTIONS.PUBLIC_EVENT_CONTROLS, eventId, COLLECTIONS.PUBLIC_EVENT_CONTROL_ITEMS), (snapshot) => {
      const list = snapshot.docs.map((d) => ({ publicControlId: d.id, ...(d.data() as Partial<PublicEventControl>) }) as PublicEventControl);
      list.sort((a, b) => a.authority.localeCompare(b.authority));
      setControls(list);
      const next: Record<string, Stage2Doc | null> = {};
      for (const item of list) {
        next[item.docId] = {
          docId: item.docId,
          imageUrl: item.imageUrl,
          uploadedAt: item.publishedAt,
          uploadedBy: item.sanitizedBy,
          publicConfirmCount: item.publicConfirmCount ?? 0,
          published: true,
          publishedAt: item.publishedAt,
          publishedBy: item.sanitizedBy,
          ...(item.reported ? { m4TicketId: 'public-report' } : {}),
        };
      }
      setStage2Docs(next);
    }, (err) => {
      console.warn('[PublicEventDetail] sanitised public controls subscribe failed', err);
    });
  }, [eventId]);

  function showToast(kind: 'success' | 'error', message: string) {
    setToast({ kind, message });
    setTimeout(() => setToast(null), 4000);
  }

  if (loading) return <div className="min-h-screen bg-[#f4eddf]"><PublicHeader /><main className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12"><div className="py-24 text-center text-[#6b6555]">Loading approved event...</div></main></div>;
  if (error) return <div className="min-h-screen bg-[#f4eddf]"><PublicHeader /><main className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12"><div className="py-10"><EmptyState title="Event unavailable" description={error}><button type="button" className="btn-secondary" onClick={() => { setLoading(true); setRetryKey((value) => value + 1); }}>Try again</button></EmptyState></div></main></div>;
  if (!event) return <div className="min-h-screen bg-[#f4eddf]"><PublicHeader /><main className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12"><div className="py-10"><EmptyState title="Event not publicly listed" description="The event may not be approved, or its public listing has been removed." /><div className="mt-5 text-center"><Link to="/calendar" className="text-sm font-semibold text-[#52651c]">Back to approved events</Link></div></div></main></div>;

  return <EventContent event={event} controls={controls} stage2Docs={stage2Docs} currentUid={currentUid} showToast={showToast} eventId={eventId!} toast={toast} />;
}

interface EventContentProps {
  event: PublicEvent;
  controls: PublicEventControl[];
  stage2Docs: Record<string, Stage2Doc | null>;
  currentUid: string | null;
  eventId: string;
  toast: { kind: 'success' | 'error'; message: string } | null;
  showToast: (kind: 'success' | 'error', message: string) => void;
}

function EventContent({ event, controls, stage2Docs, currentUid, eventId, toast, showToast }: EventContentProps) {
  // Workstream 5: only show controls where the admin has actually
  // published the Stage 2 doc. Pending + rejected images stay hidden
  // from the public view (per FR-M3-21 / UC-14). The Firestore rule
  // is the authoritative gate; this filter is the application-side
  // mirror that keeps the UI consistent.
  const visibleControls = useMemo(
    () => controls.filter((c) => {
      const d = stage2Docs[`${c.controlId}-s2`];
      return !!d && d.published === true;
    }),
    [controls, stage2Docs],
  );
  const [reportingControl, setReportingControl] = useState<PublicEventControl | null>(null);

  return (
    <div className="min-h-screen bg-[#f4eddf]">
      <PublicHeader />
      <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
        <Link to="/calendar" className="inline-flex items-center gap-1 text-sm font-semibold text-[#52651c] hover:text-[#384611]"><ChevronLeft size={16} />Approved events</Link>
        <div className="mt-8 border-b border-[#d9cdb8] pb-8">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge bg-[#f5ead0] text-[#7e5b13]">{event.eventType}</span>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#46743b]"><ShieldCheck size={15} />Authority approved</span>
          </div>
          <h1 className="mt-4 max-w-4xl font-display text-3xl font-bold text-[#20251d] sm:text-5xl">{event.eventName}</h1>
        </div>

        <div className="grid gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-14">
          <section aria-labelledby="event-schedule">
            <h2 id="event-schedule" className="font-display text-lg font-bold text-[#303528]">Event information</h2>
            <dl className="mt-5 divide-y divide-[#ded4c1] border-y border-[#ded4c1]">
              <Detail icon={<CalendarDays size={18} />} label="Date" value={formatLongDate(event.startDatetime)} />
              <Detail icon={<Clock3 size={18} />} label="Time" value={`${formatTime(event.startDatetime)} – ${formatTime(event.endDatetime)}`} />
              <Detail icon={<MapPin size={18} />} label="Venue" value={event.venueName} />
            </dl>
            <p className="mt-5 max-w-2xl text-sm leading-6 text-[#6b6555]">This public listing contains only non-sensitive information from the approved application version.</p>

            {/* Verified controls (Workstream 4 — Stage 2 images + confirm/report). */}
            <div className="mt-10">
              <h2 className="font-display text-lg font-bold text-[#303528]">Verified controls</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[#6b6555]">
                Visual evidence submitted by the organiser for each required authority. Anyone with a STERAS account can 👍 confirm or 🚩 report.
              </p>
              {toast && (
                <div className={`mt-3 rounded-md px-3 py-2 text-sm ${toast.kind === 'success' ? 'bg-status-approved/10 text-status-approved' : 'bg-red-50 text-red-800'}`} role="status" data-testid="public-toast">
                  {toast.message}
                </div>
              )}
              {visibleControls.length === 0 ? (
                <div className="mt-4 rounded-lg border border-[#ded4c1] bg-[#fffdf7] p-5 text-sm text-[#6b6555]" data-testid="public-stage2-empty">
                  The organiser hasn't published any Stage 2 images yet. Check back closer to the event date.
                </div>
              ) : (
                <div className="mt-4 space-y-4" data-testid="public-stage2-list">
                  {visibleControls.map((ctrl) => {
                    const doc = stage2Docs[`${ctrl.controlId}-s2`]!;
                    return (
                      <ControlCard
                        key={ctrl.controlId}
                        ctrl={ctrl}
                        doc={doc}
                        currentUid={currentUid}
                        eventId={eventId}
                        onStartReport={() => setReportingControl(ctrl)}
                        showToast={showToast}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <aside className="rounded-lg border border-[#ccd8aa] bg-[#edf2dc] p-5">
            <ShieldCheck className="text-[#52651c]" size={24} />
            <h2 className="mt-4 font-display text-base font-bold text-[#303b1a]">Approval confirmed</h2>
            <p className="mt-2 text-sm leading-6 text-[#59643a]">Version {event.versionId.replace(/^v/, '')} completed review by every required authority.</p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {event.approvedBy.map((authority) => <li key={authority} className="badge bg-[#fffdf7] text-[#52651c]">{authority}</li>)}
            </ul>
          </aside>
        </div>

        {reportingControl && currentUid && (
          <ReportModal
            ctrl={reportingControl}
            eventId={eventId}
            onClose={() => setReportingControl(null)}
            onSubmitted={(msg) => { setReportingControl(null); showToast('success', msg); }}
            onError={(msg) => showToast('error', msg)}
          />
        )}
      </main>
    </div>
  );
}

interface ControlCardProps {
  ctrl: PublicEventControl;
  doc: Stage2Doc;
  currentUid: string | null;
  eventId: string;
  onStartReport: () => void;
  showToast: (kind: 'success' | 'error', message: string) => void;
}

function ControlCard({ ctrl, doc: stage2Doc, currentUid, eventId, onStartReport, showToast }: ControlCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [iConfirmed, setIConfirmed] = useState(false);
  const [confirmCount, setConfirmCount] = useState(stage2Doc.publicConfirmCount ?? 0);
  const reported = !!stage2Doc.m4TicketId;

  // Watch the per-user confirm counter so the button reflects state.
  useEffect(() => {
    if (!currentUid) {
      setIConfirmed(false);
      return;
    }
    const ref = firestoreDoc(db, COLLECTIONS.EVENTS, eventId, COLLECTIONS.EVENT_CONTROLS, ctrl.controlId, COLLECTIONS.STAGE2_CONFIRMS, currentUid);
    return onSnapshot(ref, (snap) => setIConfirmed(snap.exists()), () => setIConfirmed(false));
  }, [ctrl.controlId, currentUid, eventId]);

  // Watch the per-user report counter so we can disable the report button.
  const [iReported, setIReported] = useState(false);
  useEffect(() => {
    if (!currentUid) {
      setIReported(false);
      return;
    }
    const ref = firestoreDoc(db, COLLECTIONS.EVENTS, eventId, COLLECTIONS.EVENT_CONTROLS, ctrl.controlId, COLLECTIONS.STAGE2_REPORTS, currentUid);
    return onSnapshot(ref, (snap) => setIReported(snap.exists()), () => setIReported(false));
  }, [ctrl.controlId, currentUid, eventId]);

  // Keep confirmCount in sync with the doc snapshot.
  useEffect(() => {
    setConfirmCount(stage2Doc.publicConfirmCount ?? 0);
  }, [stage2Doc.publicConfirmCount]);

  async function handleConfirm() {
    if (!currentUid) return;
    setConfirming(true);
    try {
      const fn = httpsCallable<{ eventId: string; controlId: string }, { alreadyConfirmed: boolean; publicConfirmCount: number }>(functions, 'confirmStage2Doc');
      const result = await fn({ eventId, controlId: ctrl.controlId });
      setIConfirmed(true);
      setConfirmCount(result.data.publicConfirmCount);
      if (result.data.alreadyConfirmed) {
        showToast('success', 'You already confirmed this image.');
      } else {
        showToast('success', 'Thanks for confirming.');
      }
    } catch (err) {
      const msg = errMessage(err);
      showToast('error', msg);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <article className="rounded-lg border border-[#ded4c1] bg-[#fffdf7] p-4" data-testid={`public-stage2-card-${ctrl.authority}`}>
      <header className="flex flex-wrap items-center gap-2">
        <span className="badge bg-blue-100 text-brand-700 text-xs">{ctrl.authority}</span>
        <h3 className="font-semibold text-[#20251d]">{ctrl.controlName}</h3>
        {reported && (
          <span className="badge bg-red-100 text-red-700 text-xs" data-testid={`public-stage2-reported-badge-${ctrl.authority}`}>
            <AlertTriangle size={11} className="mr-0.5 inline" /> Reported to M4
          </span>
        )}
        <span className="ml-auto text-xs text-[#6b6555]" data-testid={`public-stage2-confirm-count-${ctrl.authority}`}>
          <ThumbsUp size={12} className="mr-0.5 inline" /> {confirmCount} confirm{confirmCount === 1 ? '' : 's'}
        </span>
      </header>
      {stage2Doc.imageUrl && (
        <a href={stage2Doc.imageUrl} target="_blank" rel="noreferrer" className="mt-3 block">
          <img
            src={stage2Doc.imageUrl}
            alt={`${ctrl.authority} Stage 2 image`}
            className="max-h-80 w-full rounded-md border border-[#ded4c1] object-contain"
            data-testid={`public-stage2-image-${ctrl.authority}`}
          />
        </a>
      )}
      <p className="mt-2 text-xs text-[#7a8063]">
        <ImageIcon size={12} className="mr-0.5 inline" /> {ctrl.stage2Label || 'Visual evidence'}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!currentUid ? (
          <span className="text-xs text-[#6b6555]">Sign in to confirm or report this image.</span>
        ) : (
          <>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirming || iConfirmed}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-status-approved px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              data-testid={`public-stage2-confirm-${ctrl.authority}`}
            >
              {iConfirmed ? <><CheckCircle2 size={14} /> You confirmed</> : <><ThumbsUp size={14} /> {confirming ? 'Confirming…' : 'I confirm'}</>}
            </button>
            <button
              type="button"
              onClick={onStartReport}
              disabled={iReported}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              data-testid={`public-stage2-report-${ctrl.authority}`}
            >
              <Flag size={14} />
              {iReported ? 'You reported' : 'Report'}
            </button>
          </>
        )}
      </div>
    </article>
  );
}

interface ReportModalProps {
  ctrl: PublicEventControl;
  eventId: string;
  onClose: () => void;
  onSubmitted: (message: string) => void;
  onError: (message: string) => void;
}

function ReportModal({ ctrl, eventId, onClose, onSubmitted, onError }: ReportModalProps) {
  const [category, setCategory] = useState<'item_not_at_venue' | 'wrong_venue' | 'low_quality_image' | 'other'>('item_not_at_venue');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (description.trim().length < 20) {
      onError('Please describe the issue in at least 20 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const fn = httpsCallable<{ eventId: string; controlId: string; category: string; description: string }, { ticketId: string; alreadyReported: boolean }>(functions, 'reportStage2Doc');
      const result = await fn({ eventId, controlId: ctrl.controlId, category, description: description.trim() });
      if (result.data.alreadyReported) {
        onSubmitted('You already reported this image. The previous report is still open with M4.');
      } else {
        onSubmitted('Report submitted. M4 will investigate.');
      }
    } catch (err) {
      onError(errMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-modal-title"
      data-testid="report-modal"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
        <h3 id="report-modal-title" className="font-display text-lg font-bold text-[#20251d]">Report {ctrl.authority} image</h3>
        <p className="mt-1 text-sm text-[#6b6555]">Tell us what's wrong. M4 will review and either confirm or dismiss the report.</p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <label className="block">
            <span className="text-sm font-semibold text-[#303528]">Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as typeof category)}
              className="mt-1 w-full rounded-md border border-[#ded4c1] bg-[#fffdf7] px-3 py-2 text-sm"
              data-testid="report-category"
            >
              <option value="item_not_at_venue">Item not at venue</option>
              <option value="wrong_venue">Wrong venue</option>
              <option value="low_quality_image">Image too low quality</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-[#303528]">Description (20–500 chars)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={4}
              className="mt-1 w-full rounded-md border border-[#ded4c1] bg-[#fffdf7] px-3 py-2 text-sm"
              data-testid="report-description"
              required
            />
            <span className="mt-1 block text-xs text-[#7a8063]">{description.length} / 500</span>
          </label>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[#ded4c1] bg-white px-3 py-1.5 text-sm font-medium text-[#303528] hover:bg-[#f4eddf]"
              data-testid="report-cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              data-testid="report-submit"
            >
              {submitting ? 'Submitting…' : 'Submit report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="grid grid-cols-[1.5rem_5rem_minmax(0,1fr)] gap-3 py-4 text-sm"><span className="text-[#7a8063]">{icon}</span><dt className="font-semibold text-[#6b6555]">{label}</dt><dd className="font-medium text-[#2b3027]">{value}</dd></div>;
}

function errMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const e = err as { code?: string; message?: string; details?: unknown };
    return e.message ?? (e.details ? String(e.details) : 'Operation failed.');
  }
  return String(err);
}

/**
 * Date formatting helpers. We previously used `date-fns` but its ESM
 * `exports` map caused a runtime `t is not a function` error under
 * Vite/Rolldown in the deployed bundle — the public EventDetail page
 * would render to a blank `<div id="root" />`. Native `Intl` gives us
 * the same look with zero dependencies.
 */
function formatLongDate(ts: number): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(ts));
}

function formatTime(ts: number): string {
  return new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ts));
}
