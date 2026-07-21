import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { format } from 'date-fns';
import { ArrowUpRight, CalendarDays, MapPin, Search, ShieldCheck } from 'lucide-react';
import { COLLECTIONS, EVENT_TYPES, EventType, PublicEvent } from '@shared/types';
import { db, isFirebaseConfigured } from '../../config/firebase';
import PublicHeader from '../../components/layout/PublicHeader';
import EmptyState from '../../components/ui/EmptyState';
import { filterPublicEvents, groupPublicEventsByMonth } from './publicEvents';

export default function PublicCalendar() {
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [search, setSearch] = useState('');
  const [eventType, setEventType] = useState<EventType | 'all'>('all');
  const [month, setMonth] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setError('The public event service is not configured.');
      setLoading(false);
      return;
    }
    const eventsQuery = query(collection(db, COLLECTIONS.PUBLIC_EVENTS), where('publicStatus', '==', 'approved'));
    return onSnapshot(eventsQuery, (snapshot) => {
      setEvents(snapshot.docs.map((document) => document.data() as PublicEvent));
      setError('');
      setLoading(false);
    }, () => {
      setError('Approved events could not be loaded.');
      setLoading(false);
    });
  }, [retryKey]);

  const filtered = useMemo(() => filterPublicEvents(events, { search, eventType, month }), [events, search, eventType, month]);
  const groups = useMemo(() => groupPublicEventsByMonth(filtered), [filtered]);
  const filtersActive = Boolean(search || month || eventType !== 'all');

  return (
    <div className="min-h-screen bg-[#f4eddf] text-ink-800">
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-5 py-9 sm:px-8 sm:py-12">
        <div className="max-w-3xl">
          <p className="text-xs font-bold uppercase text-[#8e6918]">Public event register</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-[#20251d] sm:text-4xl">Approved tourism events</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#696351]">Browse Malaysian tourism events that have completed the required authority review.</p>
        </div>

        <section aria-label="Event filters" className="my-8 grid gap-3 border-y border-[#dcd0bb] py-5 md:grid-cols-[minmax(0,1fr)_13rem_12rem]">
          <label className="relative block">
            <span className="sr-only">Search events or venues</span>
            <Search className="pointer-events-none absolute left-3 top-2.5 text-[#7f7867]" size={17} />
            <input className="input !pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search event or venue" />
          </label>
          <label><span className="sr-only">Event type</span>
            <select className="input" value={eventType} onChange={(event) => setEventType(event.target.value as EventType | 'all')}>
              <option value="all">All event types</option>
              {EVENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </label>
          <label><span className="sr-only">Event month</span><input type="month" className="input" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
        </section>

        <div className="mb-6 flex items-center justify-between gap-4">
          <p className="text-sm font-medium text-[#5d594c]">{loading ? 'Loading events...' : `${filtered.length} approved ${filtered.length === 1 ? 'event' : 'events'}`}</p>
          {filtersActive && <button type="button" className="text-sm font-semibold text-[#52651c] hover:text-[#384611]" onClick={() => { setSearch(''); setEventType('all'); setMonth(''); }}>Clear filters</button>}
        </div>

        {loading ? <LoadingEvents /> : error ? <EmptyState title="Events unavailable" description={error}><button type="button" className="btn-secondary" onClick={() => { setLoading(true); setRetryKey((value) => value + 1); }}>Try again</button></EmptyState> : events.length === 0 ? (
          <EmptyState title="No approved events yet" description="Events appear here after every required authority approves the same application version." />
        ) : filtered.length === 0 ? (
          <EmptyState title="No matching events" description="Try another event type, month, or search term." />
        ) : (
          <div className="space-y-10">
            {groups.map((group) => (
              <section key={group.month} aria-labelledby={`month-${group.month}`}>
                <div className="mb-3 flex items-center gap-3">
                  <h2 id={`month-${group.month}`} className="font-display text-lg font-bold text-[#303528]">{format(new Date(`${group.month}-01T12:00:00`), 'MMMM yyyy')}</h2>
                  <div className="h-px flex-1 bg-[#dcd0bb]" />
                </div>
                <ul className="space-y-3">
                  {group.events.map((event) => <EventListItem key={event.eventId} event={event} />)}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function EventListItem({ event }: { event: PublicEvent }) {
  return (
    <li>
      <Link to={`/events/${event.eventId}`} className="group grid gap-4 rounded-lg border border-[#ded4c1] bg-[#fffdf7] p-4 transition hover:border-[#aeb88a] hover:shadow-[0_10px_28px_rgba(71,62,37,0.08)] sm:grid-cols-[4.5rem_minmax(0,1fr)_auto] sm:items-center sm:p-5">
        <div className="flex h-16 w-[4.5rem] flex-col items-center justify-center rounded-md bg-[#edf2dc] text-[#52651c]">
          <span className="text-xs font-bold uppercase">{format(new Date(event.startDatetime), 'MMM')}</span>
          <span className="font-display text-2xl font-bold leading-none">{format(new Date(event.startDatetime), 'd')}</span>
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-base font-bold text-[#252a21] sm:text-lg">{event.eventName}</h3>
            <span className="badge bg-[#f5ead0] text-[#7e5b13]">{event.eventType}</span>
          </div>
          <div className="mt-2 flex flex-col gap-1 text-sm text-[#6b6555] sm:flex-row sm:gap-4">
            <span className="inline-flex items-center gap-1.5"><MapPin size={14} />{event.venueName}</span>
            <span className="inline-flex items-center gap-1.5"><CalendarDays size={14} />{format(new Date(event.startDatetime), 'p')}</span>
          </div>
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[#657338]"><ShieldCheck size={14} />Approved by {event.approvedBy.join(', ')}</p>
        </div>
        <ArrowUpRight className="hidden text-[#7b806c] transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#52651c] sm:block" size={20} />
      </Link>
    </li>
  );
}

function LoadingEvents() {
  return <div className="space-y-3" aria-label="Loading approved events">{[1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-lg border border-[#ded4c1] bg-[#fffaf0]" />)}</div>;
}
