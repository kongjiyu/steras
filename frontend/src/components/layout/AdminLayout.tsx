import type { ReactNode } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar, { ADMIN_NAV } from './Sidebar';
import { useAuth } from '../../contexts/AuthContext';

interface AdminLayoutProps {
  children?: ReactNode;
}

/**
 * Admin workspace layout — reuses the same Sidebar shell as the authority
 * workspace, but with admin-specific nav items + the "Admin workspace"
 * label. Reuses all CSS from `authority-sidebar` / `authority-mobile-nav`.
 */
export default function AdminLayout({ children }: AdminLayoutProps) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const user = profile?.role === 'admin'
    ? {
        name: profile.name ?? 'Administrator',
        role: 'Admin',
        initials: (profile.name ?? 'A').slice(0, 2).toUpperCase().replace(/\s/g, ''),
      }
    : { name: 'Administrator', role: 'Admin', initials: 'AD' };

  return (
    <div className="authority-workspace flex min-h-screen bg-[#f3f1e9] pb-24 lg:pb-0">
      <a href="#admin-content" className="authority-skip-link">Skip to admin content</a>
      <Sidebar
        user={user}
        navSections={ADMIN_NAV}
        workspaceLabel="Admin workspace"
        userRoleSuffix="administrator"
        onSignOut={async () => { await signOut(); navigate('/login', { replace: true }); }}
      />
      <div id="admin-content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col">
        {children ?? <Outlet />}
      </div>
    </div>
  );
}
