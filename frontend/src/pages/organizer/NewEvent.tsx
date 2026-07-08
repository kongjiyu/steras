import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import { EVENT_TYPES, EventType, EventDetails } from '@shared/types';
import { useState, FormEvent } from 'react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { COLLECTIONS } from '@shared/types';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

export default function NewEvent() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState<EventDetails>({
    name: '',
    type: 'concert',
    venueName: '',
    venueAddress: '',
    venueCapacity: 0,
    expectedAttendance: 0,
    startDatetime: 0,
    endDatetime: 0,
    description: '',
    organizerName: profile?.name ?? '',
    organizerContact: profile?.email ?? '',
  });

  const update = <K extends keyof EventDetails>(key: K, value: EventDetails[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!isFirebaseConfigured) {
      toast.error('Firebase is not configured. Submission disabled.');
      return;
    }
    if (form.endDatetime <= form.startDatetime) {
      toast.error('End datetime must be after start datetime.');
      return;
    }
    setSubmitting(true);
    try {
      const now = Date.now();
      const docRef = await addDoc(collection(db, COLLECTIONS.EVENTS), {
        organizerId: user.uid,
        eventDetails: form,
        status: 'Pending',
        createdAt: now,
        updatedAt: now,
        _serverCreatedAt: serverTimestamp(),
      });
      toast.success('Event submitted. AI + rule-based engines will run shortly.');
      navigate(`/organizer/events/${docRef.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Submission failed';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const toDatetimeLocal = (epoch: number) => {
    if (!epoch) return '';
    const d = new Date(epoch);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const fromDatetimeLocal = (v: string) => (v ? new Date(v).getTime() : 0);

  return (
    <div>
      <PageHeader
        title="New Event Application"
        description="Submit event details. AI prediction + rule-based risk scoring will run automatically."
      />

      <form onSubmit={handleSubmit} className="card">
        <div className="card-body space-y-6">
          <fieldset className="space-y-4">
            <legend className="font-semibold text-slate-900">Event details</legend>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Event name *</label>
                <input className="input mt-1" required value={form.name} onChange={(e) => update('name', e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Event type *</label>
                <select className="input mt-1" value={form.type} onChange={(e) => update('type', e.target.value as EventType)}>
                  {EVENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Venue name *</label>
                <input className="input mt-1" required value={form.venueName} onChange={(e) => update('venueName', e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Venue capacity *</label>
                <input type="number" min={1} className="input mt-1" required value={form.venueCapacity || ''} onChange={(e) => update('venueCapacity', Number(e.target.value))} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700">Venue address *</label>
              <input className="input mt-1" required value={form.venueAddress} onChange={(e) => update('venueAddress', e.target.value)} />
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Expected attendance *</label>
                <input type="number" min={1} className="input mt-1" required value={form.expectedAttendance || ''} onChange={(e) => update('expectedAttendance', Number(e.target.value))} />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Start datetime *</label>
                <input type="datetime-local" className="input mt-1" required value={toDatetimeLocal(form.startDatetime)} onChange={(e) => update('startDatetime', fromDatetimeLocal(e.target.value))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">End datetime *</label>
                <input type="datetime-local" className="input mt-1" required value={toDatetimeLocal(form.endDatetime)} onChange={(e) => update('endDatetime', fromDatetimeLocal(e.target.value))} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700">Description (optional)</label>
              <textarea className="input mt-1" rows={3} value={form.description} onChange={(e) => update('description', e.target.value)} />
            </div>
          </fieldset>

          <fieldset className="space-y-4 border-t border-slate-200 pt-6">
            <legend className="font-semibold text-slate-900">Organizer contact</legend>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Organizer name *</label>
                <input className="input mt-1" required value={form.organizerName} onChange={(e) => update('organizerName', e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Contact (phone or email) *</label>
                <input className="input mt-1" required value={form.organizerContact} onChange={(e) => update('organizerContact', e.target.value)} />
              </div>
            </div>
          </fieldset>

          <div className="border-t border-slate-200 pt-6 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? 'Submitting…' : 'Submit Application'}
            </button>
          </div>
        </div>
      </form>

      <div className="mt-4">
        <EmptyState
          title="Module 1 — basic form ready"
          description="Cloud Functions (Module 2 + 3) will run automatically on submission. Wiring is in functions/src/triggers/onEventCreated.ts."
        />
      </div>
    </div>
  );
}
