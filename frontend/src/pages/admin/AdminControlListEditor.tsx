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
 *   - Click "Commit changes" to call `editEventControlList` and write
 *     the per-control docs to Firestore. After commit, the snapshot
 *     lives on `event.controlListSnapshot` and the organizer can see
 *     the list in `OrganizerEventControls` (UC-34).
 *
 * Per the M3 owner decision (2026-08-18): there is no auto-trigger.
 * The admin must explicitly click "Generate" and "Commit". Re-clicking
 * "Generate" with `force: false` returns the cached snapshot (A23:
 * don't regenerate without explicit reason). The "Regenerate" button
 * forces a fresh call.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { ChevronLeft, ClipboardList, RefreshCcw, Save, Sparkles, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  AuthorityType,
  COLLECTIONS,
  EventRecord,
  ProposedControlItem,
} from '@shared/types';
import { db, functions } from '../../config/firebase';
import EmptyState from '../../components/ui/EmptyState';
import StatusBadge from '../../components/ui/StatusBadge';

interface ProposedResponse {
  items: ProposedControlItem[];
  cached: boolean;
  source: 'cache' | 'minimax' | 'deterministic_fallback';
  model?: string;
  promptVersion?: string;
  generatedAt?: number;
  fallbackReason?: string;
}

interface CommittedResponse {
  eventId: string;
  versionId: string;
  written: number;
  controlIds: string[];
}

const ALL_AUTHORITIES: AuthorityType[] = ['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'];

export default function AdminControlListEditor() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [items, setItems] = useState<ProposedControlItem[]>([]);
  const [proposalSource, setProposalSource] = useState<'cache' | 'minimax' | 'deterministic_fallback' | null>(null);
  const [proposalCached, setProposalCached] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [committing, setCommitting] = useState(false);
  // Local snapshot of the items at the last commit / generate. Used
  // to detect "has the user changed anything?" for the disabled-commit
  // button.
  const [committedSnapshot, setCommittedSnapshot] = useState<ProposedControlItem[]>([]);

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

  const venueName = event?.eventDetails.venueName ?? '...';
  const isApproved = event?.status === 'Approved';
  const isUnderReview = event?.status === 'UnderReview';
  const canEdit = isApproved || isUnderReview;
  const generated = event?.controlListGenerated === true;

  const dirty = useMemo(() => JSON.stringify(items) !== JSON.stringify(committedSnapshot), [items, committedSnapshot]);

  const generate = async (force = false) => {
    if (!eventId) return;
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
      setCommittedSnapshot(result.data.items);
      toast.success(
        result.data.cached
          ? 'Loaded cached control list (no re-generation).'
          : result.data.source === 'deterministic_fallback'
            ? `Generated deterministic fallback with ${result.data.items.length} item(s).`
            : `Generated MiniMax proposal with ${result.data.items.length} item(s).`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to generate proposal.');
    } finally {
      setGenerating(false);
    }
  };

  const commit = async () => {
    if (!eventId) return;
    setCommitting(true);
    try {
      const command = httpsCallable<{ eventId: string; items: ProposedControlItem[] }, CommittedResponse>(
        functions,
        'editEventControlList',
      );
      const result = await command({ eventId, items });
      setCommittedSnapshot(items);
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
          {generated && <span className="text-xs font-semibold text-status-approved">Control list: published</span>}
          {!generated && <span className="text-xs font-semibold text-ink-500">Control list: not generated</span>}
        </div>
      </div>

      {!canEdit && (
        <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          The event is in {event.status} status. The control list can only be generated / edited for events in <strong>UnderReview</strong> or <strong>Approved</strong>.
        </div>
      )}

      {canEdit && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={() => generate(false)}
              disabled={generating}
              data-testid="generate-proposal-button"
            >
              <Sparkles size={16} />{generating ? 'Generating...' : (generated ? 'Load cached proposal' : 'Generate proposal')}
            </button>
            {generated && (
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
          </div>
          {items.length > 0 && (
            <button
              type="button"
              className="btn-success"
              onClick={commit}
              disabled={committing || !dirty}
              title={dirty ? 'Commit your changes' : 'No changes to commit'}
              data-testid="commit-changes-button"
            >
              <Save size={16} />{committing ? 'Committing...' : (dirty ? 'Commit changes' : 'No changes')}
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

      {items.length === 0 ? (
        <div className="card">
          <div className="card-body">
            <p className="text-sm text-ink-500">
              {generated
                ? 'No cached proposal items. Click "Regenerate" to re-fetch.'
                : 'No control list yet. Click "Generate proposal" to populate the table.'}
            </p>
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
                    disabled={!canEdit}
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
                    disabled={!canEdit}
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
                          disabled={!canEdit}
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
                          disabled={!canEdit}
                          className="input !h-8 flex-1 !text-xs"
                          aria-label={`Stage 1 label for ${item.authority} #${ri + 1}`}
                        />
                        <label className="flex items-center gap-1 text-xs text-ink-600">
                          <input
                            type="checkbox"
                            checked={r.required}
                            onChange={(e) => updateStage1Req(i, ri, { required: e.target.checked })}
                            disabled={!canEdit}
                            className="h-3.5 w-3.5 accent-brand-600"
                          />
                          required
                        </label>
                        <button
                          type="button"
                          className="btn-secondary !px-2 !py-1 text-xs"
                          onClick={() => removeStage1Req(i, ri)}
                          disabled={!canEdit}
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
                    disabled={!canEdit}
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
                    disabled={!canEdit}
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

      {generated && event.controlListSnapshot && (
        <section className="card mt-6">
          <div className="card-header">
            <h2 className="font-semibold">Committed list</h2>
            <span className="text-xs text-ink-500">Stored on the event doc; organizer sees this in OrganizerEventControls</span>
          </div>
          <div className="card-body">
            <p className="text-xs text-ink-500">
              Published at {event.updatedAt ? format(new Date(event.updatedAt), 'PPp') : 'unknown'}.
            </p>
            <ul className="mt-3 space-y-1 text-sm text-ink-700">
              {event.controlListSnapshot.map((s) => (
                <li key={s.controlId}>
                  <span className="font-semibold">{s.authority}</span> — {s.controlName} · {s.stage1RequirementsCount} Stage 1 req(s)
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
