import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { COLLECTIONS, EventRecord, EventStatus } from '@shared/types';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/ui/PageHeader';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import { format } from 'date-fns';
import { ArrowRight, CalendarPlus, MapPin } from 'lucide-react';

export default function MyEvents() {
  const { user } = useAuth();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<EventStatus | 'all'>('all');
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!isFirebaseConfigured || !user) {
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

  const filtered = filter === 'all' ? events : events.filter((e) => e.status === filter);

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
        {(['all', 'Draft', 'Pending', 'UnderReview', 'AmendmentRequested', 'Approved', 'Rejected', 'Withdrawn'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={
              'min-h-10 shrink-0 rounded-md px-3 py-2 text-sm font-semibold ' +
              (filter === f ? 'bg-brand-700 text-cream-50' : 'border border-[#d8cebd] bg-[#fffdf8] text-ink-600 hover:bg-cream-100')
            }
          >
            {f === 'all' ? 'All' : f.replace(/([A-Z])/g, ' $1').trim()}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card"><div className="card-body text-center text-ink-500">Loading applications…</div></div>
      ) : error ? (
        <EmptyState title="Applications unavailable" description={error}><button type="button" className="btn-secondary" onClick={() => { setLoading(true); setRetryKey((value) => value + 1); }}>Try again</button></EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={filter === 'all' ? 'No events yet' : `No events with status "${filter}"`}
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
                <th className="px-4 py-3 font-semibold text-ink-600">Type</th>
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
                    <div className="mt-0.5 text-xs text-ink-500">{e.eventDetails.venueName || 'Venue not set'}</div>
                  </td>
                  <td className="px-4 py-3 capitalize text-ink-600">{e.eventDetails.type}</td>
                  <td className="px-4 py-3 tabular-nums text-ink-600">
                    {e.eventDetails.startDatetime ? format(new Date(e.eventDetails.startDatetime), 'PP') : 'Not scheduled'}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={e.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <Link to={['Draft', 'AmendmentRequested'].includes(e.status) ? `/organizer/events/${e.eventId}/edit` : `/organizer/events/${e.eventId}`} className="text-brand-600 hover:text-brand-700 text-sm font-medium">
                      {['Draft', 'AmendmentRequested'].includes(e.status) ? 'Edit' : 'View'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <ul className="space-y-3 md:hidden">
            {filtered.map((e) => {
              const editable = ['Draft', 'AmendmentRequested'].includes(e.status);
              return <li key={e.eventId}><Link to={editable ? `/organizer/events/${e.eventId}/edit` : `/organizer/events/${e.eventId}`} className="block rounded-lg border border-[#ded5c5] bg-[#fffdf8] p-4 active:bg-cream-100">
                <div className="flex items-start justify-between gap-3"><h2 className="font-display text-base font-bold leading-snug text-ink-800">{e.eventDetails.name || 'Untitled event'}</h2><StatusBadge status={e.status} /></div>
                <div className="mt-3 space-y-1 text-sm text-ink-500"><p className="flex items-center gap-2"><MapPin size={14} />{e.eventDetails.venueName || 'Venue not set'}</p><p className="tabular-nums">{e.eventDetails.startDatetime ? format(new Date(e.eventDetails.startDatetime), 'PP') : 'Not scheduled'}</p></div>
                <div className="mt-4 flex items-center justify-between border-t border-[#e3dacb] pt-3 text-sm font-semibold text-brand-700"><span>{editable ? 'Continue application' : 'View application'}</span><ArrowRight size={16} /></div>
              </Link></li>;
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
