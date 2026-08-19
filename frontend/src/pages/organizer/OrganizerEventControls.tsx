/**
 * OrganizerEventControls — M3 Workstream 2 + Workstream 3 organizer page.
 *
 * Workstream 2: read-only view of the per-authority event control list
 * (UC-34: "Display Stage 1 and Stage 2 Requirements").
 *
 * Workstream 3: the organizer can now upload Stage 1 documents
 * (UC-28) and use the "Use Previous" shortcut on receipt slots
 * (UC-29). Each Stage 1 requirement row shows the current status
 * (pending_submission | pending_verification | verified | rejected |
 * use_previous) and the appropriate action buttons.
 *
 * No Stage 2 upload yet — that's Workstream 4.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { ClipboardList, Info } from 'lucide-react';
import {
  COLLECTIONS,
  EventControl,
  EventRecord,
  Stage1Doc,
  Stage2Doc,
} from '@shared/types';
import { db } from '../../config/firebase';
import EmptyState from '../../components/ui/EmptyState';
import StatusBadge from '../../components/ui/StatusBadge';
import Stage1RequirementRow from '../../components/stage1/Stage1RequirementRow';
import Stage2RequirementRow from '../../components/stage2/Stage2RequirementRow';

type Toast = { kind: 'success' | 'error'; message: string };

export default function OrganizerEventControls() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [controls, setControls] = useState<EventControl[]>([]);
  const [docs, setDocs] = useState<Record<string, Stage1Doc | null>>({});
  const [stage2Docs, setStage2Docs] = useState<Record<string, Stage2Doc | null>>({});
  const [toast, setToast] = useState<Toast | null>(null);

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
      console.warn('[OrganizerEventControls] event subscribe failed', err);
      setLoadError('The event could not be loaded.');
      setLoading(false);
    });
  }, [eventId]);

  // Subscribe to the per-event event_controls sub-collection. The current
  // version's controls only (Q1 refactor: control docs are versioned).
  const versionId = event?.currentVersionId ?? 'v1';
  useEffect(() => {
    if (!eventId) return;
    const q = query(
      collection(db, COLLECTIONS.EVENTS, eventId, COLLECTIONS.EVENT_CONTROLS),
      where('versionId', '==', versionId),
    );
    return onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((d) => ({ controlId: d.id, ...(d.data() as Partial<EventControl>) }) as EventControl);
      // Sort by authority for a stable order.
      list.sort((a, b) => a.authority.localeCompare(b.authority));
      setControls(list);
    }, (err) => {
      console.warn('[OrganizerEventControls] controls subscribe failed', err);
    });
  }, [eventId, versionId]);

  // Stable key based on the control IDs, so the effect only re-runs when
  // the set of controls changes (not on every re-render where the
  // `controls` array gets a new reference). The old version depended
  // on `[eventId, controls]` which caused the per-control subscriptions
  // to be torn down and re-created on every snapshot, and on metadata
  // re-fires — the race left the stage2_docs subscription torn down
  // before it could deliver the doc, so the organizer page rendered
  // `data-status='pending'` even after a successful upload.
  const controlsKey = useMemo(() => controls.map((c) => c.controlId).join('|'), [controls]);

  // Subscribe to all stage1_docs across the per-control sub-collections.
  // The onSnapshot fan-out is small (5 controls × 3 docs each in the test
  // fixture; 25 docs total worst case). If this gets bigger we'll switch
  // to a collectionGroup query.
  useEffect(() => {
    if (!eventId || controls.length === 0) {
      setDocs({});
      setStage2Docs({});
      return;
    }
    const unsubscribes: Array<() => void> = [];
    for (const ctrl of controls) {
      const unsub1 = onSnapshot(
        collection(db, COLLECTIONS.EVENTS, eventId, COLLECTIONS.EVENT_CONTROLS, ctrl.controlId, COLLECTIONS.STAGE1_DOCS),
        (snapshot) => {
          setDocs((prev) => {
            const next: Record<string, Stage1Doc | null> = { ...prev };
            for (const d of snapshot.docs) {
              next[d.id] = d.data() as Stage1Doc;
            }
            return next;
          });
        },
        (err) => {
          console.warn(`[OrganizerEventControls] stage1_docs subscribe failed for ${ctrl.controlId}`, err);
        },
      );
      const unsub2 = onSnapshot(
        collection(db, COLLECTIONS.EVENTS, eventId, COLLECTIONS.EVENT_CONTROLS, ctrl.controlId, COLLECTIONS.STAGE2_DOCS),
        (snapshot) => {
          setStage2Docs((prev) => {
            const next: Record<string, Stage2Doc | null> = { ...prev };
            for (const d of snapshot.docs) {
              next[d.id] = d.data() as Stage2Doc;
            }
            return next;
          });
        },
        (err) => {
          console.warn(`[OrganizerEventControls] stage2_docs subscribe failed for ${ctrl.controlId}`, err);
        },
      );
      unsubscribes.push(unsub1, unsub2);
    }
    return () => { for (const u of unsubscribes) u(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, controlsKey]);

  // Aggregate stats across all controls.
  const stats = useMemo(() => {
    let required = 0;
    let verified = 0;
    let rejected = 0;
    let pendingVerification = 0;
    let pendingSubmission = 0;
    let usePrevious = 0;
    for (const ctrl of controls) {
      for (const req of ctrl.stage1Requirements) {
        if (!req.required) continue;
        required += 1;
        const docId = `${ctrl.controlId}-s1-${req.docType}`;
        const status = docs[docId]?.status ?? 'pending_submission';
        if (status === 'verified') verified += 1;
        else if (status === 'rejected') rejected += 1;
        else if (status === 'pending_verification') pendingVerification += 1;
        else if (status === 'use_previous') usePrevious += 1;
        else pendingSubmission += 1;
      }
    }
    return { required, verified, rejected, pendingVerification, pendingSubmission, usePrevious };
  }, [controls, docs]);

  if (loading) return <div className="p-8 text-ink-500">Loading event...</div>;
  if (loadError) return <div className="p-8"><EmptyState title="Event unavailable" description={loadError} /></div>;
  if (!event) return <div className="p-8"><EmptyState title="Event not found" /></div>;

  const details = event.eventDetails;
  const generated = event.controlListGenerated === true;

  function showToast(kind: Toast['kind'], message: string) {
    setToast({ kind, message });
    setTimeout(() => setToast(null), 4000);
  }

  return (
    <div className="p-5 sm:p-8">
      <Link to={`/organizer/events/${eventId}`} className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">
        ← Back to event
      </Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-800">Event controls</h1>
          <p className="mt-1 text-sm text-ink-500">{details.name} · {details.venueName}</p>
          <p className="mt-1 text-xs text-ink-400">
            {controls.length} control{controls.length === 1 ? '' : 's'} declared
            {generated && stats.required > 0 && (
              <>
                {' · '}
                <span className="font-medium text-status-approved">{stats.verified + stats.usePrevious}</span> of {stats.required} required Stage 1 doc{stats.required === 1 ? '' : 's'} done
                {stats.rejected > 0 && <> · <span className="font-medium text-red-600">{stats.rejected} rejected</span></>}
                {stats.pendingVerification > 0 && <> · <span className="font-medium text-amber-600">{stats.pendingVerification} awaiting review</span></>}
                {stats.pendingSubmission > 0 && <> · <span className="font-medium text-ink-600">{stats.pendingSubmission} to upload</span></>}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge status={event.status} />
          {generated && <span className="text-xs font-semibold text-status-approved">List published</span>}
        </div>
      </div>

      {toast && (
        <div
          className={`mb-4 rounded-md px-3 py-2 text-sm ${toast.kind === 'success' ? 'bg-status-approved/10 text-status-approved' : 'bg-red-50 text-red-800'}`}
          role="status"
          data-testid="organizer-toast"
        >
          {toast.message}
        </div>
      )}

      {!generated ? (
        <div className="card">
          <div className="card-body space-y-3">
            <div className="flex items-start gap-2 text-ink-700">
              <Info size={18} className="mt-0.5 text-ink-500" />
              <div>
                <p className="font-semibold">The admin hasn't published the control list yet.</p>
                <p className="mt-1 text-sm text-ink-600">
                  Once the admin generates + commits the per-authority control list, you'll see the Stage 1 + Stage 2 evidence requirements here and can start uploading.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4" data-testid="organizer-event-controls-list">
          {controls.map((ctrl) => {
            const controlDocs = ctrl.stage1Requirements.map((req) => {
              const docId = `${ctrl.controlId}-s1-${req.docType}`;
              // req doesn't carry a docId field on the type — we compute
              // it here and pass it through so the row component can
              // render the testid + key.
              return { requirement: { docId, docType: req.docType, label: req.label, required: req.required }, doc: docs[docId] ?? null };
            });
            const verifiedOrShortCircuit = controlDocs.filter((d) => d.doc?.status === 'verified' || d.doc?.status === 'use_previous').length;
            return (
              <section key={ctrl.controlId} className="card" data-testid={`organizer-control-${ctrl.authority}`}>
                <div className="card-header flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <ClipboardList size={16} className="text-brand-700" />
                    <h2 className="font-semibold">{ctrl.controlName}</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="badge bg-blue-100 text-brand-700 text-xs">{ctrl.authority}</span>
                    <span className="badge bg-ink-100 text-ink-600 text-xs">{ctrl.stageRequirement}</span>
                    <span className="badge bg-ink-100 text-ink-600 text-xs">
                      {verifiedOrShortCircuit}/{controlDocs.length} Stage 1 ready
                    </span>
                  </div>
                </div>
                <div className="card-body space-y-3">
                  {controlDocs.length === 0 ? (
                    <p className="text-sm text-ink-500">No Stage 1 documents required for this control.</p>
                  ) : (
                    <div className="space-y-2">
                      {controlDocs.map((d) => (
                        <Stage1RequirementRow
                          key={d.requirement.docId}
                          eventId={eventId!}
                          controlId={ctrl.controlId}
                          requirement={d.requirement}
                          doc={d.doc}
                          onSubmitted={(r) => showToast('success', r.status === 'use_previous' ? 'Marked as Use Previous.' : 'Submitted. Awaiting officer verification.')}
                          onError={(m) => showToast('error', m)}
                        />
                      ))}
                    </div>
                  )}
                  {ctrl.stage2Requirement && (
                    <div data-testid={`organizer-stage2-${ctrl.authority}`}>
                      <Stage2RequirementRow
                        eventId={eventId!}
                        controlId={ctrl.controlId}
                        authority={ctrl.authority}
                        label={ctrl.stage2Requirement.label}
                        doc={stage2Docs[`${ctrl.controlId}-s2`] ?? null}
                        onSubmitted={() => showToast('success', 'Stage 2 image published. Public verification can now begin.')}
                        onError={(m) => showToast('error', m)}
                      />
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
