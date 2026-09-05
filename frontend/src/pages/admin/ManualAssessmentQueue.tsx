import { useEffect, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { ArrowRight, ClipboardCheck, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AssessmentJob, COLLECTIONS, EventRecord, ManualReviewRiskAssessment } from '@shared/types';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { isCurrentAssessmentJob, isCurrentEventRecord, isCurrentRiskAssessment } from '../../components/m2/m2Contract';
import { isAdminManualEligible } from './manualAssessmentEligibility';

export type ManualQueueEvent = EventRecord & {
  currentVersionId: string;
  currentAssessmentId: string;
  eventDetails: EventRecord['eventDetails'] & { name: string };
};

export type ManualQueueCase =
  | { event: ManualQueueEvent; assessment: ManualReviewRiskAssessment; mode: 'manual' }
  | { event: ManualQueueEvent; assessment: AssessmentJob; mode: 'failed' };

const CANDIDATE_STATUSES = ['Pending', 'UnderReview', 'Manual Review Required'] as const;

export default function ManualAssessmentQueue() {
  const [cases, setCases] = useState<ManualQueueCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return undefined;
    }
    let generation = 0;
    const eventsQuery = query(collection(db, COLLECTIONS.EVENTS), where('status', 'in', CANDIDATE_STATUSES));
    const unsubscribe = onSnapshot(eventsQuery, async (snapshot) => {
      const current = ++generation;
      try {
        const values = await Promise.all(snapshot.docs.map(async (eventDoc): Promise<ManualQueueCase | null> => {
          const event = { eventId: eventDoc.id, ...eventDoc.data() } as EventRecord;
          if (!isManualQueueEvent(event)) return null;
          const assessmentSnapshot = await getDoc(doc(db, COLLECTIONS.EVENTS, event.eventId, COLLECTIONS.ASSESSMENTS, event.currentAssessmentId));
          const assessment = assessmentSnapshot.data();
          const manualReview = isCurrentRiskAssessment(assessment)
            && assessment.status === 'manual_review_required'
            && assessment.eventId === event.eventId
            && assessment.versionId === event.currentVersionId
            && assessment.assessmentId === event.currentAssessmentId
            && isAdminManualEligible(assessment);
          const failedRetry = isCurrentAssessmentJob(assessment)
            && assessment.status === 'failed'
            && assessment.eventId === event.eventId
            && assessment.versionId === event.currentVersionId
            && assessment.assessmentId === event.currentAssessmentId;
          if (manualReview) return { event, assessment, mode: 'manual' };
          if (failedRetry) return { event, assessment, mode: 'failed' };
          return null;
        }));
        if (current !== generation) return;
        setCases(values.filter((value): value is ManualQueueCase => value !== null));
        setError('');
      } catch {
        if (current === generation) setError('Manual assessment queue could not be loaded.');
      } finally {
        if (current === generation) setLoading(false);
      }
    }, () => {
      generation += 1;
      setError('Manual assessment queue could not be loaded.');
      setLoading(false);
    });
    return () => {
      generation += 1;
      unsubscribe();
    };
  }, []);

  if (loading) return <p className="flex items-center gap-2 text-sm text-ink-500"><Loader2 size={16} className="animate-spin" /> Loading manual-review applications...</p>;
  if (error) return <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-status-rejected">{error}</p>;
  if (!cases.length) return <p className="text-sm text-ink-500">No manual assessments require action.</p>;

  return (
    <div className="overflow-hidden rounded-md border border-[#e3dacb] bg-white">
      <div className="hidden grid-cols-[minmax(0,1.7fr)_minmax(0,1.2fr)_8rem_9rem_7rem] gap-3 border-b border-[#e8e0cf] bg-cream-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-500 lg:grid">
        <span>Application</span><span>Organizer / venue</span><span>Status</span><span>Assessment</span><span className="text-right">Open</span>
      </div>
      <ul className="divide-y divide-[#e8e0cf]">
        {cases.map((entry) => (
          <li key={`${entry.event.eventId}:${entry.assessment.assessmentId}`}>
            <Link
              to={`/admin/applications/${entry.event.eventId}?focus=${entry.mode === 'failed' ? 'retry-ai' : 'manual-assessment'}`}
              className="grid gap-3 px-4 py-3 transition hover:bg-cream-50 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1.2fr)_8rem_9rem_7rem] lg:items-center"
              data-testid={`manual-review-${entry.event.eventId}`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <ClipboardCheck size={17} className="shrink-0 text-gold-600" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink-900">{entry.event.eventDetails.name}</span>
                  <span className="block truncate text-xs text-ink-500">{entry.event.currentVersionId} · submitted {formatDate(entry.event.submittedAt)}</span>
                </span>
              </span>
              <span className="min-w-0 text-xs text-ink-600">
                <span className="block truncate font-semibold text-ink-700">{entry.event.eventDetails.organizerName}</span>
                <span className="block truncate" title={entry.event.eventDetails.venueAddress}>{entry.event.eventDetails.venueName}</span>
              </span>
              <span className="text-xs"><span className="badge badge-amber">{entry.event.status}</span></span>
              <span className="text-xs text-ink-600" title={entry.mode === 'failed' ? entry.assessment.error : entry.assessment.manualReviewReason}>
                <span className="block font-semibold capitalize text-ink-700">{entry.mode === 'failed' ? 'Pipeline failed' : entry.assessment.assessmentReadiness.replaceAll('_', ' ')}</span>
                <span className="block capitalize">{entry.mode === 'failed' ? 'AI retry available' : `${entry.assessment.complianceStatus.replaceAll('_', ' ')} · ${entry.assessment.warnings.length} warning${entry.assessment.warnings.length === 1 ? '' : 's'}`}</span>
              </span>
              <span className="flex items-center justify-end gap-1 text-xs font-semibold text-brand-700">Review <ArrowRight size={14} /></span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatDate(timestamp?: number) {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
}

function isManualQueueEvent(event: EventRecord): event is ManualQueueEvent {
  return isCurrentEventRecord(event)
    && CANDIDATE_STATUSES.includes(event.status as (typeof CANDIDATE_STATUSES)[number])
    && typeof event.currentVersionId === 'string'
    && typeof event.currentAssessmentId === 'string'
    && Boolean(event.eventDetails.name.trim());
}
