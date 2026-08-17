import { NavLink } from 'react-router-dom';
import {
  Activity,
  LayoutDashboard,
  FileText,
  CalendarDays,
  ChartLine,
  Boxes,
  Users,
  MapPin,
  LogOut,
  ShieldAlert,
  ShieldCheck,
  ListChecks,
  MessageSquare,
  Briefcase,
  type LucideIcon,
} from 'lucide-react';
import logoUrl from '../../assets/brand/steras-logo-horizontal-inverse.svg';
import logoMark from '../../assets/brand/steras-mark.svg';
import NotificationBell from './NotificationBell';

/**
 * Generic workspace sidebar used by both the Authority and Admin layouts.
 * The shape (visual + behaviour) is shared; only the nav config + the
 * workspace label + user-role suffix differ per role.
 *
 * Pass a `navSections` array (groups of links) and a `workspaceLabel`
 * (e.g. "Authority workspace", "Admin workspace") to adapt the look.
 */
export interface SidebarUser {
  name: string;
  role: string;          // e.g. "PDRM", "Admin"
  initials?: string;
}

export interface SidebarNavItem {
  to: string;
  label: string;
  mobileLabel?: string;
  icon: LucideIcon;
  end?: boolean;
}

export interface SidebarNavSection {
  label: string;
  items: SidebarNavItem[];
}

interface SidebarProps {
  user: SidebarUser;
  navSections: SidebarNavSection[];
  workspaceLabel: string;
  userRoleSuffix?: string;          // e.g. "authority", "administrator"
  activePath?: string;                // optional manual active override
  onSignOut?: () => void | Promise<void>;
}

const navItemsOf = (sections: SidebarNavSection[]): SidebarNavItem[] =>
  sections.flatMap((s) => s.items);

export default function Sidebar({
  user,
  navSections,
  workspaceLabel,
  userRoleSuffix = 'workspace',
  activePath,
  onSignOut,
}: SidebarProps) {
  return (
    <>
      <aside className="authority-sidebar sticky top-0 hidden h-screen w-[252px] flex-col overflow-hidden lg:flex">
        <div className="authority-sidebar__pattern" aria-hidden="true" />
        <div className="authority-sidebar__brand">
          <img src={logoUrl} alt="STERAS" />
          <div className="authority-sidebar__workspace-label">
            <span>{workspaceLabel}</span>
            <span className="authority-sidebar__live"><i /> Live</span>
          </div>
        </div>

        <nav className="authority-sidebar__nav flex-1 overflow-y-auto">
          {navSections.map((section) => (
            <div key={section.label} className="authority-nav-section">
              <p>{section.label}</p>
              <ul>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activePath ? activePath === item.to : undefined;
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
            </div>
          ))}
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
              <div className="truncate text-xs text-[#aeb99f]">{user.role} {userRoleSuffix}</div>
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

      <nav aria-label={`${workspaceLabel} mobile navigation`} className="authority-mobile-nav lg:hidden">
        {navItemsOf(navSections).map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : false}
              className={({ isActive }) => `authority-mobile-link ${isActive ? 'is-active' : ''}`}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{item.mobileLabel ?? item.label}</span>
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

/* ============================================================================
 *  Authority nav config (used by AuthorityLayout)
 * ============================================================================ */
export const AUTHORITY_NAV: SidebarNavSection[] = [
  {
    label: 'Operations',
    items: [
      { to: '/authority', label: 'Dashboard', mobileLabel: 'Home', icon: LayoutDashboard, end: true },
      { to: '/authority/applications', label: 'Applications', mobileLabel: 'Queue', icon: FileText },
    ],
  },
  {
    label: 'M2 intelligence',
    items: [
      { to: '/authority/risk', label: 'Risk assessments', mobileLabel: 'Risk', icon: ShieldAlert },
      { to: '/authority/resources', label: 'Resources', mobileLabel: 'Plans', icon: Boxes },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/authority/reports', label: 'Reports', mobileLabel: 'Reports', icon: ChartLine },
    ],
  },
];

/* ============================================================================
 *  Admin nav config (used by AdminLayout)
 * ============================================================================ */
export const ADMIN_NAV: SidebarNavSection[] = [
  {
    label: 'M3 — Authority Approval',
    items: [
      { to: '/admin', label: 'Dashboard', mobileLabel: 'Home', icon: LayoutDashboard, end: true },
      { to: '/admin/applications', label: 'Application queue', mobileLabel: 'Queue', icon: ListChecks },
    ],
  },
  {
    label: 'M1 — User & Event Mgmt',
    items: [
      { to: '/admin/users', label: 'User accounts', mobileLabel: 'Users', icon: Users },
      { to: '/admin/venues', label: 'Venues', mobileLabel: 'Venues', icon: MapPin },
    ],
  },
  {
    label: 'M5 — Analytics',
    items: [
      { to: '/admin/analytics', label: 'Reports', mobileLabel: 'Reports', icon: ChartLine },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/admin/audit', label: 'Audit log', mobileLabel: 'Audit', icon: ShieldCheck },
    ],
  },
];

/* ============================================================================
 *  Shared top bar (used by both Authority and Admin dashboards)
 * ============================================================================ */
interface TopBarProps {
  title: string;
  subtitle?: string;
  userInitials?: string;
  workspaceEyebrow?: string;
  workspaceEyebrowIcon?: LucideIcon;
}

/** @deprecated Use `WorkspaceTopBar` instead. Kept as alias for existing imports. */
export const AuthorityTopBar = WorkspaceTopBar;

export function WorkspaceTopBar({
  title,
  subtitle,
  userInitials,
  workspaceEyebrow = 'Operations centre',
  workspaceEyebrowIcon: EyebrowIcon = Activity,
}: TopBarProps) {
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
          <div className="authority-topbar__eyebrow">
            <EyebrowIcon size={12} aria-hidden="true" /> {workspaceEyebrow}
          </div>
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
        <NotificationBell />
        <div className="authority-topbar__avatar" aria-label={`Signed in as ${userInitials ?? 'A'}`}>
          {userInitials ?? 'A'}
        </div>
      </div>
    </header>
  );
}
