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

export type ManualAssessmentFieldErrors = Record<string, string>;

/** Client-side mirror of the callable's validation rules. */
export function validateManualAssessmentDraft(
  hazards: AdminManualHazard[],
  categories: AdminManualCategoryInput[],
  rationale: string,
  eligibleEvidence: EvidenceKey[],
): ManualAssessmentFieldErrors {
  const errors: ManualAssessmentFieldErrors = {};
  if (!hazards.length) errors.hazards = 'Add at least one hazard.';
  hazards.forEach((hazard, index) => {
    if (hazard.hazardName.trim().length < 3) errors[`hazard-${index}-name`] = 'Enter a hazard name (at least 3 characters).';
    if (eligibleEvidence.length > 0 && hazard.evidenceReferences.length === 0) errors[`hazard-${index}-evidence`] = 'Select at least one eligible evidence reference.';
    if (hazard.rationale.trim().length < 10) errors[`hazard-${index}-rationale`] = 'Explain the hazard or information gap (at least 10 characters).';
  });
  if (categories.length !== MANUAL_ASSESSMENT_CATEGORIES.length) errors.categories = 'All eight categories are required.';
  categories.forEach((category, index) => {
    const prefix = `category-${index}`;
    if (!Number.isInteger(category.likelihood) || category.likelihood < 1 || category.likelihood > 5) errors[`${prefix}-likelihood`] = 'Choose a likelihood score from 1 to 5.';
    if (!Number.isInteger(category.severity) || category.severity < 1 || category.severity > 5) errors[`${prefix}-severity`] = 'Choose a severity score from 1 to 5.';
    if (category.rationale.trim().length < 10) errors[`${prefix}-rationale`] = 'Enter a category rationale (at least 10 characters).';
    if (category.evidenceReferences.some((reference) => !eligibleEvidence.includes(reference))) errors[`${prefix}-evidence`] = 'Remove evidence references that are not eligible for this version.';
    if (category.evidenceReferences.length === 0 && category.missingInformation.trim().length < 10) errors[`${prefix}-missing`] = 'Explain what information is missing (at least 10 characters).';
    if (category.evidenceReferences.length > 0 && category.missingInformation.length > 1000) errors[`${prefix}-missing`] = 'Missing-information explanation must be at most 1000 characters.';
  });
  if (rationale.trim().length < 20) errors.rationale = 'Enter an overall assessment rationale (at least 20 characters).';
  return errors;
}

export function friendlyManualAssessmentError(code: string): string {
  if (code === 'assessment-rationale') return 'Enter an overall assessment rationale (at least 20 characters).';
  if (code === 'hazard-count') return 'Add at least one hazard.';
  if (code === 'hazard') return 'Complete the hazard name, evidence, and rationale fields.';
  if (code === 'category-count' || code === 'missing-category' || code === 'category') return 'Complete all eight assessment categories.';
  if (code.startsWith('score-')) return `Choose likelihood and severity scores for ${formatCategory(code.slice('score-'.length))}.`;
  if (code.startsWith('rationale-')) return `Enter a rationale for ${formatCategory(code.slice('rationale-'.length))}.`;
  if (code.startsWith('evidence-')) return `Review the evidence references for ${formatCategory(code.slice('evidence-'.length))}.`;
  if (code.startsWith('missing-information-')) return `Explain missing information for ${formatCategory(code.slice('missing-information-'.length))}.`;
  return 'Complete the highlighted manual-assessment fields.';
}

export default function ManualAssessmentForm({ eventId, assessment, onCompleted }: ManualAssessmentFormProps) {
  const eligibleEvidence = useMemo(
    () => assessment.evidence.filter((evidence) => evidence && evidence.eligibility === 'eligible' && evidence.quality !== 'missing'
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
  const [fieldErrors, setFieldErrors] = useState<ManualAssessmentFieldErrors>({});
  const [idempotencyKey] = useState(() => `manual-${crypto.randomUUID()}`);
  const persisted = Boolean(assessment.activeManualAssessmentId);
  const evidenceKeys = eligibleEvidence.map((item) => item.key);
  const errors = useMemo(() => validateManualAssessmentDraft(hazards, categories, rationale, evidenceKeys), [categories, evidenceKeys, hazards, rationale]);
  const completeCategories = categories.filter((category) => Object.keys(validateManualAssessmentDraft([hazards[0]], [category], 'a'.repeat(20), evidenceKeys)).every((key) => !key.startsWith('category-'))).length;

  const submit = async () => {
    const validationErrors = validateManualAssessmentDraft(hazards, categories, rationale, evidenceKeys);
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      window.setTimeout(() => document.querySelector<HTMLElement>('[data-manual-field-error="true"]')?.focus(), 0);
      return;
    }
    setSubmitting(true);
    try {
      await httpsCallable(functions, 'submitAdminManualAssessment')({ eventId, hazards, categories, rationale, idempotencyKey });
      toast.success('Manual assessment finalized as the official assessment.');
      onCompleted?.();
    } catch (error) {
      const details = error && typeof error === 'object' && 'details' in error ? (error as { details?: unknown }).details : undefined;
      const serverErrors = details && typeof details === 'object' && 'fieldErrors' in details && Array.isArray((details as { fieldErrors?: unknown }).fieldErrors)
        ? (details as { fieldErrors: unknown[] }).fieldErrors.filter((value): value is string => typeof value === 'string') : [];
      if (serverErrors.length) {
        const translated = mapServerErrorsToFields(serverErrors);
        setFieldErrors(translated);
        window.setTimeout(() => document.querySelector<HTMLElement>('[data-manual-field-error="true"]')?.focus(), 0);
        toast.error('Complete the highlighted manual-assessment fields.');
      } else toast.error(error instanceof Error ? error.message : 'Manual assessment could not be submitted.');
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
                <input className="input" placeholder="Hazard name" value={hazard.hazardName} onChange={(event) => updateHazard(setHazards, index, { hazardName: event.target.value })} aria-invalid={Boolean(fieldErrors[`hazard-${index}-name`])} data-manual-field-error={fieldErrors[`hazard-${index}-name`] ? 'true' : undefined} />
                <select className="input" value={hazard.categoryId} onChange={(event) => updateHazard(setHazards, index, { categoryId: event.target.value as HazardDomain })}>
                  {MANUAL_ASSESSMENT_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
                <div className="sm:col-span-2"><EvidenceSelector evidence={evidenceKeys} selected={hazard.evidenceReferences} onChange={(value) => updateHazard(setHazards, index, { evidenceReferences: value })} />{fieldErrors[`hazard-${index}-evidence`] && <p className="mt-1 text-xs text-status-rejected">{fieldErrors[`hazard-${index}-evidence`]}</p>}</div>
                <textarea className="input sm:col-span-2" placeholder="Hazard rationale (minimum 10 characters; explain the information gap if no eligible evidence exists)" value={hazard.rationale} onChange={(event) => updateHazard(setHazards, index, { rationale: event.target.value })} aria-invalid={Boolean(fieldErrors[`hazard-${index}-rationale`])} data-manual-field-error={fieldErrors[`hazard-${index}-rationale`] ? 'true' : undefined} />
                {(fieldErrors[`hazard-${index}-name`] || fieldErrors[`hazard-${index}-rationale`]) && <p className="text-xs text-status-rejected sm:col-span-2">{fieldErrors[`hazard-${index}-name`] || fieldErrors[`hazard-${index}-rationale`]}</p>}
                {hazards.length > 1 && <button type="button" className="btn-secondary justify-self-start sm:col-span-2" onClick={() => setHazards((value) => value.filter((_, current) => current !== index))}>Remove hazard</button>}
              </div>
            ))}
          </div>

          <div className="mt-6">
            <h3 className="font-display font-semibold text-ink-800">Eight-category official input</h3>
            <p className="mt-1 text-xs text-ink-500">The versioned HIRARC evaluator applies category floors after submission; it can increase, never lower, the Admin input.</p>
            <p className="mt-2 text-xs font-semibold text-ink-700" data-testid="manual-category-progress">{completeCategories} of 8 categories complete</p>
            <div className="mt-3 space-y-3">
              {categories.map((category, index) => (
                <div key={category.categoryId} className="border border-[#e3dacb] p-3">
                  <p className="text-sm font-semibold text-ink-800">{MANUAL_ASSESSMENT_CATEGORIES[index].name}</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <Score label="Likelihood" value={category.likelihood} error={fieldErrors[`category-${index}-likelihood`]} onChange={(value) => updateCategory(setCategories, index, { likelihood: value })} />
                    <Score label="Severity" value={category.severity} error={fieldErrors[`category-${index}-severity`]} onChange={(value) => updateCategory(setCategories, index, { severity: value })} />
                  </div>
                  <EvidenceSelector evidence={evidenceKeys} selected={category.evidenceReferences} onChange={(value) => updateCategory(setCategories, index, { evidenceReferences: value })} />
                  {fieldErrors[`category-${index}-evidence`] && <p className="mt-1 text-xs text-status-rejected">{fieldErrors[`category-${index}-evidence`]}</p>}
                  <textarea className="input mt-2" placeholder="Category rationale" value={category.rationale} onChange={(event) => updateCategory(setCategories, index, { rationale: event.target.value })} aria-invalid={Boolean(fieldErrors[`category-${index}-rationale`])} data-manual-field-error={fieldErrors[`category-${index}-rationale`] ? 'true' : undefined} />
                  {fieldErrors[`category-${index}-rationale`] && <p className="mt-1 text-xs text-status-rejected">{fieldErrors[`category-${index}-rationale`]}</p>}
                  <textarea className="input mt-2" placeholder="Missing-information explanation when no evidence is selected" value={category.missingInformation} onChange={(event) => updateCategory(setCategories, index, { missingInformation: event.target.value })} aria-invalid={Boolean(fieldErrors[`category-${index}-missing`])} data-manual-field-error={fieldErrors[`category-${index}-missing`] ? 'true' : undefined} />
                  {fieldErrors[`category-${index}-missing`] && <p className="mt-1 text-xs text-status-rejected">{fieldErrors[`category-${index}-missing`]}</p>}
                </div>
              ))}
            </div>
          </div>

          <label className="mt-5 block text-sm font-semibold text-ink-700">Overall assessment rationale<textarea className="input mt-2" rows={4} maxLength={2000} value={rationale} onChange={(event) => setRationale(event.target.value)} aria-invalid={Boolean(fieldErrors.rationale)} data-manual-field-error={fieldErrors.rationale ? 'true' : undefined} /></label>
          {fieldErrors.rationale && <p className="mt-1 text-xs text-status-rejected">{fieldErrors.rationale}</p>}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500"><span>{Object.keys(errors).length ? 'Complete the highlighted fields before submitting.' : 'All required fields are complete.'}</span><span>{rationale.trim().length}/2000 · minimum 20</span></div>
          <button className="btn-primary mt-4" disabled={submitting || Object.keys(errors).length > 0} onClick={submit} type="button">{submitting ? 'Finalizing...' : 'Submit locked manual assessment'}</button>
        </>
      )}
    </div>
  );
}

function Score({ label, value, error, onChange }: { label: string; value: ScoreRating; error?: string; onChange: (value: ScoreRating) => void }) {
  return <label className="text-xs text-ink-600">{label}<select className="input mt-1" value={value} aria-invalid={Boolean(error)} data-manual-field-error={error ? 'true' : undefined} onChange={(event) => onChange(Number(event.target.value) as ScoreRating)}>{[1, 2, 3, 4, 5].map((score) => <option key={score}>{score}</option>)}</select>{error && <span className="mt-1 block text-[11px] text-status-rejected">{error}</span>}</label>;
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

function formatCategory(categoryId: string): string {
  return MANUAL_ASSESSMENT_CATEGORIES.find((category) => category.id === categoryId)?.name ?? categoryId.replaceAll('_', ' ');
}

function mapServerErrorsToFields(codes: string[]): ManualAssessmentFieldErrors {
  const mapped: ManualAssessmentFieldErrors = {};
  for (const code of codes) {
    const message = friendlyManualAssessmentError(code);
    const categoryId = code.startsWith('missing-information-')
      ? code.slice('missing-information-'.length)
      : code.startsWith('score-') || code.startsWith('rationale-') || code.startsWith('evidence-')
        ? code.slice(code.indexOf('-') + 1)
        : '';
    const categoryIndex = MANUAL_ASSESSMENT_CATEGORIES.findIndex((category) => category.id === categoryId);
    if (categoryIndex >= 0) {
      const field = code.startsWith('score-') ? 'likelihood' : code.startsWith('rationale-') ? 'rationale' : code.startsWith('evidence-') ? 'evidence' : 'missing';
      mapped[`category-${categoryIndex}-${field}`] = message;
    } else if (code === 'hazard') {
      mapped['hazard-0-name'] = message;
    } else if (code === 'hazard-count') {
      mapped.hazards = message;
    } else if (code === 'assessment-rationale') {
      mapped.rationale = message;
    } else {
      mapped[code] = message;
    }
  }
  return mapped;
}
