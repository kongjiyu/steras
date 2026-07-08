import { Link } from 'react-router-dom';
import EmptyState from '../../components/ui/EmptyState';
import PageHeader from '../../components/ui/PageHeader';
import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { COLLECTIONS, PublicEvent } from '@shared/types';
import { format } from 'date-fns';

export default function PublicCalendar() {
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }
    const q = query(collection(db, COLLECTIONS.PUBLIC_EVENTS), where('publicStatus', '==', 'approved'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setEvents(snap.docs.map((d) => d.data() as PublicEvent));
        setLoading(false);
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.warn('[PublicCalendar] Snapshot error:', err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-brand-600 text-white flex items-center justify-center font-bold text-sm">S</div>
            <span className="font-semibold">STERAS</span>
          </Link>
          <Link to="/" className="text-sm text-slate-600 hover:text-slate-900">← Back to home</Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <PageHeader
          title="Approved Tourism Events"
          description="Public calendar of safety-approved events. No login required."
        />

        {loading ? (
          <div className="card"><div className="card-body text-center text-slate-500">Loading…</div></div>
        ) : events.length === 0 ? (
          <EmptyState
            title="No approved events yet"
            description="Once authority officers approve an event, it will appear here for public awareness."
          />
        ) : (
          <ul className="space-y-3">
            {events.map((e) => (
              <li key={e.eventId} className="card">
                <div className="card-body flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-900">{e.eventName}</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {e.venueName} · {format(new Date(e.startDatetime), 'PPp')}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      Approved by: {e.approvedBy.join(', ')}
                    </p>
                  </div>
                  <Link to={`/events/${e.eventId}`} className="text-sm text-brand-600 hover:text-brand-700">
                    Details →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
