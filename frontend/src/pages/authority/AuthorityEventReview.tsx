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
  AuthorityDecision,
  AuthorityType,
  COLLECTIONS,
  ControlVerificationStatus,
  DecisionValue,
  EventControl,
  EventRecord,
  EventVersion,
  ResourceQuantities,
  ResourceRecommendation,
  RiskAssessment,
  Stage1Doc,
} from '@shared/types';
import { db, functions, isFirebaseConfigured, storage } from '../../config/firebase';
import { useAuth } from '../../contexts/AuthContext';
import AIAdvisory from '../../components/m2/AIAdvisory';
import CategoryProfile from '../../components/m2/CategoryProfile';
import ContextEvidence from '../../components/m2/ContextEvidence';
import ResourceRecommendationView from '../../components/m2/ResourceRecommendation';
import { isCurrentResourceRecommendation, isCurrentRiskAssessment } from '../../components/m2/m2Contract';
import { RESOURCE_FIELDS, toResourceQuantities } from '../../components/m2/m2Presentation';
import EmptyState from '../../components/ui/EmptyState';
import StatusBadge from '../../components/ui/StatusBadge';

export default function AuthorityEventReview() {
  const { eventId } = useParams<{ eventId: string }>();
  const { profile } = useAuth();
  const myAuthorityType = profile?.authorityType;
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [assessment, setAssessment] = useState<RiskAssessment | null>(null);
  const [assessmentStatus, setAssessmentStatus] = useState<AssessmentRecord['status'] | null>(null);
  const [resources, setResources] = useState<ResourceRecommendation | null>(null);
  const [legacyAssessment, setLegacyAssessment] = useState(false);
  const [legacyResources, setLegacyResources] = useState(false);
  const [decisions, setDecisions] = useState<AuthorityDecision[]>([]);
  const [decisionHistory, setDecisionHistory] = useState<AuthorityDecision[]>([]);
  const [versions, setVersions] = useState<EventVersion[]>([]);
  const [historyView, setHistoryView] = useState<'decisions' | 'versions'>('decisions');
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [rationale, setRationale] = useState('');
  const [submittingDecision, setSubmittingDecision] = useState<DecisionValue | null>(null);
  const [editingResources, setEditingResources] = useState(false);
  const [resourceDraft, setResourceDraft] = useState<ResourceQuantities | null>(null);
  const [resourceRationale, setResourceRationale] = useState('');
  const [savingResources, setSavingResources] = useState(false);
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
      setEvent(snapshot.exists() ? { eventId: snapshot.id, ...snapshot.data() } as EventRecord : null);
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
    if (!isFirebaseConfigured || !eventId || !versionId) {
      setAssessment(null);
      setResources(null);
      setLegacyAssessment(false);
      setLegacyResources(false);
      return;
    }
    const eventReference = doc(db, COLLECTIONS.EVENTS, eventId);
    const supportingError = () => setSupportingDataError('Some review evidence could not be refreshed.');
    const unsubscribeAssessment = onSnapshot(doc(eventReference, COLLECTIONS.ASSESSMENTS, versionId), (snapshot) => {
      const record = snapshot.data() as AssessmentRecord | undefined;
      setAssessmentStatus(record?.status ?? null);
      setAssessment(isCurrentRiskAssessment(record) ? record : null);
      setLegacyAssessment(record?.status === 'ready' && !isCurrentRiskAssessment(record));
      setSupportingDataError('');
    }, supportingError);
    const unsubscribeResources = onSnapshot(doc(eventReference, COLLECTIONS.RESOURCES, versionId), (snapshot) => {
      const record = snapshot.data();
      setResources(isCurrentResourceRecommendation(record) ? record : null);
      setLegacyResources(snapshot.exists() && !isCurrentResourceRecommendation(record));
    }, supportingError);
    const unsubscribeDecisions = onSnapshot(query(collection(eventReference, COLLECTIONS.DECISIONS)), (snapshot) => {
      setDecisions(snapshot.docs.map((item) => item.data() as AuthorityDecision));
    }, supportingError);
    const unsubscribeDecisionHistory = onSnapshot(query(collection(eventReference, COLLECTIONS.DECISION_HISTORY)), (snapshot) => {
      setDecisionHistory(snapshot.docs.map((item) => item.data() as AuthorityDecision).sort((a, b) => b.decidedAt - a.decidedAt));
    }, supportingError);
    const unsubscribeVersions = onSnapshot(query(collection(eventReference, COLLECTIONS.VERSIONS)), (snapshot) => {
      setVersions(snapshot.docs.map((item) => item.data() as EventVersion).sort((a, b) => b.versionNumber - a.versionNumber));
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
  }, [event?.currentVersionId, eventId]);

  useEffect(() => {
    if (!resources || editingResources) return;
    setResourceDraft(toResourceQuantities(resources));
  }, [resources, editingResources]);

  const currentDecisions = useMemo(() => new Map(
    decisions
      .filter((decision) => decision.current && decision.versionId === event?.currentVersionId)
      .map((decision) => [decision.authorityType, decision]),
  ), [decisions, event?.currentVersionId]);
  const currentVersion = versions.find((version) => version.versionId === event?.currentVersionId);

  if (loading) return <div className="p-8 text-ink-500">Loading application...</div>;
  if (loadError) return <div className="p-8"><EmptyState title="Application unavailable" description={loadError}><button type="button" className="btn-secondary" onClick={() => { setLoading(true); setRetryKey((value) => value + 1); }}>Try again</button></EmptyState></div>;
  if (!event) return <div className="p-8"><EmptyState title="Event not found" description="It may have been removed or you do not have access." /></div>;

  const details = event.eventDetails;
  const reviewOpen = ['Pending', 'UnderReview'].includes(event.status);
  const evidenceReady = Boolean(assessment && resources);
  const canDecide = reviewOpen && evidenceReady && rationale.trim().length >= 10;

  const submitDecision = async (decision: DecisionValue) => {
    if (!eventId || !canDecide) return;
    setSubmittingDecision(decision);
    try {
      const command = httpsCallable<{ eventId: string; decision: DecisionValue; rationale: string }>(functions, 'makeAuthorityDecision');
      await command({ eventId, decision, rationale: rationale.trim() });
      toast.success(decision === 'Approved' ? 'Approval recorded.' : decision === 'Rejected' ? 'Rejection recorded.' : 'Amendment request recorded.');
      setRationale('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to record decision.');
    } finally {
      setSubmittingDecision(null);
    }
  };

  const saveResourceOverride = async () => {
    if (!eventId || !resourceDraft || resourceRationale.trim().length < 10) return;
    setSavingResources(true);
    try {
      const command = httpsCallable<{ eventId: string; quantities: ResourceQuantities; rationale: string }>(functions, 'overrideResources');
      await command({ eventId, quantities: resourceDraft, rationale: resourceRationale.trim() });
      toast.success('Resource recommendation updated.');
      setEditingResources(false);
      setResourceRationale('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update resources.');
    } finally {
      setSavingResources(false);
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
            <div className="card-header"><div><h2 className="font-semibold">Official category-based assessment</h2><p className="mt-0.5 text-xs text-ink-500">Deterministic result · AI cannot change this score</p></div></div>
            <div className="card-body">
              {!assessment ? <p className="text-sm text-ink-500">{legacyAssessment ? 'Legacy assessment detected. Recompute this event version before recording a decision.' : assessmentStatus === 'failed' ? 'Assessment failed and requires a retry.' : 'Assessment is still processing.'}</p> : (
                <div className="space-y-5">
                  <CategoryProfile assessment={assessment} />
                  <AIAdvisory advisory={assessment.aiAdvisory} officialRiskLevel={assessment.officialRiskLevel} />
                  <div className="border-t border-[#e3dacb] pt-5">
                    <h3 className="mb-4 font-display text-sm font-semibold text-ink-800">Versioned context evidence</h3>
                    <ContextEvidence assessment={assessment} />
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <div>
                <h2 className="font-semibold">Recommended resources</h2>
                {resources?.confidenceLevel === 'authorityValidated' && <p className="mt-0.5 text-xs text-status-approved">Authority validated</p>}
              </div>
              {resources && reviewOpen && !editingResources && <button type="button" className="btn-secondary !px-3 !py-1.5" onClick={() => setEditingResources(true)}><Pencil size={14} /> Adjust</button>}
            </div>
            <div className="card-body">
              {!resources || !resourceDraft ? <p className="text-sm text-ink-500">{legacyResources ? 'Legacy resource record detected. Recompute this event version before review.' : 'No recommendation yet.'}</p> : editingResources ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {RESOURCE_FIELDS.map(({ key, label }) => (
                      <label key={key} className="text-xs font-medium text-ink-600">{label}
                        <input type="number" min={0} step={1} className="input mt-1" value={resourceDraft[key]} onChange={(e) => setResourceDraft({ ...resourceDraft, [key]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                      </label>
                    ))}
                  </div>
                  <label className="block text-xs font-medium text-ink-600">Reason for adjustment
                    <textarea className="input mt-1 resize-y" rows={3} maxLength={1000} value={resourceRationale} onChange={(e) => setResourceRationale(e.target.value)} placeholder="Explain the operational basis for this change." />
                  </label>
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn-secondary" onClick={() => { setEditingResources(false); setResourceDraft(toResourceQuantities(resources)); setResourceRationale(''); }}><RotateCcw size={15} /> Cancel</button>
                    <button type="button" className="btn-primary" disabled={savingResources || resourceRationale.trim().length < 10} onClick={saveResourceOverride}>{savingResources ? 'Saving...' : 'Save adjustment'}</button>
                  </div>
                </div>
              ) : (
                <ResourceRecommendationView recommendation={resources} showOverrideProvenance />
              )}
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
              {event.requiredAuthorities.map((authority) => <AuthorityProgress key={authority} authority={authority} decision={currentDecisions.get(authority)} />)}
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
              <button className="btn-success w-full" disabled={!canDecide || submittingDecision !== null} onClick={() => submitDecision('Approved')}><Check size={16} />{submittingDecision === 'Approved' ? 'Recording...' : 'Approve'}</button>
              <button className="btn-secondary w-full" disabled={!canDecide || submittingDecision !== null} onClick={() => submitDecision('AmendmentRequested')}><RotateCcw size={16} />{submittingDecision === 'AmendmentRequested' ? 'Recording...' : 'Request amendment'}</button>
              <button className="btn-danger w-full" disabled={!canDecide || submittingDecision !== null} onClick={() => submitDecision('Rejected')}><X size={16} />{submittingDecision === 'Rejected' ? 'Recording...' : 'Reject'}</button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function AuthorityProgress({ authority, decision }: { authority: AuthorityType; decision?: AuthorityDecision }) {
  const color = decision?.decision === 'Approved' ? 'bg-green-100 text-status-approved' : decision?.decision === 'Rejected' ? 'bg-red-100 text-status-rejected' : decision?.decision === 'AmendmentRequested' ? 'bg-orange-100 text-orange-700' : 'bg-ink-100 text-ink-500';
  return <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-ink-700">{authority}</span><span className={`badge ${color}`}>{decision ? formatWorkflowValue(decision.decision) : 'Awaiting review'}</span></div>;
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
