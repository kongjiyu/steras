import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { doc, onSnapshot, collection, query } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { COLLECTIONS, EventRecord, RiskScoreRecord, ResourceRecommendation } from '@shared/types';
import PageHeader from '../../components/ui/PageHeader';
import StatusBadge from '../../components/ui/StatusBadge';
import RiskBadge from '../../components/ui/RiskBadge';
import EmptyState from '../../components/ui/EmptyState';
import { format } from 'date-fns';

export default function EventDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [riskScore, setRiskScore] = useState<RiskScoreRecord | null>(null);
  const [resources, setResources] = useState<ResourceRecommendation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isFirebaseConfigured || !eventId) {
      setLoading(false);
      return;
    }
    const unsub = onSnapshot(
      doc(db, COLLECTIONS.EVENTS, eventId),
      (snap) => {
        if (snap.exists()) setEvent({ eventId: snap.id, ...snap.data() } as EventRecord);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [eventId]);

  useEffect(() => {
    if (!isFirebaseConfigured || !eventId) return;
    const q = query(collection(db, COLLECTIONS.EVENTS, eventId, COLLECTIONS.RISK_SCORES));
    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map((d) => d.data() as RiskScoreRecord);
      // Sub-collection has many docs (one per run); show latest.
      if (docs.length > 0) setRiskScore(docs.sort((a, b) => b.createdAt - a.createdAt)[0]);
    });
    return () => unsub();
  }, [eventId]);

  useEffect(() => {
    if (!isFirebaseConfigured || !eventId) return;
    const q = query(collection(db, COLLECTIONS.EVENTS, eventId, COLLECTIONS.RESOURCES));
    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map((d) => d.data() as ResourceRecommendation);
      if (docs.length > 0) setResources(docs.sort((a, b) => b.computedAt - a.computedAt)[0]);
    });
    return () => unsub();
  }, [eventId]);

  if (loading) return <div className="text-slate-500">Loading…</div>;
  if (!event) return <EmptyState title="Event not found" description="It may have been deleted or you don't have access." />;

  return (
    <div>
      <PageHeader
        title={event.eventDetails.name}
        description={`${event.eventDetails.venueName} · ${format(new Date(event.eventDetails.startDatetime), 'PPp')}`}
        action={<StatusBadge status={event.status} />}
      />

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Event details */}
        <div className="card">
          <div className="card-header"><h2 className="font-semibold">Event details</h2></div>
          <div className="card-body space-y-2 text-sm">
            <Row label="Type" value={event.eventDetails.type} />
            <Row label="Venue" value={event.eventDetails.venueName} />
            <Row label="Address" value={event.eventDetails.venueAddress} />
            <Row label="Capacity" value={String(event.eventDetails.venueCapacity)} />
            <Row label="Expected attendance" value={String(event.eventDetails.expectedAttendance)} />
            <Row label="Start" value={format(new Date(event.eventDetails.startDatetime), 'PPp')} />
            <Row label="End" value={format(new Date(event.eventDetails.endDatetime), 'PPp')} />
            <Row label="Organizer" value={event.eventDetails.organizerName} />
            <Row label="Contact" value={event.eventDetails.organizerContact} />
            {event.eventDetails.description && <Row label="Description" value={event.eventDetails.description} />}
          </div>
        </div>

        {/* Risk score */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h2 className="font-semibold">Risk assessment</h2>
            {riskScore && (
              <span className={'badge ' + (riskScore.disagreementFlag ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800')}>
                {riskScore.disagreementFlag ? '⚠ Disagreement' : '✓ AI + Rule agree'}
              </span>
            )}
          </div>
          <div className="card-body">
            {!riskScore ? (
              <p className="text-sm text-slate-500">AI + rule-based engines haven't run yet. Cloud Function trigger is in <code>functions/src/triggers/</code>.</p>
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  <div className="font-medium text-slate-900">AI prediction</div>
                  <div className="flex items-center gap-2 mt-1">
                    <RiskBadge level={riskScore.ai.riskLevel} />
                    <span className="font-mono text-slate-700">{riskScore.ai.riskScore} / 100</span>
                  </div>
                  {riskScore.ai.reasoning && <p className="mt-1 text-xs text-slate-600">{riskScore.ai.reasoning}</p>}
                </div>
                <div>
                  <div className="font-medium text-slate-900">Rule-based</div>
                  <div className="flex items-center gap-2 mt-1">
                    <RiskBadge level={riskScore.rule.riskLevel} />
                    <span className="font-mono text-slate-700">{riskScore.rule.total} / 100</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Resources */}
        <div className="card lg:col-span-2">
          <div className="card-header"><h2 className="font-semibold">Recommended resources</h2></div>
          <div className="card-body">
            {!resources ? (
              <p className="text-sm text-slate-500">Resource recommendation will appear after Module 3 runs.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <Resource label="Police" value={resources.police} />
                <Resource label="Medical teams" value={resources.medicalTeams} />
                <Resource label="Ambulances" value={resources.ambulances} />
                <Resource label="Toilets" value={resources.toilets} />
                <Resource label="Security" value={resources.security} />
                <Resource label="Fire officers" value={resources.fireOfficers} />
                <Resource label="Waste bins" value={resources.wasteBins} />
                <div>
                  <div className="text-xs text-slate-500">Confidence</div>
                  <div className="font-medium text-slate-900 capitalize">{resources.confidenceLevel}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex">
      <div className="w-40 shrink-0 text-slate-500">{label}</div>
      <div className="text-slate-900">{value}</div>
    </div>
  );
}

function Resource({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}
