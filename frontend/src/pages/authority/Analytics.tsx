import { useEffect, useState } from 'react';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { Bar, Pie, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { COLLECTIONS, RiskScoreRecord } from '@shared/types';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement, Title, Tooltip, Legend);

export default function Analytics() {
  const [riskScores, setRiskScores] = useState<RiskScoreRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }
    // Note: collectionGroup query would be more efficient, but reading all
    // risk_scores sub-collections across events is the simpler MVP approach.
    // Module 5 owner should optimize this with aggregation queries or
    // denormalized analytics collection.
    const q = query(collection(db, COLLECTIONS.RISK_SCORES));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRiskScores(snap.docs.map((d) => d.data() as RiskScoreRecord));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, []);

  if (loading) return <div className="text-slate-500">Loading…</div>;
  if (riskScores.length === 0) {
    return (
      <div>
        <PageHeader title="Analytics" description="Trends in event submissions, risk distribution, and AI vs rule agreement rate." />
        <EmptyState
          title="No data yet"
          description="Once Cloud Functions run on a few events, charts will populate here. Seed data is in functions/src/seed/."
        />
      </div>
    );
  }

  // ----- Aggregations -----
  const agreementCounts = riskScores.reduce(
    (acc, r) => {
      acc[r.disagreementFlag ? 'disagree' : 'agree']++;
      return acc;
    },
    { agree: 0, disagree: 0 },
  );

  const riskLevelCounts = riskScores.reduce(
    (acc, r) => {
      acc[r.ai.riskLevel]++;
      return acc;
    },
    { Low: 0, Medium: 0, High: 0 },
  );

  // Average risk score per day
  const byDay = new Map<string, { ai: number[]; rule: number[] }>();
  riskScores.forEach((r) => {
    const d = new Date(r.createdAt).toISOString().slice(0, 10);
    const e = byDay.get(d) ?? { ai: [], rule: [] };
    e.ai.push(r.ai.riskScore);
    e.rule.push(r.rule.total);
    byDay.set(d, e);
  });
  const days = Array.from(byDay.keys()).sort();
  const avgAi = days.map((d) => byDay.get(d)!.ai.reduce((a, b) => a + b, 0) / byDay.get(d)!.ai.length);
  const avgRule = days.map((d) => byDay.get(d)!.rule.reduce((a, b) => a + b, 0) / byDay.get(d)!.rule.length);

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Trends in event submissions, risk distribution, and AI vs rule agreement rate."
      />

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <div className="card-header"><h3 className="font-semibold">AI vs Rule-based agreement</h3></div>
          <div className="card-body">
            <Pie
              data={{
                labels: ['Agree', 'Disagree'],
                datasets: [
                  {
                    data: [agreementCounts.agree, agreementCounts.disagree],
                    backgroundColor: ['#10b981', '#ef4444'],
                  },
                ],
              }}
              options={{ responsive: true, plugins: { legend: { position: 'bottom' } } }}
            />
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3 className="font-semibold">Risk level distribution (AI)</h3></div>
          <div className="card-body">
            <Bar
              data={{
                labels: ['Low', 'Medium', 'High'],
                datasets: [
                  {
                    label: 'Events',
                    data: [riskLevelCounts.Low, riskLevelCounts.Medium, riskLevelCounts.High],
                    backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
                  },
                ],
              }}
              options={{ responsive: true, plugins: { legend: { display: false } } }}
            />
          </div>
        </div>

        <div className="card md:col-span-2">
          <div className="card-header"><h3 className="font-semibold">Average risk score over time</h3></div>
          <div className="card-body">
            <Line
              data={{
                labels: days,
                datasets: [
                  { label: 'AI', data: avgAi, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)' },
                  { label: 'Rule-based', data: avgRule, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)' },
                ],
              }}
              options={{ responsive: true }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
