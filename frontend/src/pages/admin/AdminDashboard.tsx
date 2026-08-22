import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertOctagon,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileWarning,
  Gauge,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { COLLECTIONS, EventRecord, UserProfile } from '@shared/types';
import { WorkspaceTopBar } from '../../components/layout/Sidebar';
import { useAuth } from '../../contexts/AuthContext';
import './admin.css';

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
  AmendmentRequested: 'Amendment requested',
  Approved: 'Approved',
  Rejected: 'Rejected',
  Withdrawn: 'Withdrawn',
};

const STATUS_TONE: Record<EventRecord['status'], StatCard['tone']> = {
  Draft: 'default',
  Pending: 'warn',
  UnderReview: 'warn',
  AmendmentRequested: 'bad',
  Approved: 'good',
  Rejected: 'bad',
  Withdrawn: 'default',
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
import ScoreConflictQueue from './ScoreConflictQueue';
import ManualAssessmentQueue from './ManualAssessmentQueue';

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
          getDocs(query(collection(db, COLLECTIONS.EVENTS), orderBy('updatedAt', 'desc'), limit(50))),
          getDocs(collection(db, COLLECTIONS.USERS)),
          getDocs(query(collection(db, COLLECTIONS.USERS), where('role', '==', 'authority'))),
        ]);
        if (cancelled) return;
        setEvents(eventsSnap.docs.map((d) => ({ eventId: d.id, ...(d.data() as EventRecord) })));
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
      amendment: byStatus.AmendmentRequested ?? 0,
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
    { label: 'Amendments outstanding', value: counts.amendment, hint: 'Returned to organiser', icon: FileWarning, tone: 'bad', to: '/admin/applications?status=AmendmentRequested' },
    { label: 'Approved this period', value: counts.approved, hint: 'Final approval complete', icon: CheckCircle2, tone: 'good', to: '/admin/applications?status=Approved' },
    { label: 'Registered accounts', value: users.length, hint: `${officerCount} officers available`, icon: Users, tone: 'default', to: '/admin/users' },
  ];

  return (
    <div className="min-h-screen bg-[#f3f1e9] pb-16">
      <WorkspaceTopBar
        title="Admin dashboard"
        subtitle="Operational view of M3 + user/venue management"
        userInitials={initialsFor(profile?.name)}
        workspaceEyebrow="STERAS administration"
        workspaceEyebrowIcon={ShieldCheck}
      />

      <main className="page-shell page-enter">
        {error && (
          <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700" role="alert">
            {error}
          </div>
        )}

        {/* Stat grid */}
        <section aria-labelledby="overview-title" className="mb-8">
          <h2 id="overview-title" className="section-title mb-3">Overview</h2>
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
