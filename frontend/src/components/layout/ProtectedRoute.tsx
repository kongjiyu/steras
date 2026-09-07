import { ReactNode, useState } from 'react';
import toast from 'react-hot-toast';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { UserRole } from '@shared/types';
import { getRoleHome } from '../../routing';

interface Props {
  children: ReactNode;
  requiredRole?: UserRole;
}

export default function ProtectedRoute({ children, requiredRole }: Props) {
  const { user, profile, loading, configured, signOut, refreshProfile, profileError } = useAuth();
  const [busy, setBusy] = useState(false);
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
            <p className="mt-2 text-sm leading-6 text-ink-500" role="alert">{profileError || 'Your sign-in exists, but no workspace profile is assigned. Contact the project administrator.'}</p>
            <button type="button" className="btn-primary mt-5 mr-3" disabled={busy} onClick={async () => { setBusy(true); try { await refreshProfile(); } finally { setBusy(false); } }}>{busy ? 'Trying again...' : 'Try again'}</button>
            <button type="button" className="btn-secondary mt-5" disabled={busy} onClick={async () => { try { await signOut(); } catch { toast.error('Sign out failed. Please try again.'); } }}>Sign out</button>
          </div>
        </section>
      </main>
    );
  }

  if (requiredRole && profile.role !== requiredRole) {
    // Wrong role — redirect to that role's home if known, otherwise login.
    const home = getRoleHome(profile.role);
    return <Navigate to={home ?? '/login'} replace />;
  }

  return <>{children}</>;
}
