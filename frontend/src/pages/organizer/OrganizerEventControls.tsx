/**
 * OrganizerEventControls — M3 Workstream 2 organizer page.
 *
 * Read-only view of the per-authority event control list (UC-34:
 * "Display Stage 1 and Stage 2 Requirements"). Shows the organizer what
 * Stage 1 + Stage 2 evidence they need to gather for each authority
 * once the admin has generated + committed the control list.
 *
 * No mutations. UC-28 (organiser uploads Stage 1 docs) is Workstream 3
 * and ships separately.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { ClipboardList, Image as ImageIcon, Info } from 'lucide-react';
import {
  COLLECTIONS,
  EventRecord,
} from '@shared/types';
import { db } from '../../config/firebase';
import EmptyState from '../../components/ui/EmptyState';
import StatusBadge from '../../components/ui/StatusBadge';

export default function OrganizerEventControls() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!eventId) return;
    // Firebase service calls will throw with a clear "not configured" error
    // if the env is missing, so we don't need a separate configured check here.
    return onSnapshot(doc(db, COLLECTIONS.EVENTS, eventId), (snapshot) => {
      if (snapshot.exists()) {
        setEvent({ eventId: snapshot.id, ...(snapshot.data() as Partial<EventRecord>) } as EventRecord);
      } else {
        setEvent(null);
      }
      setLoading(false);
    }, (err: unknown) => {
      console.warn('[OrganizerEventControls] event subscribe failed', err);
      setLoadError('The event could not be loaded.');
      setLoading(false);
    });
  }, [eventId]);

  if (loading) return <div className="p-8 text-ink-500">Loading event...</div>;
  if (loadError) return <div className="p-8"><EmptyState title="Event unavailable" description={loadError} /></div>;
  if (!event) return <div className="p-8"><EmptyState title="Event not found" /></div>;

  const details = event.eventDetails;
  const snapshot = event.controlListSnapshot ?? [];
  const generated = event.controlListGenerated === true;

  return (
    <div className="p-5 sm:p-8">
      <Link to={`/organizer/events/${eventId}`} className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">
        ← Back to event
      </Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-800">Event controls</h1>
          <p className="mt-1 text-sm text-ink-500">{details.name} · {details.venueName}</p>
          <p className="mt-1 text-xs text-ink-400">
            {snapshot.length} control{snapshot.length === 1 ? '' : 's'} declared
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge status={event.status} />
          {generated && <span className="text-xs font-semibold text-status-approved">List published</span>}
        </div>
      </div>

      {!generated ? (
        <div className="card">
          <div className="card-body space-y-3">
            <div className="flex items-start gap-2 text-ink-700">
              <Info size={18} className="mt-0.5 text-ink-500" />
              <div>
                <p className="font-semibold">The admin hasn't published the control list yet.</p>
                <p className="mt-1 text-sm text-ink-600">
                  Once the admin generates + commits the per-authority control list, you'll see the Stage 1 + Stage 2 evidence requirements here and can start uploading.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4" data-testid="organizer-event-controls-list">
          {snapshot.map((s) => (
            <section key={s.controlId} className="card" data-testid={`organizer-control-${s.authority}`}>
              <div className="card-header flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <ClipboardList size={16} className="text-brand-700" />
                  <h2 className="font-semibold">{s.controlName}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className="badge bg-blue-100 text-brand-700 text-xs">{s.authority}</span>
                  <span className="badge bg-ink-100 text-ink-600 text-xs">{s.stageRequirement}</span>
                </div>
              </div>
              <div className="card-body space-y-3 text-sm text-ink-700">
                <p>
                  <span className="font-semibold">Stage 1 documents required:</span> {s.stage1RequirementsCount} item{s.stage1RequirementsCount === 1 ? '' : 's'}.
                  (Per-item detail lives in the per-control Stage 1 doc slots — the admin controls the requirements list.)
                </p>
                {s.stage2Label && (
                  <p className="flex items-start gap-2">
                    <ImageIcon size={16} className="mt-0.5 text-ink-500" />
                    <span>
                      <span className="font-semibold">Stage 2 (visual evidence):</span> {s.stage2Label}
                    </span>
                  </p>
                )}
                <p className="text-xs text-ink-500">
                  Once the admin's review of Stage 1 docs is in progress, you'll be able to upload files here. (Workstream 3 — FR-M3-20.)
                </p>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
