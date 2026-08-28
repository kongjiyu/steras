import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { ArrowRight, CircleHelp, Download, FileText, MapPin, ShieldCheck } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import type { EventType, M1EventCategory, M1VenueSetting } from '@shared/types';
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
} from '../../features/m1/templateRegistry';
import { createInitialEventDetails } from './organizerApplication';

const TemplatePreview = lazy(() => import('../../features/m1/TemplatePreview'));

export default function TemplateRecommendationPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editingDraftId = searchParams.get('draft')?.trim() || undefined;
  const initialCategory = M1_EVENT_CATEGORIES.find((item) => item.value === searchParams.get('category'))?.value;
  const initialVenue = M1_VENUE_SETTINGS.find((item) => item.value === searchParams.get('venue'))?.value;
  const [category, setCategory] = useState<M1EventCategory | undefined>(initialCategory);
  const [venue, setVenue] = useState<M1VenueSetting | undefined>(initialVenue);
  const [categoryInfo, setCategoryInfo] = useState<M1EventCategory>();
  const [confirmed, setConfirmed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [selectionLocked, setSelectionLocked] = useState(false);
  const [checkingSelectionLock, setCheckingSelectionLock] = useState(Boolean(editingDraftId && isFirebaseConfigured));
  const scenario = useMemo(() => category && venue ? scenarioTemplateFor(category, venue) : undefined, [category, venue]);

  useEffect(() => {
    if (!editingDraftId || !isFirebaseConfigured) return;
    getDoc(doc(db, COLLECTIONS.EVENTS, editingDraftId))
      .then((snapshot) => {
        const paths = snapshot.data()?.draftDocumentPaths;
        setSelectionLocked(Array.isArray(paths) && paths.length > 0);
      })
      .catch(() => setSelectionLocked(true))
      .finally(() => setCheckingSelectionLock(false));
  }, [editingDraftId]);

  const selectCategory = (value: M1EventCategory) => {
    setCategory(value);
    setConfirmed(false);
  };
  const selectVenue = (value: M1VenueSetting) => {
    setVenue(value);
    setConfirmed(false);
  };

  const startApplication = async () => {
    if (!user || !category || !venue || !scenario || !confirmed || selectionLocked || checkingSelectionLock) return;
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
    try {
      const now = Date.now();
      if (editingDraftId) {
        await updateDoc(doc(db, COLLECTIONS.EVENTS, editingDraftId), { templateSelection: selection, updatedAt: now });
        toast.success('Template recommendation updated.');
        navigate(`/organizer/events/${editingDraftId}/edit`);
        return;
      }
      const reference = await addDoc(collection(db, COLLECTIONS.EVENTS), {
        organizerId: user.uid,
        eventDetails: details,
        templateSelection: selection,
        status: 'Draft',
        currentVersionNumber: 0,
        editableVersionId: 'v1',
        draftDocumentPaths: [],
        requiredAuthorities: [],
        createdAt: now,
        updatedAt: now,
        _serverCreatedAt: serverTimestamp(),
      });
      toast.success('Template choice saved. Your Draft is ready.');
      navigate(`/organizer/events/${reference.id}/edit`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to start the application.');
    } finally {
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

      <ApplicationJourney activeStep={scenario ? 3 : 2} />

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

            <Suspense fallback={<div className="grid min-h-64 place-items-center border border-[#d8cebd] bg-cream-50 text-sm text-ink-500">Preparing document preview…</div>}>
              <TemplatePreview core={M1_CORE_TEMPLATE} scenario={scenario} />
            </Suspense>

            <section aria-labelledby="documents-heading" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.1em] text-gold-600">Prepare before applying</p>
                <h2 id="documents-heading" className="mt-1 text-xl font-bold">Scenario-based supporting documents</h2>
                <p className="mt-2 max-w-[70ch] text-sm leading-6 text-ink-500">These are additional to the nine Core supporting documents. Conditional items only become required when the matching activity or risk applies to your event.</p>
                <ul className="mt-5 divide-y divide-[#e3dacb] border-y border-[#d8cebd]">
                  {scenario.supportingDocuments.map((document) => (
                    <li key={document.id} className="grid gap-2 py-4 sm:grid-cols-[8rem_1fr] sm:gap-4">
                      <span className="text-xs font-bold tracking-wide text-brand-700">{document.id}</span>
                      <span><span className="block font-semibold text-ink-800">{document.title}</span><span className="mt-1 block text-sm leading-5 text-ink-500">{document.condition}</span></span>
                    </li>
                  ))}
                </ul>
              </div>
              <aside className="h-fit border border-[#d8cebd] bg-[#fffdf8] p-5">
                <p className="text-sm font-bold text-ink-800">Core evidence</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-brand-700">9 files</p>
                <p className="mt-2 text-sm leading-5 text-ink-500">Venue, organisation, programme, supplier, safety and emergency documents required for every application.</p>
              </aside>
            </section>

            <section className="flex flex-col gap-5 border-t border-[#d8cebd] pt-7 lg:flex-row lg:items-center lg:justify-between">
              <label className="flex max-w-2xl cursor-pointer items-start gap-3 text-sm leading-6 text-ink-600">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-[#627820]" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                <span><span className="font-semibold text-ink-800">I have reviewed both templates and the supporting-document guidance.</span><br />You can change this selection while the Draft is editable and before a completed template is uploaded.</span>
              </label>
              <button type="button" disabled={!confirmed || starting || selectionLocked || checkingSelectionLock} onClick={startApplication} className="btn-primary shrink-0 px-5">
                {checkingSelectionLock ? 'Checking Draft…' : selectionLocked ? 'Templates locked after upload' : starting ? 'Creating Draft…' : editingDraftId ? 'Update recommendation' : 'Start application'} <ArrowRight size={17} />
              </button>
            </section>
          </>
        ) : (
          <div className="flex min-h-40 items-center justify-center border border-dashed border-[#b9ad97] bg-cream-50 px-6 text-center">
            <div><p className="font-semibold text-ink-700">Your recommendation will appear here</p><p className="mt-1 text-sm text-ink-500">Answer both questions to see, preview and download the correct templates.</p></div>
          </div>
        )}
      </div>
    </div>
  );
}

const DEFAULT_EVENT_TYPES: Record<M1EventCategory, EventType> = {
  entertainment_performance: 'concert',
  sports_recreational: 'sports',
  cultural_heritage_festival: 'cultural',
  exhibition_convention_promotional: 'exhibition',
  carnival_public_celebration: 'fair',
};
