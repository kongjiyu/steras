import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { Bar, Line } from 'react-chartjs-2';
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { Download, RotateCcw } from 'lucide-react';
import { COLLECTIONS, EventRecord, RiskAssessment } from '@shared/types';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { useAuth } from '../../contexts/AuthContext';
import EmptyState from '../../components/ui/EmptyState';
import PageHeader from '../../components/ui/PageHeader';
import {
  AnalyticsRecord,
  analyticsCsv,
  analyticsSummary,
  average,
  buildMonthlyAnalytics,
  filterAnalyticsRecords,
  riskDistribution,
} from './analyticsData';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend);

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'bottom' as const, labels: { usePointStyle: true, boxWidth: 8 } } },
  scales: { y: { beginAtZero: true, grid: { color: '#eee8dc' } }, x: { grid: { display: false } } },
};

export default function Analytics() {
  const { profile } = useAuth();
  const [records, setRecords] = useState<AnalyticsRecord[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!isFirebaseConfigured || !profile?.authorityType) {
      setLoading(false);
      return;
    }
    let request = 0;
    const eventsQuery = query(
      collection(db, COLLECTIONS.EVENTS),
      where('requiredAuthorities', 'array-contains', profile.authorityType),
    );
    return onSnapshot(eventsQuery, async (snapshot) => {
      const currentRequest = ++request;
      try {
        const nextRecords = await Promise.all(snapshot.docs.map(async (eventDocument) => {
          const event = { eventId: eventDocument.id, ...eventDocument.data() } as EventRecord;
          let assessment: RiskAssessment | undefined;
          if (event.currentAssessmentId) {
            const assessmentDocument = await getDoc(doc(db, COLLECTIONS.EVENTS, event.eventId, COLLECTIONS.ASSESSMENTS, event.currentAssessmentId));
            const value = assessmentDocument.data();
            if (value?.status === 'ready') assessment = value as RiskAssessment;
          }
          return {
            eventId: event.eventId,
            eventName: event.eventDetails.name,
            eventType: event.eventDetails.type,
            status: event.status,
            createdAt: event.createdAt,
            submittedAt: event.submittedAt,
            updatedAt: event.updatedAt,
            assessment,
          } satisfies AnalyticsRecord;
        }));
        if (currentRequest === request) {
          setRecords(nextRecords);
          setError('');
          setLoading(false);
        }
      } catch {
        setError('Analytics data could not be loaded.');
        setLoading(false);
      }
    }, () => {
      setError('Analytics data could not be loaded.');
      setLoading(false);
    });
  }, [profile?.authorityType, retryKey]);

  const filtered = useMemo(() => filterAnalyticsRecords(records, from, to), [records, from, to]);
  const monthly = useMemo(() => buildMonthlyAnalytics(filtered), [filtered]);
  const summary = useMemo(() => analyticsSummary(filtered), [filtered]);
  const risks = useMemo(() => riskDistribution(filtered), [filtered]);
  const labels = monthly.map((item) => formatMonth(item.month));

  const exportCsv = () => {
    const blob = new Blob([analyticsCsv(filtered)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `steras-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-5 sm:p-8">
      <PageHeader
        eyebrow="Authority workspace"
        title="Reports"
        description={`${profile?.authorityType ?? 'Authority'} portfolio · PII-safe operational analytics`}
        action={<button type="button" className="btn-secondary" disabled={filtered.length === 0} onClick={exportCsv}><Download size={16} /> Export CSV</button>}
      />

      <div className="mb-6 flex flex-col gap-3 border-y border-[#ded4c1] py-4 sm:flex-row sm:items-end">
        <label className="text-xs font-semibold text-ink-600">From
          <input type="date" className="input mt-1 sm:w-44" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="text-xs font-semibold text-ink-600">To
          <input type="date" className="input mt-1 sm:w-44" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
        </label>
        {(from || to) && <button type="button" className="btn-secondary" onClick={() => { setFrom(''); setTo(''); }}><RotateCcw size={15} /> Reset</button>}
      </div>

      {loading ? <div className="py-20 text-center text-ink-500">Loading reports...</div> : error ? (
        <EmptyState title="Reports unavailable" description={error}><button type="button" className="btn-secondary" onClick={() => { setLoading(true); setRetryKey((value) => value + 1); }}>Try again</button></EmptyState>
      ) : records.length === 0 ? (
        <EmptyState title="No assigned applications" description="Reports will appear after applications are assigned to your agency." />
      ) : filtered.length === 0 ? (
        <EmptyState title="No data in this period" description="Adjust the date range to include assigned applications." />
      ) : (
        <>
          <section aria-label="Analytics summary" className="mb-7 grid grid-cols-2 gap-x-6 gap-y-5 border-b border-[#ded4c1] pb-7 lg:grid-cols-5">
            <Summary label="Applications" value={summary.applications} />
            <Summary label="Approved" value={summary.approved} />
            <Summary label="Avg adjustment" value={`+${summary.averageAdjustment.toFixed(1)}`} />
            <Summary label="M3 fallback" value={`${(summary.fallbackRate * 100).toFixed(0)}%`} />
            <Summary label="Avg turnaround" value={`${summary.averageTurnaroundHours.toFixed(1)}h`} />
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Chart title="Applications and approvals by month" subtitle="Created applications compared with completed approvals" wide>
              <Bar options={chartOptions} data={{ labels, datasets: [
                { label: 'Applications', data: monthly.map((item) => item.applications), backgroundColor: '#627820' },
                { label: 'Approvals', data: monthly.map((item) => item.approvals), backgroundColor: '#c99425' },
              ] }} />
            </Chart>
            <Chart title="Final risk distribution" subtitle="Assessed applications by final risk level">
              <Bar options={{ ...chartOptions, plugins: { legend: { display: false } } }} data={{ labels: ['Low', 'Medium', 'High'], datasets: [{ label: 'Applications', data: [risks.Low, risks.Medium, risks.High], backgroundColor: ['#5f8d48', '#d39b2a', '#c84a3d'] }] }} />
            </Chart>
            <Chart title="Baseline versus final score" subtitle="Monthly averages after validated M3 adjustment">
              <Line options={chartOptions} data={{ labels, datasets: [
                { label: 'Baseline', data: monthly.map((item) => average(item.baselines)), borderColor: '#77715f', backgroundColor: '#77715f', tension: 0.25 },
                { label: 'Final', data: monthly.map((item) => average(item.finals)), borderColor: '#627820', backgroundColor: '#627820', tension: 0.25 },
              ] }} />
            </Chart>
          </div>
        </>
      )}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string | number }) {
  return <div><p className="text-xs font-semibold uppercase text-ink-500">{label}</p><p className="mt-1 font-display text-2xl font-bold text-ink-800">{value}</p></div>;
}

function Chart({ title, subtitle, wide, children }: { title: string; subtitle: string; wide?: boolean; children: React.ReactNode }) {
  return <section className={`card overflow-hidden ${wide ? 'lg:col-span-2' : ''}`}><div className="card-header block"><h2 className="font-semibold">{title}</h2><p className="mt-1 text-xs text-ink-500">{subtitle}</p></div><div className="h-72 p-5">{children}</div></section>;
}

function formatMonth(month: string): string {
  return new Intl.DateTimeFormat('en-MY', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
}
