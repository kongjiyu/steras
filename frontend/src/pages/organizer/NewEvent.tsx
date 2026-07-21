import PageHeader from '../../components/ui/PageHeader';
import { EVENT_TYPES, EventType, EventDetails } from '@shared/types';
import { useEffect, useState, FormEvent, ChangeEvent } from 'react';
import { arrayRemove, arrayUnion, collection, addDoc, doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { deleteObject, ref, uploadBytesResumable } from 'firebase/storage';
import { db, functions, isFirebaseConfigured, storage } from '../../config/firebase';
import { COLLECTIONS } from '@shared/types';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { useNavigate, useParams } from 'react-router-dom';

export default function NewEvent() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { eventId } = useParams<{ eventId: string }>();
  const [draftId, setDraftId] = useState(eventId ?? '');
  const [editableStatus, setEditableStatus] = useState<'Draft' | 'AmendmentRequested'>('Draft');
  const [currentVersionNumber, setCurrentVersionNumber] = useState(0);
  const [editableVersionId, setEditableVersionId] = useState('v1');
  const [documentPaths, setDocumentPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(Boolean(eventId));
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [form, setForm] = useState<EventDetails>({
    name: '',
    type: 'concert',
    venueName: '',
    venueAddress: '',
    venueCapacity: 0,
    expectedAttendance: 0,
    environment: 'outdoor',
    coverage: 'uncovered',
    seating: 'mixed',
    startDatetime: 0,
    endDatetime: 0,
    description: '',
    emergencyPlanSummary: '',
    organizerName: profile?.name ?? '',
    organizerEmail: profile?.email ?? '',
    organizerPhone: profile?.phone ?? '',
  });

  const update = <K extends keyof EventDetails>(key: K, value: EventDetails[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    if (!eventId || !isFirebaseConfigured) return;
    getDoc(doc(db, COLLECTIONS.EVENTS, eventId)).then((snapshot) => {
      if (!snapshot.exists()) throw new Error('Event draft not found.');
      const data = snapshot.data();
      if (!['Draft', 'AmendmentRequested'].includes(data.status)) throw new Error('This application can no longer be edited.');
      setForm(data.eventDetails as EventDetails);
      setEditableStatus(data.status as 'Draft' | 'AmendmentRequested');
      setCurrentVersionNumber(data.currentVersionNumber ?? 0);
      setEditableVersionId(data.editableVersionId ?? `v${(data.currentVersionNumber ?? 0) + 1}`);
      setDocumentPaths(data.draftDocumentPaths ?? []);
    }).catch((error) => {
      toast.error(error instanceof Error ? error.message : 'Unable to load draft.');
      navigate('/organizer/events');
    }).finally(() => setLoading(false));
  }, [eventId, navigate]);

  const ensureDraft = async () => {
    if (!user) throw new Error('Sign in before saving a draft.');
    const now = Date.now();
    if (draftId) {
      await updateDoc(doc(db, COLLECTIONS.EVENTS, draftId), { eventDetails: form, draftDocumentPaths: documentPaths, updatedAt: now });
      return draftId;
    }
    const nextVersionId = `v${currentVersionNumber + 1}`;
    const reference = await addDoc(collection(db, COLLECTIONS.EVENTS), {
      organizerId: user.uid,
      eventDetails: form,
      status: 'Draft',
      currentVersionNumber,
      editableVersionId: nextVersionId,
      draftDocumentPaths: [],
      requiredAuthorities: [],
      createdAt: now,
      updatedAt: now,
      _serverCreatedAt: serverTimestamp(),
    });
    setDraftId(reference.id);
    setEditableVersionId(nextVersionId);
    window.history.replaceState(null, '', `/organizer/events/${reference.id}/edit`);
    return reference.id;
  };

  const handleSaveDraft = async () => {
    if (!isFirebaseConfigured) return toast.error('Firebase is not configured.');
    setSaving(true);
    try {
      await ensureDraft();
      toast.success('Draft saved.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Draft save failed.');
    } finally {
      setSaving(false);
    }
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
      const id = await ensureDraft();
      const submit = httpsCallable<{ eventId: string }, { versionId: string }>(functions, 'submitEvent');
      await submit({ eventId: id });
      toast.success('Event submitted. The risk assessment will run shortly.');
      navigate(`/organizer/events/${id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Submission failed';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async () => {
    if (!draftId || !window.confirm('Withdraw this draft?')) return;
    setSubmitting(true);
    try {
      const command = httpsCallable<{ eventId: string }>(functions, 'withdrawEvent');
      await command({ eventId: draftId });
      toast.success('Draft withdrawn.');
      navigate('/organizer/events');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Withdrawal failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    if (files.length === 0) return;
    const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
    const invalid = files.find((file) => file.size === 0 || file.size > 10 * 1024 * 1024 || !allowedTypes.has(file.type));
    if (invalid) return toast.error(`${invalid.name} must be a non-empty PDF, JPEG, PNG, or WebP file no larger than 10 MB.`);
    setUploading(true);
    try {
      const id = await ensureDraft();
      const uploaded: string[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `event_documents/${id}/${editableVersionId}/${crypto.randomUUID()}-${safeName}`;
        const task = uploadBytesResumable(ref(storage, path), file, { contentType: file.type });
        await new Promise<void>((resolve, reject) => task.on('state_changed', (snapshot) => {
          const fileProgress = snapshot.bytesTransferred / snapshot.totalBytes;
          setUploadProgress(Math.round(((index + fileProgress) / files.length) * 100));
        }, reject, resolve));
        uploaded.push(path);
        await updateDoc(doc(db, COLLECTIONS.EVENTS, id), { draftDocumentPaths: arrayUnion(path), updatedAt: Date.now() });
        setDocumentPaths((current) => [...current, path]);
      }
      toast.success(`${uploaded.length} document${uploaded.length === 1 ? '' : 's'} uploaded.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Document upload failed.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      event.target.value = '';
    }
  };

  const removeDocument = async (path: string) => {
    if (!draftId || !path.startsWith(`event_documents/${draftId}/${editableVersionId}/`)) return;
    try {
      await deleteObject(ref(storage, path));
      await updateDoc(doc(db, COLLECTIONS.EVENTS, draftId), { draftDocumentPaths: arrayRemove(path), updatedAt: Date.now() });
      setDocumentPaths((current) => current.filter((item) => item !== path));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to remove document.');
    }
  };

  const toDatetimeLocal = (epoch: number) => {
    if (!epoch) return '';
    const d = new Date(epoch);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const fromDatetimeLocal = (v: string) => (v ? new Date(v).getTime() : 0);

  if (loading) return <div className="py-16 text-center text-ink-500">Loading application…</div>;

  return (
    <div>
      <PageHeader
        title={draftId ? 'Edit Event Application' : 'New Event Application'}
        description="Complete the operational details and supporting evidence used for deterministic assessment and bounded M3 refinement."
      />

      <form onSubmit={handleSubmit} className="overflow-hidden rounded-lg border border-[#ded5c5] bg-[#fffdf8] shadow-card">
        <div className="border-b border-[#e3dacb] bg-brand-50 px-4 py-4 sm:px-6">
          <p className="text-xs font-bold uppercase tracking-[0.07em] text-brand-700">Application {editableVersionId}</p>
          <p className="mt-1 text-sm text-ink-500">Fields marked * are required. Save a draft at any time before submission.</p>
        </div>
        <div className="space-y-8 p-4 sm:p-6 lg:p-8">
          <fieldset className="space-y-5">
            <legend className="section-title mb-5">Event and venue</legend>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="event-name" className="field-label">Event name *</label>
                <input id="event-name" className="input mt-1" required value={form.name} onChange={(e) => update('name', e.target.value)} />
              </div>
              <div>
                <label htmlFor="event-type" className="field-label">Event type *</label>
                <select id="event-type" className="input mt-1" value={form.type} onChange={(e) => update('type', e.target.value as EventType)}>
                  {EVENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="venue-name" className="field-label">Venue name *</label>
                <input id="venue-name" className="input mt-1" required value={form.venueName} onChange={(e) => update('venueName', e.target.value)} />
              </div>
              <div>
                <label htmlFor="venue-capacity" className="field-label">Venue capacity *</label>
                <input id="venue-capacity" type="number" min={1} className="input mt-1" required value={form.venueCapacity || ''} onChange={(e) => update('venueCapacity', Number(e.target.value))} />
              </div>
            </div>

            <div>
              <label htmlFor="venue-address" className="field-label">Venue address *</label>
              <input id="venue-address" className="input mt-1" required value={form.venueAddress} onChange={(e) => update('venueAddress', e.target.value)} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="venue-latitude" className="field-label">Latitude *</label>
                <input id="venue-latitude" type="number" step="any" min={-90} max={90} className="input mt-1" required value={form.venueLocation?.lat ?? ''} onChange={(e) => update('venueLocation', { lat: Number(e.target.value), lng: form.venueLocation?.lng ?? 0 })} />
              </div>
              <div>
                <label htmlFor="venue-longitude" className="field-label">Longitude *</label>
                <input id="venue-longitude" type="number" step="any" min={-180} max={180} className="input mt-1" required value={form.venueLocation?.lng ?? ''} onChange={(e) => update('venueLocation', { lat: form.venueLocation?.lat ?? 0, lng: Number(e.target.value) })} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="expected-attendance" className="field-label">Expected attendance *</label>
                <input id="expected-attendance" type="number" min={1} className="input mt-1" required value={form.expectedAttendance || ''} onChange={(e) => update('expectedAttendance', Number(e.target.value))} />
                {form.venueCapacity > 0 && form.expectedAttendance > form.venueCapacity && <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">Attendance exceeds the declared venue capacity and will increase the crowd-risk score.</p>}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="event-environment" className="field-label">Environment *</label>
                <select id="event-environment" className="input mt-1" value={form.environment} onChange={(e) => update('environment', e.target.value as EventDetails['environment'])}>
                  <option value="indoor">Indoor</option><option value="outdoor">Outdoor</option><option value="mixed">Mixed</option>
                </select>
              </div>
              <div>
                <label htmlFor="event-coverage" className="field-label">Coverage *</label>
                <select id="event-coverage" className="input mt-1" value={form.coverage} onChange={(e) => update('coverage', e.target.value as EventDetails['coverage'])}>
                  <option value="covered">Covered</option><option value="partially_covered">Partially covered</option><option value="uncovered">Uncovered</option>
                </select>
              </div>
              <div>
                <label htmlFor="event-seating" className="field-label">Seating *</label>
                <select id="event-seating" className="input mt-1" value={form.seating} onChange={(e) => update('seating', e.target.value as EventDetails['seating'])}>
                  <option value="seated">Seated</option><option value="standing">Standing</option><option value="mixed">Mixed</option>
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="start-datetime" className="field-label">Start date and time *</label>
                <input id="start-datetime" type="datetime-local" className="input mt-1" required value={toDatetimeLocal(form.startDatetime)} onChange={(e) => update('startDatetime', fromDatetimeLocal(e.target.value))} />
              </div>
              <div>
                <label htmlFor="end-datetime" className="field-label">End date and time *</label>
                <input id="end-datetime" type="datetime-local" className="input mt-1" required value={toDatetimeLocal(form.endDatetime)} onChange={(e) => update('endDatetime', fromDatetimeLocal(e.target.value))} />
              </div>
            </div>

            <div>
              <label htmlFor="event-description" className="field-label">Description <span className="font-normal text-ink-400">(optional)</span></label>
              <textarea id="event-description" className="input mt-1" rows={3} maxLength={2000} value={form.description} onChange={(e) => update('description', e.target.value)} />
            </div>
            <div>
              <label htmlFor="emergency-plan" className="field-label">Emergency plan summary *</label>
              <textarea id="emergency-plan" className="input mt-1" rows={3} maxLength={2000} required value={form.emergencyPlanSummary} onChange={(e) => update('emergencyPlanSummary', e.target.value)} />
            </div>
          </fieldset>

          <fieldset className="space-y-4 border-t border-[#e3dacb] pt-8">
            <legend className="section-title mb-2 pr-4">Supporting evidence</legend>
            <p className="text-sm leading-6 text-ink-500">Upload PDF, JPEG, PNG, or WebP files up to 10 MB each. Submitted files are locked to this application version.</p>
            <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[#b9ad97] bg-cream-50 px-4 py-5 text-center text-sm font-semibold text-brand-700 hover:bg-cream-100">
              <span>{uploading ? `Uploading ${uploadProgress}%` : 'Choose supporting files'}</span>
              <span className="mt-1 text-xs font-normal text-ink-500">Multiple files are supported</span>
              <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={handleFiles} disabled={uploading} className="sr-only" />
            </label>
            {uploading && <div className="h-1.5 overflow-hidden rounded bg-cream-200"><div className="h-full bg-brand-600 transition-transform" style={{ transform: `scaleX(${uploadProgress / 100})`, transformOrigin: 'left' }} /></div>}
            {documentPaths.length > 0 && <ul className="divide-y divide-[#e3dacb] rounded-md border border-[#ded5c5]">{documentPaths.map((path) => (
              <li key={path} className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span className="min-w-0 truncate">{documentName(path)}</span><button type="button" onClick={() => removeDocument(path)} className="min-h-11 px-2 font-semibold text-red-700 hover:text-red-800">Remove</button></li>
            ))}</ul>}
          </fieldset>

          <fieldset className="space-y-4 border-t border-[#e3dacb] pt-8">
            <legend className="section-title mb-2 pr-4">Organizer contact</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="organizer-name" className="field-label">Organizer name *</label>
                <input id="organizer-name" className="input mt-1" required value={form.organizerName} onChange={(e) => update('organizerName', e.target.value)} />
              </div>
              <div>
                <label htmlFor="organizer-email" className="field-label">Email *</label>
                <input id="organizer-email" type="email" className="input mt-1" required value={form.organizerEmail} onChange={(e) => update('organizerEmail', e.target.value)} />
              </div>
              <div>
                <label htmlFor="organizer-phone" className="field-label">Phone *</label>
                <input id="organizer-phone" type="tel" className="input mt-1" required value={form.organizerPhone} onChange={(e) => update('organizerPhone', e.target.value)} />
              </div>
            </div>
          </fieldset>

          <div className="sticky bottom-20 z-10 -mx-4 flex flex-wrap justify-end gap-2 border-t border-[#d8cebd] bg-[#fffdf8]/95 px-4 pb-1 pt-4 backdrop-blur-sm sm:static sm:mx-0 sm:px-0 md:bottom-0">
            {draftId && editableStatus === 'Draft' && <button type="button" disabled={submitting || saving || uploading} className="mr-auto min-h-11 rounded-md border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50" onClick={handleWithdraw}>Withdraw draft</button>}
            <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
            <button type="button" disabled={saving || submitting || uploading} className="btn-secondary" onClick={handleSaveDraft}>{saving ? 'Saving...' : 'Save draft'}</button>
            <button type="submit" disabled={submitting || saving || uploading} className="btn-primary">
              {submitting ? 'Submitting…' : 'Submit application'}
            </button>
          </div>
        </div>
      </form>

    </div>
  );
}

function documentName(path: string): string {
  const encoded = path.split('/').pop() ?? 'supporting-file';
  return decodeURIComponent(encoded).replace(/^[0-9a-f]{8}-[0-9a-f-]{27}-/i, '');
}
