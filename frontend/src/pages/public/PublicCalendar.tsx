import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { format } from 'date-fns';
import { ArrowUpRight, CalendarDays, MapPin, Search, ShieldCheck } from 'lucide-react';
import { COLLECTIONS, EVENT_TYPES, EventType, PublicEvent } from '@shared/types';
import { db, isFirebaseConfigured } from '../../config/firebase';
import PublicHeader from '../../components/layout/PublicHeader';
import EmptyState from '../../components/ui/EmptyState';
import { filterPublicEvents, groupPublicEventsByPeriod, PublicEventPeriod } from './publicEvents';
import { mockPublicEvents } from '../../mock_data/public_events';

export default function PublicCalendar() {
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [search, setSearch] = useState('');
  const [eventType, setEventType] = useState<EventType | 'all'>('all');
  const [month, setMonth] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [activePeriod, setActivePeriod] = useState<PublicEventPeriod>('present');

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setEvents(mockPublicEvents);
      setError('');
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
  const periodGroups = useMemo(() => groupPublicEventsByPeriod(filtered), [filtered]);
  const filtersActive = Boolean(search || month || eventType !== 'all');

  useEffect(() => {
    if (loading || error || filtered.length === 0) return;
    const updateActivePeriod = () => {
      const threshold = Math.min(280, window.innerHeight * 0.35);
      let active: PublicEventPeriod = 'present';
      for (const group of periodGroups) {
        const target = document.getElementById(`events-${group.id}`);
        if (target && target.getBoundingClientRect().top <= threshold) active = group.id;
      }
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 24) active = 'past';
      setActivePeriod((current) => current === active ? current : active);
    };
    const frame = window.requestAnimationFrame(updateActivePeriod);
    window.addEventListener('scroll', updateActivePeriod, { passive: true });
    window.addEventListener('resize', updateActivePeriod);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', updateActivePeriod);
      window.removeEventListener('resize', updateActivePeriod);
    };
  }, [error, filtered.length, loading, periodGroups]);

  const jumpToPeriod = (period: PublicEventPeriod) => {
    const target = document.getElementById(`events-${period}`);
    if (!target) return;
    setActivePeriod(period);
    const top = Math.max(0, window.scrollY + target.getBoundingClientRect().top - 96);
    window.scrollTo({
      top,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
    target.focus({ preventScroll: true });
  };

  return (
    <div className="min-h-screen bg-[#f4eddf] text-ink-800">
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-5 py-9 sm:px-8 sm:py-12">
        <div className="max-w-3xl">
          <p className="text-xs font-bold uppercase text-[#8e6918]">Public event register</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-[#20251d] sm:text-4xl">Approved tourism events</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#696351]">Browse Malaysian tourism events that have completed the required authority review, separated into present, future and past events.</p>
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
          <p className="text-sm font-medium text-[#5d594c]" role="status">{loading ? 'Loading events...' : error ? 'Event count unavailable' : `${filtered.length} approved ${filtered.length === 1 ? 'event' : 'events'}`}</p>
          {filtersActive && <button type="button" className="text-sm font-semibold text-[#52651c] hover:text-[#384611]" onClick={() => { setSearch(''); setEventType('all'); setMonth(''); }}>Clear filters</button>}
        </div>

        {loading ? <LoadingEvents /> : error ? <EmptyState title="Events unavailable" description={error}><button type="button" className="btn-secondary" onClick={() => { setLoading(true); setRetryKey((value) => value + 1); }}>Try again</button></EmptyState> : events.length === 0 ? (
          <EmptyState title="No approved events yet" description="Events appear here after every required authority approves the same application version." />
        ) : filtered.length === 0 ? (
          <EmptyState title="No matching events" description="Try another event type, month, or search term." />
        ) : (
          <div>
            <nav aria-label="Event time sections" className="sticky top-[72px] z-20 mb-7 grid grid-cols-3 gap-2 border-y border-[#dcd0bb] bg-[#f4eddf]/95 py-3 backdrop-blur-sm lg:hidden">
              {periodGroups.map((group) => <PeriodButton key={group.id} group={group} active={activePeriod === group.id} onClick={() => jumpToPeriod(group.id)} compact />)}
            </nav>
            <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_11rem]">
              <div className="min-w-0 space-y-14">
                {periodGroups.map((period) => (
                  <section id={`events-${period.id}`} tabIndex={-1} style={{ scrollMarginTop: 96 }} key={period.id} aria-labelledby={`period-${period.id}`}>
                    <div className="mb-6 flex items-center gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 id={`period-${period.id}`} className="whitespace-nowrap font-display text-xl font-bold text-[#303528]">{period.label}</h2>
                          <span className="rounded-full bg-[#e5ead4] px-2.5 py-1 text-xs font-bold text-[#52651c]">{period.events.length}</span>
                        </div>
                        <p className="mt-1 text-sm text-[#696351]">{period.description}</p>
                      </div>
                      <div className="h-px min-w-8 flex-1 bg-[#cfc1a8]" />
                    </div>
                    {period.events.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-[#cfc1a8] bg-[#faf6ed] px-4 py-5 text-sm text-[#696351]">No {period.id === 'present' ? 'ongoing' : period.id} events match the current filters.</p>
                    ) : <div className="space-y-8">
                      {period.months.map((group) => (
                        <section key={group.month} aria-labelledby={`${period.id}-month-${group.month}`}>
                          <div className="mb-3 flex items-center gap-3">
                            <h3 id={`${period.id}-month-${group.month}`} className="font-display text-base font-bold text-[#45483e]">{format(new Date(`${group.month}-01T12:00:00`), 'MMMM yyyy')}</h3>
                            <div className="h-px flex-1 bg-[#e0d6c4]" />
                          </div>
                          <ul className="space-y-3">
                            {group.events.map((event) => <EventListItem key={event.eventId} event={event} />)}
                          </ul>
                        </section>
                      ))}
                    </div>}
                  </section>
                ))}
              </div>
              <aside className="sticky top-24 hidden rounded-lg border border-[#d8ccb7] bg-[#fffdf7] p-3 shadow-[0_8px_24px_rgba(71,62,37,0.08)] lg:block">
                <p className="px-2 pb-2 text-xs font-bold uppercase tracking-[0.08em] text-[#8e6918]">Jump to</p>
                <nav className="space-y-1" aria-label="Event time section shortcuts">
                  {periodGroups.map((group) => <PeriodButton key={group.id} group={group} active={activePeriod === group.id} onClick={() => jumpToPeriod(group.id)} />)}
                </nav>
              </aside>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function PeriodButton({ group, active, onClick, compact = false }: {
  group: ReturnType<typeof groupPublicEventsByPeriod>[number];
  active: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  const shortLabel = group.id === 'present' ? 'Present' : group.id === 'future' ? 'Future' : 'Past';
  return <button type="button" aria-current={active ? 'location' : undefined} onClick={onClick} className={`${compact ? 'min-h-11 justify-center px-2 text-xs' : 'min-h-11 w-full justify-between px-3 text-sm'} flex items-center gap-2 rounded-md font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#657b22] ${active ? 'bg-[#52651c] text-white' : 'text-[#55584d] hover:bg-[#edf2dc] hover:text-[#384611]'}`}><span>{shortLabel}</span><span className={`${active ? 'bg-white/20 text-white' : 'bg-[#e5ead4] text-[#52651c]'} rounded-full px-2 py-0.5 text-xs font-bold`}>{group.events.length}</span></button>;
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
