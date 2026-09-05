import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileText,
  Flag,
  History,
  Info,
  LifeBuoy,
  ListChecks,
  MapPin,
  Paperclip,
  Plus,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Upload,
  UserRound,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import logoUrl from '../assets/brand/steras-logo-horizontal.svg';

type Role = 'reporter' | 'organizer' | 'authority';
type IncidentStatus = 'Submitted' | 'Under review' | 'Action required' | 'Investigating' | 'Resolved';
type Severity = 'Low' | 'Medium' | 'High';
type ResponsePath = 'internal' | 'external';
type IncidentActionStatus = 'Assigned' | 'Requested' | 'Recorded' | 'Completed';
type DiscrepancyOutcome = 'Confirmed True' | 'Dismissed as False';

type HistoryEntry = {
  label: string;
  detail: string;
  at: string;
  state: 'done' | 'current' | 'muted';
};

type IncidentAction = {
  id: string;
  path: ResponsePath;
  label: string;
  owner: string;
  note: string;
  at: string;
  status: IncidentActionStatus;
};

type Incident = {
  id: string;
  reporter: string;
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
  actionRequired: boolean;
  recommendedAction: string;
  eventControl?: string;
  evidence?: string;
  authority?: string;
  responseTeam?: string;
  responsePath?: ResponsePath;
  recommendedAuthorities?: string[];
  discrepancyOutcome?: DiscrepancyOutcome;
  finalResolution?: string;
  actions: IncidentAction[];
  history: HistoryEntry[];
};

type FormState = {
  event: string;
  category: string;
  occurredAt: string;
  location: string;
  description: string;
  evidence: string;
  eventControl: boolean;
};

type FilterOption = {
  value: string;
  label: string;
};

const CURRENT_REPORTER = 'Aiman Rahman';

const INITIAL_INCIDENTS: Incident[] = [
  {
    id: 'INC-2026-0007',
    reporter: CURRENT_REPORTER,
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
    actionRequired: true,
    recommendedAction: 'Assign crowd-flow team or request PDRM support',
    eventControl: 'Entry gates and crowd flow plan',
    evidence: 'Photo of queue barrier and north entrance route',
    recommendedAuthorities: ['PDRM Kuala Lumpur', 'DBKL event operations'],
    actions: [],
    history: [
      { label: 'Report submitted', detail: 'Participant submitted the event-related incident.', at: '21 Aug · 19:05', state: 'done' },
      { label: 'AI assessment completed', detail: 'High severity · immediate action recommended.', at: '21 Aug · 19:06', state: 'done' },
      { label: 'Organizer action required', detail: 'Assign an internal team or request external authority assistance.', at: 'Waiting', state: 'current' },
      { label: 'Resolution', detail: 'Final outcome will be recorded after response.', at: 'Not started', state: 'muted' },
    ],
  },
  {
    id: 'INC-2026-0006',
    reporter: CURRENT_REPORTER,
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
    actionRequired: false,
    recommendedAction: 'Monitor maintenance response and verify walkway lighting',
    eventControl: 'Public lighting and safety signage',
    evidence: 'Three photos showing dark fixtures',
    authority: 'DBKL event operations',
    responsePath: 'external',
    actions: [
      {
        id: 'ACT-0006-01',
        path: 'external',
        label: 'External authority requested',
        owner: 'DBKL event operations',
        note: 'Requested a site check and repair coordination for the public walkway.',
        at: '21 Aug · 08:10',
        status: 'Requested',
      },
    ],
    history: [
      { label: 'Report submitted', detail: 'Participant submitted the event-related incident.', at: '20 Aug · 21:30', state: 'done' },
      { label: 'Organizer action recorded', detail: 'Temporary barriers placed and maintenance contacted.', at: '20 Aug · 21:44', state: 'done' },
      { label: 'Referred to authority', detail: 'DBKL event operations is reviewing the linked control item.', at: '21 Aug · 08:10', state: 'current' },
      { label: 'Resolution', detail: 'Awaiting investigation outcome.', at: 'Not started', state: 'muted' },
    ],
  },
  {
    id: 'INC-2026-0005',
    reporter: CURRENT_REPORTER,
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
    actionRequired: false,
    recommendedAction: 'Retain the medical response record for event history',
    evidence: 'Medical post record available',
    responseTeam: 'On-site medical team',
    responsePath: 'internal',
    finalResolution: 'The participant recovered after on-site treatment and observation. No further action was required.',
    actions: [
      {
        id: 'ACT-0005-01',
        path: 'internal',
        label: 'Internal response completed',
        owner: 'On-site medical team',
        note: 'Cooling, hydration and observation were completed at medical post 2.',
        at: '17 Aug · 11:45',
        status: 'Completed',
      },
    ],
    history: [
      { label: 'Report submitted', detail: 'Participant submitted the event-related incident.', at: '17 Aug · 11:10', state: 'done' },
      { label: 'Internal response completed', detail: 'Medical team provided treatment and observation.', at: '17 Aug · 11:45', state: 'done' },
      { label: 'Final resolution recorded', detail: 'No further action required after recovery.', at: '17 Aug · 13:20', state: 'done' },
      { label: 'Closed', detail: 'Record retained for future assessment and audit.', at: '17 Aug · 13:20', state: 'done' },
    ],
  },
  {
    id: 'INC-2026-0004',
    reporter: 'Hafiz Noor',
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
    actionRequired: false,
    recommendedAction: 'Retain security response details for future event planning',
    evidence: 'Security incident note and foyer photo',
    authority: 'PDRM Kuala Lumpur',
    responsePath: 'external',
    actions: [
      {
        id: 'ACT-0004-01',
        path: 'external',
        label: 'External authority review completed',
        owner: 'PDRM Kuala Lumpur',
        note: 'Security isolated the area and PDRM confirmed the item belonged to an exhibitor.',
        at: '14 Aug · 15:39',
        status: 'Completed',
      },
    ],
    history: [
      { label: 'Report submitted', detail: 'Participant submitted the event-related incident.', at: '14 Aug · 15:18', state: 'done' },
      { label: 'Immediate action taken', detail: 'Security isolated the area while the package was checked.', at: '14 Aug · 15:22', state: 'done' },
      { label: 'External review completed', detail: 'Exhibitor ownership was confirmed and the area reopened.', at: '14 Aug · 15:39', state: 'done' },
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

const INTERNAL_TEAMS = [
  'Festival operations team',
  'Site safety team',
  'Venue security',
  'On-site medical team',
  'Traffic & access team',
];

const AUTHORITY_DIRECTORY = [
  { name: 'PDRM Kuala Lumpur', service: 'Security, crowd control and suspicious activity', area: 'Kuala Lumpur', contact: '+60 3 2115 9999' },
  { name: 'BOMBA Kuala Lumpur', service: 'Fire safety and emergency response', area: 'Kuala Lumpur', contact: '+60 3 2687 6000' },
  { name: 'KKM medical response', service: 'Medical incidents and public health', area: 'Kuala Lumpur', contact: '+60 3 8883 3888' },
  { name: 'DBKL event operations', service: 'Venue, access and public-space issues', area: 'Kuala Lumpur', contact: '+60 3 2617 9000' },
];

const INCIDENT_REPORT_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
type ReportableEvent = { name: string; status: 'ongoing' | 'completed' | 'upcoming'; startedAt: number; endedAt?: number };

const PROTOTYPE_EVENTS: ReportableEvent[] = [
  { name: 'Merdeka Cultural Festival', status: 'ongoing', startedAt: Date.now() - 14 * 24 * 60 * 60 * 1_000 },
  { name: 'River of Life Night Market', status: 'completed', startedAt: Date.now() - 3 * 24 * 60 * 60 * 1_000, endedAt: Date.now() - 2 * 24 * 60 * 60 * 1_000 },
  { name: 'KL Heritage Run 2026', status: 'completed', startedAt: Date.now() - 11 * 24 * 60 * 60 * 1_000, endedAt: Date.now() - 10 * 24 * 60 * 60 * 1_000 },
  { name: 'Batik Design Showcase', status: 'upcoming', startedAt: Date.now() + 24 * 60 * 60 * 1_000 },
];

function recentLocalDateTimeInput(now = Date.now()): string {
  const date = new Date(now - 60 * 60 * 1_000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function isEventReportable(event: ReportableEvent, now = Date.now()): boolean {
  return event.status === 'ongoing'
    || (event.status === 'completed' && Number.isFinite(event.endedAt)
      && Number(event.endedAt) <= now && Number(event.endedAt) >= now - INCIDENT_REPORT_WINDOW_MS);
}

export function isIncidentOccurrencePlausible(event: ReportableEvent | undefined, value: string, now = Date.now()): boolean {
  const occurredAt = new Date(value).getTime();
  return Boolean(event && isEventReportable(event, now)
    && Number.isFinite(occurredAt)
    && occurredAt >= event.startedAt
    && occurredAt <= now
    && (event.status !== 'completed' || occurredAt <= Number(event.endedAt)));
}

const INITIAL_FORM: FormState = {
  event: 'Merdeka Cultural Festival',
  category: 'Crowd & capacity',
  occurredAt: recentLocalDateTimeInput(),
  location: 'Dataran Merdeka · North entrance',
  description: '',
  evidence: '',
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

function statusLabel(status: IncidentActionStatus) {
  if (status === 'Requested') return 'Requested';
  if (status === 'Assigned') return 'Assigned';
  if (status === 'Completed') return 'Completed';
  return 'Recorded';
}

function responsePathLabel(path?: ResponsePath) {
  if (path === 'internal') return 'Internal team';
  if (path === 'external') return 'External authority';
  return 'Not selected';
}

function addHistory(entries: HistoryEntry[], label: string, detail: string): HistoryEntry[] {
  return [
    ...entries.map((entry) => entry.state === 'current' ? { ...entry, state: 'done' as const } : entry),
    { label, detail, at: 'Just now', state: 'current' },
  ];
}

function StatusPill({ status }: { status: IncidentStatus }) {
  return <span className={'badge ' + statusClasses(status)}>{status}</span>;
}

function SeverityPill({ severity }: { severity: Severity }) {
  return <span className={'badge ' + severityClasses(severity)}>{severity} severity</span>;
}

function PreviewBanner() {
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <Info size={18} className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true" />
        <p><strong>Prototype preview.</strong> Three role views use synthetic data and local interactions; no live incident records are created.</p>
      </div>
      <span className="shrink-0 text-xs font-bold uppercase tracking-[0.08em] text-brand-600">Incident reporting</span>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, detail, tone = 'brand' }: { icon: LucideIcon; label: string; value: string; detail: string; tone?: 'brand' | 'red' | 'gold' | 'green' }) {
  const iconClass = tone === 'red' ? 'bg-red-100 text-risk-high-text' : tone === 'gold' ? 'bg-gold-100 text-gold-600' : tone === 'green' ? 'bg-green-100 text-status-approved' : 'bg-brand-50 text-brand-700';
  return (
    <div className="card flex items-start gap-3 p-4">
      <div className={'flex h-10 w-10 shrink-0 items-center justify-center rounded-md ' + iconClass}><Icon size={19} aria-hidden="true" /></div>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-500">{label}</p>
        <p className="mt-1 text-2xl font-bold text-ink-900">{value}</p>
        <p className="mt-0.5 text-xs text-ink-500">{detail}</p>
      </div>
    </div>
  );
}

function PageHeader({ role, onRoleChange }: { role: Role; onRoleChange: (role: Role) => void }) {
  const roleOptions: Array<{ key: Role; label: string }> = [
    { key: 'reporter', label: 'Reporter view' },
    { key: 'organizer', label: 'Organizer view' },
    { key: 'authority', label: 'Authority view' },
  ];

  return (
    <header className="border-b border-[#ddd3c2] bg-[#fffdf8]/95 backdrop-blur-sm">
      <div className="mx-auto flex min-h-[72px] max-w-[1440px] items-center justify-between gap-4 px-5 sm:px-8">
        <div className="flex min-w-0 items-center gap-5">
          <Link to="/" className="shrink-0" aria-label="STERAS home"><img src={logoUrl} alt="STERAS" className="w-32 sm:w-36" /></Link>
          <div className="hidden h-7 w-px bg-[#ddd3c2] sm:block" />
          <div className="hidden min-w-0 sm:block">
            <p className="truncate text-sm font-bold text-ink-800">Incident reporting prototype</p>
            <p className="text-xs text-ink-500">Incident response workflow preview</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden rounded-md border border-ink-200 bg-[#fffdf8] p-1 sm:flex" aria-label="Prototype role switcher">
            {roleOptions.map((option) => (
              <button key={option.key} type="button" onClick={() => onRoleChange(option.key)} className={'rounded px-3 py-1.5 text-xs font-semibold ' + (role === option.key ? 'bg-brand-600 text-white' : 'text-ink-500 hover:bg-cream-100')}>{option.label}</button>
            ))}
          </div>
          <Link to="/dashboard-preview" className="btn-secondary !min-h-9 !px-3 text-xs"><ArrowLeft size={14} /> <span className="hidden sm:inline">Back to preview</span></Link>
        </div>
      </div>
      <div className="border-t border-[#eee8dc] bg-[#fffdf8] px-5 py-2 sm:hidden">
        <div className="mx-auto flex max-w-[1440px] rounded-md border border-ink-200 bg-cream-50 p-1">
          {roleOptions.map((option) => (
            <button key={option.key} type="button" onClick={() => onRoleChange(option.key)} className={'flex-1 rounded px-2 py-1.5 text-[11px] font-semibold ' + (role === option.key ? 'bg-brand-600 text-white' : 'text-ink-500')}>{option.label.replace(' view', '')}</button>
          ))}
        </div>
      </div>
    </header>
  );
}

function IncidentCard({ incident, selected, onSelect, showOperationalSignals = true }: { incident: Incident; selected: boolean; onSelect: () => void; showOperationalSignals?: boolean }) {
  return (
    <button type="button" onClick={onSelect} className={'group w-full border-b border-[#e7dfd0] px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-cream-50 sm:px-5 ' + (selected ? 'bg-brand-50/70' : 'bg-[#fffdf8]')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold tracking-[0.05em] text-ink-500">{incident.id}</span>
            <StatusPill status={incident.status} />
            {showOperationalSignals && incident.actionRequired && <span className="badge bg-red-50 text-risk-high-text"><Flag size={11} /> Action required</span>}
          </div>
          <h3 className="mt-2 truncate font-display text-sm font-bold text-ink-900">{incident.title}</h3>
          <p className="mt-1 truncate text-xs text-ink-500">{incident.event} · {incident.occurredAt}</p>
        </div>
        <ChevronRight size={17} className={'mt-1 shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5 ' + (selected ? 'text-brand-600' : '')} aria-hidden="true" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-500">
        {showOperationalSignals && <SeverityPill severity={incident.severity} />}
        <span className="inline-flex items-center gap-1"><MapPin size={13} />{incident.location.split('·')[0].trim()}</span>
      </div>
      {showOperationalSignals && incident.actionRequired && <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold leading-5 text-risk-high-text"><ClipboardCheck size={13} className="mt-0.5 shrink-0" />{incident.recommendedAction}</p>}
    </button>
  );
}

function IncidentList({ incidents, selectedId, onSelect, query, onQueryChange, filter, onFilterChange, filterOptions, heading, subheading, emptyLabel, showOperationalSignals = true }: {
  incidents: Incident[];
  selectedId: string;
  onSelect: (incident: Incident) => void;
  query: string;
  onQueryChange: (value: string) => void;
  filter: string;
  onFilterChange: (value: string) => void;
  filterOptions: FilterOption[];
  heading: string;
  subheading: string;
  emptyLabel: string;
  showOperationalSignals?: boolean;
}) {
  const filtered = useMemo(() => {
    const severityRank: Record<Severity, number> = { High: 0, Medium: 1, Low: 2 };
    return incidents
      .filter((incident) => {
        const matchesFilter = filter === 'all'
          || (filter === 'action-required' && incident.actionRequired)
          || (filter === 'referred' && Boolean(incident.authority))
          || incident.status === filter
          || incident.severity === filter;
        const haystack = (incident.id + ' ' + incident.title + ' ' + incident.event + ' ' + incident.category + ' ' + incident.reporter).toLowerCase();
        return matchesFilter && haystack.includes(query.toLowerCase());
      })
      .sort((a, b) => Number(b.actionRequired) - Number(a.actionRequired) || severityRank[a.severity] - severityRank[b.severity]);
  }, [filter, incidents, query]);

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-[#e3dacb] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="section-title">{heading}</p>
            <p className="mt-1 text-xs text-ink-500">{subheading} · {filtered.length} shown</p>
          </div>
          <div className="flex gap-2">
            <label className="relative min-w-0 flex-1 sm:w-44 sm:flex-none">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden="true" />
              <input value={query} onChange={(event) => onQueryChange(event.target.value)} className="input !min-h-9 !pl-9 !text-xs" placeholder="Search reports" aria-label="Search incident reports" />
            </label>
            <select value={filter} onChange={(event) => onFilterChange(event.target.value)} className="input !min-h-9 !w-auto !py-1.5 !text-xs" aria-label="Filter incident reports">
              {filterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
        </div>
      </div>
      {filtered.length > 0 ? filtered.map((incident) => <IncidentCard key={incident.id} incident={incident} selected={incident.id === selectedId} onSelect={() => onSelect(incident)} showOperationalSignals={showOperationalSignals} />) : <div className="px-5 py-12 text-center text-sm text-ink-500">{emptyLabel}</div>}
    </div>
  );
}

function HistoryTimeline({ entries }: { entries: HistoryEntry[] }) {
  return (
    <div className="space-y-0">
      {entries.map((entry, index) => (
        <div key={entry.label + '-' + index} className="relative flex gap-3 pb-5 last:pb-0">
          {index < entries.length - 1 && <span className="absolute left-[9px] top-5 h-[calc(100%-8px)] w-px bg-[#ddd3c2]" aria-hidden="true" />}
          <span className={'relative z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ' + (entry.state === 'done' ? 'border-status-approved bg-green-50 text-status-approved' : entry.state === 'current' ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-ink-200 bg-[#fffdf8] text-ink-300')}>
            {entry.state === 'done' ? <CheckCircle2 size={12} /> : entry.state === 'current' ? <Activity size={11} /> : <Clock3 size={11} />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className={'text-sm font-semibold ' + (entry.state === 'muted' ? 'text-ink-400' : 'text-ink-800')}>{entry.label}</p>
              <span className="text-[11px] text-ink-400">{entry.at}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-ink-500">{entry.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReportContent({ incident }: { incident: Incident }) {
  return (
    <section className="card overflow-hidden">
      <div className="card-header">
        <div><p className="section-title">Report content</p><p className="mt-1 text-xs text-ink-500">Submitted by a participant and linked to the event record.</p></div>
        <FileText size={19} className="text-brand-600" />
      </div>
      <div className="card-body">
        <div className="grid gap-4 sm:grid-cols-2">
          <div><span className="field-label">Reporter</span><p className="text-sm font-semibold text-ink-800">{incident.reporter} <span className="text-xs font-normal text-ink-500">· participant</span></p></div>
          <div><span className="field-label">Incident category</span><p className="text-sm font-semibold text-ink-800">{incident.category}</p></div>
          <div><span className="field-label">Location</span><p className="text-sm font-semibold text-ink-800">{incident.location}</p></div>
          <div><span className="field-label">Occurrence time</span><p className="text-sm font-semibold text-ink-800">{incident.occurredAt}</p></div>
        </div>
        <div className="mt-5 border-t border-[#eee8dc] pt-4">
          <span className="field-label">What happened</span>
          <p className="text-sm leading-6 text-ink-700">{incident.description}</p>
        </div>
        {incident.eventControl && <div className="mt-4 flex items-start gap-3 rounded-md border border-gold-200 bg-gold-50 px-3 py-3 text-xs text-gold-700"><FileCheck2 size={16} className="mt-0.5 shrink-0" /><div><strong className="block">Linked Event Control item</strong><span>{incident.eventControl}</span></div></div>}
        <div className="mt-4 flex items-start gap-3 rounded-md border border-dashed border-ink-300 bg-cream-50 px-3 py-3 text-xs text-ink-600"><Paperclip size={16} className="mt-0.5 shrink-0 text-brand-600" /><div><strong className="block text-ink-800">Supporting evidence</strong><span>{incident.evidence ?? 'No evidence attached'}</span></div></div>
      </div>
    </section>
  );
}

function AiAssessment({ incident }: { incident: Incident }) {
  return (
    <section className={'card border-l-4 ' + (incident.immediateAction ? 'border-l-red-500' : 'border-l-brand-500')}>
      <div className="card-body">
        <div className="flex items-start gap-3">
          <div className={'flex h-9 w-9 shrink-0 items-center justify-center rounded-md ' + (incident.immediateAction ? 'bg-red-100 text-risk-high-text' : 'bg-brand-50 text-brand-700')}><Sparkles size={17} /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2"><p className="section-title">AI-assisted assessment</p><span className="badge bg-ink-100 text-ink-600">Advisory</span></div>
            <p className="mt-1 text-xs leading-5 text-ink-500">The assessment supports response planning. Organizer or authority staff record the final action.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-md bg-cream-50 p-3"><span className="text-xs text-ink-500">Severity classification</span><div className="mt-1"><SeverityPill severity={incident.severity} /></div></div>
          <div className="rounded-md bg-cream-50 p-3"><span className="text-xs text-ink-500">Immediate action</span><p className={'mt-1 text-sm font-bold ' + (incident.immediateAction ? 'text-risk-high-text' : 'text-status-approved')}>{incident.immediateAction ? 'Recommended' : 'Not indicated'}</p></div>
          <div className="rounded-md bg-cream-50 p-3"><span className="text-xs text-ink-500">Organizer queue</span><p className={'mt-1 text-sm font-bold ' + (incident.actionRequired ? 'text-risk-high-text' : 'text-status-approved')}>{incident.actionRequired ? 'Action required' : 'No pending action'}</p></div>
        </div>
        <div className="mt-3 flex items-start gap-2 text-xs text-ink-500"><ClipboardCheck size={14} className="mt-0.5 shrink-0" /><span><strong className="text-ink-700">Recommended next step:</strong> {incident.recommendedAction}</span></div>
        <div className="mt-3 flex items-center gap-2 text-xs text-ink-500"><FileText size={14} />Based on category, description, event, location, time and available evidence.</div>
      </div>
    </section>
  );
}

function IncidentActionList({ actions }: { actions: IncidentAction[] }) {
  return (
    <section className="card">
      <div className="card-header"><div><p className="section-title">Recorded incident actions</p><p className="mt-1 text-xs text-ink-500">Assignment, referral and response records attached to this incident.</p></div><ClipboardCheck size={19} className="text-brand-600" /></div>
      <div className="card-body">
        {actions.length === 0 ? (
          <div className="rounded-md border border-dashed border-ink-300 bg-cream-50 px-4 py-5 text-center text-xs text-ink-500">No action has been recorded yet. The organizer can assign a team, request an authority or record an action below.</div>
        ) : (
          <div className="space-y-3">
            {actions.map((action) => (
              <div key={action.id} className="rounded-md border border-[#e3dacb] bg-[#fffdf8] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2"><span className={'flex h-7 w-7 items-center justify-center rounded-md ' + (action.path === 'external' ? 'bg-gold-100 text-gold-600' : 'bg-brand-50 text-brand-700')}>{action.path === 'external' ? <LifeBuoy size={15} /> : <UsersRound size={15} />}</span><div><p className="text-sm font-semibold text-ink-800">{action.label}</p><p className="text-xs text-ink-500">{action.owner} · {action.at}</p></div></div>
                  <span className="badge bg-green-50 text-status-approved">{statusLabel(action.status)}</span>
                </div>
                <p className="mt-3 text-xs leading-5 text-ink-600">{action.note}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function OrganizerActionPanel({ incident, onAssignInternalTeam, onRequestExternalAuthority, onRecordAction, onResolve }: {
  incident: Incident;
  onAssignInternalTeam: (team: string, note: string) => void;
  onRequestExternalAuthority: (authority: string, note: string) => void;
  onRecordAction: (path: ResponsePath, owner: string, note: string) => void;
  onResolve: (rationale: string, discrepancyOutcome?: DiscrepancyOutcome) => void;
}) {
  const [mode, setMode] = useState<'internal' | 'external' | null>(null);
  const [team, setTeam] = useState(incident.responseTeam ?? INTERNAL_TEAMS[0]);
  const [authority, setAuthority] = useState(incident.authority ?? incident.recommendedAuthorities?.[0] ?? AUTHORITY_DIRECTORY[0].name);
  const [assignmentNote, setAssignmentNote] = useState('');
  const [recordPath, setRecordPath] = useState<ResponsePath>(incident.responsePath ?? 'internal');
  const [recordOwner, setRecordOwner] = useState(incident.responseTeam ?? INTERNAL_TEAMS[0]);
  const [actionNote, setActionNote] = useState('');
  const [resolutionRationale, setResolutionRationale] = useState('');
  const [discrepancyOutcome, setDiscrepancyOutcome] = useState<DiscrepancyOutcome | undefined>(incident.discrepancyOutcome);
  const aiRecommendedAuthority = incident.recommendedAuthorities?.[0]
    ?? (incident.category.includes('Medical') ? 'KKM medical response' : incident.severity === 'High' ? 'PDRM Kuala Lumpur' : 'DBKL event operations');

  const selectRecordPath = (path: ResponsePath) => {
    setRecordPath(path);
    setRecordOwner(path === 'internal' ? team : authority);
  };
  const hasCompletedResponse = incident.responsePath === 'external'
    ? incident.actions.some((action) => action.label === 'Authority investigation finding submitted')
    : incident.actions.some((action) => action.label === 'Internal incident action recorded');
  const canResolve = hasCompletedResponse
    && resolutionRationale.trim().length >= 10
    && (!incident.eventControl || Boolean(discrepancyOutcome));

  if (incident.status === 'Resolved') {
    return (
      <section className="card">
        <div className="card-header"><div><p className="section-title">Organizer final resolution</p><p className="mt-1 text-xs text-ink-500">Closed incidents are read-only in this prototype.</p></div><CheckCircle2 size={19} className="text-status-approved" /></div>
        <div className="card-body">
          <p className="text-sm leading-6 text-ink-700">{incident.finalResolution ?? 'The organizer recorded the final outcome before this synthetic incident was closed.'}</p>
          {incident.discrepancyOutcome && <p className="mt-2 text-xs text-ink-600">Event Control outcome: <strong>{incident.discrepancyOutcome}</strong></p>}
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="card-header"><div><p className="section-title">Organizer action workspace</p><p className="mt-1 text-xs text-ink-500">Choose who should respond, then record the action taken.</p></div><UsersRound size={19} className="text-brand-600" /></div>
      <div className="card-body">
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => { setMode('internal'); setRecordPath('internal'); setRecordOwner(team); }} className={'rounded-md border p-4 text-left transition-colors ' + (mode === 'internal' ? 'border-brand-500 bg-brand-50' : 'border-[#e3dacb] hover:bg-cream-50')}>
            <div className="flex items-center gap-2"><UsersRound size={17} className="text-brand-600" /><p className="text-sm font-semibold text-ink-800">Assign internal team</p></div>
            <p className="mt-1 text-xs leading-5 text-ink-500">Send the incident to event operations, security, medical or another internal response team.</p>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-brand-700">Open assignment <ArrowRight size={13} /></span>
          </button>
          <button type="button" onClick={() => { setMode('external'); setRecordPath('external'); setRecordOwner(authority); }} className={'rounded-md border p-4 text-left transition-colors ' + (mode === 'external' ? 'border-gold-500 bg-gold-50' : 'border-[#e3dacb] hover:bg-cream-50')}>
            <div className="flex items-center gap-2"><LifeBuoy size={17} className="text-gold-600" /><p className="text-sm font-semibold text-ink-800">Request external authority</p></div>
            <p className="mt-1 text-xs leading-5 text-ink-500">Refer the report to the recommended authority directory for investigation or support.</p>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-gold-700">Open authority directory <ArrowRight size={13} /></span>
          </button>
        </div>

        {mode === 'internal' && (
          <div className="mt-4 rounded-md border border-brand-200 bg-brand-50/60 p-4">
            <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-ink-800">Assign an internal response team</p><p className="mt-1 text-xs text-ink-600">This assignment will move the report into investigation.</p></div><button type="button" onClick={() => setMode(null)} className="text-ink-400 hover:text-ink-700" aria-label="Close internal assignment"><X size={16} /></button></div>
            <label className="mt-4 block"><span className="field-label">Internal team</span><select value={team} onChange={(event) => { setTeam(event.target.value); if (recordPath === 'internal') setRecordOwner(event.target.value); }} className="input">{INTERNAL_TEAMS.map((option) => <option key={option}>{option}</option>)}</select></label>
            <label className="mt-3 block"><span className="field-label">Assignment instruction or immediate action</span><textarea value={assignmentNote} onChange={(event) => setAssignmentNote(event.target.value)} className="input min-h-20 resize-y" placeholder="Example: reopen north entrance lane and deploy two crowd marshals." /></label>
            <button type="button" disabled={assignmentNote.trim().length < 10} onClick={() => { onAssignInternalTeam(team, assignmentNote); setAssignmentNote(''); }} className="btn-primary mt-3 !min-h-9 !px-3 text-xs"><UsersRound size={14} /> Assign internal team</button>
            {assignmentNote.trim().length < 10 && <p className="mt-2 text-xs text-ink-500">Enter at least 10 characters describing the assignment or immediate action.</p>}
          </div>
        )}

        {mode === 'external' && (
          <div className="mt-4 rounded-md border border-gold-200 bg-gold-50/60 p-4">
            <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-ink-800">Request external authority</p><p className="mt-1 text-xs text-ink-600">Select a recommended authority and describe the assistance needed.</p></div><button type="button" onClick={() => setMode(null)} className="text-ink-400 hover:text-ink-700" aria-label="Close authority directory"><X size={16} /></button></div>
            <div className="mt-4 flex items-start gap-3 rounded-md border border-gold-300 bg-[#fffdf8] px-3 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gold-100 text-gold-600"><Star size={18} fill="currentColor" /></div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-bold text-ink-800">AI-recommended authority</p><span className="badge bg-gold-100 text-gold-700"><Star size={11} fill="currentColor" /> Outstanding match</span></div>
                <p className="mt-1 text-xs leading-5 text-ink-600">{aiRecommendedAuthority} is highlighted based on the incident category, severity and immediate-action signal.</p>
                <button type="button" onClick={() => { setAuthority(aiRecommendedAuthority); setRecordOwner(aiRecommendedAuthority); }} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-gold-700">Use AI recommendation <ArrowRight size={13} /></button>
              </div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {AUTHORITY_DIRECTORY.map((item) => {
                const isAiRecommended = item.name === aiRecommendedAuthority;
                return <button key={item.name} type="button" onClick={() => { setAuthority(item.name); setRecordOwner(item.name); }} className={'rounded-md border p-3 text-left ' + (authority === item.name ? 'border-gold-500 bg-[#fffdf8]' : 'border-gold-200 bg-[#fffdf8]/70 hover:bg-[#fffdf8]')}><div className="flex items-start justify-between gap-2"><span className="text-sm font-semibold text-ink-800">{item.name}</span>{isAiRecommended ? <Star size={15} className="shrink-0 text-gold-600" fill="currentColor" /> : authority === item.name && <CheckCircle2 size={15} className="shrink-0 text-gold-600" />}</div>{isAiRecommended && <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-gold-700"><Star size={11} fill="currentColor" /> AI recommended</p>}<p className="mt-1 text-xs leading-5 text-ink-500">{item.service}</p><p className="mt-2 text-[11px] text-ink-400">{item.area} · {item.contact}</p></button>;
              })}
            </div>
            <label className="mt-3 block"><span className="field-label">Request details</span><textarea value={assignmentNote} onChange={(event) => setAssignmentNote(event.target.value)} className="input min-h-20 resize-y" placeholder="Example: inspect crowd-control route and advise on immediate access management." /></label>
            <button type="button" disabled={assignmentNote.trim().length < 10} onClick={() => { onRequestExternalAuthority(authority, assignmentNote); setAssignmentNote(''); }} className="btn-primary mt-3 !min-h-9 !px-3 text-xs"><LifeBuoy size={14} /> Request external authority</button>
            {assignmentNote.trim().length < 10 && <p className="mt-2 text-xs text-ink-500">Enter at least 10 characters describing the assistance requested.</p>}
          </div>
        )}

        <div className="mt-5 border-t border-[#eee8dc] pt-5">
          <div className="flex items-start gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-cream-100 text-brand-700"><ClipboardCheck size={17} /></div><div><p className="text-sm font-bold text-ink-800">Record incident action</p><p className="mt-1 text-xs leading-5 text-ink-500">Capture the actual action taken for the audit trail. This is separate from the AI recommendation.</p></div></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label><span className="field-label">Action route</span><select value={recordPath} onChange={(event) => selectRecordPath(event.target.value as ResponsePath)} className="input"><option value="internal">Internal team action</option><option value="external">External authority action</option></select></label>
            <label><span className="field-label">{recordPath === 'internal' ? 'Action owner' : 'Authority involved'}</span>{recordPath === 'internal' ? <select value={recordOwner} onChange={(event) => setRecordOwner(event.target.value)} className="input">{INTERNAL_TEAMS.map((option) => <option key={option}>{option}</option>)}</select> : <select value={recordOwner} onChange={(event) => setRecordOwner(event.target.value)} className="input">{AUTHORITY_DIRECTORY.map((option) => <option key={option.name}>{option.name}</option>)}</select>}</label>
          </div>
          <label className="mt-3 block"><span className="field-label">Action taken and outcome</span><textarea value={actionNote} onChange={(event) => setActionNote(event.target.value)} className="input min-h-24 resize-y" placeholder="Describe what was done, who completed it, evidence reviewed and the current outcome." /></label>
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={actionNote.trim().length < 10} onClick={() => { onRecordAction(recordPath, recordOwner, actionNote); setActionNote(''); }} className="btn-primary !min-h-9 !px-3 text-xs"><ClipboardCheck size={14} /> Record incident action</button></div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-md bg-cream-50 p-3"><span className="text-xs text-ink-500">Current status</span><div className="mt-1"><StatusPill status={incident.status} /></div></div>
          <div className="rounded-md bg-cream-50 p-3"><span className="text-xs text-ink-500">Response path</span><p className="mt-1 text-sm font-semibold text-ink-800">{responsePathLabel(incident.responsePath)}</p></div>
          <div className="rounded-md bg-cream-50 p-3"><span className="text-xs text-ink-500">Assigned owner</span><p className="mt-1 truncate text-sm font-semibold text-ink-800">{incident.responsePath === 'external' ? incident.authority ?? 'Not assigned' : incident.responseTeam ?? 'Not assigned'}</p></div>
        </div>

        <div className="mt-5 border-t border-[#eee8dc] pt-5">
          <p className="text-sm font-bold text-ink-800">Organizer final resolution</p>
          <p className="mt-1 text-xs leading-5 text-ink-500">Only the organizer can close an incident after reviewing the completed internal response or authority finding.</p>
          {incident.eventControl && <fieldset className="mt-4 rounded-md border border-[#e3dacb] p-3"><legend className="px-1 text-xs font-bold uppercase tracking-[0.06em] text-ink-500">Event Control discrepancy outcome</legend><p className="mt-1 text-xs leading-5 text-ink-500">Required before closing a report linked to a published control item.</p><div className="mt-3 flex flex-wrap gap-4 text-sm text-ink-700"><label className="flex items-center gap-2"><input type="radio" name={'discrepancy-' + incident.id} checked={discrepancyOutcome === 'Confirmed True'} onChange={() => setDiscrepancyOutcome('Confirmed True')} className="h-4 w-4 text-brand-600 focus:ring-brand-500" /> Confirmed true</label><label className="flex items-center gap-2"><input type="radio" name={'discrepancy-' + incident.id} checked={discrepancyOutcome === 'Dismissed as False'} onChange={() => setDiscrepancyOutcome('Dismissed as False')} className="h-4 w-4 text-brand-600 focus:ring-brand-500" /> Dismissed as false</label></div></fieldset>}
          <label className="mt-4 block"><span className="field-label">Final resolution rationale</span><textarea value={resolutionRationale} onChange={(event) => setResolutionRationale(event.target.value)} className="input min-h-24 resize-y" placeholder="Summarise the response, evidence reviewed, outcome and why the incident can be closed." /></label>
          <button type="button" disabled={!canResolve} onClick={() => onResolve(resolutionRationale.trim(), discrepancyOutcome)} className="btn-secondary mt-3 !min-h-9 !px-3 text-xs"><CheckCircle2 size={14} /> Record final resolution and close</button>
          {!hasCompletedResponse && <p className="mt-2 text-xs text-risk-high-text">Record a completed internal response or wait for an authority investigation finding before closure.</p>}
          {hasCompletedResponse && resolutionRationale.trim().length < 10 && <p className="mt-2 text-xs text-ink-500">A final resolution rationale of at least 10 characters is required.</p>}
          {hasCompletedResponse && incident.eventControl && !discrepancyOutcome && <p className="mt-2 text-xs text-ink-500">Select the Event Control discrepancy outcome.</p>}
        </div>
      </div>
    </section>
  );
}

function AuthorityActionPanel({ incident, onRecordInvestigation }: { incident: Incident; onRecordInvestigation: (note: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <section className="card">
      <div className="card-header"><div><p className="section-title">Authority investigation workspace</p><p className="mt-1 text-xs text-ink-500">Record investigation actions, evidence and findings for the referred incident.</p></div><ShieldCheck size={19} className="text-brand-600" /></div>
      <div className="card-body">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md bg-cream-50 p-3"><span className="text-xs text-ink-500">Assigned authority</span><p className="mt-1 text-sm font-semibold text-ink-800">{incident.authority ?? 'Not assigned'}</p></div>
          <div className="rounded-md bg-cream-50 p-3"><span className="text-xs text-ink-500">Severity</span><div className="mt-1"><SeverityPill severity={incident.severity} /></div></div>
          <div className="rounded-md bg-cream-50 p-3"><span className="text-xs text-ink-500">Status</span><div className="mt-1"><StatusPill status={incident.status} /></div></div>
        </div>
        <label className="mt-4 block"><span className="field-label">Investigation action, evidence or finding</span><textarea value={note} onChange={(event) => setNote(event.target.value)} className="input min-h-28 resize-y" placeholder="Record what was checked, who was contacted, evidence reviewed and the finding." /></label>
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={note.trim().length < 10} onClick={() => { onRecordInvestigation(note); setNote(''); }} className="btn-primary !min-h-9 !px-3 text-xs"><ClipboardCheck size={14} /> Submit finding to organizer</button></div>
        <p className="mt-2 text-xs text-ink-500">The authority records its finding and returns the incident to the organizer. Only the organizer records the final resolution and closes it.</p>
      </div>
    </section>
  );
}

function ReporterProgress({ incident }: { incident: Incident }) {
  const responseStarted = ['Investigating', 'Under review', 'Resolved'].includes(incident.status);
  const milestones = [
    { label: 'Report submitted', complete: true },
    { label: 'Organizer review', complete: responseStarted },
    { label: 'Response in progress', complete: responseStarted },
    { label: 'Final resolution', complete: incident.status === 'Resolved' },
  ];
  return (
    <section className="card">
      <div className="card-header"><div><p className="section-title">Report progress</p><p className="mt-1 text-xs text-ink-500">Participant view is read-only after submission.</p></div><Activity size={19} className="text-brand-600" /></div>
      <div className="card-body">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md bg-cream-50 p-3"><span className="text-xs text-ink-500">Current status</span><div className="mt-1"><StatusPill status={incident.status} /></div></div>
          <div className="rounded-md bg-cream-50 p-3"><span className="text-xs text-ink-500">Submitted</span><p className="mt-1 text-sm font-semibold text-ink-800">{incident.submittedAt}</p></div>
          <div className="rounded-md bg-cream-50 p-3"><span className="text-xs text-ink-500">Assigned response</span><p className="mt-1 truncate text-sm font-semibold text-ink-800">{incident.authority ?? incident.responseTeam ?? 'Pending organizer action'}</p></div>
        </div>
        <div className="mt-4 rounded-md border border-[#e3dacb] bg-[#fffdf8] p-4">
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-ink-500">Progress milestones</p>
          <ol className="mt-3 grid gap-2 sm:grid-cols-4">
            {milestones.map((milestone) => <li key={milestone.label} aria-label={`${milestone.label}: ${milestone.complete ? 'Complete' : 'Waiting'}`} className="flex items-center gap-2 text-xs text-ink-700">
              {milestone.complete ? <CheckCircle2 size={14} className="shrink-0 text-brand-600" /> : <CircleDashed size={14} className="shrink-0 text-ink-400" />}
              <span>{milestone.label}</span>
            </li>)}
          </ol>
        </div>
        {incident.finalResolution && <div className="mt-4 rounded-md border border-brand-200 bg-brand-50 p-4">
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-brand-700">Final resolution</p>
          <p className="mt-2 text-sm leading-6 text-ink-700">{incident.finalResolution}</p>
          {incident.discrepancyOutcome && <p className="mt-2 text-xs text-ink-600">Reported control outcome: <strong>{incident.discrepancyOutcome}</strong></p>}
        </div>}
        <div className="mt-4 rounded-md border border-brand-200 bg-brand-50 px-3 py-3 text-xs leading-5 text-brand-800"><strong>Participant access:</strong> You can track progress and resolution. Organizer and authority actions are recorded by permitted staff.</div>
      </div>
    </section>
  );
}

function IncidentDetail({ incident, role, onAssignInternalTeam, onRequestExternalAuthority, onRecordAction, onRecordInvestigation, onResolve }: {
  incident: Incident;
  role: Role;
  onAssignInternalTeam?: (team: string, note: string) => void;
  onRequestExternalAuthority?: (authority: string, note: string) => void;
  onRecordAction?: (path: ResponsePath, owner: string, note: string) => void;
  onRecordInvestigation?: (note: string) => void;
  onResolve?: (rationale: string, discrepancyOutcome?: DiscrepancyOutcome) => void;
}) {
  return (
    <div className="space-y-4">
      <section className="card overflow-hidden">
        <div className="border-b border-[#e3dacb] bg-[#fffdf8] px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold tracking-[0.06em] text-ink-500">{incident.id}</span><StatusPill status={incident.status} />{role !== 'reporter' && incident.actionRequired && <span className="badge bg-red-50 text-risk-high-text"><Flag size={11} /> Action required</span>}</div>
              <h2 className="mt-3 font-display text-xl font-bold leading-tight text-ink-900">{incident.title}</h2>
              <p className="mt-2 text-sm text-ink-500">{incident.event} · {incident.eventType}</p>
            </div>
            {role !== 'reporter' && <SeverityPill severity={incident.severity} />}
          </div>
          <div className="mt-5 grid gap-3 border-t border-[#eee8dc] pt-4 sm:grid-cols-2">
            <div className="flex items-start gap-2 text-xs text-ink-600"><MapPin size={15} className="mt-0.5 shrink-0 text-brand-600" /><span><strong className="block text-ink-800">Location</strong>{incident.location}</span></div>
            <div className="flex items-start gap-2 text-xs text-ink-600"><CalendarDays size={15} className="mt-0.5 shrink-0 text-brand-600" /><span><strong className="block text-ink-800">Occurred</strong>{incident.occurredAt}</span></div>
          </div>
        </div>
      </section>

      <ReportContent incident={incident} />
      {role !== 'reporter' && <AiAssessment incident={incident} />}

      {role === 'reporter' && <ReporterProgress incident={incident} />}
      {role === 'organizer' && onAssignInternalTeam && onRequestExternalAuthority && onRecordAction && onResolve && <OrganizerActionPanel key={incident.id} incident={incident} onAssignInternalTeam={onAssignInternalTeam} onRequestExternalAuthority={onRequestExternalAuthority} onRecordAction={onRecordAction} onResolve={onResolve} />}
      {role === 'authority' && incident.status !== 'Resolved' && onRecordInvestigation && <AuthorityActionPanel key={incident.id} incident={incident} onRecordInvestigation={onRecordInvestigation} />}

      {role !== 'reporter' && <IncidentActionList actions={incident.actions} />}

      {role !== 'reporter' && <section className="card">
        <div className="card-header"><div><p className="section-title">Incident history</p><p className="mt-1 text-xs text-ink-500">Auditable status and responsibility timeline.</p></div><History size={19} className="text-brand-600" /></div>
        <div className="card-body"><HistoryTimeline entries={incident.history} /></div>
      </section>}
    </div>
  );
}

function SubmissionForm({ form, onChange, onSubmit }: { form: FormState; onChange: (key: keyof FormState, value: string | boolean) => void; onSubmit: () => void }) {
  const selectedEvent = PROTOTYPE_EVENTS.find((event) => event.name === form.event);
  const occurrenceIsValid = isIncidentOccurrencePlausible(selectedEvent, form.occurredAt);
  const canSubmit = Boolean(
    form.event.trim()
    && form.category.trim()
    && occurrenceIsValid
    && form.location.trim().length >= 3
    && form.description.trim().length >= 20,
  );
  return (
    <div className="card">
      <div className="card-header"><div><p className="section-title">Submit incident report</p><p className="mt-1 text-xs text-ink-500">Only a participant can create a report for an ongoing event or an event completed within the past seven days.</p></div><Flag size={19} className="text-brand-600" /></div>
      <div className="card-body">
        <div className="mb-5 flex items-start gap-3 rounded-md border border-brand-200 bg-brand-50 px-3 py-3 text-xs leading-5 text-brand-800"><UserRound size={17} className="mt-0.5 shrink-0 text-brand-600" /><span><strong>Signed in as participant.</strong> This report will be associated with the current participant profile and the selected event.</span></div>
        <div className="mb-5 rounded-md border border-brand-200 bg-brand-50 px-3 py-3 text-xs leading-5 text-brand-800"><strong>Required information:</strong> category, description, occurrence date and time, location, and any available supporting evidence.</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className="field-label">Event <span className="text-risk-high-text">*</span></span><select value={form.event} onChange={(event) => onChange('event', event.target.value)} className="input">{PROTOTYPE_EVENTS.map((event) => <option key={event.name} value={event.name} disabled={!isEventReportable(event)}>{event.name}{isEventReportable(event) ? '' : ' · not eligible for incident reporting'}</option>)}</select></label>
          <label><span className="field-label">Incident category <span className="text-risk-high-text">*</span></span><select value={form.category} onChange={(event) => onChange('category', event.target.value)} className="input">{CATEGORY_OPTIONS.map((category) => <option key={category}>{category}</option>)}</select></label>
          <label><span className="field-label">Occurrence date & time <span className="text-risk-high-text">*</span></span><input type="datetime-local" value={form.occurredAt} onChange={(event) => onChange('occurredAt', event.target.value)} className="input" /></label>
          <label className="sm:col-span-2"><span className="field-label">Incident location <span className="text-risk-high-text">*</span></span><div className="relative"><MapPin size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" /><input value={form.location} onChange={(event) => onChange('location', event.target.value)} className="input !pl-9" placeholder="Venue, zone or nearby landmark" /></div></label>
          <label className="sm:col-span-2"><span className="field-label">What happened? <span className="text-risk-high-text">*</span></span><textarea value={form.description} onChange={(event) => onChange('description', event.target.value)} className="input min-h-32 resize-y" placeholder="Describe what happened, who may be affected and what is known so far." /></label>
          <label className="sm:col-span-2"><span className="field-label">Supporting evidence reference</span><input value={form.evidence} onChange={(event) => onChange('evidence', event.target.value)} className="input" placeholder="Photo, video, document or witness reference (optional)" /></label>
        </div>
        <div className="mt-4 rounded-md border border-[#e3dacb] p-3">
          <label className="flex cursor-pointer items-start gap-3"><input type="checkbox" checked={form.eventControl} onChange={(event) => onChange('eventControl', event.target.checked)} className="mt-1 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500" /><span><span className="block text-sm font-semibold text-ink-800">This concerns a published Event Control item</span><span className="mt-1 block text-xs leading-5 text-ink-500">Use this for inaccurate signage, documentation or other published control discrepancies.</span></span></label>
        </div>
        <div className="mt-4 rounded-md border border-dashed border-ink-300 bg-cream-50 px-4 py-5 text-center"><Upload size={20} className="mx-auto text-brand-600" /><p className="mt-2 text-sm font-semibold text-ink-800">Add supporting evidence</p><p className="mt-1 text-xs text-ink-500">Photos, PDF or other permitted evidence · prototype only</p><button type="button" className="btn-secondary mt-3 !min-h-9 !px-3 text-xs"><Paperclip size={14} /> Choose files</button></div>
        {!canSubmit && <div role="status" className="mt-4 rounded-md border border-gold-200 bg-gold-50 px-3 py-3 text-xs leading-5 text-gold-700">Complete every required field, select an ongoing event or one completed within seven days, use a plausible occurrence time, provide a location of at least 3 characters and describe the incident in at least 20 characters.</div>}
        <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" className="btn-secondary !min-h-10">Save draft</button><button type="button" disabled={!canSubmit} onClick={onSubmit} className="btn-primary !min-h-10"><Send size={15} /> Submit incident report</button></div>
      </div>
    </div>
  );
}

function ReporterView({ incidents, selectedId, setSelectedId, onSubmit, notice, form, onFormChange }: {
  incidents: Incident[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  onSubmit: () => void;
  notice: string | null;
  form: FormState;
  onFormChange: (key: keyof FormState, value: string | boolean) => void;
}) {
  const [activeTab, setActiveTab] = useState<'reports' | 'new'>('new');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const ownReports = incidents.filter((incident) => incident.reporter === CURRENT_REPORTER);
  const selected = ownReports.find((incident) => incident.id === selectedId) ?? ownReports[0];
  const handleSubmit = () => {
    onSubmit();
    setActiveTab('reports');
  };

  return (
    <>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="page-eyebrow">Participant workspace</p><h1 className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">Report an incident</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-ink-600">Participants submit event-related incidents here and can track the organizer and authority response afterwards.</p></div>
        <div className="flex items-center gap-2 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-800"><UserRound size={16} className="text-brand-600" /> {CURRENT_REPORTER} · Participant</div>
      </div>
      {notice && <div className="mt-5 flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-status-approved"><CheckCircle2 size={16} />{notice}</div>}
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={FileText} label="My reports" value={String(ownReports.length)} detail="Submitted by you" />
        <KpiCard icon={Activity} label="Under review" value={String(ownReports.filter((incident) => incident.status === 'Submitted' || incident.status === 'Under review').length)} detail="Waiting for review" tone="gold" />
        <KpiCard icon={ShieldAlert} label="Action updates" value={String(ownReports.filter((incident) => incident.actionRequired).length)} detail="Organizer action pending" tone="red" />
        <KpiCard icon={CheckCircle2} label="Resolved" value={String(ownReports.filter((incident) => incident.status === 'Resolved').length)} detail="Outcome recorded" tone="green" />
      </div>
      <div className="mt-7 flex gap-1 border-b border-[#d9cdb8]" role="tablist">
        <button type="button" onClick={() => setActiveTab('reports')} className={'border-b-2 px-4 py-3 text-sm font-semibold ' + (activeTab === 'reports' ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500')} role="tab" aria-selected={activeTab === 'reports'}>My submitted reports</button>
        <button type="button" onClick={() => setActiveTab('new')} className={'border-b-2 px-4 py-3 text-sm font-semibold ' + (activeTab === 'new' ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500')} role="tab" aria-selected={activeTab === 'new'}><Plus size={14} className="mr-1 inline" /> New report</button>
      </div>
      {activeTab === 'new' ? (
        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,.85fr)]">
          <SubmissionForm form={form} onChange={onFormChange} onSubmit={handleSubmit} />
          <section className="card h-fit">
            <div className="card-header"><div><p className="section-title">Participant reporting flow</p><p className="mt-1 text-xs text-ink-500">What happens after submission.</p></div><ListChecks size={19} className="text-brand-600" /></div>
            <div className="card-body">
              <ul className="space-y-4 text-xs leading-5 text-ink-600">
                <li className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700">1</span><span>Participant submits the event, category, time, location, description and evidence.</span></li>
                <li className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700">2</span><span>The system validates the report and routes it to organizer review.</span></li>
                <li className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700">3</span><span>Organizer assigns an internal team or requests external authority assistance.</span></li>
                <li className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700">4</span><span>Participant tracks the response and final resolution from My submitted reports.</span></li>
              </ul>
              <div className="mt-5 rounded-md bg-cream-50 px-3 py-3 text-xs text-ink-500"><strong className="text-ink-800">Access boundary:</strong> organizer and authority controls are not available in the participant view.</div>
            </div>
          </section>
        </div>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(320px,.82fr)_minmax(0,1.18fr)]">
          <IncidentList incidents={ownReports} selectedId={selected?.id ?? ''} onSelect={(incident) => setSelectedId(incident.id)} query={query} onQueryChange={setQuery} filter={filter} onFilterChange={setFilter} filterOptions={[{ value: 'all', label: 'All reports' }, { value: 'Action required', label: 'Action required' }, { value: 'Investigating', label: 'Investigating' }, { value: 'Resolved', label: 'Resolved' }]} heading="My submitted reports" subheading={String(ownReports.length) + ' participant reports'} emptyLabel="You have not submitted any reports matching this filter." showOperationalSignals={false} />
          {selected ? <IncidentDetail incident={selected} role="reporter" /> : <div className="card flex min-h-64 items-center justify-center p-8 text-center text-sm text-ink-500">Submit a report to see its progress here.</div>}
        </div>
      )}
    </>
  );
}

function OrganizerView({ incidents, selectedId, setSelectedId, onAssignInternalTeam, onRequestExternalAuthority, onRecordAction, onResolve, notice }: {
  incidents: Incident[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  onAssignInternalTeam: (team: string, note: string) => void;
  onRequestExternalAuthority: (authority: string, note: string) => void;
  onRecordAction: (path: ResponsePath, owner: string, note: string) => void;
  onResolve: (rationale: string, discrepancyOutcome?: DiscrepancyOutcome) => void;
  notice: string | null;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('action-required');
  const selected = incidents.find((incident) => incident.id === selectedId) ?? incidents.find((incident) => incident.actionRequired) ?? incidents[0];
  const actionRequired = incidents.filter((incident) => incident.actionRequired);

  return (
    <>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="page-eyebrow">Organizer workspace</p><h1 className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">Incident action queue</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-ink-600">Review participant reports by severity and pending action, inspect the full record and assign the right response path.</p></div>
        <div className="flex items-center gap-2 rounded-md border border-[#ded5c5] bg-[#fffdf8] px-3 py-2 text-xs text-ink-600"><Building2 size={16} className="text-brand-600" /> Organizer controls</div>
      </div>
      {notice && <div className="mt-5 flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-status-approved"><CheckCircle2 size={16} />{notice}</div>}
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={FileText} label="Total reports" value={String(incidents.length)} detail="Participant submissions" />
        <KpiCard icon={Flag} label="Action required" value={String(actionRequired.length)} detail="Needs organizer decision" tone="red" />
        <KpiCard icon={ShieldAlert} label="High severity" value={String(incidents.filter((incident) => incident.severity === 'High').length)} detail="Prioritise first" tone="red" />
        <KpiCard icon={Activity} label="In progress" value={String(incidents.filter((incident) => incident.status === 'Investigating').length)} detail="Team or authority response" tone="gold" />
      </div>
      <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(320px,.82fr)_minmax(0,1.18fr)]">
        <div className="space-y-4">
          <IncidentList incidents={incidents} selectedId={selected?.id ?? ''} onSelect={(incident) => setSelectedId(incident.id)} query={query} onQueryChange={setQuery} filter={filter} onFilterChange={setFilter} filterOptions={[{ value: 'action-required', label: 'Action required first' }, { value: 'all', label: 'All reports' }, { value: 'High', label: 'High severity' }, { value: 'Medium', label: 'Medium severity' }, { value: 'Low', label: 'Low severity' }, { value: 'Investigating', label: 'Investigating' }, { value: 'Resolved', label: 'Resolved' }]} heading="Organizer report list" subheading="Sorted by pending action, then severity" emptyLabel="No reports match this queue filter." />
          <div className="card border-brand-200 bg-brand-50/60 p-4"><div className="flex items-start gap-3"><Flag size={17} className="mt-0.5 shrink-0 text-risk-high-text" /><div><p className="text-sm font-bold text-ink-800">Queue rule</p><p className="mt-1 text-xs leading-5 text-ink-600">Reports requiring action appear first. Within each group, High severity is prioritised above Medium and Low.</p></div></div></div>
        </div>
        {selected ? <IncidentDetail incident={selected} role="organizer" onAssignInternalTeam={onAssignInternalTeam} onRequestExternalAuthority={onRequestExternalAuthority} onRecordAction={onRecordAction} onResolve={onResolve} /> : <div className="card flex min-h-64 items-center justify-center p-8 text-center text-sm text-ink-500">Select a report to view its details.</div>}
      </div>
    </>
  );
}

function AuthorityView({ incidents, selectedId, setSelectedId, onRecordInvestigation, notice }: { incidents: Incident[]; selectedId: string; setSelectedId: (id: string) => void; onRecordInvestigation: (note: string) => void; notice: string | null }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const referred = incidents.filter((incident) => incident.authority);
  const selected = referred.find((incident) => incident.id === selectedId) ?? referred[0];

  return (
    <>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="page-eyebrow">Authority workspace · assigned cases</p><h1 className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">Incident investigation queue</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-ink-600">Review organizer referrals, inspect the participant report and record investigation actions, evidence and outcomes.</p></div><div className="flex items-center gap-2 rounded-md border border-[#ded5c5] bg-[#fffdf8] px-3 py-2 text-xs text-ink-600"><ShieldCheck size={16} className="text-brand-600" /> Scoped to assigned authority</div></div>
      {notice && <div className="mt-5 flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-status-approved"><CheckCircle2 size={16} />{notice}</div>}
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><KpiCard icon={LifeBuoy} label="Referred" value={String(referred.length)} detail="Assigned to this authority" /><KpiCard icon={ShieldAlert} label="Immediate action" value={String(referred.filter((incident) => incident.immediateAction).length)} detail="Review response priority" tone="red" /><KpiCard icon={Activity} label="Investigating" value={String(referred.filter((incident) => incident.status === 'Investigating').length)} detail="Open investigation" tone="gold" /><KpiCard icon={CheckCircle2} label="Resolved" value={String(referred.filter((incident) => incident.status === 'Resolved').length)} detail="Outcome available" tone="green" /></div>
      <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(320px,.82fr)_minmax(0,1.18fr)]">
        <IncidentList incidents={referred} selectedId={selected?.id ?? ''} onSelect={(incident) => setSelectedId(incident.id)} query={query} onQueryChange={setQuery} filter={filter} onFilterChange={setFilter} filterOptions={[{ value: 'all', label: 'All referred' }, { value: 'High', label: 'High severity' }, { value: 'Investigating', label: 'Investigating' }, { value: 'Resolved', label: 'Resolved' }]} heading="Authority case list" subheading="Organizer referrals" emptyLabel="No referred incidents match your search." />
        {selected ? <IncidentDetail incident={selected} role="authority" onRecordInvestigation={onRecordInvestigation} /> : <div className="card flex min-h-64 items-center justify-center p-8 text-center text-sm text-ink-500">Select an incident to review.</div>}
      </div>
    </>
  );
}

export default function IncidentReportingPrototype() {
  const [role, setRole] = useState<Role>('reporter');
  const [incidents, setIncidents] = useState<Incident[]>(INITIAL_INCIDENTS);
  const [selectedId, setSelectedId] = useState(INITIAL_INCIDENTS[0].id);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [notice, setNotice] = useState<string | null>(null);

  const updateForm = (key: keyof FormState, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));

  const changeRole = (nextRole: Role) => {
    setRole(nextRole);
    setNotice(null);
    const nextIncident = nextRole === 'authority'
      ? incidents.find((incident) => incident.authority)
      : nextRole === 'organizer'
        ? incidents.find((incident) => incident.actionRequired) ?? incidents[0]
        : incidents.find((incident) => incident.reporter === CURRENT_REPORTER) ?? incidents[0];
    if (nextIncident) setSelectedId(nextIncident.id);
  };

  const submitReport = () => {
    const nextNumber = incidents.length + 8;
    const newIncident: Incident = {
      id: 'INC-2026-' + String(nextNumber).padStart(4, '0'),
      reporter: CURRENT_REPORTER,
      event: form.event,
      eventType: form.event.includes('Run') ? 'Sports event' : 'Cultural event',
      category: form.category,
      title: form.description.trim().split(/[.!?]/)[0].slice(0, 72) || 'New incident report',
      description: form.description.trim(),
      location: form.location,
      occurredAt: formatDateTime(form.occurredAt),
      submittedAt: 'Just now',
      status: 'Action required',
      severity: 'Medium',
      immediateAction: false,
      actionRequired: true,
      recommendedAction: 'Organizer triage required after participant submission',
      eventControl: form.eventControl ? 'Published Event Control item · review required' : undefined,
      evidence: form.evidence.trim() || 'No evidence attached yet',
      recommendedAuthorities: ['DBKL event operations', 'PDRM Kuala Lumpur'],
      actions: [],
      history: [
        { label: 'Report submitted', detail: 'Participant report created successfully.', at: 'Just now', state: 'done' },
        { label: 'AI assessment completed', detail: 'Medium severity · organizer triage required.', at: 'Just now', state: 'done' },
        { label: 'Organizer action required', detail: 'Assign an internal team or request an external authority.', at: 'Waiting', state: 'current' },
        { label: 'Resolution', detail: 'Final outcome will be recorded after response.', at: 'Not started', state: 'muted' },
      ],
    };
    setIncidents((current) => [newIncident, ...current]);
    setSelectedId(newIncident.id);
    setForm(INITIAL_FORM);
    setNotice(newIncident.id + ' was submitted. It is now visible in the organizer action queue.');
  };

  const updateIncident = (id: string, updater: (incident: Incident) => Incident) => {
    setIncidents((current) => current.map((incident) => incident.id === id ? updater(incident) : incident));
  };

  const assignInternalTeam = (team: string, note: string) => {
    const action: IncidentAction = { id: 'ACT-' + Date.now(), path: 'internal', label: 'Internal team assigned', owner: team, note: note.trim() || 'Internal team assigned for response.', at: 'Just now', status: 'Assigned' };
    updateIncident(selectedId, (incident) => ({ ...incident, responsePath: 'internal', responseTeam: team, status: 'Investigating', actionRequired: false, actions: [...incident.actions, action], history: addHistory(incident.history, 'Internal team assigned', team + ' is responsible for the response.') }));
    setNotice('Prototype action: ' + team + ' assigned to ' + selectedId + '.');
  };

  const requestExternalAuthority = (authority: string, note: string) => {
    const action: IncidentAction = { id: 'ACT-' + Date.now(), path: 'external', label: 'External authority requested', owner: authority, note: note.trim() || 'External assistance requested for investigation or response.', at: 'Just now', status: 'Requested' };
    updateIncident(selectedId, (incident) => ({ ...incident, responsePath: 'external', authority, status: 'Investigating', actionRequired: false, actions: [...incident.actions, action], history: addHistory(incident.history, 'External authority requested', authority + ' was asked to support the incident response.') }));
    setNotice('Prototype action: external request sent to ' + authority + ' for ' + selectedId + '.');
  };

  const recordIncidentAction = (path: ResponsePath, owner: string, note: string) => {
    const action: IncidentAction = { id: 'ACT-' + Date.now(), path, label: path === 'internal' ? 'Internal incident action recorded' : 'External authority action recorded', owner, note, at: 'Just now', status: 'Recorded' };
    updateIncident(selectedId, (incident) => ({ ...incident, responsePath: path, responseTeam: path === 'internal' ? owner : incident.responseTeam, authority: path === 'external' ? owner : incident.authority, status: incident.status === 'Resolved' ? 'Resolved' : 'Investigating', actionRequired: false, actions: [...incident.actions, action], history: addHistory(incident.history, action.label, note) }));
    setNotice('Prototype action: incident action recorded for ' + selectedId + '.');
  };

  const recordInvestigationAction = (note: string) => {
    const incident = incidents.find((item) => item.id === selectedId);
    const owner = incident?.authority ?? 'Assigned authority';
    const action: IncidentAction = { id: 'ACT-' + Date.now(), path: 'external', label: 'Authority investigation finding submitted', owner, note, at: 'Just now', status: 'Recorded' };
    updateIncident(selectedId, (current) => ({ ...current, status: 'Under review', actionRequired: true, actions: [...current.actions, action], history: addHistory(current.history, 'Authority finding returned to organizer', note) }));
    setNotice('Prototype action: investigation finding returned to the organizer for ' + selectedId + '.');
  };

  const resolveIncident = (rationale: string, discrepancyOutcome?: DiscrepancyOutcome) => {
    updateIncident(selectedId, (incident) => ({
      ...incident,
      status: 'Resolved',
      actionRequired: false,
      finalResolution: rationale,
      discrepancyOutcome,
      actions: incident.actions.map((action) => ({ ...action, status: 'Completed' as const })),
      history: [
        ...incident.history.map((entry) => entry.state === 'current' ? { ...entry, state: 'done' as const } : entry),
        { label: 'Final resolution recorded by organizer', detail: rationale, at: 'Just now', state: 'done' as const },
      ],
    }));
    setNotice('Prototype action: organizer recorded the final resolution for ' + selectedId + '.');
  };

  return (
    <div className="min-h-screen bg-cream-50 text-ink-800">
      <PageHeader role={role} onRoleChange={changeRole} />
      <main className="mx-auto w-full max-w-[1440px] px-5 py-7 sm:px-8 sm:py-10">
        <PreviewBanner />
        {role === 'reporter' && <ReporterView incidents={incidents} selectedId={selectedId} setSelectedId={setSelectedId} onSubmit={submitReport} notice={notice} form={form} onFormChange={updateForm} />}
        {role === 'organizer' && <OrganizerView incidents={incidents} selectedId={selectedId} setSelectedId={setSelectedId} onAssignInternalTeam={assignInternalTeam} onRequestExternalAuthority={requestExternalAuthority} onRecordAction={recordIncidentAction} onResolve={resolveIncident} notice={notice} />}
        {role === 'authority' && <AuthorityView incidents={incidents} selectedId={selectedId} setSelectedId={setSelectedId} onRecordInvestigation={recordInvestigationAction} notice={notice} />}
      </main>
      <footer className="border-t border-[#ddd3c2] bg-[#fffdf8] py-5"><div className="mx-auto max-w-[1440px] px-5 text-center text-xs text-ink-500">STERAS · Incident Reporting Prototype · Reporter, organizer and authority views · Synthetic data only</div></footer>
    </div>
  );
}

