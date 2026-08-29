import { useEffect, useState } from 'react';
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
import { applicationStatusLabel, isEditableApplicationStatus, ORGANIZER_STATUS_FILTERS, organizerAdminDecisionLabel, organizerPublicationLabel, organizerPublicationStateFromProjection, OrganizerStatusFilter } from './organizerApplication';
import { mockEvents } from '../../mock_data/events';
import { mockPublicEvents } from '../../mock_data/public_events';

export default function MyEvents() {
  const { user } = useAuth();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<OrganizerStatusFilter>('all');
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

  return (
    <div>
      <PageHeader
        title="My Events"
        description="Real-time list of your submitted events. Status updates push live via Firestore."
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

      {loading ? (
        <div className="card"><div className="card-body text-center text-ink-500">Loading applications…</div></div>
      ) : error ? (
        <EmptyState title="Applications unavailable" description={error}><button type="button" className="btn-secondary" onClick={() => { setLoading(true); setRetryKey((value) => value + 1); }}>Try again</button></EmptyState>
      ) : filtered.length === 0 ? (
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
              {filtered.map((e) => (
                <tr key={e.eventId} className="transition-colors hover:bg-cream-50">
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
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <ul className="space-y-3 md:hidden">
            {filtered.map((e) => {
              const editable = isEditableApplicationStatus(String(e.status));
              return <li key={e.eventId}><Link to={editable ? `/organizer/events/${e.eventId}/edit` : `/organizer/events/${e.eventId}`} className="block rounded-lg border border-[#ded5c5] bg-[#fffdf8] p-4 active:bg-cream-100">
                <div className="flex items-start justify-between gap-3"><h2 className="font-display text-base font-bold leading-snug text-ink-800">{e.eventDetails.name || 'Untitled event'}</h2><OrganizerStatusBadge status={String(e.status)} /></div>
                <div className="mt-3 space-y-1 text-sm text-ink-500"><p className="flex items-center gap-2"><MapPin size={14} />{e.eventDetails.venueName || 'Venue not set'}</p><p className="tabular-nums">{e.eventDetails.startDatetime ? format(new Date(e.eventDetails.startDatetime), 'PP') : 'Not scheduled'}</p><p>{versionLabel(e)} - {assessmentLabel(e)}</p><p>{organizerAdminDecisionLabel(e)} - {organizerPublicationLabel(publicationStateFor(e))}</p></div>
                <div className="mt-4 flex items-center justify-between border-t border-[#e3dacb] pt-3 text-sm font-semibold text-brand-700"><span>{editable ? 'Continue application' : 'View application'}</span><ArrowRight size={16} /></div>
              </Link></li>;
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

function assessmentLabel(event: EventRecord): string {
  if (event.currentAssessmentId) return 'Assessment available';
  if (event.status === 'Pending') return 'Assessment processing';
  if (isEditableApplicationStatus(String(event.status))) return 'Not submitted';
  if (event.status === 'Manual Review Required') return 'Manual assessment required';
  return 'Assessment unavailable';
}
