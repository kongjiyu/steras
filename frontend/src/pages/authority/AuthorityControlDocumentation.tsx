import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Check, ChevronLeft, FileText, Image as ImageIcon, Shield, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { COLLECTIONS, EventControl, EventRecord, Stage1Doc, Stage2Doc, ControlVerificationStatus } from '@shared/types';
import { db, functions } from '../../config/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { safeStage1DocumentHref } from '../../components/stage1/safeDocumentLink';
import EmptyState from '../../components/ui/EmptyState';
import { ApplicationDisplayBadge } from '../../components/ui/StatusBadge';
import { stage2DocumentId } from '@shared/stage2';

type DocState = Record<string, Stage1Doc[]>;

export default function AuthorityControlDocumentation() {
  const { eventId } = useParams<{ eventId: string }>();
  const { profile } = useAuth();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [controls, setControls] = useState<EventControl[]>([]);
  const [stage1Docs, setStage1Docs] = useState<DocState>({});
  const [stage2Docs, setStage2Docs] = useState<Record<string, Stage2Doc | null>>({});
  const [rationales, setRationales] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!eventId) return undefined;
    setLoading(true);
    const eventRef = doc(db, COLLECTIONS.EVENTS, eventId);
    const unsubs: Array<() => void> = [];
    unsubs.push(onSnapshot(eventRef, (snapshot) => {
      if (!snapshot.exists()) { setEvent(null); setError('The event could not be found.'); }
      else { setEvent({ eventId: snapshot.id, ...(snapshot.data() as Partial<EventRecord>) } as EventRecord); setError(''); }
      setLoading(false);
    }, () => { setError('The event could not be loaded.'); setLoading(false); }));
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [eventId]);

  useEffect(() => {
    if (!eventId || !event?.currentVersionId) return undefined;
    const controlQuery = query(
      collection(db, COLLECTIONS.EVENTS, eventId, COLLECTIONS.EVENT_CONTROLS),
      where('versionId', '==', event.currentVersionId),
    );
    return onSnapshot(controlQuery, (snapshot) => {
      setControls(snapshot.docs.map((item) => ({ controlId: item.id, ...(item.data() as Partial<EventControl>) }) as EventControl).sort((a, b) => a.authority.localeCompare(b.authority)));
    }, () => setError('The event control list could not be loaded.'));
  }, [event?.currentVersionId, eventId]);

  const controlsKey = useMemo(() => controls.map((control) => control.controlId).join('|'), [controls]);
  useEffect(() => {
    if (!eventId || !controls.length) { setStage1Docs({}); setStage2Docs({}); return undefined; }
    const unsubs: Array<() => void> = [];
    controls.forEach((control) => {
      const stage1Ref = collection(db, COLLECTIONS.EVENTS, eventId, COLLECTIONS.EVENT_CONTROLS, control.controlId, COLLECTIONS.STAGE1_DOCS);
      const stage2Ref = doc(db, COLLECTIONS.EVENTS, eventId, COLLECTIONS.EVENT_CONTROLS, control.controlId, COLLECTIONS.STAGE2_DOCS, stage2DocumentId(control.controlId));
      unsubs.push(onSnapshot(stage1Ref, (snapshot) => setStage1Docs((current) => ({ ...current, [control.controlId]: snapshot.docs.map((item) => ({ docId: item.id, ...(item.data() as Partial<Stage1Doc>) }) as Stage1Doc) })), () => setError('Stage 1 documentation could not be loaded.')));
      unsubs.push(onSnapshot(stage2Ref, (snapshot) => setStage2Docs((current) => ({ ...current, [control.controlId]: snapshot.exists() ? snapshot.data() as Stage2Doc : null })), () => setError('Stage 2 documentation could not be loaded.')));
    });
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
    // controlsKey intentionally changes only when the control set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, controlsKey]);

  const submitVerification = async (control: EventControl, stage1Doc: Stage1Doc, status: ControlVerificationStatus) => {
    const key = `${control.controlId}__${stage1Doc.docId}`;
    const rationale = (rationales[key] ?? '').trim();
    if (status === 'rejected' && rationale.length < 10) {
      toast.error('A rejection reason must be at least 10 characters.');
      return;
    }
    if (!eventId) return;
    setBusy(key);
    try {
      const command = httpsCallable<{ eventId: string; controlId: string; docId: string; status: ControlVerificationStatus; rationale: string }, unknown>(functions, 'verifyStage1Doc');
      await command({ eventId, controlId: control.controlId, docId: stage1Doc.docId, status, rationale });
      toast.success(status === 'verified' ? 'Stage 1 document approved.' : 'Stage 1 document rejected.');
      setRationales((current) => { const next = { ...current }; delete next[key]; return next; });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to record documentation review.');
    } finally { setBusy(null); }
  };

  if (loading) return <div className="p-8 text-ink-500">Loading event documentation…</div>;
  if (error) return <div className="p-8"><EmptyState title="Documentation unavailable" description={error} /></div>;
  if (!event) return <div className="p-8"><EmptyState title="Event not found" /></div>;

  return <div className="p-5 sm:p-8">
    <Link to={`/authority/events/${eventId}`} className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800"><ChevronLeft size={16} /> Back to application</Link>
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><h1 className="font-display text-2xl font-bold text-ink-800">Event control documentation</h1><p className="mt-1 text-sm text-ink-500">{event.eventDetails.name} · {event.eventDetails.venueName}</p><p className="mt-1 text-xs text-ink-400">Current version {event.currentVersionId ?? '—'} · Stage 2 is view-only for Authority officers.</p></div>
      <ApplicationDisplayBadge state={event.reviewStage === 'second' ? 'Final Review' : event.status === 'Approved' ? 'Documentation Required' : 'Under Review'} />
    </div>
    {controls.length === 0 ? <div className="card"><div className="card-body text-sm text-ink-500">No current control list is available.</div></div> : <div className="space-y-4" data-testid="authority-control-documentation">
      {controls.map((control) => {
        const canReview = control.authority === profile?.authorityType && (!control.stage1ReviewerUid || control.stage1ReviewerUid === profile?.uid);
        const stage1 = stage1Docs[control.controlId] ?? [];
        const stage2 = stage2Docs[control.controlId];
        return <section key={control.controlId} className="card" data-testid={`authority-documentation-${control.authority}`}>
          <div className="card-header flex-wrap gap-2"><div className="flex items-center gap-2"><Shield size={16} className="text-brand-700" /><h2 className="font-semibold">{control.controlName}</h2></div><span className="badge bg-blue-100 text-brand-700">{control.authority}</span></div>
          <div className="card-body space-y-4">
            <div><h3 className="text-xs font-bold uppercase tracking-wide text-ink-500">Stage 1 documentation</h3>{stage1.length === 0 ? <p className="mt-2 text-sm text-ink-500">No Organizer upload yet.</p> : <div className="mt-2 space-y-2">{stage1.map((document) => { const key = `${control.controlId}__${document.docId}`; const awaiting = document.status === 'pending_verification'; return <article key={document.docId} className="rounded-md border border-ink-200 bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-ink-800">{document.label}</p><p className="text-xs text-ink-500">{document.docType} · {document.status}</p></div><span className="badge bg-ink-100 text-ink-700">{document.status === 'verified' || document.status === 'use_previous' ? 'Approved' : document.status === 'rejected' ? 'Rejected' : 'Awaiting review'}</span></div>{safeStage1DocumentHref(document.filePath) && <a href={safeStage1DocumentHref(document.filePath)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"><FileText size={13} /> View Organizer document</a>}{document.usePreviousDeclaration && <p className="mt-2 rounded bg-blue-50 px-2 py-1.5 text-xs text-brand-800">Use Previous receipt declaration; no new Authority review is required.</p>}{canReview && awaiting && <div className="mt-3 space-y-2"><textarea className="input" rows={2} maxLength={1000} value={rationales[key] ?? ''} onChange={(event) => setRationales((current) => ({ ...current, [key]: event.target.value }))} placeholder="Optional approval note; required rejection reason (10+ characters)." /><div className="flex flex-wrap justify-end gap-2"><button type="button" className="btn-secondary" disabled={busy === key} onClick={() => void submitVerification(control, document, 'rejected')}><X size={14} /> Reject</button><button type="button" className="btn-success" disabled={busy === key} onClick={() => void submitVerification(control, document, 'verified')}><Check size={14} /> Approve</button></div></div>}</article>; })}</div>}</div>
            <div><h3 className="text-xs font-bold uppercase tracking-wide text-ink-500">Stage 2 visual evidence</h3>{!stage2 ? <p className="mt-2 text-sm text-ink-500">Organizer has not uploaded a Stage 2 image.</p> : <div className="mt-2 rounded-md border border-ink-200 bg-white p-3"><div className="flex items-center gap-2 text-sm font-semibold text-ink-800"><ImageIcon size={15} /> {stage2.published ? 'Published image' : stage2.rejectionReason ? 'Rejected image' : 'Awaiting Admin publication'}</div>{stage2.imageUrl && <a href={stage2.imageUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-semibold text-brand-700 hover:underline">View Stage 2 image</a>}{stage2.rejectionReason && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-800">Admin feedback: {stage2.rejectionReason}</p>}</div>}</div>
          </div>
        </section>;
      })}
    </div>}
  </div>;
}
