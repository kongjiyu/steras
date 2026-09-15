import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ChevronRight,
  ClipboardList,
  Eye,
  Filter,
  Search,
  ShieldCheck,
} from 'lucide-react';
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

export default function AdminApplicationQueue() {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<AdminVisibleEventStatus | 'all'>(() => adminStatusFromQuery(params.get('status')));

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, COLLECTIONS.EVENTS),
          where('status', 'in', ADMIN_VISIBLE_EVENT_STATUSES),
          orderBy('updatedAt', 'desc'),
        ));
        if (cancelled) return;
        setEvents(snap.docs.map((d) => ({ ...(d.data() as EventRecord), eventId: d.id })));
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('[AdminQueue] load failed', err);
        setError('Application queue could not be loaded.');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (!q) return true;
      return (
        e.eventDetails.name.toLowerCase().includes(q) ||
        e.eventDetails.venueName.toLowerCase().includes(q) ||
        e.eventDetails.organizerName.toLowerCase().includes(q) ||
        e.eventDetails.type.toLowerCase().includes(q)
      );
    });
  }, [events, search, statusFilter]);

  const setStatus = (s: AdminVisibleEventStatus | 'all') => {
    setStatusFilter(s);
    if (s === 'all') params.delete('status');
    else params.set('status', s);
    setParams(params, { replace: true });
  };

  return (
    <div className="min-h-screen bg-[#f3f1e9] pb-16">
      <WorkspaceTopBar
        title="Application queue"
        subtitle="M3 — Authority Approval · all submissions"
        userInitials={initialsFor(profile?.name)}
        workspaceEyebrow="STERAS administration"
        workspaceEyebrowIcon={ShieldCheck}
      />

      <main className="page-shell page-enter">
        {error && (
          <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700" role="alert">
            {error}
          </div>
        )}

        {/* Filters */}
        <section className="mb-5 grid gap-3 border-y border-[#ded4c1] py-4 md:grid-cols-[minmax(0,1fr)_13rem]">
          <label className="relative block">
            <span className="sr-only">Search applications</span>
            <Search className="pointer-events-none absolute left-3 top-3.5 text-ink-400" size={17} />
            <input
              type="search"
              className="input min-h-11 !pl-10"
              placeholder="Search event, venue, organiser, or type"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
            <Filter size={14} className="text-ink-400" aria-hidden="true" />
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={statusFilter === f.value}
                onClick={() => setStatus(f.value)}
                className={
                  'min-h-9 rounded-md border px-3 text-xs font-semibold transition-colors ' +
                  (statusFilter === f.value
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-ink-200 bg-white text-ink-700 hover:bg-cream-50')
                }
              >
                {f.label}
              </button>
            ))}
          </div>
        </section>

        {/* List */}
        <section className="overflow-hidden rounded-lg border border-[#ded5c5] bg-white shadow-card">
          <header className="admin-queue-header grid grid-cols-[1.5rem_minmax(0,2fr)_minmax(0,1.4fr)_9rem_7rem_9rem] gap-3 border-b border-[#e8e0cf] bg-cream-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-500">
            <span aria-hidden="true" />
            <span>Application</span>
            <span>Organiser · Venue</span>
            <span>Status</span>
            <span>Event date</span>
            <span className="text-right">Action</span>
          </header>

          {loading ? (
            <p className="p-5 text-sm text-ink-500">Loading application queue…</p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <ClipboardList size={28} className="text-ink-400" />
              <p className="text-sm text-ink-500">No applications match your filters.</p>
            </div>
          ) : (
            <ul className="divide-y divide-[#e8e0cf]">
              {filtered.map((e) => {
                    const action = getAdminQueueAction(e);
                return (
                  <li key={e.eventId} className="admin-queue-row grid grid-cols-[1.5rem_minmax(0,2fr)_minmax(0,1.4fr)_9rem_7rem_9rem] items-center gap-3 px-4 py-3 transition hover:bg-cream-50">
                    <ClipboardList size={16} className="text-ink-500" />
                    <Link
                      to={`/admin/applications/${e.eventId}`}
                      className="min-w-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink-900">{e.eventDetails.name}</p>
                        <p className="truncate text-xs text-ink-500">
                          {e.eventDetails.type} · {e.eventDetails.expectedAttendance.toLocaleString()} attendees
                        </p>
                      </div>
                    </Link>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink-800">{e.eventDetails.organizerName}</p>
                      <p className="truncate text-xs text-ink-500">{e.eventDetails.venueName}</p>
                    </div>
                    <ApplicationDisplayBadge state={resolveApplicationDisplayState({
                      status: e.status,
                      reviewStage: e.reviewStage,
                      currentVersionId: e.currentVersionId,
                      currentAssessmentId: e.currentAssessmentId,
                      currentResourceId: e.currentResourceId,
                      initialReview: e.initialReview,
                      assignedOfficerUids: e.assignedOfficerUids,
                    })} />
                    <span className="text-xs text-ink-600">{formatDate(e.eventDetails.startDatetime)}</span>
                    <Link
                      to={action.to}
                      className={`admin-queue-action admin-queue-action--${action.variant}`}
                      aria-label={`${action.label} ${e.eventDetails.name}`}
                      data-testid={`queue-action-${e.eventId}`}
                    >
                      <span className="admin-queue-action__label-group">
                        {action.label === 'View' ? <Eye size={14} aria-hidden="true" /> : <ClipboardList size={14} aria-hidden="true" />}
                        <span>{action.label}</span>
                      </span>
                      <ChevronRight className="admin-queue-action__chevron" size={14} aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="mt-4 text-xs text-ink-500">
          Showing {filtered.length} of {events.length} application{events.length === 1 ? '' : 's'}.
        </p>
      </main>
    </div>
  );
}
