import { NavLink } from 'react-router-dom';
import {
  Activity,
  LayoutDashboard,
  FileText,
  CalendarDays,
  ChartLine,
  LogOut,
} from 'lucide-react';
import logoUrl from '../../assets/brand/steras-logo-horizontal-inverse.svg';
import logoMark from '../../assets/brand/steras-mark.svg';

/**
 * Sidebar for the Authority workspace (PDRM / Bomba / KKM / DBKL / MOTAC).
 * Mirrors the design-system layout — left-rail nav + logo block + user chip.
 */
export interface SidebarUser {
  name: string;
  role: string;          // e.g. "PDRM", "Bomba Officer"
  initials?: string;
}

interface SidebarProps {
  user: SidebarUser;
  activePath?: string;   // optional manual active override (when used outside router)
  onSignOut?: () => void | Promise<void>;
}

const navItems = [
  { to: '/authority',              label: 'Dashboard',        icon: LayoutDashboard, end: true },
  { to: '/authority/applications', label: 'Applications',     icon: FileText },
  { to: '/authority/reports',      label: 'Reports',          icon: ChartLine },
];

export default function Sidebar({ user, activePath, onSignOut }: SidebarProps) {
  return (
    <>
    <aside className="authority-sidebar sticky top-0 hidden h-screen w-[252px] flex-col overflow-hidden lg:flex">
      <div className="authority-sidebar__pattern" aria-hidden="true" />
      <div className="authority-sidebar__brand">
        <img src={logoUrl} alt="STERAS" />
        <div className="authority-sidebar__workspace-label">
          <span>Authority workspace</span>
          <span className="authority-sidebar__live"><i /> Live</span>
        </div>
      </div>

      <nav className="authority-sidebar__nav flex-1 overflow-y-auto">
        <p>Operations</p>
        <ul>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePath
              ? activePath === item.to
              : undefined;
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={'end' in item ? item.end : false}
                  className={({ isActive: navActive }) =>
                    `authority-nav-link ${navActive || isActive ? 'is-active' : ''}`
                  }
                >
                  <span className="authority-nav-link__icon"><Icon size={18} strokeWidth={1.8} /></span>
                  <span>{item.label}</span>
                  <span className="authority-nav-link__signal" aria-hidden="true" />
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="authority-sidebar__user">
        <div className="flex items-center gap-3">
          <div className="authority-sidebar__avatar">
            {user.initials ?? user.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="truncate text-sm font-semibold text-[#fffdf7]">
              {user.name}
            </div>
            <div className="truncate text-xs text-[#aeb99f]">{user.role} authority</div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="authority-sidebar__signout"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={17} />
          </button>
        </div>
      </div>
    </aside>

    <nav aria-label="Authority mobile navigation" className="authority-mobile-nav lg:hidden">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={'end' in item ? item.end : false}
            className={({ isActive }) => `authority-mobile-link ${isActive ? 'is-active' : ''}`}
          >
            <Icon size={18} strokeWidth={1.8} />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
      <button type="button" onClick={onSignOut} className="authority-mobile-link" aria-label="Sign out">
        <LogOut size={18} strokeWidth={1.8} /><span>Sign out</span>
      </button>
    </nav>
    </>
  );
}

/**
 * Lightweight top header for the Authority workspace.
 * Renders page title + status date + notification bell + avatar.
 */
interface TopBarProps {
  title: string;
  subtitle?: string;
  userInitials?: string;
}

export function AuthorityTopBar({ title, subtitle, userInitials }: TopBarProps) {
  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <header className="authority-topbar sticky top-0 z-20 flex min-h-[78px] items-center justify-between gap-4 px-5 py-3 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <img src={logoMark} alt="" className="authority-topbar__mark h-9 w-9 shrink-0 lg:hidden" />
        <div className="min-w-0">
          <div className="authority-topbar__eyebrow"><Activity size={12} aria-hidden="true" /> Operations centre</div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      <div className="authority-topbar__tools">
        <div className="authority-topbar__system hidden md:flex">
          <i /> Systems operational
        </div>
        <div className="authority-topbar__date hidden sm:flex">
          <CalendarDays size={15} aria-hidden="true" />
          <span>{today}</span>
        </div>
        <div className="authority-topbar__avatar" aria-label={`Signed in as ${userInitials ?? 'A'}`}>
          {userInitials ?? 'A'}
        </div>
      </div>
    </header>
  );
}
