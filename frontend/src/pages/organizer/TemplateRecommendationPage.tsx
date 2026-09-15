import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { collection, doc, getDoc, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';
import { ArrowRight, CircleAlert, CircleHelp, Download, FileText, MapPin, ShieldCheck, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import type { EventRecord, EventType, M1EventCategory, M1VenueSetting } from '@shared/types';
import { COLLECTIONS } from '@shared/types';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { useAuth } from '../../contexts/AuthContext';
import ApplicationJourney from '../../features/m1/ApplicationJourney';
import {
  createTemplateSelection,
  M1_CORE_TEMPLATE,
  M1_EVENT_CATEGORIES,
  M1_VENUE_SETTINGS,
  scenarioTemplateFor,
  templateDownloadUrl,
  type M1TemplateDefinition,
} from '../../features/m1/templateRegistry';
import { alignEventDetailsWithTemplate, createInitialEventDetails, createM1DraftRecord, reconcileM1EvidenceManifest } from './organizerApplication';

const TemplatePreview = lazy(() => import('../../features/m1/TemplatePreview'));

export default function TemplateRecommendationPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedDraftId = searchParams.get('draft')?.trim();
  const editingDraftId = requestedDraftId && isSafeDraftId(requestedDraftId) ? requestedDraftId : undefined;
  const initialCategory = M1_EVENT_CATEGORIES.find((item) => item.value === searchParams.get('category'))?.value;
  const initialVenue = M1_VENUE_SETTINGS.find((item) => item.value === searchParams.get('venue'))?.value;
  const [category, setCategory] = useState<M1EventCategory | undefined>(initialCategory);
  const [venue, setVenue] = useState<M1VenueSetting | undefined>(initialVenue);
  const [categoryInfo, setCategoryInfo] = useState<M1EventCategory>();
  const [confirmed, setConfirmed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [selectionLocked, setSelectionLocked] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const [checkingSelectionLock, setCheckingSelectionLock] = useState(Boolean(editingDraftId && isFirebaseConfigured));
  const startLockRef = useRef(false);
  const scenario = useMemo(() => category && venue ? scenarioTemplateFor(category, venue) : undefined, [category, venue]);

  useEffect(() => {
    if (!editingDraftId || !isFirebaseConfigured) return;
    getDoc(doc(db, COLLECTIONS.EVENTS, editingDraftId))
      .then((snapshot) => {
        if (!snapshot.exists()) {
          setSelectionLocked(true);
          setUpdateError('Draft not found — Return to My Events and open an available Draft.');
          return;
        }
        const draft = snapshot.data() as EventRecord;
        const hasDocuments = (draft.draftDocumentPaths?.length ?? 0) > 0 || (draft.draftDocuments?.length ?? 0) > 0;
        const isEditable = draft.status === 'Draft' && draft.organizerId === user?.uid && !hasDocuments;
        setSelectionLocked(!isEditable);
        if (draft.organizerId !== user?.uid) {
          setUpdateError('Wrong organizer account — Sign in with the account that created this Draft, then reopen it from My Events.');
        } else if (draft.status !== 'Draft') {
          setUpdateError(`Template change unavailable — This application is already ${draft.status}. Return to My Events to view its current status.`);
        } else if (hasDocuments) {
          setUpdateError('Templates locked — Completed documents have already been uploaded. Continue with the current templates or create a new Draft.');
        } else {
          setUpdateError('');
        }
      })
      .catch((error) => {
        setSelectionLocked(true);
        setUpdateError(templateRecommendationErrorMessage(error, 'update'));
      })
      .finally(() => setCheckingSelectionLock(false));
  }, [editingDraftId, user?.uid]);

  const selectCategory = (value: M1EventCategory) => {
    setCategory(value);
    setConfirmed(false);
    if (!selectionLocked) setUpdateError('');
  };
  const selectVenue = (value: M1VenueSetting) => {
    setVenue(value);
    setConfirmed(false);
    if (!selectionLocked) setUpdateError('');
  };

  const startApplication = async () => {
    if (!user || !category || !venue || !scenario || !confirmed || selectionLocked || checkingSelectionLock) return;
    if (startLockRef.current) return;
    startLockRef.current = true;
    const selection = createTemplateSelection(category, venue);
    const details = createInitialEventDetails(profile ?? undefined);
    details.type = DEFAULT_EVENT_TYPES[category];
    details.environment = venue === 'indoor' ? 'indoor' : 'outdoor';
    details.coverage = venue === 'indoor' ? 'covered' : 'uncovered';

    if (!isFirebaseConfigured) {
      navigate('/organizer/events/new/details', { state: { templateSelection: selection, initialDetails: details } });
      return;
    }

    setStarting(true);
    setUpdateError('');
    try {
      const now = Date.now();
      if (editingDraftId) {
        const eventReference = doc(db, COLLECTIONS.EVENTS, editingDraftId);
        await runTransaction(db, async (transaction) => {
          const snapshot = await transaction.get(eventReference);
          if (!snapshot.exists()) throw new Error('Draft not found — Return to My Events and open an available Draft.');
          const draft = snapshot.data() as EventRecord;
          if (draft.organizerId !== user.uid) throw new Error('Wrong organizer account — Sign in with the account that created this Draft, then reopen it from My Events.');
          if (draft.status !== 'Draft') throw new Error(`Template change unavailable — This application is already ${draft.status}. Return to My Events to view its current status.`);
          if ((draft.draftDocumentPaths?.length ?? 0) > 0 || (draft.draftDocuments?.length ?? 0) > 0) {
            throw new Error('Templates locked — Completed documents have already been uploaded. Continue with the current templates or create a new Draft.');
          }
          const nextDetails = alignEventDetailsWithTemplate(draft.eventDetails, selection);
          transaction.update(eventReference, {
            templateSelection: selection,
            eventDetails: nextDetails,
            draftEvidenceManifest: reconcileM1EvidenceManifest(selection, nextDetails, draft.draftEvidenceManifest ?? []),
            updatedAt: now,
          });
        });
        toast.success('Template recommendation updated.');
        navigate(`/organizer/events/${editingDraftId}/edit`);
        return;
      }
      const reference = doc(collection(db, COLLECTIONS.EVENTS));
      await setDoc(reference, {
        ...createM1DraftRecord(reference.id, user.uid, details, selection, now),
        _serverCreatedAt: serverTimestamp(),
      });
      toast.success('Template choice saved. Your Draft is ready.');
      navigate(`/organizer/events/${reference.id}/edit`);
    } catch (error) {
      const message = templateRecommendationErrorMessage(error, editingDraftId ? 'update' : 'create');
      setUpdateError(message);
    } finally {
      startLockRef.current = false;
      setStarting(false);
    }
  };

  return (
    <div className="page-enter pb-12">
      <header className="mb-6 max-w-3xl">
        <p className="page-eyebrow">{editingDraftId ? 'Update Draft templates' : 'New event application'}</p>
        <h1 className="text-3xl font-bold tracking-[-0.03em] text-ink-900 sm:text-4xl">{editingDraftId ? 'Review your template choice' : 'Find the right application templates'}</h1>
        <p className="mt-3 max-w-[65ch] text-base leading-7 text-ink-500">Tell us what you are organising and how the venue works. STERAS will pair the common Core form with the exact scenario form your event needs.</p>
      </header>

      <ApplicationJourney activeStep={scenario ? 3 : 2} sticky />

      <div className="mt-8 grid gap-10">
        <section aria-labelledby="category-heading">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-gold-600">Question 1</p>
              <h2 id="category-heading" className="mt-1 text-xl font-bold">Which event category fits best?</h2>
            </div>
            <span className="hidden text-sm text-ink-500 sm:block">Choose one</span>
          </div>
          <div className="grid gap-px overflow-hidden border border-[#d8cebd] bg-[#d8cebd] lg:grid-cols-5">
            {M1_EVENT_CATEGORIES.map((item, index) => {
              const selected = category === item.value;
              const expanded = categoryInfo === item.value;
              return (
                <div key={item.value} className={`relative bg-[#fffdf8] p-4 ${selected ? 'z-10 ring-2 ring-inset ring-brand-600' : ''}`}>
                  <label className="block min-h-[7.5rem] cursor-pointer pr-8">
                    <input className="sr-only" type="radio" name="event-category" value={item.value} checked={selected} onChange={() => selectCategory(item.value)} />
                    <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${selected ? 'bg-brand-700 text-cream-50' : 'bg-cream-100 text-ink-500'}`}>{String(index + 1).padStart(2, '0')}</span>
                    <span className="mt-4 block text-base font-bold leading-5 text-ink-800">{item.shortLabel}</span>
                    <span className="mt-2 block text-sm leading-5 text-ink-500">{item.examples.slice(0, 2).join(' · ')}</span>
                  </label>
                  <button type="button" aria-label={`More information about ${item.label}`} aria-expanded={expanded} onClick={() => setCategoryInfo(expanded ? undefined : item.value)} className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full text-ink-500 hover:bg-cream-100 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                    <CircleHelp size={18} />
                  </button>
                  {expanded && <div>
                    <div>
                      <div className="mt-4 border-t border-[#e3dacb] pt-4 text-sm leading-5 text-ink-600">
                        <p className="font-semibold text-ink-700">Examples</p>
                        <p>{item.examples.join(', ')}</p>
                        <p className="mt-3 font-semibold text-ink-700">Main risks assessed</p>
                        <p>{item.risks.join(', ')}</p>
                      </div>
                    </div>
                  </div>}
                </div>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="venue-heading">
          <div className="mb-4">
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-gold-600">Question 2</p>
            <h2 id="venue-heading" className="mt-1 text-xl font-bold">How is the venue set up?</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {M1_VENUE_SETTINGS.map((item) => {
              const selected = venue === item.value;
              return (
                <label key={item.value} className={`group flex min-h-36 cursor-pointer gap-4 border p-5 transition-colors ${selected ? 'border-brand-700 bg-brand-50' : 'border-[#d8cebd] bg-[#fffdf8] hover:border-brand-300'}`}>
                  <input className="mt-1 h-4 w-4 accent-[#627820]" type="radio" name="venue-setting" value={item.value} checked={selected} onChange={() => selectVenue(item.value)} />
                  <span>
                    <span className="flex items-center gap-2 text-base font-bold text-ink-800"><MapPin size={17} className="text-brand-600" />{item.label}</span>
                    <span className="mt-2 block text-sm leading-5 text-ink-600">{item.description}</span>
                    <span className="mt-2 block text-xs leading-5 text-ink-400">Examples: {item.examples}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </section>

        {scenario ? (
          <>
            <section aria-labelledby="recommendation-heading" className="border border-brand-200 bg-brand-50">
              <div className="grid lg:grid-cols-[18rem_1fr]">
                <div className="bg-brand-800 p-6 text-cream-50">
                  <div className="grid h-11 w-11 place-items-center rounded-full bg-gold-300 text-brand-950"><ShieldCheck size={22} /></div>
                  <p className="mt-5 text-xs font-bold uppercase tracking-[0.12em] text-gold-200">Your recommendation</p>
                  <h2 id="recommendation-heading" className="mt-2 text-2xl font-bold leading-8 text-cream-50">Complete these two documents</h2>
                  <p className="mt-3 text-sm leading-6 text-brand-100">Both files are required. Keep every Field ID and type answers only in the response cells.</p>
                </div>
                <div className="grid gap-px bg-brand-200 sm:grid-cols-2">
                  {[M1_CORE_TEMPLATE, scenario].map((template, index) => (
                    <article key={template.templateId} className="flex flex-col bg-[#fffdf8] p-5 sm:p-6">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.08em] text-gold-600">{index === 0 ? '1 · Common to every event' : '2 · Selected for your scenario'}</p>
                          <h3 className="mt-2 text-lg font-bold leading-6">{template.title}</h3>
                        </div>
                        <FileText className="shrink-0 text-brand-600" size={22} />
                      </div>
                      <p className="mt-3 text-xs text-ink-500">{template.templateId} · Version {template.version} · {template.pageCount} pages</p>
                      <a className="btn-secondary mt-6 self-start" href={templateDownloadUrl(template)} download><Download size={16} /> Download Word</a>
                    </article>
                  ))}
                </div>
              </div>
            </section>

            <TemplatePreviewErrorBoundary key={scenario.templateId} core={M1_CORE_TEMPLATE} scenario={scenario}>
              <Suspense fallback={<div className="grid min-h-64 place-items-center border border-[#d8cebd] bg-cream-50 text-sm text-ink-500">Preparing document preview…</div>}>
                <TemplatePreview core={M1_CORE_TEMPLATE} scenario={scenario} />
              </Suspense>
            </TemplatePreviewErrorBoundary>

            <section aria-labelledby="documents-heading">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.1em] text-gold-600">Prepare before applying</p>
                <h2 id="documents-heading" className="mt-1 text-xl font-bold">Core and scenario supporting documents</h2>
                <p className="mt-2 max-w-[78ch] text-sm leading-6 text-ink-500">These are evidence requirements rather than downloadable templates. Prepare your own current files, then upload and link them after you start the application. Conditional items only become required when the matching activity or risk applies.</p>
              </div>
              <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <SupportingDocumentGroup title="Core supporting documents" description="Common evidence for every event" documents={M1_CORE_TEMPLATE.supportingDocuments} />
                <SupportingDocumentGroup title="Scenario supporting documents" description={`Additional evidence for ${scenario.title}`} documents={scenario.supportingDocuments} />
              </div>
            </section>

            <section className="flex flex-col gap-5 border-t border-[#d8cebd] pt-7 lg:flex-row lg:items-center lg:justify-between">
              <label className="flex max-w-2xl cursor-pointer items-start gap-3 text-sm leading-6 text-ink-600">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-[#627820]" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                <span><span className="font-semibold text-ink-800">I have reviewed both templates and the supporting-document guidance.</span><br />You can change this selection while the Draft is editable and before a completed template is uploaded.</span>
              </label>
              <button type="button" disabled={!confirmed || starting || selectionLocked || checkingSelectionLock} onClick={startApplication} className="btn-primary shrink-0 px-5">
                {checkingSelectionLock ? 'Checking Draft…' : selectionLocked ? 'Template change unavailable' : starting ? 'Creating Draft…' : editingDraftId ? 'Update recommendation' : 'Start application'} <ArrowRight size={17} />
              </button>
            </section>
          </>
        ) : (
          <div className="flex min-h-40 items-center justify-center border border-dashed border-[#b9ad97] bg-cream-50 px-6 text-center">
            <div><p className="font-semibold text-ink-700">Your recommendation will appear here</p><p className="mt-1 text-sm text-ink-500">Answer both questions to see, preview and download the correct templates.</p></div>
          </div>
        )}
      </div>
      {updateError && (
        <TemplateRecommendationErrorModal
          message={updateError}
          onClose={() => setUpdateError('')}
          onOpenMyEvents={() => {
            setUpdateError('');
            navigate('/organizer/events');
          }}
        />
      )}
    </div>
  );
}

interface TemplatePreviewErrorBoundaryProps {
  core: M1TemplateDefinition;
  scenario: M1TemplateDefinition;
  children: ReactNode;
}

interface TemplatePreviewErrorBoundaryState {
  failed: boolean;
}

export class TemplatePreviewErrorBoundary extends Component<TemplatePreviewErrorBoundaryProps, TemplatePreviewErrorBoundaryState> {
  state: TemplatePreviewErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): TemplatePreviewErrorBoundaryState {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <section className="border border-[#d8cebd] bg-[#fffdf8] p-5 sm:p-6" aria-labelledby="template-preview-unavailable-heading">
        <div className="flex items-start gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gold-100 text-gold-700" aria-hidden="true"><CircleAlert size={21} /></span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-gold-600">Document preview</p>
            <h2 id="template-preview-unavailable-heading" className="mt-1 text-lg font-bold text-ink-900">Preview could not be displayed</h2>
            <p className="mt-2 max-w-[70ch] text-sm leading-6 text-ink-600">Your template recommendation is still available. Download both Word documents below and continue preparing the application.</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          {[this.props.core, this.props.scenario].map((template) => (
            <a key={template.templateId} className="btn-secondary" href={templateDownloadUrl(template)} download>
              <Download size={16} /> Download {template.kind === 'core' ? 'Core' : 'Scenario'} Word
            </a>
          ))}
        </div>
      </section>
    );
  }
}

export function TemplateRecommendationErrorModal({ message, onClose, onOpenMyEvents }: {
  message: string;
  onClose: () => void;
  onOpenMyEvents: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [whatHappened, howToResolve = 'Close this message and try again.'] = message.split(' — ', 2);

  useEffect(() => {
    closeButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="template-error-title" aria-describedby="template-error-description">
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-[#d98b85] bg-[#fffdf8] shadow-2xl">
        <div className="flex items-start gap-4 border-b border-[#ead6d1] px-5 py-5 sm:px-6">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#fee2e2] text-[#991b1b]" aria-hidden="true"><CircleAlert size={22} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#b42318]">Template update error</p>
            <h2 id="template-error-title" className="mt-1 text-xl font-bold text-ink-900">We could not save this recommendation</h2>
          </div>
          <button ref={closeButton} type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-ink-500 hover:bg-cream-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b42318]" aria-label="Close error message"><X size={19} /></button>
        </div>
        <div id="template-error-description" className="space-y-5 px-5 py-5 sm:px-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-ink-500">What happened</p>
            <p className="mt-1 text-base font-semibold text-[#7f1d1d]">{whatHappened}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-ink-500">How to resolve</p>
            <p className="mt-1 text-sm leading-6 text-ink-700">{howToResolve}</p>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-3 border-t border-[#eadfd4] bg-cream-50 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button type="button" onClick={onClose} className="btn-secondary">Stay on this page</button>
          <button type="button" onClick={onOpenMyEvents} className="btn-primary">Open My Events</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SupportingDocumentGroup({ title, description, documents }: {
  title: string;
  description: string;
  documents: ReadonlyArray<{ id: string; title: string; condition: string }>;
}) {
  return <section className="overflow-hidden border border-[#d8cebd] bg-[#fffdf8]" aria-label={title}>
    <header className="border-b border-[#e3dacb] bg-cream-100 px-5 py-4">
      <h3 className="font-bold text-ink-900">{title}</h3>
      <p className="mt-1 text-sm text-ink-500">{description}</p>
    </header>
    <ol className="divide-y divide-[#e3dacb]" aria-label={`${title} checklist`}>
      {documents.map((document, index) => <li key={document.id} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 px-4 py-4 sm:px-5">
        <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{String(index + 1).padStart(2, '0')}</span>
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-wide text-brand-700">{document.id}</p>
          <h4 className="mt-1 font-semibold leading-6 text-ink-800">{document.title}</h4>
          <p className="mt-1 text-sm leading-5 text-ink-500">{document.condition}</p>
        </div>
      </li>)}
    </ol>
    <footer className="border-t border-[#d8cebd] bg-cream-100 px-5 py-3 text-sm font-bold text-ink-800">
      Total {documents.length}
    </footer>
  </section>;
}

const DEFAULT_EVENT_TYPES: Record<M1EventCategory, EventType> = {
  entertainment_performance: 'concert',
  sports_recreational: 'sports',
  cultural_heritage_festival: 'cultural',
  exhibition_convention_promotional: 'exhibition',
  carnival_public_celebration: 'fair',
};

function isSafeDraftId(value: string): boolean {
  return value.length <= 256 && !value.includes('/') && value !== '.' && value !== '..' && !/^__.*__$/.test(value);
}

export function templateRecommendationErrorMessage(error: unknown, action: 'create' | 'update'): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message.trim() : '';
  if (message.includes(' — ')) return message;
  if (code.includes('permission-denied')) {
    return 'Permission check failed — Open My Events and confirm this Draft belongs to the signed-in organizer and is still editable, then try again.';
  }
  if (code.includes('unavailable') || code.includes('network-request-failed')) {
    return 'Connection problem — Check your internet connection, keep this page open, and try again.';
  }
  if (code.includes('aborted') || code.includes('failed-precondition')) {
    return 'Draft changed elsewhere — Reload this Draft from My Events before changing the templates again.';
  }
  return action === 'update'
    ? 'Template update failed — Return to My Events, reopen this Draft, and try again. If it continues, contact an administrator with the Draft ID.'
    : 'Draft creation failed — Check your connection and try again. If it continues, contact an administrator.';
}
