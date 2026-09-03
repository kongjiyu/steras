import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Database,
  Download,
  FileDown,
  FileText,
  Gauge,
  LockKeyhole,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { EVENT_TYPES, EventType } from '@shared/types';
import type { AnalyticsPortfolioRequest, AnalyticsPortfolioResponse } from '@shared/analytics';
import { functions, isFirebaseConfigured } from '../../config/firebase';
import { useAuth } from '../../contexts/AuthContext';
import logoUrl from '../../assets/brand/steras-logo-horizontal.svg';
import {
  AnalysisScope,
  AnalyticsRecord,
  BreakdownRow,
  buildReportModel,
  filterAnalyticsRecords,
  MetricDefinition,
  parseAnalyticsPortfolioResponse,
  REPORT_CATALOG,
  ReportMetric,
  ReportModel,
  ReportType,
  reportCsv,
} from './analyticsData';
import './analytics.css';

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
);

const chartOptions: any = {
  responsive: true,
  maintainAspectRatio: false,
  color: '#64705b',
  plugins: {
    legend: {
      position: 'bottom',
      labels: { usePointStyle: true, boxWidth: 8, padding: 18, color: '#64705b', font: { family: 'Source Sans 3' } },
    },
    tooltip: { backgroundColor: '#172212', padding: 12, cornerRadius: 8 },
  },
  scales: {
    y: { beginAtZero: true, grid: { color: '#e8e3d8' }, ticks: { color: '#7a8272' } },
    x: { grid: { display: false }, ticks: { color: '#7a8272' } },
  },
};

const doughnutOptions: any = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '68%',
  plugins: {
    legend: {
      position: 'bottom',
      labels: { usePointStyle: true, boxWidth: 8, padding: 18, color: '#64705b', font: { family: 'Source Sans 3' } },
    },
  },
};

interface AnalyticsProps {
  previewMode?: boolean;
  embedded?: boolean;
}

export default function Analytics({ previewMode = false, embedded = false }: AnalyticsProps) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [records, setRecords] = useState<AnalyticsRecord[]>([]);
  const [reportType, setReportType] = useState<ReportType>('risk-incident');
  const [scope, setScope] = useState<AnalysisScope>('overall');
  const [eventType, setEventType] = useState<EventType>('festival');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(!previewMode);
  const [error, setError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportRecords, setReportRecords] = useState<AnalyticsRecord[]>([]);
  const [backendMeta, setBackendMeta] = useState<{
    syntheticExcluded: number;
    unavailableSections: string[];
    totalMatched: number;
    totalMatchedExact: boolean;
    truncated: boolean;
    coverageLimitations: string[];
  }>({ syntheticExcluded: 0, unavailableSections: [], totalMatched: 0, totalMatchedExact: true, truncated: false, coverageLimitations: [] });
  const [report, setReport] = useState<ReportModel>(() => buildReportModel('risk-incident', 'overall', undefined, { preview: previewMode }));

  useEffect(() => {
    if (previewMode) {
      setLoading(false);
      return;
    }
    if (!isFirebaseConfigured || profile?.role !== 'admin') {
      setLoading(false);
      return;
    }

    let active = true;
    const load = async () => {
      try {
        const callable = httpsCallable<AnalyticsPortfolioRequest, AnalyticsPortfolioResponse>(functions, 'getAnalyticsPortfolio');
        const response = await callable({ limit: 500, includeSynthetic: false });
        if (!active) return;
        const validated = parseAnalyticsPortfolioResponse(response.data);
        if (!validated) throw new Error('Invalid analytics response');
        const nextRecords = validated.records;
        const nextMeta = {
          syntheticExcluded: validated.syntheticExcluded,
          unavailableSections: validated.unavailableSections,
          totalMatched: validated.totalMatched,
          totalMatchedExact: validated.coverage.totalMatchedExact,
          truncated: validated.truncated || validated.coverage.eventScan === 'truncated' || validated.coverage.childCollections === 'truncated',
          coverageLimitations: validated.coverage.limitations,
        };
        setRecords(nextRecords);
        setBackendMeta(nextMeta);
        setReportRecords(selectRecords(nextRecords, 'overall', undefined, '', ''));
        setReport(buildReportModel('risk-incident', 'overall', undefined, {
          records: nextRecords,
          syntheticExcluded: nextMeta.syntheticExcluded,
          unavailableSections: nextMeta.unavailableSections,
          totalMatched: nextMeta.totalMatched,
          totalMatchedExact: nextMeta.totalMatchedExact,
          truncated: nextMeta.truncated,
          coverageLimitations: nextMeta.coverageLimitations,
        }));
        setError('');
        setLoading(false);
      } catch {
        if (!active) return;
        setError('The latest valid records could not be loaded.');
        setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [previewMode, profile?.role]);

  const selectedRecords = useMemo(
    () => selectRecords(records, scope, scope === 'eventType' ? eventType : undefined, from, to),
    [eventType, from, records, scope, to],
  );

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const handleGenerate = () => {
    setIsGenerating(true);
    const nextReport = buildReportModel(reportType, scope, scope === 'eventType' ? eventType : undefined, {
      preview: previewMode,
      records,
      from,
      to,
      syntheticExcluded: backendMeta.syntheticExcluded,
      unavailableSections: backendMeta.unavailableSections,
      totalMatched: backendMeta.totalMatched,
      totalMatchedExact: backendMeta.totalMatchedExact,
      truncated: backendMeta.truncated,
      coverageLimitations: backendMeta.coverageLimitations,
    });
    setReport(nextReport);
    setReportRecords(previewMode ? [] : selectedRecords);
    setIsGenerating(false);
  };

  const handleExport = () => {
    downloadBlob(
      reportCsv(report, reportRecords),
      'steras-' + report.reportType + '-' + new Date().toISOString().slice(0, 10) + '.csv',
      'text/csv;charset=utf-8',
    );
  };

  return (
    <div className={'admin-reports ' + (embedded ? 'admin-reports--embedded' : '')}>
      {!embedded && <AdminHeader previewMode={previewMode} onSignOut={previewMode ? undefined : handleSignOut} />}

      <main className="mx-auto max-w-[1440px] px-5 py-6 sm:px-8 sm:py-10">
        <section className="reports-hero">
          <div className="reports-hero__grid">
            <div className="relative z-[1]">
              <div className="reports-hero__eyebrow"><Activity size={14} /> Module 5 · Analytics &amp; Reporting</div>
              <h1>See the portfolio clearly.</h1>
              <p>
                Read-only intelligence for the STERAS administrator. Compare event risk,
                application outcomes, assessment quality, safety resources, and event-control readiness
                without exposing organiser personal information.
              </p>
              <div className="reports-hero__security">
                <LockKeyhole size={15} />
                <span>Admin-only</span>
                <i />
                <span>Read-only</span>
                <i />
                <span>PII-safe</span>
              </div>
            </div>
            <div className="reports-hero__meta relative z-[1]">
              <MetaStat icon={<Database size={17} />} label="Eligible responses" value={formatNumber(report.eligibleRecords)} />
              <MetaStat icon={<CalendarDays size={17} />} label="Coverage" value={<CoverageValue label={report.coverage.label} />} />
              <MetaStat icon={<ShieldCheck size={17} />} label="Synthetic reports" value={report.syntheticExcluded === null ? 'Data Not Available' : formatNumber(report.syntheticExcluded)} />
            </div>
          </div>
        </section>

        <section className="report-builder mt-6" aria-labelledby="report-builder-title">
          <div className="report-builder__heading">
            <div>
              <p className="report-kicker">Build a report</p>
              <h2 id="report-builder-title">Choose the question you need answered</h2>
              <p>Each view uses the latest valid source records available to the system.</p>
            </div>
            <div className="report-builder__source"><Database size={15} /> {previewMode ? 'Design preview · synthetic data' : 'Live Firestore source · no writes'}</div>
          </div>

          <div className="report-selector-grid">
            {REPORT_CATALOG.map((item) => (
              <button
                key={item.id}
                type="button"
                className={'report-selector ' + (reportType === item.id ? 'is-active' : '')}
                aria-pressed={reportType === item.id}
                onClick={() => setReportType(item.id)}
              >
                <span className="report-selector__icon"><ReportGlyph type={item.id} /></span>
                <span className="report-selector__copy">
                  <span className="report-selector__eyebrow">{item.eyebrow}</span>
                  <span className="report-selector__title">{item.shortTitle}</span>
                  <span className="report-selector__source">{item.source}</span>
                </span>
                <ChevronRight className="report-selector__arrow" size={17} />
              </button>
            ))}
          </div>

          <div className="report-filters">
            <div className="report-filter-group">
              <span className="report-filter-label">Analysis scope</span>
              <div className="scope-toggle" role="group" aria-label="Analysis scope">
                <button type="button" className={scope === 'overall' ? 'is-active' : ''} onClick={() => setScope('overall')}>Overall</button>
                <button type="button" className={scope === 'eventType' ? 'is-active' : ''} onClick={() => setScope('eventType')}>By Event Type</button>
              </div>
            </div>
            <label className="report-filter-group report-filter-select">
              <span className="report-filter-label">Event type</span>
              <select value={eventType} disabled={scope !== 'eventType'} onChange={(event) => setEventType(event.target.value as EventType)}>
                {EVENT_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="report-filter-group">
              <span className="report-filter-label">From</span>
              <input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label className="report-filter-group">
              <span className="report-filter-label">To</span>
              <input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
            </label>
            <div className="report-filter-actions">
              <button type="button" className="btn-secondary !min-h-[42px]" onClick={() => { setFrom(''); setTo(''); }}>
                <RefreshCw size={15} /> Reset
              </button>
              <button type="button" className="btn-primary !min-h-[42px]" onClick={handleGenerate} disabled={isGenerating}>
                <Sparkles size={15} /> {isGenerating ? 'Generating…' : 'Generate report'}
              </button>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="report-loading"><RefreshCw className="animate-spin" size={20} /> Loading latest valid records…</div>
        ) : error ? (
          <section className="report-empty mt-6">
            <TriangleAlert size={22} />
            <h2>Reports unavailable</h2>
            <p>{error}</p>
            <button type="button" className="btn-secondary mt-4" onClick={() => window.location.reload()}><RefreshCw size={15} /> Try again</button>
          </section>
        ) : (
          <ReportOutput
            model={report}
            previewMode={previewMode}
            onExport={handleExport}
            onPdf={() => window.print()}
          />
        )}
      </main>
    </div>
  );
}

function AdminHeader({ previewMode, onSignOut }: { previewMode: boolean; onSignOut?: () => void | Promise<void> }) {
  return (
    <header className="reports-topbar no-print">
      <div className="mx-auto flex min-h-[72px] max-w-[1440px] items-center justify-between gap-4 px-5 sm:px-8">
        <Link to="/admin" className="flex shrink-0 items-center" aria-label="STERAS admin home">
          <img src={logoUrl} alt="STERAS" className="h-auto w-36 object-contain sm:w-40" />
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          {previewMode ? (
            <span className="reports-preview-badge"><Sparkles size={14} /> Design preview</span>
          ) : (
            <span className="reports-admin-badge"><ShieldCheck size={14} /> Admin</span>
          )}
          <Link to="/admin" className="reports-topbar__back"><ArrowLeft size={15} /><span className="hidden sm:inline">Admin workspace</span></Link>
          {onSignOut && <button type="button" onClick={onSignOut} className="btn-secondary !px-3" title="Sign out"><LogOut size={14} /><span className="hidden sm:inline">Sign out</span></button>}
        </div>
      </div>
    </header>
  );
}

function ReportOutput({
  model,
  previewMode,
  onExport,
  onPdf,
}: {
  model: ReportModel;
  previewMode: boolean;
  onExport: () => void;
  onPdf: () => void;
}) {
  return (
    <section className="mt-6" aria-live="polite">
      <div className="report-output-header">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="report-kicker">{REPORT_CATALOG.find((item) => item.id === model.reportType)?.eyebrow ?? 'Module 5'}</p>
            <StatusChip status={model.dataStatus} />
            {previewMode && <span className="status-chip status-chip--demo">Synthetic design data</span>}
          </div>
          <h2>{model.title}</h2>
          <p>{model.scopeLabel + (model.eventTypeLabel ? ' · ' + model.eventTypeLabel : '') + ' · Generated ' + formatDateTime(model.generatedAt)}</p>
        </div>
        <div className="report-output-actions no-print">
          <button type="button" className="btn-secondary" onClick={onExport}><Download size={15} /> Export CSV</button>
          <button type="button" className="btn-primary" onClick={onPdf}><FileDown size={15} /> Save as PDF</button>
        </div>
      </div>

      <div className="report-notice">
        <ShieldCheck size={16} />
        <span>Latest valid source records only. Personal information, private evidence paths, incident descriptions, and internal authority notes are excluded.</span>
        <span className="report-notice__coverage"><CalendarDays size={14} /> {model.coverage.label}</span>
      </div>
      {model.truncated && (
        <div className="report-callout report-callout--warning mt-4" role="status">
          <TriangleAlert size={16} />
          <span>This report contains {formatNumber(model.eligibleRecords)} returned records from {model.totalMatchedExact ? '' : 'at least '}{formatNumber(model.totalMatched)} matched records. Coverage is partial; totals and rates may be incomplete.</span>
        </div>
      )}
      {model.coverageLimitations.length > 0 && (
        <div className="report-callout report-callout--warning mt-3" aria-label="Coverage limitations">
          <TriangleAlert size={16} className="shrink-0" />
          <ul className="list-disc space-y-1 pl-4">
            {model.coverageLimitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
          </ul>
        </div>
      )}

      <section className="summary-grid" aria-label="Report summary">
        {model.summary.map((metric) => <SummaryCard key={metric.label} metric={metric} />)}
      </section>

      {model.reportType === 'risk-incident' && <RiskIncidentView model={model} />}
      {model.reportType === 'application-outcome' && <ApplicationOutcomeView model={model} />}
      {model.reportType === 'risk-assessment' && <RiskAssessmentView model={model} />}
      {model.reportType === 'resource-override' && <ResourceOverrideView model={model} />}
      {model.reportType === 'control-compliance' && <ControlComplianceView model={model} />}

      <DefinitionsPanel definitions={model.definitions} />
    </section>
  );
}

function RiskIncidentView({ model }: { model: ReportModel }) {
  const incidentUnavailable = model.unavailableSections.includes('Incident patterns');
  return (
    <div className="report-content-grid">
      <Panel className="report-panel--span-8" eyebrow="Portfolio movement" title="Applications, approvals & rejection trajectory" subtitle="Monthly movement for the selected scope">
        <ChartFrame>
          <Line
            options={chartOptions}
            data={{
              labels: model.monthlyTrend.map((item) => formatMonth(item.month)),
              datasets: [
                { label: 'Applications', data: model.monthlyTrend.map((item) => item.applications), borderColor: '#627820', backgroundColor: 'rgba(98,120,32,.12)', fill: true, tension: .28 },
                { label: 'Approvals', data: model.monthlyTrend.map((item) => item.approvals), borderColor: '#c99425', backgroundColor: 'transparent', tension: .28 },
                { label: 'Rejections', data: model.monthlyTrend.map((item) => item.rejections), borderColor: '#c45d50', backgroundColor: 'transparent', tension: .28 },
              ],
            }}
          />
        </ChartFrame>
      </Panel>
      <Panel className="report-panel--span-4" eyebrow="Risk profile" title="Official risk distribution" subtitle="Latest valid assessment band">
        <ChartFrame><Doughnut options={doughnutOptions} data={doughnutData(model.riskDistribution)} /></ChartFrame>
      </Panel>
      <Panel className="report-panel--span-4" eyebrow="Incident signal" title="Privacy-safe incident snapshot" subtitle="No narrative incident details are exposed">
        {incidentUnavailable ? <UnavailableSection label="Incident patterns" /> : (
          <div className="metric-stack">
            <MetricLine label="Events with incidents" value={formatNumber(model.incidents.eventsWithIncidents)} />
            <MetricLine label="Events with incidents rate" value={model.incidents.eventsWithIncidentRate === null ? 'Data Not Available' : percent(model.incidents.eventsWithIncidentRate)} />
            <MetricLine label="Average incidents per event" value={model.incidents.averageIncidentsPerEvent === null ? 'Data Not Available' : model.incidents.averageIncidentsPerEvent.toFixed(1)} />
            <MetricLine label="Average per affected event" value={model.incidents.averageIncidentsPerAffectedEvent === null ? 'Data Not Available' : model.incidents.averageIncidentsPerAffectedEvent.toFixed(1)} />
            <MetricLine label="Action required" value={percentageForRow(model.incidents.immediateAction, 'Action required')} tone="warning" />
          </div>
        )}
      </Panel>
      <Panel className="report-panel--span-4" eyebrow="Incident attributes" title="Severity & response mix" subtitle="Count and share of privacy-safe signals">
        {incidentUnavailable ? <UnavailableSection label="Severity and response breakdowns" /> : (
          <div className="space-y-5">
            <BreakdownList title="Severity" rows={model.incidents.severity} />
            <BreakdownList title="Escalation" rows={model.incidents.escalation} />
          </div>
        )}
      </Panel>
      <Panel className="report-panel--span-4" eyebrow="Response" title="Action & resolution" subtitle="Operational response signals">
        {incidentUnavailable ? <UnavailableSection label="Action and resolution breakdowns" /> : (
          <div className="space-y-5">
            <BreakdownList title="Immediate action" rows={model.incidents.immediateAction} />
            <BreakdownList title="Resolution" rows={model.incidents.resolution} />
          </div>
        )}
      </Panel>
    </div>
  );
}

function ApplicationOutcomeView({ model }: { model: ReportModel }) {
  const dataUnavailable = model.dataStatus === 'unavailable';
  return (
    <div className="report-content-grid">
      <Panel className="report-panel--span-8" eyebrow="Outcome movement" title="Applications and terminal decisions" subtitle="Applications by creation month; approvals and rejections by terminal-decision month">
        <ChartFrame>
          {dataUnavailable ? <UnavailableSection label="Application outcome trend" /> : (
            <Line
              options={chartOptions}
              data={{
                labels: model.monthlyTrend.map((item) => formatMonth(item.month)),
                datasets: [
                  { label: 'Applications', data: model.monthlyTrend.map((item) => item.applications), borderColor: '#627820', backgroundColor: 'rgba(98,120,32,.12)', fill: true, tension: .28 },
                  { label: 'Approvals', data: model.monthlyTrend.map((item) => item.approvals), borderColor: '#c99425', backgroundColor: 'transparent', tension: .28 },
                  { label: 'Rejections', data: model.monthlyTrend.map((item) => item.rejections), borderColor: '#c45d50', backgroundColor: 'transparent', tension: .28 },
                ],
              }}
            />
          )}
        </ChartFrame>
      </Panel>
      <Panel className="report-panel--span-4" eyebrow="Terminal outcomes" title="Status distribution" subtitle="Current application status in the selected scope">
        {model.outcomes.statuses.length === 0 ? <UnavailableSection label="Status distribution" /> : <ChartFrame><Doughnut options={doughnutOptions} data={doughnutData(model.outcomes.statuses)} /></ChartFrame>}
      </Panel>
      <Panel className="report-panel--span-4" eyebrow="Risk cross-section" title="Outcome mix by risk band" subtitle="Assessment band is not inferred when unavailable">
        {model.outcomes.riskCrossSection.length === 0 ? <UnavailableSection label="Outcome by risk band" /> : <BreakdownList rows={model.outcomes.riskCrossSection} />}
      </Panel>
      <Panel className="report-panel--span-8" eyebrow="Rejection analysis" title="Why applications did not reach approval" subtitle="Reason taxonomy is only shown when supplied by the source workflow">
        {model.unavailableSections.includes('Rejection taxonomy') ? <UnavailableSection label="Rejection reasons" /> : (
          <DataTable headers={['Reason', 'Count', 'Share']} rows={model.outcomes.rejections.map((item) => [item.label, formatNumber(item.value), item.percentage === undefined ? 'Data Not Available' : percent(item.percentage)])} />
        )}
      </Panel>
      <Panel className="report-panel--span-12" eyebrow="Review speed" title="Turnaround by review stage" subtitle="Durations are calculated only where both timestamps exist">
        {model.outcomes.durations.length === 0 ? <UnavailableSection label="Review turnaround" /> : (
          <DataTable headers={['Stage', 'Average', 'Range', 'Sample']} rows={model.outcomes.durations.map((item) => [item.label, item.average, item.min + ' – ' + item.max, formatNumber(item.sample)])} />
        )}
      </Panel>
    </div>
  );
}

function RiskAssessmentView({ model }: { model: ReportModel }) {
  const assessment = model.assessment;
  return (
    <div className="report-content-grid">
      <Panel className="report-panel--span-4" eyebrow="Official result" title="Risk distribution" subtitle="Latest valid assessment band; missing is not classified as Low">
        {assessment.riskDistribution.every((item) => item.value === 0) ? <UnavailableSection label="Risk distribution" /> : <ChartFrame><Doughnut options={doughnutOptions} data={doughnutData(assessment.riskDistribution)} /></ChartFrame>}
      </Panel>
      <Panel className="report-panel--span-4" eyebrow="Hazard signals" title="Most frequent hazard categories" subtitle="All identified hazard-category occurrences across eligible assessments">
        {assessment.hazards.length === 0 ? <UnavailableSection label="Hazard categories" /> : <BreakdownList rows={assessment.hazards} showValues />}
      </Panel>
      <Panel className="report-panel--span-4" eyebrow="Dominant signal" title="Dominant hazard categories" subtitle="Highest-scoring category per eligible official assessment">
        {assessment.dominantHazards.length === 0 ? <UnavailableSection label="Dominant hazard categories" /> : <BreakdownList rows={assessment.dominantHazards} showValues />}
      </Panel>
      <Panel className="report-panel--span-3" eyebrow="Readiness gate" title="Assessment readiness" subtitle="Evidence and context completeness">
        {assessment.readiness.length === 0 ? <UnavailableSection label="Assessment readiness" /> : <BreakdownList rows={assessment.readiness} />}
      </Panel>
      <Panel className="report-panel--span-3" eyebrow="Compliance gate" title="Compliance result" subtitle="Deterministic checks before officialisation">
        {assessment.compliance.length === 0 ? <UnavailableSection label="Compliance result" /> : <BreakdownList rows={assessment.compliance} />}
      </Panel>
      <Panel className="report-panel--span-3" eyebrow="Confidence" title="Data confidence" subtitle="Confidence level attached to the latest assessment">
        {assessment.confidence.length === 0 ? <UnavailableSection label="Data confidence" /> : <BreakdownList rows={assessment.confidence} />}
      </Panel>
      <Panel className="report-panel--span-3" eyebrow="Review signals" title="Hard rules & manual review" subtitle="Monitoring indicators, not new decisions">
        <div className="mini-stat-grid">
          <div><span>Hard-rule adjustments</span><strong>{formatNumber(assessment.hardRuleAdjustments)}</strong></div>
          <div><span>Manual reviews</span><strong>{formatNumber(assessment.manualReviews)}</strong></div>
        </div>
        <div className="report-callout report-callout--info mt-5"><CircleHelp size={16} /><span>AI agreement is measured only against comparable M3 category validations.</span></div>
      </Panel>
    </div>
  );
}

function ResourceOverrideView({ model }: { model: ReportModel }) {
  const overrideUnavailable = model.unavailableSections.includes('Resource overrides');
  const recommendationUnavailable = model.unavailableSections.includes('Resource recommendations');
  return (
    <div className="report-content-grid">
      <Panel className="report-panel--span-8" eyebrow="Override signal" title="Resource override rate by category" subtitle="Authority changes compared with the M2 baseline">
        {overrideUnavailable ? <UnavailableSection label="Resource override rates" /> : (
          <ChartFrame>
            <Bar
              options={{ ...chartOptions, indexAxis: 'y', scales: { x: { beginAtZero: true, max: 1, ticks: { callback: (value: number) => Math.round(value * 100) + '%' } }, y: { grid: { display: false } } } }}
              data={{ labels: model.resources.map((item) => item.label), datasets: [{ label: 'Override rate', data: model.resources.map((item) => item.overrideRate ?? 0), backgroundColor: '#d3a32e', borderRadius: 5, barThickness: 18 }] }}
            />
          </ChartFrame>
        )}
      </Panel>
      <Panel className="report-panel--span-4" eyebrow="Source boundary" title="Planning assumptions" subtitle="Baseline and range remain traceable to M2 source records">
        {recommendationUnavailable ? <UnavailableSection label="Resource planning data" /> : (
          <div className="metric-stack">
            <MetricLine label="Planning items" value={formatNumber(model.resources.length)} />
            <MetricLine label="Total override records" value={overrideUnavailable || model.resourceOverrideRecords === null ? 'Data Not Available' : formatNumber(model.resourceOverrideRecords)} tone="warning" />
            <MetricLine label="Source-owned range" value="M2" />
            <div className="report-callout report-callout--warning"><TriangleAlert size={16} /><span>M5 reports overrides; it does not recalculate recommended quantities.</span></div>
          </div>
        )}
      </Panel>
      <Panel className="report-panel--span-12" eyebrow="Resource detail" title="Baseline, planning range & override reasons" subtitle="No private authority notes are included">
        {recommendationUnavailable ? <UnavailableSection label="Resource recommendation detail" /> : (
          <DataTable headers={['Resource', 'Recommendation baseline', 'Comparable baseline', 'Effective quantity', 'Planning range', 'Overrides', 'Rate', 'Reason']} rows={model.resources.map((item) => [item.label, `${formatNumber(item.baseline)} (n=${formatNumber(item.recommendationSample)})`, item.comparableBaseline === null ? 'Data Not Available' : `${formatNumber(item.comparableBaseline)} (n=${formatNumber(item.overrideSample)})`, item.effective === null ? 'Data Not Available' : `${formatNumber(item.effective)} (n=${formatNumber(item.overrideSample)})`, item.range, item.overrides === null ? 'Data Not Available' : formatNumber(item.overrides), item.overrideRate === null ? 'Data Not Available' : percent(item.overrideRate), item.reason])} />
        )}
      </Panel>
    </div>
  );
}

function ControlComplianceView({ model }: { model: ReportModel }) {
  const unavailable = model.unavailableSections.includes('Stage 1 document verification');
  return (
    <div className="report-content-grid">
      <Panel className="report-panel--span-4" eyebrow="Control state" title="Verification status" subtitle="Current M3 event-control records">
        {unavailable ? <UnavailableSection label="Event-control verification" /> : <ChartFrame><Doughnut options={doughnutOptions} data={doughnutData(model.controls.statuses)} /></ChartFrame>}
      </Panel>
      <Panel className="report-panel--span-8" eyebrow="Completion" title="Verification progress" subtitle="Verified items divided by eligible control items">
        {unavailable ? <UnavailableSection label="Verification rate" /> : (
          <div className="progress-card">
            <div className="progress-card__value">{percent(model.controls.verifiedRate)}</div>
            <div className="progress-track"><span style={{ width: Math.min(100, model.controls.verifiedRate * 100) + '%' }} /></div>
            <div className="mt-3 flex items-center justify-between text-xs text-ink-500"><span>{formatNumber(model.controls.totalItems)} eligible control items</span><span>Source: M3</span></div>
          </div>
        )}
      </Panel>
      <Panel className="report-panel--span-12" eyebrow="Control detail" title="Status counts" subtitle="Missing control state remains unavailable rather than being treated as pending">
        {unavailable ? <UnavailableSection label="Control status counts" /> : (
          <DataTable headers={['Status', 'Items', 'Share']} rows={model.controls.statuses.map((item) => [item.label, formatNumber(item.value), item.percentage === undefined ? 'Data Not Available' : percent(item.percentage)])} />
        )}
      </Panel>
      <Panel className="report-panel--span-12" eyebrow="Interpretation" title="How to read this report" subtitle="Module 5 remains descriptive and read-only">
        <div className="report-callout report-callout--info"><CheckCircle2 size={17} /><span>Use Previous is reported as an explicit source status. It is not silently merged into verified or pending.</span></div>
      </Panel>
    </div>
  );
}

function DefinitionsPanel({ definitions }: { definitions: MetricDefinition[] }) {
  return (
    <section className="definitions-panel mt-6">
      <div className="definitions-panel__heading">
        <div>
          <p className="report-kicker">Trust layer</p>
          <h2>Metric definitions &amp; availability rules</h2>
          <p>Every number has a source boundary. Missing values remain visible as <strong>Data Not Available</strong>.</p>
        </div>
        <div className="definitions-panel__privacy"><LockKeyhole size={15} /> No PII in report output</div>
      </div>
      <div className="overflow-x-auto">
        <table className="report-table report-table--definitions">
          <thead><tr><th>Metric</th><th>Formula</th><th>Denominator</th><th>Unavailable rule</th></tr></thead>
          <tbody>{definitions.map((item) => <tr key={item.metric}><td className="font-semibold text-ink-800">{item.metric}</td><td>{item.formula}</td><td>{item.denominator}</td><td>{item.unavailable}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="definitions-panel__footer">
        <span><ShieldCheck size={15} /> Read-only analytics · source records are never changed</span>
        <span><FileText size={15} /> CSV and PDF exports include scope, date, coverage, source, and privacy metadata</span>
      </div>
    </section>
  );
}

function Panel({ eyebrow, title, subtitle, children, className = '' }: { eyebrow: string; title: string; subtitle: string; children: ReactNode; className?: string }) {
  return (
    <section className={'report-panel ' + className}>
      <div className="report-panel__heading">
        <div><p className="report-kicker">{eyebrow}</p><h3>{title}</h3><p>{subtitle}</p></div>
      </div>
      <div className="report-panel__body">{children}</div>
    </section>
  );
}

function ChartFrame({ children }: { children: ReactNode }) {
  return <div className="report-chart-frame">{children}</div>;
}

function SummaryCard({ metric }: { metric: ReportMetric }) {
  return (
    <article className={'summary-card summary-card--' + (metric.tone ?? 'neutral')}>
      <div className="summary-card__top"><span>{metric.label}</span><span className="summary-card__dot" /></div>
      <strong>{metric.value}</strong>
      <p>{metric.detail}</p>
    </article>
  );
}

function BreakdownList({ title, rows, showValues = false }: { title?: string; rows: BreakdownRow[]; showValues?: boolean }) {
  if (rows.length === 0) return <UnavailableSection label={title ?? 'Breakdown'} />;
  return (
    <div className="breakdown-list">
      {title && <div className="breakdown-list__title">{title}</div>}
      {rows.map((item) => {
        const ratio = ratioFor(item, rows);
        return (
          <div className="breakdown-item" key={item.label}>
            <div className="breakdown-item__label"><span>{item.label}</span>{showValues && <span>{formatNumber(item.value)}</span>}</div>
            <div className="breakdown-item__track"><span style={{ width: Math.max(2, ratio * 100) + '%', backgroundColor: item.color ?? '#77925a' }} /></div>
            <div className="breakdown-item__meta"><span>{percent(ratio)}</span>{!showValues && <span>{formatNumber(item.value)}</span>}</div>
          </div>
        );
      })}
    </div>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: Array<Array<string | number>> }) {
  if (rows.length === 0) return <UnavailableSection label="Table data" />;
  return (
    <div className="overflow-x-auto">
      <table className="report-table">
        <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{rows.map((row, rowIndex) => <tr key={String(row[0]) + '-' + rowIndex}>{row.map((cell, cellIndex) => <td key={String(cell) + '-' + cellIndex}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function UnavailableSection({ label }: { label: string }) {
  return (
    <div className="unavailable-section">
      <div className="unavailable-section__icon"><Database size={17} /></div>
      <div><strong>Data Not Available</strong><p>{label} is not present in the current source records.</p></div>
    </div>
  );
}

function MetricLine({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'warning' }) {
  return <div className="metric-line"><span>{label}</span><strong className={tone === 'warning' ? 'text-gold-600' : ''}>{value}</strong></div>;
}

function MetaStat({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return <div className="reports-hero__stat"><span className="reports-hero__stat-icon">{icon}</span><span><small>{label}</small><strong>{value}</strong></span></div>;
}

function CoverageValue({ label }: { label: string }) {
  const separator = ' – ';
  const separatorIndex = label.indexOf(separator);
  if (separatorIndex === -1) return <span className="reports-hero__coverage-value">{label}</span>;

  const from = label.slice(0, separatorIndex);
  const to = label.slice(separatorIndex + separator.length);
  return (
    <span className="reports-hero__coverage-value" aria-label={label}>
      <span>{from}</span>
      <span>{separator + to}</span>
    </span>
  );
}

function StatusChip({ status }: { status: ReportModel['dataStatus'] }) {
  const label = status === 'complete' ? 'Complete coverage' : status === 'partial' ? 'Partial availability' : 'Unavailable';
  return <span className={'status-chip status-chip--' + status}><i /> {label}</span>;
}

function ReportGlyph({ type }: { type: ReportType }) {
  if (type === 'risk-incident') return <TriangleAlert size={18} />;
  if (type === 'application-outcome') return <BarChart3 size={18} />;
  if (type === 'risk-assessment') return <Gauge size={18} />;
  if (type === 'resource-override') return <Users size={18} />;
  return <CheckCircle2 size={18} />;
}

function selectRecords(records: AnalyticsRecord[], scope: AnalysisScope, eventType: EventType | undefined, from: string, to: string) {
  return filterAnalyticsRecords(records, from, to).filter((record) => scope === 'overall' || record.eventType === eventType);
}

function doughnutData(rows: BreakdownRow[]) {
  const colors = rows.map((row) => row.color ?? '#77925a');
  return { labels: rows.map((row) => row.label), datasets: [{ data: rows.map((row) => row.value), backgroundColor: colors, borderWidth: 0, hoverOffset: 5 }] };
}

function ratioFor(row: BreakdownRow, rows: BreakdownRow[]) {
  if (row.percentage !== undefined && row.percentage >= 0 && row.percentage <= 1) return row.percentage;
  const total = rows.reduce((sum, item) => sum + item.value, 0);
  return total === 0 ? 0 : row.value / total;
}

function percentageForRow(rows: BreakdownRow[], label: string) {
  const value = findRow(rows, label)?.percentage;
  return value === undefined ? 'Data Not Available' : percent(value);
}

function findRow(rows: BreakdownRow[], label: string) {
  return rows.find((row) => row.label.toLowerCase() === label.toLowerCase());
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-MY').format(value);
}

function percent(value: number) {
  if (!Number.isFinite(value)) return 'Data Not Available';
  return (value * 100).toFixed(value * 100 < 10 ? 1 : 0) + '%';
}

function formatMonth(month: string) {
  return new Intl.DateTimeFormat('en-MY', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(month + '-01T00:00:00Z'));
}

function formatDateTime(timestamp: number) {
  return new Intl.DateTimeFormat('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(timestamp));
}

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
