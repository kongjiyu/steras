import { useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
  AdminManualCategoryInput,
  AdminManualHazard,
  AdminManualResourcePlan,
  EvidenceKey,
  HazardDomain,
  ManualReviewRiskAssessment,
  RESOURCE_KEYS,
  ResourceKey,
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

type ManualResourceDraft = Record<ResourceKey, { quantity: string }>;
type ManualResourceValidationPlan = Partial<Record<ResourceKey, { quantity?: number | string; maximum?: number | string }>>;

const RESOURCE_LABELS: Record<ResourceKey, string> = {
  police: 'Police officers',
  security: 'Security personnel',
  medicalTeams: 'Medical teams',
  ambulances: 'Ambulances',
  fireOfficers: 'Fire officers',
  toilets: 'Toilets',
  wasteBins: 'Waste bins',
};

/** Client-side mirror of the callable's validation rules. */
export function validateManualAssessmentDraft(
  hazards: AdminManualHazard[],
  categories: AdminManualCategoryInput[],
  rationale: string,
  eligibleEvidence: EvidenceKey[],
  resourcePlan?: ManualResourceValidationPlan,
  resourceRationale = '',
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
    if (category.missingInformation.length > 1000) errors[`${prefix}-missing`] = 'Missing-information explanation must be at most 1000 characters.';
  });
  if (rationale.trim().length < 20) errors.rationale = 'Enter an overall assessment rationale (at least 20 characters).';
  // The fourth-argument legacy helper remains usable by existing callers;
  // the form itself passes the fifth argument and therefore opts into the
  // required Admin resource-plan validation.
  if (arguments.length >= 5) {
    RESOURCE_KEYS.forEach((key) => {
      const item = resourcePlan?.[key];
      const quantity = wholeNumber(item?.quantity);
      const maximum = item?.maximum === undefined ? undefined : wholeNumber(item.maximum);
      if (quantity === undefined || quantity < 0) errors[`resource-${key}-quantity`] = 'Enter a whole number of 0 or more.';
      if (item?.maximum !== undefined && (maximum === undefined || maximum < 0)) errors[`resource-${key}-maximum`] = 'Enter a whole number of 0 or more.';
      if (quantity !== undefined && maximum !== undefined && maximum < quantity) errors[`resource-${key}-range`] = 'Maximum must be at least the recommended quantity.';
    });
    if (resourceRationale.trim().length < 10) errors['resource-rationale'] = 'Explain the resource planning basis (at least 10 characters).';
  }
  return errors;
}

export function friendlyManualAssessmentError(code: string): string {
  if (code === 'assessment-rationale') return 'Enter an overall assessment rationale (at least 20 characters).';
  if (code === 'resource-plan') return 'Enter a recommended quantity for all seven resources.';
  if (code === 'resource-rationale') return 'Explain the resource planning basis (at least 10 characters).';
  if (code.startsWith('resource-') && code.endsWith('-range')) return 'Maximum must be at least the recommended quantity.';
  if (code.startsWith('resource-')) return 'Enter a whole number of 0 or more.';
  if (code === 'hazard-count') return 'Add at least one hazard.';
  if (code === 'hazard') return 'Complete the hazard name, evidence, and rationale fields.';
  if (code === 'category-count' || code === 'missing-category' || code === 'category') return 'Complete all eight assessment categories.';
  if (code.startsWith('score-')) return `Choose likelihood and severity scores for ${formatCategory(code.slice('score-'.length))}.`;
  if (code.startsWith('rationale-')) return `Enter a rationale for ${formatCategory(code.slice('rationale-'.length))}.`;
  if (code.startsWith('evidence-')) return `Review the evidence references for ${formatCategory(code.slice('evidence-'.length))}.`;
  if (code.startsWith('missing-information-')) return `Explain missing information for ${formatCategory(code.slice('missing-information-'.length))}.`;
  return 'Complete the highlighted manual-assessment fields.';
}

interface AdminAiRetryPanelProps {
  eventId: string;
  onCompleted?: () => void;
  failureMessage?: string;
}

export function AdminAiRetryPanel({ eventId, onCompleted, failureMessage }: AdminAiRetryPanelProps) {
  const [retryingAI, setRetryingAI] = useState(false);
  const retryAI = async () => {
    setRetryingAI(true);
    try {
      const retryAssessment = httpsCallable<
        { eventId: string },
        { success: boolean; assessmentStatus?: string; reason?: string }
      >(functions, 'manualRecompute', { timeout: 240_000 });
      const result = (await retryAssessment({ eventId })).data;
      if (!result.success) throw new Error(`AI retry was not applied${result.reason ? `: ${result.reason}` : '.'}`);
      if (result.assessmentStatus === 'provisional_ready') {
        toast.success('AI assessment completed and produced a provisional result.');
      } else {
        toast.error('AI remains unavailable after all retry attempts. Continue with the manual assessment.');
      }
      onCompleted?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'AI assessment retry failed.');
    } finally {
      setRetryingAI(false);
    }
  };
  return (
    <div className="rounded-md border border-brand-200 bg-brand-50/50 p-4">
      <p className="text-sm font-semibold text-ink-800">Retry the AI assessment</p>
      {failureMessage && <p className="mt-1 text-xs leading-5 text-status-rejected">Previous attempt: {failureMessage}</p>}
      <p className="mt-1 text-xs leading-5 text-ink-600">STERAS will reassess this unchanged application and automatically retry invalid, timed-out or unavailable MiniMax responses up to three times.</p>
      <button className="btn-secondary mt-3" disabled={retryingAI} onClick={retryAI} type="button">
        {retryingAI ? 'AI is reassessing…' : 'Retry AI assessment'}
      </button>
    </div>
  );
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
  const [resourcePlan, setResourcePlan] = useState<ManualResourceDraft>(() => Object.fromEntries(
    RESOURCE_KEYS.map((key) => [key, { quantity: '' }]),
  ) as ManualResourceDraft);
  const [resourceRationale, setResourceRationale] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ManualAssessmentFieldErrors>({});
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [idempotencyKey] = useState(() => `manual-${crypto.randomUUID()}`);
  const persisted = Boolean(assessment.activeManualAssessmentId);
  const evidenceKeys = useMemo(() => [...new Set(eligibleEvidence.map((item) => item.key))], [eligibleEvidence]);
  const normalizedResourcePlan = useMemo(() => toResourcePlan(resourcePlan), [resourcePlan]);
  const errors = useMemo(() => validateManualAssessmentDraft(hazards, categories, rationale, evidenceKeys, resourcePlan, resourceRationale), [categories, evidenceKeys, hazards, rationale, resourcePlan, resourceRationale]);
  const completeCategories = categories.filter((category) => Object.keys(validateManualAssessmentDraft([hazards[0]], [category], 'a'.repeat(20), evidenceKeys)).every((key) => !key.startsWith('category-'))).length;
  const canRetryAI = assessment.aiProposal !== null && assessment.aiProposal.status !== 'success';

  const submit = async () => {
    setValidationAttempted(true);
    const validationErrors = validateManualAssessmentDraft(hazards, categories, rationale, evidenceKeys, resourcePlan, resourceRationale);
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      window.setTimeout(() => {
        const firstInvalid = document.querySelector<HTMLElement>('[data-manual-field-error="true"]');
        firstInvalid?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        firstInvalid?.focus();
      }, 0);
      return;
    }
    setSubmitting(true);
    try {
      await httpsCallable(functions, 'submitAdminManualAssessment')({ eventId, hazards, categories, rationale, resourcePlan: normalizedResourcePlan, resourceRationale, idempotencyKey });
      toast.success('Manual assessment finalized as the official assessment.');
      onCompleted?.();
    } catch (error) {
      const details = error && typeof error === 'object' && 'details' in error ? (error as { details?: unknown }).details : undefined;
      const serverErrors = details && typeof details === 'object' && 'fieldErrors' in details && Array.isArray((details as { fieldErrors?: unknown }).fieldErrors)
        ? (details as { fieldErrors: unknown[] }).fieldErrors.filter((value): value is string => typeof value === 'string') : [];
      if (serverErrors.length) {
        const translated = mapServerErrorsToFields(serverErrors);
        setFieldErrors(translated);
        window.setTimeout(() => {
          const firstInvalid = document.querySelector<HTMLElement>('[data-manual-field-error="true"]');
          firstInvalid?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          firstInvalid?.focus();
        }, 0);
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
          {canRetryAI && (
            <div className="mb-5"><AdminAiRetryPanel eventId={eventId} onCompleted={onCompleted} /></div>
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
                <input className="input" placeholder="Hazard name" value={hazard.hazardName} onChange={(event) => updateHazard(setHazards, index, { hazardName: event.target.value })} aria-invalid={Boolean(fieldErrors[`hazard-${index}-name`])} data-manual-field-error={fieldErrors[`hazard-${index}-name`] ? 'true' : undefined} />
                <select className="input" value={hazard.categoryId} onChange={(event) => updateHazard(setHazards, index, { categoryId: event.target.value as HazardDomain })}>
                  {MANUAL_ASSESSMENT_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
                <div className="sm:col-span-2"><EvidenceSelector evidence={evidenceKeys} selected={hazard.evidenceReferences} error={fieldErrors[`hazard-${index}-evidence`]} onChange={(value) => updateHazard(setHazards, index, { evidenceReferences: value })} />{fieldErrors[`hazard-${index}-evidence`] && <p className="mt-1 text-xs text-status-rejected">{fieldErrors[`hazard-${index}-evidence`]}</p>}</div>
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
                  <EvidenceSelector evidence={evidenceKeys} selected={category.evidenceReferences} error={fieldErrors[`category-${index}-evidence`]} onChange={(value) => updateCategory(setCategories, index, { evidenceReferences: value })} />
                  {fieldErrors[`category-${index}-evidence`] && <p className="mt-1 text-xs text-status-rejected">{fieldErrors[`category-${index}-evidence`]}</p>}
                  <textarea className="input mt-2" placeholder="Category rationale" value={category.rationale} onChange={(event) => updateCategory(setCategories, index, { rationale: event.target.value })} aria-invalid={Boolean(fieldErrors[`category-${index}-rationale`])} data-manual-field-error={fieldErrors[`category-${index}-rationale`] ? 'true' : undefined} />
                  {fieldErrors[`category-${index}-rationale`] && <p className="mt-1 text-xs text-status-rejected">{fieldErrors[`category-${index}-rationale`]}</p>}
                  <textarea className="input mt-2" placeholder="Missing-information explanation when no evidence is selected" value={category.missingInformation} onChange={(event) => updateCategory(setCategories, index, { missingInformation: event.target.value })} aria-invalid={Boolean(fieldErrors[`category-${index}-missing`])} data-manual-field-error={fieldErrors[`category-${index}-missing`] ? 'true' : undefined} />
                  {fieldErrors[`category-${index}-missing`] && <p className="mt-1 text-xs text-status-rejected">{fieldErrors[`category-${index}-missing`]}</p>}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 rounded-md border border-[#e3dacb] bg-cream-50 p-4" data-testid="manual-resource-plan">
            <h3 className="font-display font-semibold text-ink-800">Admin resource recommendation</h3>
            <p className="mt-1 text-xs leading-5 text-ink-500">Set the Admin-recommended quantity for each resource. The official planning range is recorded as that quantity.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {RESOURCE_KEYS.map((key) => (
                <div key={key} className="rounded border border-[#e3dacb] bg-white p-3">
                  <p className="text-sm font-semibold text-ink-800">{RESOURCE_LABELS[key]}</p>
                  <label className="mt-2 block text-xs text-ink-600">Recommended quantity
                    <input className="input mt-1" type="number" min="0" step="1" inputMode="numeric" value={resourcePlan[key].quantity} onChange={(event) => updateResource(setResourcePlan, key, { quantity: event.target.value })} aria-invalid={Boolean(fieldErrors[`resource-${key}-quantity`])} data-manual-field-error={fieldErrors[`resource-${key}-quantity`] ? 'true' : undefined} />
                  </label>
                  {fieldErrors[`resource-${key}-quantity`] && <p className="mt-1 text-xs text-status-rejected">{fieldErrors[`resource-${key}-quantity`]}</p>}
                </div>
              ))}
            </div>
            <label className="mt-3 block text-xs font-medium text-ink-600">Resource planning rationale
              <textarea className="input mt-1" rows={3} maxLength={2000} value={resourceRationale} onChange={(event) => setResourceRationale(event.target.value)} aria-invalid={Boolean(fieldErrors['resource-rationale'])} data-manual-field-error={fieldErrors['resource-rationale'] ? 'true' : undefined} placeholder="Explain the operational basis for these quantities." />
            </label>
            {fieldErrors['resource-rationale'] && <p className="mt-1 text-xs text-status-rejected">{fieldErrors['resource-rationale']}</p>}
          </div>

          <label className="mt-5 block text-sm font-semibold text-ink-700">Overall assessment rationale<textarea className="input mt-2" rows={4} maxLength={2000} value={rationale} onChange={(event) => setRationale(event.target.value)} aria-invalid={Boolean(fieldErrors.rationale)} data-manual-field-error={fieldErrors.rationale ? 'true' : undefined} /></label>
          {fieldErrors.rationale && <p className="mt-1 text-xs text-status-rejected">{fieldErrors.rationale}</p>}
          {validationAttempted && Object.keys(errors).length > 0 && (
            <div className="mt-4 rounded-md border border-status-rejected/40 bg-red-50 p-3 text-sm text-status-rejected" role="alert" data-testid="manual-validation-summary">
              <p className="font-semibold">{Object.keys(errors).length} field{Object.keys(errors).length === 1 ? '' : 's'} need attention.</p>
              <p className="mt-1 text-xs">Complete the highlighted fields, then submit again. The first incomplete field will be brought into view.</p>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500"><span>{Object.keys(errors).length ? 'Complete the highlighted fields before submitting.' : 'All required fields are complete.'}</span><span>{rationale.trim().length}/2000 · minimum 20</span></div>
          <button className="btn-primary mt-4" disabled={submitting} onClick={submit} type="button" data-testid="manual-assessment-submit">{submitting ? 'Finalizing...' : 'Submit locked manual assessment'}</button>
        </>
      )}
    </div>
  );
}

function Score({ label, value, error, onChange }: { label: string; value: ScoreRating; error?: string; onChange: (value: ScoreRating) => void }) {
  return <label className="text-xs text-ink-600">{label}<select className="input mt-1" value={value} aria-invalid={Boolean(error)} data-manual-field-error={error ? 'true' : undefined} onChange={(event) => onChange(Number(event.target.value) as ScoreRating)}>{[1, 2, 3, 4, 5].map((score) => <option key={score}>{score}</option>)}</select>{error && <span className="mt-1 block text-[11px] text-status-rejected">{error}</span>}</label>;
}

function EvidenceSelector({ evidence, selected, error, onChange }: { evidence: EvidenceKey[]; selected: EvidenceKey[]; error?: string; onChange: (value: EvidenceKey[]) => void }) {
  return <fieldset className="mt-2" tabIndex={error ? -1 : undefined} data-manual-field-error={error ? 'true' : undefined} aria-invalid={Boolean(error)}><legend className="text-xs font-medium text-ink-600">Eligible evidence references</legend><div className="mt-1 flex flex-wrap gap-2">{evidence.length ? evidence.map((key) => <label key={key} className="inline-flex items-center gap-1 rounded border border-[#ded5c5] px-2 py-1 text-xs"><input type="checkbox" checked={selected.includes(key)} onChange={(event) => onChange(event.target.checked ? [...selected, key] : selected.filter((value) => value !== key))} />{formatEvidenceKey(key)}</label>) : <span className="text-xs text-status-rejected">No eligible evidence is available.</span>}</div></fieldset>;
}

function updateHazard(setter: React.Dispatch<React.SetStateAction<AdminManualHazard[]>>, index: number, patch: Partial<AdminManualHazard>) {
  setter((values) => values.map((value, current) => current === index ? { ...value, ...patch } : value));
}

function updateCategory(setter: React.Dispatch<React.SetStateAction<AdminManualCategoryInput[]>>, index: number, patch: Partial<AdminManualCategoryInput>) {
  setter((values) => values.map((value, current) => current === index ? { ...value, ...patch } : value));
}

function updateResource(setter: React.Dispatch<React.SetStateAction<ManualResourceDraft>>, key: ResourceKey, patch: Partial<ManualResourceDraft[ResourceKey]>) {
  setter((values) => ({ ...values, [key]: { ...values[key], ...patch } }));
}

function toResourcePlan(draft: ManualResourceDraft): AdminManualResourcePlan | undefined {
  const values = Object.fromEntries(RESOURCE_KEYS.map((key) => [key, {
    quantity: Number(draft[key].quantity),
  }])) as AdminManualResourcePlan;
  return RESOURCE_KEYS.every((key) => draft[key].quantity.trim() !== ''
    && Number.isSafeInteger(values[key].quantity) && values[key].quantity >= 0)
    ? values : undefined;
}

function wholeNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function formatCategory(categoryId: string): string {
  return MANUAL_ASSESSMENT_CATEGORIES.find((category) => category.id === categoryId)?.name ?? categoryId.replaceAll('_', ' ');
}

function formatEvidenceKey(key: EvidenceKey): string {
  const labels: Record<EvidenceKey, string> = {
    weather: 'Weather forecast',
    crowd: 'Crowd and attendance',
    venue: 'Venue registry',
    history: 'Historical incidents',
    holiday: 'Calendar and holidays',
    public_health: 'Public-health context',
    sanitation: 'Food, water and sanitation',
    medical: 'Medical capacity',
    security: 'Security context',
    transport: 'Transport and accessibility',
    compliance: 'Submitted compliance evidence',
  };
  return labels[key] ?? key.replaceAll('_', ' ');
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
    } else if (code.startsWith('resource-')) {
      mapped[code] = message;
    } else {
      mapped[code] = message;
    }
  }
  return mapped;
}
