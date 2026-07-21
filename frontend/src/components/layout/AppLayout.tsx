import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import logoUrl from '../../assets/brand/steras-logo-horizontal.svg';
import { CalendarPlus, ClipboardList, Home, LogOut } from 'lucide-react';

export default function AppLayout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isOrganizer = profile?.role === 'organizer';

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const organizerLinks = [
    { to: '/organizer', label: 'Dashboard' },
    { to: '/organizer/events/new', label: 'New Event' },
    { to: '/organizer/events', label: 'My Events' },
  ];

  const links = isOrganizer ? organizerLinks : [];

  return (
    <div className="flex min-h-screen flex-col bg-cream-50 pb-20 md:pb-0">
      {/* Top nav */}
      <header className="sticky top-0 z-40 border-b border-[#ddd3c2] bg-[#fffdf8]/95 backdrop-blur-sm">
        <div className="mx-auto max-w-[1440px] px-5 sm:px-8">
          <div className="flex min-h-[72px] items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-8">
              <Link to="/organizer" className="flex shrink-0 items-center" aria-label="STERAS organizer home">
                <img src={logoUrl} alt="STERAS" className="h-auto w-36 object-contain sm:w-40" />
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
                          : 'text-ink-500 hover:bg-cream-100 hover:text-ink-800')
                      }
                    >
                      {l.label}
                    </Link>
                  );
                })}
              </nav>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-2 text-sm text-ink-500 sm:flex">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <div className="text-right">
                  <div className="font-semibold text-ink-800">{profile?.name ?? 'User'}</div>
                  <div className="text-xs capitalize text-ink-500">
                    {profile?.role === 'authority' ? profile?.authorityType : profile?.role}
                  </div>
                </div>
              </div>
              <button onClick={handleSignOut} className="btn-secondary !px-3" title="Sign out">
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
      <main className="flex-1 bg-cream-50">
        <div className="page-shell page-enter">
          <Outlet />
        </div>
      </main>

      <footer className="border-t border-[#ddd3c2] bg-[#fffdf8] py-5">
        <div className="mx-auto max-w-[1440px] px-5 text-center text-xs text-ink-500">
          STERAS · Smart Tourism Event Risk &amp; Approval System
        </div>
      </footer>

      <nav className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-4 border-t border-[#d7ccb9] bg-[#fffdf8] px-2 pb-[max(.4rem,env(safe-area-inset-bottom))] pt-1 md:hidden" aria-label="Organizer mobile navigation">
        {[
          { to: '/organizer', label: 'Home', icon: Home, end: true },
          { to: '/organizer/events/new', label: 'New event', icon: CalendarPlus },
          { to: '/organizer/events', label: 'My events', icon: ClipboardList },
        ].map(({ to, label, icon: Icon, end }) => {
          const active = end ? location.pathname === to : location.pathname.startsWith(to);
          return <Link key={to} to={to} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-md text-[11px] font-semibold ${active ? 'bg-brand-50 text-brand-700' : 'text-ink-500'}`}><Icon size={18} /><span>{label}</span></Link>;
        })}
        <button type="button" onClick={handleSignOut} className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-md text-[11px] font-semibold text-ink-500"><LogOut size={18} /><span>Sign out</span></button>
      </nav>
    </div>
  );
}
