import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { CheckCircle2, ExternalLink, Loader2, Pencil, RefreshCcw, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { ProposedControlItem } from '@shared/types';
import { functions } from '../../config/firebase';

interface Props {
  eventId: string;
  eventName: string;
  onClose: () => void;
  onPublished: () => void;
}

interface ProposalResponse {
  items: ProposedControlItem[];
  cached: boolean;
  source: 'cache' | 'minimax' | 'deterministic_fallback' | string;
  proposalId?: string;
  proposalRevision?: number;
}

interface CommitResponse {
  written: number;
  proposalId?: string;
  proposalRevision?: number;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export default function ControlProposalDialog({ eventId, eventName, onClose, onPublished }: Props) {
  const [items, setItems] = useState<ProposedControlItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [proposalId, setProposalId] = useState<string>();
  const [proposalRevision, setProposalRevision] = useState<number>();
  const [generationError, setGenerationError] = useState('');
  const [source, setSource] = useState<ProposalResponse['source']>();
  const [cached, setCached] = useState(false);

  const loadProposal = useCallback(async (force = false) => {
    setLoading(true);
    setGenerationError('');
    try {
      const command = httpsCallable<{ eventId: string; force?: boolean }, ProposalResponse>(functions, 'generateEventControlList');
      const result = await command({ eventId, ...(force ? { force: true } : {}) });
      setItems(result.data.items ?? []);
      setProposalId(result.data.proposalId);
      setProposalRevision(result.data.proposalRevision);
      setSource(result.data.source);
      setCached(result.data.cached);
    } catch (error) {
      const message = errorMessage(error, 'Unable to prepare the control proposal.');
      setGenerationError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void loadProposal(); }, [loadProposal]);

  const update = (index: number, patch: Partial<ProposedControlItem>) => {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };

  const publish = async () => {
    if (items.length === 0) return;
    setPublishing(true);
    try {
      const command = httpsCallable<{
        eventId: string;
        items: ProposedControlItem[];
        proposalId?: string;
        proposalRevision?: number;
      }, CommitResponse>(functions, 'editEventControlList');
      const result = await command({
        eventId,
        items,
        ...(proposalId ? { proposalId } : {}),
        ...(proposalRevision !== undefined ? { proposalRevision } : {}),
      });
      toast.success(`Confirmed ${result.data.written} event controls.`);
      onPublished();
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to confirm the control list.'));
    } finally {
      setPublishing(false);
    }
  };

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/50 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="control-proposal-title">
    <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-xl bg-[#f8f5ed] shadow-xl sm:rounded-xl">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#ded5c5] bg-white px-5 py-4">
        <div><p className="text-xs font-bold uppercase tracking-wider text-brand-700">Final approval saved</p><h2 id="control-proposal-title" className="mt-1 font-display text-xl font-bold text-ink-900">Confirm event control list</h2><p className="mt-1 text-sm text-ink-500">{eventName}</p></div>
        <button type="button" className="rounded-md p-2 text-ink-500 hover:bg-cream-50" onClick={onClose} aria-label="Close control proposal"><X size={20}/></button>
      </header>
      <div className="p-5">
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800"><CheckCircle2 className="mr-2 inline" size={16}/>Final approval is saved. This generated draft remains available until you confirm the control list.</div>
        {generationError && <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-status-rejected"><p className="font-semibold">Control proposal could not be generated</p><p className="mt-1">{generationError}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => void loadProposal(true)} disabled={loading}><RefreshCcw size={14}/> Retry</button><a className="btn-secondary !px-3 !py-1.5 text-xs" href={`/admin/applications/${eventId}/controls`}><ExternalLink size={14}/> Open Event Control List</a></div></div>}
        {loading ? <div className="flex items-center justify-center gap-2 py-12 text-ink-500"><Loader2 className="animate-spin" size={18}/>Preparing control proposal…</div> : items.length === 0 ? <div className="rounded-md border border-[#ded5c5] bg-white p-5 text-sm text-ink-500">No control proposal items are available. Retry generation or open Event Control List to continue.</div> : <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500"><span>{cached ? 'Recovered saved draft.' : 'New draft generated.'} {source === 'deterministic_fallback' ? 'Deterministic fallback used.' : ''}</span>{proposalRevision !== undefined && <span>Draft revision {proposalRevision}</span>}</div>
          <div className="space-y-3">{items.map((item, index) => <section key={item.authority} className="rounded-lg border border-[#ded5c5] bg-white p-4">
            <div className="flex items-center gap-2"><span className="admin-badge admin-badge--default">{item.authority}</span>{editing ? <input className="input !h-9 flex-1" value={item.controlName} aria-label={`Control name for ${item.authority}`} onChange={(event) => update(index, { controlName: event.target.value })}/> : <h3 className="font-semibold text-ink-900">{item.controlName}</h3>}</div>
            <div className="mt-3"><p className="text-xs font-bold uppercase tracking-wide text-ink-500">Required documents</p><div className="mt-2 space-y-2">{item.stage1Requirements.map((requirement, requirementIndex) => editing ? <input key={requirementIndex} className="input !h-9 !text-sm" value={requirement.label} aria-label={`Requirement ${requirementIndex + 1} for ${item.authority}`} onChange={(event) => update(index, { stage1Requirements: item.stage1Requirements.map((value, valueIndex) => valueIndex === requirementIndex ? { ...value, label: event.target.value } : value) })}/> : <p key={requirementIndex} className="text-sm text-ink-700">• {requirement.label}</p>)}</div></div>
            {item.stage2Requirement && <div className="mt-3"><p className="text-xs font-bold uppercase tracking-wide text-ink-500">On-site photo</p>{editing ? <input className="input mt-2 !h-9 !text-sm" value={item.stage2Requirement.label} aria-label={`Photo requirement for ${item.authority}`} onChange={(event) => update(index, { stage2Requirement: { kind: 'image', label: event.target.value } })}/> : <p className="mt-1 text-sm text-ink-700">{item.stage2Requirement.label}</p>}</div>}
          </section>)}</div>
        </>}
      </div>
      <footer className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-[#ded5c5] bg-white px-5 py-4 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondary" onClick={() => void loadProposal(true)} disabled={loading || publishing || items.length === 0} data-testid="regenerate-control-proposal"><RefreshCcw size={15}/>Regenerate</button>
        <button type="button" className="btn-secondary" onClick={() => setEditing((value) => !value)} disabled={loading || publishing || items.length === 0}><Pencil size={15}/>{editing ? 'Finish editing' : 'Edit proposal'}</button>
        <button type="button" className="btn-success" onClick={publish} disabled={loading || publishing || items.length === 0} data-testid="confirm-control-list">{publishing ? <Loader2 className="animate-spin" size={15}/> : <CheckCircle2 size={15}/>}Confirm control list</button>
      </footer>
    </div>
  </div>;
}
