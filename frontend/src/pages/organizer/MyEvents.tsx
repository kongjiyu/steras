import { Fragment, useEffect, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { COLLECTIONS, EventRecord } from '@shared/types';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import { format } from 'date-fns';
import { ArrowRight, CalendarPlus, MapPin } from 'lucide-react';
import OrganizerStatusBadge from './OrganizerStatusBadge';
import { applicationStatusLabel, assessmentLabel, isEditableApplicationStatus, ORGANIZER_STATUS_FILTERS, organizerAdminDecisionLabel, organizerPublicationLabel, organizerPublicationStateFromProjection, OrganizerStatusFilter } from './organizerApplication';
import { mockEvents } from '../../mock_data/events';
import { mockPublicEvents } from '../../mock_data/public_events';

type TimeFilter = 'all' | 'current' | 'upcoming' | 'past';

export function eventTimeGroup(event: EventRecord, now = Date.now()): Exclude<TimeFilter, 'all'> {
  const start = event.eventDetails.startDatetime;
  const end = event.eventDetails.endDatetime;
  if (start > 0 && start > now) return 'upcoming';
  if (end > 0 && end < now) return 'past';
  return 'current';
}

const TIME_LABELS: Record<Exclude<TimeFilter, 'all'>, string> = {
  current: 'Ongoing & unscheduled',
  upcoming: 'Upcoming',
  past: 'Past',
};

export default function MyEvents() {
  const { user } = useAuth();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<OrganizerStatusFilter>(() => new URLSearchParams(window.location.search).get('status') === 'Draft' ? 'Draft' : 'all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [publicProjections, setPublicProjections] = useState<Map<string, unknown>>(new Map());
  const [publicationLoadState, setPublicationLoadState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    if (!isFirebaseConfigured || !user) {
      if (!isFirebaseConfigured && user) {
        setEvents(mockEvents
          .filter((event) => event.organizerId === user.uid)
          .sort((a, b) => b.createdAt - a.createdAt));
      }
      setLoading(false);
      return;
    }
    const q = query(
      collection(db, COLLECTIONS.EVENTS),
      where('organizerId', '==', user.uid),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setEvents(snap.docs
          .map((d) => ({ eventId: d.id, ...d.data() }) as EventRecord)
          .sort((a, b) => b.createdAt - a.createdAt));
        setError('');
        setLoading(false);
      },
      (err) => {
        console.warn('[MyEvents] Snapshot error:', err);
        setError('Your applications could not be loaded.');
        setLoading(false);
      },
    );
    return () => unsub();
  }, [user, retryKey]);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setPublicProjections(new Map(mockPublicEvents.map((event) => [event.eventId, event])));
      setPublicationLoadState('ready');
      return;
    }
    setPublicationLoadState('loading');
    return onSnapshot(collection(db, COLLECTIONS.PUBLIC_EVENTS), (snapshot) => {
      setPublicProjections(new Map(snapshot.docs.map((document) => [document.id, document.data()])));
      setPublicationLoadState('ready');
    }, () => {
      setPublicProjections(new Map());
      setPublicationLoadState('unavailable');
    });
  }, [retryKey]);

  const publicationStateFor = (event: EventRecord) => publicationLoadState === 'loading'
    ? 'loading' as const
    : publicationLoadState === 'unavailable'
      ? 'unavailable' as const
      : organizerPublicationStateFromProjection(publicProjections.get(event.eventId), event.eventId, event.currentVersionId);

  const filtered = filter === 'all' ? events : events.filter((e) => String(e.status) === filter);
  const timeFiltered = timeFilter === 'all' ? filtered : filtered.filter(event => eventTimeGroup(event) === timeFilter);
  const groupOrder: Record<Exclude<TimeFilter, 'all'>, number> = { current: 0, upcoming: 1, past: 2 };
  const ordered = [...timeFiltered].sort((left, right) => {
    const groupDifference = groupOrder[eventTimeGroup(left)] - groupOrder[eventTimeGroup(right)];
    if (groupDifference) return groupDifference;
    return timeFilter === 'past'
      ? right.eventDetails.endDatetime - left.eventDetails.endDatetime
      : left.eventDetails.startDatetime - right.eventDetails.startDatetime;
  });

  return (
    <div>
      <PageHeader
        title="My Events"
        description="Your submitted events and their latest review status. Updates appear automatically as each review progresses."
        action={
          <Link to="/organizer/events/new" className="btn-primary"><CalendarPlus size={17} />New event</Link>
        }
      />

      <div className="mb-6 flex gap-2 overflow-x-auto border-b border-[#ded5c5] pb-3" aria-label="Filter applications by status">
        {ORGANIZER_STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={
              'min-h-10 shrink-0 rounded-md px-3 py-2 text-sm font-semibold ' +
              (filter === f ? 'bg-brand-700 text-cream-50' : 'border border-[#d8cebd] bg-[#fffdf8] text-ink-600 hover:bg-cream-100')
            }
          >
            {f === 'all' ? 'All' : applicationStatusLabel(f)}
          </button>
        ))}
      </div>

      <div className="sticky top-20 z-10 mb-6 flex gap-1 overflow-x-auto rounded-lg border border-[#ded5c5] bg-[#fffdf8]/95 p-1 shadow-sm backdrop-blur" aria-label="Filter events by time">
        {(['all', 'current', 'upcoming', 'past'] as TimeFilter[]).map(value => <button key={value} type="button" aria-pressed={timeFilter === value} onClick={() => setTimeFilter(value)} className={`min-h-10 shrink-0 rounded-md px-4 text-sm font-semibold ${timeFilter === value ? 'bg-brand-700 text-white' : 'text-ink-600 hover:bg-cream-100'}`}>{value === 'all' ? 'All dates' : TIME_LABELS[value]}</button>)}
      </div>

      {loading ? (
        <div className="card"><div className="card-body text-center text-ink-500">Loading applications…</div></div>
      ) : error ? (
        <EmptyState title="Applications unavailable" description={error}><button type="button" className="btn-secondary" onClick={() => { setLoading(true); setRetryKey((value) => value + 1); }}>Try again</button></EmptyState>
      ) : timeFiltered.length === 0 ? (
        <EmptyState
          title={filter === 'all' ? 'No events yet' : `No events with status "${applicationStatusLabel(filter)}"`}
          description={filter === 'all' ? 'Submit your first event application to get started.' : 'Choose another status to view your other applications.'}
          children={<Link to="/organizer/events/new" className="btn-primary"><CalendarPlus size={17} />New event</Link>}
        />
      ) : (
        <div>
          <div className="hidden overflow-hidden rounded-lg border border-[#ded5c5] bg-[#fffdf8] md:block">
          <table className="w-full text-sm">
            <thead className="bg-cream-100/70 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-ink-600">Event</th>
                <th className="px-4 py-3 font-semibold text-ink-600">Version</th>
                <th className="px-4 py-3 font-semibold text-ink-600">Review</th>
                <th className="px-4 py-3 font-semibold text-ink-600">Date</th>
                <th className="px-4 py-3 font-semibold text-ink-600">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e3dacb]">
              {ordered.map((e, index) => {
                const group = eventTimeGroup(e);
                const showGroup = index === 0 || eventTimeGroup(ordered[index - 1]) !== group;
                return <Fragment key={e.eventId}>{showGroup && <tr><th colSpan={6} className="border-y border-[#d8cebd] bg-cream-50 px-4 py-2 text-left text-xs font-bold uppercase tracking-[0.08em] text-brand-700">{TIME_LABELS[group]}</th></tr>}<tr className={`transition-colors hover:bg-cream-50 ${new URLSearchParams(window.location.search).get('highlight') === e.eventId ? 'bg-brand-50 ring-2 ring-inset ring-brand-500' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-ink-800">{e.eventDetails.name || 'Untitled event'}</div>
                    <div className="mt-0.5 text-xs text-ink-500">{e.eventDetails.venueName || 'Venue not set'} - {e.eventDetails.type}</div>
                  </td>
                  <td className="px-4 py-3 text-ink-600">{versionLabel(e)}</td>
                  <td className="px-4 py-3 text-ink-600">
                    <div>{assessmentLabel(e)}</div>
                    <div className="mt-0.5 text-xs text-ink-500">{organizerAdminDecisionLabel(e)} - {organizerPublicationLabel(publicationStateFor(e))}</div>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-ink-600">
                    {e.eventDetails.startDatetime ? format(new Date(e.eventDetails.startDatetime), 'PP') : 'Not scheduled'}
                  </td>
                  <td className="px-4 py-3"><OrganizerStatusBadge status={String(e.status)} /></td>
                  <td className="px-4 py-3 text-right">
                    <Link to={isEditableApplicationStatus(String(e.status)) ? `/organizer/events/${e.eventId}/edit` : `/organizer/events/${e.eventId}`} className="text-brand-600 hover:text-brand-700 text-sm font-medium">
                      {isEditableApplicationStatus(String(e.status)) ? 'Edit' : 'View'}
                    </Link>
                  </td>
                </tr></Fragment>;
              })}
            </tbody>
          </table>
          </div>

          <ul className="space-y-3 md:hidden">
            {ordered.map((e, index) => {
              const editable = isEditableApplicationStatus(String(e.status));
              const group = eventTimeGroup(e);
              const showGroup = index === 0 || eventTimeGroup(ordered[index - 1]) !== group;
              return <Fragment key={e.eventId}>{showGroup && <li className="border-b border-[#d8cebd] pb-2 pt-3 text-xs font-bold uppercase tracking-[0.08em] text-brand-700">{TIME_LABELS[group]}</li>}<li><Link to={editable ? `/organizer/events/${e.eventId}/edit` : `/organizer/events/${e.eventId}`} className="block rounded-lg border border-[#ded5c5] bg-[#fffdf8] p-4 active:bg-cream-100">
                <div className="flex items-start justify-between gap-3"><h2 className="font-display text-base font-bold leading-snug text-ink-800">{e.eventDetails.name || 'Untitled event'}</h2><OrganizerStatusBadge status={String(e.status)} /></div>
                <div className="mt-3 space-y-1 text-sm text-ink-500"><p className="flex items-center gap-2"><MapPin size={14} />{e.eventDetails.venueName || 'Venue not set'}</p><p className="tabular-nums">{e.eventDetails.startDatetime ? format(new Date(e.eventDetails.startDatetime), 'PP') : 'Not scheduled'}</p><p>{versionLabel(e)} - {assessmentLabel(e)}</p><p>{organizerAdminDecisionLabel(e)} - {organizerPublicationLabel(publicationStateFor(e))}</p></div>
                <div className="mt-4 flex items-center justify-between border-t border-[#e3dacb] pt-3 text-sm font-semibold text-brand-700"><span>{editable ? 'Continue application' : 'View application'}</span><ArrowRight size={16} /></div>
              </Link></li></Fragment>;
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function versionLabel(event: EventRecord): string {
  const status = String(event.status);
  if (isEditableApplicationStatus(status)) {
    return `${event.activeRevision ? 'Revision' : 'Draft'} ${event.editableVersionId ?? `v${(event.currentVersionNumber ?? 0) + 1}`}`;
  }
  return event.currentVersionId ? `Submitted ${event.currentVersionId}` : 'No submitted version';
}
