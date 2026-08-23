import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { COLLECTIONS, EventRecord, OrganizerAssessmentSummary } from '@shared/types';
import { db, functions, isFirebaseConfigured } from '../../config/firebase';
import toast from 'react-hot-toast';
import EmptyState from '../../components/ui/EmptyState';
import PageHeader from '../../components/ui/PageHeader';
import StatusBadge from '../../components/ui/StatusBadge';
import OrganizerAssessmentSummaryView, { OrganizerResourceSummaryView } from '../../components/m2/OrganizerAssessmentSummaryView';
import { isCurrentEventRecord, isOrganizerAssessmentSummary } from '../../components/m2/m2Contract';

export default function EventDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [summary, setSummary] = useState<OrganizerAssessmentSummary | null>(null);
  const [legacySummary, setLegacySummary] = useState(false);
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
      const value = snapshot.exists() ? { eventId: snapshot.id, ...snapshot.data() } : undefined;
      if (value && !isOrganizerEventRecord(value, eventId)) {
        setEvent(null);
        setLoadError('The application data is invalid or incomplete.');
        setLoading(false);
        return;
      }
      setEvent((value as EventRecord | undefined) ?? null);
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
      setSummary(null);
      setLegacySummary(false);
      return;
    }
    setSummary(null);
    const eventReference = doc(db, COLLECTIONS.EVENTS, eventId);
    const unsubscribeSummary = onSnapshot(doc(eventReference, COLLECTIONS.ASSESSMENT_SUMMARIES, versionId), (snapshot) => {
      const record = snapshot.data();
      setSummary(isOrganizerAssessmentSummary(record, eventId, versionId) ? record : null);
      setLegacySummary(snapshot.exists() && !isOrganizerAssessmentSummary(record, eventId, versionId));
      setSupportingDataError('');
    }, () => setSupportingDataError('Assessment summary could not be refreshed.'));
    return unsubscribeSummary;
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
        action={<><StatusBadge status={event.status} />{event.status === 'Draft' && <Link to={`/organizer/events/${event.eventId}/edit`} className="btn-secondary">Edit application</Link>}{['Draft', 'Pending'].includes(event.status) && <button type="button" disabled={withdrawing} onClick={withdraw} className="btn-secondary">{withdrawing ? 'Withdrawing…' : 'Withdraw'}</button>}</>}
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
          <div className="card-header"><div><h2 className="section-title">Risk assessment summary</h2><p className="mt-1 text-xs text-ink-500">{summary?.status === 'official_ready' ? 'Official result available for authority decision' : 'Provisional until authority confirmation is complete'}</p></div></div>
          <div className="card-body">
            {!summary ? <p className="text-sm text-ink-500">{!event.currentVersionId ? 'No assessment has been created for this application.' : legacySummary ? 'This version has a legacy assessment and must be recomputed before the current result can be shown.' : 'Assessment is processing.'}</p> : (
              <OrganizerAssessmentSummaryView summary={summary} />
            )}
          </div>
        </section>

        <section className="card lg:col-span-2">
          <div className="card-header"><div><h2 className="section-title">Recommended resources</h2><p className="mt-1 text-xs text-ink-500">Operational quantities linked to the current assessment</p></div></div>
          <div className="card-body">
            {!summary ? <p className="text-sm text-ink-500">{event.currentVersionId ? 'Resources appear after assessment.' : 'No resource recommendation has been created for this application.'}</p> : (
              <OrganizerResourceSummaryView summary={summary} />
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

function isOrganizerEventRecord(value: unknown, expectedEventId: string): value is EventRecord {
  if (isCurrentEventRecord(value, expectedEventId)) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const details = record.eventDetails;
  return record.eventId === expectedEventId
    && record.status === 'Draft'
    && typeof record.organizerId === 'string' && Boolean(record.organizerId)
    && Number.isSafeInteger(record.currentVersionNumber) && Number(record.currentVersionNumber) >= 0
    && (record.currentVersionId === undefined || isSafeDocumentId(record.currentVersionId))
    && (record.currentAssessmentId === undefined || isSafeDocumentId(record.currentAssessmentId))
    && (record.currentResourceId === undefined || isSafeDocumentId(record.currentResourceId))
    && Array.isArray(record.draftDocumentPaths) && record.draftDocumentPaths.every((path) => typeof path === 'string')
    && Array.isArray(record.requiredAuthorities)
    && Number.isFinite(record.createdAt) && Number.isFinite(record.updatedAt)
    && Boolean(details) && typeof details === 'object' && !Array.isArray(details)
    && ['name', 'type', 'venueName', 'environment', 'coverage', 'seating'].every((field) => typeof (details as Record<string, unknown>)[field] === 'string')
    && ['venueCapacity', 'expectedAttendance', 'startDatetime', 'endDatetime'].every((field) => Number.isFinite((details as Record<string, unknown>)[field]))
    && Number((details as Record<string, unknown>).venueCapacity) >= 0
    && Number((details as Record<string, unknown>).expectedAttendance) >= 0
    && Number((details as Record<string, unknown>).endDatetime) >= Number((details as Record<string, unknown>).startDatetime);
}

function isSafeDocumentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
