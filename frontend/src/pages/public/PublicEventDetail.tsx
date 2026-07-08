import { Link, useParams } from 'react-router-dom';
import EmptyState from '../../components/ui/EmptyState';
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { COLLECTIONS, PublicEvent } from '@shared/types';
import { format } from 'date-fns';

export default function PublicEventDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isFirebaseConfigured || !eventId) {
      setLoading(false);
      return;
    }
    getDoc(doc(db, COLLECTIONS.PUBLIC_EVENTS, eventId))
      .then((snap) => {
        if (snap.exists()) setEvent(snap.data() as PublicEvent);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [eventId]);

  if (loading) return <div className="p-8 text-center text-slate-500">Loading…</div>;

  if (!event) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <EmptyState
          title="Event not found"
          description="This event may not be publicly listed, or has been removed."
        />
        <div className="mt-4 text-center">
          <Link to="/calendar" className="text-sm text-brand-600">← Back to calendar</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <Link to="/calendar" className="text-sm text-slate-600 hover:text-slate-900">← Back to calendar</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="card">
          <div className="card-body">
            <h1 className="text-2xl font-bold text-slate-900">{event.eventName}</h1>
            <p className="mt-2 text-slate-600">{event.venueName}</p>
            <p className="mt-1 text-sm text-slate-500">
              {format(new Date(event.startDatetime), 'PPp')} → {format(new Date(event.endDatetime), 'PPp')}
            </p>
            <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-100 text-green-800 text-sm">
              ✓ Safety-approved by {event.approvedBy.join(', ')}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
