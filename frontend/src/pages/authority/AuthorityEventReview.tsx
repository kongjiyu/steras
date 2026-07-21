import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { collection, doc, onSnapshot, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getBlob, ref } from 'firebase/storage';
import { format } from 'date-fns';
import { Check, ChevronLeft, Download, FileText, Pencil, RotateCcw, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  AssessmentRecord,
  AuthorityDecision,
  AuthorityType,
  COLLECTIONS,
  DecisionValue,
  EventRecord,
  EventVersion,
  ResourceQuantities,
  ResourceRecommendation,
  RiskAssessment,
} from '@shared/types';
import { db, functions, isFirebaseConfigured, storage } from '../../config/firebase';
import EmptyState from '../../components/ui/EmptyState';
import RiskMeter from '../../components/ui/RiskMeter';
import StatusBadge from '../../components/ui/StatusBadge';

const RESOURCE_FIELDS: { key: keyof ResourceQuantities; label: string }[] = [
  { key: 'police', label: 'Police officers' },
  { key: 'security', label: 'Security personnel' },
  { key: 'medicalTeams', label: 'Medical teams' },
  { key: 'ambulances', label: 'Ambulances' },
  { key: 'fireOfficers', label: 'Fire officers' },
  { key: 'toilets', label: 'Portable toilets' },
  { key: 'wasteBins', label: 'Waste bins' },
];

export default function AuthorityEventReview() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [assessment, setAssessment] = useState<RiskAssessment | null>(null);
  const [assessmentStatus, setAssessmentStatus] = useState<AssessmentRecord['status'] | null>(null);
  const [resources, setResources] = useState<ResourceRecommendation | null>(null);
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
      return;
    }
    const eventReference = doc(db, COLLECTIONS.EVENTS, eventId);
    const supportingError = () => setSupportingDataError('Some review evidence could not be refreshed.');
    const unsubscribeAssessment = onSnapshot(doc(eventReference, COLLECTIONS.ASSESSMENTS, versionId), (snapshot) => {
      const record = snapshot.data() as AssessmentRecord | undefined;
      setAssessmentStatus(record?.status ?? null);
      setAssessment(record?.status === 'ready' ? record as RiskAssessment : null);
      setSupportingDataError('');
    }, supportingError);
    const unsubscribeResources = onSnapshot(doc(eventReference, COLLECTIONS.RESOURCES, versionId), (snapshot) => {
      setResources(snapshot.exists() ? snapshot.data() as ResourceRecommendation : null);
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
    return () => {
      unsubscribeAssessment();
      unsubscribeResources();
      unsubscribeDecisions();
      unsubscribeDecisionHistory();
      unsubscribeVersions();
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
            <div className="card-header"><h2 className="font-semibold">Final risk assessment</h2></div>
            <div className="card-body">
              {!assessment ? <p className="text-sm text-ink-500">{assessmentStatus === 'failed' ? 'Assessment failed and requires a retry.' : 'Assessment is still processing.'}</p> : (
                <div className="space-y-5">
                  <div className="flex items-center gap-3"><RiskMeter level={assessment.finalRiskLevel} /><strong className="text-3xl">{assessment.finalScore}</strong><span className="text-ink-500">/ 100</span></div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Metric label="Baseline" value={assessment.baselineScore} />
                    <Metric label="M3 adjustment" value={`+${assessment.ai.validatedAdjustment}`} />
                    <Metric label="M3 status" value={assessment.ai.status} />
                  </div>
                  <p className="text-sm leading-relaxed text-ink-700">{assessment.ai.reasoning}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {(['weather', 'crowd', 'venue', 'history', 'holiday'] as const).map((key) => <Metric key={key} label={key} value={assessment.subScores[key]} />)}
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
              {!resources || !resourceDraft ? <p className="text-sm text-ink-500">No recommendation yet.</p> : editingResources ? (
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
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {RESOURCE_FIELDS.map(({ key, label }) => <Metric key={key} label={label} value={resourceDraft[key]} />)}
                </div>
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

function toResourceQuantities(resource: ResourceRecommendation): ResourceQuantities {
  return Object.fromEntries(RESOURCE_FIELDS.map(({ key }) => [key, resource[key]])) as unknown as ResourceQuantities;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-md bg-cream-50 p-3"><div className="text-xs text-ink-500">{label}</div><div className="mt-0.5 font-semibold capitalize text-ink-800">{value}</div></div>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-ink-500">{label}</div><div className="break-words text-ink-800">{value}</div></div>;
}
