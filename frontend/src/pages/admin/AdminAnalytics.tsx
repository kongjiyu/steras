import { ShieldCheck, ChartLine } from 'lucide-react';
import { WorkspaceTopBar } from '../../components/layout/Sidebar';
import { useAuth } from '../../contexts/AuthContext';

function initialsFor(name?: string) {
  if (!name) return 'AD';
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

const REPORTS = [
  { id: 'risk-incident', title: 'Event Risk & Incident Analysis', desc: 'Risk-level distribution, incident counts, severity, immediate-action requirements, escalation outcomes (FR-M5-05).' },
  { id: 'application-outcome', title: 'Application Outcome & Rejection Analysis', desc: 'Application counts by status and risk; rejection reasons by stage; processing durations (FR-M5-06 to FR-M5-09).' },
  { id: 'risk-assessment', title: 'Risk Assessment Analysis', desc: 'Risk-level distribution, hazards, readiness, compliance, confidence, manual-review cases (FR-M5-10).' },
  { id: 'safety-resource', title: 'Safety Resource & Override Analysis', desc: 'Resource baselines, planning ranges, authority overrides, original/revised values, override rates (FR-M5-11, FR-M5-12).' },
  { id: 'control-compliance', title: 'Event Control Compliance Analysis', desc: 'Control items by status: pending submission, pending verification, verified, rejected, exempted (FR-M5-13).' },
];

export default function AdminAnalytics() {
  const { profile } = useAuth();
  return (
    <div className="min-h-screen bg-[#f3f1e9] pb-16">
      <WorkspaceTopBar
        title="Analytics & reporting"
        subtitle="M5 — admin-only (FR-M5-01). Privacy-filtered reports (FR-M5-19). Read-only (FR-M5-20)."
        userInitials={initialsFor(profile?.name)}
        workspaceEyebrow="STERAS administration"
        workspaceEyebrowIcon={ShieldCheck}
      />
      <main className="page-shell page-enter">
        <p className="mb-4 text-sm text-ink-500">
          Select a report type. All reports can be generated with <strong>Overall</strong> or
          <strong> By Event Type</strong> scope (FR-M5-03) and exported to PDF / CSV (FR-M5-17, FR-M5-18).
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {REPORTS.map((r) => (
            <button
              key={r.id}
              type="button"
              className="admin-report-card group flex items-start gap-3 rounded-lg border border-[#ded5c5] bg-white p-4 text-left shadow-card transition hover:border-[#b5bd98] hover:shadow-card-hover"
            >
              <ChartLine size={20} className="mt-0.5 text-brand-700" />
              <div>
                <p className="font-semibold text-ink-900">{r.title}</p>
                <p className="mt-1 text-xs leading-5 text-ink-600">{r.desc}</p>
              </div>
            </button>
          ))}
        </div>
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-700">
          Report generation UI is a stub in this build. Wire-up will use the existing
          <code className="mx-1 rounded bg-amber-100 px-1">analyticsData.ts</code> helpers
          against Firestore, then render with the same chart components as the authority view.
        </p>
      </main>
    </div>
  );
}
