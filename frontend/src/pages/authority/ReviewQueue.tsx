import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { COLLECTIONS, EventRecord, EventStatus } from '@shared/types';
import PageHeader from '../../components/ui/PageHeader';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import { format } from 'date-fns';

export default function ReviewQueue() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<EventStatus | 'all'>('Pending');

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }
    const q = query(
      collection(db, COLLECTIONS.EVENTS),
      where('status', 'in', ['Pending', 'UnderReview', 'AmendmentRequested']),
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
        console.warn('[ReviewQueue] Snapshot error:', err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  const filtered = filter === 'all' ? events : events.filter((e) => e.status === filter);

  return (
    <div>
      <PageHeader
        title="Review Queue"
        description="Real-time list of applications awaiting your review. Updates push live — no refresh needed."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {(['all', 'Pending', 'UnderReview', 'AmendmentRequested'] as const).map((f) => (
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
        <EmptyState title="Queue is clear" description="No applications matching this filter." />
      ) : (
        <ul className="space-y-2">
          {filtered.map((e) => (
            <li key={e.eventId} className="card hover:shadow-md transition-shadow">
              <Link to={`/authority/events/${e.eventId}`} className="card-body block">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-900 truncate">{e.eventDetails.name}</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {e.eventDetails.venueName} · {format(new Date(e.eventDetails.startDatetime), 'PPp')}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Attendance: {e.eventDetails.expectedAttendance} · Type: {e.eventDetails.type}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <StatusBadge status={e.status} />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
