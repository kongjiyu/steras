import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertOctagon,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Gauge,
  Radio,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { COLLECTIONS, EventRecord, UserProfile } from '@shared/types';
import { WorkspaceTopBar } from '../../components/layout/Sidebar';
import { useAuth } from '../../contexts/AuthContext';
import logoMark from '../../assets/brand/steras-mark.svg';
import '../authority/authority-dashboard.css';
import './admin.css';

type MotionStyle = CSSProperties & {
  '--motion-order'?: number;
  '--node-color'?: string;
  '--node-delay'?: string;
};

const ADMIN_RADAR_POINTS = [
  { x: 126, y: 91 },
  { x: 307, y: 88 },
  { x: 349, y: 196 },
  { x: 230, y: 238 },
  { x: 92, y: 205 },
  { x: 225, y: 55 },
] as const;

const ADMIN_STATUS_COLOR: Record<EventRecord['status'], string> = {
  Draft: '#aeb99f',
  Pending: '#f0c340',
  UnderReview: '#ff9c5b',
  Approved: '#7fcf61',
  Rejected: '#ff746d',
  Cancelled: '#aeb99f',
  Withdrawn: '#aeb99f',
  'Manual Review Required': '#ff746d',
};

interface StatCard {
  label: string;
  value: number | string;
  hint: string;
  icon: LucideIcon;
  tone: 'default' | 'warn' | 'good' | 'bad';
  to: string;
}

interface RecentApp {
  eventId: string;
  name: string;
  status: EventRecord['status'];
  organiser: string;
  updatedAt: number;
  venue: string;
  riskLevel?: string;
}

const TONE_CLASSES: Record<StatCard['tone'], string> = {
  default: 'admin-stat__icon--default',
  warn: 'admin-stat__icon--warn',
  good: 'admin-stat__icon--good',
  bad: 'admin-stat__icon--bad',
};

const STATUS_LABELS: Record<EventRecord['status'], string> = {
  Draft: 'Draft',
  Pending: 'Pending',
  UnderReview: 'Under review',
  Approved: 'Approved',
  Rejected: 'Rejected',
  Cancelled: 'Cancelled',
  Withdrawn: 'Withdrawn',
  'Manual Review Required': 'Manual review required',
};

const STATUS_TONE: Record<EventRecord['status'], StatCard['tone']> = {
  Draft: 'default',
  Pending: 'warn',
  UnderReview: 'warn',
  Approved: 'good',
  Rejected: 'bad',
  Cancelled: 'default',
  Withdrawn: 'default',
  'Manual Review Required': 'warn',
};

function initialsFor(name?: string) {
  if (!name) return 'AD';
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

function formatRelative(ts: number) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function AdminOperationalBrief({ events, loading }: { events: EventRecord[]; loading: boolean }) {
  const active = events.filter((event) => event.status === 'Pending' || event.status === 'UnderReview' || event.status === 'Manual Review Required');
  const spotlight = active[0] ?? events[0];
  const pending = events.filter((event) => event.status === 'Pending').length;
  const underReview = events.filter((event) => event.status === 'UnderReview').length;
  const resolved = events.filter((event) => event.status === 'Approved' || event.status === 'Rejected' || event.status === 'Withdrawn').length;
  const headline = loading
    ? 'Synchronizing the operational picture.'
    : active.length > 0
      ? `${active.length} application${active.length === 1 ? '' : 's'} need administrative attention.`
      : 'The review pipeline is clear.';

  return (
    <section className="ops-hero dashboard-enter" aria-labelledby="admin-operational-brief-title">
      <div className="ops-hero__weave" aria-hidden="true" />
      <div className="ops-hero__copy">
        <div className="ops-live-label">
          <span className="ops-live-label__beacon"><span /></span>
          Live system brief
          <span className="ops-live-label__agency">Admin</span>
        </div>
        <h2 id="admin-operational-brief-title">{headline}</h2>
        <p className="ops-hero__lede">Coordinate intake, multi-agency review, officialisation and final application decisions from one operational view.</p>

        {spotlight && (
          <div className="spotlight-case">
            <span className="spotlight-case__index">01</span>
            <div><span>Next administrative action</span><strong>{spotlight.eventDetails.name}</strong></div>
            <div className="admin-spotlight-status">{STATUS_LABELS[spotlight.status]}</div>
          </div>
        )}

        <div className="ops-hero__actions">
          <Link to={spotlight ? `/admin/applications/${spotlight.eventId}` : '/admin/applications'} className="command-button command-button--primary">
            <span>{spotlight ? 'Open priority application' : 'Open application queue'}</span><ArrowRight size={17} aria-hidden="true" />
          </Link>
          {spotlight && <Link to="/admin/applications" className="command-button command-button--quiet">View full queue</Link>}
        </div>

        <dl className="ops-metric-rail" aria-label="Administrative workload summary">
          <AdminHeroMetric label="Applications" value={events.length} detail="Current portfolio" order={1} />
          <AdminHeroMetric label="New intake" value={pending} detail="Initial review" order={2} />
          <AdminHeroMetric label="In review" value={underReview} detail="Officer workflow" order={3} />
          <AdminHeroMetric label="Resolved" value={resolved} detail="Final outcomes" order={4} />
        </dl>
      </div>
      <AdminOperationalRadar events={events.slice(0, ADMIN_RADAR_POINTS.length)} />
    </section>
  );
}

function AdminHeroMetric({ label, value, detail, order }: { label: string; value: number; detail: string; order: number }) {
  return <div className="hero-metric" style={{ '--motion-order': order } as MotionStyle}><dt>{label}</dt><dd><strong>{value}</strong><span>{detail}</span></dd></div>;
}

function AdminOperationalRadar({ events }: { events: EventRecord[] }) {
  const pending = events.filter((event) => event.status === 'Pending').length;
  const reviewing = events.filter((event) => event.status === 'UnderReview' || event.status === 'Manual Review Required').length;
  const complete = events.filter((event) => event.status === 'Approved' || event.status === 'Rejected').length;
  return (
    <div className="operational-radar" aria-label="Live application workflow field">
      <div className="operational-radar__header"><div><Radio size={15} aria-hidden="true" /><span>Workflow field</span></div><span>{events.length} recent signal{events.length === 1 ? '' : 's'}</span></div>
      <div className="operational-radar__stage">
        <svg viewBox="0 0 440 300" className="operational-radar__svg" role="img" aria-label={`${events.length} recent applications plotted by workflow state.`}>
          <defs>
            <pattern id="admin-radar-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#536648" strokeWidth="0.55" opacity="0.34" /></pattern>
            <linearGradient id="admin-radar-sweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#f0c340" stopOpacity="0" /><stop offset="1" stopColor="#f0c340" stopOpacity="0.26" /></linearGradient>
            <filter id="admin-radar-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" /></filter>
          </defs>
          <rect width="440" height="300" fill="url(#admin-radar-grid)" opacity="0.56" />
          <g className="radar-geometry" aria-hidden="true"><ellipse cx="220" cy="150" rx="168" ry="118" /><ellipse cx="220" cy="150" rx="119" ry="83" /><ellipse cx="220" cy="150" rx="68" ry="47" /><path d="M36 150H404M220 18V282" /><path d="M87 62L353 238M353 62L87 238" /></g>
          <path className="radar-route" d="M54 221C98 182 115 105 169 117C218 128 234 65 288 83C331 98 333 164 390 177" pathLength="1" aria-hidden="true" />
          <g className="radar-sweep" aria-hidden="true"><path d="M220 150L220 28A122 122 0 0 1 337 115Z" fill="url(#admin-radar-sweep)" /><line x1="220" y1="150" x2="220" y2="28" stroke="#f0c340" strokeWidth="1.2" opacity="0.78" /></g>
          {events.map((event, index) => {
            const point = ADMIN_RADAR_POINTS[index];
            const color = ADMIN_STATUS_COLOR[event.status];
            const style = { '--node-color': color, '--node-delay': `${320 + index * 90}ms` } as MotionStyle;
            return <g key={event.eventId} transform={`translate(${point.x} ${point.y})`} className="radar-node" style={style}><title>{`${event.eventDetails.name}: ${STATUS_LABELS[event.status]}`}</title><circle className="radar-node__glow" r="15" fill={color} filter="url(#admin-radar-glow)" /><circle className="radar-node__halo" r="11" /><circle className="radar-node__core" r="6" /><text y="0.5">{index + 1}</text></g>;
          })}
          <g className="radar-origin" transform="translate(220 150)" aria-hidden="true"><circle r="18" /><path d="M0-8L3-3L8 0L3 3L0 8L-3 3L-8 0L-3-3Z" /></g>
        </svg>
        <img src={logoMark} alt="" className="operational-radar__mark" />
        <div className="radar-coordinates" aria-hidden="true"><span>MY · National operations</span><span>Live review topology</span></div>
      </div>
      <div className="operational-radar__footer"><span><i className="is-medium" /> Pending {pending}</span><span><i className="is-high" /> Review {reviewing}</span><span><i className="is-low" /> Complete {complete}</span></div>
    </div>
  );
}
import ScoreConflictQueue from './ScoreConflictQueue';
import ManualAssessmentQueue from './ManualAssessmentQueue';
import { ADMIN_VISIBLE_EVENT_STATUSES } from './adminApplicationVisibility';

export default function AdminDashboard() {
  const { profile } = useAuth();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [officerCount, setOfficerCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [eventsSnap, usersSnap, officersSnap] = await Promise.all([
          getDocs(query(
            collection(db, COLLECTIONS.EVENTS),
            where('status', 'in', ADMIN_VISIBLE_EVENT_STATUSES),
            orderBy('updatedAt', 'desc'),
            limit(50),
          )),
          getDocs(collection(db, COLLECTIONS.USERS)),
          getDocs(query(collection(db, COLLECTIONS.USERS), where('role', '==', 'authority'))),
        ]);
        if (cancelled) return;
         setEvents(eventsSnap.docs.map((d) => ({ ...(d.data() as EventRecord), eventId: d.id })));
        setUsers(usersSnap.docs.map((d) => d.data() as UserProfile));
        setOfficerCount(officersSnap.size);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('[AdminDashboard] load failed', err);
        setError('Dashboard data could not be loaded.');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const counts = useMemo(() => {
    const byStatus: Record<string, number> = {};
    for (const e of events) byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    return {
      total: events.length,
      pending: byStatus.Pending ?? 0,
      underReview: byStatus.UnderReview ?? 0,
      approved: byStatus.Approved ?? 0,
      rejected: byStatus.Rejected ?? 0,
      withdrawn: byStatus.Withdrawn ?? 0,
    };
  }, [events]);

  const recent = useMemo<RecentApp[]>(() =>
    events.slice(0, 6).map((e) => ({
      eventId: e.eventId,
      name: e.eventDetails.name,
      status: e.status,
      organiser: e.eventDetails.organizerName,
      updatedAt: e.updatedAt,
      venue: e.eventDetails.venueName,
    })),
  [events]);

  const stats: StatCard[] = [
    { label: 'Total applications', value: counts.total, hint: `${events.length} on file`, icon: ClipboardList, tone: 'default', to: '/admin/applications' },
    { label: 'Awaiting initial review', value: counts.pending, hint: 'New submissions', icon: CalendarClock, tone: 'warn', to: '/admin/applications?status=Pending' },
    { label: 'Officer reviews in flight', value: counts.underReview, hint: 'Multi-agency review', icon: Gauge, tone: 'warn', to: '/admin/applications?status=UnderReview' },
    { label: 'Approved this period', value: counts.approved, hint: 'Final approval complete', icon: CheckCircle2, tone: 'good', to: '/admin/applications?status=Approved' },
    { label: 'Registered accounts', value: users.length, hint: `${officerCount} officers available`, icon: Users, tone: 'default', to: '/admin/users' },
  ];

  return (
    <div className="min-h-screen bg-[#f3f1e9] pb-16">
      <WorkspaceTopBar
        title="Command centre"
        subtitle="Cross-module administration and final review"
        userInitials={initialsFor(profile?.name)}
        workspaceEyebrow="STERAS administration"
        workspaceEyebrowIcon={ShieldCheck}
      />

      <main className="authority-dashboard__main mx-auto w-full max-w-[1580px] px-4 py-5 sm:px-6 sm:py-7 xl:px-8 xl:py-8">
        {error && (
          <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700" role="alert">
            {error}
          </div>
        )}

        <AdminOperationalBrief events={events} loading={loading} />

        {/* Stat grid */}
        <section aria-labelledby="overview-title" className="mb-8 mt-8 dashboard-enter" style={{ '--motion-order': 5 } as MotionStyle}>
          <div className="portfolio-heading !mb-4">
            <div><div className="section-eyebrow"><span /> System workload</div><h2 id="overview-title">Operational overview</h2></div>
            <div className="portfolio-heading__context"><span className="portfolio-heading__rule" /><p>Live production records only. Every count links to its working queue.</p></div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {stats.map((s) => {
              const Icon = s.icon;
              return (
                <Link
                  key={s.label}
                  to={s.to}
                  className="admin-stat group flex items-start gap-4 rounded-lg border border-[#ded5c5] bg-white p-4 shadow-card transition hover:border-[#b5bd98] hover:shadow-card-hover"
                >
                  <div className={`admin-stat__icon ${TONE_CLASSES[s.tone]}`}>
                    <Icon size={20} strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-500">{s.label}</p>
                    <p className="mt-1 font-display text-2xl font-bold text-ink-900">{loading ? '—' : s.value}</p>
                    <p className="mt-0.5 text-xs text-ink-500">{s.hint}</p>
                  </div>
                  <ChevronRight size={16} className="mt-1 text-ink-400 transition group-hover:translate-x-0.5 group-hover:text-ink-700" />
                </Link>
              );
            })}
          </div>
        </section>

        {/* Recent applications */}
        <section aria-labelledby="recent-title">
          <div className="mb-3 flex items-end justify-between">
            <h2 id="recent-title" className="section-title">Recent applications</h2>
            <Link to="/admin/applications" className="text-sm font-semibold text-brand-700 hover:text-brand-800">
              View queue →
            </Link>
          </div>
          <div className="overflow-hidden rounded-lg border border-[#ded5c5] bg-white shadow-card">
            {loading ? (
              <p className="p-5 text-sm text-ink-500">Loading recent applications…</p>
            ) : recent.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-10 text-center">
                <AlertOctagon size={28} className="text-ink-400" />
                <p className="text-sm text-ink-500">No applications in the system yet.</p>
              </div>
            ) : (
              <ul className="divide-y divide-[#e8e0cf]">
                {recent.map((r) => {
                  const tone = STATUS_TONE[r.status];
                  return (
                    <li key={r.eventId}>
                      <Link
                        to={`/admin/applications/${r.eventId}`}
                        className="admin-recent-row flex items-center gap-4 px-4 py-3 transition hover:bg-cream-50"
                      >
                        <span className={`admin-stat__icon ${TONE_CLASSES[tone]}`}>
                          <ClipboardList size={18} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink-900">{r.name}</p>
                          <p className="truncate text-xs text-ink-500">
                            {r.organiser} · {r.venue}
                          </p>
                        </div>
                        <span className={`admin-recent__status admin-recent__status--${tone} hidden sm:inline-flex`}>
                          {STATUS_LABELS[r.status]}
                        </span>
                        <span className="text-xs text-ink-500">{formatRelative(r.updatedAt)}</span>
                        <ChevronRight size={16} className="text-ink-400" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* M2 officialisation and recovery queues */}
        <section className="mt-6 rounded-lg border border-[#ded5c5] bg-[#fffdf8] px-5 py-6 sm:px-7">
          <div className="mb-5"><p className="text-xs font-bold uppercase tracking-[0.06em] text-gold-600">M2 officialisation</p><h2 className="mt-1 font-display text-xl font-bold text-ink-900">Score conflicts and finalisation recovery</h2><p className="mt-1 text-sm leading-6 text-ink-500">Resolve categories with different authority scores, or retry an atomic official calculation after a resource failure. Every resolution remains append-only and bound to the current review heads.</p></div>
          <ScoreConflictQueue />
        </section>
        <section className="mt-6 rounded-lg border border-[#ded5c5] bg-[#fffdf8] px-5 py-6 sm:px-7">
          <div className="mb-5"><p className="text-xs font-bold uppercase tracking-[0.06em] text-gold-600">AI-failure recovery</p><h2 className="mt-1 font-display text-xl font-bold text-ink-900">Admin manual assessment queue</h2><p className="mt-1 text-sm leading-6 text-ink-500">Complete a locked eight-category assessment when AI is unavailable or the evidence snapshot is insufficient. Successful submission publishes an official risk and resource result atomically.</p></div>
          <ManualAssessmentQueue />
        </section>
      </main>
    </div>
  );
}
