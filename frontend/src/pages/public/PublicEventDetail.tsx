import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { format } from 'date-fns';
import { CalendarDays, ChevronLeft, Clock3, MapPin, ShieldCheck } from 'lucide-react';
import { COLLECTIONS, PublicEvent } from '@shared/types';
import { db, isFirebaseConfigured } from '../../config/firebase';
import PublicHeader from '../../components/layout/PublicHeader';
import EmptyState from '../../components/ui/EmptyState';

export default function PublicEventDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!isFirebaseConfigured || !eventId) {
      setLoading(false);
      return;
    }
    return onSnapshot(doc(db, COLLECTIONS.PUBLIC_EVENTS, eventId), (snapshot) => {
      setEvent(snapshot.exists() ? snapshot.data() as PublicEvent : null);
      setError('');
      setLoading(false);
    }, () => {
      setError('The approved event could not be loaded.');
      setLoading(false);
    });
  }, [eventId, retryKey]);

  return (
    <div className="min-h-screen bg-[#f4eddf]">
      <PublicHeader />
      <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
        {loading ? <div className="py-24 text-center text-[#6b6555]">Loading approved event...</div> : error ? (
          <div className="py-10"><EmptyState title="Event unavailable" description={error}><button type="button" className="btn-secondary" onClick={() => { setLoading(true); setRetryKey((value) => value + 1); }}>Try again</button></EmptyState></div>
        ) : !event ? (
          <div className="py-10">
            <EmptyState title="Event not publicly listed" description="The event may not be approved, or its public listing has been removed." />
            <div className="mt-5 text-center"><Link to="/calendar" className="text-sm font-semibold text-[#52651c]">Back to approved events</Link></div>
          </div>
        ) : <EventContent event={event} />}
      </main>
    </div>
  );
}

function EventContent({ event }: { event: PublicEvent }) {
  return (
    <>
      <Link to="/calendar" className="inline-flex items-center gap-1 text-sm font-semibold text-[#52651c] hover:text-[#384611]"><ChevronLeft size={16} />Approved events</Link>
      <div className="mt-8 border-b border-[#d9cdb8] pb-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge bg-[#f5ead0] text-[#7e5b13]">{event.eventType}</span>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#46743b]"><ShieldCheck size={15} />Authority approved</span>
        </div>
        <h1 className="mt-4 max-w-4xl font-display text-3xl font-bold text-[#20251d] sm:text-5xl">{event.eventName}</h1>
      </div>

      <div className="grid gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-14">
        <section aria-labelledby="event-schedule">
          <h2 id="event-schedule" className="font-display text-lg font-bold text-[#303528]">Event information</h2>
          <dl className="mt-5 divide-y divide-[#ded4c1] border-y border-[#ded4c1]">
            <Detail icon={<CalendarDays size={18} />} label="Date" value={format(new Date(event.startDatetime), 'EEEE, d MMMM yyyy')} />
            <Detail icon={<Clock3 size={18} />} label="Time" value={`${format(new Date(event.startDatetime), 'p')} – ${format(new Date(event.endDatetime), 'p')}`} />
            <Detail icon={<MapPin size={18} />} label="Venue" value={event.venueName} />
          </dl>
          <p className="mt-5 max-w-2xl text-sm leading-6 text-[#6b6555]">This public listing contains only non-sensitive information from the approved application version.</p>
        </section>

        <aside className="rounded-lg border border-[#ccd8aa] bg-[#edf2dc] p-5">
          <ShieldCheck className="text-[#52651c]" size={24} />
          <h2 className="mt-4 font-display text-base font-bold text-[#303b1a]">Approval confirmed</h2>
          <p className="mt-2 text-sm leading-6 text-[#59643a]">Version {event.versionId.replace(/^v/, '')} completed review by every required authority.</p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {event.approvedBy.map((authority) => <li key={authority} className="badge bg-[#fffdf7] text-[#52651c]">{authority}</li>)}
          </ul>
        </aside>
      </div>
    </>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="grid grid-cols-[1.5rem_5rem_minmax(0,1fr)] gap-3 py-4 text-sm"><span className="text-[#7a8063]">{icon}</span><dt className="font-semibold text-[#6b6555]">{label}</dt><dd className="font-medium text-[#2b3027]">{value}</dd></div>;
}
