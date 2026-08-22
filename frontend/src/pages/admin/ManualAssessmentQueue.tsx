import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
  AdminManualCategoryInput,
  AdminManualHazard,
  COLLECTIONS,
  EventRecord,
  EvidenceKey,
  HazardDomain,
  ManualReviewRiskAssessment,
  ScoreRating,
} from '@shared/types';
import { db, functions, isFirebaseConfigured } from '../../config/firebase';
import { isCurrentEventRecord, isCurrentRiskAssessment } from '../../components/m2/m2Contract';

const CATEGORIES: Array<{ id: HazardDomain; name: string }> = [
  { id: 'crowd', name: 'Crowd safety' },
  { id: 'venue_fire', name: 'Venue, fire and structural safety' },
  { id: 'weather_environment', name: 'Weather and environmental exposure' },
  { id: 'public_health', name: 'Public health and epidemiology' },
  { id: 'food_water_sanitation', name: 'Food, water and sanitation' },
  { id: 'medical_capacity', name: 'Medical and health-system capacity' },
  { id: 'security_cbrn', name: 'Security, behaviour and CBRN' },
  { id: 'transport_accessibility', name: 'Transport and accessibility' },
];

type ManualQueueEvent = EventRecord & {
  currentVersionId: string;
  currentAssessmentId: string;
  eventDetails: EventRecord['eventDetails'] & { name: string };
};
interface QueueCase { event: ManualQueueEvent; assessment: ManualReviewRiskAssessment }

export default function ManualAssessmentQueue() {
  const [cases, setCases] = useState<QueueCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!isFirebaseConfigured) { setLoading(false); return; }
    let generation = 0;
    const unsubscribe = onSnapshot(collection(db, COLLECTIONS.EVENTS), async (snapshot) => {
      const current = ++generation;
      try {
        const values = await Promise.all(snapshot.docs.map(async (eventDoc) => {
          const event = { eventId: eventDoc.id, ...eventDoc.data() } as EventRecord;
          if (!isManualQueueEvent(event)) return null;
          const assessment = (await getDoc(doc(db, COLLECTIONS.EVENTS, event.eventId, COLLECTIONS.ASSESSMENTS, event.currentAssessmentId))).data();
          return isCurrentRiskAssessment(assessment) && assessment.status === 'manual_review_required'
            && assessment.eventId === event.eventId
            && assessment.versionId === event.currentVersionId
            && assessment.assessmentId === event.currentAssessmentId
            && isAdminManualEligible(assessment)
            ? { event, assessment } : null;
        }));
        if (current !== generation) return;
        setCases(values.filter((value): value is QueueCase => Boolean(value)));
        setError('');
      } catch { if (current === generation) setError('Manual assessment queue could not be loaded.'); }
      finally { if (current === generation) setLoading(false); }
    }, () => { generation += 1; setError('Manual assessment queue could not be loaded.'); setLoading(false); });
    return () => { generation += 1; unsubscribe(); };
  }, []);
  if (loading) return <p className="text-sm text-ink-500">Loading manual-review applications...</p>;
  if (error) return <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-status-rejected">{error}</p>;
  if (!cases.length) return <p className="text-sm text-ink-500">No manual assessments require action.</p>;
  return <div className="space-y-5">{cases.map((item) => <ManualCase key={`${item.event.eventId}:${item.assessment.inputHash}`} item={item} />)}</div>;
}

function ManualCase({ item }: { item: QueueCase }) {
  const eligibleEvidence = useMemo(() => item.assessment.evidence.filter((evidence) => evidence && evidence.quality !== 'missing'
    && typeof evidence.status === 'string'
    && !['unavailable', 'unmatched', 'missing'].includes(evidence.status.trim().toLowerCase())), [item.assessment.evidence]);
  const [hazards, setHazards] = useState<AdminManualHazard[]>([{
    hazardId: 'manual-hazard-1', hazardName: '', categoryId: 'crowd',
    evidenceReferences: [], rationale: '',
  }]);
  const [categories, setCategories] = useState<AdminManualCategoryInput[]>(CATEGORIES.map((category) => ({
    categoryId: category.id, likelihood: 1, severity: 1,
    evidenceReferences: [], rationale: '', missingInformation: '',
  })));
  const [rationale, setRationale] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [key] = useState(() => `manual-${crypto.randomUUID()}`);
  const persisted = Boolean(item.assessment.activeManualAssessmentId);

  const submit = async () => {
    setSubmitting(true);
    try {
      await httpsCallable(functions, 'submitAdminManualAssessment')({ eventId: item.event.eventId, hazards, categories, rationale, idempotencyKey: key });
      toast.success('Manual assessment finalized as the official assessment.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Manual assessment could not be submitted.'); }
    finally { setSubmitting(false); }
  };
  const retry = async () => {
    setSubmitting(true);
    try {
      await httpsCallable(functions, 'retryManualOfficialFinalisation')({ eventId: item.event.eventId });
      toast.success('Manual official finalisation completed.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Manual finalisation retry failed.'); }
    finally { setSubmitting(false); }
  };

  return <article className="rounded-lg border border-[#ded5c5] bg-white p-5">
    <div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-display font-semibold text-ink-900">{item.event.eventDetails.name}</h3><p className="mt-1 text-xs text-status-rejected">{item.assessment.aiProposal?.status ?? 'insufficient data'} · {item.assessment.manualReviewReason}</p></div><span className="badge badge-amber">Manual review required</span></div>
    <div className="mt-4 grid gap-3 text-xs sm:grid-cols-3"><Meta label="Readiness" value={item.assessment.assessmentReadiness} /><Meta label="Compliance" value={item.assessment.complianceStatus} /><Meta label="Warnings" value={String(item.assessment.warnings.length)} /></div>
    <details className="mt-4 border-y border-[#e3dacb] py-3"><summary className="cursor-pointer text-sm font-semibold text-ink-700">Context, warnings and eligible evidence</summary><div className="mt-3 grid gap-2 text-xs text-ink-600 sm:grid-cols-2"><p><strong>Weather:</strong> {item.assessment.contextSnapshot.weather.data?.forecast ?? 'Measurements unavailable'} · {item.assessment.contextSnapshot.weather.freshness}</p><p><strong>Venue match:</strong> {item.assessment.contextSnapshot.venue.matched ? 'matched' : 'unmatched'}</p><p><strong>Calendar:</strong> {item.assessment.contextSnapshot.calendar.localDate}{item.assessment.contextSnapshot.calendar.holidayName ? ` · ${item.assessment.contextSnapshot.calendar.holidayName}` : ''}</p><p><strong>Historical incidents:</strong> {item.assessment.contextSnapshot.incidentHistory.total}</p></div><ul className="mt-3 space-y-2 text-xs text-gold-700">{item.assessment.warnings.map((warning) => <li key={warning.warningId}><strong>{warning.code}:</strong> {warning.message}</li>)}</ul><ul className="mt-3 space-y-2 text-xs text-ink-600">{item.assessment.evidence.map((evidence) => <li key={evidence.key}><strong>{evidence.key}:</strong> {evidence.description} ({evidence.status})</li>)}</ul></details>
    {persisted ? <div className="mt-4 rounded-md border border-gold-200 bg-gold-50 p-4"><p className="text-sm font-semibold text-ink-800">Manual assessment persisted; official publication needs retry.</p><button className="btn-primary mt-3" disabled={submitting} onClick={retry}>{submitting ? 'Retrying...' : 'Retry official finalisation'}</button></div> : <>
      <div className="mt-5"><div className="flex items-center justify-between"><h4 className="font-display font-semibold text-ink-800">Manual hazards</h4><button type="button" className="btn-secondary" disabled={hazards.length >= 40} onClick={() => setHazards((value) => [...value, { hazardId: `manual-hazard-${crypto.randomUUID()}`, hazardName: '', categoryId: 'crowd', evidenceReferences: [], rationale: '' }])}>Add hazard</button></div>
        <div className="mt-3 space-y-3">{hazards.map((hazard, index) => <div key={hazard.hazardId} className="grid gap-2 border border-[#e3dacb] p-3 sm:grid-cols-2"><input className="input" placeholder="Hazard name" value={hazard.hazardName} onChange={(e) => updateHazard(setHazards, index, { hazardName: e.target.value })} /><select className="input" value={hazard.categoryId} onChange={(e) => updateHazard(setHazards, index, { categoryId: e.target.value as HazardDomain })}>{CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><div className="sm:col-span-2"><EvidenceSelector evidence={eligibleEvidence.map((item) => item.key)} selected={hazard.evidenceReferences} onChange={(evidenceReferences) => updateHazard(setHazards, index, { evidenceReferences })} /></div><textarea className="input sm:col-span-2" placeholder="Hazard rationale (minimum 10 characters; explain the information gap if no eligible evidence exists)" value={hazard.rationale} onChange={(e) => updateHazard(setHazards, index, { rationale: e.target.value })} />{hazards.length > 1 && <button type="button" className="btn-secondary justify-self-start sm:col-span-2" onClick={() => setHazards((value) => value.filter((_, current) => current !== index))}>Remove hazard</button>}</div>)}</div>
      </div>
      <div className="mt-6"><h4 className="font-display font-semibold text-ink-800">Eight-category official input</h4><p className="mt-1 text-xs text-ink-500">The current versioned HIRARC evaluator applies category floors after submission; it can increase, never lower, the Admin input. Evidence selection is bound to the current assessment snapshot.</p><div className="mt-3 space-y-3">{categories.map((category, index) => <div key={category.categoryId} className="border border-[#e3dacb] p-3"><p className="text-sm font-semibold text-ink-800">{CATEGORIES[index].name}</p><div className="mt-2 grid gap-2 sm:grid-cols-2"><Score label="Likelihood" value={category.likelihood} onChange={(value) => updateCategory(setCategories, index, { likelihood: value })} /><Score label="Severity" value={category.severity} onChange={(value) => updateCategory(setCategories, index, { severity: value })} /></div><EvidenceSelector evidence={eligibleEvidence.map((item) => item.key)} selected={category.evidenceReferences} onChange={(evidenceReferences) => updateCategory(setCategories, index, { evidenceReferences })} /><textarea className="input mt-2" placeholder="Category rationale" value={category.rationale} onChange={(e) => updateCategory(setCategories, index, { rationale: e.target.value })} /><textarea className="input mt-2" placeholder="Missing-information explanation when no evidence is selected" value={category.missingInformation} onChange={(e) => updateCategory(setCategories, index, { missingInformation: e.target.value })} /></div>)}</div></div>
      <label className="mt-5 block text-sm font-semibold text-ink-700">Overall assessment rationale<textarea className="input mt-2" rows={4} maxLength={2000} value={rationale} onChange={(e) => setRationale(e.target.value)} /></label>
      <button className="btn-primary mt-4" disabled={submitting} onClick={submit}>{submitting ? 'Finalizing...' : 'Submit locked manual assessment'}</button>
    </>}
  </article>;
}

function Score({ label, value, onChange }: { label: string; value: ScoreRating; onChange: (value: ScoreRating) => void }) {
  return <label className="text-xs text-ink-600">{label}<select className="input mt-1" value={value} onChange={(event) => onChange(Number(event.target.value) as ScoreRating)}>{[1, 2, 3, 4, 5].map((score) => <option key={score}>{score}</option>)}</select></label>;
}
function EvidenceSelector({ evidence, selected, onChange }: { evidence: EvidenceKey[]; selected: EvidenceKey[]; onChange: (value: EvidenceKey[]) => void }) {
  return <fieldset className="mt-2"><legend className="text-xs font-medium text-ink-600">Eligible evidence references</legend><div className="mt-1 flex flex-wrap gap-2">{evidence.length ? evidence.map((key) => <label key={key} className="inline-flex items-center gap-1 rounded border border-[#ded5c5] px-2 py-1 text-xs"><input type="checkbox" checked={selected.includes(key)} onChange={(event) => onChange(event.target.checked ? [...selected, key] : selected.filter((value) => value !== key))} />{key}</label>) : <span className="text-xs text-status-rejected">No eligible evidence is available.</span>}</div></fieldset>;
}
function Meta({ label, value }: { label: string; value: string }) { return <div><span className="text-ink-500">{label}</span><p className="font-semibold capitalize text-ink-800">{value.replaceAll('_', ' ')}</p></div>; }
function updateHazard(setter: React.Dispatch<React.SetStateAction<AdminManualHazard[]>>, index: number, patch: Partial<AdminManualHazard>) { setter((values) => values.map((value, current) => current === index ? { ...value, ...patch } : value)); }
function updateCategory(setter: React.Dispatch<React.SetStateAction<AdminManualCategoryInput[]>>, index: number, patch: Partial<AdminManualCategoryInput>) { setter((values) => values.map((value, current) => current === index ? { ...value, ...patch } : value)); }

function isAdminManualEligible(assessment: ManualReviewRiskAssessment): boolean {
  if (assessment.aiProposal === null) return assessment.assessmentReadiness === 'insufficient_data';
  const attempt = assessment.aiProposal;
  if (!attempt || typeof attempt !== 'object') return false;
  if (attempt.status === 'success' || !['unavailable', 'timeout', 'invalid'].includes(String(attempt.status))) return false;
  return typeof attempt.model === 'string' && Boolean(attempt.model.trim())
    && typeof attempt.promptVersion === 'string' && Boolean(attempt.promptVersion.trim())
    && typeof attempt.responseSchemaVersion === 'string' && Boolean(attempt.responseSchemaVersion.trim())
    && typeof attempt.retryable === 'boolean'
    && typeof attempt.errorSummary === 'string' && Boolean(attempt.errorSummary.trim())
    && attempt.cacheStatus === 'not-applicable'
    && Number.isFinite(attempt.generatedAt);
}

function isManualQueueEvent(event: EventRecord): event is ManualQueueEvent {
  return isCurrentEventRecord(event)
    && ['Pending', 'UnderReview'].includes(event.status)
    && typeof event.currentVersionId === 'string'
    && typeof event.currentAssessmentId === 'string'
    && Boolean(event.eventDetails.name.trim());
}
