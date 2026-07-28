import { ReactNode, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowRight, Boxes, DatabaseZap, Search, ShieldCheck, UsersRound } from 'lucide-react';
import ResourceRecommendation from '../../components/m2/ResourceRecommendation';
import { AuthorityTopBar } from '../../components/layout/Sidebar';
import EmptyState from '../../components/ui/EmptyState';
import RiskMeter from '../../components/ui/RiskMeter';
import StatusBadge from '../../components/ui/StatusBadge';
import { useAuth } from '../../contexts/AuthContext';
import {
  filterResourcePortfolio,
  M2PortfolioRecord,
  resourcePortfolioSummary,
  ResourcePortfolioFilter,
} from './m2PortfolioData';
import { useM2Portfolio } from './useM2Portfolio';
import './authority-dashboard.css';
import './m2-workspace.css';

interface ResourceRecommendationsProps {
  previewRecords?: M2PortfolioRecord[];
  previewAgency?: string;
}

export default function ResourceRecommendations({ previewRecords, previewAgency }: ResourceRecommendationsProps) {
  const { profile } = useAuth();
  const { records, loading, error, retry } = useM2Portfolio(previewRecords);
  const [filter, setFilter] = useState<ResourcePortfolioFilter>('all');
  const [search, setSearch] = useState('');
  const summary = useMemo(() => resourcePortfolioSummary(records), [records]);
  const visible = useMemo(() => filterResourcePortfolio(records, filter, search), [records, filter, search]);
  const agency = previewAgency ?? profile?.authorityType ?? 'Authority';
  const fieldPersonnel = summary.totals.police + summary.totals.security + summary.totals.fireOfficers;
  const medicalCapacity = summary.totals.medicalTeams + summary.totals.ambulances;

  return (
    <div className="m2-workspace">
      <AuthorityTopBar title="Resource recommendations" subtitle={`${agency} · Versioned indicative safety planning`} userInitials={initialsFor(profile?.name)} />

      <main className="m2-page page-enter">
        <section className="m2-observatory" aria-labelledby="resource-observatory-title">
          <div className="m2-observatory__grid">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#f6d25b]">Resource planning ledger</p>
              <h2 id="resource-observatory-title" className="mt-2 max-w-xl text-2xl font-bold sm:text-3xl">Indicative quantities with their operational basis attached.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#c7d0be]">
                Compare M2 recommendations across assigned events. Prototype quantities support review; they do not authorise deployment.
              </p>
            </div>
            <div className="m2-stat-ledger" aria-label="Resource portfolio summary">
              <SummaryStat icon={<Boxes size={16} />} value={summary.recommended} label="Events planned" />
              <SummaryStat icon={<UsersRound size={16} />} value={fieldPersonnel} label="Field personnel" />
              <SummaryStat icon={<ShieldCheck size={16} />} value={medicalCapacity} label="Medical assets" />
              <SummaryStat icon={<DatabaseZap size={16} />} value={summary.missing} label="Awaiting plan" />
            </div>
          </div>
        </section>

        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <p className="border-l-4 border-brand-300 bg-brand-50 p-3 text-ink-700">
            {summary.authorityValidated} of {summary.recommended} recommendations include a human authority validation.
          </p>
          {summary.requiresRecompute > 0 && (
            <p className="flex items-start gap-2 border-l-4 border-status-amend bg-gold-50 p-3 text-ink-700">
              <DatabaseZap size={17} className="mt-0.5 shrink-0 text-gold-600" />
              {summary.requiresRecompute} legacy resource record{summary.requiresRecompute === 1 ? '' : 's'} require recomputation.
            </p>
          )}
        </div>

        <div className="m2-filterbar">
          <label className="relative">
            <span className="sr-only">Search resource recommendations</span>
            <Search className="pointer-events-none absolute left-3 top-3.5 text-ink-400" size={17} />
            <input className="input !pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search event, venue, or type" />
          </label>
          <label>
            <span className="sr-only">Filter resource recommendations</span>
            <select className="input" value={filter} onChange={(event) => setFilter(event.target.value as ResourcePortfolioFilter)}>
              <option value="all">All assigned ({records.length})</option>
              <option value="prototype">Prototype ({records.filter((item) => item.resources?.confidenceLevel === 'prototype').length})</option>
              <option value="authorityValidated">Authority validated ({summary.authorityValidated})</option>
              <option value="missing">Awaiting plan ({summary.missing})</option>
            </select>
          </label>
        </div>

        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="page-eyebrow">Assigned portfolio</p>
            <h2 className="font-display text-xl font-bold text-ink-800">Recommendation register</h2>
          </div>
          {!loading && !error && <p className="text-sm text-ink-500">{visible.length} of {records.length} records</p>}
        </div>

        {loading ? (
          <div className="py-20 text-center text-ink-500">Loading resource recommendations…</div>
        ) : error ? (
          <EmptyState title="Resource register unavailable" description={error}>
            <button type="button" className="btn-secondary" onClick={retry}>Try again</button>
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState
            title={records.length === 0 ? 'No assigned resource plans' : 'No matching recommendations'}
            description={records.length === 0 ? `Submitted applications requiring ${agency} review will appear here.` : 'Try another validation state or search term.'}
          />
        ) : (
          <ul className="space-y-3">
            {visible.map((record) => <ResourceRecord key={record.event.eventId} record={record} />)}
          </ul>
        )}
      </main>
    </div>
  );
}

function ResourceRecord({ record }: { record: M2PortfolioRecord }) {
  const { event, assessment, resources } = record;
  const level = assessment?.officialRiskLevel ?? 'Unassessed';
  const people = resources ? resources.police + resources.security + resources.fireOfficers : 0;

  return (
    <li className="m2-record" data-risk={level}>
      <div className="m2-record__summary">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-display text-base font-semibold text-ink-800">{event.eventDetails.name}</h3>
            <StatusBadge status={event.status} />
          </div>
          <p className="mt-1 text-sm text-ink-600">{event.eventDetails.venueName} · {format(new Date(event.eventDetails.startDatetime), 'PPp')}</p>
          <p className="mt-1 text-xs text-ink-500">{event.eventDetails.expectedAttendance.toLocaleString()} attendees · version {event.currentVersionNumber}</p>
        </div>

        <div className="text-xs text-ink-600">
          <p className="font-semibold text-ink-800">{resources ? `${people} recommended field personnel` : resourceState(record)}</p>
          <p className="mt-1">{resources ? `${quantityLabel(resources.medicalTeams, 'medical team')} · ${quantityLabel(resources.ambulances, 'ambulance')}` : 'No current versioned quantities'}</p>
        </div>

        <div className="m2-score">
          {assessment ? <RiskMeter level={assessment.officialRiskLevel} size="compact" /> : <span className="text-xs font-semibold text-ink-500">Risk pending</span>}
          <span className={`badge ${resources?.confidenceLevel === 'authorityValidated' ? 'badge-green' : resources ? 'badge-amber' : 'badge-gray'}`}>
            {resources?.confidenceLevel === 'authorityValidated' ? 'Validated' : resources ? 'Prototype' : 'Missing'}
          </span>
        </div>
      </div>

      {resources ? (
        <details className="m2-disclosure">
          <summary>Inspect quantities, rationale and provenance</summary>
          <div className="m2-disclosure__body !block">
            <section className="border-t-2 border-brand-300 bg-white p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h4 className="font-display text-sm font-semibold text-ink-800">Versioned recommendation</h4>
                <Link to={`/authority/events/${event.eventId}`} className="btn-secondary !min-h-10 !px-3">Review or adjust <ArrowRight size={15} /></Link>
              </div>
              <ResourceRecommendation recommendation={resources} showOverrideProvenance />
            </section>
          </div>
        </details>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e3dacb] px-4 py-3 text-sm text-ink-600">
          <p>{record.legacyResources ? 'Legacy recommendation shape detected. Recompute this event version.' : resourceState(record)}</p>
          <Link to={`/authority/events/${event.eventId}`} className="font-semibold text-brand-700 hover:text-brand-800">Open application <ArrowRight className="inline" size={14} /></Link>
        </div>
      )}
    </li>
  );
}

function SummaryStat({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return <div>{icon}<strong className="mt-2">{value}</strong><span>{label}</span></div>;
}

function resourceState(record: M2PortfolioRecord): string {
  if (record.legacyResources) return 'Requires recompute';
  if (record.assessmentStatus === 'processing') return 'Waiting for assessment';
  if (record.assessmentStatus === 'failed') return 'Assessment failed';
  return 'No recommendation yet';
}

function quantityLabel(value: number, singular: string): string {
  return `${value} ${singular}${value === 1 ? '' : 's'}`;
}

function initialsFor(name?: string): string {
  return name ? name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() : 'AO';
}
