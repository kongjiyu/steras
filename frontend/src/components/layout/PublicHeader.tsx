import { Link, NavLink } from 'react-router-dom';
import logoUrl from '../../assets/brand/steras-mark.svg';
import { useAuth } from '../../contexts/AuthContext';
import { getIncidentPath, getRoleHome } from '../../routing';
import { useAppDialog } from '../../contexts/AppDialogContext';

export default function PublicHeader() {
  const { user, profile, signOut } = useAuth();
  const roleHome = getRoleHome(profile?.role);
  const dialog = useAppDialog();
  const handleSignOut = async () => {
    if (!await dialog.confirm({ title: 'Sign out of STERAS?', description: 'You will need to sign in again to return to your workspace.', confirmLabel: 'Sign out', cancelLabel: 'Stay signed in', tone: 'danger' })) return;
    await signOut();
  };
  return (
    <header className="sticky top-0 z-40 border-b border-[#e4dac7] bg-[#fffdf7]/95 backdrop-blur-sm">
      <div className="mx-auto flex min-h-[72px] max-w-6xl items-center justify-between gap-3 px-5 sm:px-8">
        <Link to="/" className="flex items-center gap-2.5" aria-label="STERAS home">
          <img src={logoUrl} alt="" className="h-9 w-9" />
          <div>
            <div className="font-display text-base font-bold leading-none text-[#52651c]">STERAS</div>
            <div className="mt-1 text-[9px] font-semibold uppercase text-[#7a715e]">Visit Malaysia 2026</div>
          </div>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-3" aria-label="Public navigation">
          <a href="/#how-it-works" className="hidden min-h-11 items-center rounded-md px-3 py-2 text-sm font-semibold text-[#5d5b4e] hover:bg-[#f7f1e5] md:inline-flex">How it works</a>
          <a href="/#who-it-is-for" className="hidden min-h-11 items-center rounded-md px-3 py-2 text-sm font-semibold text-[#5d5b4e] hover:bg-[#f7f1e5] lg:inline-flex">For organizers &amp; authorities</a>
          <NavLink to="/calendar" className={({ isActive }) => `inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-semibold ${isActive ? 'bg-[#edf2dc] text-[#52651c]' : 'text-[#5d5b4e] hover:bg-[#f7f1e5]'}`}>Events</NavLink>
          <NavLink to={getIncidentPath(profile?.role)} className={({ isActive }) => `${profile?.role === 'public' ? 'inline-flex' : 'hidden sm:inline-flex'} min-h-11 items-center rounded-md px-3 py-2 text-sm font-semibold ${isActive ? 'bg-[#edf2dc] text-[#52651c]' : 'text-[#5d5b4e] hover:bg-[#f7f1e5]'}`}>{profile?.role === 'public' ? 'My reports' : 'Report incident'}</NavLink>
          {(user || profile) && roleHome ? <>{profile?.role !== 'public' && <Link to={roleHome} className="btn-secondary !px-3">Workspace</Link>}<button type="button" className="btn-secondary !px-3" onClick={() => void handleSignOut()}>Sign out</button></> : <Link to="/login" className="btn-secondary !px-3">Sign in</Link>}
        </nav>
      </div>
    </header>
  );
}
