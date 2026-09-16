import { useEffect, useMemo, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';
import {
  AuthorityCategoryScoreReview,
  AuthorityType,
  COLLECTIONS,
  ProvisionalRiskAssessment,
  ScoreRating,
} from '@shared/types';
import { db, functions } from '../../config/firebase';
import { isAuthorityScoreReview } from './m2Contract';

interface Props {
  eventId: string;
  assessment: ProvisionalRiskAssessment;
  authorityType: AuthorityType;
  /** Render inside AIAdvisory instead of as a separate card. */
  embedded?: boolean;
  onCancel?: () => void;
  onSubmitted?: () => void;
}

type Draft = {
  categoryId: string;
  decision: 'confirmed' | 'overridden';
  likelihood: ScoreRating;
  severity: ScoreRating;
  reason: string;
};

export default function AuthorityScoreReviewForm({ eventId, assessment, authorityType, embedded = false, onCancel, onSubmitted }: Props) {
  const proposalByCategory = useMemo(() => new Map(
    assessment.aiProposal.categories.map((category) => [category.categoryId, category]),
  ), [assessment.aiProposal.categories]);
  const [drafts, setDrafts] = useState<Draft[]>(() => initialDrafts(assessment));
  const [rationale, setRationale] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => newKey());
  const [submitting, setSubmitting] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const ownHead = assessment.authorityReviewState?.activeReviewHeads[authorityType];
  const ownHeadId = ownHead?.reviewId;
  const categoryCount = assessment.provisionalResult.categories.length;
  const assessmentIdentity = `${assessment.assessmentId}:${assessment.aiProposal.proposalId}`;
  const draftIdentity = useRef(assessmentIdentity);
  const editGeneration = useRef(0);
  const dirty = useRef(false);

  useEffect(() => {
    if (draftIdentity.current === assessmentIdentity) return;
    draftIdentity.current = assessmentIdentity;
    editGeneration.current = 0;
    dirty.current = false;
    setDrafts(initialDrafts(assessment));
    setRationale('');
    setIdempotencyKey(newKey());
    setSelectedCategoryId(null);
  }, [assessment, assessmentIdentity]);

  useEffect(() => {
    if (!ownHeadId || dirty.current) return;
    let active = true;
    const hydrationGeneration = editGeneration.current;
    void getDoc(doc(db, COLLECTIONS.EVENTS, eventId, COLLECTIONS.ASSESSMENTS, assessment.assessmentId, COLLECTIONS.SCORE_REVIEWS, ownHeadId))
      .then((snapshot) => {
        const review = snapshot.data();
        if (!active || dirty.current || editGeneration.current !== hydrationGeneration
          || !isAuthorityScoreReview(review, ownHeadId, {
            eventId,
            versionId: assessment.versionId,
            assessmentId: assessment.assessmentId,
          })
          || review.authorityType !== authorityType
          || review.categories.length !== categoryCount) return;
        setDrafts(review.categories.map((category) => ({
          categoryId: category.categoryId,
          decision: category.decision,
          likelihood: category.likelihood,
          severity: category.severity,
          reason: category.decision === 'overridden' ? category.reason : '',
        })));
        setRationale(review.rationale);
      })
      .catch(() => toast.error('Your current score review could not be loaded.'));
    return () => { active = false; };
  }, [assessment.assessmentId, assessment.versionId, authorityType, categoryCount, eventId, ownHeadId]);

  const update = (categoryId: string, change: Partial<Draft>) => {
    editGeneration.current += 1;
    dirty.current = true;
    setDrafts((current) => current.map((draft) => draft.categoryId === categoryId ? { ...draft, ...change } : draft));
  };
  const valid = rationale.trim().length >= 10
    && drafts.every((draft) => draft.decision === 'confirmed' || draft.reason.trim().length >= 10);

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const categories: AuthorityCategoryScoreReview[] = drafts.map((draft) => draft.decision === 'confirmed'
        ? { categoryId: draft.categoryId, likelihood: draft.likelihood, severity: draft.severity, decision: 'confirmed' }
        : { categoryId: draft.categoryId, likelihood: draft.likelihood, severity: draft.severity, decision: 'overridden', reason: draft.reason.trim() });
      const callable = httpsCallable(functions, 'submitAuthorityScoreReview');
      await callable({ eventId, categories, rationale: rationale.trim(), idempotencyKey });
      dirty.current = false;
      toast.success(ownHead ? 'Score review revision recorded.' : 'Score review recorded.');
      setIdempotencyKey(newKey());
      onSubmitted?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to submit the score review.');
    } finally {
      setSubmitting(false);
    }
  };

  const editor = (
    <div data-testid="authority-score-editor-content">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-semibold text-ink-800">Review AI category scores</h3>
          <p className="mt-1 text-xs leading-5 text-ink-500">Select a category to inspect or override it. Categories you leave unchanged are submitted as confirmed AI scores.</p>
        </div>
        <span className={`badge ${ownHead ? 'bg-green-100 text-status-approved' : 'bg-gold-100 text-gold-700'}`}>
          {ownHead ? 'Submitted · revision allowed' : 'Awaiting submission'}
        </span>
      </div>
      <div className="mt-4 space-y-3" role="list" aria-label="AI proposal categories">
        {assessment.provisionalResult.categories.map((category) => {
          const proposal = proposalByCategory.get(category.categoryId)!;
          const draft = drafts.find((item) => item.categoryId === category.categoryId)!;
          const selected = selectedCategoryId === category.categoryId;
          const uplifted = category.validatedLikelihood !== proposal.likelihood || category.validatedSeverity !== proposal.severity;
          return (
            <div key={category.categoryId} className={`rounded-md border bg-white p-3 transition-colors ${selected ? 'border-brand-400 ring-1 ring-brand-200' : 'border-ink-100'}`} data-testid={`score-category-${category.categoryId}`}>
              <button
                type="button"
                className="flex min-h-12 w-full items-start justify-between gap-3 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                aria-expanded={selected}
                aria-pressed={selected}
                aria-controls={`score-category-fields-${category.categoryId}`}
                aria-label={`${category.categoryName} score category`}
                onClick={() => setSelectedCategoryId((current) => current === category.categoryId ? null : category.categoryId)}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink-800">{category.categoryName}</span>
                  <span className="mt-1 block text-xs text-ink-500">AI {proposal.likelihood}×{proposal.severity} · provisional {category.validatedLikelihood}×{category.validatedSeverity}{uplifted ? ' after safety floor' : ''}</span>
                </span>
                <span className="shrink-0 text-xs font-semibold text-brand-700">{draft.decision === 'overridden' ? 'Overridden' : selected ? 'Close' : 'Select'}</span>
              </button>
              {selected && (
                <div id={`score-category-fields-${category.categoryId}`} className="mt-3 grid gap-3 sm:grid-cols-[7rem_7rem_minmax(0,1fr)]" data-testid={`score-category-fields-${category.categoryId}`}>
                  <ScoreSelect label="Likelihood" value={draft.likelihood} disabled={submitting} onChange={(likelihood) => update(category.categoryId, { likelihood, decision: 'overridden' })} />
                  <ScoreSelect label="Severity" value={draft.severity} disabled={submitting} onChange={(severity) => update(category.categoryId, { severity, decision: 'overridden' })} />
                  <label className="text-xs font-medium text-ink-600">Override reason
                    <input className="input mt-1" aria-required={draft.decision === 'overridden'} required={draft.decision === 'overridden'} disabled={submitting} value={draft.reason} maxLength={500} onChange={(event) => update(category.categoryId, { reason: event.target.value, decision: 'overridden' })} placeholder="Why should this score change?" />
                  </label>
                  <p className="text-[11px] text-ink-500 sm:col-span-3">Leave the values untouched and close this card to confirm the AI score.</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <label className="mt-4 block text-xs font-medium text-ink-600">Review rationale
        <textarea className="input mt-1 resize-y" disabled={submitting} rows={3} maxLength={1000} value={rationale} onChange={(event) => { editGeneration.current += 1; dirty.current = true; setRationale(event.target.value); }} placeholder="Summarise the evidence and reasoning reviewed." />
      </label>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-400">{rationale.trim().length}/1000 · minimum 10</p>
        <div className="flex flex-wrap justify-end gap-2">
          {onCancel && <button type="button" className="btn-secondary" disabled={submitting} onClick={onCancel}>Cancel</button>}
          <button type="button" className="btn-primary" disabled={!valid || submitting} onClick={submit}>{submitting ? 'Recording...' : ownHead ? 'Submit new revision' : 'Submit score review'}</button>
        </div>
      </div>
    </div>
  );

  return embedded
    ? <div className="border-t border-gold-200 pt-4" data-testid="authority-score-editor">{editor}</div>
    : <section className="rounded-lg border border-[#d9cfbc] bg-cream-50 p-4 sm:p-5" aria-labelledby="score-review-heading" data-testid="authority-score-editor"><div id="score-review-heading">{editor}</div></section>;
}

function ScoreSelect({ label, value, disabled, onChange }: { label: string; value: ScoreRating; disabled: boolean; onChange: (value: ScoreRating) => void }) {
  return <label className="text-xs font-medium text-ink-600">{label}<select className="input mt-1" disabled={disabled} value={value} onChange={(event) => onChange(Number(event.target.value) as ScoreRating)}>{[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score}</option>)}</select></label>;
}

function initialDrafts(assessment: ProvisionalRiskAssessment): Draft[] {
  const proposal = new Map(assessment.aiProposal.categories.map((category) => [category.categoryId, category]));
  return assessment.provisionalResult.categories.map((category) => ({
    categoryId: category.categoryId,
    decision: 'confirmed',
    likelihood: proposal.get(category.categoryId)!.likelihood,
    severity: proposal.get(category.categoryId)!.severity,
    reason: '',
  }));
}

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `review_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
