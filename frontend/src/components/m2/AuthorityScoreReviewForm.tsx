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
}

type Draft = {
  categoryId: string;
  decision: 'confirmed' | 'overridden';
  likelihood: ScoreRating;
  severity: ScoreRating;
  reason: string;
};

export default function AuthorityScoreReviewForm({ eventId, assessment, authorityType }: Props) {
  const proposalByCategory = useMemo(() => new Map(
    assessment.aiProposal.categories.map((category) => [category.categoryId, category]),
  ), [assessment.aiProposal.categories]);
  const [drafts, setDrafts] = useState<Draft[]>(() => initialDrafts(assessment));
  const [rationale, setRationale] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => newKey());
  const [submitting, setSubmitting] = useState(false);
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
  const valid = rationale.trim().length >= 10 && drafts.every((draft) => draft.decision === 'confirmed' || draft.reason.trim().length >= 10);

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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to submit the score review.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-lg border border-[#d9cfbc] bg-cream-50 p-4 sm:p-5" aria-labelledby="score-review-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="score-review-heading" className="font-display text-base font-semibold text-ink-800">Your category score review</h3>
          <p className="mt-1 text-xs leading-5 text-ink-500">Confirm the AI proposal or record an override for every category. Deterministic safety floors are reapplied during finalisation.</p>
        </div>
        <span className={`badge ${ownHead ? 'bg-green-100 text-status-approved' : 'bg-gold-100 text-gold-700'}`}>
          {ownHead ? 'Submitted · revision allowed' : 'Awaiting submission'}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {assessment.provisionalResult.categories.map((category) => {
          const proposal = proposalByCategory.get(category.categoryId)!;
          const draft = drafts.find((item) => item.categoryId === category.categoryId)!;
          const uplifted = category.validatedLikelihood !== proposal.likelihood || category.validatedSeverity !== proposal.severity;
          return (
            <div key={category.categoryId} className="rounded-md border border-ink-100 bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-ink-800">{category.categoryName}</p>
                  <p className="mt-1 text-xs text-ink-500">AI {proposal.likelihood}×{proposal.severity} · provisional {category.validatedLikelihood}×{category.validatedSeverity}{uplifted ? ' after safety floor' : ''}</p>
                </div>
                <select className="input min-h-11 w-auto" disabled={submitting} aria-label={`${category.categoryName} review decision`} value={draft.decision} onChange={(event) => {
                  const decision = event.target.value as Draft['decision'];
                  update(category.categoryId, decision === 'confirmed'
                    ? { decision, likelihood: proposal.likelihood, severity: proposal.severity, reason: '' }
                    : { decision });
                }}>
                  <option value="confirmed">Confirm AI score</option>
                  <option value="overridden">Override score</option>
                </select>
              </div>
              {draft.decision === 'overridden' && (
                <div className="mt-3 grid gap-3 sm:grid-cols-[7rem_7rem_minmax(0,1fr)]">
                  <ScoreSelect label="Likelihood" value={draft.likelihood} disabled={submitting} onChange={(likelihood) => update(category.categoryId, { likelihood })} />
                  <ScoreSelect label="Severity" value={draft.severity} disabled={submitting} onChange={(severity) => update(category.categoryId, { severity })} />
                  <label className="text-xs font-medium text-ink-600">Override reason
                    <input className="input mt-1" disabled={submitting} value={draft.reason} maxLength={500} onChange={(event) => update(category.categoryId, { reason: event.target.value })} placeholder="Why should this score change?" />
                  </label>
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
        <button type="button" className="btn-primary" disabled={!valid || submitting} onClick={submit}>{submitting ? 'Recording...' : ownHead ? 'Submit new revision' : 'Submit score review'}</button>
      </div>
    </section>
  );
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
