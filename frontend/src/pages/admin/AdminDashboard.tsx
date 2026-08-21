import { useNavigate } from 'react-router-dom';
import { ShieldCheck, LogOut, Mail, CalendarDays, Hash } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import logoUrl from '../../assets/brand/steras-logo-horizontal.svg';
import { Link } from 'react-router-dom';
import ScoreConflictQueue from './ScoreConflictQueue';

/**
 * STERAS — Admin Dashboard (stub)
 * =====================================================================
 * Single-admin view. Confirms the signed-in account has the `admin`
 * role, shows the admin's profile, and provides a sign-out.
 *
 * Future admin tooling (user management, audit log search, system
 * metrics, etc.) can be added on top of this shell.
 * =====================================================================
 */
export default function AdminDashboard() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const createdAt = profile?.createdAt ? new Date(profile.createdAt) : null;
  const createdAtLabel = createdAt
    ? createdAt.toLocaleString('en-MY', {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'Asia/Kuala_Lumpur',
      })
    : '—';

  return (
    <div className="min-h-screen bg-cream-50">
      {/* Top bar — minimal, no nav links for the single-admin stub */}
      <header className="border-b border-[#ddd3c2] bg-[#fffdf8]/95 backdrop-blur-sm">
        <div className="mx-auto max-w-[1440px] px-5 sm:px-8">
          <div className="flex min-h-[72px] items-center justify-between gap-4">
            <Link to="/admin" className="flex shrink-0 items-center" aria-label="STERAS admin home">
              <img src={logoUrl} alt="STERAS" className="h-auto w-36 object-contain sm:w-40" />
            </Link>
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-amber-800">
              <ShieldCheck size={14} /> Admin
            </span>
            <button onClick={handleSignOut} className="btn-secondary !px-3" title="Sign out">
              <LogOut size={14} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
        <p className="page-eyebrow">Workspace</p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.025em] text-ink-900">Admin Dashboard</h1>
        <p className="mt-2 text-sm leading-6 text-ink-500">
          You are signed in as the STERAS project administrator. This workspace grants
          server-provisioned read access across the platform for operational tasks.
        </p>

        {/* Profile card */}
        <section className="mt-8 overflow-hidden rounded-lg border border-[#ded5c5] bg-[#fffdf8] shadow-[0_4px_18px_rgba(63,77,29,0.05)]">
          <div className="border-b border-[#ded5c5] bg-brand-50 px-5 py-4 sm:px-7">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-700 text-cream-50">
                <ShieldCheck size={20} />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.06em] text-gold-600">Admin account</p>
                <h2 className="font-display text-lg font-bold text-ink-900">{profile?.name ?? 'Administrator'}</h2>
              </div>
            </div>
          </div>
          <dl className="divide-y divide-[#e8e0cf] text-sm">
            <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-3 px-5 py-3.5 sm:px-7">
              <Mail size={15} className="text-ink-500" />
              <div className="flex flex-wrap items-baseline gap-x-2">
                <dt className="font-semibold text-ink-700">Email</dt>
                <dd className="text-ink-900">{profile?.email ?? '—'}</dd>
              </div>
            </div>
            <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-3 px-5 py-3.5 sm:px-7">
              <Hash size={15} className="text-ink-500" />
              <div className="flex flex-wrap items-baseline gap-x-2">
                <dt className="font-semibold text-ink-700">UID</dt>
                <dd className="break-all font-mono text-xs text-ink-700">{profile?.uid ?? '—'}</dd>
              </div>
            </div>
            <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-3 px-5 py-3.5 sm:px-7">
              <CalendarDays size={15} className="text-ink-500" />
              <div className="flex flex-wrap items-baseline gap-x-2">
                <dt className="font-semibold text-ink-700">Account created</dt>
                <dd className="text-ink-900">{createdAtLabel}</dd>
              </div>
            </div>
          </dl>
        </section>

        <section className="mt-6 rounded-lg border border-[#ded5c5] bg-[#fffdf8] px-5 py-6 sm:px-7">
          <div className="mb-5"><p className="text-xs font-bold uppercase tracking-[0.06em] text-gold-600">M2 officialisation</p><h2 className="mt-1 font-display text-xl font-bold text-ink-900">Score conflicts and finalisation recovery</h2><p className="mt-1 text-sm leading-6 text-ink-500">Resolve categories with different authority scores, or retry an atomic official calculation after a resource failure. Every resolution remains append-only and bound to the current review heads.</p></div>
          <ScoreConflictQueue />
        </section>
      </main>
    </div>
  );
}
