import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { COLLECTIONS, EventRecord, EventStatus } from '@shared/types';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { useAuth } from '../../contexts/AuthContext';
import EmptyState from '../../components/ui/EmptyState';
import PageHeader from '../../components/ui/PageHeader';
import StatusBadge from '../../components/ui/StatusBadge';
import { filterAndSortQueue, pageCount, QueueSort } from './reviewQueueData';

const PAGE_SIZE = 10;
const ACTIVE_STATUSES = ['Pending', 'UnderReview', 'AmendmentRequested'] as const;

export default function ReviewQueue() {
  const { profile } = useAuth();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<EventStatus | 'all'>('Pending');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<QueueSort>('newest');
  const [page, setPage] = useState(1);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!isFirebaseConfigured || !profile?.authorityType) {
      setLoading(false);
      return;
    }
    const eventsQuery = query(
      collection(db, COLLECTIONS.EVENTS),
      where('requiredAuthorities', 'array-contains', profile.authorityType),
      where('status', 'in', ACTIVE_STATUSES),
      orderBy('createdAt', 'desc'),
      limit(100),
    );
    return onSnapshot(eventsQuery, (snapshot) => {
      setEvents(snapshot.docs.map((document) => ({ eventId: document.id, ...document.data() }) as EventRecord));
      setError('');
      setLoading(false);
    }, () => {
      setError('The review queue could not be loaded.');
      setLoading(false);
    });
  }, [profile?.authorityType, retryKey]);

  const filtered = useMemo(() => filterAndSortQueue(events, filter, search, sort), [events, filter, search, sort]);
  const totalPages = pageCount(filtered.length, PAGE_SIZE);
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const statusCount = (status: EventStatus | 'all') => status === 'all' ? events.length : events.filter((event) => event.status === status).length;
  const updateFilters = (action: () => void) => { action(); setPage(1); };

  return (
    <div className="p-5 sm:p-8">
      <PageHeader eyebrow="Authority workspace" title="Review Queue" description="Applications assigned to your agency that still require review action." />

      <div className="mb-5 grid gap-3 border-y border-[#ded4c1] py-4 md:grid-cols-[minmax(0,1fr)_13rem]">
        <label className="relative">
          <span className="sr-only">Search applications</span>
          <Search className="pointer-events-none absolute left-3 top-3.5 text-ink-400" size={17} />
          <input className="input min-h-11 !pl-10" value={search} onChange={(event) => updateFilters(() => setSearch(event.target.value))} placeholder="Search event, venue, or type" />
        </label>
        <label><span className="sr-only">Sort applications</span>
          <select className="input min-h-11" value={sort} onChange={(event) => updateFilters(() => setSort(event.target.value as QueueSort))}>
            <option value="newest">Newest submitted</option>
            <option value="eventSoonest">Event date: soonest</option>
            <option value="attendance">Attendance: highest</option>
          </select>
        </label>
      </div>

      <div className="mb-5 flex flex-wrap gap-2" aria-label="Filter queue by status">
        {(['all', ...ACTIVE_STATUSES] as const).map((status) => (
          <button
            type="button"
            key={status}
            aria-pressed={filter === status}
            onClick={() => updateFilters(() => setFilter(status))}
            className={`min-h-11 rounded-md border px-3 text-sm font-semibold transition-colors ${filter === status ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-700 hover:bg-cream-50'}`}
          >
            {labelStatus(status)} <span className="ml-1 opacity-75">{statusCount(status)}</span>
          </button>
        ))}
      </div>

      {loading ? <div className="py-20 text-center text-ink-500">Loading assigned applications...</div> : error ? (
        <EmptyState title="Queue unavailable" description={error}><button type="button" className="btn-secondary" onClick={() => { setLoading(true); setRetryKey((value) => value + 1); }}>Try again</button></EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState title={events.length === 0 ? 'Queue is clear' : 'No matching applications'} description={events.length === 0 ? 'There are no active applications assigned to your agency.' : 'Try another status, search term, or sort order.'} />
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-500">Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}</p>
          <ul className="space-y-2">
            {visible.map((event) => (
              <li key={event.eventId}>
                <Link to={`/authority/events/${event.eventId}`} className="block rounded-lg border border-ink-100 bg-white p-5 shadow-card transition hover:border-[#b5bd98] hover:shadow-card-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="truncate font-display text-base font-semibold text-ink-800">{event.eventDetails.name}</h2>
                      <p className="mt-1 text-sm text-ink-600">{event.eventDetails.venueName} · {format(new Date(event.eventDetails.startDatetime), 'PPp')}</p>
                      <p className="mt-2 text-xs text-ink-500">{event.eventDetails.expectedAttendance.toLocaleString()} attendees · {event.eventDetails.type}</p>
                    </div>
                    <StatusBadge status={event.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <nav className="mt-6 flex items-center justify-between border-t border-[#ded4c1] pt-4" aria-label="Review queue pages">
              <button type="button" className="btn-secondary min-h-11" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={16} /> Previous</button>
              <span className="text-sm font-medium text-ink-600">Page {currentPage} of {totalPages}</span>
              <button type="button" className="btn-secondary min-h-11" disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next <ChevronRight size={16} /></button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function labelStatus(status: EventStatus | 'all'): string {
  if (status === 'all') return 'All';
  return status.replace(/([A-Z])/g, ' $1').trim();
}
