import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { collection, doc, onSnapshot, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getBlob, ref } from 'firebase/storage';
import { format } from 'date-fns';
import { Check, ChevronLeft, Download, FileText, Pencil, RotateCcw, Shield, ShieldCheck, ShieldX, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  AssessmentRecord,
  AdminManualAssessment,
  AuthorityDecision,
  AuthorityScoreResolution,
  AuthorityType,
  CATEGORY_SCHEMA_VERSION,
  COLLECTIONS,
  ControlVerificationStatus,
  DecisionValue,
  EventControl,
  EventRecord,
  EventVersion,
  HARD_RULE_VERSION,
  MANUAL_ASSESSMENT_SCHEMA_VERSION,
  MANUAL_OFFICIAL_FORMULA_VERSION,
  ResourceRecommendation,
  RiskAssessment,
  Stage1Doc,
} from '@shared/types';
import { db, functions, isFirebaseConfigured, storage } from '../../config/firebase';
import AIAdvisory from '../../components/m2/AIAdvisory';
import CategoryProfile from '../../components/m2/CategoryProfile';
import ContextEvidence from '../../components/m2/ContextEvidence';
import ResourceRecommendationView from '../../components/m2/ResourceRecommendation';
import AuthorityScoreReviewForm from '../../components/m2/AuthorityScoreReviewForm';
import AuthorityAssessmentWarnings from '../../components/m2/AuthorityAssessmentWarnings';
import { assessmentRiskLevel, isAuthorityScoreResolution, isCurrentAssessmentRecord, isCurrentAuthorityDecision, isCurrentEventRecord, isCurrentEventVersion, isCurrentResourceRecommendation, isCurrentRiskAssessment, isSafeManualAssessmentId } from '../../components/m2/m2Contract';
import EmptyState from '../../components/ui/EmptyState';
import StatusBadge from '../../components/ui/StatusBadge';
import { useAuth } from '../../contexts/AuthContext';
import { activeScoreResolutionId } from './authorityReviewPresentation';

export default function AuthorityEventReview() {
  const { profile } = useAuth();
  const { eventId } = useParams<{ eventId: string }>();
  const myAuthorityType = profile?.authorityType;
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [assessment, setAssessment] = useState<RiskAssessment | null>(null);
  const [assessmentStatus, setAssessmentStatus] = useState<AssessmentRecord['status'] | null>(null);
  const [resources, setResources] = useState<ResourceRecommendation | null>(null);
  const [scoreResolution, setScoreResolution] = useState<AuthorityScoreResolution | null>(null);
  const [manualAssessment, setManualAssessment] = useState<AdminManualAssessment | null>(null);
  const [legacyAssessment, setLegacyAssessment] = useState(false);
  const [legacyResources, setLegacyResources] = useState(false);
  const [decisions, setDecisions] = useState<AuthorityDecision[]>([]);
  const [decisionHistory, setDecisionHistory] = useState<AuthorityDecision[]>([]);
  const [versions, setVersions] = useState<EventVersion[]>([]);
  const [historyView, setHistoryView] = useState<'decisions' | 'versions'>('decisions');
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [rationale, setRationale] = useState('');
  // FR-M3-16: officer must tick a checkbox confirming review of all
  // listed materials (assessment, advisory, evidence, resource ranges)
  // before approving. The server-side Cloud Function (recordOfficerProposal
  // + the legacy makeAuthorityDecision) refuses Approved without it.
  const [confirmedReview, setConfirmedReview] = useState(false);
  const [suggestion, setSuggestion] = useState('');
  const [materialsReviewed, setMaterialsReviewed] = useState(false);
  const [submittingDecision, setSubmittingDecision] = useState<DecisionValue | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [supportingDataError, setSupportingDataError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  // M3 control verification (FR-M3-22, FR-M3-23, Q1 refactor)
  // Each control item has N Stage 1 docs; verification is per-doc.
  // Stage 1 docs live at event_controls/{controlId}/stage1_docs/{docId}
  // and carry the verification provenance directly on the doc.
  const [eventControls, setEventControls] = useState<EventControl[]>([]);
  const [stage1DocsByControl, setStage1DocsByControl] = useState<Record<string, Stage1Doc[]>>({});
  // Per-doc form state, keyed by `${controlId}__${docId}`.
  const [docRationale, setDocRationale] = useState<Record<string, string>>({});
  const [docEvidencePath, setDocEvidencePath] = useState<Record<string, string>>({});
  const [submittingDoc, setSubmittingDoc] = useState<string | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured || !eventId) {
      setLoading(false);
      return;
    }
    const eventReference = doc(db, COLLECTIONS.EVENTS, eventId);
    const unsubscribeEvent = onSnapshot(eventReference, (snapshot) => {
      const value = snapshot.exists() ? { eventId: snapshot.id, ...snapshot.data() } : undefined;
      if (value && !isCurrentEventRecord(value, eventId)) {
        setEvent(null);
        setLoadError('The application data is invalid or incomplete.');
        setLoading(false);
        return;
      }
      setEvent(value ?? null);
      setLoadError('');
      setLoading(false);
    }, () => {
      setLoadError('The application could not be loaded.');
      setLoading(false);
    });
    return unsubscribeEvent;
  }, [eventId, retryKey]);

  useEffect(() => {
    const versionId = event?.currentVersionId;
    const assessmentId = event?.currentAssessmentId;
    const resourceId = event?.currentResourceId;
    if (!isFirebaseConfigured || !eventId || !versionId || !assessmentId) {
      setAssessment(null);
      setAssessmentStatus(null);
      setResources(null);
      setLegacyAssessment(false);
      setLegacyResources(false);
      return;
    }
    const eventReference = doc(db, COLLECTIONS.EVENTS, eventId);
    const supportingError = () => setSupportingDataError('Some review evidence could not be refreshed.');
    const unsubscribeAssessment = onSnapshot(doc(eventReference, COLLECTIONS.ASSESSMENTS, assessmentId), (snapshot) => {
      const record = snapshot.data() as AssessmentRecord | undefined;
      setAssessmentStatus(record?.status ?? null);
      setAssessment(isCurrentRiskAssessment(record) ? record : null);
      setLegacyAssessment(snapshot.exists() && !isCurrentAssessmentRecord(record));
      setSupportingDataError('');
    }, supportingError);
    const unsubscribeResources = resourceId
      ? onSnapshot(doc(eventReference, COLLECTIONS.RESOURCES, resourceId), (snapshot) => {
          const record = snapshot.data();
          const valid = isCurrentResourceRecommendation(record)
            && record.resourceId === resourceId
            && record.eventId === eventId
            && record.versionId === versionId;
          setResources(valid ? record : null);
          setLegacyResources(snapshot.exists() && !valid);
        }, supportingError)
      : (() => {
          setResources(null);
          setLegacyResources(false);
          return () => undefined;
        })();
    const unsubscribeDecisions = onSnapshot(query(collection(eventReference, COLLECTIONS.DECISIONS)), (snapshot) => {
      setDecisions(snapshot.docs
        .map((item) => isCurrentAuthorityDecision(item.data(), eventId, item.id) ? item.data() as AuthorityDecision : undefined)
        .filter((item): item is AuthorityDecision => Boolean(item)));
    }, supportingError);
    const unsubscribeDecisionHistory = onSnapshot(query(collection(eventReference, COLLECTIONS.DECISION_HISTORY)), (snapshot) => {
      setDecisionHistory(snapshot.docs
        .map((item) => isCurrentAuthorityDecision(item.data(), eventId, item.id) ? item.data() as AuthorityDecision : undefined)
        .filter((item): item is AuthorityDecision => Boolean(item))
        .sort((a, b) => b.decidedAt - a.decidedAt));
    }, supportingError);
    const unsubscribeVersions = onSnapshot(query(collection(eventReference, COLLECTIONS.VERSIONS)), (snapshot) => {
      setVersions(snapshot.docs
        .map((item) => isCurrentEventVersion(item.data(), eventId, item.id) ? item.data() as EventVersion : undefined)
        .filter((item): item is EventVersion => Boolean(item))
        .sort((a, b) => b.versionNumber - a.versionNumber));
    }, supportingError);
    const unsubscribeControls = onSnapshot(query(collection(eventReference, COLLECTIONS.EVENT_CONTROLS)), (snapshot) => {
      const controls = snapshot.docs.map((item) => ({ controlId: item.id, ...(item.data() as EventControl) }) as EventControl)
        .sort((a, b) => a.controlId.localeCompare(b.controlId));
      setEventControls(controls);
      // Subscribe to each control's stage1_docs sub-collection.
      // (We tear down previous subscriptions in the cleanup.)
      const unsubscribes: Array<() => void> = [];
      const next: Record<string, Stage1Doc[]> = {};
      for (const control of controls) {
        const ref = collection(eventReference, COLLECTIONS.EVENT_CONTROLS, control.controlId, COLLECTIONS.STAGE1_DOCS);
        unsubscribes.push(onSnapshot(query(ref), (docsSnap) => {
          next[control.controlId] = docsSnap.docs.map((d) => ({ docId: d.id, ...(d.data() as Stage1Doc) }) as Stage1Doc);
          setStage1DocsByControl((prev) => ({ ...prev, [control.controlId]: next[control.controlId] }));
        }, supportingError));
      }
      return () => { for (const u of unsubscribes) u(); };
    }, supportingError);
    return () => {
      unsubscribeAssessment();
      unsubscribeResources();
      unsubscribeDecisions();
      unsubscribeDecisionHistory();
      unsubscribeVersions();
      unsubscribeControls();
    };
  }, [event?.currentAssessmentId, event?.currentResourceId, event?.currentVersionId, eventId]);

  const currentVersion = versions.find((version) => version.versionId === event?.currentVersionId);
  const activeResolutionId = activeScoreResolutionId(assessment);
  const activeAssessmentId = assessment?.assessmentId;
  const activeManualAssessmentId = assessment?.status === 'official_ready'
    && 'sourceKind' in assessment && assessment.sourceKind === 'admin_manual'
    ? assessment.activeManualAssessmentId : undefined;
  useEffect(() => {
    if (!isFirebaseConfigured || !eventId || !activeAssessmentId || !activeResolutionId) { setScoreResolution(null); return; }
    return onSnapshot(doc(db, COLLECTIONS.EVENTS, eventId, COLLECTIONS.ASSESSMENTS, activeAssessmentId, COLLECTIONS.SCORE_RESOLUTIONS, activeResolutionId), (snapshot) => {
      const value = snapshot.data();
      setScoreResolution(snapshot.exists() && isAuthorityScoreResolution(value, snapshot.id, {
        eventId, versionId: event?.currentVersionId, assessmentId: activeAssessmentId,
      }) ? value : null);
    }, () => setSupportingDataError('The score resolution could not be refreshed.'));
  }, [activeAssessmentId, activeResolutionId, event?.currentVersionId, eventId]);

  useEffect(() => {
    if (!isFirebaseConfigured || !eventId || !activeAssessmentId || !activeManualAssessmentId) {
      setManualAssessment(null);
      return;
    }
    return onSnapshot(
      doc(db, COLLECTIONS.EVENTS, eventId, COLLECTIONS.ASSESSMENTS, activeAssessmentId, COLLECTIONS.MANUAL_ASSESSMENTS, activeManualAssessmentId),
      (snapshot) => {
        const value = snapshot.data();
        setManualAssessment(snapshot.exists() && isSafeManualAssessment(value, activeManualAssessmentId, {
          eventId, versionId: event?.currentVersionId ?? '', assessmentId: activeAssessmentId,
          inputHash: assessment?.inputHash ?? '', eventVersionInputHash: currentVersion?.inputHash ?? '',
          evidence: assessment?.evidence ?? [],
        })
          ? value : null);
      },
      () => setSupportingDataError('The manual assessment provenance could not be refreshed.'),
    );
  }, [activeAssessmentId, activeManualAssessmentId, assessment?.evidence, assessment?.inputHash, currentVersion?.inputHash, event?.currentVersionId, eventId]);

  const currentDecisions = useMemo(() => new Map(
    decisions
      .filter((decision) => decision.current && decision.versionId === event?.currentVersionId)
      .map((decision) => [decision.authorityType, decision]),
  ), [decisions, event?.currentVersionId]);
  if (loading) return <div className="p-8 text-ink-500">Loading application...</div>;
  if (loadError) return <div className="p-8"><EmptyState title="Application unavailable" description={loadError}><button type="button" className="btn-secondary" onClick={() => { setLoading(true); setRetryKey((value) => value + 1); }}>Try again</button></EmptyState></div>;
  if (!event) return <div className="p-8"><EmptyState title="Event not found" description="It may have been removed or you do not have access." /></div>;

  const details = event.eventDetails;
  const reviewOpen = ['Pending', 'UnderReview'].includes(event.status);
  const evidenceReady = Boolean(
    assessment
    && resources
    && resources.versionId === event.currentVersionId
    && (resources.stage !== 'official' || assessment.status === 'official_ready')
    && (event.currentResourceId === undefined || event.currentResourceId === resources.resourceId),
  );
  // FR-M3-16: approval requires an explicit materials-review confirmation.
  // M2 additionally asks for a corrective suggestion on rejection/amendment.
  const canApprove = reviewOpen && evidenceReady && rationale.trim().length >= 10
    && confirmedReview && materialsReviewed && assessment?.complianceStatus !== 'blocked';
  const canRejectOrAmend = reviewOpen && evidenceReady && rationale.trim().length >= 10
    && suggestion.trim().length >= 10;

  const submitDecision = async (decision: DecisionValue) => {
    const isApproval = decision === 'Approved';
    if (!eventId || (isApproval ? !canApprove : !canRejectOrAmend)) return;
    setSubmittingDecision(decision);
    try {
      const command = httpsCallable<{
        eventId: string;
        decision: DecisionValue;
        rationale: string;
        confirmedReview?: boolean;
        materialsReviewed?: boolean;
        suggestion?: string;
      }>(functions, 'makeAuthorityDecision');
      await command({
        eventId,
        decision,
        rationale: rationale.trim(),
        ...(isApproval
          ? { confirmedReview: true, materialsReviewed: true }
          : { suggestion: suggestion.trim() }),
      });
      toast.success(decision === 'Approved' ? 'Approval recorded.' : decision === 'Rejected' ? 'Rejection recorded.' : 'Amendment request recorded.');
      setRationale('');
      setConfirmedReview(false);
      setSuggestion('');
      setMaterialsReviewed(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to record decision.');
    } finally {
      setSubmittingDecision(null);
    }
  };

  const downloadEvidence = async (path: string) => {
    setDownloadingPath(path);
    try {
      const blob = await getBlob(ref(storage, path), 10 * 1024 * 1024);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = evidenceName(path);
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to download this evidence file.');
    } finally {
      setDownloadingPath(null);
    }
  };

  const submitControlVerification = async (controlId: string, docId: string, status: ControlVerificationStatus) => {
    if (!eventId) return;
    const key = `${controlId}__${docId}`;
    const rationale = (docRationale[key] ?? '').trim();
    if (rationale.length < 10) {
      toast.error('Verification rationale must be at least 10 characters.');
      return;
    }
    setSubmittingDoc(key);
    try {
      const evidencePath = (docEvidencePath[key] ?? '').trim();
      const command = httpsCallable<{
        eventId: string;
        controlId: string;
        docId: string;
        status: ControlVerificationStatus;
        rationale: string;
        evidencePath?: string;
      }>(functions, 'verifyStage1Doc');
      await command({
        eventId,
        controlId,
        docId,
        status,
        rationale,
        ...(evidencePath ? { evidencePath } : {}),
      });
      toast.success(status === 'verified' ? 'Stage 1 document approved.' : 'Stage 1 document rejected.');
      setDocRationale((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setDocEvidencePath((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to record verification.');
    } finally {
      setSubmittingDoc(null);
    }
  };

  return (
    <div className="p-5 sm:p-8">
      {supportingDataError && <div role="alert" className="mb-4 rounded-md border border-status-review/40 bg-gold-50 p-3 text-sm text-gold-600">{supportingDataError}</div>}
      <div className="mb-6">
        <Link to="/authority/applications" className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">
          <ChevronLeft size={16} /> Applications
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink-800">{details.name}</h1>
            <p className="mt-1 text-sm text-ink-500">{details.venueName} · {format(new Date(details.startDatetime), 'PPp')}</p>
          </div>
          <StatusBadge status={event.status} />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          <section className="card">
            <div className="card-header"><div><h2 className="font-semibold">{assessment?.status === 'official_ready' ? 'sourceKind' in assessment && assessment.sourceKind === 'admin_manual' ? 'Official manual assessment' : 'Official AI-assisted assessment' : 'Provisional category assessment'}</h2><p className="mt-0.5 text-xs text-ink-500">{assessment?.status === 'official_ready' ? 'sourceKind' in assessment && assessment.sourceKind === 'admin_manual' ? 'Admin-authored recovery assessment · no AI score proposal' : 'Finalized human-reviewed risk inputs with retained AI provenance' : 'Validated AI proposal · authority confirmation required'}</p></div></div>
            <div className="card-body">
              {!assessment ? <p className="text-sm text-ink-500">{legacyAssessment ? 'Legacy assessment detected. Recompute this event version before recording a decision.' : assessmentStatus === 'failed' ? 'Assessment failed and requires a retry.' : 'Assessment is still processing.'}</p> : (
                <div className="space-y-5">
                  <CategoryProfile assessment={assessment} />
                  <AuthorityAssessmentWarnings warnings={assessment.warnings} />
                  {assessment.status === 'official_ready' && 'sourceKind' in assessment && assessment.sourceKind === 'admin_manual'
                    ? <><ManualOfficialProvenance assessment={assessment} />{manualAssessment && <ManualAssessmentDetails assessment={manualAssessment} />}</>
                    : <AIAdvisory advisory={assessment.aiProposal} resultRiskLevel={assessmentRiskLevel(assessment)} official={assessment.status === 'official_ready'} />}
                  <div className="border-t border-[#e3dacb] pt-5">
                    <h3 className="mb-4 font-display text-sm font-semibold text-ink-800">Versioned context evidence</h3>
                    <ContextEvidence assessment={assessment} />
                  </div>
                  {scoreResolution && <div className="rounded-md border border-gold-200 bg-gold-50 p-4 text-xs leading-5 text-ink-700"><p className="font-semibold text-ink-800">Admin score-conflict resolution</p><p className="mt-1">{scoreResolution.rationale}</p><ul className="mt-2 space-y-1">{scoreResolution.categories.map((category) => <li key={category.categoryId}><span className="font-semibold">{formatWorkflowValue(category.categoryId)} {category.likelihood}×{category.severity}:</span> {category.reason}</li>)}</ul></div>}
                  {(assessment.status === 'provisional_ready' || assessment.status === 'authority_review') && profile?.authorityType && (
                    <AuthorityScoreReviewForm eventId={eventId!} assessment={assessment} authorityType={profile.authorityType} />
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <div>
                <h2 className="font-semibold">Recommended resources</h2>
                {resources?.confidenceLevel === 'authority_validated' && <p className="mt-0.5 text-xs text-status-approved">Official risk input · prototype resource ratios</p>}
              </div>
            </div>
            <div className="card-body">
              {!resources
                ? <p className="text-sm text-ink-500">{legacyResources ? 'Legacy resource record detected. Recompute this event version before review.' : 'No recommendation yet.'}</p>
                : <>
                    <p className="mb-4 rounded-md border border-gold-200 bg-gold-50 p-3 text-xs leading-5 text-gold-700">
                      Resource adjustments remain frozen until the append-only resource override workflow is delivered.
                    </p>
                    <ResourceRecommendationView recommendation={resources} />
                  </>}
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <div><h2 className="font-semibold">Submitted evidence</h2><p className="mt-0.5 text-xs text-ink-500">Version {event.currentVersionNumber} immutable files</p></div>
              <span className="text-sm font-semibold text-ink-500">{currentVersion?.documentPaths.length ?? 0}</span>
            </div>
            <div className="card-body">
              {!currentVersion ? <p className="text-sm text-ink-500">Loading submitted version...</p> : currentVersion.documentPaths.length === 0 ? (
                <p className="text-sm text-ink-500">No supporting files were submitted with this version.</p>
              ) : (
                <ul className="divide-y divide-ink-100 border-y border-ink-100">
                  {currentVersion.documentPaths.map((path) => (
                    <li key={path} className="flex min-h-14 items-center gap-3 py-2">
                      <FileText className="shrink-0 text-brand-700" size={18} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-700" title={evidenceName(path)}>{evidenceName(path)}</span>
                      <button type="button" className="btn-secondary min-h-11 !px-3" disabled={downloadingPath !== null} onClick={() => downloadEvidence(path)} aria-label={`Download ${evidenceName(path)}`}>
                        <Download size={15} />{downloadingPath === path ? 'Downloading...' : 'Download'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <ControlVerificationSection
            eventControls={eventControls}
            stage1DocsByControl={stage1DocsByControl}
            myAuthorityType={myAuthorityType}
            reviewOpen={reviewOpen}
            docRationale={docRationale}
            docEvidencePath={docEvidencePath}
            submittingDoc={submittingDoc}
            onRationaleChange={(key, value) => setDocRationale((current) => ({ ...current, [key]: value }))}
            onEvidencePathChange={(key, value) => setDocEvidencePath((current) => ({ ...current, [key]: value }))}
            onSubmit={submitControlVerification}
          />

          <section className="card">
            <div className="card-header flex-wrap gap-3">
              <h2 className="font-semibold">Application history</h2>
              <div role="tablist" aria-label="Application history view" className="flex rounded-md border border-ink-200 bg-cream-50 p-1">
                {(['decisions', 'versions'] as const).map((view) => <button key={view} type="button" role="tab" aria-selected={historyView === view} className={`min-h-11 rounded px-3 text-xs font-semibold capitalize ${historyView === view ? 'bg-white text-brand-700 shadow-sm' : 'text-ink-500'}`} onClick={() => setHistoryView(view)}>{view}</button>)}
              </div>
            </div>
            <div className="card-body">
              {historyView === 'decisions' ? <DecisionHistory decisions={decisionHistory} /> : <VersionHistory versions={versions} currentVersionId={event.currentVersionId} />}
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="card">
            <div className="card-header"><h2 className="font-semibold">Review progress</h2></div>
            <div className="card-body space-y-3">
              {event.requiredAuthorities.map((authority) => {
                const manualOfficial = assessment?.status === 'official_ready' && 'sourceKind' in assessment && assessment.sourceKind === 'admin_manual';
                return <AuthorityProgress key={authority} authority={authority} decision={currentDecisions.get(authority)} scoreReviewed={Boolean(assessment && (manualOfficial || ('authorityReviewState' in assessment && assessment.authorityReviewState?.activeReviewHeads[authority])))} manualOfficial={manualOfficial} />;
              })}
            </div>
          </section>

          <section className="card">
            <div className="card-header"><h2 className="font-semibold">Application</h2></div>
            <div className="card-body space-y-3 text-sm">
              <Row label="Organizer" value={details.organizerName} />
              <Row label="Email" value={details.organizerEmail} />
              <Row label="Phone" value={details.organizerPhone} />
              <Row label="Attendance" value={details.expectedAttendance.toLocaleString()} />
              <Row label="Environment" value={`${details.environment}, ${details.coverage}`} />
              <Row label="Version" value={String(event.currentVersionNumber)} />
            </div>
          </section>

          <section className="card">
            <div className="card-header"><h2 className="font-semibold">Your decision</h2></div>
            <div className="card-body space-y-3">
              {!reviewOpen && <p className="rounded-md bg-cream-50 p-3 text-sm text-ink-600">This review is closed with status {formatWorkflowValue(event.status)}.</p>}
              {reviewOpen && !evidenceReady && <p className="rounded-md bg-gold-100 p-3 text-sm text-gold-600">Wait for the assessment and resource recommendation before deciding.</p>}
              <label className="block text-xs font-medium text-ink-600">Decision rationale
                <textarea className="input mt-1 resize-y" rows={4} maxLength={1000} disabled={!reviewOpen} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Record the evidence and reasoning behind your decision." />
              </label>
              <p className="text-right text-xs text-ink-400">{rationale.trim().length}/1000 · minimum 10</p>
              <label className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs text-ink-600 ${confirmedReview ? 'border-brand-300 bg-brand-50/50' : 'border-ink-200 bg-white'}`}>
                <input
                  type="checkbox"
                  checked={confirmedReview}
                  onChange={(e) => { setConfirmedReview(e.target.checked); setMaterialsReviewed(e.target.checked); }}
                  disabled={!reviewOpen}
                  className="mt-0.5 h-4 w-4 accent-brand-600"
                  data-testid="confirmed-review-checkbox"
                />
                <span>
                  <span className="font-semibold text-ink-700">I confirm I have reviewed</span> the assessment, AI advisory, submitted evidence, and recommended resource ranges for this application.
                  <span className="mt-0.5 block text-[11px] text-ink-500">Required to approve (FR-M3-16). Not required to reject or request amendment.</span>
                </span>
              </label>
              <label className="block text-xs font-medium text-ink-600">Suggestion for rejection or amendment
                <textarea className="input mt-1 resize-y" rows={3} maxLength={1000} disabled={!reviewOpen} value={suggestion} onChange={(event) => setSuggestion(event.target.value)} placeholder="Describe the corrective action the organizer should take." />
              </label>
              {assessment?.complianceStatus === 'blocked' && <p className="rounded-md bg-red-50 p-3 text-xs leading-5 text-status-rejected">Approval is blocked by compliance. You may record a rejection or amendment recommendation.</p>}
              <button className="btn-success w-full" disabled={!canApprove || submittingDecision !== null} onClick={() => submitDecision('Approved')}><Check size={16} />{submittingDecision === 'Approved' ? 'Recording...' : 'Recommend approval'}</button>
              <button className="btn-secondary w-full" disabled={!canRejectOrAmend || submittingDecision !== null} onClick={() => submitDecision('AmendmentRequested')}><RotateCcw size={16} />{submittingDecision === 'AmendmentRequested' ? 'Recording...' : 'Recommend amendment'}</button>
              <button className="btn-danger w-full" disabled={!canRejectOrAmend || submittingDecision !== null} onClick={() => submitDecision('Rejected')}><X size={16} />{submittingDecision === 'Rejected' ? 'Recording...' : 'Recommend rejection'}</button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function ManualOfficialProvenance({ assessment }: { assessment: import('@shared/types').AdminManualOfficialRiskAssessment }) {
  return <div className="border-l-4 border-brand-500 bg-brand-50 p-4 text-sm text-ink-700">
    <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-brand-700">Source · Admin manual assessment</p>
    <p className="mt-2">This official result was calculated from a locked human assessment after AI failure or insufficient data. No AI proposal was fabricated.</p>
    <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><div><dt className="text-ink-500">Manual assessment</dt><dd className="font-mono text-ink-800">{assessment.activeManualAssessmentId}</dd></div><div><dt className="text-ink-500">Finalized by</dt><dd className="font-mono text-ink-800">{assessment.officialResult.finalizedBy}</dd></div></dl>
    <h3 className="mt-4 font-display font-semibold text-ink-800">Manual hazards</h3>
    <ul className="mt-2 space-y-2">{assessment.officialResult.manualHazards.map((hazard) => <li key={hazard.hazardId} className="border-t border-brand-200 pt-2"><strong>{hazard.hazardName}</strong> · {formatWorkflowValue(hazard.categoryId)}<p className="mt-1 text-xs">{hazard.rationale}</p><p className="mt-1 text-[11px] text-ink-500">Evidence: {hazard.evidenceReferences.join(', ')}</p></li>)}</ul>
  </div>;
}

function ManualAssessmentDetails({ assessment }: { assessment: AdminManualAssessment }) {
  return <div className="border border-brand-200 bg-cream-50 p-4 text-sm text-ink-700">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-display font-semibold text-ink-800">Locked Admin input</h3><span className="text-[11px] font-mono text-ink-500">{assessment.manualAssessmentId}</span></div>
    <p className="mt-2 leading-6">{assessment.rationale}</p>
    <div className="mt-4 space-y-3">
      {assessment.categories.map((category) => <div key={category.categoryId} className="border-t border-brand-200 pt-3 text-xs"><div className="flex flex-wrap justify-between gap-2"><strong>{category.categoryId}</strong><span className="font-semibold text-brand-700">Admin input {category.likelihood}×{category.severity}</span></div><p className="mt-1 leading-5">{category.rationale}</p><p className="mt-1 text-ink-500">Evidence: {category.evidenceReferences.length ? category.evidenceReferences.join(', ') : 'None · missing information documented'}</p>{category.missingInformation && <p className="mt-1 text-gold-700">Missing information: {category.missingInformation}</p>}</div>)}
    </div>
  </div>;
}

function isSafeManualAssessment(value: unknown, expectedId: string, identity: {
  eventId: string;
  versionId: string;
  assessmentId: string;
  inputHash: string;
  eventVersionInputHash: string;
  evidence: Array<{ key: string; status: string; quality?: string }>;
}): value is AdminManualAssessment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!isSafeManualAssessmentId(expectedId)
    || !isSafeManualAssessmentId(record.manualAssessmentId)
    || record.manualAssessmentId !== expectedId
    || record.schemaVersion !== MANUAL_ASSESSMENT_SCHEMA_VERSION
    || record.eventId !== identity.eventId || record.versionId !== identity.versionId
    || record.assessmentId !== identity.assessmentId || record.assessmentInputHash !== identity.inputHash
    || typeof record.eventVersionInputHash !== 'string' || !record.eventVersionInputHash.trim()
    || record.eventVersionInputHash !== identity.eventVersionInputHash
    || record.categorySchemaVersion !== CATEGORY_SCHEMA_VERSION
    || record.hardRuleVersion !== HARD_RULE_VERSION
    || record.officialFormulaVersion !== MANUAL_OFFICIAL_FORMULA_VERSION
    || typeof record.submittedBy !== 'string' || !record.submittedBy.trim()
    || typeof record.idempotencyKey !== 'string' || !record.idempotencyKey.trim()
    || !Number.isFinite(record.createdAt)
    || typeof record.rationale !== 'string' || record.rationale.trim().length < 20 || record.rationale.length > 2000
    || !Array.isArray(record.hazards) || !Array.isArray(record.categories)) return false;
  const eligibleEvidence = new Set(identity.evidence
    .filter((evidence) => evidence.quality !== 'missing' && !['unavailable', 'unmatched', 'missing'].includes(evidence.status.trim().toLowerCase()))
    .map((evidence) => evidence.key));
  const validReferences = (references: unknown[], requireOne = false) => references.length >= (requireOne ? 1 : 0)
    && new Set(references).size === references.length
    && references.every((reference) => typeof reference === 'string' && eligibleEvidence.has(reference));
  const categoryIds = new Set(['crowd', 'venue_fire', 'weather_environment', 'public_health', 'food_water_sanitation', 'medical_capacity', 'security_cbrn', 'transport_accessibility']);
  const hazardIds = new Set<string>();
  const hazardsValid = record.hazards.length >= 1 && record.hazards.length <= 40 && record.hazards.every((hazard) => {
    if (!hazard || typeof hazard !== 'object' || Array.isArray(hazard)) return false;
    const item = hazard as Record<string, unknown>;
    const valid = typeof item.hazardId === 'string' && Boolean(item.hazardId) && !hazardIds.has(item.hazardId)
      && typeof item.hazardName === 'string' && item.hazardName.trim().length >= 3 && item.hazardName.length <= 200
      && typeof item.categoryId === 'string' && categoryIds.has(item.categoryId)
      && Array.isArray(item.evidenceReferences) && validReferences(item.evidenceReferences, eligibleEvidence.size > 0)
      && typeof item.rationale === 'string' && item.rationale.trim().length >= 10 && item.rationale.length <= 1000;
    if (valid) hazardIds.add(item.hazardId as string);
    return valid;
  });
  const seenCategories = new Set<string>();
  const categoriesValid = record.categories.length === categoryIds.size && record.categories.every((category) => {
    if (!category || typeof category !== 'object' || Array.isArray(category)) return false;
    const item = category as Record<string, unknown>;
    const valid = typeof item.categoryId === 'string' && categoryIds.has(item.categoryId) && !seenCategories.has(item.categoryId)
      && Number.isInteger(item.likelihood) && Number(item.likelihood) >= 1 && Number(item.likelihood) <= 5
      && Number.isInteger(item.severity) && Number(item.severity) >= 1 && Number(item.severity) <= 5
      && Array.isArray(item.evidenceReferences) && validReferences(item.evidenceReferences)
      && typeof item.rationale === 'string' && item.rationale.trim().length >= 10 && item.rationale.length <= 1000
      && typeof item.missingInformation === 'string' && item.missingInformation.length <= 1000
      && (item.evidenceReferences.length > 0 || item.missingInformation.trim().length >= 10);
    if (valid) seenCategories.add(item.categoryId as string);
    return valid;
  });
  return hazardsValid && categoriesValid && seenCategories.size === categoryIds.size;
}

function AuthorityProgress({ authority, decision, scoreReviewed, manualOfficial }: { authority: AuthorityType; decision?: AuthorityDecision; scoreReviewed: boolean; manualOfficial: boolean }) {
  const color = decision?.decision === 'Approved' ? 'bg-green-100 text-status-approved' : decision?.decision === 'Rejected' ? 'bg-red-100 text-status-rejected' : decision?.decision === 'AmendmentRequested' ? 'bg-orange-100 text-orange-700' : 'bg-ink-100 text-ink-500';
  return <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-ink-700">{authority}</span><div className="flex flex-wrap justify-end gap-1"><span className={`badge ${scoreReviewed ? 'bg-green-100 text-status-approved' : 'bg-ink-100 text-ink-500'}`}>{manualOfficial ? 'Manual official ready' : scoreReviewed ? 'Scores reviewed' : 'Scores pending'}</span><span className={`badge ${color}`}>{decision ? formatWorkflowValue(decision.decision) : 'Decision pending'}</span></div></div>;
}

function formatWorkflowValue(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (character) => character.toUpperCase());
}

function DecisionHistory({ decisions }: { decisions: AuthorityDecision[] }) {
  if (decisions.length === 0) return <p className="text-sm text-ink-500">No authority decisions have been recorded.</p>;
  return <ol className="space-y-4">{decisions.map((decision) => <li key={decision.decisionId} className="border-l-2 border-[#c8d1a8] pl-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-ink-800">{decision.authorityType} · {formatWorkflowValue(decision.decision)}</p><time className="text-xs text-ink-500">{format(new Date(decision.decidedAt), 'PPp')}</time></div><p className="mt-1 text-sm leading-6 text-ink-600">{decision.rationale}</p><p className="mt-1 text-xs text-ink-400">Version {decision.versionId.replace(/^v/, '')}</p></li>)}</ol>;
}

function VersionHistory({ versions, currentVersionId }: { versions: EventVersion[]; currentVersionId?: string }) {
  if (versions.length === 0) return <p className="text-sm text-ink-500">No submitted versions are available.</p>;
  return <ol className="divide-y divide-ink-100 border-y border-ink-100">{versions.map((version) => <li key={version.versionId} className="flex min-h-16 items-center justify-between gap-4 py-3"><div><p className="text-sm font-semibold text-ink-800">Version {version.versionNumber}{version.versionId === currentVersionId && <span className="ml-2 badge bg-green-100 text-status-approved">Current</span>}</p><p className="mt-1 text-xs text-ink-500">Submitted {format(new Date(version.submittedAt), 'PPp')}</p></div><span className="text-xs font-medium text-ink-500">{version.documentPaths.length} files</span></li>)}</ol>;
}

function evidenceName(path: string): string {
  const encoded = path.split('/').pop() ?? 'evidence-file';
  const decoded = decodeURIComponent(encoded);
  return decoded.replace(/^[0-9a-f]{8}-[0-9a-f-]{27}-/i, '');
}

function Row({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-ink-500">{label}</div><div className="break-words text-ink-800">{value}</div></div>;
}

/**
 * Stage-1 Control verification section (FR-M3-22, FR-M3-23, Q1 refactor).
 *
 * Each control item has N Stage 1 docs (e.g. an application letter, a
 * licence, an insurance policy). The assigned authority verifies each doc
 * independently via the per-doc form below. The control's aggregate
 * `label` is recomputed by the cloud function from its stage1 docs.
 *
 * Only the officer whose authority type is in `event.requiredAuthorities`
 * can act; other authorities see a read-only state.
 */
interface ControlVerificationSectionProps {
  eventControls: EventControl[];
  stage1DocsByControl: Record<string, Stage1Doc[]>;
  myAuthorityType: AuthorityType | undefined;
  reviewOpen: boolean;
  docRationale: Record<string, string>;
  docEvidencePath: Record<string, string>;
  submittingDoc: string | null;
  onRationaleChange: (key: string, value: string) => void;
  onEvidencePathChange: (key: string, value: string) => void;
  onSubmit: (controlId: string, docId: string, status: ControlVerificationStatus) => Promise<void>;
}

function ControlVerificationSection(props: ControlVerificationSectionProps) {
  const {
    eventControls, stage1DocsByControl, myAuthorityType, reviewOpen,
    docRationale, docEvidencePath, submittingDoc,
    onRationaleChange, onEvidencePathChange, onSubmit,
  } = props;
  if (eventControls.length === 0) {
    return null;
  }
  const canAct = reviewOpen && !!myAuthorityType;
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2 className="font-semibold">Stage-1 control verification</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            {canAct
              ? `You are reviewing as ${myAuthorityType}. Verify or reject each Stage 1 document with a recorded rationale.`
              : 'Read-only view — your account is not assigned to this application.'}
          </p>
        </div>
        <span className="text-sm font-semibold text-ink-500">{eventControls.length}</span>
      </div>
      <div className="card-body space-y-4">
        {eventControls.map((control) => {
          const docs = stage1DocsByControl[control.controlId] ?? [];
          const controlCanAct = canAct && control.authority === myAuthorityType;
          return (
            <div key={control.controlId} className="rounded-md border border-ink-100 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Shield size={16} className="shrink-0 text-brand-700" />
                    <p className="text-sm font-semibold text-ink-800">{control.controlName}</p>
                  </div>
                  <p className="mt-1 text-xs text-ink-400">Stage: {control.stageRequirement} · Authority: {control.authority} · {docs.length} doc(s)</p>
                </div>
                <ControlLabelBadge label={control.label} />
              </div>
              <div className="mt-3 space-y-3">
                {docs.map((doc) => {
                  const key = `${control.controlId}__${doc.docId}`;
                  const rationale = docRationale[key] ?? '';
                  const evidence = docEvidencePath[key] ?? '';
                  const isFinal = doc.status === 'verified' || doc.status === 'rejected' || doc.status === 'use_previous';
                  const canSubmitDoc = controlCanAct && doc.status === 'pending_verification' && rationale.trim().length >= 10 && submittingDoc === null;
                  return (
                    <div key={doc.docId} className="rounded-md bg-cream-50 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-ink-800">{doc.label}</p>
                          <p className="mt-1 text-xs text-ink-500">docType: {doc.docType} · id: <span className="font-mono">{doc.docId}</span></p>
                        </div>
                        <DocStatusBadge status={doc.status} />
                      </div>
                      {isFinal && (
                        <div className="mt-2 text-xs text-ink-600">
                          <p>
                            <span className="font-semibold">{doc.status}</span>
                            {doc.verifiedAt && <> on {format(new Date(doc.verifiedAt), 'PPp')} by <span className="font-mono">{doc.verifiedBy}</span></>}
                          </p>
                          {doc.rejectionReason && <p className="mt-1 whitespace-pre-line">{doc.rejectionReason}</p>}
                        </div>
                      )}
                      {controlCanAct && doc.status === 'pending_verification' && (
                        <div className="mt-2 space-y-2">
                          <label className="block text-xs font-medium text-ink-600">
                            Verification rationale
                            <textarea
                              className="input mt-1 resize-y"
                              rows={2}
                              maxLength={1000}
                              value={rationale}
                              onChange={(e) => onRationaleChange(key, e.target.value)}
                              placeholder="Explain the basis for your verification (10–1000 chars)."
                            />
                          </label>
                          <label className="block text-xs font-medium text-ink-600">
                            Evidence path (optional)
                            <input
                              className="input mt-1"
                              type="text"
                              value={evidence}
                              onChange={(e) => onEvidencePathChange(key, e.target.value)}
                              placeholder="evidence/control-evacuation-plan.pdf"
                            />
                          </label>
                          <p className="text-right text-xs text-ink-400">{rationale.trim().length}/1000 · minimum 10</p>
                          <div className="flex justify-end gap-2">
                            <button type="button" className="btn-secondary" disabled={!canSubmitDoc} onClick={() => onSubmit(control.controlId, doc.docId, 'rejected')}>
                              <X size={15} />{submittingDoc === key ? 'Recording...' : 'Reject'}
                            </button>
                            <button type="button" className="btn-success" disabled={!canSubmitDoc} onClick={() => onSubmit(control.controlId, doc.docId, 'verified')}>
                              <Check size={15} />{submittingDoc === key ? 'Recording...' : 'Verify'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {docs.length === 0 && (
                  <p className="text-xs text-ink-500">No Stage 1 documents have been uploaded for this control yet.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ControlLabelBadge({ label }: { label: EventControl['label'] }) {
  if (label === 'approved') return <span className="badge bg-green-100 text-status-approved"><ShieldCheck size={12} className="mr-1 inline" />Approved</span>;
  if (label === 'resubmit_required') return <span className="badge bg-red-100 text-status-rejected"><ShieldX size={12} className="mr-1 inline" />Resubmit required</span>;
  if (label === 'reported_under_review') return <span className="badge bg-amber-100 text-amber-700">Under review</span>;
  return <span className="badge bg-ink-100 text-ink-500">Pending</span>;
}

function DocStatusBadge({ status }: { status: Stage1Doc['status'] }) {
  if (status === 'verified') return <span className="badge bg-green-100 text-status-approved">Verified</span>;
  if (status === 'rejected') return <span className="badge bg-red-100 text-status-rejected">Rejected</span>;
  if (status === 'use_previous') return <span className="badge bg-blue-100 text-brand-700">Use previous</span>;
  if (status === 'pending_submission') return <span className="badge bg-ink-100 text-ink-500">Awaiting upload</span>;
  return <span className="badge bg-amber-100 text-amber-700">Awaiting verification</span>;
}
