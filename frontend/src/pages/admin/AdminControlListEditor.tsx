/**
 * AdminControlListEditor — M3 Workstream 2 admin page.
 *
 * Renders the per-authority event control list for an event. Admin can:
 *   - Click "Generate proposal" to call `generateEventControlList`
 *     (which calls M3's validated MiniMax proposer with a deterministic
 *      fallback when the provider is unavailable).
 *     The proposal populates the table.
 *   - Edit the proposal in place: rename a control, edit its Stage 1
 *     requirements, add/remove controls (limited to the event's
 *     `requiredAuthorities`).
 *   - Click "Confirm control list" to call `editEventControlList` and write
 *     the per-control docs to Firestore. After commit, the snapshot
 *     lives on `event.controlListSnapshot` and the organizer can see
 *     the list in `OrganizerEventControls` (UC-34).
 *
 * Generated proposals are persisted as recoverable drafts. The admin must
 * explicitly confirm the draft before controls are published.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ChevronLeft, ClipboardList, Pencil, RefreshCcw, Save, Sparkles, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  AuthorityType,
  COLLECTIONS,
  ControlListProposal,
  EventRecord,
  EventControl,
  ProposedControlItem,
} from '@shared/types';
import { db, functions } from '../../config/firebase';
import EmptyState from '../../components/ui/EmptyState';
import StatusBadge from '../../components/ui/StatusBadge';
import { friendlyAdminStatus } from './adminApplicationPresentation';

interface ProposedResponse {
  items: ProposedControlItem[];
  cached: boolean;
  source: 'cache' | 'minimax' | 'deterministic_fallback';
  model?: string;
  promptVersion?: string;
  generatedAt?: number;
  fallbackReason?: string;
  proposalId?: string;
  proposalRevision?: number;
}

interface CommittedResponse {
  eventId: string;
  versionId: string;
  written: number;
  controlIds: string[];
  proposalId?: string;
  proposalRevision?: number;
}

const ALL_AUTHORITIES: AuthorityType[] = ['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'];

export default function AdminControlListEditor() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [controlsError, setControlsError] = useState('');
  const [proposalError, setProposalError] = useState('');
  const [items, setItems] = useState<ProposedControlItem[]>([]);
  const [proposalSource, setProposalSource] = useState<'cache' | 'minimax' | 'deterministic_fallback' | null>(null);
  const [proposalCached, setProposalCached] = useState(false);
  const [proposalId, setProposalId] = useState<string>();
  const [proposalRevision, setProposalRevision] = useState<number>();
  const [currentControls, setCurrentControls] = useState<EventControl[]>([]);
  const [currentProposal, setCurrentProposal] = useState<ControlListProposal | null>(null);
  const [generating, setGenerating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const autoLoadedEventRef = useRef<string>();

  // Live event doc.
  useEffect(() => {
    if (!eventId) return;
    // Firebase service calls will throw with a clear "not configured" error
    // if the env is missing, so we don't need a separate configured check here.
    return onSnapshot(doc(db, COLLECTIONS.EVENTS, eventId), (snapshot) => {
      if (snapshot.exists()) {
        setEvent({ eventId: snapshot.id, ...(snapshot.data() as Partial<EventRecord>) } as EventRecord);
      } else {
        setEvent(null);
      }
      setLoading(false);
    }, (err: unknown) => {
      console.warn('[AdminControlListEditor] event subscribe failed', err);
      setLoadError('The event could not be loaded.');
      setLoading(false);
    });
  }, [eventId]);

  // The event flag/snapshot alone is not proof that the current list is
  // confirmed. Keep the current-version controls and persisted proposal live
  // so an old or partially-written record is shown as an integrity issue
  // instead of exposing an action that will inevitably fail.
  useEffect(() => {
    if (!eventId || !event?.currentVersionId) {
      setCurrentControls([]);
      setCurrentProposal(null);
      return undefined;
    }
    const eventReference = doc(db, COLLECTIONS.EVENTS, eventId);
    setControlsError('');
    setProposalError('');
    const unsubscribeControls = onSnapshot(collection(eventReference, COLLECTIONS.EVENT_CONTROLS), (snapshot) => {
      setCurrentControls(snapshot.docs
        .map((item) => ({ ...(item.data() as Partial<EventControl>), controlId: item.id }) as EventControl)
        .filter((control) => control.versionId === event.currentVersionId));
    }, () => setControlsError('The current control list could not be loaded.'));
    const unsubscribeProposal = onSnapshot(doc(eventReference, COLLECTIONS.CONTROL_LIST_PROPOSALS, event.currentVersionId), (snapshot) => {
      setCurrentProposal(snapshot.exists() ? snapshot.data() as ControlListProposal : null);
      setProposalError('');
    }, () => {
      // A missing or temporarily unreadable draft should not hide the event
      // itself. Generation is server-owned and remains available as a
      // recoverable empty state.
      setCurrentProposal(null);
      setProposalError('The saved control-list draft could not be loaded. You can generate a fresh proposal.');
    });
    return () => { unsubscribeControls(); unsubscribeProposal(); };
  }, [event?.currentVersionId, eventId]);

  const venueName = event?.eventDetails.venueName ?? '...';
  const isApproved = event?.status === 'Approved';
  const isUnderReview = event?.status === 'UnderReview';
  const canEdit = isApproved || (isUnderReview && Boolean(event?.authorityReviewCompletedAt));
  const hasPublishedFlag = event?.controlListGenerated === true;
  const snapshot = Array.isArray(event?.controlListSnapshot) ? event.controlListSnapshot : [];
  const controlsById = new Map(currentControls.map((control) => [control.controlId, control]));
  const snapshotMatchesControls = snapshot.length > 0
    && snapshot.length === currentControls.length
    && snapshot.every((item) => {
      const control = controlsById.get(item.controlId);
      return Boolean(control
        && control.eventId === event?.eventId
        && control.versionId === event?.currentVersionId
        && control.authority === item.authority
        && control.controlName === item.controlName
        && control.stageRequirement === item.stageRequirement
        && control.controlItemVersion === item.controlItemVersion);
    });
  const proposalMatchesControls = Boolean(
    currentProposal
      && currentProposal.status === 'confirmed'
      && currentProposal.eventId === event?.eventId
      && currentProposal.versionId === event?.currentVersionId
      && Number.isSafeInteger(currentProposal.revision)
      && currentProposal.revision > 0
      && Array.isArray(currentProposal.items)
      && currentProposal.items.length === currentControls.length
      && currentProposal.items.every((item) => {
        const control = currentControls.find((candidate) => candidate.authority === item.authority);
        const controlStage1Requirements = control && Array.isArray(control.stage1Requirements) ? control.stage1Requirements : [];
        return Boolean(control
          && control.controlName === item.controlName
          && control.stageRequirement === item.stageRequirement
          && controlStage1Requirements.length === item.stage1Requirements.length
          && (control.stage2Requirement?.label ?? null) === (item.stage2Requirement?.label ?? null));
      }),
  );
  const confirmed = Boolean(hasPublishedFlag && snapshotMatchesControls && proposalMatchesControls);
  // A current control, snapshot, confirmed proposal, or event flag is a
  // published artifact. If any of those disagree, lock editing and explain
  // the integrity issue instead of presenting an action that must fail.
  // A stale flag by itself is recoverable: only concrete current-version
  // controls, a snapshot, or a confirmed proposal constitute a published
  // artifact that must be integrity-locked.
  const hasPublishedArtifacts = Boolean(snapshot.length > 0 || currentControls.length > 0 || currentProposal?.status === 'confirmed');
  const inconsistentPublished = Boolean(hasPublishedArtifacts && !confirmed);

  const dirty = useMemo(() => items.length > 0 && !confirmed, [confirmed, items]);

  const generate = useCallback(async (force = false) => {
    if (!eventId || confirmed || inconsistentPublished || hasPublishedArtifacts) return;
    setGenerating(true);
    try {
      const command = httpsCallable<{ eventId: string; force?: boolean }, ProposedResponse>(
        functions,
        'generateEventControlList',
      );
      const result = await command({ eventId, ...(force ? { force: true } : {}) });
      setItems(result.data.items);
      setProposalSource(result.data.source);
      setProposalCached(result.data.cached);
      setProposalId(result.data.proposalId);
      setProposalRevision(result.data.proposalRevision);
      // A generated draft is intentionally uncommitted, even when it was
      // recovered from Firestore without any edits. Confirmation is always
      // available for a genuine draft.
      toast.success(
        result.data.cached
          ? 'Restored the saved control-list draft.'
          : result.data.source === 'deterministic_fallback'
            ? `Generated deterministic fallback with ${result.data.items.length} item(s).`
            : `Generated MiniMax proposal with ${result.data.items.length} item(s).`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to generate proposal.');
    } finally {
      setGenerating(false);
    }
  }, [confirmed, eventId, hasPublishedArtifacts, inconsistentPublished]);

  // Entering the page after final approval restores the persisted draft (or
  // the committed list) automatically, so navigation never loses the
  // proposal and the Admin does not have to click Generate again.
  useEffect(() => {
    if (!eventId || !event || event.status !== 'Approved' || confirmed || inconsistentPublished || hasPublishedArtifacts || autoLoadedEventRef.current === eventId) return;
    autoLoadedEventRef.current = eventId;
    void generate(false);
  }, [confirmed, event, eventId, generate, hasPublishedArtifacts, inconsistentPublished]);

  const commit = async () => {
    if (!eventId) return;
    setCommitting(true);
    try {
      const command = httpsCallable<{
        eventId: string;
        items: ProposedControlItem[];
        proposalId?: string;
        proposalRevision?: number;
      }, CommittedResponse>(
        functions,
        'editEventControlList',
      );
      const result = await command({
        eventId,
        items,
        ...(proposalId ? { proposalId } : {}),
        ...(proposalRevision !== undefined ? { proposalRevision } : {}),
      });
      setProposalId(undefined);
      setProposalRevision(undefined);
      setEditing(false);
      toast.success(`Committed ${result.data.written} control(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to commit.');
    } finally {
      setCommitting(false);
    }
  };

  const updateItem = (index: number, patch: Partial<ProposedControlItem>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };
  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };
  const addItem = (authority: AuthorityType) => {
    const stage1 = [{ docType: 'other' as const, label: 'TBD', required: true }];
    setItems((prev) => [
      ...prev,
      {
        controlName: `${authority} compliance`,
        authority,
        stageRequirement: 'stage1_and_stage2',
        stage1Requirements: stage1,
        stage2Requirement: { kind: 'image', label: `Photo of ${authority} at venue` },
      },
    ]);
  };
  const updateStage1Req = (itemIndex: number, reqIndex: number, patch: Partial<{ docType: ProposedControlItem['stage1Requirements'][number]['docType']; label: string; required: boolean }>) => {
    setItems((prev) => prev.map((it, i) => {
      if (i !== itemIndex) return it;
      return {
        ...it,
        stage1Requirements: it.stage1Requirements.map((r, ri) => (ri === reqIndex ? { ...r, ...patch } : r)),
      };
    }));
  };
  const addStage1Req = (itemIndex: number) => {
    setItems((prev) => prev.map((it, i) => {
      if (i !== itemIndex) return it;
      return {
        ...it,
        stage1Requirements: [...it.stage1Requirements, { docType: 'other', label: 'New requirement', required: true }],
      };
    }));
  };
  const removeStage1Req = (itemIndex: number, reqIndex: number) => {
    setItems((prev) => prev.map((it, i) => {
      if (i !== itemIndex) return it;
      return { ...it, stage1Requirements: it.stage1Requirements.filter((_, ri) => ri !== reqIndex) };
    }));
  };

  if (loading) return <div className="p-8 text-ink-500">Loading application...</div>;
  if (loadError) return <div className="p-8"><EmptyState title="Application unavailable" description={loadError} /></div>;
  if (!event) return <div className="p-8"><EmptyState title="Event not found" description="It may have been removed or you do not have access." /></div>;

  const details = event.eventDetails;
  const required = event.requiredAuthorities ?? [];
  const availableToAdd = ALL_AUTHORITIES.filter((a) => required.includes(a) && !items.some((it) => it.authority === a));

  return (
    <div className="p-5 sm:p-8">
      <Link to={`/admin/applications/${eventId}`} className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">
        <ChevronLeft size={16} /> Back to application
      </Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-800">Event control list</h1>
          <p className="mt-1 text-sm text-ink-500">{details.name} · {venueName}</p>
          <p className="mt-1 text-xs text-ink-400">Version: <span className="font-semibold">{event.currentVersionId ?? 'n/a'}</span> · Required: {required.join(', ')}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge status={event.status} />
          {event.reviewStage && <span className="text-xs font-semibold text-ink-500">Stage: {event.reviewStage}</span>}
          {confirmed && <span className="text-xs font-semibold text-status-approved">Control list: confirmed</span>}
          {!confirmed && <span className="text-xs font-semibold text-ink-500">Control list: draft</span>}
        </div>
      </div>

      {!canEdit && (
        <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          The event is in {friendlyAdminStatus(event.status)} status. The control list can only be generated / edited for events in <strong>Under Review</strong> or <strong>Approved</strong>.
        </div>
      )}

      {inconsistentPublished && (
        <div className="mb-5 rounded-md border border-status-rejected/40 bg-red-50 p-3 text-sm text-status-rejected" role="alert" data-testid="control-list-integrity-error">
          This application is marked as having a confirmed control list, but the current-version controls or proposal record is incomplete. Editing is locked until an Admin repairs the list.
        </div>
      )}

      {controlsError && !inconsistentPublished && (
        <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800" role="status">{controlsError}</div>
      )}
      {proposalError && !inconsistentPublished && (
        <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800" role="status">{proposalError}</div>
      )}

      {canEdit && !confirmed && !inconsistentPublished && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={() => generate(false)}
              disabled={generating}
              data-testid="generate-proposal-button"
            >
              <Sparkles size={16} />{generating ? 'Generating...' : 'Generate proposal'}
            </button>
            {items.length > 0 && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => generate(true)}
                disabled={generating}
                title="Force a fresh call to the proposal function (skip cache)."
                data-testid="regenerate-proposal-button"
              >
                <RefreshCcw size={14} />Regenerate
              </button>
            )}
            {items.length > 0 && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setEditing((value) => !value)}
                disabled={generating || committing || !canEdit}
                data-testid="edit-proposal-button"
              >
                <Pencil size={14} />{editing ? 'Finish editing' : 'Edit proposal'}
              </button>
            )}
          </div>
          {items.length > 0 && (
            <button
              type="button"
              className="btn-success"
              onClick={commit}
              disabled={committing || !dirty}
              title={dirty ? 'Confirm this generated control list' : 'No control proposal to confirm'}
              data-testid="commit-changes-button"
            >
              <Save size={16} />{committing ? 'Confirming...' : (dirty ? 'Confirm control list' : 'No proposal')}
            </button>
          )}
        </div>
      )}

      {proposalSource && (
        <p className="mb-3 text-xs text-ink-500">
          Source: {proposalSource === 'cache'
            ? 'cached snapshot'
            : proposalSource === 'minimax'
              ? 'MiniMax proposal'
              : 'deterministic fallback'}
          {proposalCached && ' (cached)'}
        </p>
      )}

      {confirmed ? (
        <ConfirmedControlCards controls={currentControls} />
      ) : items.length === 0 ? (
        <div className="card">
          <div className="card-body">
            <p className="text-sm text-ink-500">No control list yet. Click &quot;Generate proposal&quot; to populate the table.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item, i) => (
            <section key={`${item.authority}-${i}`} className="card" data-testid={`control-item-${item.authority}`}>
              <div className="card-header flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <ClipboardList size={16} className="text-brand-700" />
                  <input
                    type="text"
                    value={item.controlName}
                    onChange={(e) => updateItem(i, { controlName: e.target.value })}
                    disabled={!canEdit || !editing}
                    className="input !h-9 !w-72"
                    aria-label={`Control name for ${item.authority}`}
                    data-testid={`control-name-${item.authority}`}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="badge bg-blue-100 text-brand-700 text-xs">{item.authority}</span>
                  <span className="badge bg-ink-100 text-ink-600 text-xs">{item.stageRequirement}</span>
                  <button
                    type="button"
                    className="btn-secondary !px-2 !py-1 text-xs"
                    onClick={() => removeItem(i)}
                    disabled={!canEdit || !editing}
                    aria-label={`Remove ${item.authority}`}
                    data-testid={`remove-${item.authority}`}
                  >
                    <Trash2 size={12} /> Remove
                  </button>
                </div>
              </div>
              <div className="card-body space-y-3">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Stage 1 requirements</p>
                  <ul className="space-y-1">
                    {item.stage1Requirements.map((r, ri) => (
                      <li key={ri} className="flex flex-wrap items-center gap-2 rounded-md bg-cream-50 px-2 py-1.5">
                        <select
                          value={r.docType}
                          onChange={(e) => updateStage1Req(i, ri, { docType: e.target.value as ProposedControlItem['stage1Requirements'][number]['docType'] })}
                          disabled={!canEdit || !editing}
                          className="input !h-8 !w-32 !text-xs"
                          aria-label={`Stage 1 doc type for ${item.authority} #${ri + 1}`}
                        >
                          {['application', 'license', 'insurance', 'receipt', 'floor_plan', 'other'].map((dt) => (
                            <option key={dt} value={dt}>{dt}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={r.label}
                          onChange={(e) => updateStage1Req(i, ri, { label: e.target.value })}
                          disabled={!canEdit || !editing}
                          className="input !h-8 flex-1 !text-xs"
                          aria-label={`Stage 1 label for ${item.authority} #${ri + 1}`}
                        />
                        <label className="flex items-center gap-1 text-xs text-ink-600">
                          <input
                            type="checkbox"
                            checked={r.required}
                            onChange={(e) => updateStage1Req(i, ri, { required: e.target.checked })}
                            disabled={!canEdit || !editing}
                            className="h-3.5 w-3.5 accent-brand-600"
                          />
                          required
                        </label>
                        <button
                          type="button"
                          className="btn-secondary !px-2 !py-1 text-xs"
                          onClick={() => removeStage1Req(i, ri)}
                          disabled={!canEdit || !editing}
                          aria-label={`Remove Stage 1 requirement #${ri + 1} from ${item.authority}`}
                        >
                          <Trash2 size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="btn-secondary mt-2 !px-2 !py-1 text-xs"
                    onClick={() => addStage1Req(i)}
                    disabled={!canEdit || !editing}
                  >
                    + Add Stage 1 requirement
                  </button>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Stage 2 requirement</p>
                  <input
                    type="text"
                    value={item.stage2Requirement?.label ?? ''}
                    onChange={(e) => updateItem(i, { stage2Requirement: { kind: 'image', label: e.target.value } })}
                    disabled={!canEdit || !editing}
                    className="input !h-8 !text-xs"
                    placeholder="Photo of authority at venue"
                    aria-label={`Stage 2 label for ${item.authority}`}
                  />
                </div>
              </div>
            </section>
          ))}
          {availableToAdd.length > 0 && canEdit && (
            <div className="card">
              <div className="card-body flex flex-wrap items-center gap-2">
                <span className="text-sm text-ink-500">Add another authority:</span>
                {availableToAdd.map((auth) => (
                  <button
                    key={auth}
                    type="button"
                    className="btn-secondary !px-2 !py-1 text-xs"
                    onClick={() => addItem(auth)}
                    data-testid={`add-${auth}`}
                  >
                    + {auth}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

function ConfirmedControlCards({ controls }: { controls: EventControl[] }) {
  if (controls.length === 0) return <div className="card"><div className="card-body"><p className="text-sm text-status-rejected">Confirmed control data is unavailable. Contact an Admin to repair this application.</p></div></div>;
  return <div className="space-y-4" data-testid="confirmed-control-cards">
    {controls.map((control) => {
      const requirements = Array.isArray(control.stage1Requirements) ? control.stage1Requirements : [];
      return <section key={control.controlId} className="card" data-testid={`confirmed-control-${control.authority}`}>
      <div className="card-header flex-wrap gap-3">
        <div className="flex items-center gap-2"><ClipboardList size={16} className="text-brand-700" /><div><h2 className="font-semibold text-ink-800">{control.controlName}</h2><p className="text-xs text-ink-500">{control.authority} · Confirmed and immutable</p></div></div>
        <span className="badge bg-green-100 text-status-approved">Confirmed</span>
      </div>
      <div className="card-body grid gap-4 md:grid-cols-2">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Stage 1 requirements</p><ul className="mt-2 space-y-2">{requirements.length ? requirements.map((requirement, index) => <li key={`${requirement.docType}-${index}`} className="rounded-md bg-cream-50 px-3 py-2 text-sm text-ink-700"><span className="font-semibold">{requirement.label}</span><span className="ml-2 text-xs text-ink-500">{requirement.docType}{requirement.required ? ' · required' : ' · optional'}</span></li>) : <li className="rounded-md bg-cream-50 px-3 py-2 text-sm text-ink-500">No Stage 1 documents required.</li>}</ul></div>
        <div><p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Stage 2 requirement</p><p className="mt-2 rounded-md bg-cream-50 px-3 py-2 text-sm text-ink-700">{control.stage2Requirement?.label ?? 'No Stage 2 image required.'}</p></div>
      </div>
    </section>;
    })}
  </div>;
}
