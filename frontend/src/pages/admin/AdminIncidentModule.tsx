import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Search, ShieldAlert } from 'lucide-react';
import { mockIncidents } from '../../mock_data/incidents';
import type { Incident } from '@shared/types';
import { WorkspaceTopBar } from '../../components/layout/Sidebar';
import { useAuth } from '../../contexts/AuthContext';

const severityTone: Record<Incident['severity'], string> = {
  low: 'bg-green-100 text-status-approved',
  medium: 'bg-gold-100 text-gold-700',
  high: 'bg-red-100 text-status-rejected',
};

const statusLabel: Record<NonNullable<Incident['status']>, string> = {
  verified: 'Verified',
  under_review: 'Under review',
  rejected: 'Rejected',
};

export default function AdminIncidentModule() {
  const { profile } = useAuth();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(mockIncidents[0]?.incidentId ?? '');
  const [filter, setFilter] = useState<'all' | Incident['severity']>('all');
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return mockIncidents.filter((incident) => {
      if (filter !== 'all' && incident.severity !== filter) return false;
      return !needle || [incident.incidentId, incident.incidentType, incident.description ?? '']
        .some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [filter, search]);
  const selected = filtered.find((incident) => incident.incidentId === selectedId) ?? filtered[0];

  return (
    <div className="min-h-screen bg-[#f3f1e9] pb-16">
      <WorkspaceTopBar
        title="Incident Module"
        subtitle="M4 — incident reporting and response history"
        userInitials={(profile?.name ?? 'Admin').split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}
        workspaceEyebrow="STERAS administration"
        workspaceEyebrowIcon={ShieldAlert}
      />
      <main className="page-shell page-enter">
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-brand-700" aria-hidden="true" />
          <p><strong>Prototype preview.</strong> These incident records are synthetic and read-only. No live incident report is created from this module.</p>
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <section className="overflow-hidden rounded-lg border border-[#ded5c5] bg-white shadow-card" aria-labelledby="incident-list-heading">
            <div className="border-b border-[#e8e0cf] p-4">
              <div className="flex items-center justify-between gap-3">
                <div><h1 id="incident-list-heading" className="font-display text-xl font-bold text-ink-900">Incident reports</h1><p className="mt-1 text-xs text-ink-500">M4 records available to the review workspace.</p></div>
                <span className="badge bg-ink-100 text-ink-600">{filtered.length} records</span>
              </div>
              <label className="relative mt-4 block"><span className="sr-only">Search incident reports</span><Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-ink-400" /><input className="input min-h-11 !pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search incident ID or description" /></label>
              <div className="mt-3 flex flex-wrap gap-2" aria-label="Filter incidents by severity">
                {(['all', 'low', 'medium', 'high'] as const).map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`min-h-9 rounded-md border px-3 text-xs font-semibold ${filter === value ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-700 hover:bg-cream-50'}`}>{value === 'all' ? 'All' : `${value[0].toUpperCase()}${value.slice(1)}`}</button>)}
              </div>
            </div>
            <ul className="divide-y divide-[#e8e0cf]">
              {filtered.map((incident) => <li key={incident.incidentId}><button type="button" onClick={() => setSelectedId(incident.incidentId)} className={`w-full p-4 text-left transition hover:bg-cream-50 ${selected?.incidentId === incident.incidentId ? 'bg-brand-50/60' : ''}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-mono text-xs text-ink-500">{incident.incidentId}</p><p className="mt-1 truncate text-sm font-semibold text-ink-900">{incident.incidentType.replaceAll('_', ' ')}</p><p className="mt-1 truncate text-xs text-ink-500">{incident.description ?? 'No description recorded.'}</p></div><span className={`badge shrink-0 ${severityTone[incident.severity]}`}>{incident.severity}</span></div></button></li>)}
            </ul>
          </section>
          {selected ? <IncidentDetails incident={selected} /> : <div className="rounded-lg border border-dashed border-ink-300 bg-white p-8 text-center text-sm text-ink-500">No incident matches the current filters.</div>}
        </div>
      </main>
    </div>
  );
}

function IncidentDetails({ incident }: { incident: Incident }) {
  return <section className="rounded-lg border border-[#ded5c5] bg-white p-5 shadow-card" aria-labelledby="incident-detail-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-xs text-ink-500">{incident.incidentId}</p><h2 id="incident-detail-heading" className="mt-1 font-display text-xl font-bold capitalize text-ink-900">{incident.incidentType.replaceAll('_', ' ')}</h2></div><span className={`badge ${severityTone[incident.severity]}`}>{incident.severity} severity</span></div>
    <dl className="mt-5 grid gap-4 border-y border-[#e8e0cf] py-4 sm:grid-cols-2"><div><dt className="text-xs text-ink-500">Status</dt><dd className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-ink-800"><CheckCircle2 size={14} className="text-status-approved" />{incident.status ? statusLabel[incident.status] : 'Unverified'}</dd></div><div><dt className="text-xs text-ink-500">Reported</dt><dd className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-ink-800"><Clock3 size={14} className="text-brand-700" />{new Date(incident.date).toLocaleDateString('en-MY', { dateStyle: 'medium' })}</dd></div><div><dt className="text-xs text-ink-500">Event type</dt><dd className="mt-1 text-sm text-ink-800">{incident.eventType}</dd></div><div><dt className="text-xs text-ink-500">Assessment eligible</dt><dd className="mt-1 text-sm text-ink-800">{incident.assessmentEligible ? 'Yes' : 'No'}</dd></div></dl>
    <div className="mt-5 rounded-md bg-cream-50 p-4"><p className="text-xs font-bold uppercase tracking-[0.08em] text-ink-500">Report description</p><p className="mt-2 text-sm leading-6 text-ink-700">{incident.description ?? 'No description recorded.'}</p></div>
    {incident.outcome && <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{Object.entries(incident.outcome).map(([key, value]) => <div key={key} className="rounded-md border border-[#e8e0cf] p-3"><p className="text-xs capitalize text-ink-500">{key}</p><p className="mt-1 font-display text-xl font-bold text-ink-900">{value}</p></div>)}</div>}
    <p className="mt-5 text-xs leading-5 text-ink-500">Synthetic M4 fixture data supports M2 history and interface testing only; it is not evidence of a real incident.</p>
  </section>;
}
