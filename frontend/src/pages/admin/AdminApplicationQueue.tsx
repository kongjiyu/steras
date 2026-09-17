import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ChevronRight, ClipboardList, Eye, Filter, Search, ShieldCheck } from 'lucide-react';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { COLLECTIONS, EventRecord } from '@shared/types';
import { resolveApplicationDisplayState } from '@shared/applicationState';
import { WorkspaceTopBar } from '../../components/layout/Sidebar';
import { useAuth } from '../../contexts/AuthContext';
import { ApplicationDisplayBadge } from '../../components/ui/StatusBadge';
import {
  ADMIN_VISIBLE_EVENT_STATUSES,
  adminStatusFromQuery,
  type AdminVisibleEventStatus,
} from './adminApplicationVisibility';
import { adminWorkflowState } from './adminWorkflow';

const STATUS_FILTERS: Array<{ value: AdminVisibleEventStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'Pending', label: 'Pending' },
  { value: 'UnderReview', label: 'Under Review' },
  { value: 'Manual Review Required', label: 'Manual Review Required' },
  { value: 'Approved', label: 'Approved' },
  { value: 'Rejected', label: 'Rejected' },
  { value: 'Cancelled', label: 'Cancelled' },
  { value: 'Withdrawn', label: 'Withdrawn' },
];

export type AdminQueueAction = {
  label: 'Review' | 'Assign officers' | 'View';
  to: string;
  variant: 'primary' | 'secondary';
};

export function getAdminQueueAction(event: Pick<EventRecord, 'eventId' | 'status' | 'reviewStage' | 'initialReview' | 'assignedOfficerUids'>): AdminQueueAction {
  if (event.reviewStage === 'second') {
    return { label: 'View', to: `/admin/applications/${event.eventId}`, variant: 'secondary' };
  }
  if (event.initialReview?.decision === 'Approved' && !event.assignedOfficerUids?.length && !['Approved', 'Rejected', 'Cancelled', 'Withdrawn'].includes(event.status)) {
    return { label: 'Assign officers', to: `/admin/applications/${event.eventId}/assign`, variant: 'primary' };
  }
  if (!event.initialReview && !event.assignedOfficerUids?.length
    && (event.status === 'Pending' || event.status === 'UnderReview' || event.status === 'Manual Review Required' || event.reviewStage === 'manual')
    && event.reviewStage !== 'authority') {
    return { label: 'Review', to: `/admin/applications/${event.eventId}`, variant: 'primary' };
  }
  return { label: 'View', to: `/admin/applications/${event.eventId}`, variant: 'secondary' };
}

function initialsFor(name?: string) {
  if (!name) return 'AD';
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

function formatDate(ts?: number) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
}

type QueueView = 'action' | 'all' | 'completed';
const PRIORITY_TONE = { High: 'bg-red-50 text-red-700 border-red-200', Medium: 'bg-amber-50 text-amber-800 border-amber-200', Normal: 'bg-stone-50 text-ink-500 border-stone-200' };
const QUEUE_GRID = '1.7fr 1.2fr 8rem 10rem 12rem 7rem 11rem';

export default function AdminApplicationQueue() {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatusFilter] = useState<AdminVisibleEventStatus | 'all'>(adminStatusFromQuery(params.get('status')));
  const requestedView = params.get('view') as QueueView | null;
  const [view, setView] = useState<QueueView>(requestedView && ['action', 'all', 'completed'].includes(requestedView) ? requestedView : 'all');

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
      return !queryText || [event.eventId, event.eventDetails.name, event.eventDetails.venueName, event.eventDetails.organizerName, event.eventDetails.type].some((value) => value.toLowerCase().includes(queryText));
    }).sort((a, b) => rank[a.workflow.priority] - rank[b.workflow.priority]);
  }, [rows, search, status, view]);
  const updateView = (next: QueueView) => { setView(next); params.set('view', next); setParams(params, { replace: true }); };
  const updateStatus = (next: AdminVisibleEventStatus | 'all') => {
    setStatusFilter(next);
    if (next === 'all') params.delete('status');
    else params.set('status', next);
    setParams(params, { replace: true });
  };

  return <div className="min-h-screen bg-[#f3f1e9] pb-16">
    <WorkspaceTopBar title="Application queue" subtitle="Review work ordered by urgency and next action" userInitials={initialsFor(profile?.name)} workspaceEyebrow="STERAS administration" workspaceEyebrowIcon={ShieldCheck} />
    <main className="page-shell page-enter">
      {error && <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700" role="alert">{error}</div>}
      <nav className="mb-4 flex gap-1 border-b border-[#d8cfbd]" aria-label="Queue views">
        {(['action', 'all', 'completed'] as QueueView[]).map((item) => <button key={item} type="button" onClick={() => updateView(item)} className={'min-h-11 flex-1 whitespace-nowrap border-b-2 px-2 text-xs font-semibold sm:flex-none sm:px-4 sm:text-sm ' + (view === item ? 'border-brand-700 text-brand-800' : 'border-transparent text-ink-500 hover:text-ink-800')}>{item === 'action' ? 'Needs action' : item === 'all' ? 'All applications' : 'Completed'} <span className="ml-1 text-[10px] sm:text-xs">{counts[item]}</span></button>)}
      </nav>
      <section className="mb-5 flex flex-col gap-3 border-b border-[#ded4c1] pb-4 md:flex-row">
        <label className="relative min-w-0 flex-1"><span className="sr-only">Search applications</span><Search className="pointer-events-none absolute left-3 top-3.5 text-ink-400" size={17}/><input type="search" className="input min-h-11 !pl-10" placeholder="Search event, application ID, venue, organiser, or type" value={search} onChange={(event) => setSearch(event.target.value)}/></label>
        <label className="flex items-center gap-2 text-xs font-semibold text-ink-600"><Filter size={14}/><span>Status</span><select className="input min-h-11 md:w-44" value={status} onChange={(event) => updateStatus(event.target.value as AdminVisibleEventStatus | 'all')}><option value="all">All statuses</option>{STATUS_FILTERS.slice(1).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      </section>
      <section className="overflow-x-auto rounded-lg border border-[#ded5c5] bg-white shadow-card">
        <header className="admin-queue-header sticky top-0 z-10 hidden min-w-[1120px] gap-3 border-b border-[#e8e0cf] bg-cream-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-500 md:grid" style={{ gridTemplateColumns: QUEUE_GRID }}><span>Application</span><span>Organiser · Venue</span><span>Priority</span><span>Review stage</span><span>Status</span><span>Event date</span><span className="text-center">Next action</span></header>
        {loading ? <p className="p-5 text-sm text-ink-500">Loading application queue…</p> : filtered.length === 0 ? <div className="flex flex-col items-center gap-2 p-10 text-center">{view === 'completed' ? <CheckCircle2 size={28} className="text-ink-400"/> : <ClipboardList size={28} className="text-ink-400"/>}<p className="text-sm text-ink-500">No applications match this view.</p></div> : <ul className="divide-y divide-[#e8e0cf] md:min-w-[1120px]">{filtered.map(({ event, workflow }) => { const action = getAdminQueueAction(event); const displayState = resolveApplicationDisplayState({ status: event.status, reviewStage: event.reviewStage, currentVersionId: event.currentVersionId, currentAssessmentId: event.currentAssessmentId, currentResourceId: event.currentResourceId, initialReview: event.initialReview, assignedOfficerUids: event.assignedOfficerUids }); return <li key={event.eventId}><div className="admin-queue-row block px-4 py-4 transition hover:bg-cream-50 md:grid md:items-center md:gap-3 md:py-3" style={{ gridTemplateColumns: QUEUE_GRID }}><Link to={`/admin/applications/${event.eventId}`} className="admin-queue-column admin-queue-column--application min-w-0"><p className="truncate text-sm font-semibold text-ink-900">{event.eventDetails.name}</p><p className="truncate text-xs text-ink-500">{event.eventDetails.type} · {event.eventDetails.expectedAttendance.toLocaleString()} attendees</p></Link><div className="admin-queue-column admin-queue-column--organizer hidden min-w-0 md:block"><p className="truncate text-sm text-ink-800">{event.eventDetails.organizerName}</p><p className="truncate text-xs text-ink-500">{event.eventDetails.venueName}</p></div><span className={'admin-queue-column admin-queue-column--priority hidden w-fit rounded-full border px-2 py-1 text-xs font-semibold md:inline ' + PRIORITY_TONE[workflow.priority]}>{workflow.priority === 'High' && <AlertCircle className="mr-1 inline" size={12}/>} {workflow.priority}</span><span className="admin-queue-column admin-queue-column--stage hidden text-xs font-semibold text-ink-700 md:inline">{workflow.stage}</span><span className="admin-queue-column admin-queue-column--status hidden md:inline-flex"><ApplicationDisplayBadge state={displayState}/></span><span className="admin-queue-column admin-queue-column--date hidden text-xs text-ink-600 md:inline">{formatDate(event.eventDetails.startDatetime)}</span><Link to={action.to} className={`admin-queue-column admin-queue-column--action admin-queue-action admin-queue-action--${action.variant}`} aria-label={`${action.label} ${event.eventDetails.name}`} data-testid={`queue-action-${event.eventId}`}><span className="admin-queue-action__label-group">{action.label === 'View' ? <Eye size={14} aria-hidden="true"/> : <ClipboardList size={14} aria-hidden="true"/>}<span>{action.label}</span></span><ChevronRight className="admin-queue-action__chevron" size={14} aria-hidden="true"/></Link><div className="admin-queue-mobile-meta mt-3 flex items-center gap-2 md:hidden"><span className={'rounded-full border px-2 py-1 text-xs font-semibold ' + PRIORITY_TONE[workflow.priority]}>{workflow.priority}</span><span className="text-xs font-semibold text-ink-700">{workflow.stage}</span><span className="ml-auto"><ApplicationDisplayBadge state={displayState}/></span></div><p className="admin-queue-mobile-details mt-2 truncate text-xs text-ink-500 md:hidden">{event.eventDetails.organizerName} · {event.eventDetails.venueName} · {formatDate(event.eventDetails.startDatetime)}</p></div></li>; })}</ul>}
      </section>
      <p className="mt-4 text-xs text-ink-500">Showing {filtered.length} of {events.length} applications.</p>
    </main>
  </div>;
}
