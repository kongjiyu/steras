import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { getMetadata, ref, uploadBytesResumable } from 'firebase/storage';
import { Activity, ArrowRight, CalendarDays, CheckCircle2, ClipboardCheck, Clock3, FileWarning, Flag, History, List, LoaderCircle, MapPin, Search, ShieldCheck, Siren, SlidersHorizontal, Sparkles, Upload, UsersRound, X, type LucideIcon } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { functions, storage } from '../../config/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { WorkspaceTopBar } from '../../components/layout/Sidebar';
import {
  INCIDENT_CATEGORIES, INCIDENT_CATEGORY_LABELS, M4_EVIDENCE_MAX_BYTES, m4EventDayBounds, m4EventDayDate, participantIncidentProgress,
  m4EventDayTimestamp, m4MalaysiaTimeValue, type M4AuthorityDirectoryEntry, type M4IncidentCategory,
  type M4IncidentHistoryEntry, type M4IncidentRecord, type M4ParticipantProgressStep, type M4IncidentSeverity,
} from '@shared/m4';
import { IncidentEvidenceGallery } from './IncidentEvidenceGallery';
import PublicHeader from '../../components/layout/PublicHeader';

type ReportableEvent = { eventId: string; name: string; startDatetime: number; endDatetime: number };
type ParticipantHistoryStatus = 'all' | 'in_progress' | 'resolved';
type OrganizerListFilter = 'all' | 'ongoing' | 'pending' | 'closed';
type OrganizerQueueFilter = 'action_required' | 'resolution_review' | 'in_progress' | 'resolved';
type AuthorityQueueFilter = 'investigation_needed' | 'resolved';
type StaffQueueFilter = OrganizerQueueFilter | AuthorityQueueFilter;
type IncidentView = Pick<M4IncidentRecord, 'incidentId' | 'eventId' | 'eventName' | 'status' | 'category' | 'location' | 'occurredAt' | 'description' | 'evidence'>
  & Partial<Omit<M4IncidentRecord, 'incidentId' | 'eventId' | 'eventName' | 'status' | 'category' | 'location' | 'occurredAt' | 'description' | 'evidence'>>
  & { history?: M4IncidentHistoryEntry[]; progress?: M4ParticipantProgressStep[]; reporterName?: string; reporterEmail?: string };
const EVIDENCE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const ORGANIZER_ASSIGNMENT_STATUSES = new Set<M4IncidentRecord['status']>(['submitted', 'manual_review_required', 'organizer_review']);
const ORGANIZER_PENDING_STATUSES = new Set<M4IncidentRecord['status']>([...ORGANIZER_ASSIGNMENT_STATUSES]);
const INTERNAL_RESPONSE_TEAMS = ['Festival operations team', 'Venue operations', 'Security response team', 'Medical response team'];
const AUTHORITY_CARD_ORDER = ['PDRM', 'BOMBA', 'KKM', 'DBKL'] as const;

export default function Incidents() {
  const { user, profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState<IncidentView[]>([]);
  const [events, setEvents] = useState<ReportableEvent[]>([]);
  const [directory, setDirectory] = useState<M4AuthorityDirectoryEntry[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submissionComplete, setSubmissionComplete] = useState(false);
  const [localSubmissionNotice, setLocalSubmissionNotice] = useState('');
  const submissionPage = profile?.role === 'public' && location.pathname === '/incidents/submit' && !submissionComplete;
  const submissionNotice = (location.state as { submissionNotice?: string } | null)?.submissionNotice ?? localSubmissionNotice;
  const standalonePublic = profile?.role === 'public';
  const organizerListPage = profile?.role === 'organizer' && ['/organizer/incidents/list', '/organizer/incident/list'].includes(location.pathname);
  const [historySearch, setHistorySearch] = useState('');
  const [historyCategory, setHistoryCategory] = useState<M4IncidentCategory | 'all'>('all');
  const [historyStatus, setHistoryStatus] = useState<ParticipantHistoryStatus>('all');
  const [organizerListSearch, setOrganizerListSearch] = useState('');
  const [organizerListCategory, setOrganizerListCategory] = useState<M4IncidentCategory | 'all'>('all');
  const [organizerListFilter, setOrganizerListFilter] = useState<OrganizerListFilter>('all');
  const [organizerListPageNumber, setOrganizerListPageNumber] = useState(1);
  const [organizerQueueFilter, setOrganizerQueueFilter] = useState<OrganizerQueueFilter>('action_required');
  const [authorityQueueFilter, setAuthorityQueueFilter] = useState<AuthorityQueueFilter>('investigation_needed');

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const list = httpsCallable<undefined, { incidents: IncidentView[]; reportableEvents: ReportableEvent[] }>(functions, 'listIncidents');
      const authorities = httpsCallable<undefined, { authorities: M4AuthorityDirectoryEntry[] }>(functions, 'listAuthorityDirectory');
      const result = await list();
      const authorityResult = profile?.role === 'public' ? undefined : await authorities();
      setIncidents(result.data.incidents);
      setEvents(result.data.reportableEvents ?? []);
      setDirectory(authorityResult?.data.authorities ?? []);
      setSelected((current) => {
        if (result.data.incidents.some((item) => item.incidentId === current)) return current;
        if (profile?.role === 'organizer') {
          return result.data.incidents.find((item) => ORGANIZER_ASSIGNMENT_STATUSES.has(item.status) && !item.activityClosed)?.incidentId
            ?? result.data.incidents.find((item) => item.status !== 'resolved' && !item.activityClosed)?.incidentId ?? '';
        }
        return result.data.incidents[0]?.incidentId ?? '';
      });
    } catch {
      setLoadError('Incident records could not be refreshed. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [profile?.role]);
  useEffect(() => { void reload(); }, [reload]);
  const participantCounts = useMemo(() => ({
    resolved: incidents.filter((item) => item.status === 'resolved').length,
    inProgress: incidents.filter((item) => item.status !== 'resolved').length,
    total: incidents.length,
  }), [incidents]);
  const organizerCounts = useMemo(() => ({
    actionRequired: incidents.filter((item) => ORGANIZER_ASSIGNMENT_STATUSES.has(item.status) && !item.activityClosed).length,
    highSeverity: incidents.filter((item) => item.severity === 'high' && item.status !== 'resolved' && !item.activityClosed).length,
    resolutionReview: incidents.filter((item) => item.status === 'awaiting_resolution' && !item.activityClosed).length,
    active: incidents.filter((item) => item.status !== 'resolved' && !item.activityClosed).length,
    inProgress: incidents.filter((item) => !isOrganizerClosed(item) && !isOrganizerActionRequired(item) && item.status !== 'awaiting_resolution').length,
    resolved: incidents.filter(isRecentlyResolvedForQueue).length,
    closed: incidents.filter((item) => item.status === 'resolved' || item.activityClosed).length,
  }), [incidents]);
  const organizerQueueIncidents = useMemo(() => incidents.filter((item) => !isOrganizerClosed(item) || isRecentlyResolvedForQueue(item)).sort(compareOrganizerQueue), [incidents]);
  const organizerQueueVisibleIncidents = useMemo(() => organizerQueueIncidents.filter((item) => organizerQueueFilter === 'action_required'
    ? isOrganizerActionRequired(item) : organizerQueueFilter === 'resolution_review' ? item.status === 'awaiting_resolution'
      : organizerQueueFilter === 'resolved' ? isRecentlyResolvedForQueue(item)
        : !isOrganizerClosed(item) && !isOrganizerActionRequired(item) && item.status !== 'awaiting_resolution'), [organizerQueueFilter, organizerQueueIncidents]);
  const authorityQueueVisibleIncidents = useMemo(() => incidents
    .filter((item) => authorityQueueFilter === 'resolved' ? item.status === 'resolved' : item.status !== 'resolved' && !item.activityClosed)
    .sort(compareAuthorityQueue), [authorityQueueFilter, incidents]);
  const authorityCounts = useMemo(() => ({
    investigationNeeded: incidents.filter((item) => item.status !== 'resolved' && !item.activityClosed).length,
    resolved: incidents.filter((item) => item.status === 'resolved').length,
  }), [incidents]);
  const organizerListCounts = useMemo(() => ({
    all: incidents.length,
    ongoing: incidents.filter((item) => !isOrganizerClosed(item) && !ORGANIZER_PENDING_STATUSES.has(item.status)).length,
    pending: incidents.filter((item) => !isOrganizerClosed(item) && ORGANIZER_PENDING_STATUSES.has(item.status)).length,
    closed: incidents.filter(isOrganizerClosed).length,
  }), [incidents]);
  const organizerListIncidents = useMemo(() => {
    const query = organizerListSearch.trim().toLocaleLowerCase();
    return incidents.filter((item) => {
      const matchesSearch = !query || [item.incidentId, item.eventName, INCIDENT_CATEGORY_LABELS[item.category], item.location, item.description]
        .some((value) => value.toLocaleLowerCase().includes(query));
      const matchesCategory = organizerListCategory === 'all' || item.category === organizerListCategory;
      const matchesFilter = organizerListFilter === 'all'
        || organizerListFilter === 'closed' && isOrganizerClosed(item)
        || organizerListFilter === 'pending' && !isOrganizerClosed(item) && ORGANIZER_PENDING_STATUSES.has(item.status)
        || organizerListFilter === 'ongoing' && !isOrganizerClosed(item) && !ORGANIZER_PENDING_STATUSES.has(item.status);
      return matchesSearch && matchesCategory && matchesFilter;
    }).sort(compareOrganizerQueue);
  }, [incidents, organizerListCategory, organizerListFilter, organizerListSearch]);
  const organizerListTotalPages = Math.max(1, Math.ceil(organizerListIncidents.length / 30));
  const organizerListPageItems = useMemo(() => organizerListIncidents.slice((organizerListPageNumber - 1) * 30, organizerListPageNumber * 30), [organizerListIncidents, organizerListPageNumber]);
  const filteredParticipantIncidents = useMemo(() => {
    if (!standalonePublic || submissionPage) return [];
    const query = historySearch.trim().toLocaleLowerCase();
    return incidents.filter((item) => {
      const matchesSearch = !query || [item.incidentId, item.eventName, INCIDENT_CATEGORY_LABELS[item.category], item.location, item.description]
        .some((value) => value.toLocaleLowerCase().includes(query));
      const matchesCategory = historyCategory === 'all' || item.category === historyCategory;
      const matchesStatus = historyStatus === 'all' || (historyStatus === 'resolved' ? item.status === 'resolved' : item.status !== 'resolved');
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [historyCategory, historySearch, historyStatus, incidents, standalonePublic, submissionPage]);
  const active = useMemo(() => incidents.find((item) => item.incidentId === selected), [incidents, selected]);
  const civicWorkspace = profile?.role === 'authority' || profile?.role === 'admin';
  useEffect(() => {
    if (!standalonePublic || submissionPage) return;
    setSelected((current) => filteredParticipantIncidents.some((item) => item.incidentId === current)
      ? current : filteredParticipantIncidents[0]?.incidentId ?? '');
  }, [filteredParticipantIncidents, standalonePublic, submissionPage]);
  useEffect(() => {
    if (profile?.role !== 'organizer') return;
    setSelected((current) => organizerQueueVisibleIncidents.some((item) => item.incidentId === current)
      ? current : organizerQueueVisibleIncidents[0]?.incidentId ?? '');
  }, [organizerQueueVisibleIncidents, profile?.role]);
  useEffect(() => {
    if (profile?.role !== 'authority') return;
    setSelected((current) => authorityQueueVisibleIncidents.some((item) => item.incidentId === current)
      ? current : authorityQueueVisibleIncidents[0]?.incidentId ?? '');
  }, [authorityQueueVisibleIncidents, profile?.role]);
  useEffect(() => {
    setOrganizerListPageNumber((current) => Math.min(current, organizerListTotalPages));
  }, [organizerListTotalPages]);
  useEffect(() => {
    if (organizerListPage) setError('');
  }, [organizerListPage]);
  const initials = profile?.name
    ? profile.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
    : profile?.role === 'admin' ? 'AD' : 'AO';

  return <>
    {standalonePublic && <PublicHeader />}
    {civicWorkspace && <WorkspaceTopBar title="Incident command" subtitle="Reports, response actions and final resolution" userInitials={initials} workspaceEyebrow="Live incident operations" workspaceEyebrowIcon={Siren} />}
    <main className={`${civicWorkspace ? 'page-shell page-enter' : standalonePublic || organizerListPage ? 'min-h-screen bg-cream-50 px-5 py-8 sm:px-8' : ''} ${standalonePublic && !submissionPage ? 'incident-history-compact' : ''}`}>
      <div className={organizerListPage ? 'w-full' : 'mx-auto max-w-6xl'}>
      <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="page-eyebrow">Incident response</p><h1 className="font-display text-3xl font-bold text-ink-900">{standalonePublic ? submissionPage ? 'Submit Incident Report' : 'My reports' : organizerListPage ? 'Incident list' : 'Incident review'}</h1><p className="mt-2 text-sm text-ink-500">{standalonePublic ? submissionPage ? 'Provide the incident details for an eligible event.' : 'View the incident reports you submitted and follow their resolution.' : organizerListPage ? 'Search all organizer incident records, including ongoing, pending and closed cases.' : 'Review accessible reports, record response actions and complete the resolution.'}</p></div>{standalonePublic ? submissionPage ? null : <button type="button" className="btn-primary" onClick={() => { setSubmissionComplete(false); setLocalSubmissionNotice(''); navigate('/incidents/submit'); }}> <Upload size={15} /> Submit Incident Report</button> : profile?.role === 'organizer' ? organizerListPage ? <button type="button" className="btn-secondary" onClick={() => navigate('/organizer/incidents')}><Activity size={15} /> Incident queue</button> : <button type="button" className="btn-secondary" onClick={() => navigate('/organizer/incidents/list')}><List size={15} /> Incident list</button> : <span className="badge bg-brand-50 text-brand-700"><ShieldCheck size={13} /> {profile?.role}</span>}</header>
      {loadError && <div role="alert" className="mt-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm">{loadError}<span className="ml-2 font-medium">Record count unavailable</span><button type="button" className="btn-secondary ml-3" onClick={() => void reload()}>Try again</button></div>}
      {loading && <p role="status" className="mt-5 text-sm text-ink-600">Loading incident records...</p>}
      {standalonePublic && submissionPage && !loading && !loadError && <p role="status" className="mt-5 text-sm text-ink-600">{incidents.length} submitted reports</p>}
      {error && !organizerListPage && <div role="alert" className="mt-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-risk-high-text">{error}</div>}
      {submissionNotice && <p role="status" className="mt-5 rounded-md border border-brand-200 bg-brand-50 p-3 text-sm text-brand-800">{submissionNotice}</p>}
      <fieldset disabled={loading || Boolean(loadError)} className="min-w-0">
      {standalonePublic && !submissionPage && <ParticipantSummary resolved={participantCounts.resolved} inProgress={participantCounts.inProgress} total={participantCounts.total} />}
      {profile?.role === 'organizer' && !organizerListPage && !loading && !loadError && <OrganizerSummary actionRequired={organizerCounts.actionRequired} highSeverity={organizerCounts.highSeverity} resolutionReview={organizerCounts.resolutionReview} />}
      {profile?.role === 'admin' && <DirectoryAdmin directory={directory} busy={busy} setBusy={setBusy} setError={setError} onDone={reload} />}
      {standalonePublic && submissionPage && <Submission events={events} uid={user!.uid} busy={busy} setBusy={setBusy} onCancel={() => navigate('/incidents')} onSubmitted={async () => { const notice = 'Incident report submitted. It is now available in My reports.'; setSubmissionComplete(true); setLocalSubmissionNotice(notice); navigate('/incidents', { replace: true, state: { submissionNotice: notice } }); await reload(); }} setError={setError} />}
      {profile?.role === 'organizer' && organizerListPage && <OrganizerIncidentList incidents={organizerListPageItems} total={organizerListIncidents.length} page={organizerListPageNumber} totalPages={organizerListTotalPages} setPage={setOrganizerListPageNumber} counts={organizerListCounts} search={organizerListSearch} category={organizerListCategory} filter={organizerListFilter} setSearch={(value) => { setOrganizerListSearch(value); setOrganizerListPageNumber(1); }} setCategory={(value) => { setOrganizerListCategory(value); setOrganizerListPageNumber(1); }} setFilter={(value) => { setOrganizerListFilter(value); setOrganizerListPageNumber(1); }} loading={loading} loadError={loadError} />}
      {profile?.role !== 'admin' && !submissionPage && !organizerListPage && <div className={`mt-6 grid gap-4 ${standalonePublic ? 'lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' : 'lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]'}`}>
        {standalonePublic ? <ParticipantIncidentHistory incidents={filteredParticipantIncidents} selected={selected} counts={participantCounts} search={historySearch} category={historyCategory} status={historyStatus} setSearch={setHistorySearch} setCategory={setHistoryCategory} setStatus={setHistoryStatus} onSelect={setSelected} loading={loading} loadError={loadError} /> : <StaffIncidentQueue incidents={profile?.role === 'organizer' ? organizerQueueVisibleIncidents : profile?.role === 'authority' ? authorityQueueVisibleIncidents : incidents} selected={selected} loading={loading} loadError={loadError} organizer={profile?.role === 'organizer'} authority={profile?.role === 'authority'} queueFilter={profile?.role === 'authority' ? authorityQueueFilter : organizerQueueFilter} counts={profile?.role === 'authority' ? { ...organizerCounts, ...authorityCounts } : organizerCounts} onQueueFilterChange={profile?.role === 'authority' ? (value) => setAuthorityQueueFilter(value as AuthorityQueueFilter) : (value) => setOrganizerQueueFilter(value as OrganizerQueueFilter)} onSelect={setSelected} />}
        {active ? <IncidentDetail key={active.incidentId} record={active} profile={profile!} directory={directory} busy={busy} setBusy={setBusy} onDone={reload} setError={setError} /> : <section className="card p-8 text-center text-sm text-ink-500">{loading ? 'Loading incident details...' : loadError ? 'Incident data unavailable.' : 'No incident selected.'}</section>}
      </div>}
      </fieldset>
      </div>
    </main>
  </>;
}

function ParticipantSummary({ resolved, inProgress, total }: { resolved: number; inProgress: number; total: number }) {
  return <div className="mt-7 grid gap-3 sm:grid-cols-3">
    <SummaryCard label="Resolved" value={resolved} icon={CheckCircle2} tone="bg-green-50 text-status-approved" />
    <SummaryCard label="In Progress" value={inProgress} icon={Clock3} tone="bg-gold-50 text-gold-700" />
    <SummaryCard label="Total Report" value={total} icon={FileWarning} tone="bg-brand-50 text-brand-700" />
  </div>;
}

function SummaryCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: LucideIcon; tone: string }) {
  return <article className="card flex items-center gap-3 p-4 sm:p-5"><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${tone}`}><Icon size={19} /></div><div><p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">{label}</p><p className="mt-1 font-display text-2xl font-bold text-ink-900">{value}</p></div></article>;
}

function OrganizerSummary({ actionRequired, highSeverity, resolutionReview }: { actionRequired: number; highSeverity: number; resolutionReview: number }) {
  return <div className="mt-7 grid gap-3 sm:grid-cols-3">
    <SummaryCard label="Action Required" value={actionRequired} icon={Siren} tone="bg-gold-50 text-gold-700" />
    <SummaryCard label="High Severity" value={highSeverity} icon={FileWarning} tone="bg-red-50 text-risk-high-text" />
    <SummaryCard label="Resolution Review" value={resolutionReview} icon={CheckCircle2} tone="bg-brand-50 text-brand-700" />
  </div>;
}

function StaffIncidentQueue({ incidents, selected, loading, loadError, organizer, authority, queueFilter, counts, onQueueFilterChange, onSelect }: {
  incidents: IncidentView[]; selected: string; loading: boolean; loadError: string; organizer: boolean; authority: boolean; queueFilter: StaffQueueFilter;
  counts: { actionRequired: number; resolutionReview: number; inProgress: number; resolved: number; investigationNeeded?: number }; onQueueFilterChange: (value: StaffQueueFilter) => void; onSelect: (incidentId: string) => void;
}) {
  return <section className="card h-fit overflow-hidden">
    <div className="card-header"><div><h2 className="section-title">Incident queue</h2>{organizer ? <p className="text-xs text-ink-500">Organizers can review and act on assigned incident records.</p> : authority ? <><p className="text-xs text-ink-500">{loading ? 'Loading records...' : loadError ? 'Record count unavailable' : `${incidents.length} accessible records`}</p><p className="text-xs text-ink-500">Authorities can review and act on referred incident records.</p></> : <p className="text-xs text-ink-500">{loading ? 'Loading records...' : loadError ? 'Record count unavailable' : `${incidents.length} accessible records`}</p>}</div><Activity size={18} /></div>
    {organizer && <div role="tablist" aria-label="Organizer incident queue filter" className="flex flex-wrap gap-2 border-b border-[#e3dacb] px-4 py-3 sm:px-5">
      <button type="button" role="tab" aria-selected={queueFilter === 'action_required'} className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${queueFilter === 'action_required' ? 'border-red-600 bg-red-600 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-red-300 hover:bg-red-50'}`} onClick={() => onQueueFilterChange('action_required')}>Action required ({counts.actionRequired})</button>
      <button type="button" role="tab" aria-selected={queueFilter === 'resolution_review'} className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${queueFilter === 'resolution_review' ? 'border-brand-700 bg-brand-700 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-brand-300 hover:bg-brand-50'}`} onClick={() => onQueueFilterChange('resolution_review')}>Resolution review ({counts.resolutionReview})</button>
      <button type="button" role="tab" aria-selected={queueFilter === 'in_progress'} className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${queueFilter === 'in_progress' ? 'border-ink-700 bg-ink-700 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:bg-cream-50'}`} onClick={() => onQueueFilterChange('in_progress')}>In progress ({counts.inProgress})</button>
      <button type="button" role="tab" aria-selected={queueFilter === 'resolved'} className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${queueFilter === 'resolved' ? 'border-green-700 bg-green-700 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-green-300 hover:bg-green-50'}`} onClick={() => onQueueFilterChange('resolved')}>Resolved ({counts.resolved})</button>
    </div>}
    {authority && <div role="tablist" aria-label="Authority incident queue filter" className="flex flex-wrap gap-2 border-b border-[#e3dacb] px-4 py-3 sm:px-5">
      <button type="button" role="tab" aria-selected={queueFilter === 'investigation_needed'} className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${queueFilter === 'investigation_needed' ? 'border-brand-700 bg-brand-700 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-brand-300 hover:bg-brand-50'}`} onClick={() => onQueueFilterChange('investigation_needed')}>Investigation Needed ({counts.investigationNeeded ?? 0})</button>
      <button type="button" role="tab" aria-selected={queueFilter === 'resolved'} className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${queueFilter === 'resolved' ? 'border-green-700 bg-green-700 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-green-300 hover:bg-green-50'}`} onClick={() => onQueueFilterChange('resolved')}>Resolved ({counts.resolved})</button>
    </div>}
    <div className="max-h-[60vh] overflow-y-auto divide-y divide-[#eee8dc]">
      {incidents.map((item) => <button key={item.incidentId} type="button" aria-label={`${item.eventName} incident`} aria-current={selected === item.incidentId ? 'true' : undefined} onClick={() => onSelect(item.incidentId)} className={`block w-full p-4 text-left transition ${selected === item.incidentId ? 'bg-brand-50' : 'hover:bg-cream-50'}`}>
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold text-ink-800">{item.eventName}</p><p className="mt-1 text-xs text-ink-500">{INCIDENT_CATEGORY_LABELS[item.category]}</p></div><div className="flex shrink-0 flex-wrap justify-end gap-1.5">{!organizer && !authority && <Status value={item.status} />}{item.severity && <SeverityBadge value={item.severity} />}</div></div>
        <p className="mt-2 text-xs text-ink-500">{formatIncidentDate(item.occurredAt)}</p>
        {organizer && <p className="mt-1 text-xs font-semibold text-ink-700">{organizerStatusLabel(item)}</p>}
      </button>)}
      {!loading && !loadError && incidents.length === 0 && <p role="status" className="p-8 text-center text-sm text-ink-500">{organizer ? queueFilter === 'resolution_review' ? 'No incidents are waiting for final resolution review.' : queueFilter === 'action_required' ? 'No incidents currently require organizer action.' : queueFilter === 'resolved' ? 'No incidents were resolved within the last seven days.' : 'No incidents are currently in progress.' : authority ? queueFilter === 'resolved' ? 'No resolved incidents are available.' : 'No incidents currently need investigation.' : 'No accessible incident records.'}</p>}
    </div>
  </section>;
}

function OrganizerIncidentList({ incidents, total, page, totalPages, setPage, counts, search, category, filter, setSearch, setCategory, setFilter, loading, loadError }: {
  incidents: IncidentView[]; total: number; page: number; totalPages: number; setPage: (value: number) => void; counts: { all: number; ongoing: number; pending: number; closed: number }; search: string;
  category: M4IncidentCategory | 'all'; filter: OrganizerListFilter; setSearch: (value: string) => void;
  setCategory: (value: M4IncidentCategory | 'all') => void; setFilter: (value: OrganizerListFilter) => void; loading: boolean; loadError: string;
}) {
  const tabs: Array<[OrganizerListFilter, string, number]> = [
    ['all', 'All', counts.all], ['ongoing', 'Ongoing', counts.ongoing], ['pending', 'Pending action', counts.pending], ['closed', 'Closed', counts.closed],
  ];
  const groups: Array<{ key: OrganizerListFilter; label: string; items: IncidentView[] }> = [
    { key: 'ongoing', label: 'Ongoing', items: filter === 'ongoing' || filter === 'all' ? incidents.filter((item) => !isOrganizerClosed(item) && !ORGANIZER_PENDING_STATUSES.has(item.status)) : [] },
    { key: 'pending', label: 'Pending action', items: filter === 'pending' || filter === 'all' ? incidents.filter((item) => !isOrganizerClosed(item) && ORGANIZER_PENDING_STATUSES.has(item.status)) : [] },
    { key: 'closed', label: 'Closed', items: filter === 'closed' || filter === 'all' ? incidents.filter(isOrganizerClosed) : [] },
  ];
  const rangeStart = total === 0 ? 0 : (page - 1) * 30 + 1;
  const rangeEnd = Math.min(page * 30, total);
  return <section className="mt-6 w-full overflow-hidden border-y border-[#e3dacb] bg-white">
    <div className="border-b border-[#e3dacb] p-4 sm:p-6">
      <h2 className="section-title">Organizer report list</h2>
      <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(190px,.8fr)]">
        <label className="relative"><span className="sr-only">Search incident reports</span><Search size={19} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" /><input aria-label="Search incident reports" className="input !bg-white !pl-10" placeholder="Search reports" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label className="relative"><SlidersHorizontal size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" /><span className="sr-only">Organizer incident category filter</span><select aria-label="Organizer incident category filter" className="input !bg-white !pl-10" value={category} onChange={(event) => setCategory(event.target.value as M4IncidentCategory | 'all')}><option value="all">All categories</option>{INCIDENT_CATEGORIES.map((item) => <option key={item} value={item}>{INCIDENT_CATEGORY_LABELS[item]}</option>)}</select></label>
      </div>
      <div role="tablist" aria-label="Organizer incident list filter" className="mt-4 flex flex-wrap gap-2">{tabs.map(([value, label, count]) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={`rounded-full border px-4 py-2.5 text-sm font-semibold transition ${filter === value ? 'border-brand-700 bg-brand-700 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-brand-300 hover:bg-brand-50'}`} onClick={() => setFilter(value)}>{label} ({count})</button>)}</div>
    </div>
    <div>
      <table className="w-full table-fixed border-collapse text-left text-sm">
        <colgroup><col className="w-[16%]" /><col className="w-[17%]" /><col className="w-[16%]" /><col className="w-[14%]" /><col className="w-[12%]" /><col className="w-[10%]" /><col className="w-[15%]" /></colgroup>
        <thead className="bg-cream-50 text-ink-700"><tr className="border-b border-[#e3dacb]"><th scope="col" className="px-4 py-3 font-semibold sm:px-6">Incident</th><th scope="col" className="px-4 py-3 font-semibold">Event</th><th scope="col" className="px-4 py-3 font-semibold">Category</th><th scope="col" className="px-4 py-3 font-semibold">Occurred</th><th scope="col" className="px-4 py-3 font-semibold">Status</th><th scope="col" className="px-4 py-3 font-semibold">Severity</th><th scope="col" className="px-4 py-3 font-semibold">Location</th></tr></thead>
        <tbody>
          {groups.map((group) => group.items.length > 0 && <Fragment key={group.key}><tr className="border-b border-[#e3dacb] bg-cream-50"><th scope="colgroup" colSpan={7} className="px-4 py-3 text-xs font-bold uppercase tracking-[0.12em] text-brand-700 sm:px-6">{group.label}</th></tr>{group.items.map((item) => <tr key={item.incidentId} className="border-b border-[#eee8dc] align-top transition hover:bg-cream-50"><td className="break-words px-4 py-4 font-bold tracking-[0.04em] text-ink-700 sm:px-6">{item.incidentId}</td><td className="break-words px-4 py-4 font-semibold text-ink-900">{item.eventName}</td><td className="break-words px-4 py-4 text-ink-600">{INCIDENT_CATEGORY_LABELS[item.category]}</td><td className="break-words px-4 py-4 text-ink-700">{formatIncidentDate(item.occurredAt)}</td><td className="px-4 py-4"><OrganizerStatusBadge record={item} /></td><td className="px-4 py-4">{item.severity ? <SeverityBadge value={item.severity} /> : <span className="text-ink-500">Not assessed</span>}</td><td className="break-words px-4 py-4 text-ink-600">{item.location}</td></tr>)}</Fragment>)}
        </tbody>
      </table>
      {!loading && !loadError && incidents.length === 0 && <p role="status" className="p-10 text-center text-sm text-ink-500">No incident records match the selected filters.</p>}
      {loading && <p role="status" className="p-10 text-center text-sm text-ink-500">Loading incident records...</p>}
      {loadError && <p role="status" className="p-10 text-center text-sm text-ink-500">Incident records are unavailable.</p>}
      {!loading && !loadError && total > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e3dacb] px-5 py-4 text-sm text-ink-600 sm:px-6"><span>Showing {rangeStart}-{rangeEnd} of {total}</span><div className="flex items-center gap-2"><button type="button" aria-label="Previous incident records" className="grid h-9 w-9 place-items-center rounded-md border border-ink-200 bg-white text-ink-700 transition hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(Math.max(1, page - 1))}>‹</button><span className="min-w-16 text-center text-xs font-semibold text-ink-500">Page {page} of {totalPages}</span><button type="button" aria-label="Next incident records" className="grid h-9 w-9 place-items-center rounded-md border border-ink-200 bg-white text-ink-700 transition hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40" disabled={page >= totalPages} onClick={() => setPage(Math.min(totalPages, page + 1))}>›</button></div></div>}
    </div>
  </section>;
}

function ParticipantIncidentHistory({ incidents, selected, counts, search, category, status, setSearch, setCategory, setStatus, onSelect, loading, loadError }: {
  incidents: IncidentView[]; selected: string; counts: { resolved: number; inProgress: number; total: number }; search: string; category: M4IncidentCategory | 'all'; status: ParticipantHistoryStatus;
  setSearch: (value: string) => void; setCategory: (value: M4IncidentCategory | 'all') => void; setStatus: (value: ParticipantHistoryStatus) => void; onSelect: (incidentId: string) => void; loading: boolean; loadError: string;
}) {
  return <section className="card h-fit overflow-hidden">
    <div className="border-b border-[#e3dacb] p-4 sm:p-5">
      <div className="flex items-center justify-between"><h2 className="section-title">Incident history</h2><History size={22} className="text-brand-700" /></div>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(190px,.8fr)]">
        <label className="relative"><span className="sr-only">Search incident history</span><Search size={19} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" /><input aria-label="Search incident history" className="input !bg-white !pl-10" placeholder="Search incident history" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label className="relative"><SlidersHorizontal size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" /><span className="sr-only">Incident category filter</span><select aria-label="Incident category filter" className="input !bg-white !pl-10" value={category} onChange={(event) => setCategory(event.target.value as M4IncidentCategory | 'all')}><option value="all">All categories</option>{INCIDENT_CATEGORIES.map((item) => <option key={item} value={item}>{INCIDENT_CATEGORY_LABELS[item]}</option>)}</select></label>
      </div>
      <div role="tablist" aria-label="Incident status filter" className="mt-4 flex flex-wrap gap-2">
        {([['all', `All (${counts.total})`], ['in_progress', `In progress (${counts.inProgress})`], ['resolved', `Resolved (${counts.resolved})`]] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={status === value} className={`rounded-full border px-5 py-2.5 text-sm font-semibold transition ${status === value ? 'border-brand-700 bg-brand-700 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-brand-300 hover:bg-brand-50'}`} onClick={() => setStatus(value)}>{label}</button>)}
      </div>
    </div>
    <div className="divide-y divide-[#eee8dc]">
      {incidents.map((item) => <button key={item.incidentId} type="button" onClick={() => onSelect(item.incidentId)} className={`block w-full p-4 text-left transition sm:p-5 ${selected === item.incidentId ? 'bg-brand-50/60' : 'hover:bg-cream-50'}`}>
        <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold tracking-[0.06em] text-ink-500">Report {incidentReference(item.incidentId)}</p><p className="mt-3 font-display text-xl font-bold text-ink-900">{INCIDENT_CATEGORY_LABELS[item.category]}</p><p className="mt-1.5 text-base font-semibold text-ink-800">{item.eventName}</p></div><span className={`shrink-0 rounded-md px-3 py-2 text-sm font-semibold ${item.status === 'resolved' ? 'bg-green-50 text-status-approved' : 'bg-gold-50 text-gold-700'}`}>{item.status === 'resolved' ? 'Resolved' : 'In Progress'}</span></div>
        <div className="mt-4 grid gap-2.5 text-sm text-ink-600"><span className="inline-flex items-center gap-2"><Clock3 size={18} className="text-ink-500" />{formatIncidentDate(item.occurredAt)}</span><span className="inline-flex items-center gap-2"><MapPin size={18} className="text-ink-500" />{item.location}</span></div>
      </button>)}
      {!loading && !loadError && incidents.length === 0 && <p className="p-8 text-center text-sm text-ink-500">{search || category !== 'all' || status !== 'all' ? 'No incident reports match the selected filters.' : 'You have not submitted any incident reports yet.'}</p>}
      {loading && <p className="p-8 text-center text-sm text-ink-500">Loading incident history...</p>}
      {loadError && <p className="p-8 text-center text-sm text-ink-500">Incident history is unavailable.</p>}
    </div>
  </section>;
}

function Submission({ events, uid, busy, setBusy, onCancel, onSubmitted, setError }: { events: ReportableEvent[]; uid: string; busy: boolean; setBusy: (v: boolean) => void; onCancel: () => void; onSubmitted: () => Promise<void>; setError: (v: string) => void }) {
  const [eventId, setEventId] = useState(''); const [category, setCategory] = useState(''); const [occurrenceTime, setOccurrenceTime] = useState(() => m4MalaysiaTimeValue()); const [location, setLocation] = useState(''); const [description, setDescription] = useState(''); const [files, setFiles] = useState<File[]>([]);
  const retryKey = useRef<{ signature: string; key: string }>();
  const inFlight = useRef(false);
  const selectedEvent = events.find((event) => event.eventId === eventId);
  const eventDay = selectedEvent ? m4EventDayBounds(selectedEvent.startDatetime) : undefined;
  const occurrence = eventDay ? m4EventDayTimestamp(eventDay.date, occurrenceTime) : Number.NaN;
  const eventDayIsToday = eventDay?.date === m4EventDayDate(Date.now());
  const latestOccurrenceTime = eventDayIsToday ? m4MalaysiaTimeValue() : '23:59';
  const occurrenceValid = Boolean(eventDay && Number.isFinite(occurrence)
    && occurrence >= eventDay.start && occurrence < eventDay.end && occurrence <= Date.now());
  const valid = Boolean(selectedEvent && category && occurrenceValid && location.trim().length >= 3 && description.trim());
  const chooseEvent = (nextEventId: string) => {
    setEventId(nextEventId);
    const nextEvent = events.find((event) => event.eventId === nextEventId);
    if (nextEvent) setOccurrenceTime(m4MalaysiaTimeValue());
  };
  const submit = async () => {
    if (inFlight.current || !valid) return;
    inFlight.current = true;
    setBusy(true); setError('');
    const signature = JSON.stringify({ eventId, category, occurredAt: occurrence, location, description, files: files.map((file) => [file.name, file.type, file.size, file.lastModified]) });
    const stamp = retryKey.current?.signature === signature ? retryKey.current.key : crypto.randomUUID();
    retryKey.current = { signature, key: stamp };
    try {
      const paths = await uploadEvidence(uid, files, stamp);
      const fn = httpsCallable(functions, 'submitIncident');
      await fn({ eventId, category, occurredAt: occurrence, location, description, evidencePaths: paths, idempotencyKey: stamp });
      retryKey.current = undefined;
      setEventId(''); setCategory(''); setOccurrenceTime(m4MalaysiaTimeValue()); setLocation(''); setDescription(''); setFiles([]);
      void onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed. Retry the unchanged report to safely reuse the same request.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return <section id="submit-incident" className="card mt-7 scroll-mt-24">
    <div className="card-header"><div><h2 className="section-title">Report details</h2><p className="text-xs text-ink-500">Participant submission is limited to ongoing events and events completed within the past seven days.</p></div><FileWarning size={18} /></div>
    <div className="card-body grid gap-3 sm:grid-cols-2">
      <label><span className="field-label">Eligible event *</span><select className="input" value={eventId} onChange={(e) => chooseEvent(e.target.value)}><option value="">Select an ongoing or recent event</option>{events.map((event) => <option value={event.eventId} key={event.eventId}>{event.name}</option>)}</select></label>
      <label><span className="field-label">Incident category *</span><select className="input" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Select category</option>{INCIDENT_CATEGORIES.map((item) => <option key={item} value={item}>{INCIDENT_CATEGORY_LABELS[item]}</option>)}</select></label>
      <div className="sm:col-span-2 grid gap-3 sm:grid-cols-4">
        <label className="sm:col-span-1"><span className="field-label">Occurrence date (D-Day)</span><input aria-label="Occurrence date (D-Day)" className={`input ${eventDay ? '!border-brand-300 !bg-brand-50 !text-brand-900' : '!bg-white'}`} type="date" value={eventDay?.date ?? ''} readOnly /></label>
        <label className="sm:col-span-1"><span className="field-label">Occurrence time *</span><input aria-label="Occurrence time *" className="input !bg-white" type="time" min="00:00" max={latestOccurrenceTime} value={occurrenceTime} onChange={(e) => setOccurrenceTime(e.target.value)} /></label>
        <label className="sm:col-span-2"><span className="field-label">Location *</span><div className="relative"><MapPin size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-600" /><input aria-label="Location *" className="input !bg-white !pl-10" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Venue, zone or nearby landmark" /></div></label>
        {selectedEvent && <p className="sm:col-span-4 -mt-1 text-xs text-ink-500">The date is fixed to the selected event’s D-Day. Choose a time within that 24-hour day.</p>}
      </div>
      <label className="sm:col-span-2"><span className="field-label">Description *</span><textarea aria-label="Description *" className="input min-h-24 !bg-white" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe what happened, who may be affected and what is known so far." /></label>
      <div className="sm:col-span-2">
        <span className="field-label">Supporting evidence (optional)</span>
        <div className="mt-1 flex flex-wrap items-center gap-3 rounded-md border border-ink-200 bg-white p-2">
          <label htmlFor="incident-evidence-files" className="btn-secondary inline-flex min-h-10 cursor-pointer items-center gap-2 px-3"><Upload size={15} /> Choose files</label>
          {files.length > 0 && <span className="text-xs text-ink-500">{files.length} file{files.length === 1 ? '' : 's'} selected</span>}
        </div>
        <input id="incident-evidence-files" aria-label="Supporting evidence (optional)" className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => { const selected = Array.from(e.target.files ?? []); setFiles((current) => [...current, ...selected].slice(0, 10)); e.currentTarget.value = ''; }} />
        {files.length > 0 && <ul aria-label="Selected evidence files" className="mt-2 grid gap-2 sm:grid-cols-2">{files.map((file, index) => <li key={`${file.name}-${file.size}-${file.lastModified}-${index}`} className="flex min-w-0 items-center gap-2 rounded-md border border-ink-100 bg-cream-50 px-3 py-2 text-sm text-ink-700"><span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} className="grid h-7 w-7 shrink-0 place-items-center rounded text-ink-500 hover:bg-red-50 hover:text-risk-high-text" onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}><X size={15} /></button></li>)}</ul>}
      </div>
      {!events.length ? <p role="status" className="sm:col-span-2 text-sm text-ink-600">No ongoing or recently completed events are currently eligible.</p> : selectedEvent && occurrenceTime && !occurrenceValid ? <p role="status" className="sm:col-span-2 text-sm text-ink-600">Choose a time on the selected event’s D-Day, no later than now.</p> : valid ? <p role="status" className="sm:col-span-2 text-sm text-brand-800">All required information is complete. Supporting evidence is optional.</p> : <p role="status" className="sm:col-span-2 text-sm text-ink-600">Complete the event, category, occurrence time, location, and description to submit. Supporting evidence is optional.</p>}
      <div className="sm:col-span-2 flex flex-wrap items-center justify-end gap-3"><span role="status" className={busy ? 'text-sm text-ink-600' : 'sr-only'} aria-live="polite">{busy ? 'Submitting incident report… Please keep this page open.' : ''}</span><button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button><button type="button" aria-busy={busy} aria-label={busy ? 'Submitting incident report' : 'Submit Incident Report'} className="btn-primary" disabled={!valid || busy} onClick={() => void submit()}>{busy ? <><LoaderCircle size={15} className="animate-spin" aria-hidden="true" /><span>Submitting…</span></> : <><Upload size={15} /> Submit Incident Report</>}</button></div>
    </div>
  </section>;
}

function IncidentDetail({ record, profile, directory, busy, setBusy, onDone, setError }: { record: IncidentView; profile: NonNullable<ReturnType<typeof useAuth>['profile']>; directory: M4AuthorityDirectoryEntry[]; busy: boolean; setBusy: (v: boolean) => void; onDone: () => Promise<void>; setError: (v: string) => void }) {
  const [note, setNote] = useState(''); const [team, setTeam] = useState('Venue operations'); const [authorityId, setAuthorityId] = useState(''); const [severity, setSeverity] = useState<M4IncidentSeverity>('medium'); const [outcome, setOutcome] = useState(''); const [actionFiles, setActionFiles] = useState<File[]>([]); const [actionNotice, setActionNotice] = useState('');
  const retryKey = useRef<{ signature: string; key: string } | undefined>(undefined);
  const matching = useMemo(() => directory.filter((item) => item.active && AUTHORITY_CARD_ORDER.includes(item.authorityType as typeof AUTHORITY_CARD_ORDER[number]))
    .sort((a, b) => {
      const aiRank = authorityRank(record, a.authorityId) - authorityRank(record, b.authorityId);
      if (aiRank !== 0) return aiRank;
      return AUTHORITY_CARD_ORDER.indexOf(a.authorityType as typeof AUTHORITY_CARD_ORDER[number]) - AUTHORITY_CARD_ORDER.indexOf(b.authorityType as typeof AUTHORITY_CARD_ORDER[number]);
    }).slice(0, 4), [directory, record]);
  const canAssignOrRefer = ORGANIZER_ASSIGNMENT_STATUSES.has(record.status);
  const canRecordResponse = !record.referredAuthorityId && ['submitted', 'manual_review_required', 'organizer_review', 'responding'].includes(record.status);
  const canResolve = record.status === 'awaiting_resolution' || (record.status === 'responding' && Boolean(record.assignedInternalTeam) && !record.referredAuthorityId);
  const noteValid = note.trim().length >= 10;
  useEffect(() => { if (!authorityId && matching[0]) setAuthorityId(matching[0].authorityId); }, [authorityId, matching]);
  const act = async (action: string, extra: Record<string, unknown> = {}) => { setBusy(true); setError(''); setActionNotice(incidentActionProgress(action)); const signature = JSON.stringify({ incidentId: record.incidentId, action, note, extra, files: actionFiles.map((file) => [file.name, file.type, file.size, file.lastModified]) }); const idempotencyKey = retryKey.current?.signature === signature ? retryKey.current.key : crypto.randomUUID(); retryKey.current = { signature, key: idempotencyKey }; try { const paths = await uploadEvidence(profile.uid, actionFiles, idempotencyKey); const fn = httpsCallable(functions, 'manageIncident'); const response = await fn({ incidentId: record.incidentId, action, note, evidencePaths: paths, idempotencyKey, ...extra }) as { data?: { autoResolved?: boolean } }; retryKey.current = undefined; setNote(''); setActionFiles([]); setActionNotice(incidentActionSuccess(action, Boolean(response.data?.autoResolved))); await onDone(); } catch (e) { setActionNotice('The action could not be completed. Review the message above and try again.'); setError(e instanceof Error ? e.message : 'Action failed. Retry the unchanged action to safely reuse the same request.'); } finally { setBusy(false); } };
  return <section className="space-y-4">{(busy || actionNotice) && <p role="status" aria-live="polite" className={`flex items-center gap-2 rounded-md border p-3 text-sm ${busy ? 'border-brand-200 bg-brand-50 text-ink-700' : 'border-green-200 bg-green-50 text-green-800'}`}>{busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}{actionNotice}</p>}{profile.role === 'public'
    ? <><ParticipantIncidentDetails record={record} setError={setError} /><ParticipantIncidentProgress steps={record.progress ?? participantProgressForRecord(record)} /></>
    : <StaffIncidentDetails record={record} setError={setError} organizer={profile.role === 'organizer'} />}
    {profile.role === 'organizer' && record.status !== 'resolved' && !record.activityClosed && <OrganizerActions record={record} matching={matching} note={note} setNote={setNote} team={team} setTeam={setTeam} authorityId={authorityId} setAuthorityId={setAuthorityId} severity={severity} setSeverity={setSeverity} outcome={outcome} setOutcome={setOutcome} actionFiles={actionFiles} setActionFiles={setActionFiles} busy={busy} noteValid={noteValid} canAssignOrRefer={canAssignOrRefer} canRecordResponse={canRecordResponse} canResolve={canResolve} act={act} />}
    {profile.role === 'authority' && record.status !== 'resolved' && !record.activityClosed && <article className="card"><div className="card-header"><h3 className="section-title">Authority investigation</h3></div><div className="card-body"><textarea aria-label="Investigation findings" className="input min-h-28" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Investigation actions, evidence reviewed, findings and outcome" /><ActionEvidence files={actionFiles} setFiles={setActionFiles} /><button className="btn-primary mt-3" aria-busy={busy} disabled={busy || note.trim().length < 10} onClick={() => void act('record_investigation')}>{busy ? <><LoaderCircle size={15} className="animate-spin" /> Submitting finding…</> : 'Submit finding to organizer'}</button></div></article>}
    {profile.role !== 'public' && <article className="card"><div className="card-header"><h3 className="section-title">Append-only history</h3></div><div className="divide-y divide-[#eee8dc]">{(record.history ?? []).filter((entry) => !['ai_incident_assessment', 'ai_authority_recommendation'].includes(entry.action)).map((entry) => <div key={entry.historyId} className="p-4 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong className="text-ink-900">{historyActionLabel(entry.action)}</strong><time className="text-xs text-ink-500">{new Date(entry.timestamp).toLocaleString()}</time></div><p className="mt-1 text-ink-600">{entry.summary}</p><IncidentEvidenceGallery incidentId={record.incidentId} evidence={entry.evidence} setError={setError} /></div>)}{!(record.history ?? []).some((entry) => !['ai_incident_assessment', 'ai_authority_recommendation'].includes(entry.action)) && <p className="p-4 text-sm text-ink-500">No history entries available.</p>}</div></article>}
  </section>;
}

function ParticipantIncidentDetails({ record, setError }: { record: IncidentView; setError: (value: string) => void }) {
  return <article className="card overflow-hidden"><div className="border-b border-[#e3dacb] p-5 sm:p-6"><div className="flex flex-wrap items-center gap-3"><p className="text-sm font-bold tracking-[0.06em] text-ink-500">{record.incidentId}</p><span className={`rounded-md px-3 py-2 text-sm font-semibold ${record.status === 'resolved' ? 'bg-green-50 text-status-approved' : 'bg-gold-50 text-gold-700'}`}>{record.status === 'resolved' ? 'Resolved' : 'In progress'}</span></div><h2 className="mt-4 font-display text-3xl font-bold leading-tight text-ink-900">{INCIDENT_CATEGORY_LABELS[record.category]}</h2><p className="mt-2 text-base text-ink-500">{record.eventName}{record.eventType ? ` · ${record.eventType.replaceAll('_', ' ')}` : ''}</p></div><div className="card-body space-y-5 text-sm"><dl className="grid gap-4 border-b border-[#eee8dc] pb-5 sm:grid-cols-2"><IconDetail icon={MapPin} label="Location" value={record.location} /><IconDetail icon={CalendarDays} label="Occurred" value={formatIncidentDate(record.occurredAt)} /></dl><div><h3 className="field-label">Description</h3><p className="mt-2 whitespace-pre-wrap leading-7 text-ink-700">{record.description}</p></div>{record.category === 'event_control_discrepancy' && <div><h3 className="field-label">Event discrepancy control</h3><p className="mt-2 text-ink-700">{record.linkedControlName ?? record.linkedControlId ?? 'Published control linked'}</p></div>}{record.evidence.length > 0 && <div><h3 className="field-label">Evidence</h3><p className="mt-2 text-ink-600">{record.evidence.length} uploaded file(s)</p><IncidentEvidenceGallery incidentId={record.incidentId} evidence={record.evidence} setError={setError} /></div>}</div></article>;
}

function ParticipantIncidentProgress({ steps }: { steps: M4ParticipantProgressStep[] }) {
  return <article className="card"><div className="card-header"><h2 className="section-title">Incident Progress</h2><Activity size={21} className="text-brand-700" /></div><div className="card-body"><ol className="relative space-y-5 before:absolute before:bottom-5 before:left-[13px] before:top-5 before:w-px before:bg-[#d8d0c1]">{steps.map((step) => { const Icon = step.state === 'complete' ? CheckCircle2 : step.state === 'current' ? Activity : Clock3; const iconTone = step.state === 'complete' ? 'border-green-500 bg-green-50 text-status-approved' : step.state === 'current' ? 'border-brand-700 bg-brand-50 text-brand-700' : 'border-ink-200 bg-white text-ink-400'; return <li key={step.key} className="relative flex gap-3"><div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 ${iconTone}`}><Icon size={15} /></div><div className="min-w-0 flex-1 pt-0.5"><div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><h3 className={`font-display text-lg font-bold ${step.state === 'upcoming' ? 'text-ink-500' : 'text-ink-900'}`}>{step.title}</h3><span className={`text-sm ${step.state === 'upcoming' ? 'text-ink-500' : 'text-ink-500'}`}>{step.timestamp ? formatIncidentDate(step.timestamp) : step.state === 'current' ? 'In progress' : 'Not started'}</span></div><p className="mt-1 text-sm leading-6 text-ink-600">{step.description}</p>{step.note && <p className="mt-2 rounded-md bg-brand-50 p-3 text-sm leading-6 text-ink-800"><strong>Resolution notes:</strong> {step.note}</p>}</div></li>; })}</ol></div></article>;
}

function participantProgressForRecord(record: IncidentView) {
  return participantIncidentProgress({ status: record.status, createdAt: record.createdAt ?? record.occurredAt, updatedAt: record.updatedAt ?? record.occurredAt, reviewedAt: record.reviewedAt, actionStartedAt: record.actionStartedAt, resolvedAt: record.resolvedAt, finalResolution: record.finalResolution, assignedInternalTeam: record.assignedInternalTeam, referredAuthorityType: record.referredAuthorityType, referredAuthorityName: record.referredAuthorityName });
}

function StaffIncidentDetails({ record, setError, organizer }: { record: IncidentView; setError: (value: string) => void; organizer: boolean }) {
  const aiAssessment = record.aiAssessment;
  const severity = record.severity ?? (aiAssessment?.status === 'success' ? aiAssessment.severity : undefined);
  const immediateAction = aiAssessment?.status === 'success' ? aiAssessment.immediateActionRequired : Boolean(record.immediateActionRequired);
  const assessmentResult = aiAssessment?.status === 'success' ? conciseAssessmentResult(aiAssessment.rationale) : `Unavailable: ${aiAssessment?.reason ?? 'Assessment data unavailable'}`;
  return <div className="space-y-4">
    <article className="card overflow-hidden">
      <div className="border-b border-[#e3dacb] p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-bold tracking-[0.06em] text-ink-500">{record.incidentId}</p><div className="flex flex-wrap justify-end gap-2">{organizer ? <OrganizerStatusBadge record={record} /> : <Status value={record.status} />}{severity && <SeverityBadge value={severity} />}</div></div><h2 className="mt-4 font-display text-2xl font-bold leading-tight text-ink-900">{INCIDENT_CATEGORY_LABELS[record.category]}</h2><h3 className="mt-2 text-sm font-medium text-ink-500">{record.eventName}</h3>{record.eventType && <p className="mt-1 text-xs text-ink-500">{record.eventType.replaceAll('_', ' ')}</p>}</div>
      <div className="card-body space-y-5 text-sm">{record.reportWithdrawnAt && <p className="rounded bg-gold-50 p-3">The reporter withdrew this report. Investigation history is retained.</p>}{record.activityClosed && <div className="rounded-md bg-warning-50 p-3 text-warning-900"><strong>Activity closed</strong><p className="mt-1">This incident is retained for history, but further action is disabled because the event was withdrawn.</p></div>}
        <dl className="grid min-w-0 gap-5 border-b border-[#eee8dc] pb-5 sm:grid-cols-2 xl:grid-cols-3"><IconDetail icon={UsersRound} label="Reporter" value={record.reporterName ?? record.reporterEmail ?? record.reporterUid ?? 'Unknown reporter'} /><IconDetail icon={MapPin} label="Location" value={record.location} /><IconDetail icon={CalendarDays} label="Occurred" value={formatIncidentDate(record.occurredAt)} /></dl>
        <div><h3 className="field-label">Description</h3><p className="mt-2 whitespace-pre-wrap leading-7 text-ink-700">{record.description}</p></div>
        {record.category === 'event_control_discrepancy' && <div><h3 className="field-label">Event discrepancy control</h3><p className="mt-2 text-ink-700">{record.linkedControlName ?? record.linkedControlId ?? 'Published control linked'}</p></div>}
        {record.evidence.length > 0 && <div className="rounded-md border border-dashed border-ink-300 bg-cream-50 p-4"><h3 className="font-semibold text-ink-800">Supporting evidence</h3><p className="mt-1 text-ink-600">{record.evidence.length} uploaded file(s)</p><IncidentEvidenceGallery incidentId={record.incidentId} evidence={record.evidence} setError={setError} /></div>}
        {record.finalResolution && <div className="rounded-md bg-brand-50 p-3"><strong>Final resolution</strong><p className="mt-1">{record.finalResolution}</p></div>}
      </div>
    </article>
    <article className="card border-l-4 border-l-brand-600">
      <div className="card-header"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700"><Sparkles size={19} /></div><div><h2 className="section-title">AI-assisted assessment</h2><p className="mt-1 text-xs text-ink-500">The assessment supports response planning. Staff record the final action.</p></div></div><span className="badge bg-ink-100 text-ink-700">Advisory</span></div>
      <div className="card-body space-y-5 text-sm"><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-md bg-cream-50 p-4"><p className="text-xs text-ink-500">Severity classification</p><div className="mt-2">{severity ? <SeverityBadge value={severity} /> : <span className="text-ink-600">Manual review required</span>}</div></div><div className="rounded-md bg-cream-50 p-4"><p className="text-xs text-ink-500">Immediate action</p><p className={`mt-2 font-semibold ${immediateAction ? 'text-risk-high-text' : 'text-status-approved'}`}>{aiAssessment?.status === 'success' ? immediateAction ? 'Recommended' : 'Not required' : 'Unavailable'}</p></div></div>
        <p className="flex items-start gap-2 text-sm text-ink-700"><ClipboardCheck size={16} className="mt-0.5 shrink-0 text-brand-700" /><span><strong>Recommended next step:</strong> {incidentRecommendedAction(immediateAction)}</span></p>
        <div><h3 className="field-label">Assessment result</h3><p className="mt-2 leading-7 text-ink-700">{assessmentResult}</p></div>
      </div>
    </article>
  </div>;
}

function IconDetail({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return <div className="flex min-w-0 items-start gap-3"><Icon size={24} className="mt-0.5 shrink-0 text-brand-700" /><div className="min-w-0"><dt className="text-base font-bold text-ink-800">{label}</dt><dd className="mt-1 break-words text-base text-ink-600">{value}</dd></div></div>;
}

function OrganizerActions({ record, matching, note, setNote, team, setTeam, authorityId, setAuthorityId, severity, setSeverity, outcome, setOutcome, actionFiles, setActionFiles, busy, noteValid, canAssignOrRefer, canRecordResponse, canResolve, act }: {
  record: IncidentView; matching: M4AuthorityDirectoryEntry[]; note: string; setNote: (value: string) => void;
  team: string; setTeam: (value: string) => void; authorityId: string; setAuthorityId: (value: string) => void;
  severity: M4IncidentSeverity; setSeverity: (value: M4IncidentSeverity) => void; outcome: string; setOutcome: (value: string) => void;
  actionFiles: File[]; setActionFiles: (files: File[]) => void; busy: boolean; noteValid: boolean;
  canAssignOrRefer: boolean; canRecordResponse: boolean; canResolve: boolean;
  act: (action: string, extra?: Record<string, unknown>) => Promise<void>;
}) {
  const [openPath, setOpenPath] = useState<'internal' | 'authority' | null>(null);
  const immediateActionRequired = record.aiAssessment?.status === 'success'
    ? record.aiAssessment.immediateActionRequired
    : Boolean(record.immediateActionRequired);
  const canChooseResponsePath = canAssignOrRefer && immediateActionRequired;
  const recordActionOnly = canRecordResponse && !canResolve && (!canAssignOrRefer || !immediateActionRequired);
  const recommendedAuthority = matching.find((item) => record.recommendedAuthorityIds?.includes(item.authorityId)) ?? matching[0];
  const workspaceGuidance = canChooseResponsePath
    ? organizerStageGuidance(record.status)
    : recordActionOnly
      ? 'Record the incident action and supporting evidence before resolution.'
      : organizerStageGuidance(record.status);

  return <article className="card">
    <div className="card-header"><div><h3 className="section-title">Organizer action workspace</h3><p className="mt-1 text-xs text-ink-500">{workspaceGuidance}</p></div><UsersRound size={20} className="text-brand-700" /></div>
    <div className="card-body space-y-4">
      {canChooseResponsePath && <>
        <div className="grid gap-3 lg:grid-cols-2">
          <button type="button" aria-expanded={openPath === 'internal'} className={`rounded-md border p-4 text-left transition ${openPath === 'internal' ? 'border-ink-900 bg-cream-50 ring-1 ring-ink-900' : 'border-[#e4ddcf] hover:border-brand-400 hover:bg-cream-50'}`} onClick={() => setOpenPath('internal')}>
            <div className="flex items-start gap-3"><UsersRound size={23} className="mt-0.5 shrink-0 text-brand-700" /><div><h4 className="font-semibold text-ink-900">Assign internal team</h4><p className="mt-1 text-sm leading-6 text-ink-600">Send the incident to event operations, security, medical or another internal response team.</p><span className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-brand-700">Open assignment <ArrowRight size={16} /></span></div></div>
          </button>
          <button type="button" aria-label="Request external authority" aria-expanded={openPath === 'authority'} disabled={openPath === 'internal' && !noteValid} className={`rounded-md border p-4 text-left transition ${openPath === 'authority' ? 'border-ink-900 bg-cream-50 ring-1 ring-ink-900' : 'border-[#e4ddcf] hover:border-brand-400 hover:bg-cream-50'} disabled:cursor-not-allowed disabled:opacity-60`} onClick={() => setOpenPath('authority')}>
            <div className="flex items-start gap-3"><ShieldCheck size={23} className="mt-0.5 shrink-0 text-gold-700" /><div><h4 className="font-semibold text-ink-900">Request external authority</h4><p className="mt-1 text-sm leading-6 text-ink-600">Refer the report to the recommended authority directory for investigation or support.</p><span className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-ink-900">Open authority directory <ArrowRight size={16} /></span></div></div>
          </button>
        </div>
        {openPath === 'internal' && <div className="rounded-md border border-brand-200 bg-cream-50 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold text-ink-900">Assign an internal response team</h4><p className="mt-1 text-sm text-ink-600">This assignment will move the report into investigation.</p></div><button type="button" aria-label="Close assignment form" className="text-ink-400 hover:text-ink-800" onClick={() => setOpenPath(null)}><X size={20} /></button></div>
          <label className="mt-5 block"><span className="field-label">Internal team</span><select aria-label="Internal team" className="input mt-1" value={team} onChange={(e) => setTeam(e.target.value)}>{INTERNAL_RESPONSE_TEAMS.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="mt-4 block"><span className="field-label">Assignment instruction or immediate action</span><textarea aria-label="Response note" aria-describedby="response-note-help" className="input mt-1 min-h-24" placeholder="Example: reopen the north entrance lane and deploy two crowd marshals." value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <ActionEvidence files={actionFiles} setFiles={setActionFiles} />
          <p id="response-note-help" className={`mt-2 text-xs ${note.length > 0 && !noteValid ? 'text-risk-high-text' : 'text-ink-500'}`}>{noteValid ? 'Assignment instruction ready.' : 'Enter at least 10 characters before assigning.'}</p>
          <button className="btn-primary mt-4" aria-busy={busy} disabled={busy || !noteValid || team.trim().length < 2} onClick={() => void act('assign_internal', { team })}>{busy ? <><LoaderCircle size={15} className="animate-spin" /> Saving assignment…</> : <><UsersRound size={15} /> Assign internal team</>}</button>
        </div>}
        {openPath === 'authority' && <div className="rounded-md border border-gold-200 bg-gold-50/40 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold text-ink-900">Request external authority</h4><p className="mt-1 text-sm text-ink-600">Select a recommended authority and describe the assistance needed.</p></div><button type="button" aria-label="Close authority form" className="text-ink-400 hover:text-ink-800" onClick={() => setOpenPath(null)}><X size={20} /></button></div>
          {recommendedAuthority && <div className="mt-4 rounded-md border border-gold-300 bg-white p-4"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-gold-50 text-gold-700"><Sparkles size={19} /></div><div><div className="flex flex-wrap items-center gap-2"><strong className="text-ink-900">AI-recommended authority</strong><span className="inline-flex items-center gap-1 rounded-md bg-gold-100 px-2 py-1 text-xs font-semibold text-ink-900"><Sparkles size={13} /> Outstanding match</span></div><p className="mt-1 text-sm text-ink-600">{recommendedAuthority.name} is highlighted based on the incident category, severity and immediate-action signal.</p><button type="button" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-ink-900" onClick={() => setAuthorityId(recommendedAuthority.authorityId)}>Use AI recommendation <ArrowRight size={16} /></button></div></div></div>}
          <fieldset className="mt-4"><legend className="field-label">Choose an authority</legend><div className="mt-2 grid gap-3 sm:grid-cols-2">{matching.map((item) => { const isRecommended = item.authorityId === recommendedAuthority?.authorityId; const isSelected = item.authorityId === authorityId; return <button type="button" key={item.authorityId} aria-pressed={isSelected} className={`relative rounded-md border p-4 text-left transition ${isSelected ? 'border-ink-900 bg-white ring-1 ring-ink-900' : 'border-gold-200 bg-white hover:border-gold-400'}`} onClick={() => setAuthorityId(item.authorityId)}><div className="flex items-start justify-between gap-3"><div><h5 className="font-semibold text-ink-900">{item.name}</h5>{isRecommended && <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-ink-900"><Sparkles size={13} /> AI recommended</span>}</div>{isRecommended && <Sparkles size={21} className="shrink-0 text-gold-700" />}</div><p className="mt-3 text-sm leading-5 text-ink-600">{item.serviceCategories.map((category) => INCIDENT_CATEGORY_LABELS[category]).join(' · ')}</p><p className="mt-3 text-xs text-ink-500">{item.coverageAreas.join(' · ')} · {item.contactPhone}</p></button>; })}</div>{matching.length === 0 && <p role="status" className="mt-3 text-xs text-risk-high-text">No active authority directory entries are available. Ask an administrator to update the authority directory.</p>}</fieldset>
          <label className="mt-4 block"><span className="field-label">Request details</span><textarea aria-label="Response note" aria-describedby="response-note-help" className="input mt-1 min-h-24" placeholder="Example: inspect crowd-control routes and advise on immediate access management." value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <ActionEvidence files={actionFiles} setFiles={setActionFiles} />
          <p className={`mt-2 text-xs ${note.length > 0 && !noteValid ? 'text-risk-high-text' : 'text-ink-500'}`}>{noteValid ? 'Request details ready.' : 'Enter at least 10 characters before requesting assistance.'}</p>
          <button className="btn-primary mt-4" aria-busy={busy} disabled={busy || !authorityId || !noteValid} onClick={() => void act('refer_authority', { authorityId })}>{busy ? <><LoaderCircle size={15} className="animate-spin" /> Sending request…</> : <><ShieldCheck size={15} /> Request external authority</>}</button>
          {matching.length < 4 && matching.length > 0 && <p role="status" className="mt-2 text-xs text-ink-500">The directory currently contains {matching.length} of the four standard authority entries.</p>}
        </div>}
      </>}

      {recordActionOnly && <div className="rounded-md border border-[#e4ddcf] bg-cream-50 p-4 sm:p-5">
        <div className="flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700"><ClipboardCheck size={17} /></div><div><h4 className="font-semibold text-ink-900">Record incident action</h4><p className="mt-1 text-sm text-ink-600">Capture the action taken and upload supporting evidence if available. This is separate from the AI recommendation.</p></div></div>
        <label className="mt-4 block"><span className="field-label">Action taken *</span><textarea aria-label="Response note" aria-describedby="response-note-help" className="input mt-1 min-h-24" placeholder="Summarise the action taken, response, or observation." value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <ActionEvidence files={actionFiles} setFiles={setActionFiles} />
        <p id="response-note-help" className={`mt-2 text-xs ${note.length > 0 && !noteValid ? 'text-risk-high-text' : 'text-ink-500'}`}>{noteValid ? 'Incident action ready to record.' : 'Enter at least 10 characters before recording the action.'}</p>
        <button className="btn-primary mt-4" aria-busy={busy} disabled={busy || !noteValid} onClick={() => void act('record_response')}>{busy ? <><LoaderCircle size={15} className="animate-spin" /> Saving action…</> : <><ClipboardCheck size={15} /> Record incident action</>}</button>
      </div>}

      {!canChooseResponsePath && !recordActionOnly && !canResolve && <p role="status" className="rounded-md border border-brand-200 bg-brand-50 p-3 text-sm text-ink-700">The external authority is investigating this incident. Organizer actions will become available after the authority submits its finding.</p>}
      {canResolve && <div className="rounded-md border border-brand-200 bg-brand-50 p-4 sm:p-5"><h4 className="font-semibold text-ink-900">Close incident</h4><p className="mt-1 text-sm text-ink-600">{record.status === 'responding' ? `The ${record.assignedInternalTeam} has been assigned. Record the final resolution and any action evidence when the response is complete.` : 'Review the completed action or authority finding, then record the final resolution.'}</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{!record.severity && <select aria-label="Manual severity" className="input" value={severity} onChange={(e) => setSeverity(e.target.value as M4IncidentSeverity)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>}{record.linkedControlId && <select aria-label="Discrepancy outcome" className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="">Discrepancy outcome</option><option value="confirmed_true">Confirmed true</option><option value="dismissed_fake">Dismissed as false</option></select>}</div><textarea aria-label="Final resolution" className="input mt-3 min-h-24" placeholder="Summarise the response, action taken and final outcome." value={note} onChange={(e) => setNote(e.target.value)} /><ActionEvidence files={actionFiles} setFiles={setActionFiles} /><button className="btn-primary mt-3" aria-label="Final resolution and close" aria-busy={busy} disabled={busy || !noteValid || Boolean(record.linkedControlId && !outcome)} onClick={() => void act('resolve', { resolution: note, manualSeverity: severity, discrepancyOutcome: outcome })}>{busy ? <><LoaderCircle size={15} className="animate-spin" /> Closing incident…</> : <><CheckCircle2 size={15} /> Final resolution and close</>}</button></div>}
    </div>
  </article>;
}

function organizerStageGuidance(status: M4IncidentRecord['status']) {
  if (ORGANIZER_ASSIGNMENT_STATUSES.has(status)) return 'Choose an internal team or request the recommended external authority.';
  if (status === 'responding') return 'The internal team is responding. Record the completed response when it is ready.';
  if (status === 'authority_investigation') return 'The referred authority is investigating this incident.';
  if (status === 'awaiting_resolution') return 'The response is complete. Review it and record the final resolution.';
  return 'Review the incident history and current status.';
}

function Status({ value }: { value: string }) { return <span className="badge bg-cream-100 text-ink-700">{incidentStatusLabel(value)}</span>; }
function OrganizerStatusBadge({ record }: { record: IncidentView }) {
  const actionRequired = isOrganizerActionRequired(record);
  return <span className={`badge ${actionRequired ? 'bg-red-50 text-risk-high-text' : record.status === 'awaiting_resolution' ? 'bg-brand-50 text-brand-700' : 'bg-cream-100 text-ink-700'}`}>{actionRequired && <Flag size={12} />} {organizerStatusLabel(record)}</span>;
}

function incidentActionProgress(action: string) {
  const labels: Record<string, string> = { assign_internal: 'Assigning the internal response team… Please keep this page open.', record_response: 'Saving the incident action and evidence… Please keep this page open.', refer_authority: 'Sending the authority request… Please keep this page open.', record_investigation: 'Submitting the investigation finding… Please keep this page open.', resolve: 'Closing the incident and notifying the reporter… Please keep this page open.' };
  return labels[action] ?? 'Saving the incident update… Please keep this page open.';
}

function incidentActionSuccess(action: string, autoResolved = false) {
  const messages: Record<string, string> = { assign_internal: 'Internal team assigned. The reporter has been notified.', record_response: autoResolved ? 'Incident action recorded and the incident was closed. The reporter has been notified.' : 'Incident action recorded. The incident is now waiting for final resolution.', refer_authority: 'Authority request sent. The selected authority has been notified.', record_investigation: 'Investigation finding submitted. The organizer has been notified.', resolve: 'Incident closed. The reporter has been notified of the final resolution.' };
  return messages[action] ?? 'Incident update saved successfully.';
}
function SeverityBadge({ value }: { value: M4IncidentSeverity }) {
  const tone = value === 'high' ? 'bg-red-50 text-risk-high-text' : value === 'medium' ? 'bg-gold-50 text-gold-700' : 'bg-green-50 text-status-approved';
  return <span className={`badge ${tone}`}>{value.charAt(0).toUpperCase() + value.slice(1)} severity</span>;
}
function incidentRecommendedAction(immediateAction: boolean) {
  return immediateAction
    ? 'Start organizer response immediately by assigning an internal team or requesting external authority assistance.'
    : 'Review the report in the normal workflow and record the appropriate response before final resolution.';
}
function conciseAssessmentResult(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const sentences = normalized.match(/[^.!?]+[.!?]+/g) ?? [normalized];
  // Keep the result concise by sentence count, but never cut a sentence mid-way.
  return sentences.slice(0, 2).join(' ').trim();
}
const ORGANIZER_RESOLVED_QUEUE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
function isOrganizerClosed(record: IncidentView) { return record.status === 'resolved' || Boolean(record.activityClosed); }
function isRecentlyResolvedForQueue(record: IncidentView) { return record.status === 'resolved' && Boolean(record.resolvedAt) && Date.now() - Number(record.resolvedAt) <= ORGANIZER_RESOLVED_QUEUE_WINDOW_MS; }
function organizerStatusLabel(record: IncidentView) {
  if (isOrganizerClosed(record)) return 'Closed';
  if (ORGANIZER_ASSIGNMENT_STATUSES.has(record.status)) return 'Needs action';
  if (record.status === 'awaiting_resolution') return 'Review For Resolution';
  if (record.status === 'authority_investigation') return 'In progress';
  if (record.status === 'responding') return 'In progress';
  return incidentStatusLabel(record.status);
}
function incidentStatusLabel(value: string) {
  const labels: Record<string, string> = { submitted: 'Submitted', manual_review_required: 'Manual Review Required', organizer_review: 'Organizer Review', responding: 'In Progress', authority_investigation: 'Authority Investigation', awaiting_resolution: 'Awaiting Resolution', resolved: 'Resolved' };
  return labels[value] ?? value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
function historyActionLabel(value: string) {
  const labels: Record<string, string> = { incident_submitted: 'Incident Submitted', ai_incident_assessment: 'AI Incident Assessment', ai_authority_recommendation: 'AI Authority Recommendation', assign_internal: 'Internal Team Assigned', refer_authority: 'Authority Referral', record_response: 'Response Action Recorded', record_investigation: 'Investigation Finding Submitted', resolve: 'Incident Resolved' };
  return labels[value] ?? value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
function compareOrganizerQueue(a: IncidentView, b: IncidentView) {
  const actionRank = Number(isOrganizerActionRequired(b)) - Number(isOrganizerActionRequired(a));
  if (actionRank !== 0) return actionRank;
  const severityRank = ({ high: 0, medium: 1, low: 2 } as Record<string, number>)[a.severity ?? 'medium'] - ({ high: 0, medium: 1, low: 2 } as Record<string, number>)[b.severity ?? 'medium'];
  if (severityRank !== 0) return severityRank;
  return (b.updatedAt ?? b.occurredAt) - (a.updatedAt ?? a.occurredAt);
}
function compareAuthorityQueue(a: IncidentView, b: IncidentView) {
  const severityRank = ({ high: 0, medium: 1, low: 2 } as Record<string, number>)[a.severity ?? 'medium'] - ({ high: 0, medium: 1, low: 2 } as Record<string, number>)[b.severity ?? 'medium'];
  if (severityRank !== 0) return severityRank;
  return (b.updatedAt ?? b.occurredAt) - (a.updatedAt ?? a.occurredAt);
}
function isOrganizerActionRequired(record: IncidentView) { return ORGANIZER_ASSIGNMENT_STATUSES.has(record.status); }
function incidentReference(incidentId: string) { return incidentId; }
function formatIncidentDate(timestamp: number) { return new Date(timestamp).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function authorityRank(record: { recommendedAuthorityIds?: string[] }, authorityId: string) { const rank = record.recommendedAuthorityIds?.indexOf(authorityId) ?? -1; return rank < 0 ? 999 : rank; }

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
  return <section className="card mt-7"><div className="card-header"><div><h2 className="section-title">Authority directory</h2><p className="text-xs text-ink-500">Admin-managed contacts used for contextual external-assistance recommendations.</p></div></div><div className="card-body grid gap-3 sm:grid-cols-3"><input aria-label="Stable authority ID" className="input" placeholder="Stable authority ID" value={authorityId} onChange={(e) => setAuthorityId(e.target.value)} /><input aria-label="Authority name" className="input" placeholder="Authority name" value={name} onChange={(e) => setName(e.target.value)} /><select aria-label="Authority type" className="input" value={authorityType} onChange={(e) => setAuthorityType(e.target.value)}>{['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'].map((item) => <option key={item}>{item}</option>)}</select><input aria-label="Contact name" className="input" placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} /><input aria-label="Contact phone" className="input" placeholder="Contact phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} /><input aria-label="Coverage areas, comma-separated" className="input" placeholder="Coverage areas, comma-separated" value={coverage} onChange={(e) => setCoverage(e.target.value)} /><fieldset className="sm:col-span-3"><legend className="field-label">Service categories</legend><div className="flex flex-wrap gap-2">{INCIDENT_CATEGORIES.map((item) => <label key={item} className="rounded border px-2 py-1 text-xs"><input type="checkbox" checked={categories.includes(item)} onChange={(e) => setCategories(e.target.checked ? [...categories, item] : categories.filter((value) => value !== item))} /> {item.replaceAll('_', ' ')}</label>)}</div></fieldset><div className="sm:col-span-3 flex justify-end"><button className="btn-primary" disabled={busy || authorityId.length < 8 || name.length < 2 || contactName.length < 2 || contactPhone.length < 5 || categories.length === 0} onClick={() => void save()}>Save directory entry</button></div>{directory.length > 0 && <div className="sm:col-span-3 divide-y divide-[#eee8dc] border-t">{directory.map((entry) => <div key={entry.authorityId} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div><strong>{entry.name}</strong><p className="text-xs text-ink-500">{entry.authorityType} · {entry.coverageAreas.join(', ')} · {entry.contactPhone}</p></div><button type="button" className="btn-secondary" disabled={busy} onClick={() => void deactivate(entry)}>Deactivate</button></div>)}</div>}</div></section>;
}
