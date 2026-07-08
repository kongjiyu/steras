import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function AppLayout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isOrganizer = profile?.role === 'organizer';
  const isAuthority = profile?.role === 'authority';

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const organizerLinks = [
    { to: '/organizer', label: 'Dashboard' },
    { to: '/organizer/events/new', label: 'New Event' },
    { to: '/organizer/events', label: 'My Events' },
  ];

  const authorityLinks = [
    { to: '/authority', label: 'Dashboard' },
    { to: '/authority/queue', label: 'Review Queue' },
    { to: '/authority/analytics', label: 'Analytics' },
  ];

  const links = isOrganizer ? organizerLinks : isAuthority ? authorityLinks : [];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top nav */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-8">
              <Link to="/" className="flex items-center gap-2">
                <div className="w-8 h-8 rounded bg-brand-600 text-white flex items-center justify-center font-bold text-sm">
                  S
                </div>
                <span className="font-semibold text-slate-900">STERAS</span>
              </Link>
              <nav className="hidden md:flex gap-1">
                {links.map((l) => {
                  const active = location.pathname === l.to;
                  return (
                    <Link
                      key={l.to}
                      to={l.to}
                      className={
                        'px-3 py-2 rounded-md text-sm font-medium ' +
                        (active
                          ? 'bg-brand-50 text-brand-700'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50')
                      }
                    >
                      {l.label}
                    </Link>
                  );
                })}
              </nav>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 text-sm text-slate-600">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <div className="text-right">
                  <div className="font-medium text-slate-900">{profile?.name ?? 'User'}</div>
                  <div className="text-xs text-slate-500">
                    {profile?.role === 'authority' ? profile?.authorityType : profile?.role}
                  </div>
                </div>
              </div>
              <button onClick={handleSignOut} className="btn-secondary !py-1.5" title="Sign out">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Outlet />
        </div>
      </main>

      <footer className="bg-white border-t border-slate-200 py-4">
        <div className="max-w-7xl mx-auto px-4 text-center text-xs text-slate-500">
          STERAS v0.1.0 · Smart Tourism Event Risk &amp; Approval System
        </div>
      </footer>
    </div>
  );
}
