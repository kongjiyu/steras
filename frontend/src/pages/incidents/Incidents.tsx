import { useEffect, useMemo, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { getMetadata, ref, uploadBytesResumable } from 'firebase/storage';
import { Activity, CheckCircle2, FileWarning, ShieldCheck, Siren, Upload } from 'lucide-react';
import { functions, storage } from '../../config/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { WorkspaceTopBar } from '../../components/layout/Sidebar';
import {
  INCIDENT_CATEGORIES, M4_EVIDENCE_MAX_BYTES, type M4AuthorityDirectoryEntry,
  type M4IncidentHistoryEntry, type M4IncidentRecord, type M4IncidentSeverity,
} from '@shared/m4';
import { IncidentEvidenceGallery } from './IncidentEvidenceGallery';

type ReportableEvent = { eventId: string; name: string; startDatetime: number; endDatetime: number };
type IncidentView = M4IncidentRecord & { history?: M4IncidentHistoryEntry[] };
const EVIDENCE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export default function Incidents() {
  const { user, profile } = useAuth();
  const [incidents, setIncidents] = useState<IncidentView[]>([]);
  const [events, setEvents] = useState<ReportableEvent[]>([]);
  const [directory, setDirectory] = useState<M4AuthorityDirectoryEntry[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const list = httpsCallable<undefined, { incidents: IncidentView[]; reportableEvents: ReportableEvent[] }>(functions, 'listIncidents');
    const authorities = httpsCallable<undefined, { authorities: M4AuthorityDirectoryEntry[] }>(functions, 'listAuthorityDirectory');
    const [result, authorityResult] = await Promise.all([list(), authorities()]);
    setIncidents(result.data.incidents); setEvents(result.data.reportableEvents ?? []); setDirectory(authorityResult.data.authorities);
    setSelected((current) => current || result.data.incidents[0]?.incidentId || '');
  };
  useEffect(() => { void reload().catch(() => setError('Incident records could not be loaded.')); }, []);
  const active = useMemo(() => incidents.find((item) => item.incidentId === selected), [incidents, selected]);
  const civicWorkspace = profile?.role === 'authority' || profile?.role === 'admin';
  const standalonePublic = profile?.role === 'public';
  const initials = profile?.name
    ? profile.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
    : profile?.role === 'admin' ? 'AD' : 'AO';

  return <>
    {civicWorkspace && <WorkspaceTopBar title="Incident command" subtitle="Reports, response actions and final resolution" userInitials={initials} workspaceEyebrow="Live incident operations" workspaceEyebrowIcon={Siren} />}
    <main className={civicWorkspace ? 'page-shell page-enter' : standalonePublic ? 'min-h-screen bg-cream-50 px-5 py-8 sm:px-8' : ''}>
      <div className="mx-auto max-w-7xl">
      <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="page-eyebrow">Incident response</p><h1 className="font-display text-3xl font-bold text-ink-900">Incident reporting</h1><p className="mt-2 text-sm text-ink-500">Authenticated reports, response actions, investigations and final resolution.</p></div><span className="badge bg-brand-50 text-brand-700"><ShieldCheck size={13} /> {profile?.role}</span></header>
      {error && <div role="alert" className="mt-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-risk-high-text">{error}</div>}
      {profile?.role === 'admin' && <DirectoryAdmin directory={directory} busy={busy} setBusy={setBusy} setError={setError} onDone={reload} />}
      {(profile?.role === 'public' || profile?.role === 'organizer') && <Submission events={events} uid={user!.uid} busy={busy} setBusy={setBusy} onDone={reload} setError={setError} />}
      <div className="mt-7 grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="card h-fit"><div className="card-header"><div><h2 className="section-title">Incident queue</h2><p className="text-xs text-ink-500">{incidents.length} accessible records</p></div><Activity size={18} /></div><div className="divide-y divide-[#eee8dc]">{incidents.map((item) => <button key={item.incidentId} onClick={() => setSelected(item.incidentId)} className={`block w-full p-4 text-left ${selected === item.incidentId ? 'bg-brand-50' : 'hover:bg-cream-50'}`}><div className="flex justify-between gap-2"><strong className="text-sm text-ink-800">{item.eventName}</strong><Status value={item.status} /></div><p className="mt-1 text-xs text-ink-500">{item.category.replaceAll('_', ' ')} · {new Date(item.occurredAt).toLocaleString()}</p></button>)}</div></section>
        {active ? <IncidentDetail record={active} profile={profile!} directory={directory} busy={busy} setBusy={setBusy} onDone={reload} setError={setError} /> : <section className="card p-8 text-center text-sm text-ink-500">No incident selected.</section>}
      </div>
      </div>
    </main>
  </>;
}

function Submission({ events, uid, busy, setBusy, onDone, setError }: { events: ReportableEvent[]; uid: string; busy: boolean; setBusy: (v: boolean) => void; onDone: () => Promise<void>; setError: (v: string) => void }) {
  const [eventId, setEventId] = useState(''); const [category, setCategory] = useState('crowd'); const [occurredAt, setOccurredAt] = useState(''); const [location, setLocation] = useState(''); const [description, setDescription] = useState(''); const [files, setFiles] = useState<File[]>([]);
  useEffect(() => { if (!eventId && events[0]) setEventId(events[0].eventId); }, [eventId, events]);
  const submit = async () => { setBusy(true); setError(''); try { const stamp = crypto.randomUUID(); const paths = await uploadEvidence(uid, files, stamp); const fn = httpsCallable(functions, 'submitIncident'); await fn({ eventId, category, occurredAt: new Date(occurredAt).getTime(), location, description, evidencePaths: paths, idempotencyKey: stamp }); setDescription(''); setFiles([]); await onDone(); } catch (e) { setError(e instanceof Error ? e.message : 'Submission failed.'); } finally { setBusy(false); } };
  const valid = eventId && occurredAt && location.trim().length >= 3 && description.trim().length >= 20;
  return <section className="card mt-7"><div className="card-header"><div><h2 className="section-title">Submit an incident</h2><p className="text-xs text-ink-500">Only ongoing events and events completed within seven days are available.</p></div><FileWarning size={18} /></div><div className="card-body grid gap-3 sm:grid-cols-2"><label><span className="field-label">Event *</span><select className="input" value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="">Select event</option>{events.map((event) => <option value={event.eventId} key={event.eventId}>{event.name}</option>)}</select></label><label><span className="field-label">Category *</span><select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>{INCIDENT_CATEGORIES.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label><label><span className="field-label">Occurrence date and time *</span><input className="input" type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} /></label><label><span className="field-label">Location *</span><input className="input" value={location} onChange={(e) => setLocation(e.target.value)} /></label><label className="sm:col-span-2"><span className="field-label">Description *</span><textarea className="input min-h-24" value={description} onChange={(e) => setDescription(e.target.value)} /></label><label className="sm:col-span-2"><span className="field-label">Supporting evidence</span><input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="input" /></label><div className="sm:col-span-2 flex justify-end"><button className="btn-primary" disabled={!valid || busy} onClick={() => void submit()}><Upload size={15} /> Submit report</button></div></div></section>;
}

function IncidentDetail({ record, profile, directory, busy, setBusy, onDone, setError }: { record: IncidentView; profile: NonNullable<ReturnType<typeof useAuth>['profile']>; directory: M4AuthorityDirectoryEntry[]; busy: boolean; setBusy: (v: boolean) => void; onDone: () => Promise<void>; setError: (v: string) => void }) {
  const [note, setNote] = useState(''); const [team, setTeam] = useState('Venue operations'); const [authorityId, setAuthorityId] = useState(''); const [severity, setSeverity] = useState<M4IncidentSeverity>('medium'); const [outcome, setOutcome] = useState(''); const [actionFiles, setActionFiles] = useState<File[]>([]);
  const retryKey = useRef<{ signature: string; key: string } | undefined>(undefined);
  const matching = useMemo(() => directory.filter((item) => item.serviceCategories.includes(record.category))
    .sort((a, b) => authorityRank(record, a.authorityId) - authorityRank(record, b.authorityId)), [directory, record]);
  useEffect(() => { if (!authorityId && matching[0]) setAuthorityId(matching[0].authorityId); }, [authorityId, matching]);
  const act = async (action: string, extra: Record<string, unknown> = {}) => { setBusy(true); setError(''); const signature = JSON.stringify({ incidentId: record.incidentId, action, note, extra, files: actionFiles.map((file) => [file.name, file.type, file.size, file.lastModified]) }); const idempotencyKey = retryKey.current?.signature === signature ? retryKey.current.key : crypto.randomUUID(); retryKey.current = { signature, key: idempotencyKey }; try { const paths = await uploadEvidence(profile.uid, actionFiles, idempotencyKey); const fn = httpsCallable(functions, 'manageIncident'); await fn({ incidentId: record.incidentId, action, note, evidencePaths: paths, idempotencyKey, ...extra }); retryKey.current = undefined; setNote(''); setActionFiles([]); await onDone(); } catch (e) { setError(e instanceof Error ? e.message : 'Action failed. Retry the unchanged action to safely reuse the same request.'); } finally { setBusy(false); } };
  return <section className="space-y-4"><article className="card"><div className="card-header"><div><h2 className="section-title">{record.eventName}</h2><p className="text-xs text-ink-500">Incident reference · {incidentReference(record.incidentId)}</p></div><Status value={record.status} /></div><div className="card-body space-y-4 text-sm">{record.activityClosed && <div className="rounded-md bg-warning-50 p-3 text-warning-900"><strong>Activity closed</strong><p className="mt-1">This incident is retained for history, but further action is disabled because the event was withdrawn.</p></div>}<p>{record.description}</p><dl className="grid gap-3 sm:grid-cols-2"><div><dt className="field-label">Location</dt><dd>{record.location}</dd></div><div><dt className="field-label">Severity</dt><dd>{record.severity ?? 'Manual review required'}</dd></div><div><dt className="field-label">AI assessment</dt><dd>{record.aiAssessment.status === 'success' ? `${record.aiAssessment.rationale} · ${record.aiAssessment.immediateActionRequired ? 'Immediate action required' : 'No immediate action indicated'}` : `Unavailable: ${record.aiAssessment.reason}`}</dd></div><div><dt className="field-label">Evidence</dt><dd>{record.evidence.length ? `${record.evidence.length} verified upload(s)` : 'None supplied'}</dd></div></dl><IncidentEvidenceGallery incidentId={record.incidentId} evidence={record.evidence} setError={setError} />{record.finalResolution && <div className="rounded-md bg-brand-50 p-3"><strong>Final resolution</strong><p className="mt-1">{record.finalResolution}</p></div>}</div></article>
    {profile.role === 'public' && <article className="card p-5 text-sm"><strong>Progress</strong><p className="mt-2 text-ink-600">Current status: {record.status.replaceAll('_', ' ')}. Organizer and assigned-authority actions remain private; the final resolution appears here when complete.</p></article>}
    {profile.role === 'organizer' && record.status !== 'resolved' && !record.activityClosed && <article className="card"><div className="card-header"><h3 className="section-title">Organizer response</h3></div><div className="card-body space-y-3"><textarea className="input min-h-24" placeholder="Action, finding or final rationale (minimum 10 characters)" value={note} onChange={(e) => setNote(e.target.value)} /><ActionEvidence files={actionFiles} setFiles={setActionFiles} /><div className="grid gap-3 sm:grid-cols-2"><input className="input" value={team} onChange={(e) => setTeam(e.target.value)} /><button className="btn-secondary" disabled={busy || note.trim().length < 10} onClick={() => void act('assign_internal', { team })}>Assign internal team</button><select className="input" value={authorityId} onChange={(e) => setAuthorityId(e.target.value)}><option value="">Recommended authority</option>{matching.map((item) => <option key={item.authorityId} value={item.authorityId}>{item.name} · {item.coverageAreas.join(', ')} · {item.contactPhone}</option>)}</select><button className="btn-secondary" disabled={busy || !authorityId || note.trim().length < 10} onClick={() => void act('refer_authority', { authorityId })}>Request external assistance</button></div><button className="btn-secondary" disabled={busy || note.trim().length < 10} onClick={() => void act('record_response')}>Record completed response</button><div className="border-t pt-3"><div className="grid gap-3 sm:grid-cols-2">{!record.severity && <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value as M4IncidentSeverity)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>}{record.linkedControlId && <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="">Discrepancy outcome</option><option value="confirmed_true">Confirmed true</option><option value="dismissed_fake">Dismissed as false</option></select>}</div><button className="btn-primary mt-3" disabled={busy || record.status !== 'awaiting_resolution' || note.trim().length < 10 || Boolean(record.linkedControlId && !outcome)} onClick={() => void act('resolve', { resolution: note, manualSeverity: severity, discrepancyOutcome: outcome })}><CheckCircle2 size={15} /> Final resolution and close</button>{record.status !== 'awaiting_resolution' && <p className="mt-2 text-xs text-ink-500">Record a completed response or wait for the referred authority finding before closing.</p>}</div></div></article>}
    {profile.role === 'authority' && record.status !== 'resolved' && !record.activityClosed && <article className="card"><div className="card-header"><h3 className="section-title">Authority investigation</h3></div><div className="card-body"><textarea className="input min-h-28" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Investigation actions, evidence reviewed, findings and outcome" /><ActionEvidence files={actionFiles} setFiles={setActionFiles} /><button className="btn-primary mt-3" disabled={busy || note.trim().length < 10} onClick={() => void act('record_investigation')}>Submit finding to organizer</button></div></article>}
    {profile.role !== 'public' && <article className="card"><div className="card-header"><h3 className="section-title">Append-only history</h3></div><div className="divide-y divide-[#eee8dc]">{(record.history ?? []).map((entry) => <div key={entry.historyId} className="p-4 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{entry.action.replaceAll('_', ' ')}</strong><time className="text-xs text-ink-500">{new Date(entry.timestamp).toLocaleString()}</time></div><p className="mt-1 text-ink-600">{entry.summary}</p><IncidentEvidenceGallery incidentId={record.incidentId} evidence={entry.evidence} setError={setError} /></div>)}{!record.history?.length && <p className="p-4 text-sm text-ink-500">No history entries available.</p>}</div></article>}
  </section>;
}

function Status({ value }: { value: string }) { return <span className="badge bg-cream-100 text-ink-700">{value.replaceAll('_', ' ')}</span>; }
function incidentReference(incidentId: string) { return incidentId.slice(-8).toUpperCase(); }
function authorityRank(record: M4IncidentRecord, authorityId: string) { const rank = record.recommendedAuthorityIds?.indexOf(authorityId) ?? -1; return rank < 0 ? 999 : rank; }

function ActionEvidence({ files, setFiles }: { files: File[]; setFiles: (files: File[]) => void }) {
  return <label className="mt-3 block"><span className="field-label">Action evidence (optional)</span><input className="input" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />{files.length > 0 && <span className="mt-1 block text-xs text-ink-500">{files.length} file(s) selected</span>}</label>;
}

async function uploadEvidence(uid: string, files: File[], batchId: string): Promise<string[]> {
  if (files.length > 10) throw new Error('Up to 10 evidence files are allowed.');
  for (const file of files) {
    if (!EVIDENCE_TYPES.has(file.type)) throw new Error(`${file.name} has an unsupported file type.`);
    if (file.size <= 0 || file.size > M4_EVIDENCE_MAX_BYTES) throw new Error(`${file.name} must be between 1 byte and 10 MB.`);
  }
  return Promise.all(files.map(async (file, index) => {
    const safe = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-150);
    const path = `incident_evidence/${uid}/${batchId}-${index}-${safe}`;
    const fileRef = ref(storage, path);
    const task = uploadBytesResumable(fileRef, file, { contentType: file.type });
    try { await new Promise<void>((resolve, reject) => task.on('state_changed', undefined, reject, resolve)); }
    catch (error) {
      const existing = await getMetadata(fileRef).catch(() => undefined);
      if (!existing || Number(existing.size) !== file.size || existing.contentType !== file.type) throw error;
    }
    return path;
  }));
}

function DirectoryAdmin({ directory, busy, setBusy, setError, onDone }: { directory: M4AuthorityDirectoryEntry[]; busy: boolean; setBusy: (v: boolean) => void; setError: (v: string) => void; onDone: () => Promise<void> }) {
  const [authorityId, setAuthorityId] = useState(''); const [name, setName] = useState(''); const [authorityType, setAuthorityType] = useState('PDRM'); const [contactName, setContactName] = useState(''); const [contactPhone, setContactPhone] = useState(''); const [coverage, setCoverage] = useState('Kuala Lumpur'); const [categories, setCategories] = useState<string[]>(['security']);
  const save = async () => { setBusy(true); try { const fn = httpsCallable(functions, 'saveAuthorityDirectoryEntry'); await fn({ authorityId, name, authorityType, contactName, contactPhone, coverageAreas: coverage.split(',').map((item) => item.trim()).filter(Boolean), serviceCategories: categories, active: true }); await onDone(); } catch (e) { setError(e instanceof Error ? e.message : 'Directory update failed.'); } finally { setBusy(false); } };
  const deactivate = async (entry: M4AuthorityDirectoryEntry) => { setBusy(true); try { const fn = httpsCallable(functions, 'saveAuthorityDirectoryEntry'); await fn({ ...entry, active: false }); await onDone(); } catch (e) { setError(e instanceof Error ? e.message : 'Directory update failed.'); } finally { setBusy(false); } };
  return <section className="card mt-7"><div className="card-header"><div><h2 className="section-title">Authority directory</h2><p className="text-xs text-ink-500">Admin-managed contacts used for contextual external-assistance recommendations.</p></div></div><div className="card-body grid gap-3 sm:grid-cols-3"><input className="input" placeholder="Stable authority ID" value={authorityId} onChange={(e) => setAuthorityId(e.target.value)} /><input className="input" placeholder="Authority name" value={name} onChange={(e) => setName(e.target.value)} /><select className="input" value={authorityType} onChange={(e) => setAuthorityType(e.target.value)}>{['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'].map((item) => <option key={item}>{item}</option>)}</select><input className="input" placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} /><input className="input" placeholder="Contact phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} /><input className="input" placeholder="Coverage areas, comma-separated" value={coverage} onChange={(e) => setCoverage(e.target.value)} /><fieldset className="sm:col-span-3"><legend className="field-label">Service categories</legend><div className="flex flex-wrap gap-2">{INCIDENT_CATEGORIES.map((item) => <label key={item} className="rounded border px-2 py-1 text-xs"><input type="checkbox" checked={categories.includes(item)} onChange={(e) => setCategories(e.target.checked ? [...categories, item] : categories.filter((value) => value !== item))} /> {item.replaceAll('_', ' ')}</label>)}</div></fieldset><div className="sm:col-span-3 flex justify-end"><button className="btn-primary" disabled={busy || authorityId.length < 8 || name.length < 2 || contactName.length < 2 || contactPhone.length < 5 || categories.length === 0} onClick={() => void save()}>Save directory entry</button></div>{directory.length > 0 && <div className="sm:col-span-3 divide-y divide-[#eee8dc] border-t">{directory.map((entry) => <div key={entry.authorityId} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div><strong>{entry.name}</strong><p className="text-xs text-ink-500">{entry.authorityType} · {entry.coverageAreas.join(', ')} · {entry.contactPhone}</p></div><button type="button" className="btn-secondary" disabled={busy} onClick={() => void deactivate(entry)}>Deactivate</button></div>)}</div>}</div></section>;
}
