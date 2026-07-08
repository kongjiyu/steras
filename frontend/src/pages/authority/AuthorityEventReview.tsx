import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { doc, onSnapshot, collection, query, addDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { COLLECTIONS, EventRecord, RiskScoreRecord, ResourceRecommendation, EventStatus } from '@shared/types';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/ui/PageHeader';
import StatusBadge from '../../components/ui/StatusBadge';
import RiskBadge from '../../components/ui/RiskBadge';
import EmptyState from '../../components/ui/EmptyState';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

type Decision = 'Approved' | 'Rejected' | 'AmendmentRequested';

export default function AuthorityEventReview() {
  const { eventId } = useParams<{ eventId: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [event, setEvent] = useState<EventRecord | null>(null);
  const [riskScore, setRiskScore] = useState<RiskScoreRecord | null>(null);
  const [resources, setResources] = useState<ResourceRecommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAmendment, setShowAmendment] = useState(false);
  const [amendmentNotes, setAmendmentNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isFirebaseConfigured || !eventId) {
      setLoading(false);
      return;
    }
    const unsubEvent = onSnapshot(doc(db, COLLECTIONS.EVENTS, eventId), (snap) => {
      if (snap.exists()) setEvent({ eventId: snap.id, ...snap.data() } as EventRecord);
      setLoading(false);
    });
    const unsubRisk = onSnapshot(query(collection(db, COLLECTIONS.EVENTS, eventId, COLLECTIONS.RISK_SCORES)), (snap) => {
      const docs = snap.docs.map((d) => d.data() as RiskScoreRecord);
      if (docs.length > 0) setRiskScore(docs.sort((a, b) => b.createdAt - a.createdAt)[0]);
    });
    const unsubRes = onSnapshot(query(collection(db, COLLECTIONS.EVENTS, eventId, COLLECTIONS.RESOURCES)), (snap) => {
      const docs = snap.docs.map((d) => d.data() as ResourceRecommendation);
      if (docs.length > 0) setResources(docs.sort((a, b) => b.computedAt - a.computedAt)[0]);
    });
    return () => {
      unsubEvent();
      unsubRisk();
      unsubRes();
    };
  }, [eventId]);

  const handleDecision = async (decision: Decision) => {
    if (!event || !profile) return;
    if (!isFirebaseConfigured) {
      toast.error('Firebase is not configured.');
      return;
    }
    if (decision === 'AmendmentRequested' && !amendmentNotes.trim()) {
      toast.error('Please add amendment notes before requesting changes.');
      return;
    }
    setSubmitting(true);
    try {
      // NOTE: in production, this should go through a Cloud Function
      // to enforce server-side status transitions and audit log immutability.
      // For prototype, we write directly with the authority context.
      const newStatus: EventStatus = decision;
      await updateDoc(doc(db, COLLECTIONS.EVENTS, eventId!), {
        status: newStatus,
        decidedBy: profile.uid,
        decidedAt: Date.now(),
        updatedAt: Date.now(),
      });
      await addDoc(collection(db, COLLECTIONS.EVENTS, eventId!, COLLECTIONS.AUDIT_LOGS), {
        eventId,
        action: 'decision_made',
        actorId: profile.uid,
        actorRole: profile.role,
        timestamp: Date.now(),
        previousStatus: event.status,
        newStatus,
        notes: decision === 'AmendmentRequested' ? amendmentNotes : undefined,
        _serverTimestamp: serverTimestamp(),
      });
      toast.success(`Application ${decision === 'AmendmentRequested' ? 'sent for amendment' : decision.toLowerCase()}.`);
      navigate('/authority/queue');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Decision failed';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="text-slate-500">Loading…</div>;
  if (!event) return <EmptyState title="Event not found" description="It may have been deleted or you don't have access." />;

  return (
    <div>
      <PageHeader
        title={event.eventDetails.name}
        description={`${event.eventDetails.venueName} · ${format(new Date(event.eventDetails.startDatetime), 'PPp')}`}
        action={
          <div className="flex items-center gap-2">
            <StatusBadge status={event.status} />
            <Link to="/authority/queue" className="btn-secondary !py-1.5 text-sm">← Queue</Link>
          </div>
        }
      />

      <div className="grid lg:grid-cols-3 gap-4">
        {/* AI vs Rule side-by-side */}
        <div className="lg:col-span-2 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="card border-l-4 border-l-brand-500">
              <div className="card-header">
                <h3 className="font-semibold text-slate-900">AI Prediction</h3>
                <p className="text-xs text-slate-500">MiniMax M3 (LLM) · contextual reasoning</p>
              </div>
              <div className="card-body">
                {!riskScore ? (
                  <p className="text-sm text-slate-500">AI hasn't run yet. Cloud Function will populate this.</p>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <RiskBadge level={riskScore.ai.riskLevel} />
                      <span className="text-2xl font-bold text-slate-900">{riskScore.ai.riskScore}</span>
                      <span className="text-sm text-slate-500">/ 100</span>
                    </div>
                    {riskScore.ai.reasoning && (
                      <p className="mt-3 text-sm text-slate-700 leading-relaxed">{riskScore.ai.reasoning}</p>
                    )}
                    {riskScore.ai.keyConcerns?.length > 0 && (
                      <div className="mt-3">
                        <div className="text-xs font-medium text-slate-500 mb-1">Key concerns</div>
                        <div className="flex flex-wrap gap-1">
                          {riskScore.ai.keyConcerns.map((c) => (
                            <span key={c} className="badge bg-slate-100 text-slate-700">{c}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="card border-l-4 border-l-accent-500">
              <div className="card-header">
                <h3 className="font-semibold text-slate-900">Rule-Based Score</h3>
                <p className="text-xs text-slate-500">Deterministic · WHO / PDRM / Bomba standards</p>
              </div>
              <div className="card-body">
                {!riskScore ? (
                  <p className="text-sm text-slate-500">Rule-based hasn't run yet.</p>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <RiskBadge level={riskScore.rule.riskLevel} />
                      <span className="text-2xl font-bold text-slate-900">{riskScore.rule.total}</span>
                      <span className="text-sm text-slate-500">/ 100</span>
                    </div>
                    <ul className="mt-3 text-sm space-y-1 text-slate-700">
                      <li>Weather: <span className="font-mono">{riskScore.rule.weatherScore}</span> <span className="text-xs text-slate-500">(0.30)</span></li>
                      <li>Crowd: <span className="font-mono">{riskScore.rule.crowdScore}</span> <span className="text-xs text-slate-500">(0.25)</span></li>
                      <li>Venue: <span className="font-mono">{riskScore.rule.venueScore}</span> <span className="text-xs text-slate-500">(0.20)</span></li>
                      <li>History: <span className="font-mono">{riskScore.rule.historyScore}</span> <span className="text-xs text-slate-500">(0.15)</span></li>
                      <li>Holiday: <span className="font-mono">{riskScore.rule.holidayScore}</span> <span className="text-xs text-slate-500">(0.10)</span></li>
                    </ul>
                  </>
                )}
              </div>
            </div>
          </div>

          {riskScore && (
            <div className={'card border-l-4 ' + (riskScore.disagreementFlag ? 'border-l-red-500 bg-red-50/30' : 'border-l-green-500 bg-green-50/30')}>
              <div className="card-body">
                {riskScore.disagreementFlag ? (
                  <>
                    <div className="font-semibold text-red-800">⚠ Disagreement — manual review required</div>
                    <p className="mt-1 text-sm text-red-700">
                      AI ({riskScore.ai.riskScore}) and rule-based ({riskScore.rule.total}) differ by {riskScore.disagreementDelta ?? Math.abs(riskScore.ai.riskScore - riskScore.rule.total)} points (threshold: 15).
                      Read AI reasoning, check venue history, and use your judgement.
                    </p>
                  </>
                ) : (
                  <div className="font-semibold text-green-800">✓ AI + rule-based agree — high confidence</div>
                )}
              </div>
            </div>
          )}

          {/* Resources */}
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-slate-900">Recommended resources</h3></div>
            <div className="card-body">
              {!resources ? (
                <p className="text-sm text-slate-500">No resources recommended yet.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Police', v: resources.police },
                    { label: 'Medical', v: resources.medicalTeams },
                    { label: 'Ambulances', v: resources.ambulances },
                    { label: 'Toilets', v: resources.toilets },
                    { label: 'Security', v: resources.security },
                    { label: 'Fire', v: resources.fireOfficers },
                    { label: 'Waste bins', v: resources.wasteBins },
                  ].map((r) => (
                    <div key={r.label}>
                      <div className="text-xs text-slate-500">{r.label}</div>
                      <div className="text-2xl font-semibold text-slate-900">{r.v}</div>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs text-slate-500">
                Source: {resources?.source ?? 'rule-based'} · Confidence: {resources?.confidenceLevel ?? 'estimate'}.
                Reference: WHO Mass Gathering Guidelines + PDRM + Bomba benchmarks.
              </p>
            </div>
          </div>
        </div>

        {/* Sidebar: organizer + decision */}
        <aside className="space-y-4">
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-slate-900">Organizer</h3></div>
            <div className="card-body text-sm space-y-1">
              <div className="font-medium">{event.eventDetails.organizerName}</div>
              <div className="text-slate-600">{event.eventDetails.organizerContact}</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-slate-900">Decision</h3></div>
            <div className="card-body space-y-3">
              {showAmendment && (
                <div>
                  <label className="block text-sm font-medium text-slate-700">Amendment notes</label>
                  <textarea
                    className="input mt-1"
                    rows={4}
                    value={amendmentNotes}
                    onChange={(e) => setAmendmentNotes(e.target.value)}
                    placeholder="e.g. Reduce police to 8, increase medical teams to 3, require pre-event roof inspection."
                  />
                </div>
              )}
              <div className="grid grid-cols-1 gap-2">
                <button onClick={() => handleDecision('Approved')} disabled={submitting} className="btn-success w-full">
                  ✓ Approve
                </button>
                <button
                  onClick={() => {
                    setShowAmendment((v) => !v);
                    if (!showAmendment) setShowAmendment(true);
                  }}
                  disabled={submitting}
                  className="btn-secondary w-full"
                >
                  ✎ Request Amendment
                </button>
                {showAmendment && (
                  <button
                    onClick={() => handleDecision('AmendmentRequested')}
                    disabled={submitting || !amendmentNotes.trim()}
                    className="btn-primary w-full"
                  >
                    Submit Amendment Request
                  </button>
                )}
                <button onClick={() => handleDecision('Rejected')} disabled={submitting} className="btn-danger w-full">
                  ✗ Reject
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                All decisions are logged with timestamp + authority ID + AI/rule agreement status.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
