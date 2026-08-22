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
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import { db, functions, isFirebaseConfigured } from '../../config/firebase';
import {
  COLLECTIONS,
  EventRecord,
  EventStatus,
  RiskAssessment,
  ResourceRecommendation,
  ResourceQuantities,
  AuthorityDecision,
  Assignment,
  UserProfile,
  AuthorityType,
  RiskLevel,
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
  'Manual Review Required': 'admin-badge admin-badge--warn',
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

interface AdminAssessmentCategory {
  categoryId: string;
  categoryName: string;
  matrixScore: number;
  riskLevel: string;
  rationale: string;
}

function assessmentDisplay(assessment: RiskAssessment): {
  riskLevel: string;
  score?: number;
  schemaVersion?: string;
  formulaVersion?: string;
  categories: AdminAssessmentCategory[];
} {
  const result = assessment.status === 'official_ready'
    ? assessment.officialResult
    : 'provisionalResult' in assessment ? assessment.provisionalResult : undefined;
  return {
    riskLevel: result?.overallRiskLevel ?? 'Medium',
    score: result?.overallScore,
    schemaVersion: result?.categorySchemaVersion,
    formulaVersion: result?.formulaVersion,
    categories: result?.categories.map((category) => ({
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      matrixScore: category.matrixScore,
      riskLevel: category.riskLevel,
      rationale: category.rationale,
    })) ?? [],
  };
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
  const [assignments, setAssignments] = useState<Assignment[]>([]);
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
  const [decisionMode, setDecisionMode] = useState<'approve' | 'reject' | null>(null);
  const [rationale, setRationale] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [attachOfficerFeedback, setAttachOfficerFeedback] = useState(true);
  const [manualScore, setManualScore] = useState('50');
  const [manualRiskLevel, setManualRiskLevel] = useState<RiskLevel>('Medium');
  const [manualRationale, setManualRationale] = useState('');
  const [manualInputs, setManualInputs] = useState('{"assessmentBasis":"Admin review"}');
  const [manualResources, setManualResources] = useState<ResourceQuantities>({
    police: 0, medicalTeams: 0, ambulances: 0, toilets: 0, wasteBins: 0, security: 0, fireOfficers: 0,
  });
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
        const eventData = { ...(eventSnap.data() as EventRecord), eventId: eventSnap.id };
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
          getDocs(collection(eventRef, COLLECTIONS.ASSIGNMENTS))
            .then((s) => setAssignments(s.docs.map((d) => ({ ...(d.data() as Assignment), assignmentId: d.id })))),
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

  const canReview = event && (event.status === 'Pending' || event.status === 'UnderReview' || event.status === 'AmendmentRequested' || event.status === 'Manual Review Required');
  const initialReviewOpen = Boolean(canReview && !event?.initialReview && !event?.assignedOfficerUids?.length && !['authority', 'second', 'closed'].includes(event?.reviewStage ?? ''));
  const attachableOfficerFeedback = assignments.filter((assignment) => Boolean(assignment.decision && assignment.reason && assignment.versionId === event?.currentVersionId));
  const minRationaleLen = 10;

  const submitDecision = async () => {
    if (!eventId || !event || !decisionMode || !initialReviewOpen) return;
    if (rationale.trim().length < minRationaleLen) {
      toast.error('Please provide a rationale (at least 10 characters).');
      return;
    }
    if (decisionMode === 'reject' && suggestion.trim().length === 0) {
      toast.error('A suggestion is required when rejecting.');
      return;
    }
    let manualAssessment: {
      score: number;
      riskLevel: RiskLevel;
      inputs: Record<string, string | number | boolean>;
      rationale: string;
      resourceQuantities: ResourceQuantities;
    } | undefined;
    if (event.status === 'Manual Review Required') {
      const score = Number(manualScore);
      if (!Number.isFinite(score) || score < 0 || score > 100 || manualRationale.trim().length < minRationaleLen) {
        toast.error('Enter a manual score from 0–100 and a manual assessment rationale.');
        return;
      }
      try {
        const parsed = JSON.parse(manualInputs) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON must be an object.');
        manualAssessment = {
          score,
          riskLevel: manualRiskLevel,
          inputs: parsed as Record<string, string | number | boolean>,
          rationale: manualRationale.trim(),
          resourceQuantities: manualResources,
        };
      } catch {
        toast.error('Manual assessment inputs must be a JSON object.');
        return;
      }
    }
    setSubmitting(true);
    try {
      const decision = decisionMode === 'approve' ? 'Approved' : 'Rejected';
      const command = httpsCallable<{
        eventId: string;
        decision: 'Approved' | 'Rejected';
        reason: string;
        suggestion?: string;
        attachOfficerFeedback?: boolean;
        manualAssessment?: typeof manualAssessment;
      }, { status: EventStatus; decision: 'Approved' | 'Rejected' }>(functions, 'makeInitialReviewDecision');
      await command({
        eventId,
        decision,
        reason: rationale.trim(),
        ...(suggestion.trim() ? { suggestion: suggestion.trim() } : {}),
        ...(decision === 'Rejected' && attachOfficerFeedback ? { attachOfficerFeedback: true } : {}),
        ...(manualAssessment ? { manualAssessment } : {}),
      });
      toast.success(decision === 'Approved' ? 'Application released for authority assignment.' : 'Application rejected and feedback sent.');
      setRationale('');
      setSuggestion('');
      setManualRationale('');
      setDecisionMode(null);
      setEvent((current) => current ? {
        ...current,
        status: decision === 'Approved' ? 'UnderReview' : 'Rejected',
        reviewStage: decision === 'Approved' ? 'initial' : 'closed',
        initialReview: { decision, reason: rationale.trim(), ...(suggestion.trim() ? { suggestion: suggestion.trim() } : {}), reviewerUid: profile?.uid ?? '', reviewedAt: Date.now(), manualAssessmentRecorded: Boolean(manualAssessment) },
      } : current);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to record the initial review.');
    } finally {
      setSubmitting(false);
    }
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
                  {assessment && (
                    <span className={`${RISK_TONE[assessmentDisplay(assessment).riskLevel]} text-xs`}>
                      {assessmentDisplay(assessment).riskLevel} risk
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

                {/* Current M2 deterministic assessment and advisory. */}
                {assessment && (() => {
                  const display = assessmentDisplay(assessment);
                  const riskLevel = display.riskLevel;
                  const score = display.score;
                  const versionLabel = display.schemaVersion
                    ? `Schema v${display.schemaVersion} · Logic v${display.formulaVersion}`
                    : '';
                  return (
                    <Section title="M2 risk assessment" icon={ShieldCheck}>
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className={`${RISK_TONE[riskLevel]} text-sm`}>
                          {riskLevel}{score !== undefined ? ` · ${score}/100` : ''}
                        </span>
                        {versionLabel && <span className="text-xs text-ink-500">{versionLabel}</span>}
                      </div>

                      <div className="overflow-hidden rounded-md border border-[#e8e0cf]">
                        <table className="w-full text-sm">
                          <thead className="bg-cream-50 text-xs uppercase tracking-[0.06em] text-ink-500">
                            <tr>
                              <th className="px-3 py-2 text-left">Category</th>
                              <th className="px-3 py-2 text-left">Score</th>
                              <th className="px-3 py-2 text-left">Risk</th>
                              <th className="px-3 py-2 text-left">Rationale</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#e8e0cf]">
                            {display.categories.map((c) => (
                                  <tr key={c.categoryId}>
                                    <td className="px-3 py-2 font-medium text-ink-800">{c.categoryName}</td>
                                    <td className="px-3 py-2 text-ink-700">{c.matrixScore}</td>
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
                      {assessment.aiProposal && (
                        <div className="mt-3 rounded-md border border-gold-300 bg-gold-50 p-3 text-xs text-ink-700">
                          <p className="font-semibold text-gold-600">
                            AI proposal · {assessment.aiProposal.model}
                            <span className="ml-2 font-normal text-ink-500">
                              status: {assessment.aiProposal.status}
                            </span>
                          </p>
                          <p className="mt-1">The assessment retains the AI proposal as provenance; the displayed score is calculated by the deterministic M2 rules.</p>
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
                          <p className="mt-1 font-display text-xl font-bold text-ink-900">{resource.items[key].baseline}</p>
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
                  <Link to={`/admin/applications/${event.eventId}/assign`} className="btn-primary mt-3 w-full">
                    <Users size={14} /> Open assignment checklist
                  </Link>
                </Section>

                {/* Admin decision */}
                {initialReviewOpen ? (
                  <Section title="Admin decision" icon={CheckCircle2} defaultOpen={true}>
                    {!decisionMode ? (
                      <div className="space-y-2">
                        <button type="button" onClick={() => setDecisionMode('approve')} className="btn-success w-full">
                          <Check size={14} /> Approve application
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
                          {decisionMode === 'approve' ? 'Approval rationale' : 'Rejection reason + suggestion'}
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
                        {decisionMode === 'reject' && (
                          <div className="space-y-2">
                            <label className="block text-xs font-semibold text-ink-600">
                              Corrective suggestion (required)
                              <textarea className="input mt-1 min-h-20" maxLength={1000} value={suggestion} onChange={(e) => setSuggestion(e.target.value)} placeholder="Tell the organiser what must change before resubmission." />
                            </label>
                            <label className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${attachOfficerFeedback && attachableOfficerFeedback.length > 0 ? 'border-brand-300 bg-brand-50/50' : 'border-ink-200 bg-cream-50'}`}>
                              <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4 accent-brand-600"
                                checked={attachOfficerFeedback}
                                disabled={attachableOfficerFeedback.length === 0}
                                onChange={(e) => setAttachOfficerFeedback(e.target.checked)}
                              />
                              <span>
                                <span className="block font-semibold text-ink-700">Attach completed officer feedback</span>
                                <span className="block text-ink-500">
                                  {attachableOfficerFeedback.length > 0
                                    ? `${attachableOfficerFeedback.length} current-version proposal${attachableOfficerFeedback.length === 1 ? '' : 's'} will be included in the audit record.`
                                    : 'No completed officer proposal is available for this version.'}
                                </span>
                              </span>
                            </label>
                          </div>
                        )}
                        {event.status === 'Manual Review Required' && (
                          <div className="space-y-3 rounded-md border border-gold-300 bg-gold-50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-gold-700">Manual assessment required</p>
                            <div className="grid grid-cols-2 gap-2">
                              <label className="text-xs font-semibold text-ink-600">Score (0–100)
                                <input className="input mt-1" type="number" min={0} max={100} value={manualScore} onChange={(e) => setManualScore(e.target.value)} />
                              </label>
                              <label className="text-xs font-semibold text-ink-600">Risk level
                                <select className="input mt-1" value={manualRiskLevel} onChange={(e) => setManualRiskLevel(e.target.value as RiskLevel)}>
                                  <option value="Low">Low (0–39)</option><option value="Medium">Medium (40–69)</option><option value="High">High (70–100)</option>
                                </select>
                              </label>
                            </div>
                            <label className="block text-xs font-semibold text-ink-600">Assessment rationale
                              <textarea className="input mt-1 min-h-20" maxLength={1000} value={manualRationale} onChange={(e) => setManualRationale(e.target.value)} placeholder="Record the inputs and reasoning used for the manual score." />
                            </label>
                            <label className="block text-xs font-semibold text-ink-600">Assessment inputs (JSON)
                              <textarea className="input mt-1 font-mono text-xs" rows={3} value={manualInputs} onChange={(e) => setManualInputs(e.target.value)} />
                            </label>
                            <p className="text-[11px] text-ink-500">If no resource recommendation exists, the manual path also records zero-based resource quantities; update them before submitting.</p>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                              {(Object.keys(manualResources) as Array<keyof ResourceQuantities>).map((key) => (
                                <label key={key} className="text-[11px] font-semibold capitalize text-ink-600">{key}
                                  <input className="input mt-1 !h-8 !px-2 text-xs" type="number" min={0} value={manualResources[key]} onChange={(e) => setManualResources((current) => ({ ...current, [key]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))} />
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => { setDecisionMode(null); setRationale(''); setSuggestion(''); }}
                            className="btn-secondary flex-1"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={submitting || rationale.trim().length < minRationaleLen}
                            className={
                              decisionMode === 'approve' ? 'btn-success flex-1' : 'btn-danger flex-1'
                            }
                          >
                            {submitting ? <><Loader2 size={14} className="animate-spin" /> Submitting…</> :
                              decisionMode === 'approve' ? 'Confirm approval' : 'Confirm rejection'}
                          </button>
                        </div>
                        <p className="text-[11px] text-ink-500">
                          <FileWarning size={11} className="inline" /> This dispatches the
                          <code className="mx-1 rounded bg-cream-100 px-1">makeInitialReviewDecision</code>
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
                <div className="flex flex-wrap gap-2">
                  <Link to={`/admin/applications/${event.eventId}/assign`} className="btn-secondary !py-1.5 !px-3 text-xs">
                    Open officer assignment →
                  </Link>
                  <Link to={`/admin/applications/${event.eventId}/controls`} className="btn-secondary !py-1.5 !px-3 text-xs">
                    Open event control list →
                  </Link>
                  {event.controlListGenerated === true && (
                    <Link to={`/admin/applications/${event.eventId}/stage2-review`} className="btn-secondary !py-1.5 !px-3 text-xs">
                      Review Stage 2 images →
                    </Link>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
