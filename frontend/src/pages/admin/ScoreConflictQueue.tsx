import { useEffect, useRef, useState } from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
  AuthorityScoreReview,
  AuthorityType,
  COLLECTIONS,
  EventRecord,
  ProvisionalRiskAssessment,
  SCORE_REVIEW_SCHEMA_VERSION,
  ScoreRating,
} from '@shared/types';
import { db, functions, isFirebaseConfigured } from '../../config/firebase';
import { isAuthorityReviewState, isCurrentRiskAssessment } from '../../components/m2/m2Contract';

const CATEGORY_IDS = new Set([
  'crowd', 'venue_fire', 'weather_environment', 'public_health',
  'food_water_sanitation', 'medical_capacity', 'security_cbrn', 'transport_accessibility',
]);

interface ConflictCase {
  event: EventRecord;
  assessment: ProvisionalRiskAssessment & { authorityReviewState: NonNullable<ProvisionalRiskAssessment['authorityReviewState']> };
  reviews: AuthorityScoreReview[];
  requiresRetry: boolean;
}

export default function ScoreConflictQueue() {
  const [cases, setCases] = useState<ConflictCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadGeneration = useRef(0);

  useEffect(() => {
    if (!isFirebaseConfigured) { setLoading(false); return; }
    const unsubscribe = onSnapshot(collection(db, COLLECTIONS.EVENTS), async (snapshot) => {
      const generation = ++loadGeneration.current;
      try {
        const loaded = await Promise.all(snapshot.docs.map(async (eventDoc) => {
          const event = { eventId: eventDoc.id, ...eventDoc.data() } as EventRecord;
          if (!event.currentAssessmentId) return null;
          const assessmentRef = doc(db, COLLECTIONS.EVENTS, event.eventId, COLLECTIONS.ASSESSMENTS, event.currentAssessmentId);
          const assessmentSnap = await getDoc(assessmentRef);
          const assessmentValue = assessmentSnap.data();
          if (!isCurrentRiskAssessment(assessmentValue) || assessmentValue.status !== 'authority_review'
            || !isAuthorityReviewState(assessmentValue.authorityReviewState)) return null;
          const assessment = assessmentValue as ProvisionalRiskAssessment & { authorityReviewState: NonNullable<ProvisionalRiskAssessment['authorityReviewState']> };
          const reviewsSnap = await getDocs(collection(assessmentRef, COLLECTIONS.SCORE_REVIEWS));
          const activeIds = new Set(Object.values(assessment.authorityReviewState.activeReviewHeads).map((head) => head?.reviewId));
          const reviews = reviewsSnap.docs.map((item) => item.data()).filter(isAuthorityScoreReview).filter((review) => activeIds.has(review.reviewId));
          if (reviews.length !== activeIds.size) throw new Error('An active score review is missing or malformed.');
          const requiresRetry = assessment.authorityReviewState.conflicts.length === 0
            || Boolean(assessment.authorityReviewState.activeResolutionId);
          return { event, assessment, reviews, requiresRetry };
        }));
        if (generation !== loadGeneration.current) return;
        setCases(loaded.filter((item): item is ConflictCase => Boolean(item)));
        setError('');
      } catch {
        if (generation !== loadGeneration.current) return;
        setError('Score conflicts could not be loaded.');
      } finally {
        if (generation === loadGeneration.current) setLoading(false);
      }
    }, () => {
      loadGeneration.current += 1;
      setError('Score conflicts could not be loaded.');
      setLoading(false);
    });
    return () => {
      loadGeneration.current += 1;
      unsubscribe();
    };
  }, []);

  if (loading) return <p className="text-sm text-ink-500">Loading score conflicts...</p>;
  if (error) return <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-status-rejected">{error}</p>;
  if (cases.length === 0) return <p className="text-sm text-ink-500">No score conflicts or official finalisations require action.</p>;
  return <div className="space-y-4">{cases.map((item) => item.requiresRetry
    ? <RetryFinalisationCard key={`${item.event.eventId}:${item.assessment.authorityReviewState.updatedAt}`} item={item} />
    : <ConflictCard key={`${item.event.eventId}:${item.assessment.authorityReviewState.updatedAt}`} item={item} />)}</div>;
}

function RetryFinalisationCard({ item }: { item: ConflictCase }) {
  const [submitting, setSubmitting] = useState(false);
  const retry = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const callable = httpsCallable(functions, 'retryOfficialFinalisation');
      await callable({ eventId: item.event.eventId });
      toast.success('Official assessment and resource finalisation completed.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Official finalisation could not be retried.');
    } finally {
      setSubmitting(false);
    }
  };
  return <article className="rounded-lg border border-[#ded5c5] bg-white p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-display font-semibold text-ink-800">{item.event.eventDetails.name}</h3><p className="mt-1 text-xs leading-5 text-ink-500">All {item.reviews.length} assigned score reviews are stored{item.assessment.authorityReviewState.activeResolutionId ? ' and the conflict resolution is recorded' : ''}, but official output is not published.</p></div><button type="button" className="btn-primary" disabled={submitting} onClick={retry}>{submitting ? 'Retrying...' : 'Retry finalisation'}</button></div></article>;
}

function ConflictCard({ item }: { item: ConflictCase }) {
  const { event, assessment, reviews } = item;
  const conflicts = assessment.authorityReviewState!.conflicts;
  const [scores, setScores] = useState(() => Object.fromEntries(conflicts.map((conflict) => {
    const first = reviews[0]?.categories.find((category) => category.categoryId === conflict.categoryId);
    return [conflict.categoryId, { likelihood: first?.likelihood ?? 1, severity: first?.severity ?? 1, reason: '' }];
  })) as Record<string, { likelihood: ScoreRating; severity: ScoreRating; reason: string }>);
  const [rationale, setRationale] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const valid = rationale.trim().length >= 10 && conflicts.every((conflict) => scores[conflict.categoryId]?.reason.trim().length >= 10);
  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const reviewHeadIds = Object.fromEntries(Object.entries(assessment.authorityReviewState!.activeReviewHeads).map(([authority, head]) => [authority, head!.reviewId])) as Partial<Record<AuthorityType, string>>;
      const callable = httpsCallable(functions, 'resolveAuthorityScoreConflict');
      await callable({
        eventId: event.eventId,
        reviewHeadIds,
        categories: conflicts.map((conflict) => ({ categoryId: conflict.categoryId, ...scores[conflict.categoryId], reason: scores[conflict.categoryId].reason.trim() })),
        rationale: rationale.trim(),
      });
      toast.success('Conflict resolved and official assessment finalized.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to resolve this conflict.');
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <article className="rounded-lg border border-[#ded5c5] bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="font-display font-semibold text-ink-800">{event.eventDetails.name}</h3><p className="mt-1 text-xs text-ink-500">{event.eventDetails.venueName} · version {event.currentVersionNumber}</p></div>
        <span className="badge bg-gold-100 text-gold-700">{conflicts.length} conflict{conflicts.length === 1 ? '' : 's'}</span>
      </div>
      <div className="mt-4 space-y-4">
        {conflicts.map((conflict) => {
          const score = scores[conflict.categoryId];
          const submissions = reviews.map((review) => ({ authority: review.authorityType, category: review.categories.find((category) => category.categoryId === conflict.categoryId)! }));
          return <div key={conflict.categoryId} className="rounded-md border border-ink-100 bg-cream-50 p-3"><p className="text-sm font-semibold text-ink-800">{label(conflict.categoryId)}</p><div className="mt-2 grid gap-2">{submissions.map(({ authority, category }) => { const review = reviews.find((item) => item.authorityType === authority)!; return <div key={authority} className="rounded border border-ink-100 bg-white p-2 text-xs leading-5 text-ink-600"><span className="font-semibold text-ink-800">{authority}: {category.likelihood}×{category.severity}</span><p>{category.decision === 'overridden' ? category.reason : 'Confirmed the AI-proposed score.'}</p><p className="text-ink-400">Review rationale: {review.rationale}</p></div>; })}</div><div className="mt-3 grid gap-3 sm:grid-cols-[7rem_7rem_minmax(0,1fr)]"><ScoreSelect label="Likelihood" value={score.likelihood} onChange={(likelihood) => setScores((current) => ({ ...current, [conflict.categoryId]: { ...current[conflict.categoryId], likelihood } }))} /><ScoreSelect label="Severity" value={score.severity} onChange={(severity) => setScores((current) => ({ ...current, [conflict.categoryId]: { ...current[conflict.categoryId], severity } }))} /><label className="text-xs font-medium text-ink-600">Resolution reason<input className="input mt-1" maxLength={500} value={score.reason} onChange={(event) => setScores((current) => ({ ...current, [conflict.categoryId]: { ...current[conflict.categoryId], reason: event.target.value } }))} /></label></div></div>;
        })}
      </div>
      <label className="mt-4 block text-xs font-medium text-ink-600">Admin resolution rationale<textarea className="input mt-1 resize-y" rows={3} maxLength={1000} value={rationale} onChange={(event) => setRationale(event.target.value)} /></label>
      <div className="mt-3 flex justify-end"><button type="button" className="btn-primary" disabled={!valid || submitting} onClick={submit}>{submitting ? 'Finalizing...' : 'Resolve and finalize'}</button></div>
    </article>
  );
}

function ScoreSelect({ label: text, value, onChange }: { label: string; value: ScoreRating; onChange: (value: ScoreRating) => void }) {
  return <label className="text-xs font-medium text-ink-600">{text}<select className="input mt-1" value={value} onChange={(event) => onChange(Number(event.target.value) as ScoreRating)}>{[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score}</option>)}</select></label>;
}

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase());
}

export function isAuthorityScoreReview(value: unknown): value is AuthorityScoreReview {
  if (!value || typeof value !== 'object') return false;
  const review = value as Partial<AuthorityScoreReview>;
  if (review.schemaVersion !== SCORE_REVIEW_SCHEMA_VERSION
    || typeof review.reviewId !== 'string' || !review.reviewId
    || typeof review.rationale !== 'string' || review.rationale.trim().length < 10
    || !Array.isArray(review.categories) || review.categories.length !== CATEGORY_IDS.size) return false;
  const seen = new Set<string>();
  return review.categories.every((category) => {
    if (!category || typeof category !== 'object') return false;
    if (!CATEGORY_IDS.has(category.categoryId) || seen.has(category.categoryId)
      || !Number.isInteger(category.likelihood) || category.likelihood < 1 || category.likelihood > 5
      || !Number.isInteger(category.severity) || category.severity < 1 || category.severity > 5) return false;
    seen.add(category.categoryId);
    return category.decision === 'confirmed'
      || (category.decision === 'overridden'
        && typeof category.reason === 'string'
        && category.reason.trim().length >= 10);
  });
}
