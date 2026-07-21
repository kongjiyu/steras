import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { AssessmentRecord, COLLECTIONS, EventRecord, ResourceRecommendation, RiskAssessment } from '@shared/types';
import { db, functions, isFirebaseConfigured } from '../../config/firebase';
import toast from 'react-hot-toast';
import EmptyState from '../../components/ui/EmptyState';
import PageHeader from '../../components/ui/PageHeader';
import RiskMeter from '../../components/ui/RiskMeter';
import StatusBadge from '../../components/ui/StatusBadge';

export default function EventDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [assessment, setAssessment] = useState<RiskAssessment | null>(null);
  const [assessmentStatus, setAssessmentStatus] = useState<AssessmentRecord['status'] | null>(null);
  const [resources, setResources] = useState<ResourceRecommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [withdrawing, setWithdrawing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [supportingDataError, setSupportingDataError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!isFirebaseConfigured || !eventId) {
      setLoading(false);
      return;
    }
    const unsubscribeEvent = onSnapshot(doc(db, COLLECTIONS.EVENTS, eventId), (snapshot) => {
      if (snapshot.exists()) setEvent({ eventId: snapshot.id, ...snapshot.data() } as EventRecord);
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
      setAssessmentStatus(null);
      setResources(null);
      return;
    }
    setAssessment(null);
    setAssessmentStatus(null);
    setResources(null);
    const eventReference = doc(db, COLLECTIONS.EVENTS, eventId);
    const unsubscribeAssessment = onSnapshot(doc(eventReference, COLLECTIONS.ASSESSMENTS, versionId), (snapshot) => {
      const record = snapshot.data() as AssessmentRecord | undefined;
      setAssessmentStatus(record?.status ?? null);
      setAssessment(record?.status === 'ready' ? record as RiskAssessment : null);
      setSupportingDataError('');
    }, () => setSupportingDataError('Assessment or resource data could not be refreshed.'));
    const unsubscribeResources = onSnapshot(doc(eventReference, COLLECTIONS.RESOURCES, versionId), (snapshot) => {
      setResources(snapshot.exists() ? snapshot.data() as ResourceRecommendation : null);
    }, () => setSupportingDataError('Assessment or resource data could not be refreshed.'));
    return () => {
      unsubscribeAssessment();
      unsubscribeResources();
    };
  }, [event?.currentVersionId, eventId]);

  if (loading) return <div className="py-16 text-center text-ink-500">Loading application…</div>;
  if (loadError) return <EmptyState title="Application unavailable" description={loadError}><button type="button" className="btn-secondary" onClick={() => { setLoading(true); setRetryKey((value) => value + 1); }}>Try again</button></EmptyState>;
  if (!event) return <EmptyState title="Event not found" description="It may have been removed or you do not have access." />;
  const details = event.eventDetails;
  const eventName = details.name || 'Untitled event';
  const venueName = details.venueName || 'Venue not set';
  const startLabel = details.startDatetime ? format(new Date(details.startDatetime), 'PPp') : 'Not scheduled';
  const endLabel = details.endDatetime ? format(new Date(details.endDatetime), 'PPp') : 'Not scheduled';

  const withdraw = async () => {
    if (!window.confirm('Withdraw this event application?')) return;
    setWithdrawing(true);
    try {
      const command = httpsCallable<{ eventId: string }>(functions, 'withdrawEvent');
      await command({ eventId: event.eventId });
      toast.success('Event withdrawn.');
      navigate('/organizer/events');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Withdrawal failed.');
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div>
      {supportingDataError && <div role="alert" className="mb-4 rounded-md border border-status-review/40 bg-gold-50 p-3 text-sm text-gold-600">{supportingDataError}</div>}
      <PageHeader
        title={eventName}
        description={`${venueName} · ${startLabel}`}
        action={<><StatusBadge status={event.status} />{['Draft', 'AmendmentRequested'].includes(event.status) && <Link to={`/organizer/events/${event.eventId}/edit`} className="btn-secondary">Edit application</Link>}{['Draft', 'Pending'].includes(event.status) && <button type="button" disabled={withdrawing} onClick={withdraw} className="btn-secondary">{withdrawing ? 'Withdrawing…' : 'Withdraw'}</button>}</>}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]">
        <section className="card">
          <div className="card-header"><h2 className="section-title">Event details</h2></div>
          <div className="card-body divide-y divide-[#e3dacb] text-sm">
            <Row label="Type" value={details.type} />
            <Row label="Venue" value={venueName} />
            <Row label="Capacity" value={details.venueCapacity ? details.venueCapacity.toLocaleString() : 'Not set'} />
            <Row label="Attendance" value={details.expectedAttendance ? details.expectedAttendance.toLocaleString() : 'Not set'} />
            <Row label="Environment" value={`${details.environment}, ${details.coverage}, ${details.seating}`} />
            <Row label="Start" value={startLabel} />
            <Row label="End" value={endLabel} />
          </div>
        </section>

        <section className="card">
          <div className="card-header"><div><h2 className="section-title">Final risk assessment</h2><p className="mt-1 text-xs text-ink-500">Authoritative result for the current submitted version</p></div></div>
          <div className="card-body">
            {!assessment ? <p className="text-sm text-ink-500">{!event.currentVersionId ? 'No assessment has been created for this application.' : assessmentStatus === 'failed' ? 'Assessment could not be completed. It can be retried by an authority.' : 'Assessment is processing.'}</p> : (
              <div className="space-y-5 text-sm">
                <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#e3dacb] pb-5">
                  <RiskMeter level={assessment.finalRiskLevel} />
                  <div><strong className="font-display text-4xl font-bold tabular-nums text-ink-900">{assessment.finalScore}</strong><span className="ml-1 text-ink-500">/ 100</span></div>
                </div>
                <div className="grid grid-cols-2 gap-3 rounded-md bg-cream-50 p-3">
                  <Metric label="Deterministic baseline" value={assessment.baselineScore} />
                  <Metric label="M3 bounded adjustment" value={`+${assessment.ai.validatedAdjustment}`} />
                </div>
                <div><p className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-500">Assessment reasoning</p><p className="mt-2 leading-6 text-ink-700">{assessment.ai.reasoning}</p></div>
                {assessment.ai.status !== 'success' && <p className="rounded-md border border-gold-200 bg-gold-50 p-3 text-gold-600">M3 refinement was unavailable. The deterministic baseline was used.</p>}
              </div>
            )}
          </div>
        </section>

        <section className="card lg:col-span-2">
          <div className="card-header"><div><h2 className="section-title">Recommended resources</h2><p className="mt-1 text-xs text-ink-500">Operational quantities linked to the current assessment</p></div></div>
          <div className="card-body">
            {!resources ? <p className="text-sm text-ink-500">{event.currentVersionId ? 'Resources appear after assessment.' : 'No resource recommendation has been created for this application.'}</p> : (
              <div className="grid grid-cols-2 gap-x-5 gap-y-0 text-sm sm:grid-cols-4">
                <Resource label="Police" value={resources.police} />
                <Resource label="Medical teams" value={resources.medicalTeams} />
                <Resource label="Ambulances" value={resources.ambulances} />
                <Resource label="Toilets" value={resources.toilets} />
                <Resource label="Security" value={resources.security} />
                <Resource label="Fire officers" value={resources.fireOfficers} />
                <Resource label="Waste bins" value={resources.wasteBins} />
                <Metric label="Confidence" value={resources.confidenceLevel} />
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-3"><span className="text-ink-500">{label}</span><span className="break-words font-medium text-ink-800">{value}</span></div>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div><div className="text-xs text-ink-500">{label}</div><div className="mt-0.5 font-semibold tabular-nums text-ink-900">{value}</div></div>;
}

function Resource({ label, value }: { label: string; value: number }) {
  return <div className="border-b border-[#e3dacb] py-4"><div className="text-xs text-ink-500">{label}</div><div className="mt-1 font-display text-2xl font-bold tabular-nums text-ink-900">{value}</div></div>;
}
