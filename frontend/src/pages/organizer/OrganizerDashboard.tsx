import { Link } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import { useAuth } from '../../contexts/AuthContext';

export default function OrganizerDashboard() {
  const { profile } = useAuth();
  return (
    <div>
      <PageHeader
        title={`Welcome, ${profile?.name ?? 'Organizer'}`}
        description="Submit a new event application or check the status of your existing submissions."
      />
      <div className="grid sm:grid-cols-2 gap-4">
        <Link to="/organizer/events/new" className="card hover:shadow-md transition-shadow">
          <div className="card-body">
            <h3 className="font-semibold text-slate-900">+ New Event Application</h3>
            <p className="mt-1 text-sm text-slate-600">Submit details for AI + rule-based risk assessment.</p>
          </div>
        </Link>
        <Link to="/organizer/events" className="card hover:shadow-md transition-shadow">
          <div className="card-body">
            <h3 className="font-semibold text-slate-900">My Events</h3>
            <p className="mt-1 text-sm text-slate-600">Track status: Pending, Under Review, Approved, Rejected, or Amendment Requested.</p>
          </div>
        </Link>
      </div>
      <div className="mt-6">
        <EmptyState
          title="Module 1 in progress"
          description="The event submission form (Module 1) is a placeholder here. The Requirement Lead will fill in the form fields and Firestore wiring per PRD §4."
        />
      </div>
    </div>
  );
}
