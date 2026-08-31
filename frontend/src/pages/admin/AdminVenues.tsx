import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import { CheckCircle2, Edit3, MapPin, Plus, ShieldCheck, X, XCircle } from 'lucide-react';
import { COLLECTIONS, Venue } from '@shared/types';
import { db, functions, isFirebaseConfigured } from '../../config/firebase';
import { WorkspaceTopBar } from '../../components/layout/Sidebar';
import { useAuth } from '../../contexts/AuthContext';

interface VenueForm {
  name: string; address: string; state: string; jurisdiction: string; capacity: string;
  lat: string; lng: string; verifiedSafeCapacity: string; fireCertificateStatus: NonNullable<Venue['fireCertificateStatus']>;
  fireCertificateExpiresAt: string; nearestHospitalTravelMinutes: string; emergencyAccessVerified: '' | 'true' | 'false'; riskNotes: string;
}
const EMPTY_FORM: VenueForm = { name: '', address: '', state: '', jurisdiction: '', capacity: '', lat: '', lng: '', verifiedSafeCapacity: '', fireCertificateStatus: 'unknown', fireCertificateExpiresAt: '', nearestHospitalTravelMinutes: '', emergencyAccessVerified: '', riskNotes: '' };

function initialsFor(name?: string) { return name ? name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() : 'AD'; }
function dateInput(timestamp?: number) { return timestamp ? new Date(timestamp).toISOString().slice(0, 10) : ''; }

export default function AdminVenues() {
  const { profile } = useAuth();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Venue | null | undefined>(undefined);
  const [form, setForm] = useState<VenueForm>(EMPTY_FORM);
  const [mutationKey, setMutationKey] = useState(() => crypto.randomUUID());
  const commandKeys = useRef(new Map<string, string>());
  const [saving, setSaving] = useState(false);
  const [busyVenueId, setBusyVenueId] = useState<string>();
  const visible = useMemo(() => venues.filter((venue) => showInactive || venue.active), [venues, showInactive]);

  useEffect(() => {
    if (!isFirebaseConfigured) { setLoading(false); return undefined; }
    return onSnapshot(collection(db, COLLECTIONS.VENUES), (snapshot) => {
      setVenues(snapshot.docs.map((document) => ({ venueId: document.id, ...document.data() }) as Venue).sort((a, b) => a.name.localeCompare(b.name)));
      setLoading(false);
    }, () => { toast.error('Unable to load venue registry.'); setLoading(false); });
  }, []);

  const openCreate = () => { setForm(EMPTY_FORM); setMutationKey(crypto.randomUUID()); setEditing(null); };
  const openEdit = (venue: Venue) => {
    setEditing(venue);
    setMutationKey(crypto.randomUUID());
    setForm({
      name: venue.name, address: venue.address, state: venue.state ?? '', jurisdiction: venue.jurisdiction ?? '', capacity: String(venue.capacity),
      lat: String(venue.location.lat), lng: String(venue.location.lng), verifiedSafeCapacity: venue.verifiedSafeCapacity ? String(venue.verifiedSafeCapacity) : '',
      fireCertificateStatus: venue.fireCertificateStatus ?? 'unknown', fireCertificateExpiresAt: dateInput(venue.fireCertificateExpiresAt),
      nearestHospitalTravelMinutes: venue.nearestHospitalTravelMinutes ? String(venue.nearestHospitalTravelMinutes) : '',
      emergencyAccessVerified: typeof venue.emergencyAccessVerified === 'boolean' ? String(venue.emergencyAccessVerified) as 'true' | 'false' : '', riskNotes: venue.riskNotes ?? '',
    });
  };
  const update = <K extends keyof VenueForm>(key: K, value: VenueForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      await httpsCallable(functions, 'saveVenue')({
        ...(editing ? { venueId: editing.venueId, expectedRevision: editing.revision ?? 0 } : {}),
        idempotencyKey: mutationKey, name: form.name, address: form.address, state: form.state, jurisdiction: form.jurisdiction,
        capacity: Number(form.capacity), location: { lat: Number(form.lat), lng: Number(form.lng) },
        ...(form.verifiedSafeCapacity ? { verifiedSafeCapacity: Number(form.verifiedSafeCapacity) } : {}),
        fireCertificateStatus: form.fireCertificateStatus,
        ...(form.fireCertificateExpiresAt ? { fireCertificateExpiresAt: new Date(`${form.fireCertificateExpiresAt}T23:59:59.999Z`).getTime() } : {}),
        ...(form.nearestHospitalTravelMinutes ? { nearestHospitalTravelMinutes: Number(form.nearestHospitalTravelMinutes) } : {}),
        ...(form.emergencyAccessVerified ? { emergencyAccessVerified: form.emergencyAccessVerified === 'true' } : {}),
        ...(form.riskNotes.trim() ? { riskNotes: form.riskNotes } : {}),
      });
      toast.success(editing ? 'Venue updated; verification must be renewed.' : 'Venue created as unverified.'); setMutationKey(crypto.randomUUID()); setEditing(undefined);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to save venue.'); }
    finally { setSaving(false); }
  };

  const command = async (venue: Venue, action: 'verifyVenue' | 'deactivateVenue') => {
    if (action === 'deactivateVenue' && !window.confirm(`Deactivate ${venue.name}? Organisers will no longer be able to select it.`)) return;
    setBusyVenueId(venue.venueId);
    const keyId = `${action}:${venue.venueId}:${venue.revision ?? 0}`;
    const idempotencyKey = commandKeys.current.get(keyId) ?? crypto.randomUUID();
    commandKeys.current.set(keyId, idempotencyKey);
    try {
      await httpsCallable(functions, action)({ venueId: venue.venueId, expectedRevision: venue.revision ?? 0, idempotencyKey });
      commandKeys.current.delete(keyId);
      toast.success(action === 'verifyVenue' ? 'Venue verified and available to organisers.' : 'Venue deactivated.');
    } catch (error) { toast.error(error instanceof Error ? error.message : `Unable to ${action === 'verifyVenue' ? 'verify' : 'deactivate'} venue.`); }
    finally { setBusyVenueId(undefined); }
  };

  return (
    <div className="min-h-screen bg-[#f3f1e9] pb-16">
      <WorkspaceTopBar title="Venue registry" subtitle="Create, update, verify and deactivate canonical venues" userInitials={initialsFor(profile?.name)} workspaceEyebrow="STERAS administration" workspaceEyebrowIcon={ShieldCheck} />
      <main className="page-shell page-enter">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><label className="flex min-h-11 items-center gap-2 text-sm font-medium text-ink-700"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /> Show deactivated venues</label><button type="button" className="btn-primary min-h-11" onClick={openCreate}><Plus size={16} /> Add venue</button></div>
        <section className="overflow-x-auto rounded-lg border border-[#ded5c5] bg-white shadow-card"><div className="min-w-[900px]">
          <header className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,2fr)_7rem_8rem_7rem_13rem] gap-3 border-b border-[#e8e0cf] bg-cream-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-500"><span>Venue</span><span>Address / state</span><span>Capacity</span><span>Verification</span><span>Status</span><span>Actions</span></header>
          {loading ? <p className="p-5 text-sm text-ink-500">Loading venues…</p> : visible.length === 0 ? <div className="flex flex-col items-center gap-2 p-10 text-center"><MapPin size={28} className="text-ink-400" /><p className="text-sm text-ink-500">No venues match this view.</p></div> : <ul className="divide-y divide-[#e8e0cf]">{visible.map((venue) => <li key={venue.venueId} className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,2fr)_7rem_8rem_7rem_13rem] items-center gap-3 px-4 py-3 text-sm">
            <div><p className="font-semibold text-ink-900">{venue.name}</p><p className="text-xs text-ink-500">rev {venue.revision ?? 0}</p></div><span className="text-ink-700">{venue.address}<span className="mt-0.5 block text-xs text-ink-500">{venue.state ?? 'State not recorded'}</span></span><span>{venue.capacity.toLocaleString()}</span><span className={venue.verificationStatus === 'verified' ? 'admin-badge admin-badge--good' : 'admin-badge admin-badge--warn'}>{venue.verificationStatus ?? 'legacy'}</span><span className={venue.active ? 'admin-badge admin-badge--good' : 'admin-badge admin-badge--default'}>{venue.active ? 'active' : 'inactive'}</span>
            <div className="flex gap-2"><button type="button" className="btn-secondary min-h-9 px-2 text-xs" disabled={!venue.active || busyVenueId === venue.venueId} onClick={() => openEdit(venue)}><Edit3 size={14} /> Edit</button>{venue.active && venue.verificationStatus !== 'verified' && <button type="button" className="btn-secondary min-h-9 px-2 text-xs" disabled={busyVenueId === venue.venueId} onClick={() => command(venue, 'verifyVenue')}><CheckCircle2 size={14} /> Verify</button>}{venue.active && <button type="button" className="min-h-9 rounded-md border border-red-200 px-2 text-xs font-semibold text-red-700 hover:bg-red-50" disabled={busyVenueId === venue.venueId} onClick={() => command(venue, 'deactivateVenue')}><XCircle size={14} className="inline" /> Deactivate</button>}</div>
          </li>)}</ul>}
        </div></section>
        <p className="mt-3 text-xs text-ink-500">Only active, verified venues appear in the organiser application. Editing canonical data resets verification so a second explicit verification is required.</p>
      </main>

      {editing !== undefined && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="venue-form-title"><form onSubmit={save} className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-ink-200 bg-white p-5 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><h2 id="venue-form-title" className="font-display text-xl font-bold text-ink-900">{editing ? 'Update venue' : 'Create venue'}</h2><p className="mt-1 text-sm text-ink-500">Canonical identity, coordinates and safety verification inputs.</p></div><button type="button" className="rounded p-2 text-ink-500 hover:bg-cream-50" aria-label="Close" onClick={() => !saving && setEditing(undefined)}><X size={20} /></button></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Venue name" value={form.name} onChange={(value) => update('name', value)} minLength={2} maxLength={200} />
          <Field label="State" value={form.state} onChange={(value) => update('state', value)} minLength={2} maxLength={100} />
          <label className="field-label sm:col-span-2">Address<textarea className="input mt-1 min-h-20" required minLength={5} maxLength={500} value={form.address} onChange={(event) => update('address', event.target.value)} /></label>
          <Field label="Jurisdiction" value={form.jurisdiction} onChange={(value) => update('jurisdiction', value)} minLength={2} maxLength={120} />
          <NumberField label="Maximum capacity" value={form.capacity} onChange={(value) => update('capacity', value)} min={1} max={1_000_000} />
          <NumberField label="Latitude" value={form.lat} onChange={(value) => update('lat', value)} min={-90} max={90} step="any" />
          <NumberField label="Longitude" value={form.lng} onChange={(value) => update('lng', value)} min={-180} max={180} step="any" />
          <NumberField label="Verified safe capacity" value={form.verifiedSafeCapacity} onChange={(value) => update('verifiedSafeCapacity', value)} min={1} max={Number(form.capacity) || 1_000_000} optional />
          <label className="field-label">Fire certificate status<select className="input mt-1" value={form.fireCertificateStatus} onChange={(event) => update('fireCertificateStatus', event.target.value as VenueForm['fireCertificateStatus'])}><option value="unknown">Unknown</option><option value="valid">Valid</option><option value="expired">Expired</option><option value="not_required">Not required</option></select></label>
          <label className="field-label">Fire certificate expiry<input className="input mt-1" type="date" disabled={form.fireCertificateStatus === 'not_required'} required={form.fireCertificateStatus === 'valid'} value={form.fireCertificateStatus === 'not_required' ? '' : form.fireCertificateExpiresAt} onChange={(event) => update('fireCertificateExpiresAt', event.target.value)} /></label>
          <NumberField label="Nearest hospital travel (minutes)" value={form.nearestHospitalTravelMinutes} onChange={(value) => update('nearestHospitalTravelMinutes', value)} min={1} max={240} optional />
          <label className="field-label">Emergency access checked<select className="input mt-1" value={form.emergencyAccessVerified} onChange={(event) => update('emergencyAccessVerified', event.target.value as VenueForm['emergencyAccessVerified'])}><option value="">Not recorded</option><option value="true">Verified</option><option value="false">Checked — not verified</option></select></label>
          <label className="field-label sm:col-span-2">Risk notes (optional)<textarea className="input mt-1 min-h-20" maxLength={1000} value={form.riskNotes} onChange={(event) => update('riskNotes', event.target.value)} /></label>
        </div>
        <div className="mt-6 flex justify-end gap-3"><button type="button" className="btn-secondary" disabled={saving} onClick={() => setEditing(undefined)}>Cancel</button><button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save and reset verification' : 'Create unverified venue'}</button></div>
      </form></div>}
    </div>
  );
}

function Field(props: { label: string; value: string; onChange: (value: string) => void; minLength: number; maxLength: number }) {
  return <label className="field-label">{props.label}<input className="input mt-1" required minLength={props.minLength} maxLength={props.maxLength} value={props.value} onChange={(event) => props.onChange(event.target.value)} /></label>;
}
function NumberField(props: { label: string; value: string; onChange: (value: string) => void; min: number; max: number; step?: string; optional?: boolean }) {
  return <label className="field-label">{props.label}<input className="input mt-1" type="number" required={!props.optional} min={props.min} max={props.max} step={props.step ?? 1} value={props.value} onChange={(event) => props.onChange(event.target.value)} /></label>;
}
