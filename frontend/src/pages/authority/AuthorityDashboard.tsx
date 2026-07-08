import { Link } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import { useAuth } from '../../contexts/AuthContext';

export default function AuthorityDashboard() {
  const { profile } = useAuth();
  return (
    <div>
      <PageHeader
        title={`Authority Dashboard — ${profile?.authorityType ?? ''}`}
        description="Review pending event applications, view analytics, and monitor risk distribution."
      />
      <div className="grid sm:grid-cols-3 gap-4">
        <Link to="/authority/queue" className="card hover:shadow-md transition-shadow">
          <div className="card-body">
            <h3 className="font-semibold text-slate-900">Review Queue</h3>
            <p className="mt-1 text-sm text-slate-600">Real-time list of pending applications. Updates push live.</p>
          </div>
        </Link>
        <Link to="/authority/analytics" className="card hover:shadow-md transition-shadow">
          <div className="card-body">
            <h3 className="font-semibold text-slate-900">Analytics</h3>
            <p className="mt-1 text-sm text-slate-600">Trends, AI vs rule agreement rate, risk distribution.</p>
          </div>
        </Link>
        <div className="card">
          <div className="card-body">
            <h3 className="font-semibold text-slate-900">My Profile</h3>
            <p className="mt-1 text-sm text-slate-600">{profile?.name} · {profile?.authorityType}</p>
            <p className="mt-1 text-xs text-slate-500">{profile?.email}</p>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <EmptyState
          title="Modules 4 + 5 — base UI in place"
          description="The Review Queue, AI+Rule side-by-side comparison, and decision workflow live here. Module 5 (analytics charts) is wired but reads aggregate data once Cloud Functions populate it."
        />
      </div>
    </div>
  );
}
