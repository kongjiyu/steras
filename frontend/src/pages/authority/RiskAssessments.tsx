import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowRight, DatabaseZap, Search, ShieldAlert } from 'lucide-react';
import AIAdvisory from '../../components/m2/AIAdvisory';
import CategoryProfile from '../../components/m2/CategoryProfile';
import ContextEvidence from '../../components/m2/ContextEvidence';
import { AuthorityTopBar } from '../../components/layout/Sidebar';
import EmptyState from '../../components/ui/EmptyState';
import RiskMeter from '../../components/ui/RiskMeter';
import StatusBadge from '../../components/ui/StatusBadge';
import { assessmentRiskLevel, assessmentScore } from '../../components/m2/m2Contract';
import { useAuth } from '../../contexts/AuthContext';
import {
  assessmentFreshness,
  filterRiskPortfolio,
  highestCategory,
  M2PortfolioRecord,
  riskPortfolioSummary,
  RiskPortfolioFilter,
} from './m2PortfolioData';
import { useM2Portfolio } from './useM2Portfolio';
import './authority-dashboard.css';
import './m2-workspace.css';

interface RiskAssessmentsProps {
  previewRecords?: M2PortfolioRecord[];
  previewAgency?: string;
}

const FILTERS: RiskPortfolioFilter[] = ['all', 'High', 'Medium', 'Low', 'Unassessed'];

export default function RiskAssessments({ previewRecords, previewAgency }: RiskAssessmentsProps) {
  const { profile } = useAuth();
  const { records, loading, error, retry } = useM2Portfolio(previewRecords);
  const [filter, setFilter] = useState<RiskPortfolioFilter>('all');
  const [search, setSearch] = useState('');
  const summary = useMemo(() => riskPortfolioSummary(records), [records]);
  const visible = useMemo(() => filterRiskPortfolio(records, filter, search), [records, filter, search]);
  const agency = previewAgency ?? profile?.authorityType ?? 'Authority';
  const initials = initialsFor(profile?.name);

  return (
    <div className="m2-workspace">
      <AuthorityTopBar title="Risk assessments" subtitle={`${agency} · Provisional M2 category intelligence`} userInitials={initials} />

      <main className="m2-page page-enter">
        <section className="m2-observatory" aria-labelledby="risk-observatory-title">
          <div className="m2-observatory__grid">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#f6d25b]">Assessment observatory</p>
              <h2 id="risk-observatory-title" className="mt-2 max-w-xl text-2xl font-bold sm:text-3xl">Validated provisional risk, ready for authority review.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#c7d0be]">
                Monitor deterministic category results and their evidence provenance across every application assigned to {agency}.
              </p>
            </div>
            <div className="m2-stat-ledger" aria-label="Risk portfolio summary">
              <SummaryStat value={summary.High} label="High risk" />
              <SummaryStat value={summary.Medium} label="Medium risk" />
              <SummaryStat value={summary.Low} label="Low risk" />
              <SummaryStat value={summary.Unassessed} label="Awaiting result" />
            </div>
          </div>
        </section>

        {(summary.requiresRecompute > 0 || summary.advisoryUnavailable > 0) && (
          <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            {summary.requiresRecompute > 0 && (
              <p className="flex items-start gap-2 border-l-4 border-status-amend bg-gold-50 p-3 text-ink-700">
                <DatabaseZap size={17} className="mt-0.5 shrink-0 text-gold-600" />
                {summary.requiresRecompute} legacy assessment{summary.requiresRecompute === 1 ? '' : 's'} require versioned M2 recomputation.
              </p>
            )}
            {summary.advisoryUnavailable > 0 && (
              <p className="flex items-start gap-2 border-l-4 border-gold-300 bg-gold-50 p-3 text-ink-700">
                <ShieldAlert size={17} className="mt-0.5 shrink-0 text-gold-600" />
                {summary.advisoryUnavailable} record{summary.advisoryUnavailable === 1 ? ' requires' : 's require'} manual assessment because no valid AI proposal is available.
              </p>
            )}
          </div>
        )}

        <div className="m2-filterbar">
          <label className="relative">
            <span className="sr-only">Search risk assessments</span>
            <Search className="pointer-events-none absolute left-3 top-3.5 text-ink-400" size={17} />
            <input className="input !pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search event, venue, or type" />
          </label>
          <label>
            <span className="sr-only">Filter by assessment risk</span>
            <select className="input" value={filter} onChange={(event) => setFilter(event.target.value as RiskPortfolioFilter)}>
              {FILTERS.map((value) => <option key={value} value={value}>{riskFilterLabel(value)} ({riskCount(value, summary, records.length)})</option>)}
            </select>
          </label>
        </div>

        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="page-eyebrow">Assigned portfolio</p>
            <h2 className="font-display text-xl font-bold text-ink-800">Assessment register</h2>
          </div>
          {!loading && !error && <p className="text-sm text-ink-500">{visible.length} of {records.length} records</p>}
        </div>

        {loading ? (
          <div className="py-20 text-center text-ink-500">Loading category assessments…</div>
        ) : error ? (
          <EmptyState title="Assessment register unavailable" description={error}>
            <button type="button" className="btn-secondary" onClick={retry}>Try again</button>
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState
            title={records.length === 0 ? 'No assigned assessments' : 'No matching assessments'}
            description={records.length === 0 ? `Submitted applications requiring ${agency} review will appear here.` : 'Try another risk level or search term.'}
          />
        ) : (
          <ul className="space-y-3">
            {visible.map((record) => <RiskRecord key={record.event.eventId} record={record} />)}
          </ul>
        )}
      </main>
    </div>
  );
}

function RiskRecord({ record }: { record: M2PortfolioRecord }) {
  const { event, assessment } = record;
  const topCategory = highestCategory(assessment);
  const freshness = assessmentFreshness(assessment);
  const level = assessmentRiskLevel(assessment) ?? 'Unassessed';

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
          <p className="font-semibold text-ink-800">{topCategory ? `${topCategory.categoryName}: ${topCategory.normalizedScore}/100` : assessmentState(record)}</p>
          <p className="mt-1 capitalize">Context: {freshness} · AI: {assessment?.aiProposal?.status ?? 'pending'}</p>
        </div>

        <div className="m2-score">
          {assessmentRiskLevel(assessment) ? <RiskMeter level={assessmentRiskLevel(assessment)!} size="compact" /> : <span className="text-xs font-semibold text-ink-500">Unassessed</span>}
          <strong>{assessmentScore(assessment) ?? '—'}</strong>
        </div>
      </div>

      {assessment ? (
        <details className="m2-disclosure">
          <summary>Inspect categories, AI advisory and evidence</summary>
          <div className="m2-disclosure__body">
            <section className="border-t-2 border-brand-300 bg-white p-4">
              <h4 className="mb-4 font-display text-sm font-semibold text-ink-800">Validated category profile</h4>
              <CategoryProfile assessment={assessment} density="compact" />
            </section>
            <section className="bg-white p-4">
              <AIAdvisory advisory={assessment.aiProposal} resultRiskLevel={assessmentRiskLevel(assessment)} showCategories={false} />
            </section>
            <section className="border-t border-[#e3dacb] bg-white p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h4 className="font-display text-sm font-semibold text-ink-800">Versioned context evidence</h4>
                <Link to={`/authority/events/${event.eventId}`} className="btn-secondary !min-h-10 !px-3">Open review <ArrowRight size={15} /></Link>
              </div>
              <ContextEvidence assessment={assessment} />
            </section>
          </div>
        </details>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e3dacb] px-4 py-3 text-sm text-ink-600">
          <p>{record.legacyAssessment ? 'Legacy assessment shape detected. Recompute this event version before review.' : assessmentState(record)}</p>
          <Link to={`/authority/events/${event.eventId}`} className="font-semibold text-brand-700 hover:text-brand-800">Open application <ArrowRight className="inline" size={14} /></Link>
        </div>
      )}
    </li>
  );
}

function SummaryStat({ value, label }: { value: number; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

function assessmentState(record: M2PortfolioRecord): string {
  if (record.legacyAssessment) return 'Requires recompute';
  if (record.assessmentStatus === 'failed') return 'Assessment failed';
  if (record.assessmentStatus === 'processing') return 'Assessment processing';
  return 'No assessment yet';
}

function riskFilterLabel(filter: RiskPortfolioFilter): string {
  return filter === 'all' ? 'All assessment risks' : filter === 'Unassessed' ? 'Awaiting result' : `${filter} risk`;
}

function riskCount(filter: RiskPortfolioFilter, summary: ReturnType<typeof riskPortfolioSummary>, total: number): number {
  return filter === 'all' ? total : summary[filter];
}

function initialsFor(name?: string): string {
  return name ? name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() : 'AO';
}
