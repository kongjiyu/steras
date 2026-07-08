import { useEffect, useState } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { COLLECTIONS, EventRecord, EventStatus } from '@shared/types';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/ui/PageHeader';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import { format } from 'date-fns';

export default function MyEvents() {
  const { user } = useAuth();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<EventStatus | 'all'>('all');

  useEffect(() => {
    if (!isFirebaseConfigured || !user) {
      setLoading(false);
      return;
    }
    const q = query(
      collection(db, COLLECTIONS.EVENTS),
      where('organizerId', '==', user.uid),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setEvents(snap.docs.map((d) => ({ eventId: d.id, ...d.data() }) as EventRecord));
        setLoading(false);
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.warn('[MyEvents] Snapshot error:', err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [user]);

  const filtered = filter === 'all' ? events : events.filter((e) => e.status === filter);

  return (
    <div>
      <PageHeader
        title="My Events"
        description="Real-time list of your submitted events. Status updates push live via Firestore."
        action={
          <Link to="/organizer/events/new" className="btn-primary">+ New Event</Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {(['all', 'Pending', 'UnderReview', 'AmendmentRequested', 'Approved', 'Rejected'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={
              'px-3 py-1 rounded-full text-sm ' +
              (filter === f ? 'bg-brand-600 text-white' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50')
            }
          >
            {f === 'all' ? 'All' : f.replace(/([A-Z])/g, ' $1').trim()}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card"><div className="card-body text-center text-slate-500">Loading…</div></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={filter === 'all' ? 'No events yet' : `No events with status "${filter}"`}
          description="Submit your first event application to get started."
          children={<Link to="/organizer/events/new" className="btn-primary">+ New Event</Link>}
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium text-slate-600">Event</th>
                <th className="px-4 py-3 font-medium text-slate-600">Type</th>
                <th className="px-4 py-3 font-medium text-slate-600">Date</th>
                <th className="px-4 py-3 font-medium text-slate-600">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((e) => (
                <tr key={e.eventId} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{e.eventDetails.name}</div>
                    <div className="text-xs text-slate-500">{e.eventDetails.venueName}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{e.eventDetails.type}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {format(new Date(e.eventDetails.startDatetime), 'PP')}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={e.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/organizer/events/${e.eventId}`} className="text-brand-600 hover:text-brand-700 text-sm font-medium">
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
