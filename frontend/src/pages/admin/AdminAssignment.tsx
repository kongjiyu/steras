/**
 * AdminAssignment — M3 Workstream 1 admin page.
 *
 * Renders the officer assignment checklist for an event. Admin can:
 *   - See the default-checked officer per required authority (per A4)
 *   - Override the default by picking a different officer
 *   - Click "Assign" to commit (calls `assignAuthorityOfficers`)
 *   - See each officer's current decision (if they've submitted one)
 *   - Click "Confirm aggregate" once all officers are done (calls
 *     `makeSecondReviewDecision`)
 *
 * Reuses the existing `AdminLayout` shell (Q2 decision).
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { ChevronLeft, RotateCcw, Shield, ShieldCheck, UserCheck, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  Assignment,
  AuthorityType,
  COLLECTIONS,
  DecisionValue,
  EventRecord,
} from '@shared/types';
import { db, functions, isFirebaseConfigured } from '../../config/firebase';
import EmptyState from '../../components/ui/EmptyState';
import StatusBadge from '../../components/ui/StatusBadge';

interface ProposedChecklistItem {
  authorityType: AuthorityType;
  defaultOfficerUid: string;
  candidates: Array<{ officerUid: string; state: string; scopeType: 'state' | 'federal'; workloadCount: number; lastAssignedAt?: number }>;
}

interface ProposedChecklistResponse {
  checklist: ProposedChecklistItem[];
  venueState: string;
}

export default function AdminAssignment() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [checklist, setChecklist] = useState<ProposedChecklistItem[]>([]);
  const [venueState, setVenueState] = useState<string>('ALL');
  const [selected, setSelected] = useState<Record<AuthorityType, string>>({} as Record<AuthorityType, string>);
  const [loadingChecklist, setLoadingChecklist] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [unassigning, setUnassigning] = useState<AuthorityType | null>(null);
  const [unassigningAll, setUnassigningAll] = useState(false);
  const [adminNote, setAdminNote] = useState('');
  const [adminReason, setAdminReason] = useState('');
  const [adminSuggestion, setAdminSuggestion] = useState('');
  const [finalDecision, setFinalDecision] = useState<DecisionValue | ''>('');

  // Live event doc.
  useEffect(() => {
    if (!isFirebaseConfigured || !eventId) return;
    return onSnapshot(doc(db, COLLECTIONS.EVENTS, eventId), (snapshot) => {
      setEvent(snapshot.exists() ? { eventId: snapshot.id, ...snapshot.data() } as EventRecord : null);
    });
  }, [eventId]);

  // Live assignments sub-collection.
  useEffect(() => {
    if (!isFirebaseConfigured || !eventId) return;
    return onSnapshot(collection(db, COLLECTIONS.EVENTS, eventId, COLLECTIONS.ASSIGNMENTS), (snapshot) => {
      setAssignments(snapshot.docs.map((d) => ({ ...(d.data() as Assignment), assignmentId: d.id })));
    });
  }, [eventId]);

  // Initial: fetch the proposed checklist (dryRun).
  useEffect(() => {
    if (!isFirebaseConfigured || !eventId || !event) return;
    setLoadingChecklist(true);
    const command = httpsCallable<{ eventId: string; dryRun: true }, ProposedChecklistResponse>(
      functions,
      'assignAuthorityOfficers',
    );
    command({ eventId, dryRun: true })
      .then((res) => {
        setChecklist(res.data.checklist);
        setVenueState(res.data.venueState);
        // Initialise the selected map with defaults.
        const def: Record<AuthorityType, string> = {} as Record<AuthorityType, string>;
        for (const item of res.data.checklist) def[item.authorityType] = item.defaultOfficerUid;
        setSelected(def);
      })
      .catch((err) => {
        console.error('[AdminAssignment] checklist load failed:', err);
        toast.error(err instanceof Error ? err.message : 'Unable to load the officer checklist.');
      })
      .finally(() => setLoadingChecklist(false));
  }, [eventId, event]);

  // Derive review state before the early loading returns so this hook is
  // called in the same order on every render.
  const required = event?.requiredAuthorities ?? [];
  const currentAssignments = assignments.filter((assignment) => assignment.versionId === event?.currentVersionId);
  const assignmentsByAuthority = new Map<AuthorityType, Assignment>();
  for (const a of currentAssignments) assignmentsByAuthority.set(a.authorityType, a);
  const aggregateDecision = computeAggregate(Array.from(assignmentsByAuthority.values()), required);
  useEffect(() => {
    if (aggregateDecision && !finalDecision) setFinalDecision(aggregateDecision);
  }, [aggregateDecision, finalDecision]);

  if (!isFirebaseConfigured) {
    return <div className="p-8 text-ink-500">Firebase is not configured.</div>;
  }
  if (!eventId) return <div className="p-8"><EmptyState title="No event selected" /></div>;
  if (!event) return <div className="p-8 text-ink-500">Loading application...</div>;

  const details = event.eventDetails;
  const isAuthorityReview = event.reviewStage === 'authority';
  const isSecondReview = event.reviewStage === 'second';
  const allComplete = isSecondReview
    || (currentAssignments.length > 0 && currentAssignments.every((a) => a.status === 'completed' || a.status === 'revoked'));
  const commit = async () => {
    if (!eventId) return;
    setCommitting(true);
    try {
      const command = httpsCallable<{ eventId: string; assignmentMap: Record<string, string>; dryRun: false }, { assigned: number }>(
        functions,
        'assignAuthorityOfficers',
      );
      await command({ eventId, assignmentMap: selected, dryRun: false });
      toast.success(`Assigned ${Object.keys(selected).length} officer(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to assign officers.');
    } finally {
      setCommitting(false);
    }
  };

  const confirmSecondReview = async () => {
    if (!eventId || !finalDecision) return;
    setConfirming(true);
    try {
      const command = httpsCallable<{
        eventId: string;
        finalDecision: DecisionValue;
        reason?: string;
        suggestion?: string;
        adminNote?: string;
      }, { status: DecisionValue; aggregate?: EventRecord['status'] }>(
        functions,
        'makeSecondReviewDecision',
      );
      await command({
        eventId,
        finalDecision,
        ...(finalDecision === 'Rejected'
          ? { reason: adminReason.trim(), suggestion: adminSuggestion.trim() }
          : { adminNote: adminNote.trim() || undefined }),
      });
      toast.success(`Final decision recorded: ${finalDecision}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to confirm second review.');
    } finally {
      setConfirming(false);
    }
  };

  const unassign = async (authorityType: AuthorityType | null) => {
    if (!eventId) return;
    const msg = authorityType
      ? `Unassign the ${authorityType} officer? You can re-assign them after.`
      : 'Unassign ALL officers for this event version? You can re-assign them after.';
    if (!window.confirm(msg)) return;
    if (authorityType) {
      setUnassigning(authorityType);
    } else {
      setUnassigningAll(true);
    }
    try {
      const command = httpsCallable<{ eventId: string; authorityType?: AuthorityType }, { revoked: number; reviewStageReset: boolean }>(
        functions,
        'unassignAuthorityOfficers',
      );
      const payload: { eventId: string; authorityType?: AuthorityType } = { eventId };
      if (authorityType) payload.authorityType = authorityType;
      const result = await command(payload);
      toast.success(`Unassigned ${result.data.revoked} officer(s).${result.data.reviewStageReset ? ' Event returned to pre-assignment state.' : ''}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to unassign.');
    } finally {
      setUnassigning(null);
      setUnassigningAll(false);
    }
  };

  // Unassign is only available BEFORE any officer has recorded a
  // proposal — once a proposal is in, the data is significant and the
  // admin must go through the second review to close out the work.
  const canUnassign = isAuthorityReview
    && !currentAssignments.some((a) => a.status === 'completed');

  return (
    <div className="p-5 sm:p-8">
      <Link to={`/admin/applications/${eventId}`} className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">
        <ChevronLeft size={16} /> Back to application
      </Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-800">Officer assignment</h1>
          <p className="mt-1 text-sm text-ink-500">{details.name} · {details.venueName}</p>
          <p className="mt-1 text-xs text-ink-400">Venue state: <span className="font-semibold">{venueState}</span> · Required: {required.join(', ')}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge status={event.status} />
          {event.reviewStage && <span className="text-xs font-semibold text-ink-500">Stage: {event.reviewStage}</span>}
        </div>
      </div>

      {loadingChecklist ? (
        <p className="text-sm text-ink-500">Loading officer checklist...</p>
      ) : (
        <div className="space-y-5">
          <section className="card">
            <div className="card-header">
              <div>
                <h2 className="font-semibold">Checklist</h2>
                <p className="mt-0.5 text-xs text-ink-500">Default-checked by lowest workload + state scope. Swap to a backup officer by clicking a different radio button.</p>
              </div>
              <Users size={18} className="text-brand-700" />
            </div>
            <div className="card-body space-y-5">
              {checklist.map((item) => {
                const current = assignmentsByAuthority.get(item.authorityType);
                return (
                  <div key={item.authorityType} className="rounded-md border border-ink-100 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Shield size={16} className="text-brand-700" />
                        <p className="text-sm font-semibold text-ink-800">{item.authorityType}</p>
                        {current && <span className="badge bg-green-100 text-status-approved text-xs">Assigned</span>}
                        {current?.status === 'completed' && <span className="badge bg-blue-100 text-brand-700 text-xs">Decision recorded</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-ink-500">{item.candidates.length} eligible officer(s)</p>
                        {canUnassign && current && current.status !== 'revoked' && (
                          <button
                            type="button"
                            className="btn-secondary !px-2 !py-1 text-xs"
                            onClick={() => unassign(item.authorityType)}
                            disabled={unassigning !== null || unassigningAll}
                            aria-label={`Unassign ${item.authorityType} officer`}
                          >
                            <RotateCcw size={12} />{unassigning === item.authorityType ? 'Unassigning...' : 'Unassign'}
                          </button>
                        )}
                      </div>
                    </div>
                    {current ? (
                      <div className="mt-2 rounded-md bg-cream-50 p-3 text-xs text-ink-600">
                        <p><span className="font-semibold">Officer:</span> {current.officerUid}</p>
                        <p><span className="font-semibold">Assigned by:</span> {current.assignedBy} · {format(new Date(current.assignedAt), 'PPp')}</p>
                        {current.status === 'revoked' && current.revokedAt && (
                          <p className="mt-1 text-status-rejected">
                            <span className="font-semibold">Revoked</span> by {current.revokedBy ?? 'admin'} · {format(new Date(current.revokedAt), 'PPp')}
                          </p>
                        )}
                        {current.decision && (
                          <p className="mt-1">
                            <span className="font-semibold">Decision:</span> {current.decision} · {format(new Date(current.decidedAt ?? 0), 'PPp')}
                          </p>
                        )}
                        {current.reason && <p className="mt-1 whitespace-pre-line"><span className="font-semibold">Reason:</span> {current.reason}</p>}
                        {current.suggestion && <p className="mt-1 whitespace-pre-line"><span className="font-semibold">Suggestion:</span> {current.suggestion}</p>}
                      </div>
                    ) : item.candidates.length === 0 ? (
                      <p className="mt-2 text-sm text-status-rejected">No eligible officers for {item.authorityType} + venue state {venueState}.</p>
                    ) : (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {item.candidates.map((c) => {
                          const checked = (selected[item.authorityType] ?? item.defaultOfficerUid) === c.officerUid;
                          return (
                            <label key={c.officerUid} className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs ${checked ? 'border-brand-700 bg-brand-50' : 'border-ink-200 bg-white'}`}>
                              <input
                                type="radio"
                                name={`auth-${item.authorityType}`}
                                value={c.officerUid}
                                checked={checked}
                                onChange={() => setSelected((cur) => ({ ...cur, [item.authorityType]: c.officerUid }))}
                                className="mt-1"
                                disabled={isAuthorityReview || isSecondReview}
                              />
                              <span>
                                <span className="font-mono text-ink-700">{c.officerUid}</span>
                                <span className="ml-2 text-ink-500">[{c.scopeType}:{c.state}] · workload {c.workloadCount}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {!isAuthorityReview && !isSecondReview && (
              <div className="card-body border-t border-ink-100">
                <button type="button" className="btn-primary w-full" disabled={committing || Object.keys(selected).length === 0} onClick={commit}>
                  <UserCheck size={16} />{committing ? 'Assigning...' : 'Assign officers'}
                </button>
              </div>
            )}
            {canUnassign && assignments.length > 1 && (
              <div className="card-body border-t border-ink-100">
                <button type="button" className="btn-secondary w-full" disabled={unassigning !== null || unassigningAll} onClick={() => unassign(null)}>
                  <RotateCcw size={14} />{unassigningAll ? 'Unassigning all...' : 'Unassign all officers'}
                </button>
              </div>
            )}
          </section>

          {allComplete && aggregateDecision && (
            <section className="card">
              <div className="card-header">
                <div>
                  <h2 className="font-semibold">Second review</h2>
                  <p className="mt-0.5 text-xs text-ink-500">All officers have recorded proposals. The admin records the final application outcome.</p>
                </div>
                <ShieldCheck size={18} className="text-status-approved" />
              </div>
              <div className="card-body space-y-3">
                <p className="rounded-md bg-cream-50 p-3 text-sm text-ink-700">
                  Officer aggregate recommendation: <span className="font-semibold">{aggregateDecision}</span>
                </p>
                <label className="block text-xs font-medium text-ink-600">
                  Admin final decision
                  <select className="input mt-1" value={finalDecision} onChange={(e) => setFinalDecision(e.target.value as DecisionValue)}>
                    <option value="">Select final decision</option>
                    <option value="Approved">Approved</option>
                    <option value="Rejected">Rejected</option>
                  </select>
                </label>
                {finalDecision === 'Rejected' ? <>
                  <label className="block text-xs font-medium text-ink-600">
                    Rejection reason
                    <textarea className="input mt-1 resize-y" rows={2} maxLength={1000} value={adminReason} onChange={(e) => setAdminReason(e.target.value)} placeholder="Explain why the application cannot proceed." />
                  </label>
                  <label className="block text-xs font-medium text-ink-600">
                    Suggestion for the organiser
                    <textarea className="input mt-1 resize-y" rows={2} maxLength={1000} value={adminSuggestion} onChange={(e) => setAdminSuggestion(e.target.value)} placeholder="Provide the required corrective direction." />
                  </label>
                </> : <label className="block text-xs font-medium text-ink-600">
                  Admin note (optional, for audit)
                  <textarea className="input mt-1 resize-y" rows={2} maxLength={1000} value={adminNote} onChange={(e) => setAdminNote(e.target.value)} placeholder="Any context for the audit log." />
                </label>}
                <button type="button" className="btn-success w-full" disabled={confirming || !finalDecision || (finalDecision === 'Rejected' && (adminReason.trim().length < 10 || adminSuggestion.trim().length === 0))} onClick={confirmSecondReview}>
                  {confirming ? 'Recording...' : `Record final decision${finalDecision ? ` (${finalDecision})` : ''}`}
                </button>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function computeAggregate(assignments: Assignment[], required: AuthorityType[]): DecisionValue | null {
  if (assignments.length === 0 || required.length === 0) return null;
  const byAuthority = new Map<AuthorityType, Assignment['decision']>();
  for (const a of assignments) {
    if (a.status === 'completed' && a.decision) byAuthority.set(a.authorityType, a.decision);
  }
  for (const auth of required) {
    if (byAuthority.get(auth) === 'Rejected') return 'Rejected';
  }
  if (required.every((auth) => byAuthority.get(auth) === 'Approved')) return 'Approved';
  return null;
}
