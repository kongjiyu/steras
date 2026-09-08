import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
  AssessmentJob,
  EventRecord,
  EventStatus,
  RiskAssessment,
  ResourceRecommendation,
  AuthorityDecision,
  Assignment,
  EventVersion,
  REJECTION_REASON_CATEGORIES,
  RejectionReasonCategory,
} from '@shared/types';
import { WorkspaceTopBar } from '../../components/layout/Sidebar';
import { useAuth } from '../../contexts/AuthContext';
import ManualAssessmentForm, { AdminAiRetryPanel } from './ManualAssessmentForm';
import { isAdminManualEligible } from './manualAssessmentEligibility';
import { isAdminVisibleEvent } from './adminApplicationVisibility';
import { isCurrentAssessmentJob, isCurrentRiskAssessment } from '../../components/m2/m2Contract';
import { adminOfficerDecisionRows } from './adminOfficerDecisionPresentation';
import { userFacingSystemText } from '../../utils/userFacingText';
import { adminWorkflowState } from './adminWorkflow';

const STATUS_TONE: Record<EventStatus, string> = {
  Draft: 'admin-badge admin-badge--default',
  Pending: 'admin-badge admin-badge--warn',
  UnderReview: 'admin-badge admin-badge--warn',
  Approved: 'admin-badge admin-badge--good',
  Rejected: 'admin-badge admin-badge--bad',
  Cancelled: 'admin-badge admin-badge--default',
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


interface SectionProps {
  title: string;
  icon: LucideIcon;
  children: React.ReactNode;
  defaultOpen?: boolean;
  state?: 'Complete' | 'Review' | 'Waiting';
}

function Section({ title, icon: Icon, children, defaultOpen = true, state }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="admin-section rounded-lg border border-[#ded5c5] bg-white shadow-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 border-b border-[#e8e0cf] px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.06em] text-ink-700"><Icon size={15} className="text-brand-700" /> {title}{state && <span className={`rounded-full px-2 py-0.5 text-[10px] normal-case tracking-normal ${state === 'Complete' ? 'bg-green-50 text-green-700' : state === 'Review' ? 'bg-amber-50 text-amber-800' : 'bg-stone-100 text-ink-500'}`}>{state}</span>}</span>
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
  const [searchParams] = useSearchParams();

  const [event, setEvent] = useState<EventRecord | null>(null);
  const [version, setVersion] = useState<EventVersion | null>(null);
  const [assessment, setAssessment] = useState<RiskAssessment | null>(null);
  const [assessmentFailure, setAssessmentFailure] = useState<AssessmentJob | null>(null);
  const [resource, setResource] = useState<ResourceRecommendation | null>(null);
  const [decisions, setDecisions] = useState<AuthorityDecision[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [audit, setAudit] = useState<Array<{ id: string; action: string; timestamp: number; actorId: string; notes?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  // Decision form
  const [decisionMode, setDecisionMode] = useState<'approve' | 'reject' | null>(null);
  const [rationale, setRationale] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [rejectionReasonCategory, setRejectionReasonCategory] = useState<RejectionReasonCategory | ''>('');
  const [attachOfficerFeedback, setAttachOfficerFeedback] = useState(true);
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
        if (!isAdminVisibleEvent(eventData)) {
          setEvent(null);
          setError('This application has not been submitted by the organizer.');
          setLoading(false);
          return;
        }
        setEvent(eventData);
        setVersion(null);
        setAssessment(null);
        setAssessmentFailure(null);
        setResource(null);

        // Load all related sub-collections in parallel
        const promises: Promise<unknown>[] = [];
        if (eventData.currentVersionId) {
          promises.push(
            getDoc(doc(eventRef, COLLECTIONS.VERSIONS, eventData.currentVersionId))
              .then((s) => { if (s.exists()) setVersion(s.data() as EventVersion); }),
          );
        }
        if (eventData.currentAssessmentId) {
          promises.push(
            getDoc(doc(eventRef, COLLECTIONS.ASSESSMENTS, eventData.currentAssessmentId))
              .then((snapshot) => {
                if (!snapshot.exists()) return;
                const value = snapshot.data();
                if (isCurrentRiskAssessment(value)) setAssessment(value);
                else if (isCurrentAssessmentJob(value) && value.status === 'failed') setAssessmentFailure(value);
              }),
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
  }, [eventId, reloadToken]);

  useEffect(() => {
    if (!loading && ['manual-assessment', 'retry-ai'].includes(searchParams.get('focus') ?? '')) {
      document.getElementById('manual-assessment')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [loading, searchParams]);

  const displayedOfficerDecisions = useMemo(
    () => event ? adminOfficerDecisionRows(event, assignments, decisions) : [],
    [event, assignments, decisions],
  );

  const canReview = event && (event.status === 'Pending' || event.status === 'UnderReview' || event.status === 'Manual Review Required');
  const manualOfficialReady = assessment?.status === 'official_ready'
    && 'sourceKind' in assessment && assessment.sourceKind === 'admin_manual';
  const manualReviewAssessment = assessment?.status === 'manual_review_required' && isAdminManualEligible(assessment)
    ? assessment
    : null;
  const initialReviewOpen = Boolean(canReview
    && (event?.status !== 'Manual Review Required' || manualOfficialReady)
    && !event?.initialReview
    && !event?.assignedOfficerUids?.length
    && !['authority', 'second', 'closed'].includes(event?.reviewStage ?? ''));
  const attachableOfficerFeedback = assignments.filter((assignment) => Boolean(assignment.decision && assignment.reason && assignment.versionId === event?.currentVersionId));
  const minRationaleLen = decisionMode === 'approve' && !rationale.trim() ? 0 : 10;
  const workflow = event ? adminWorkflowState(event) : null;

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
    if (decisionMode === 'reject' && !rejectionReasonCategory) {
      toast.error('Select a privacy-safe rejection category.');
      return;
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
        rejectionReasonCategory?: RejectionReasonCategory;
      }, { status: EventStatus; decision: 'Approved' | 'Rejected' }>(functions, 'makeInitialReviewDecision');
      await command({
        eventId,
        decision,
        reason: rationale.trim(),
        ...(suggestion.trim() ? { suggestion: suggestion.trim() } : {}),
        ...(decision === 'Rejected' ? { rejectionReasonCategory: rejectionReasonCategory as RejectionReasonCategory } : {}),
        ...(decision === 'Rejected' && attachOfficerFeedback ? { attachOfficerFeedback: true } : {}),
      });
      toast.success(decision === 'Approved' ? 'Application released for authority assignment.' : 'Application rejected and feedback sent.');
      setRationale('');
      setSuggestion('');
      setDecisionMode(null);
      setEvent((current) => current ? {
        ...current,
        status: decision === 'Approved' ? 'UnderReview' : 'Rejected',
        reviewStage: decision === 'Approved' ? 'initial' : 'closed',
        initialReview: { decision, reason: rationale.trim(), ...(suggestion.trim() ? { suggestion: suggestion.trim() } : {}), reviewerUid: profile?.uid ?? '', reviewedAt: Date.now(), manualAssessmentRecorded: manualOfficialReady },
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
        subtitle={event ? `Application review · submitted ${formatDateTime(event.submittedAt)}` : 'Authority approval'}
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

            {workflow && <section className="mb-5 grid gap-3 rounded-lg border border-[#cfd7b4] bg-[#f8faef] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div><p className="text-xs font-bold uppercase tracking-[0.08em] text-brand-700">Current workflow</p><h2 className="mt-1 font-display text-lg font-bold text-ink-900">{workflow.stage}</h2><p className="mt-1 text-sm text-ink-600">{workflow.needsAction ? `Admin action required: ${workflow.actionLabel}.` : workflow.stage === 'Authority review' ? 'Assigned officers are completing their review. No admin decision is due yet.' : workflow.stage === 'Awaiting organiser documentation' ? 'The application is approved. The organiser can now provide the published control evidence.' : 'Review the record and audit history below.'}</p></div>
              <span className={`w-fit rounded-full border px-3 py-1 text-xs font-bold ${workflow.priority === 'High' ? 'border-red-200 bg-red-50 text-red-700' : workflow.priority === 'Medium' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-stone-200 bg-white text-ink-500'}`}>{workflow.priority} priority</span>
            </section>}

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
              {/* Main column */}
              <div className="space-y-4">
                {/* Organiser + venue info */}
                <Section title="Application" icon={ClipboardList} state="Complete">
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

                {version && (
                  <Section title={`Submitted version ${version.versionNumber}`} icon={ClipboardList} state="Complete">
                    <div className="grid gap-4 text-sm sm:grid-cols-2">
                      <Detail label="Event type" value={version.eventDetails.type} />
                      <Detail label="Event date" value={`${formatDateTime(version.eventDetails.startDatetime)} – ${formatDateTime(version.eventDetails.endDatetime)}`} />
                      <Detail label="Venue address" value={version.eventDetails.venueAddress} />
                      <Detail label="Capacity / expected attendance" value={`${version.eventDetails.venueCapacity.toLocaleString()} / ${version.eventDetails.expectedAttendance.toLocaleString()}`} />
                      <Detail label="Environment" value={`${version.eventDetails.environment} · ${version.eventDetails.coverage} · ${version.eventDetails.seating}`} />
                      <Detail label="Venue coordinates" value={version.eventDetails.venueLocation ? `${version.eventDetails.venueLocation.lat}, ${version.eventDetails.venueLocation.lng}` : 'Not provided'} />
                    </div>
                    <div className="mt-4 grid gap-4 text-sm">
                      <div><p className="text-xs text-ink-500">Description</p><p className="mt-1 whitespace-pre-wrap text-ink-800">{version.eventDetails.description || 'Not provided'}</p></div>
                      <div><p className="text-xs text-ink-500">Emergency-plan summary</p><p className="mt-1 whitespace-pre-wrap text-ink-800">{version.eventDetails.emergencyPlanSummary || 'Not provided'}</p></div>
                    </div>
                    <div className="mt-4">
                      <p className="text-xs text-ink-500">Risk-profile answers</p>
                      {version.eventDetails.riskProfile && Object.keys(version.eventDetails.riskProfile).length > 0 ? (
                        <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                          {Object.entries(version.eventDetails.riskProfile).map(([key, value]) => <div key={key} className="rounded border border-[#e8e0cf] bg-cream-50 px-3 py-2"><dt className="font-semibold text-ink-700">{fieldLabel(key)}</dt><dd className="mt-1 text-ink-600">{typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value)}</dd></div>)}
                        </dl>
                      ) : <p className="mt-1 text-sm text-ink-500">No additional risk-profile answers.</p>}
                    </div>
                    <div className="mt-4">
                      <p className="text-xs text-ink-500">Submitted documents</p>
                      {version.documentPaths.length ? <ul className="mt-2 space-y-1 text-xs text-ink-700">{version.documentPaths.map((path) => <li key={path} className="rounded border border-[#e8e0cf] bg-cream-50 px-3 py-2" title={submittedDocumentName(path)}>{submittedDocumentName(path)}</li>)}</ul> : <p className="mt-1 text-sm text-ink-500">No documents attached.</p>}
                    </div>
                  </Section>
                )}

                {/* Current M2 deterministic assessment and advisory. */}
                {assessment && (() => {
                  const display = assessmentDisplay(assessment);
                  const riskLevel = display.riskLevel;
                  const score = display.score;
                  const versionLabel = display.schemaVersion
                    ? `Assessment version ${display.schemaVersion} · Calculation ${display.formulaVersion}`
                    : '';
                  return (
                    <Section title="Risk assessment" icon={ShieldCheck} state="Complete">
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
                            AI proposal · MiniMax AI
                            <span className="ml-2 font-normal text-ink-500">
                              status: {assessment.aiProposal.status}
                            </span>
                          </p>
                          <p className="mt-1">The assessment retains the AI proposal as provenance; the displayed score is calculated by versioned deterministic rules.</p>
                        </div>
                      )}
                    </Section>
                  );
                })()}

                {manualReviewAssessment && event && (
                  <div id="manual-assessment" className="scroll-mt-24">
                    <Section title="Admin manual assessment" icon={FileWarning}>
                      <div className="mb-4 rounded-md border border-gold-200 bg-gold-50 p-3 text-sm text-ink-700">
                        <p className="font-semibold text-gold-700">This application requires Admin manual review before an application decision.</p>
                        <p className="mt-1 text-xs leading-5">Review the complete application and assessment evidence above, then submit the locked assessment. The application decision remains Approve or Reject only.</p>
                      </div>
                      <ManualAssessmentForm
                        eventId={event.eventId}
                        assessment={manualReviewAssessment}
                        onCompleted={() => setReloadToken((value) => value + 1)}
                      />
                    </Section>
                  </div>
                )}

                {assessmentFailure && event && (
                  <div id="manual-assessment" className="scroll-mt-24">
                    <Section title="Assessment recovery" icon={FileWarning}>
                      <AdminAiRetryPanel
                        eventId={event.eventId}
                        failureMessage={assessmentFailure.error ?? 'The previous pipeline run did not complete.'}
                        onCompleted={() => setReloadToken((value) => value + 1)}
                      />
                    </Section>
                  </div>
                )}

                {/* Resource recommendations */}
                {resource && (
                  <Section title="Safety resource recommendations" icon={Users} defaultOpen={false}>
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
                  {displayedOfficerDecisions.length === 0 ? (
                    <p className="text-sm text-ink-500">No officer decisions recorded yet.</p>
                  ) : (
                    <ul className="divide-y divide-[#e8e0cf]">
                      {displayedOfficerDecisions.map((d) => (
                        <li key={d.id} className="flex items-start gap-3 py-2">
                          <span className={`${RISK_TONE[d.decision]} text-xs`}>{d.decision}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-ink-800">{d.authorityType}</p>
                            <p className="text-xs text-ink-500">{d.rationale}</p>
                            {d.suggestion && <p className="mt-1 text-xs text-ink-600"><span className="font-semibold">Suggestion:</span> {d.suggestion}</p>}
                          </div>
                          <span className="text-xs text-ink-500">{formatDateTime(d.decidedAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>

                <Section title="Review timeline" icon={History} state={workflow?.needsAction ? 'Review' : 'Waiting'}>
                  <ol className="space-y-3 text-sm">
                    <TimelineItem label="Application submitted" date={event.submittedAt} complete={Boolean(event.submittedAt)} />
                    <TimelineItem label="Initial admin decision" date={event.initialReview?.reviewedAt} complete={Boolean(event.initialReview)} />
                    <TimelineItem label="Authority review completed" date={event.authorityReviewCompletedAt} complete={Boolean(event.authorityReviewCompletedAt)} />
                    <TimelineItem label="Final admin decision" date={event.secondReview?.decidedAt} complete={Boolean(event.secondReview)} />
                    <TimelineItem label="Event controls published" date={event.controlListGenerated ? event.updatedAt : undefined} complete={Boolean(event.controlListGenerated)} />
                  </ol>
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
                          <li key={a.id} className="flex flex-col items-start gap-2 border-l-2 border-[#c8d1a8] pl-3 sm:flex-row">
                            <div>
                              <p className="font-semibold capitalize text-ink-800">{a.action.replaceAll('_', ' ')}</p>
                              {a.notes && <p className="text-xs text-ink-500">{userFacingSystemText(a.notes)}</p>}
                            </div>
                            <span className="shrink-0 text-xs text-ink-500 sm:ml-auto">{formatDateTime(a.timestamp)}</span>
                          </li>
                        ))}
                    </ol>
                  )}
                </Section>
              </div>

              {/* Side column: actions */}
              <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
                {/* Officer assignment */}
                <Section title="Officer assignment" icon={Users}>
                  <p className="mb-3 text-sm text-ink-600">Required agencies: {event.requiredAuthorities.join(', ')}. Choose named officers and review their eligibility in the assignment checklist.</p>
                  <p className="text-sm font-semibold">{event.assignedOfficerUids?.length ?? 0} officer(s) currently assigned</p>
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
                          {decisionMode === 'approve' ? 'Approval rationale (optional)' : 'Rejection reason + suggestion'}
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
                          <span>{rationale.trim().length}/1000 · optional for approval; minimum 10 when provided</span>
                          <span>
                            {rationale.trim().length >= minRationaleLen
                              ? <Check size={12} className="inline text-emerald-600" />
                              : <AlertCircle size={12} className="inline text-amber-600" />}
                          </span>
                        </div>
                        {decisionMode === 'reject' && (
                          <div className="space-y-2">
                            <label className="block text-xs font-semibold text-ink-600">
                              Rejection category (required)
                              <select className="input mt-1" value={rejectionReasonCategory} onChange={(event) => setRejectionReasonCategory(event.target.value as RejectionReasonCategory)}>
                                <option value="">Select a category</option>
                                {REJECTION_REASON_CATEGORIES.map((category) => <option key={category} value={category}>{category.replaceAll('_', ' ')}</option>)}
                              </select>
                            </label>
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
                        {event.status === 'Manual Review Required' && !manualOfficialReady && (
                          <div className="rounded-md border border-gold-300 bg-gold-50 p-3 text-sm text-ink-700">
                            <p className="font-semibold text-gold-700">Manual assessment required before initial review</p>
                            <p className="mt-1 text-xs leading-5">Complete the locked eight-category assessment in the Admin manual assessment queue before making an application decision.</p>
                            <Link to="/admin" className="btn-secondary mt-3 inline-flex !px-3 !py-1.5 text-xs">Open manual assessment queue →</Link>
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
                          <FileWarning size={11} className="inline" /> This decision is recorded with immutable audit provenance.
                        </p>
                      </form>
                    )}
                  </Section>
                ) : (
                  <div className="rounded-lg border border-[#ded5c5] bg-cream-50 p-4 text-sm text-ink-500">
                    <strong className="block text-ink-800">Admin decision</strong>
                    {event.initialReview ? <p className="mt-2">Initial review: {event.initialReview.decision}{event.initialReview.reason ? ` — ${event.initialReview.reason}` : ''}</p> : <p>No initial admin decision recorded.</p>}
                    <p className="mt-2">Current stage: {event.reviewStage ?? event.status}</p>
                    {event.reviewStage === 'second' && <Link className="btn-primary mt-3" to={`/admin/applications/${event.eventId}/assign`}>Open final admin decision</Link>}
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
                  {(event.status === 'Approved' || Boolean(event.authorityReviewCompletedAt)) && <Link to={`/admin/applications/${event.eventId}/controls`} className="btn-secondary !py-1.5 !px-3 text-xs">
                    Open event control list →
                  </Link>}
                  {event.controlListGenerated === true && Boolean(event.controlListSnapshot?.length) && (event.status === 'Approved' || Boolean(event.authorityReviewCompletedAt)) && (
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

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-ink-500">{label}</p><p className="mt-1 text-ink-800">{value}</p></div>;
}

function TimelineItem({ label, date, complete }: { label: string; date?: number; complete: boolean }) {
  return <li className="flex items-center gap-3"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${complete ? 'border-green-300 bg-green-50 text-green-700' : 'border-stone-300 bg-stone-50 text-ink-400'}`}>{complete ? <Check size={13}/> : <span className="h-1.5 w-1.5 rounded-full bg-current"/>}</span><span className={complete ? 'font-semibold text-ink-800' : 'text-ink-500'}>{label}</span><span className="ml-auto text-xs text-ink-500">{complete ? formatDateTime(date) : 'Pending'}</span></li>;
}

function submittedDocumentName(path: string): string {
  const encoded = path.split('/').pop() ?? 'Submitted document';
  let decoded = encoded;
  try { decoded = decodeURIComponent(encoded); } catch { /* Retain the safe stored filename when percent encoding is malformed. */ }
  return decoded.replace(/^[0-9a-f]{8}-[0-9a-f-]{27}-/i, '');
}

function fieldLabel(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}
