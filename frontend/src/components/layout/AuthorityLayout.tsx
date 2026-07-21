import type { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useAuth } from '../../contexts/AuthContext';

interface AuthorityLayoutProps {
  mockUser?: { name: string; role: string; initials: string };
  /** When used as a wrapper (no nested routes), pass children. */
  children?: ReactNode;
}

/**
 * Authority workspace layout — sidebar + outlet (or children).
 * Falls back to mock "Admin Officer · PDRM" when used outside auth (preview route).
 */
export default function AuthorityLayout({ mockUser, children }: AuthorityLayoutProps) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const user = mockUser ?? (profile?.role === 'authority'
    ? {
        name: profile.name ?? 'Authority Officer',
        role: profile.authorityType ?? 'PDRM',
        initials: (profile.name ?? 'A O').slice(0, 2).toUpperCase().replace(/\s/g, ''),
      }
    : { name: 'Admin Officer', role: 'PDRM', initials: 'AO' });

  return (
    <div className="authority-workspace flex min-h-screen bg-[#f3f1e9] pb-24 lg:pb-0">
      <a href="#authority-content" className="authority-skip-link">Skip to workspace content</a>
      <Sidebar user={user} onSignOut={async () => { await signOut(); navigate('/login', { replace: true }); }} />
      <div id="authority-content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col">
        {children ?? <Outlet />}
      </div>
    </div>
  );
}
