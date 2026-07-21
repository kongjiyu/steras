import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { UserRole } from '@shared/types';

interface Props {
  children: ReactNode;
  requiredRole?: UserRole;
}

export default function ProtectedRoute({ children, requiredRole }: Props) {
  const { user, profile, loading, configured, signOut } = useAuth();
  const location = useLocation();

  if (!configured) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="card max-w-md w-full">
          <div className="card-body text-center">
            <h2 className="text-lg font-semibold mb-2">Firebase Not Configured</h2>
            <p className="text-sm text-slate-600 mb-3">
              Copy <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">frontend/.env.example</code> to <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">frontend/.env</code> and fill in your Firebase project credentials.
            </p>
            <p className="text-xs text-slate-500">See README.md → Setup for details.</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!profile) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-cream-50 p-6">
        <section className="card w-full max-w-md" aria-labelledby="profile-missing-title">
          <div className="card-body text-center">
            <h1 id="profile-missing-title" className="font-display text-xl font-bold text-ink-800">Workspace profile unavailable</h1>
            <p className="mt-2 text-sm leading-6 text-ink-500">Your sign-in exists, but no organizer or authority profile is assigned. Contact the project administrator.</p>
            <button type="button" className="btn-secondary mt-5" onClick={() => void signOut()}>Sign out</button>
          </div>
        </section>
      </main>
    );
  }

  if (requiredRole && profile.role !== requiredRole) {
    // Wrong role — redirect to that role's home if known, otherwise login.
    if (profile?.role === 'organizer') return <Navigate to="/organizer" replace />;
    if (profile?.role === 'authority') return <Navigate to="/authority" replace />;
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
