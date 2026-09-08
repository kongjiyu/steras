import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { CheckCircle2, Loader2, Pencil, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { ProposedControlItem } from '@shared/types';
import { functions } from '../../config/firebase';

interface Props { eventId: string; eventName: string; onClose: () => void; onPublished: () => void; }
interface ProposalResponse { items: ProposedControlItem[]; cached: boolean; source: string; }

export default function ControlProposalDialog({ eventId, eventName, onClose, onPublished }: Props) {
  const [items, setItems] = useState<ProposedControlItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const command = httpsCallable<{ eventId: string }, ProposalResponse>(functions, 'generateEventControlList');
    command({ eventId }).then((result) => setItems(result.data.items)).catch((error) => {
      toast.error(error instanceof Error ? error.message : 'Unable to prepare the control proposal.');
    }).finally(() => setLoading(false));
  }, [eventId]);

  const update = (index: number, patch: Partial<ProposedControlItem>) => setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const publish = async () => {
    setPublishing(true);
    try {
      const command = httpsCallable<{ eventId: string; items: ProposedControlItem[] }, { written: number }>(functions, 'editEventControlList');
      const result = await command({ eventId, items });
      toast.success(`Published ${result.data.written} event controls.`);
      onPublished();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to publish the control list.');
    } finally { setPublishing(false); }
  };

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/50 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="control-proposal-title">
    <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-xl bg-[#f8f5ed] shadow-xl sm:rounded-xl">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#ded5c5] bg-white px-5 py-4">
        <div><p className="text-xs font-bold uppercase tracking-wider text-brand-700">Application approved</p><h2 id="control-proposal-title" className="mt-1 font-display text-xl font-bold text-ink-900">Review event controls</h2><p className="mt-1 text-sm text-ink-500">{eventName}</p></div>
        <button type="button" className="rounded-md p-2 text-ink-500 hover:bg-cream-50" onClick={onClose} aria-label="Close control proposal"><X size={20}/></button>
      </header>
      <div className="p-5">
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800"><CheckCircle2 className="mr-2 inline" size={16}/>Final approval is saved. Publish the suggested controls unchanged, or edit them first.</div>
        {loading ? <div className="flex items-center justify-center gap-2 py-12 text-ink-500"><Loader2 className="animate-spin" size={18}/>Preparing control proposal…</div> : <div className="space-y-3">{items.map((item, index) => <section key={item.authority} className="rounded-lg border border-[#ded5c5] bg-white p-4">
          <div className="flex items-center gap-2"><span className="admin-badge admin-badge--default">{item.authority}</span>{editing ? <input className="input !h-9 flex-1" value={item.controlName} aria-label={`Control name for ${item.authority}`} onChange={(event) => update(index, { controlName: event.target.value })}/> : <h3 className="font-semibold text-ink-900">{item.controlName}</h3>}</div>
          <div className="mt-3"><p className="text-xs font-bold uppercase tracking-wide text-ink-500">Required documents</p><div className="mt-2 space-y-2">{item.stage1Requirements.map((requirement, requirementIndex) => editing ? <input key={requirementIndex} className="input !h-9 !text-sm" value={requirement.label} aria-label={`Requirement ${requirementIndex + 1} for ${item.authority}`} onChange={(event) => update(index, { stage1Requirements: item.stage1Requirements.map((value, valueIndex) => valueIndex === requirementIndex ? { ...value, label: event.target.value } : value) })}/> : <p key={requirementIndex} className="text-sm text-ink-700">• {requirement.label}</p>)}</div></div>
          {item.stage2Requirement && <div className="mt-3"><p className="text-xs font-bold uppercase tracking-wide text-ink-500">On-site photo</p>{editing ? <input className="input mt-2 !h-9 !text-sm" value={item.stage2Requirement.label} aria-label={`Photo requirement for ${item.authority}`} onChange={(event) => update(index, { stage2Requirement: { kind: 'image', label: event.target.value } })}/> : <p className="mt-1 text-sm text-ink-700">{item.stage2Requirement.label}</p>}</div>}
        </section>)}</div>}
      </div>
      <footer className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-[#ded5c5] bg-white px-5 py-4 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondary" onClick={() => setEditing((value) => !value)} disabled={loading || publishing}><Pencil size={15}/>{editing ? 'Finish editing' : 'Edit proposal'}</button>
        <button type="button" className="btn-success" onClick={publish} disabled={loading || publishing || items.length === 0}>{publishing ? <Loader2 className="animate-spin" size={15}/> : <CheckCircle2 size={15}/>}Publish controls</button>
      </footer>
    </div>
  </div>;
}
