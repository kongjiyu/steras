import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, doc, getDoc, limit, onSnapshot, query, where } from 'firebase/firestore';
import { format, formatDistanceToNowStrict } from 'date-fns';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  ChevronRight,
  Clock3,
  MapPin,
  Radio,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { COLLECTIONS, EventRecord, RiskAssessment, RiskLevel } from '@shared/types';
import { AuthorityTopBar } from '../../components/layout/Sidebar';
import EmptyState from '../../components/ui/EmptyState';
import RiskMeter from '../../components/ui/RiskMeter';
import StatusBadge from '../../components/ui/StatusBadge';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { useAuth } from '../../contexts/AuthContext';
import logoMark from '../../assets/brand/steras-mark.svg';
import {
  DashboardRecord,
  dashboardSummary,
  riskDistribution,
  sortReviewPriority,
  statusDistribution,
} from './dashboardData';
import './authority-dashboard.css';

interface AuthorityDashboardProps {
  previewRecords?: DashboardRecord[];
}

type MotionStyle = CSSProperties & {
  '--motion-order'?: number;
  '--node-color'?: string;
  '--node-delay'?: string;
  '--progress'?: string;
};

const RADAR_POINTS = [
  { x: 126, y: 91 },
  { x: 307, y: 88 },
  { x: 349, y: 196 },
  { x: 230, y: 238 },
  { x: 92, y: 205 },
  { x: 225, y: 55 },
] as const;

const RISK_COLOR: Record<RiskLevel | 'Unassessed', string> = {
  Low: '#7fcf61',
  Medium: '#f0c340',
  High: '#ff746d',
  Unassessed: '#aeb99f',
};

export default function AuthorityDashboard({ previewRecords }: AuthorityDashboardProps) {
  const { profile } = useAuth();
  const [records, setRecords] = useState<DashboardRecord[]>(previewRecords ?? []);
  const [loading, setLoading] = useState(!previewRecords);
  const [error, setError] = useState('');

  useEffect(() => {
    if (previewRecords) return;
    if (!isFirebaseConfigured || !profile?.authorityType) {
      setLoading(false);
      return;
    }

    let requestId = 0;
    const eventsQuery = query(
      collection(db, COLLECTIONS.EVENTS),
      where('requiredAuthorities', 'array-contains', profile.authorityType),
      limit(100),
    );

    return onSnapshot(eventsQuery, async (snapshot) => {
      const currentRequest = ++requestId;
      try {
        const nextRecords = await Promise.all(snapshot.docs.map(async (eventDocument) => {
          const event = { eventId: eventDocument.id, ...eventDocument.data() } as EventRecord;
          let assessment: RiskAssessment | undefined;
          if (event.currentAssessmentId) {
            const assessmentDocument = await getDoc(doc(
              db,
              COLLECTIONS.EVENTS,
              event.eventId,
              COLLECTIONS.ASSESSMENTS,
              event.currentAssessmentId,
            ));
            if (assessmentDocument.data()?.status === 'ready') {
              assessment = assessmentDocument.data() as RiskAssessment;
            }
          }
          return { event, assessment };
        }));

        if (currentRequest === requestId) {
          setRecords(nextRecords);
          setError('');
          setLoading(false);
        }
      } catch {
        setError('Your operational overview could not be loaded.');
        setLoading(false);
      }
    }, () => {
      setError('Your operational overview could not be loaded.');
      setLoading(false);
    });
  }, [previewRecords, profile?.authorityType]);

  const summary = useMemo(() => dashboardSummary(records), [records]);
  const queue = useMemo(() => sortReviewPriority(records).slice(0, 6), [records]);
  const statuses = useMemo(() => statusDistribution(records), [records]);
  const risks = useMemo(() => riskDistribution(records), [records]);
  const agency = profile?.authorityType ?? 'PDRM';
  const initials = profile?.name
    ? profile.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
    : 'AO';

  return (
    <div className="authority-dashboard min-h-screen">
      <AuthorityTopBar title="Command desk" subtitle={`${agency} · Event safety operations`} userInitials={initials} />

      <main className="authority-dashboard__main mx-auto w-full max-w-[1580px] px-4 py-5 sm:px-6 sm:py-7 xl:px-8 xl:py-8">
        <p className="sr-only" aria-live="polite">
          {loading ? 'Loading operational overview.' : error || `${summary.active} applications require review.`}
        </p>

        {loading ? (
          <DashboardSkeleton />
        ) : error ? (
          <div className="dashboard-enter mx-auto mt-10 max-w-2xl">
            <EmptyState title="Dashboard unavailable" description={error}>
              <button type="button" className="btn-secondary min-h-11" onClick={() => window.location.reload()}>
                Try again
              </button>
            </EmptyState>
          </div>
        ) : (
          <>
            <OperationalBrief summary={summary} agency={agency} queue={queue} />

            {records.length === 0 ? (
              <div className="dashboard-enter mt-7" style={{ '--motion-order': 6 } as MotionStyle}>
                <EmptyState title="No assigned applications" description={`Applications requiring ${agency} review will appear here.`}>
                  <Link to="/authority/applications" className="btn-secondary min-h-11">Check review queue</Link>
                </EmptyState>
              </div>
            ) : (
              <>
                <section className="portfolio-heading dashboard-enter" style={{ '--motion-order': 5 } as MotionStyle}>
                  <div>
                    <div className="section-eyebrow"><span /> Live portfolio</div>
                    <h2>Priority register</h2>
                  </div>
                  <div className="portfolio-heading__context">
                    <span className="portfolio-heading__rule" />
                    <p>Final risk sets the pace. Amendments and recent activity break the tie.</p>
                  </div>
                </section>

                <div className="portfolio-grid dashboard-enter" style={{ '--motion-order': 6 } as MotionStyle}>
                  <PriorityRegister queue={queue} />
                  <aside className="portfolio-insights" aria-label="Portfolio intelligence">
                    <RiskIntelligence risks={risks} />
                    <StatusLedger statuses={statuses} total={summary.total} />
                  </aside>
                </div>

                <AssessmentReadiness summary={summary} />

                <p className="portfolio-updated dashboard-enter" style={{ '--motion-order': 8 } as MotionStyle}>
                  <Clock3 size={14} aria-hidden="true" />
                  Portfolio synchronized {formatDistanceToNowStrict(Math.max(...records.map(({ event }) => event.updatedAt)), { addSuffix: true })}
                  <span>Live Firestore feed</span>
                </p>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function OperationalBrief({
  summary,
  agency,
  queue,
}: {
  summary: ReturnType<typeof dashboardSummary>;
  agency: string;
  queue: DashboardRecord[];
}) {
  const activeHighRisk = queue.filter(({ assessment }) => assessment?.finalRiskLevel === 'High').length;
  const spotlight = queue[0];
  const headline = summary.active === 0
    ? 'The field is clear. Your next signal will appear here.'
    : activeHighRisk > 0
      ? `${activeHighRisk} high-risk application${activeHighRisk === 1 ? ' leads' : 's lead'} today’s queue.`
      : `${summary.active} active applications. No high-risk escalation.`;

  return (
    <section className="ops-hero dashboard-enter" aria-labelledby="operational-brief-title">
      <div className="ops-hero__weave" aria-hidden="true" />
      <div className="ops-hero__copy">
        <div className="ops-live-label">
          <span className="ops-live-label__beacon"><span /></span>
          Live operational brief
          <span className="ops-live-label__agency">{agency}</span>
        </div>

        <h2 id="operational-brief-title">{headline}</h2>
        <p className="ops-hero__lede">
          Review the authoritative final risk, supporting evidence and inter-agency requirements before recording a decision.
        </p>

        {spotlight && (
          <div className="spotlight-case">
            <span className="spotlight-case__index">01</span>
            <div>
              <span>Review first</span>
              <strong>{spotlight.event.eventDetails.name}</strong>
            </div>
            {spotlight.assessment && (
              <div className="spotlight-case__risk">
                <RiskMeter level={spotlight.assessment.finalRiskLevel} size="compact" tone="inverse" />
                <strong>{spotlight.assessment.finalScore}<small>/100</small></strong>
              </div>
            )}
          </div>
        )}

        <div className="ops-hero__actions">
          <Link
            to={spotlight ? `/authority/events/${spotlight.event.eventId}` : '/authority/applications'}
            className="command-button command-button--primary"
          >
            <span>{spotlight ? 'Open priority case' : 'Open review queue'}</span>
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
          {spotlight && (
            <Link to="/authority/applications" className="command-button command-button--quiet">
              View all applications <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          )}
        </div>

        <dl className="ops-metric-rail" aria-label="Current workload summary">
          <HeroMetric label="Active review" value={summary.active} detail={`${summary.pending} new`} order={1} />
          <HeroMetric label="High risk" value={activeHighRisk} detail="Final level" danger order={2} />
          <HeroMetric label="Amendments" value={summary.amendments} detail="Returned" order={3} />
          <HeroMetric label="Resolved" value={summary.resolved} detail={`${summary.total} assigned`} order={4} />
        </dl>
      </div>

      <OperationalRadar queue={queue} activeHighRisk={activeHighRisk} />
    </section>
  );
}

function HeroMetric({
  label,
  value,
  detail,
  danger = false,
  order,
}: {
  label: string;
  value: number;
  detail: string;
  danger?: boolean;
  order: number;
}) {
  return (
    <div className="hero-metric" style={{ '--motion-order': order } as MotionStyle}>
      <dt>{label}</dt>
      <dd>
        <strong className={danger && value > 0 ? 'is-danger' : ''}>{value}</strong>
        <span>{detail}</span>
      </dd>
    </div>
  );
}

function OperationalRadar({ queue, activeHighRisk }: { queue: DashboardRecord[]; activeHighRisk: number }) {
  return (
    <div className="operational-radar" aria-label="Live priority field">
      <div className="operational-radar__header">
        <div>
          <Radio size={15} aria-hidden="true" />
          <span>Priority field</span>
        </div>
        <span>{queue.length} active signal{queue.length === 1 ? '' : 's'}</span>
      </div>

      <div className="operational-radar__stage">
        <svg
          viewBox="0 0 440 300"
          className="operational-radar__svg"
          role="img"
          aria-label={`${queue.length} active applications plotted by review priority; ${activeHighRisk} ${activeHighRisk === 1 ? 'is' : 'are'} high risk.`}
        >
          <defs>
            <pattern id="radar-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#536648" strokeWidth="0.55" opacity="0.34" />
            </pattern>
            <linearGradient id="radar-sweep" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#f0c340" stopOpacity="0" />
              <stop offset="1" stopColor="#f0c340" stopOpacity="0.26" />
            </linearGradient>
            <filter id="radar-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>

          <rect width="440" height="300" fill="url(#radar-grid)" opacity="0.56" />
          <g className="radar-geometry" aria-hidden="true">
            <ellipse cx="220" cy="150" rx="168" ry="118" />
            <ellipse cx="220" cy="150" rx="119" ry="83" />
            <ellipse cx="220" cy="150" rx="68" ry="47" />
            <path d="M36 150H404M220 18V282" />
            <path d="M87 62L353 238M353 62L87 238" />
          </g>

          <path
            className="radar-route"
            d="M54 221C98 182 115 105 169 117C218 128 234 65 288 83C331 98 333 164 390 177"
            pathLength="1"
            aria-hidden="true"
          />

          <g className="radar-sweep" aria-hidden="true">
            <path d="M220 150L220 28A122 122 0 0 1 337 115Z" fill="url(#radar-sweep)" />
            <line x1="220" y1="150" x2="220" y2="28" stroke="#f0c340" strokeWidth="1.2" opacity="0.78" />
          </g>

          {queue.slice(0, RADAR_POINTS.length).map(({ event, assessment }, index) => {
            const point = RADAR_POINTS[index];
            const level = assessment?.finalRiskLevel ?? 'Unassessed';
            const radius = Math.min(8, Math.max(5, event.eventDetails.expectedAttendance / 4_000));
            const style = {
              '--node-color': RISK_COLOR[level],
              '--node-delay': `${320 + index * 90}ms`,
            } as MotionStyle;
            return (
              <g key={event.eventId} transform={`translate(${point.x} ${point.y})`} className="radar-node" style={style}>
                <title>{`${event.eventDetails.name}: ${level}${assessment ? `, final score ${assessment.finalScore}` : ''}`}</title>
                <circle className="radar-node__glow" r={radius + 9} fill={RISK_COLOR[level]} filter="url(#radar-glow)" />
                <circle className="radar-node__halo" r={radius + 5} />
                <circle className="radar-node__core" r={radius} />
                <text y="0.5">{index + 1}</text>
              </g>
            );
          })}

          <g className="radar-origin" transform="translate(220 150)" aria-hidden="true">
            <circle r="18" />
            <path d="M0-8L3-3L8 0L3 3L0 8L-3 3L-8 0L-3-3Z" />
          </g>
        </svg>

        <img src={logoMark} alt="" className="operational-radar__mark" />

        <div className="radar-coordinates" aria-hidden="true">
          <span>MY · 03.1390° N</span>
          <span>101.6869° E</span>
        </div>
      </div>

      <div className="operational-radar__footer">
        <span><i className="is-high" /> High {activeHighRisk}</span>
        <span><i className="is-medium" /> Medium {queue.filter(({ assessment }) => assessment?.finalRiskLevel === 'Medium').length}</span>
        <span><i className="is-low" /> Low {queue.filter(({ assessment }) => assessment?.finalRiskLevel === 'Low').length}</span>
      </div>
    </div>
  );
}

function PriorityRegister({ queue }: { queue: DashboardRecord[] }) {
  return (
    <section className="priority-register" aria-labelledby="priority-register-title">
      <h3 id="priority-register-title" className="sr-only">Applications sorted by review priority</h3>
      <div className="priority-register__head" aria-hidden="true">
        <span>No.</span><span>Application</span><span>Event date</span><span>Attendance</span><span>Final risk</span><span />
      </div>
      {queue.length === 0 ? (
        <div className="priority-register__clear">
          <ShieldCheck size={25} aria-hidden="true" />
          <strong>The active review register is clear.</strong>
          <span>New assigned applications will surface here automatically.</span>
        </div>
      ) : (
        <ol>
          {queue.map((record, index) => (
            <PriorityRow key={record.event.eventId} record={record} index={index} />
          ))}
        </ol>
      )}
      <Link to="/authority/applications" className="priority-register__footer">
        <span>Browse the complete register</span>
        <span>All applications <ArrowUpRight size={15} aria-hidden="true" /></span>
      </Link>
    </section>
  );
}

function PriorityRow({ record: { event, assessment }, index }: { record: DashboardRecord; index: number }) {
  return (
    <li className={index === 0 ? 'is-first' : ''} style={{ '--motion-order': index } as MotionStyle}>
      <Link to={`/authority/events/${event.eventId}`} className="priority-row">
        <span className="priority-row__signal" aria-hidden="true" />
        <span className="priority-row__number">{String(index + 1).padStart(2, '0')}</span>
        <div className="priority-row__event">
          <div>
            <h3>{event.eventDetails.name}</h3>
            {index === 0 && <span className="priority-row__first-label">Review first</span>}
            <StatusBadge status={event.status} />
          </div>
          <p><MapPin size={12} aria-hidden="true" />{event.eventDetails.venueName}</p>
        </div>
        <p className="priority-row__datum">
          <span>Event date</span>
          <strong><CalendarClock size={13} aria-hidden="true" />{format(event.eventDetails.startDatetime, 'd MMM yyyy')}</strong>
        </p>
        <p className="priority-row__datum">
          <span>Attendance</span>
          <strong><Users size={13} aria-hidden="true" />{event.eventDetails.expectedAttendance.toLocaleString('en-MY')}</strong>
        </p>
        <div className="priority-row__risk">
          <span>Final risk</span>
          {assessment ? (
            <div>
              <RiskMeter level={assessment.finalRiskLevel} size="compact" />
              <strong>{assessment.finalScore}<small>/100</small></strong>
            </div>
          ) : (
            <strong className="is-pending">Pending score</strong>
          )}
        </div>
        <ChevronRight className="priority-row__arrow" size={18} aria-hidden="true" />
      </Link>
    </li>
  );
}

function RiskIntelligence({ risks }: { risks: ReturnType<typeof riskDistribution> }) {
  const assessed = risks.Low + risks.Medium + risks.High;
  return (
    <section className="insight-panel risk-intelligence" aria-labelledby="risk-intelligence-title">
      <div className="insight-panel__heading">
        <div>
          <p>Risk intelligence</p>
          <h2 id="risk-intelligence-title">Final risk profile</h2>
        </div>
        <Activity size={18} aria-hidden="true" />
      </div>
      <div className="risk-intelligence__body">
        <RiskRing risks={risks} assessed={assessed} />
        <dl>
          <RiskCount label="Low" value={risks.Low} color="is-low" />
          <RiskCount label="Medium" value={risks.Medium} color="is-medium" />
          <RiskCount label="High" value={risks.High} color="is-high" />
          <RiskCount label="Unassessed" value={risks.Unassessed} color="is-unassessed" />
        </dl>
      </div>
    </section>
  );
}

function RiskRing({ risks, assessed }: { risks: ReturnType<typeof riskDistribution>; assessed: number }) {
  const values: { value: number; color: string; level: RiskLevel }[] = [
    { value: risks.Low, color: '#46a85d', level: 'Low' },
    { value: risks.Medium, color: '#eeb321', level: 'Medium' },
    { value: risks.High, color: '#e94a50', level: 'High' },
  ];
  const circumference = 2 * Math.PI * 44;
  let consumed = 0;

  return (
    <div
      className="risk-orbit"
      role="img"
      aria-label={`${assessed} assessed applications: ${risks.Low} low, ${risks.Medium} medium, ${risks.High} high risk`}
    >
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="44" fill="none" stroke="#e7e4d9" strokeWidth="12" />
        {values.map((segment) => {
          const length = assessed ? (segment.value / assessed) * circumference : 0;
          const circle = (
            <circle
              key={segment.level}
              className="risk-orbit__segment"
              cx="60"
              cy="60"
              r="44"
              fill="none"
              stroke={segment.color}
              strokeWidth="12"
              strokeDasharray={`${Math.max(0, length - 2)} ${circumference}`}
              strokeDashoffset={-consumed}
            />
          );
          consumed += length;
          return circle;
        })}
      </svg>
      <div>
        <strong>{assessed}</strong>
        <span>assessed</span>
      </div>
    </div>
  );
}

function RiskCount({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="risk-count">
      <dt><span className={color} />{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function StatusLedger({ statuses, total }: { statuses: ReturnType<typeof statusDistribution>; total: number }) {
  const rows = [
    { label: 'Pending', value: statuses.Pending, color: 'is-pending' },
    { label: 'Under review', value: statuses.UnderReview, color: 'is-review' },
    { label: 'Amendment', value: statuses.AmendmentRequested, color: 'is-amendment' },
    { label: 'Approved', value: statuses.Approved, color: 'is-approved' },
    { label: 'Rejected', value: statuses.Rejected, color: 'is-rejected' },
  ];

  return (
    <section className="status-ledger" aria-labelledby="status-ledger-title">
      <div className="status-ledger__heading">
        <div><p>Workflow</p><h2 id="status-ledger-title">Application status</h2></div>
        <span>{total} assigned</span>
      </div>
      <div className="status-ledger__rows">
        {rows.map((row, index) => {
          const width = total ? (row.value / total) * 100 : 0;
          return (
            <div key={row.label} className="status-row">
              <span>{row.label}</span>
              <span className="status-row__track">
                <span
                  className={`status-row__fill ${row.color}`}
                  style={{ '--progress': `${width}%`, minWidth: row.value > 0 ? '2px' : 0, '--motion-order': index } as MotionStyle}
                />
              </span>
              <strong>{row.value}</strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AssessmentReadiness({ summary }: { summary: ReturnType<typeof dashboardSummary> }) {
  return (
    <section className="readiness-strip dashboard-enter" style={{ '--motion-order': 7 } as MotionStyle}>
      <div className="readiness-strip__copy">
        <span><ShieldCheck size={18} aria-hidden="true" /></span>
        <div>
          <h2>Assessment readiness</h2>
          <p>{summary.unassessed === 0
            ? 'Every assigned event has a current final risk assessment.'
            : `${summary.unassessed} application${summary.unassessed === 1 ? '' : 's'} still awaiting a final risk assessment.`}</p>
        </div>
      </div>
      <dl>
        <Pulse label="Awaiting" value={summary.unassessed} />
        <Pulse label="Reviewing" value={summary.underReview} />
        <Pulse label="Resolved" value={summary.resolved} />
      </dl>
    </section>
  );
}

function Pulse({ label, value }: { label: string; value: number }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton" role="status" aria-busy="true">
      <span className="sr-only">Loading dashboard</span>
      <div className="dashboard-skeleton__hero skeleton-surface" />
      <div className="dashboard-skeleton__heading skeleton-surface" />
      <div className="dashboard-skeleton__grid">
        <div className="skeleton-surface" />
        <div className="skeleton-surface" />
      </div>
    </div>
  );
}
