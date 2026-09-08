import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ChevronRight, ClipboardList, Filter, Search, ShieldCheck } from 'lucide-react';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { COLLECTIONS, EventRecord, EventStatus } from '@shared/types';
import { WorkspaceTopBar } from '../../components/layout/Sidebar';
import { useAuth } from '../../contexts/AuthContext';
import { ADMIN_VISIBLE_EVENT_STATUSES } from './adminApplicationVisibility';
import { adminWorkflowState } from './adminWorkflow';

type QueueView = 'action' | 'all' | 'completed';
const STATUS_BADGE: Record<EventStatus, string> = { Draft: 'admin-badge admin-badge--default', Pending: 'admin-badge admin-badge--warn', UnderReview: 'admin-badge admin-badge--warn', Approved: 'admin-badge admin-badge--good', Rejected: 'admin-badge admin-badge--bad', Cancelled: 'admin-badge admin-badge--default', Withdrawn: 'admin-badge admin-badge--default', 'Manual Review Required': 'admin-badge admin-badge--warn' };
const PRIORITY_TONE = { High: 'bg-red-50 text-red-700 border-red-200', Medium: 'bg-amber-50 text-amber-800 border-amber-200', Normal: 'bg-stone-50 text-ink-500 border-stone-200' };
function initialsFor(name?: string) { return name ? name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() : 'AD'; }
function formatDate(ts?: number) { return ts ? new Date(ts).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }

export default function AdminApplicationQueue() {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? 'all');
  const [view, setView] = useState<QueueView>((params.get('view') as QueueView) || 'action');

  useEffect(() => {
    if (!isFirebaseConfigured) { setLoading(false); return; }
    let cancelled = false;
    getDocs(query(collection(db, COLLECTIONS.EVENTS), where('status', 'in', ADMIN_VISIBLE_EVENT_STATUSES), orderBy('updatedAt', 'desc')))
      .then((snapshot) => { if (!cancelled) setEvents(snapshot.docs.map((document) => ({ ...(document.data() as EventRecord), eventId: document.id }))); })
      .catch((cause) => { console.error('[AdminQueue] load failed', cause); if (!cancelled) setError('Application queue could not be loaded.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => events.map((event) => ({ event, workflow: adminWorkflowState(event) })), [events]);
  const counts = useMemo(() => ({ action: rows.filter((row) => row.workflow.needsAction).length, all: rows.length, completed: rows.filter((row) => row.workflow.complete).length }), [rows]);
  const filtered = useMemo(() => {
    const queryText = search.trim().toLowerCase();
    const rank = { High: 0, Medium: 1, Normal: 2 };
    return rows.filter(({ event, workflow }) => {
      if (view === 'action' && !workflow.needsAction) return false;
      if (view === 'completed' && !workflow.complete) return false;
      if (status !== 'all' && event.status !== status) return false;
      return !queryText || [event.eventDetails.name, event.eventDetails.venueName, event.eventDetails.organizerName, event.eventDetails.type].some((value) => value.toLowerCase().includes(queryText));
    }).sort((a, b) => rank[a.workflow.priority] - rank[b.workflow.priority]);
  }, [rows, search, status, view]);
  const updateView = (next: QueueView) => { setView(next); params.set('view', next); setParams(params, { replace: true }); };
  const updateStatus = (next: string) => { setStatus(next); if (next === 'all') params.delete('status'); else params.set('status', next); setParams(params, { replace: true }); };

  return <div className="min-h-screen bg-[#f3f1e9] pb-16">
    <WorkspaceTopBar title="Application queue" subtitle="Review work ordered by urgency and next action" userInitials={initialsFor(profile?.name)} workspaceEyebrow="STERAS administration" workspaceEyebrowIcon={ShieldCheck} />
    <main className="page-shell page-enter">
      {error && <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700" role="alert">{error}</div>}
      <nav className="mb-4 flex gap-1 border-b border-[#d8cfbd]" aria-label="Queue views">
        {(['action', 'all', 'completed'] as QueueView[]).map((item) => <button key={item} type="button" onClick={() => updateView(item)} className={'min-h-11 flex-1 whitespace-nowrap border-b-2 px-2 text-xs font-semibold sm:flex-none sm:px-4 sm:text-sm ' + (view === item ? 'border-brand-700 text-brand-800' : 'border-transparent text-ink-500 hover:text-ink-800')}>{item === 'action' ? 'Needs action' : item === 'all' ? 'All applications' : 'Completed'} <span className="ml-1 text-[10px] sm:text-xs">{counts[item]}</span></button>)}
      </nav>
      <section className="mb-5 flex flex-col gap-3 border-b border-[#ded4c1] pb-4 md:flex-row">
        <label className="relative min-w-0 flex-1"><span className="sr-only">Search applications</span><Search className="pointer-events-none absolute left-3 top-3.5 text-ink-400" size={17}/><input type="search" className="input min-h-11 !pl-10" placeholder="Search event, venue, organiser, or type" value={search} onChange={(event) => setSearch(event.target.value)}/></label>
        <label className="flex items-center gap-2 text-xs font-semibold text-ink-600"><Filter size={14}/><span>Status</span><select className="input min-h-11 md:w-44" value={status} onChange={(event) => updateStatus(event.target.value)}><option value="all">All statuses</option>{ADMIN_VISIBLE_EVENT_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      </section>
      <section className="overflow-x-auto rounded-lg border border-[#ded5c5] bg-white shadow-card">
        <header className="sticky top-0 z-10 hidden min-w-[1020px] grid-cols-[1.7fr_1.2fr_8rem_10rem_7rem_7rem_8rem] gap-3 border-b border-[#e8e0cf] bg-cream-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-500 md:grid"><span>Application</span><span>Organiser · Venue</span><span>Priority</span><span>Review stage</span><span>Status</span><span>Event date</span><span className="text-right">Next action</span></header>
        {loading ? <p className="p-5 text-sm text-ink-500">Loading application queue…</p> : filtered.length === 0 ? <div className="flex flex-col items-center gap-2 p-10 text-center">{view === 'completed' ? <CheckCircle2 size={28} className="text-ink-400"/> : <ClipboardList size={28} className="text-ink-400"/>}<p className="text-sm text-ink-500">No applications match this view.</p></div> : <ul className="divide-y divide-[#e8e0cf] md:min-w-[1020px]">{filtered.map(({ event, workflow }) => <li key={event.eventId}><Link to={workflow.actionPath} className="admin-queue-row block px-4 py-4 transition hover:bg-cream-50 md:grid md:grid-cols-[1.7fr_1.2fr_8rem_10rem_7rem_7rem_8rem] md:items-center md:gap-3 md:py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-ink-900">{event.eventDetails.name}</p><p className="truncate text-xs text-ink-500">{event.eventDetails.type} · {event.eventDetails.expectedAttendance.toLocaleString()} attendees</p></div><div className="hidden min-w-0 md:block"><p className="truncate text-sm text-ink-800">{event.eventDetails.organizerName}</p><p className="truncate text-xs text-ink-500">{event.eventDetails.venueName}</p></div><span className={'hidden w-fit rounded-full border px-2 py-1 text-xs font-semibold md:inline ' + PRIORITY_TONE[workflow.priority]}>{workflow.priority === 'High' && <AlertCircle className="mr-1 inline" size={12}/>} {workflow.priority}</span><span className="hidden text-xs font-semibold text-ink-700 md:inline">{workflow.stage}</span><span className={`${STATUS_BADGE[event.status]} hidden md:inline-flex`}>{event.status}</span><span className="hidden text-xs text-ink-600 md:inline">{formatDate(event.eventDetails.startDatetime)}</span><span className="hidden items-center justify-end gap-1 text-xs font-bold text-brand-700 md:inline-flex">{workflow.actionLabel}<ChevronRight size={14}/></span><div className="mt-3 flex items-center gap-2 md:hidden"><span className={'rounded-full border px-2 py-1 text-xs font-semibold ' + PRIORITY_TONE[workflow.priority]}>{workflow.priority}</span><span className="text-xs font-semibold text-ink-700">{workflow.stage}</span><span className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-brand-700">{workflow.actionLabel}<ChevronRight size={14}/></span></div><p className="mt-2 truncate text-xs text-ink-500 md:hidden">{event.eventDetails.organizerName} · {event.eventDetails.venueName} · {formatDate(event.eventDetails.startDatetime)}</p></Link></li>)}</ul>}
      </section>
      <p className="mt-4 text-xs text-ink-500">Showing {filtered.length} of {events.length} applications.</p>
    </main>
  </div>;
}
