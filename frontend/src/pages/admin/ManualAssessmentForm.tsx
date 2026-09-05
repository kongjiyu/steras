import { useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
  AdminManualCategoryInput,
  AdminManualHazard,
  EvidenceKey,
  HazardDomain,
  ManualReviewRiskAssessment,
  ScoreRating,
} from '@shared/types';
import { functions } from '../../config/firebase';

export const MANUAL_ASSESSMENT_CATEGORIES: Array<{ id: HazardDomain; name: string }> = [
  { id: 'crowd', name: 'Crowd safety' },
  { id: 'venue_fire', name: 'Venue, fire and structural safety' },
  { id: 'weather_environment', name: 'Weather and environmental exposure' },
  { id: 'public_health', name: 'Public health and epidemiology' },
  { id: 'food_water_sanitation', name: 'Food, water and sanitation' },
  { id: 'medical_capacity', name: 'Medical and health-system capacity' },
  { id: 'security_cbrn', name: 'Security, behaviour and CBRN' },
  { id: 'transport_accessibility', name: 'Transport and accessibility' },
];

export interface ManualAssessmentFormProps {
  eventId: string;
  assessment: ManualReviewRiskAssessment;
  onCompleted?: () => void;
}

export default function ManualAssessmentForm({ eventId, assessment, onCompleted }: ManualAssessmentFormProps) {
  const eligibleEvidence = useMemo(
    () => assessment.evidence.filter((evidence) => evidence && evidence.quality !== 'missing'
      && typeof evidence.status === 'string'
      && !['unavailable', 'unmatched', 'missing'].includes(evidence.status.trim().toLowerCase())),
    [assessment.evidence],
  );
  const [hazards, setHazards] = useState<AdminManualHazard[]>([{
    hazardId: 'manual-hazard-1', hazardName: '', categoryId: 'crowd', evidenceReferences: [], rationale: '',
  }]);
  const [categories, setCategories] = useState<AdminManualCategoryInput[]>(() => MANUAL_ASSESSMENT_CATEGORIES.map((category) => ({
    categoryId: category.id, likelihood: 1, severity: 1, evidenceReferences: [], rationale: '', missingInformation: '',
  })));
  const [rationale, setRationale] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [retryingAI, setRetryingAI] = useState(false);
  const [idempotencyKey] = useState(() => `manual-${crypto.randomUUID()}`);
  const persisted = Boolean(assessment.activeManualAssessmentId);
  const canRetryAI = assessment.aiProposal !== null && assessment.aiProposal.status !== 'success';

  const submit = async () => {
    setSubmitting(true);
    try {
      await httpsCallable(functions, 'submitAdminManualAssessment')({ eventId, hazards, categories, rationale, idempotencyKey });
      toast.success('Manual assessment finalized as the official assessment.');
      onCompleted?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Manual assessment could not be submitted.');
    } finally {
      setSubmitting(false);
    }
  };

  const retry = async () => {
    setSubmitting(true);
    try {
      await httpsCallable(functions, 'retryManualOfficialFinalisation')({ eventId });
      toast.success('Manual official finalisation completed.');
      onCompleted?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Manual finalisation retry failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const retryAI = async () => {
    setRetryingAI(true);
    try {
      const retryAssessment = httpsCallable<{ eventId: string }, { success: boolean; assessmentStatus?: string }>(
        functions,
        'manualRecompute',
        { timeout: 240_000 },
      );
      const result = (await retryAssessment({ eventId })).data;
      toast.success(result.assessmentStatus === 'provisional_ready'
        ? 'AI assessment completed and produced a provisional result.'
        : 'AI reassessment completed. The refreshed result is now available.');
      onCompleted?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'AI assessment retry failed.');
    } finally {
      setRetryingAI(false);
    }
  };

  return (
    <div data-testid="manual-assessment-form">
      {persisted ? (
        <div className="rounded-md border border-gold-200 bg-gold-50 p-4">
          <p className="text-sm font-semibold text-ink-800">Manual assessment persisted; official publication needs retry.</p>
          <button className="btn-primary mt-3" disabled={submitting} onClick={retry} type="button">
            {submitting ? 'Retrying...' : 'Retry official finalisation'}
          </button>
        </div>
      ) : (
        <>
          {canRetryAI && (
            <div className="mb-5 rounded-md border border-brand-200 bg-brand-50/50 p-4">
              <p className="text-sm font-semibold text-ink-800">Retry the AI assessment first</p>
              <p className="mt-1 text-xs leading-5 text-ink-600">STERAS will ask MiniMax to reassess this unchanged application and automatically retry invalid, timed-out or unavailable responses up to three times. If it still fails, complete the manual assessment below.</p>
              <button className="btn-secondary mt-3" disabled={retryingAI || submitting} onClick={retryAI} type="button">
                {retryingAI ? 'AI is reassessing…' : 'Retry AI assessment'}
              </button>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display font-semibold text-ink-800">Manual hazard assessment</h3>
              <p className="mt-1 text-xs text-ink-500">Complete the locked eight-category assessment before making the application decision.</p>
            </div>
            <button type="button" className="btn-secondary" disabled={hazards.length >= 40} onClick={() => setHazards((value) => [...value, { hazardId: `manual-hazard-${crypto.randomUUID()}`, hazardName: '', categoryId: 'crowd', evidenceReferences: [], rationale: '' }])}>Add hazard</button>
          </div>

          <div className="mt-3 space-y-3">
            {hazards.map((hazard, index) => (
              <div key={hazard.hazardId} className="grid gap-2 border border-[#e3dacb] p-3 sm:grid-cols-2">
                <input className="input" placeholder="Hazard name" value={hazard.hazardName} onChange={(event) => updateHazard(setHazards, index, { hazardName: event.target.value })} />
                <select className="input" value={hazard.categoryId} onChange={(event) => updateHazard(setHazards, index, { categoryId: event.target.value as HazardDomain })}>
                  {MANUAL_ASSESSMENT_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
                <div className="sm:col-span-2"><EvidenceSelector evidence={eligibleEvidence.map((item) => item.key)} selected={hazard.evidenceReferences} onChange={(value) => updateHazard(setHazards, index, { evidenceReferences: value })} /></div>
                <textarea className="input sm:col-span-2" placeholder="Hazard rationale (minimum 10 characters; explain the information gap if no eligible evidence exists)" value={hazard.rationale} onChange={(event) => updateHazard(setHazards, index, { rationale: event.target.value })} />
                {hazards.length > 1 && <button type="button" className="btn-secondary justify-self-start sm:col-span-2" onClick={() => setHazards((value) => value.filter((_, current) => current !== index))}>Remove hazard</button>}
              </div>
            ))}
          </div>

          <div className="mt-6">
            <h3 className="font-display font-semibold text-ink-800">Eight-category official input</h3>
            <p className="mt-1 text-xs text-ink-500">The versioned HIRARC evaluator applies category floors after submission; it can increase, never lower, the Admin input.</p>
            <div className="mt-3 space-y-3">
              {categories.map((category, index) => (
                <div key={category.categoryId} className="border border-[#e3dacb] p-3">
                  <p className="text-sm font-semibold text-ink-800">{MANUAL_ASSESSMENT_CATEGORIES[index].name}</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <Score label="Likelihood" value={category.likelihood} onChange={(value) => updateCategory(setCategories, index, { likelihood: value })} />
                    <Score label="Severity" value={category.severity} onChange={(value) => updateCategory(setCategories, index, { severity: value })} />
                  </div>
                  <EvidenceSelector evidence={eligibleEvidence.map((item) => item.key)} selected={category.evidenceReferences} onChange={(value) => updateCategory(setCategories, index, { evidenceReferences: value })} />
                  <textarea className="input mt-2" placeholder="Category rationale" value={category.rationale} onChange={(event) => updateCategory(setCategories, index, { rationale: event.target.value })} />
                  <textarea className="input mt-2" placeholder="Missing-information explanation when no evidence is selected" value={category.missingInformation} onChange={(event) => updateCategory(setCategories, index, { missingInformation: event.target.value })} />
                </div>
              ))}
            </div>
          </div>

          <label className="mt-5 block text-sm font-semibold text-ink-700">Overall assessment rationale<textarea className="input mt-2" rows={4} maxLength={2000} value={rationale} onChange={(event) => setRationale(event.target.value)} /></label>
          <button className="btn-primary mt-4" disabled={submitting} onClick={submit} type="button">{submitting ? 'Finalizing...' : 'Submit locked manual assessment'}</button>
        </>
      )}
    </div>
  );
}

function Score({ label, value, onChange }: { label: string; value: ScoreRating; onChange: (value: ScoreRating) => void }) {
  return <label className="text-xs text-ink-600">{label}<select className="input mt-1" value={value} onChange={(event) => onChange(Number(event.target.value) as ScoreRating)}>{[1, 2, 3, 4, 5].map((score) => <option key={score}>{score}</option>)}</select></label>;
}

function EvidenceSelector({ evidence, selected, onChange }: { evidence: EvidenceKey[]; selected: EvidenceKey[]; onChange: (value: EvidenceKey[]) => void }) {
  return <fieldset className="mt-2"><legend className="text-xs font-medium text-ink-600">Eligible evidence references</legend><div className="mt-1 flex flex-wrap gap-2">{evidence.length ? evidence.map((key) => <label key={key} className="inline-flex items-center gap-1 rounded border border-[#ded5c5] px-2 py-1 text-xs"><input type="checkbox" checked={selected.includes(key)} onChange={(event) => onChange(event.target.checked ? [...selected, key] : selected.filter((value) => value !== key))} />{key}</label>) : <span className="text-xs text-status-rejected">No eligible evidence is available.</span>}</div></fieldset>;
}

function updateHazard(setter: React.Dispatch<React.SetStateAction<AdminManualHazard[]>>, index: number, patch: Partial<AdminManualHazard>) {
  setter((values) => values.map((value, current) => current === index ? { ...value, ...patch } : value));
}

function updateCategory(setter: React.Dispatch<React.SetStateAction<AdminManualCategoryInput[]>>, index: number, patch: Partial<AdminManualCategoryInput>) {
  setter((values) => values.map((value, current) => current === index ? { ...value, ...patch } : value));
}
