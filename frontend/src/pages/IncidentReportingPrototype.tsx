import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileCheck2,
  FileText,
  Flag,
  History,
  Info,
  LifeBuoy,
  ListChecks,
  MapPin,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Upload,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import logoUrl from '../assets/brand/steras-logo-horizontal.svg';

type Role = 'organizer' | 'authority';
type IncidentStatus = 'Submitted' | 'Under review' | 'Action required' | 'Investigating' | 'Resolved';
type Severity = 'Low' | 'Medium' | 'High';

type HistoryEntry = {
  label: string;
  detail: string;
  at: string;
  state: 'done' | 'current' | 'muted';
};

type Incident = {
  id: string;
  event: string;
  eventType: string;
  category: string;
  title: string;
  description: string;
  location: string;
  occurredAt: string;
  submittedAt: string;
  status: IncidentStatus;
  severity: Severity;
  immediateAction: boolean;
  eventControl?: string;
  authority?: string;
  responseTeam?: string;
  history: HistoryEntry[];
};

type FormState = {
  event: string;
  category: string;
  occurredAt: string;
  location: string;
  description: string;
  eventControl: boolean;
};

const INITIAL_INCIDENTS: Incident[] = [
  {
    id: 'INC-2026-0007',
    event: 'Merdeka Cultural Festival',
    eventType: 'Cultural event',
    category: 'Crowd & capacity',
    title: 'Crowd congestion near north entrance',
    description: 'A queue formed across the north entrance after the main performance ended. Several visitors reported difficulty moving towards the first-aid point.',
    location: 'Dataran Merdeka · North entrance',
    occurredAt: '21 Aug 2026 · 18:42',
    submittedAt: '21 Aug 2026 · 19:05',
    status: 'Action required',
    severity: 'High',
    immediateAction: true,
    eventControl: 'Entry gates and crowd flow plan',
    authority: 'PDRM Kuala Lumpur',
    responseTeam: 'Festival operations team',
    history: [
      { label: 'Report submitted', detail: 'Reporter submitted the event-related incident.', at: '21 Aug · 19:05', state: 'done' },
      { label: 'AI assessment completed', detail: 'High severity · immediate action recommended.', at: '21 Aug · 19:06', state: 'done' },
      { label: 'Organizer response required', detail: 'Assign a response team or request external assistance.', at: 'Waiting', state: 'current' },
      { label: 'Resolution', detail: 'Final outcome will be recorded after response.', at: 'Not started', state: 'muted' },
    ],
  },
  {
    id: 'INC-2026-0006',
    event: 'River of Life Night Market',
    eventType: 'Festival',
    category: 'Facility & property',
    title: 'Lighting failure along riverside walkway',
    description: 'Three light fixtures were not operating near the riverside walkway. The organizer placed temporary barriers while waiting for maintenance support.',
    location: 'Masjid Jamek Precinct · Riverside walk',
    occurredAt: '20 Aug 2026 · 21:14',
    submittedAt: '20 Aug 2026 · 21:30',
    status: 'Investigating',
    severity: 'Medium',
    immediateAction: false,
    eventControl: 'Public lighting and safety signage',
    authority: 'DBKL event operations',
    responseTeam: 'Site safety team',
    history: [
      { label: 'Report submitted', detail: 'Reporter submitted the event-related incident.', at: '20 Aug · 21:30', state: 'done' },
      { label: 'Organizer response recorded', detail: 'Temporary barriers placed and maintenance contacted.', at: '20 Aug · 21:44', state: 'done' },
      { label: 'Referred to authority', detail: 'DBKL event operations is reviewing the linked control item.', at: '21 Aug · 08:10', state: 'current' },
      { label: 'Resolution', detail: 'Awaiting investigation outcome.', at: 'Not started', state: 'muted' },
    ],
  },
  {
    id: 'INC-2026-0005',
    event: 'KL Heritage Run 2026',
    eventType: 'Sports event',
    category: 'Medical & safety',
    title: 'Runner treated for heat exhaustion',
    description: 'A participant was assessed by the on-site medical team and recovered after cooling and hydration support.',
    location: 'Padang Merbok · Medical post 2',
    occurredAt: '17 Aug 2026 · 10:26',
    submittedAt: '17 Aug 2026 · 11:10',
    status: 'Resolved',
    severity: 'Low',
    immediateAction: false,
    responseTeam: 'On-site medical team',
    history: [
      { label: 'Report submitted', detail: 'Reporter submitted the event-related incident.', at: '17 Aug · 11:10', state: 'done' },
      { label: 'Internal response completed', detail: 'Medical team provided treatment and observation.', at: '17 Aug · 11:45', state: 'done' },
      { label: 'Final resolution recorded', detail: 'No further action required after recovery.', at: '17 Aug · 13:20', state: 'done' },
      { label: 'Closed', detail: 'Record retained for future assessment and audit.', at: '17 Aug · 13:20', state: 'done' },
    ],
  },
  {
    id: 'INC-2026-0004',
    event: 'Batik Design Showcase',
    eventType: 'Exhibition',
    category: 'Suspicious activity',
    title: 'Unattended package reported near foyer',
    description: 'A package was reported near the east foyer. Security isolated the area and confirmed the item belonged to an exhibitor.',
    location: 'Kuala Lumpur Convention Centre · East foyer',
    occurredAt: '14 Aug 2026 · 15:12',
    submittedAt: '14 Aug 2026 · 15:18',
    status: 'Resolved',
    severity: 'Medium',
    immediateAction: true,
    authority: 'PDRM Kuala Lumpur',
    responseTeam: 'Venue security',
    history: [
      { label: 'Report submitted', detail: 'Reporter submitted the event-related incident.', at: '14 Aug · 15:18', state: 'done' },
      { label: 'Immediate action taken', detail: 'Security isolated the area while the package was checked.', at: '14 Aug · 15:22', state: 'done' },
      { label: 'Internal response completed', detail: 'Exhibitor ownership was confirmed and the area reopened.', at: '14 Aug · 15:39', state: 'done' },
      { label: 'Closed', detail: 'Record retained for future assessment and audit.', at: '14 Aug · 16:00', state: 'done' },
    ],
  },
];

const CATEGORY_OPTIONS = [
  'Crowd & capacity',
  'Missing person / lost-and-found',
  'Medical & safety',
  'Security concern',
  'Facility & property',
  'Access & traffic',
  'Suspicious activity',
  'Event Control discrepancy',
];

const AUTHORITY_DIRECTORY = [
  { name: 'PDRM Kuala Lumpur', service: 'Security, crowd control and suspicious activity', area: 'Kuala Lumpur', contact: '+60 3 2115 9999' },
  { name: 'BOMBA Kuala Lumpur', service: 'Fire safety and emergency response', area: 'Kuala Lumpur', contact: '+60 3 2687 6000' },
  { name: 'KKM medical response', service: 'Medical incidents and public health', area: 'Kuala Lumpur', contact: '+60 3 8883 3888' },
  { name: 'DBKL event operations', service: 'Venue, access and public-space issues', area: 'Kuala Lumpur', contact: '+60 3 2617 9000' },
];

const INITIAL_FORM: FormState = {
  event: 'Merdeka Cultural Festival',
  category: 'Crowd & capacity',
  occurredAt: '2026-08-21T18:42',
  location: 'Dataran Merdeka · North entrance',
  description: '',
  eventControl: false,
};

function statusClasses(status: IncidentStatus) {
  if (status === 'Resolved') return 'bg-green-100 text-status-approved';
  if (status === 'Action required') return 'bg-red-100 text-status-rejected';
  if (status === 'Investigating') return 'bg-gold-100 text-gold-600';
  if (status === 'Under review') return 'bg-orange-100 text-orange-700';
  return 'bg-brand-50 text-brand-700';
}

function severityClasses(severity: Severity) {
  if (severity === 'High') return 'bg-red-100 text-risk-high-text';
  if (severity === 'Medium') return 'bg-gold-100 text-risk-medium-text';
  return 'bg-green-100 text-risk-low-text';
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function StatusPill({ status }: { status: IncidentStatus }) {
  return <span className={`badge ${statusClasses(status)}`}>{status}</span>;
}

function SeverityPill({ severity }: { severity: Severity }) {
  return <span className={`badge ${severityClasses(severity)}`}>{severity} severity</span>;
}

function PreviewBanner() {
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <Info size={18} className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true" />
        <p><strong>Prototype preview.</strong> This screen uses synthetic data and local interactions; it does not create live incident records.</p>
      </div>
      <span className="shrink-0 text-xs font-bold uppercase tracking-[0.08em] text-brand-600">M4 · Incident reporting</span>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, detail, tone = 'brand' }: { icon: LucideIcon; label: string; value: string; detail: string; tone?: 'brand' | 'red' | 'gold' | 'green' }) {
  const iconClass = tone === 'red' ? 'bg-red-100 text-risk-high-text' : tone === 'gold' ? 'bg-gold-100 text-gold-600' : tone === 'green' ? 'bg-green-100 text-status-approved' : 'bg-brand-50 text-brand-700';
  return (
    <div className="card flex items-start gap-3 p-4">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${iconClass}`}><Icon size={19} aria-hidden="true" /></div>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-500">{label}</p>
        <p className="mt-1 text-2xl font-bold text-ink-900">{value}</p>
        <p className="mt-0.5 text-xs text-ink-500">{detail}</p>
      </div>
    </div>
  );
}

function PageHeader({ role, onRoleChange }: { role: Role; onRoleChange: (role: Role) => void }) {
  return (
    <header className="border-b border-[#ddd3c2] bg-[#fffdf8]/95 backdrop-blur-sm">
      <div className="mx-auto flex min-h-[72px] max-w-[1440px] items-center justify-between gap-4 px-5 sm:px-8">
        <div className="flex min-w-0 items-center gap-5">
          <Link to="/" className="shrink-0" aria-label="STERAS home"><img src={logoUrl} alt="STERAS" className="w-32 sm:w-36" /></Link>
          <div className="hidden h-7 w-px bg-[#ddd3c2] sm:block" />
          <div className="hidden min-w-0 sm:block">
            <p className="truncate text-sm font-bold text-ink-800">Incident reporting prototype</p>
            <p className="text-xs text-ink-500">M4 workflow preview</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden rounded-md border border-ink-200 bg-[#fffdf8] p-1 sm:flex" aria-label="Prototype role switcher">
            <button type="button" onClick={() => onRoleChange('organizer')} className={`rounded px-3 py-1.5 text-xs font-semibold ${role === 'organizer' ? 'bg-brand-600 text-white' : 'text-ink-500 hover:bg-cream-100'}`}>Organizer view</button>
            <button type="button" onClick={() => onRoleChange('authority')} className={`rounded px-3 py-1.5 text-xs font-semibold ${role === 'authority' ? 'bg-brand-600 text-white' : 'text-ink-500 hover:bg-cream-100'}`}>Authority view</button>
          </div>
          <Link to="/dashboard-preview" className="btn-secondary !min-h-9 !px-3 text-xs"><ArrowLeft size={14} /> <span className="hidden sm:inline">Back to preview</span></Link>
        </div>
      </div>
      <div className="border-t border-[#eee8dc] bg-[#fffdf8] px-5 py-2 sm:hidden">
        <div className="mx-auto flex max-w-[1440px] rounded-md border border-ink-200 bg-cream-50 p-1">
          <button type="button" onClick={() => onRoleChange('organizer')} className={`flex-1 rounded px-3 py-1.5 text-xs font-semibold ${role === 'organizer' ? 'bg-brand-600 text-white' : 'text-ink-500'}`}>Organizer view</button>
          <button type="button" onClick={() => onRoleChange('authority')} className={`flex-1 rounded px-3 py-1.5 text-xs font-semibold ${role === 'authority' ? 'bg-brand-600 text-white' : 'text-ink-500'}`}>Authority view</button>
        </div>
      </div>
    </header>
  );
}

function IncidentCard({ incident, selected, onSelect }: { incident: Incident; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} className={`group w-full border-b border-[#e7dfd0] px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-cream-50 sm:px-5 ${selected ? 'bg-brand-50/70' : 'bg-[#fffdf8]'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold tracking-[0.05em] text-ink-500">{incident.id}</span>
            <StatusPill status={incident.status} />
          </div>
          <h3 className="mt-2 truncate font-display text-sm font-bold text-ink-900">{incident.title}</h3>
          <p className="mt-1 truncate text-xs text-ink-500">{incident.event} · {incident.occurredAt}</p>
        </div>
        <ChevronRight size={17} className={`mt-1 shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5 ${selected ? 'text-brand-600' : ''}`} aria-hidden="true" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-500">
        <SeverityPill severity={incident.severity} />
        <span className="inline-flex items-center gap-1"><MapPin size={13} />{incident.location.split('·')[0].trim()}</span>
      </div>
    </button>
  );
}

function IncidentList({ incidents, selectedId, onSelect, query, onQueryChange, filter, onFilterChange, emptyLabel }: {
  incidents: Incident[];
  selectedId: string;
  onSelect: (incident: Incident) => void;
  query: string;
  onQueryChange: (value: string) => void;
  filter: string;
  onFilterChange: (value: string) => void;
  emptyLabel: string;
}) {
  const filtered = useMemo(() => incidents.filter((incident) => {
    const matchesFilter = filter === 'all' || incident.status === filter || incident.severity === filter;
    const haystack = `${incident.id} ${incident.title} ${incident.event} ${incident.category}`.toLowerCase();
    return matchesFilter && haystack.includes(query.toLowerCase());
  }), [filter, incidents, query]);

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-[#e3dacb] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="section-title">Incident reports</p>
            <p className="mt-1 text-xs text-ink-500">{filtered.length} of {incidents.length} records shown</p>
          </div>
          <div className="flex gap-2">
            <label className="relative min-w-0 flex-1 sm:w-44 sm:flex-none">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden="true" />
              <input value={query} onChange={(event) => onQueryChange(event.target.value)} className="input !min-h-9 !pl-9 !text-xs" placeholder="Search reports" aria-label="Search incident reports" />
            </label>
            <select value={filter} onChange={(event) => onFilterChange(event.target.value)} className="input !min-h-9 !w-auto !py-1.5 !text-xs" aria-label="Filter incident reports">
              <option value="all">All</option>
              <option value="Action required">Action required</option>
              <option value="Investigating">Investigating</option>
              <option value="Resolved">Resolved</option>
              <option value="High">High severity</option>
            </select>
          </div>
        </div>
      </div>
      {filtered.length > 0 ? filtered.map((incident) => <IncidentCard key={incident.id} incident={incident} selected={incident.id === selectedId} onSelect={() => onSelect(incident)} />) : <div className="px-5 py-12 text-center text-sm text-ink-500">{emptyLabel}</div>}
    </div>
  );
}

function HistoryTimeline({ entries }: { entries: HistoryEntry[] }) {
  return (
    <div className="space-y-0">
      {entries.map((entry, index) => (
        <div key={`${entry.label}-${index}`} className="relative flex gap-3 pb-5 last:pb-0">
          {index < entries.length - 1 && <span className="absolute left-[9px] top-5 h-[calc(100%-8px)] w-px bg-[#ddd3c2]" aria-hidden="true" />}
          <span className={`relative z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${entry.state === 'done' ? 'border-status-approved bg-green-50 text-status-approved' : entry.state === 'current' ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-ink-200 bg-[#fffdf8] text-ink-300'}`}>
            {entry.state === 'done' ? <CheckCircle2 size={12} /> : entry.state === 'current' ? <Activity size={11} /> : <Clock3 size={11} />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className={`text-sm font-semibold ${entry.state === 'muted' ? 'text-ink-400' : 'text-ink-800'}`}>{entry.label}</p>
              <span className="text-[11px] text-ink-400">{entry.at}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-ink-500">{entry.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function IncidentDetail({ incident, role, onRequestAssistance, onResolve }: { incident: Incident; role: Role; onRequestAssistance: () => void; onResolve: () => void }) {
  return (
    <div className="space-y-4">
      <section className="card overflow-hidden">
        <div className="border-b border-[#e3dacb] bg-[#fffdf8] px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold tracking-[0.06em] text-ink-500">{incident.id}</span><StatusPill status={incident.status} /></div>
              <h2 className="mt-3 font-display text-xl font-bold leading-tight text-ink-900">{incident.title}</h2>
              <p className="mt-2 text-sm text-ink-500">{incident.event} · {incident.eventType}</p>
            </div>
            <SeverityPill severity={incident.severity} />
          </div>
          <div className="mt-5 grid gap-3 border-t border-[#eee8dc] pt-4 sm:grid-cols-2">
            <div className="flex items-start gap-2 text-xs text-ink-600"><MapPin size={15} className="mt-0.5 shrink-0 text-brand-600" /><span><strong className="block text-ink-800">Location</strong>{incident.location}</span></div>
            <div className="flex items-start gap-2 text-xs text-ink-600"><CalendarDays size={15} className="mt-0.5 shrink-0 text-brand-600" /><span><strong className="block text-ink-800">Occurred</strong>{incident.occurredAt}</span></div>
          </div>
        </div>
        <div className="px-5 py-5 sm:px-6">
          <p className="text-sm leading-6 text-ink-700">{incident.description}</p>
          {incident.eventControl && <div className="mt-4 flex items-start gap-3 rounded-md border border-gold-200 bg-gold-50 px-3 py-3 text-xs text-gold-700"><FileCheck2 size={16} className="mt-0.5 shrink-0" /><div><strong className="block">Linked Event Control item</strong><span>{incident.eventControl}</span></div></div>}
        </div>
      </section>

      <section className={`card border-l-4 ${incident.immediateAction ? 'border-l-red-500' : 'border-l-brand-500'}`}>
        <div className="card-body">
          <div className="flex items-start gap-3">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${incident.immediateAction ? 'bg-red-100 text-risk-high-text' : 'bg-brand-50 text-brand-700'}`}><Sparkles size={17} /></div>
            <div>
              <div className="flex flex-wrap items-center gap-2"><p className="section-title">AI-assisted assessment</p><span className="badge bg-ink-100 text-ink-600">Advisory</span></div>
              <p className="mt-1 text-xs leading-5 text-ink-500">The assessment supports response planning. The organizer or assigned authority records the final action.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md bg-cream-50 p-3"><span className="text-xs text-ink-500">Severity classification</span><div className="mt-1"><SeverityPill severity={incident.severity} /></div></div>
            <div className="rounded-md bg-cream-50 p-3"><span className="text-xs text-ink-500">Immediate action</span><p className={`mt-1 text-sm font-bold ${incident.immediateAction ? 'text-risk-high-text' : 'text-status-approved'}`}>{incident.immediateAction ? 'Recommended' : 'Not indicated'}</p></div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-ink-500"><FileText size={14} />Based on category, description, event, location, time and available evidence.</div>
        </div>
      </section>

      {role === 'organizer' ? (
        <section className="card">
          <div className="card-header"><div><p className="section-title">Organizer response</p><p className="mt-1 text-xs text-ink-500">Record how your event team is handling this report.</p></div><UsersRound size={19} className="text-brand-600" /></div>
          <div className="card-body">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-[#e3dacb] p-3"><div className="flex items-center gap-2"><UsersRound size={16} className="text-brand-600" /><p className="text-sm font-semibold text-ink-800">Handle internally</p></div><p className="mt-1 text-xs leading-5 text-ink-500">Assign a response team, record actions and upload supporting evidence.</p><button type="button" onClick={onResolve} className="btn-secondary mt-3 !min-h-9 !px-3 text-xs">Record response <ArrowRight size={14} /></button></div>
              <div className="rounded-md border border-[#e3dacb] p-3"><div className="flex items-center gap-2"><LifeBuoy size={16} className="text-brand-600" /><p className="text-sm font-semibold text-ink-800">Request external help</p></div><p className="mt-1 text-xs leading-5 text-ink-500">Review recommended authorities and refer the report for investigation.</p><button type="button" onClick={onRequestAssistance} className="btn-primary mt-3 !min-h-9 !px-3 text-xs">Review authorities <ArrowRight size={14} /></button></div>
            </div>
            <div className="mt-4 rounded-md bg-cream-50 px-3 py-3 text-xs text-ink-600"><span className="font-semibold text-ink-800">Current response team:</span> {incident.responseTeam ?? 'Not assigned yet'}</div>
            {incident.eventControl && <div className="mt-4 rounded-md border border-[#e3dacb] p-3"><p className="text-xs font-bold uppercase tracking-[0.06em] text-ink-500">Event Control discrepancy outcome</p><p className="mt-1 text-xs leading-5 text-ink-500">Required before closing a report linked to a published control item.</p><div className="mt-3 flex flex-wrap gap-4 text-sm text-ink-700"><label className="flex items-center gap-2"><input type="radio" name={`discrepancy-${incident.id}`} defaultChecked className="h-4 w-4 text-brand-600 focus:ring-brand-500" /> Confirmed true</label><label className="flex items-center gap-2"><input type="radio" name={`discrepancy-${incident.id}`} className="h-4 w-4 text-brand-600 focus:ring-brand-500" /> Dismissed as false</label></div></div>}
          </div>
        </section>
      ) : (
        <section className="card">
          <div className="card-header"><div><p className="section-title">Authority review</p><p className="mt-1 text-xs text-ink-500">Record referral and investigation progress for this incident.</p></div><ShieldCheck size={19} className="text-brand-600" /></div>
          <div className="card-body">
            <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-md bg-cream-50 p-3"><span className="text-xs text-ink-500">Assigned authority</span><p className="mt-1 text-sm font-semibold text-ink-800">{incident.authority ?? 'Not assigned'}</p></div><div className="rounded-md bg-cream-50 p-3"><span className="text-xs text-ink-500">Reporter request</span><p className="mt-1 text-sm font-semibold text-ink-800">{incident.authority ? 'External assistance requested' : 'Internal handling'}</p></div></div>
            <label className="mt-4 block"><span className="field-label">Investigation action or finding</span><textarea className="input min-h-24 resize-y" placeholder="Record what was checked, who was contacted and what the evidence shows." /></label>
            <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={onResolve} className="btn-primary !min-h-9 !px-3 text-xs"><CheckCircle2 size={14} /> Mark investigation complete</button><button type="button" onClick={onRequestAssistance} className="btn-secondary !min-h-9 !px-3 text-xs"><MessageSquare size={14} /> Save investigation note</button></div>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-header"><div><p className="section-title">Incident history</p><p className="mt-1 text-xs text-ink-500">Auditable status and responsibility timeline.</p></div><History size={19} className="text-brand-600" /></div>
        <div className="card-body"><HistoryTimeline entries={incident.history} /></div>
      </section>
    </div>
  );
}

function SubmissionForm({ form, onChange, onSubmit }: { form: FormState; onChange: (key: keyof FormState, value: string | boolean) => void; onSubmit: () => void }) {
  const canSubmit = form.event.trim() && form.category.trim() && form.occurredAt.trim() && form.location.trim() && form.description.trim();
  return (
    <div className="card">
      <div className="card-header"><div><p className="section-title">Report an incident</p><p className="mt-1 text-xs text-ink-500">For an ongoing event or an event completed within the past seven days.</p></div><Flag size={19} className="text-brand-600" /></div>
      <div className="card-body">
        <div className="mb-5 rounded-md border border-brand-200 bg-brand-50 px-3 py-3 text-xs leading-5 text-brand-800"><strong>Required information:</strong> category, description, occurrence date and time, location, and any available supporting evidence.</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className="field-label">Event <span className="text-risk-high-text">*</span></span><select value={form.event} onChange={(event) => onChange('event', event.target.value)} className="input"><option>Merdeka Cultural Festival</option><option>River of Life Night Market</option><option>KL Heritage Run 2026</option><option>Batik Design Showcase</option></select></label>
          <label><span className="field-label">Incident category <span className="text-risk-high-text">*</span></span><select value={form.category} onChange={(event) => onChange('category', event.target.value)} className="input">{CATEGORY_OPTIONS.map((category) => <option key={category}>{category}</option>)}</select></label>
          <label><span className="field-label">Occurrence date & time <span className="text-risk-high-text">*</span></span><input type="datetime-local" value={form.occurredAt} onChange={(event) => onChange('occurredAt', event.target.value)} className="input" /></label>
          <label className="sm:col-span-2"><span className="field-label">Incident location <span className="text-risk-high-text">*</span></span><div className="relative"><MapPin size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" /><input value={form.location} onChange={(event) => onChange('location', event.target.value)} className="input !pl-9" placeholder="Venue, zone or nearby landmark" /></div></label>
          <label className="sm:col-span-2"><span className="field-label">What happened? <span className="text-risk-high-text">*</span></span><textarea value={form.description} onChange={(event) => onChange('description', event.target.value)} className="input min-h-32 resize-y" placeholder="Describe what happened, who may be affected and what is known so far." /></label>
        </div>
        <div className="mt-4 rounded-md border border-[#e3dacb] p-3">
          <label className="flex cursor-pointer items-start gap-3"><input type="checkbox" checked={form.eventControl} onChange={(event) => onChange('eventControl', event.target.checked)} className="mt-1 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500" /><span><span className="block text-sm font-semibold text-ink-800">This concerns a published Event Control item</span><span className="mt-1 block text-xs leading-5 text-ink-500">Use this for inaccurate signage, documentation or other published control discrepancies.</span></span></label>
        </div>
        <div className="mt-4 rounded-md border border-dashed border-ink-300 bg-cream-50 px-4 py-5 text-center"><Upload size={20} className="mx-auto text-brand-600" /><p className="mt-2 text-sm font-semibold text-ink-800">Add supporting evidence</p><p className="mt-1 text-xs text-ink-500">Photos, PDF or other permitted evidence · prototype only</p><button type="button" className="btn-secondary mt-3 !min-h-9 !px-3 text-xs"><Paperclip size={14} /> Choose files</button></div>
        <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" className="btn-secondary !min-h-10">Save draft</button><button type="button" disabled={!canSubmit} onClick={onSubmit} className="btn-primary !min-h-10"><Send size={15} /> Submit incident report</button></div>
      </div>
    </div>
  );
}

function AuthorityDirectory({ onSelect }: { onSelect: (name: string) => void }) {
  return (
    <section className="card">
      <div className="card-header"><div><p className="section-title">Authority directory</p><p className="mt-1 text-xs text-ink-500">Prototype recommendations for external assistance.</p></div><LifeBuoy size={19} className="text-brand-600" /></div>
      <div className="divide-y divide-[#e7dfd0]">{AUTHORITY_DIRECTORY.map((authority) => <div key={authority.name} className="px-5 py-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-ink-800">{authority.name}</p><p className="mt-1 text-xs leading-5 text-ink-500">{authority.service}</p></div><ShieldCheck size={16} className="shrink-0 text-brand-600" /></div><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500"><span>{authority.area}</span><span>{authority.contact}</span></div><button type="button" onClick={() => onSelect(authority.name)} className="btn-secondary mt-3 !min-h-8 !px-3 text-xs">Select authority <ArrowRight size={13} /></button></div>)}</div>
    </section>
  );
}

function OrganizerView({ incidents, selectedId, setSelectedId, onSubmit, onRequestAssistance, onResolve, notice, form, onFormChange }: {
  incidents: Incident[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  onSubmit: () => void;
  onRequestAssistance: (authority?: string) => void;
  onResolve: () => void;
  notice: string | null;
  form: FormState;
  onFormChange: (key: keyof FormState, value: string | boolean) => void;
}) {
  const [activeTab, setActiveTab] = useState<'reports' | 'new'>('reports');
  const [showDirectory, setShowDirectory] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const selected = incidents.find((incident) => incident.id === selectedId) ?? incidents[0];
  const handleRequestAssistance = () => {
    setShowDirectory(true);
    onRequestAssistance();
  };

  return (
    <>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="page-eyebrow">Organizer workspace</p>
          <h1 className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">Incident reporting</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-600">Submit an event-related incident, follow the response progress and keep the final resolution in one auditable record.</p>
        </div>
        <button type="button" onClick={() => setActiveTab('new')} className="btn-primary shrink-0"><Plus size={16} /> Report an incident</button>
      </div>
      {notice && <div className="mt-5 flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-status-approved"><CheckCircle2 size={16} />{notice}</div>}
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={FileText} label="My reports" value={`${incidents.length}`} detail="All submitted reports" />
        <KpiCard icon={ShieldAlert} label="Needs action" value={`${incidents.filter((incident) => incident.status === 'Action required').length}`} detail="Organizer response required" tone="red" />
        <KpiCard icon={Activity} label="In progress" value={`${incidents.filter((incident) => incident.status === 'Investigating').length}`} detail="Response or investigation" tone="gold" />
        <KpiCard icon={CheckCircle2} label="Resolved" value={`${incidents.filter((incident) => incident.status === 'Resolved').length}`} detail="Retained for history" tone="green" />
      </div>
      <div className="mt-7 flex gap-1 border-b border-[#d9cdb8]" role="tablist">
        <button type="button" onClick={() => setActiveTab('reports')} className={`border-b-2 px-4 py-3 text-sm font-semibold ${activeTab === 'reports' ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500'}`} role="tab" aria-selected={activeTab === 'reports'}>My incident reports</button>
        <button type="button" onClick={() => setActiveTab('new')} className={`border-b-2 px-4 py-3 text-sm font-semibold ${activeTab === 'new' ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500'}`} role="tab" aria-selected={activeTab === 'new'}>New report</button>
      </div>
      {activeTab === 'new' ? (
        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,.85fr)]">
          <SubmissionForm form={form} onChange={onFormChange} onSubmit={onSubmit} />
          <section className="card h-fit">
            <div className="card-header"><div><p className="section-title">Before you submit</p><p className="mt-1 text-xs text-ink-500">The prototype follows the confirmed M4 requirements.</p></div><ListChecks size={19} className="text-brand-600" /></div>
            <div className="card-body">
              <ul className="space-y-4 text-xs leading-5 text-ink-600">
                <li className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700">1</span><span>Choose the event and record when and where the incident occurred.</span></li>
                <li className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700">2</span><span>Describe the incident and attach available evidence.</span></li>
                <li className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700">3</span><span>Review the AI-assisted severity and immediate-action assessment.</span></li>
                <li className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700">4</span><span>Handle the report internally or request assistance from a recommended authority.</span></li>
              </ul>
              <div className="mt-5 rounded-md bg-cream-50 px-3 py-3 text-xs text-ink-500"><strong className="text-ink-800">Privacy reminder:</strong> incident details and evidence are restricted to permitted users.</div>
            </div>
          </section>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(320px,.82fr)_minmax(0,1.18fr)]">
            <IncidentList incidents={incidents} selectedId={selected?.id ?? ''} onSelect={(incident) => setSelectedId(incident.id)} query={query} onQueryChange={setQuery} filter={filter} onFilterChange={setFilter} emptyLabel="No incident reports match your search." />
            {selected ? <IncidentDetail incident={selected} role="organizer" onRequestAssistance={handleRequestAssistance} onResolve={onResolve} /> : <div className="card flex min-h-64 items-center justify-center p-8 text-center text-sm text-ink-500">Select a report to view its details.</div>}
          </div>
          {showDirectory && <div className="mt-5"><AuthorityDirectory onSelect={(name) => onRequestAssistance(name)} /></div>}
        </>
      )}
    </>
  );
}

function AuthorityView({ incidents, selectedId, setSelectedId, onRequestAssistance, onResolve, notice }: { incidents: Incident[]; selectedId: string; setSelectedId: (id: string) => void; onRequestAssistance: () => void; onResolve: () => void; notice: string | null }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const referred = incidents.filter((incident) => incident.authority);
  const selected = referred.find((incident) => incident.id === selectedId) ?? referred[0];
  return (
    <>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="page-eyebrow">Authority workspace · PDRM</p><h1 className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">Incident queue</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-ink-600">Review referred incidents, record investigation actions and preserve a complete outcome history.</p></div><div className="flex items-center gap-2 rounded-md border border-[#ded5c5] bg-[#fffdf8] px-3 py-2 text-xs text-ink-600"><ShieldCheck size={16} className="text-brand-600" /> Scoped to assigned authority</div></div>
      {notice && <div className="mt-5 flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-status-approved"><CheckCircle2 size={16} />{notice}</div>}
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><KpiCard icon={Flag} label="Referred" value={`${referred.length}`} detail="Assigned to this authority" /><KpiCard icon={ShieldAlert} label="Immediate action" value={`${referred.filter((incident) => incident.immediateAction).length}`} detail="Review response priority" tone="red" /><KpiCard icon={Activity} label="Investigating" value={`${referred.filter((incident) => incident.status === 'Investigating').length}`} detail="Open investigation" tone="gold" /><KpiCard icon={CheckCircle2} label="Resolved" value={`${referred.filter((incident) => incident.status === 'Resolved').length}`} detail="Outcome available" tone="green" /></div>
      <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(320px,.82fr)_minmax(0,1.18fr)]"><IncidentList incidents={referred} selectedId={selected?.id ?? ''} onSelect={(incident) => setSelectedId(incident.id)} query={query} onQueryChange={setQuery} filter={filter} onFilterChange={setFilter} emptyLabel="No referred incidents match your search." />{selected ? <IncidentDetail incident={selected} role="authority" onRequestAssistance={onRequestAssistance} onResolve={onResolve} /> : <div className="card flex min-h-64 items-center justify-center p-8 text-center text-sm text-ink-500">Select an incident to review.</div>}</div>
    </>
  );
}

export default function IncidentReportingPrototype() {
  const [role, setRole] = useState<Role>('organizer');
  const [incidents, setIncidents] = useState<Incident[]>(INITIAL_INCIDENTS);
  const [selectedId, setSelectedId] = useState(INITIAL_INCIDENTS[0].id);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [notice, setNotice] = useState<string | null>(null);

  const updateForm = (key: keyof FormState, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));

  const changeRole = (nextRole: Role) => {
    setRole(nextRole);
    setNotice(null);
    const nextIncident = nextRole === 'authority' ? incidents.find((incident) => incident.authority) : incidents[0];
    if (nextIncident) setSelectedId(nextIncident.id);
  };

  const submitReport = () => {
    const nextNumber = incidents.length + 8;
    const newIncident: Incident = {
      id: `INC-2026-00${nextNumber}`,
      event: form.event,
      eventType: form.event.includes('Run') ? 'Sports event' : 'Cultural event',
      category: form.category,
      title: form.description.trim().split(/[.!?]/)[0].slice(0, 72) || 'New incident report',
      description: form.description.trim(),
      location: form.location,
      occurredAt: formatDateTime(form.occurredAt),
      submittedAt: 'Just now',
      status: 'Submitted',
      severity: 'Medium',
      immediateAction: false,
      eventControl: form.eventControl ? 'Published Event Control item · review required' : undefined,
      responseTeam: undefined,
      history: [
        { label: 'Report submitted', detail: 'Prototype report created successfully.', at: 'Just now', state: 'current' },
        { label: 'AI assessment', detail: 'Assessment will be shown when processing completes.', at: 'Processing', state: 'muted' },
        { label: 'Organizer response', detail: 'Response options will be available after assessment.', at: 'Not started', state: 'muted' },
        { label: 'Resolution', detail: 'Final outcome will be recorded after response.', at: 'Not started', state: 'muted' },
      ],
    };
    setIncidents((current) => [newIncident, ...current]);
    setSelectedId(newIncident.id);
    setForm(INITIAL_FORM);
    setNotice(`${newIncident.id} was submitted in the prototype. The report is now in Submitted status.`);
  };

  const requestAssistance = (authority?: string) => setNotice(authority ? `Prototype action: ${authority} selected for the external-assistance referral.` : 'Prototype action: authority directory opened. Select a recommended authority to create the referral.');
  const resolveIncident = () => {
    setIncidents((current) => current.map((incident) => incident.id === selectedId ? { ...incident, status: 'Resolved', history: incident.history.map((entry, index) => index === incident.history.length - 1 ? { ...entry, label: 'Resolution recorded', detail: 'Prototype resolution recorded by the current user.', at: 'Just now', state: 'done' } : entry) } : incident));
    setNotice('Prototype action: investigation/response marked complete and the incident is now Resolved.');
  };

  return (
    <div className="min-h-screen bg-cream-50 text-ink-800">
      <PageHeader role={role} onRoleChange={changeRole} />
      <main className="mx-auto w-full max-w-[1440px] px-5 py-7 sm:px-8 sm:py-10">
        <PreviewBanner />
        {role === 'organizer' ? <OrganizerView incidents={incidents} selectedId={selectedId} setSelectedId={setSelectedId} onSubmit={submitReport} onRequestAssistance={requestAssistance} onResolve={resolveIncident} notice={notice} form={form} onFormChange={updateForm} /> : <AuthorityView incidents={incidents} selectedId={selectedId} setSelectedId={setSelectedId} onRequestAssistance={requestAssistance} onResolve={resolveIncident} notice={notice} />}
      </main>
      <footer className="border-t border-[#ddd3c2] bg-[#fffdf8] py-5"><div className="mx-auto max-w-[1440px] px-5 text-center text-xs text-ink-500">STERAS · M4 Incident Reporting Prototype · Synthetic data only</div></footer>
    </div>
  );
}

