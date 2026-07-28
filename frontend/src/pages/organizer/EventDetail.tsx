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
import StatusBadge from '../../components/ui/StatusBadge';
import AIAdvisory from '../../components/m2/AIAdvisory';
import CategoryProfile from '../../components/m2/CategoryProfile';
import ResourceRecommendationView from '../../components/m2/ResourceRecommendation';
import { isCurrentResourceRecommendation, isCurrentRiskAssessment } from '../../components/m2/m2Contract';

export default function EventDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [assessment, setAssessment] = useState<RiskAssessment | null>(null);
  const [assessmentStatus, setAssessmentStatus] = useState<AssessmentRecord['status'] | null>(null);
  const [resources, setResources] = useState<ResourceRecommendation | null>(null);
  const [legacyAssessment, setLegacyAssessment] = useState(false);
  const [legacyResources, setLegacyResources] = useState(false);
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
      setLegacyAssessment(false);
      setLegacyResources(false);
      return;
    }
    setAssessment(null);
    setAssessmentStatus(null);
    setResources(null);
    const eventReference = doc(db, COLLECTIONS.EVENTS, eventId);
    const unsubscribeAssessment = onSnapshot(doc(eventReference, COLLECTIONS.ASSESSMENTS, versionId), (snapshot) => {
      const record = snapshot.data() as AssessmentRecord | undefined;
      setAssessmentStatus(record?.status ?? null);
      setAssessment(isCurrentRiskAssessment(record) ? record : null);
      setLegacyAssessment(record?.status === 'ready' && !isCurrentRiskAssessment(record));
      setSupportingDataError('');
    }, () => setSupportingDataError('Assessment or resource data could not be refreshed.'));
    const unsubscribeResources = onSnapshot(doc(eventReference, COLLECTIONS.RESOURCES, versionId), (snapshot) => {
      const record = snapshot.data();
      setResources(isCurrentResourceRecommendation(record) ? record : null);
      setLegacyResources(snapshot.exists() && !isCurrentResourceRecommendation(record));
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
          <div className="card-header"><div><h2 className="section-title">Official category assessment</h2><p className="mt-1 text-xs text-ink-500">Deterministic result for the current submitted version</p></div></div>
          <div className="card-body">
            {!assessment ? <p className="text-sm text-ink-500">{!event.currentVersionId ? 'No assessment has been created for this application.' : legacyAssessment ? 'This version has a legacy assessment and must be recomputed before the current result can be shown.' : assessmentStatus === 'failed' ? 'Assessment could not be completed. It can be retried by an authority.' : 'Assessment is processing.'}</p> : (
              <div className="space-y-5">
                <CategoryProfile assessment={assessment} density="compact" />
                <AIAdvisory advisory={assessment.aiAdvisory} officialRiskLevel={assessment.officialRiskLevel} showCategories={false} />
              </div>
            )}
          </div>
        </section>

        <section className="card lg:col-span-2">
          <div className="card-header"><div><h2 className="section-title">Recommended resources</h2><p className="mt-1 text-xs text-ink-500">Operational quantities linked to the current assessment</p></div></div>
          <div className="card-body">
            {!resources ? <p className="text-sm text-ink-500">{legacyResources ? 'This version has a legacy resource record and must be recomputed before quantities can be shown.' : event.currentVersionId ? 'Resources appear after assessment.' : 'No resource recommendation has been created for this application.'}</p> : (
              <ResourceRecommendationView recommendation={resources} />
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
