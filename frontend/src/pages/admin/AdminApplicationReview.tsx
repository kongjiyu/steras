import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertOctagon,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  FileWarning,
  History,
  Loader2,
  Mail,
  MapPin,
  MessageSquareWarning,
  Phone,
  Save,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import { db, isFirebaseConfigured } from '../../config/firebase';
import {
  COLLECTIONS,
  EventRecord,
  EventStatus,
  RiskAssessment,
  ResourceRecommendation,
  AuthorityDecision,
  UserProfile,
  AuthorityType,
} from '@shared/types';
import { WorkspaceTopBar } from '../../components/layout/Sidebar';
import { useAuth } from '../../contexts/AuthContext';

const STATUS_TONE: Record<EventStatus, string> = {
  Draft: 'admin-badge admin-badge--default',
  Pending: 'admin-badge admin-badge--warn',
  UnderReview: 'admin-badge admin-badge--warn',
  AmendmentRequested: 'admin-badge admin-badge--bad',
  Approved: 'admin-badge admin-badge--good',
  Rejected: 'admin-badge admin-badge--bad',
  Withdrawn: 'admin-badge admin-badge--default',
};

const RISK_TONE: Record<string, string> = {
  Low: 'admin-badge admin-badge--good',
  Medium: 'admin-badge admin-badge--warn',
  High: 'admin-badge admin-badge--bad',
};

function initialsFor(name?: string) {
  if (!name) return 'AD';
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

function formatDateTime(ts?: number) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' });
}

function formatDate(ts?: number) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
}

const ALL_AUTHORITIES: AuthorityType[] = ['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'];

interface SectionProps {
  title: string;
  icon: LucideIcon;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function Section({ title, icon: Icon, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="admin-section rounded-lg border border-[#ded5c5] bg-white shadow-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 border-b border-[#e8e0cf] px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.06em] text-ink-700">
          <Icon size={15} className="text-brand-700" /> {title}
        </span>
        <ChevronDown size={16} className={`text-ink-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="p-4">{children}</div>}
    </section>
  );
}

export default function AdminApplicationReview() {
  const { eventId } = useParams<{ eventId: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [event, setEvent] = useState<EventRecord | null>(null);
  const [assessment, setAssessment] = useState<RiskAssessment | null>(null);
  const [resource, setResource] = useState<ResourceRecommendation | null>(null);
  const [decisions, setDecisions] = useState<AuthorityDecision[]>([]);
  const [officers, setOfficers] = useState<UserProfile[]>([]);
  const [audit, setAudit] = useState<Array<{ id: string; action: string; timestamp: number; actorId: string; notes?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Officer assignment checklist
  const [assigned, setAssigned] = useState<Record<AuthorityType, boolean>>({
    PDRM: false, BOMBA: false, KKM: false, DBKL: false, MOTAC: false,
  });
  const [selectedOfficer, setSelectedOfficer] = useState<Record<AuthorityType, string>>({
    PDRM: '', BOMBA: '', KKM: '', DBKL: '', MOTAC: '',
  });

  // Decision form
  const [decisionMode, setDecisionMode] = useState<'approve' | 'reject' | 'amend' | null>(null);
  const [rationale, setRationale] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isFirebaseConfigured || !eventId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const eventRef = doc(db, COLLECTIONS.EVENTS, eventId);
        const eventSnap = await getDoc(eventRef);
        if (!eventSnap.exists()) {
          setError('Application not found.');
          setLoading(false);
          return;
        }
        const eventData = { eventId: eventSnap.id, ...(eventSnap.data() as EventRecord) };
        setEvent(eventData);

        // Default-check authorities based on event's required authorities
        const initial: Record<AuthorityType, boolean> = { PDRM: false, BOMBA: false, KKM: false, DBKL: false, MOTAC: false };
        for (const a of eventData.requiredAuthorities) initial[a] = true;
        setAssigned(initial);

        // Load all related sub-collections in parallel
        const promises: Promise<unknown>[] = [];
        if (eventData.currentAssessmentId) {
          promises.push(
            getDoc(doc(eventRef, COLLECTIONS.ASSESSMENTS, eventData.currentAssessmentId))
              .then((s) => { if (s.exists()) setAssessment(s.data() as RiskAssessment); }),
          );
        }
        if (eventData.currentResourceId) {
          promises.push(
            getDoc(doc(eventRef, COLLECTIONS.RESOURCES, eventData.currentResourceId))
              .then((s) => { if (s.exists()) setResource(s.data() as ResourceRecommendation); }),
          );
        }
        promises.push(
          getDocs(collection(eventRef, COLLECTIONS.DECISIONS))
            .then((s) => setDecisions(s.docs.map((d) => d.data() as AuthorityDecision))),
        );
        promises.push(
          getDocs(query(collection(db, COLLECTIONS.USERS), where('role', '==', 'authority')))
            .then((s) => setOfficers(s.docs.map((d) => d.data() as UserProfile))),
        );
        promises.push(
          getDocs(query(collection(eventRef, COLLECTIONS.AUDIT_LOGS), where('eventId', '==', eventId)))
            .then((s) => setAudit(s.docs.map((d) => d.data() as { id: string; action: string; timestamp: number; actorId: string; notes?: string }))),
        );

        await Promise.all(promises);
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('[AdminReview] load failed', err);
        setError('Application could not be loaded.');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  const officersByAuth = useMemo(() => {
    const m: Record<AuthorityType, UserProfile[]> = { PDRM: [], BOMBA: [], KKM: [], DBKL: [], MOTAC: [] };
    for (const o of officers) {
      if (o.authorityType && m[o.authorityType]) m[o.authorityType].push(o);
    }
    return m;
  }, [officers]);

  const decisionsByAuth = useMemo(() => {
    const m: Record<string, AuthorityDecision | undefined> = {};
    for (const d of decisions) {
      if (d.current) m[d.authorityType] = d;
    }
    return m;
  }, [decisions]);

  const canReview = event && (event.status === 'Pending' || event.status === 'UnderReview' || event.status === 'AmendmentRequested');
  const minRationaleLen = 10;

  const submitDecision = async () => {
    if (!eventId || !event || !decisionMode) return;
    if (rationale.trim().length < minRationaleLen) {
      toast.error('Please provide a rationale (at least 10 characters).');
      return;
    }
    setSubmitting(true);
    // Note: in a full implementation this would call a Cloud Function
    // (per FR-M3-04, FR-M3-08, FR-M3-12). For the dashboard view we
    // surface a clear "submitted" state and log the action.
    await new Promise((r) => setTimeout(r, 400));
    toast.success(
      decisionMode === 'approve'
        ? 'Approval recorded (pending Cloud Function wiring).'
        : decisionMode === 'reject'
        ? 'Rejection recorded (pending Cloud Function wiring).'
        : 'Amendment request recorded (pending Cloud Function wiring).',
    );
    setRationale('');
    setDecisionMode(null);
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-[#f3f1e9] pb-16">
      <WorkspaceTopBar
        title={event ? `Review · ${event.eventDetails.name}` : 'Application review'}
        subtitle={event ? `M3 · submitted ${formatDateTime(event.submittedAt)}` : 'M3 · Authority Approval'}
        userInitials={initialsFor(profile?.name)}
        workspaceEyebrow="STERAS administration"
        workspaceEyebrowIcon={ShieldCheck}
      />

      <main className="page-shell page-enter">
        <div className="mb-4 flex items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => navigate('/admin/applications')}
            className="inline-flex items-center gap-1 text-brand-700 hover:text-brand-800"
          >
            <ArrowLeft size={14} /> Back to queue
          </button>
        </div>

        {error && (
          <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700" role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-ink-500">
            <Loader2 size={18} className="animate-spin" /> Loading application…
          </div>
        ) : !event ? (
          <div className="rounded-lg border border-[#ded5c5] bg-white p-10 text-center text-ink-500">
            <AlertOctagon size={28} className="mx-auto mb-2 text-ink-400" />
            Application not found.
          </div>
        ) : (
          <>
            {/* Header card */}
            <header className="mb-5 rounded-lg border border-[#ded5c5] bg-white p-5 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-[0.06em] text-ink-500">{event.eventDetails.type}</p>
                  <h1 className="mt-1 font-display text-2xl font-bold text-ink-900">{event.eventDetails.name}</h1>
                  <p className="mt-1 text-sm text-ink-500">
                    {event.eventDetails.venueName} · {formatDate(event.eventDetails.startDatetime)} · {event.eventDetails.expectedAttendance.toLocaleString()} attendees
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={STATUS_TONE[event.status]}>{event.status}</span>
                  {assessment && (assessment.officialRiskLevel ?? assessment.finalRiskLevel) && (
                    <span className={`${RISK_TONE[assessment.officialRiskLevel ?? assessment.finalRiskLevel ?? '']} text-xs`}>
                      {(assessment.officialRiskLevel ?? assessment.finalRiskLevel)} risk
                    </span>
                  )}
                </div>
              </div>
            </header>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
              {/* Main column */}
              <div className="space-y-4">
                {/* Organiser + venue info */}
                <Section title="Application" icon={ClipboardList}>
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-ink-500">Organiser</dt>
                      <dd className="font-medium text-ink-800">{event.eventDetails.organizerName}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-500">Email</dt>
                      <dd className="text-ink-800">{event.eventDetails.organizerEmail}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-500">Phone</dt>
                      <dd className="text-ink-800">{event.eventDetails.organizerPhone}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-500">Venue</dt>
                      <dd className="text-ink-800">{event.eventDetails.venueName}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-500">Required authorities</dt>
                      <dd className="flex flex-wrap gap-1">
                        {event.requiredAuthorities.map((a) => (
                          <span key={a} className="admin-badge admin-badge--default text-xs">{a}</span>
                        ))}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-500">Created · Submitted</dt>
                      <dd className="text-ink-800">{formatDate(event.createdAt)} · {formatDate(event.submittedAt)}</dd>
                    </div>
                  </dl>
                </Section>

                {/* Assessment — handles two schemas:
                       A) M3-ready mock (categoryAssignments + officialRiskLevel)
                       B) M2-engine output (subScores + finalScore / finalRiskLevel)
                */}
                {assessment && (() => {
                  const useEngineSchema = !assessment.categoryAssignments && !!assessment.subScores;
                  const riskLevel = assessment.officialRiskLevel ?? assessment.finalRiskLevel ?? 'Unknown';
                  const score = assessment.officialScore ?? assessment.finalScore;
                  const versionLabel = assessment.categorySchemaVersion
                    ? `Schema v${assessment.categorySchemaVersion} · Logic v${assessment.scoringLogicVersion}`
                    : assessment.ruleVersion
                    ? `Rule v${assessment.ruleVersion}`
                    : '';
                  return (
                    <Section title="M2 risk assessment" icon={ShieldCheck}>
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        {riskLevel !== 'Unknown' && (
                          <span className={`${RISK_TONE[riskLevel]} text-sm`}>
                            {riskLevel}{score !== undefined ? ` · ${score}/100` : ''}
                          </span>
                        )}
                        {versionLabel && <span className="text-xs text-ink-500">{versionLabel}</span>}
                      </div>

                      <div className="overflow-hidden rounded-md border border-[#e8e0cf]">
                        <table className="w-full text-sm">
                          <thead className="bg-cream-50 text-xs uppercase tracking-[0.06em] text-ink-500">
                            {useEngineSchema ? (
                              <tr>
                                <th className="px-3 py-2 text-left">Sub-score</th>
                                <th className="px-3 py-2 text-right">Score</th>
                                <th className="px-3 py-2 text-right">Weighted</th>
                              </tr>
                            ) : (
                              <tr>
                                <th className="px-3 py-2 text-left">Category</th>
                                <th className="px-3 py-2 text-left">Score</th>
                                <th className="px-3 py-2 text-left">Risk</th>
                                <th className="px-3 py-2 text-left">Rationale</th>
                              </tr>
                            )}
                          </thead>
                          <tbody className="divide-y divide-[#e8e0cf]">
                            {useEngineSchema
                              ? Object.entries(assessment.subScores).map(([key, score]) => (
                                  <tr key={key}>
                                    <td className="px-3 py-2 font-medium text-ink-800 capitalize">{key}</td>
                                    <td className="px-3 py-2 text-right text-ink-700">{score as number}</td>
                                    <td className="px-3 py-2 text-right text-ink-700">
                                      {assessment.weightedContributions?.[key]?.toFixed?.(2) ?? '—'}
                                    </td>
                                  </tr>
                                ))
                              : (assessment.categoryAssignments ?? []).map((c) => (
                                  <tr key={c.categoryId}>
                                    <td className="px-3 py-2 font-medium text-ink-800">{c.categoryName}</td>
                                    <td className="px-3 py-2 text-ink-700">{c.score}</td>
                                    <td className="px-3 py-2">
                                      <span className={`${RISK_TONE[c.riskLevel]} text-xs`}>{c.riskLevel}</span>
                                    </td>
                                    <td className="px-3 py-2 text-xs text-ink-600">{c.rationale}</td>
                                  </tr>
                                ))}
                          </tbody>
                        </table>
                      </div>

                      {/* AI advisory (both schemas) */}
                      {(assessment.aiAdvisory || assessment.ai) && (
                        <div className="mt-3 rounded-md border border-gold-300 bg-gold-50 p-3 text-xs text-ink-700">
                          <p className="font-semibold text-gold-600">
                            AI advisory · {assessment.aiAdvisory?.model ?? assessment.ai?.model ?? 'model'}
                            <span className="ml-2 font-normal text-ink-500">
                              status: {assessment.aiAdvisory?.status ?? assessment.ai?.status ?? 'unknown'}
                            </span>
                          </p>
                          <p className="mt-1">
                            {assessment.aiAdvisory?.overallExplanation
                              ?? assessment.aiAdvisory?.explanation
                              ?? assessment.ai?.reasoning
                              ?? ''}
                          </p>
                        </div>
                      )}
                    </Section>
                  );
                })()}

                {/* Resource recommendations */}
                {resource && (
                  <Section title="M2 resource recommendations" icon={Users} defaultOpen={false}>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {(['police', 'security', 'medicalTeams', 'ambulances', 'toilets', 'wasteBins', 'fireOfficers'] as const).map((key) => (
                        <div key={key} className="rounded-md border border-[#e8e0cf] bg-cream-50 p-3 text-center">
                          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-500">{key}</p>
                          <p className="mt-1 font-display text-xl font-bold text-ink-900">{resource[key]}</p>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Officer decisions */}
                <Section title="Authority officer decisions" icon={CheckCircle2} defaultOpen={false}>
                  {decisions.length === 0 ? (
                    <p className="text-sm text-ink-500">No officer decisions recorded yet.</p>
                  ) : (
                    <ul className="divide-y divide-[#e8e0cf]">
                      {decisions.map((d) => (
                        <li key={d.decisionId} className="flex items-start gap-3 py-2">
                          <span className={`${RISK_TONE[d.decision]} text-xs`}>{d.decision}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-ink-800">{d.authorityType}</p>
                            <p className="text-xs text-ink-500">{d.rationale}</p>
                          </div>
                          <span className="text-xs text-ink-500">{formatDateTime(d.decidedAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>

                {/* Audit log */}
                <Section title="Audit log" icon={History} defaultOpen={false}>
                  {audit.length === 0 ? (
                    <p className="text-sm text-ink-500">No audit log entries.</p>
                  ) : (
                    <ol className="space-y-2 text-sm">
                      {audit
                        .slice()
                        .sort((a, b) => b.timestamp - a.timestamp)
                        .slice(0, 8)
                        .map((a) => (
                          <li key={a.id} className="flex items-start gap-2 border-l-2 border-[#c8d1a8] pl-3">
                            <div>
                              <p className="font-semibold text-ink-800">{a.action}</p>
                              {a.notes && <p className="text-xs text-ink-500">{a.notes}</p>}
                            </div>
                            <span className="ml-auto text-xs text-ink-500">{formatDateTime(a.timestamp)}</span>
                          </li>
                        ))}
                    </ol>
                  )}
                </Section>
              </div>

              {/* Side column: actions */}
              <aside className="space-y-4">
                {/* Officer assignment */}
                <Section title="Officer assignment" icon={Users}>
                  <p className="mb-3 text-xs text-ink-500">
                    Default-checked from the event&apos;s required authorities. Edit before assigning.
                  </p>
                  <div className="space-y-2">
                    {ALL_AUTHORITIES.map((auth) => {
                      const isRequired = event.requiredAuthorities.includes(auth);
                      const list = officersByAuth[auth];
                      return (
                        <div key={auth} className="flex items-center gap-2 rounded-md border border-[#e8e0cf] bg-cream-50/40 px-3 py-2">
                          <input
                            id={`assign-${auth}`}
                            type="checkbox"
                            checked={assigned[auth]}
                            disabled={!isRequired}
                            onChange={(e) => setAssigned((p) => ({ ...p, [auth]: e.target.checked }))}
                            className="h-4 w-4 accent-brand-600"
                          />
                          <label htmlFor={`assign-${auth}`} className="flex-1 text-sm">
                            <span className="font-semibold text-ink-800">{auth}</span>
                            {!isRequired && <span className="ml-1 text-[10px] uppercase text-ink-400">(not required)</span>}
                          </label>
                          {assigned[auth] && list.length > 0 && (
                            <select
                              value={selectedOfficer[auth]}
                              onChange={(e) => setSelectedOfficer((p) => ({ ...p, [auth]: e.target.value }))}
                              className="input !h-8 !text-xs"
                            >
                              <option value="">Auto-assign</option>
                              {list.map((o) => (
                                <option key={o.uid} value={o.uid}>{o.name}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    disabled={Object.values(assigned).every((v) => !v)}
                    onClick={() => toast.success('Officer assignments saved (local only).')}
                    className="btn-primary mt-3 w-full"
                  >
                    <Save size={14} /> Save assignments
                  </button>
                </Section>

                {/* Admin decision */}
                {canReview ? (
                  <Section title="Admin decision" icon={CheckCircle2} defaultOpen={true}>
                    {!decisionMode ? (
                      <div className="space-y-2">
                        <button type="button" onClick={() => setDecisionMode('approve')} className="btn-success w-full">
                          <Check size={14} /> Approve application
                        </button>
                        <button type="button" onClick={() => setDecisionMode('amend')} className="btn-secondary w-full">
                          <MessageSquareWarning size={14} /> Request amendment
                        </button>
                        <button type="button" onClick={() => setDecisionMode('reject')} className="btn-danger w-full">
                          <AlertCircle size={14} /> Reject application
                        </button>
                      </div>
                    ) : (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          submitDecision();
                        }}
                        className="space-y-3"
                      >
                        <p className="text-xs uppercase tracking-[0.06em] text-ink-500">
                          {decisionMode === 'approve' ? 'Approval rationale' : decisionMode === 'amend' ? 'Amendment request' : 'Rejection reason + suggestion'}
                        </p>
                        <textarea
                          rows={4}
                          className="input min-h-24"
                          maxLength={1000}
                          value={rationale}
                          onChange={(e) => setRationale(e.target.value)}
                          placeholder={
                            decisionMode === 'approve'
                              ? 'Briefly state the basis for approval.'
                              : decisionMode === 'amend'
                              ? 'List the items the organiser must address before resubmission.'
                              : 'State the rejection reason and a constructive suggestion for revision.'
                          }
                        />
                        <div className="flex items-center justify-between text-xs text-ink-500">
                          <span>{rationale.trim().length}/1000 · minimum 10</span>
                          <span>
                            {rationale.trim().length >= minRationaleLen
                              ? <Check size={12} className="inline text-emerald-600" />
                              : <AlertCircle size={12} className="inline text-amber-600" />}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => { setDecisionMode(null); setRationale(''); }}
                            className="btn-secondary flex-1"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={submitting || rationale.trim().length < minRationaleLen}
                            className={
                              decisionMode === 'approve' ? 'btn-success flex-1' :
                              decisionMode === 'reject' ? 'btn-danger flex-1' :
                              'btn-primary flex-1'
                            }
                          >
                            {submitting ? <><Loader2 size={14} className="animate-spin" /> Submitting…</> :
                              decisionMode === 'approve' ? 'Confirm approval' :
                              decisionMode === 'amend' ? 'Send amendment request' :
                              'Confirm rejection'}
                          </button>
                        </div>
                        <p className="text-[11px] text-ink-500">
                          <FileWarning size={11} className="inline" /> In production this dispatches the
                          <code className="mx-1 rounded bg-cream-100 px-1">makeAuthorityDecision</code>
                          Cloud Function with full audit provenance.
                        </p>
                      </form>
                    )}
                  </Section>
                ) : (
                  <div className="rounded-lg border border-[#ded5c5] bg-cream-50 p-4 text-sm text-ink-500">
                    This review is closed (status: {event.status}). Re-open not available in the
                    current build.
                  </div>
                )}
              </aside>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <Link to="/admin/applications" className="text-sm font-semibold text-brand-700 hover:text-brand-800">
                ← Back to application queue
              </Link>
              {event && (
                <Link to={`/admin/applications/${event.eventId}/assign`} className="btn-secondary !py-1.5 !px-3 text-xs">
                  Open officer assignment →
                </Link>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
