import { Link } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader';

export default function PublicHome() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 to-white">
      {/* Hero */}
      <header className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded bg-brand-600 text-white flex items-center justify-center font-bold">S</div>
          <span className="font-bold text-slate-900 text-lg">STERAS</span>
        </div>
        <nav className="flex items-center gap-3">
          <Link to="/calendar" className="text-sm font-medium text-slate-700 hover:text-slate-900">
            Public Calendar
          </Link>
          <Link to="/login" className="btn-secondary !py-1.5">Sign in</Link>
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <PageHeader
          title="Safer Tourism Events, Faster Approvals"
          description="STERAS uses AI prediction + rule-based risk assessment to help Malaysian authorities (PDRM, Bomba, KKM, DBKL) review and approve tourism event permits with confidence."
        />

        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/calendar" className="btn-primary">View Approved Events</Link>
          <Link to="/register" className="btn-secondary">Organizer Sign-up</Link>
        </div>

        {/* 3 pillars */}
        <div className="mt-16 grid md:grid-cols-3 gap-6">
          {[
            {
              title: 'Hybrid AI + Rule-Based',
              body: 'AI prediction paired with deterministic rule-based scoring. If they disagree by ≥15 points, the application is flagged for manual review.',
            },
            {
              title: 'Real-time Dashboard',
              body: 'Authority officers see new applications the moment they\'re submitted. No refresh needed — Firestore listeners push updates live.',
            },
            {
              title: 'Standards-traced Resources',
              body: 'Recommended police, medical, ambulance and toilet counts reference WHO Mass Gathering Guidelines, PDRM and Bomba benchmarks.',
            },
          ].map((f) => (
            <div key={f.title} className="card">
              <div className="card-body">
                <h3 className="font-semibold text-slate-900">{f.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{f.body}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-16 text-center text-xs text-slate-500">
          STERAS v0.1.0 — Prototype for Visit Malaysia 2026 · Module integration in progress
        </p>
      </main>
    </div>
  );
}
