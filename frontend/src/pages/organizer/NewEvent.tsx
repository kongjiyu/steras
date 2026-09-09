import { extractionErrorMessage } from './extractionErrorMessage';
import { documentMime } from '../../utils/documentMime';
import EvidencePreview from '../../components/ui/EvidencePreview';
import PageHeader from '../../components/ui/PageHeader';
import { EVENT_TYPES, EventType, EventDetails, EventRiskProfile, M1_DOCUMENT_SCHEMA_VERSION, M1_EVIDENCE_MANIFEST_SCHEMA_VERSION, M1ApplicationRevisionSource, M1DocumentExtraction, M1DocumentRole, M1DraftDocument, M1EvidenceRequirementResponse, M1TemplateSelection, Venue } from '@shared/types';
import { useEffect, useState, useRef, FormEvent, ChangeEvent } from 'react';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytesResumable } from 'firebase/storage';
import type { UploadTask } from 'firebase/storage';
import { db, functions, isFirebaseConfigured, storage } from '../../config/firebase';
import { COLLECTIONS } from '@shared/types';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import OrganizerStatusBadge from './OrganizerStatusBadge';
import { applyM1ExtractedFields, bindCanonicalVenue, completeRiskProfile, createInitialEventDetails, createM1DraftRecord, extractionMatchesDraftDocuments, findUniqueRegistryVenueMatch, isEditableApplicationStatus, isSelectableRegistryVenue, nextVersionId, reconcileM1EvidenceManifest, validateEventApplication, validateTemplateCompatibility } from './organizerApplication';
import { mockVenues } from '../../mock_data/venues';
import { findEventById } from '../../mock_data/events';
import { isValidTemplateSelection, M1_CORE_TEMPLATE, scenarioTemplateFor } from '../../features/m1/templateRegistry';
import { FileCheck2, FileText, RotateCcw, Sparkles } from 'lucide-react';
import { isM1EvidenceForcedRequired, m1EvidenceRequirementsFor } from '@shared/m1EvidenceContract';
import { applicationFileNameError } from './applicationFileName';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';
const APPLICATION_DOCUMENT_ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
type ActiveUpload = { role: M1DocumentRole; requirementId?: string; fileName: string; progress: number };

export default function NewEvent() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { eventId } = useParams<{ eventId: string }>();
  const validationRef = useRef<HTMLDivElement>(null);
  const activeUploadTaskRef = useRef<UploadTask | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [editing, setEditing] = useState(false);
  const [editSnapshot, setEditSnapshot] = useState<EventDetails>();
  const [notice, setNotice] = useState('');
  const [previewPath, setPreviewPath] = useState('');
  const [savedDraft, setSavedDraft] = useState('');
  const [manuallyEdited, setManuallyEdited] = useState(false);
  const [draftId, setDraftId] = useState(eventId ?? '');
  const [activeRevision, setActiveRevision] = useState<M1ApplicationRevisionSource>();
  const [currentVersionNumber, setCurrentVersionNumber] = useState(0);
  const [editableVersionId, setEditableVersionId] = useState('v1');
  const [documentPaths, setDocumentPaths] = useState<string[]>([]);
  const [draftDocuments, setDraftDocuments] = useState<M1DraftDocument[]>([]);
  const [extraction, setExtraction] = useState<M1DocumentExtraction | null>(null);
  const [currentExtractionId, setCurrentExtractionId] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(Boolean(eventId));
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeUpload, setActiveUpload] = useState<ActiveUpload | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const routeState = location.state as { templateSelection?: unknown; initialDetails?: unknown } | null;
  const [templateSelection, setTemplateSelection] = useState<M1TemplateSelection | undefined>(
    isValidTemplateSelection(routeState?.templateSelection) ? routeState.templateSelection : undefined,
  );

  const [form, setForm] = useState<EventDetails>(() => {
    const initial = routeState?.initialDetails;
    return initial && typeof initial === 'object'
      ? { ...(initial as EventDetails), riskProfile: completeRiskProfile((initial as EventDetails).riskProfile) }
      : createInitialEventDetails(profile ?? undefined);
  });
  const [evidenceManifest, setEvidenceManifest] = useState<M1EvidenceRequirementResponse[]>(() => templateSelection
    ? reconcileM1EvidenceManifest(templateSelection, form, [])
    : []);

  useEffect(() => {
    if (!profile) return;
    setForm(current => ({ ...current, organizerName: profile.name, organizerEmail: profile.email, organizerPhone: profile.phone ?? '' }));
  }, [profile, form.organizerName, form.organizerEmail, form.organizerPhone]);

  useEffect(() => {
    if (!editing || !editSnapshot || JSON.stringify(form) === JSON.stringify(editSnapshot)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editing, editSnapshot, form]);

  const update = <K extends keyof EventDetails>(key: K, value: EventDetails[K]) => {
    setValidationErrors([]);
    setSaveMessage('Unsaved changes');
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateRiskProfile = <K extends keyof EventRiskProfile>(key: K, value: EventRiskProfile[K]) => {
    setValidationErrors([]);
    setSaveMessage('Unsaved changes');
    setForm((previous) => ({
      ...previous,
      riskProfile: { ...previous.riskProfile, [key]: value },
    }));
  };

  useEffect(() => {
    if (!templateSelection) return;
    setEvidenceManifest((current) => reconcileM1EvidenceManifest(templateSelection, form, current));
  }, [form, templateSelection]);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setVenues(mockVenues.filter(isSelectableRegistryVenue).sort((left, right) => left.name.localeCompare(right.name)));
      return;
    }
    getDocs(collection(db, COLLECTIONS.VENUES))
      .then((snapshot) => setVenues(snapshot.docs
        .map((document) => ({ venueId: document.id, ...document.data() }) as Venue)
        .filter(isSelectableRegistryVenue)
        .sort((left, right) => left.name.localeCompare(right.name))))
      .catch(() => setVenues([]));
  }, []);

  useEffect(() => {
    if (!form.venueId) return;
    const venue = venues.find((item) => item.venueId === form.venueId);
    if (venue) setForm((current) => current.venueId === venue.venueId ? bindCanonicalVenue(current, venue) : current);
  }, [form.venueId, venues]);

  useEffect(() => {
    if (!eventId) return;
    if (!isFirebaseConfigured) {
      const event = findEventById(eventId);
      if (!event) {
        setNotice('Event draft not found.');
        navigate('/organizer/events');
        return;
      }
      if (!isEditableApplicationStatus(event.status)) {
        setNotice('Only draft or revision-requested applications can be edited.');
        navigate('/organizer/events');
        return;
      }
      setForm({ ...event.eventDetails, riskProfile: completeRiskProfile(event.eventDetails.riskProfile) });
      setActiveRevision(event.activeRevision);
      setCurrentVersionNumber(event.currentVersionNumber ?? 0);
      setEditableVersionId(event.editableVersionId ?? nextVersionId(event.currentVersionNumber ?? 0));
      setDocumentPaths(event.draftDocumentPaths ?? []);
      setDraftDocuments(event.draftDocuments ?? []);
      setCurrentExtractionId(event.currentExtractionId ?? '');
      if (isValidTemplateSelection(event.templateSelection)) {
        setEvidenceManifest(reconcileM1EvidenceManifest(
          event.templateSelection,
          event.eventDetails,
          event.draftEvidenceManifest ?? [],
        ));
      }
      setTemplateSelection(isValidTemplateSelection(event.templateSelection) ? event.templateSelection : undefined);
      setLoading(false);
      return;
    }
    getDoc(doc(db, COLLECTIONS.EVENTS, eventId)).then(async (snapshot) => {
      if (!snapshot.exists()) throw new Error('Event draft not found.');
      const data = snapshot.data();
      if (!isEditableApplicationStatus(data.status)) throw new Error('Only Draft applications can be edited.');
      setForm({ ...(data.eventDetails as EventDetails), riskProfile: completeRiskProfile(data.eventDetails?.riskProfile) });
      setActiveRevision(data.activeRevision as M1ApplicationRevisionSource | undefined);
      setCurrentVersionNumber(data.currentVersionNumber ?? 0);
      setEditableVersionId(data.editableVersionId ?? nextVersionId(data.currentVersionNumber ?? 0));
      setDocumentPaths(data.draftDocumentPaths ?? []);
      const loadedDraftDocuments = Array.isArray(data.draftDocuments) ? data.draftDocuments as M1DraftDocument[] : [];
      setDraftDocuments(loadedDraftDocuments);
      const extractionId = typeof data.currentExtractionId === 'string' ? data.currentExtractionId : '';
      setCurrentExtractionId('');
      if (extractionId) {
        const extractionSnapshot = await getDoc(doc(
          db,
          COLLECTIONS.EVENTS,
          eventId,
          COLLECTIONS.DOCUMENT_EXTRACTIONS,
          extractionId,
        ));
        if (extractionSnapshot.exists()) {
          const savedExtraction = extractionSnapshot.data() as M1DocumentExtraction;
          if (savedExtraction.extractionId === extractionId
            && Array.isArray(savedExtraction.extractedFields)
            && Array.isArray(savedExtraction.rawFieldIds)
            && Array.isArray(savedExtraction.warnings)
            && extractionMatchesDraftDocuments(savedExtraction, loadedDraftDocuments)) {
            setExtraction(savedExtraction);
            setCurrentExtractionId(extractionId);
          }
        }
      }
      setTemplateSelection(isValidTemplateSelection(data.templateSelection) ? data.templateSelection : undefined);
      if (isValidTemplateSelection(data.templateSelection)) {
        setEvidenceManifest(reconcileM1EvidenceManifest(
          data.templateSelection,
          data.eventDetails as EventDetails,
          Array.isArray(data.draftEvidenceManifest) ? data.draftEvidenceManifest as M1EvidenceRequirementResponse[] : [],
        ));
      }
    }).catch((error) => {
      setNotice(error instanceof Error ? error.message : 'Unable to load draft.');
      navigate('/organizer/events');
    }).finally(() => setLoading(false));
  }, [eventId, navigate]);

  const ensureDraft = async () => {
    if (!user) throw new Error('Sign in before saving a draft.');
    if (!templateSelection && !draftId) throw new Error('Choose the Core and scenario templates before creating a Draft.');
    if (templateSelection) {
      const [templateError] = validateTemplateCompatibility(form, templateSelection);
      if (templateError) throw new Error(templateError);
    }
    const now = Date.now();
    if (draftId) {
      await updateDoc(doc(db, COLLECTIONS.EVENTS, draftId), {
        eventDetails: form,
        draftDocumentPaths: documentPaths,
        draftDocuments,
        draftEvidenceManifest: evidenceManifest,
        evidenceManifestSchemaVersion: M1_EVIDENCE_MANIFEST_SCHEMA_VERSION,
        ...(templateSelection ? { templateSelection } : {}),
        updatedAt: now,
      });
      return draftId;
    }
    const nextEditableVersionId = nextVersionId(currentVersionNumber);
    const reference = doc(collection(db, COLLECTIONS.EVENTS));
    await setDoc(reference, {
      ...createM1DraftRecord(reference.id, user.uid, form, templateSelection!, now),
      _serverCreatedAt: serverTimestamp(),
    });
    setDraftId(reference.id);
    setEditableVersionId(nextEditableVersionId);
    window.history.replaceState(null, '', `/organizer/events/${reference.id}/edit`);
    return reference.id;
  };

  const handleSaveDraft = async () => {
    if (!isFirebaseConfigured || !navigator.onLine) {
      setSaveMessage('Unable to save. Reconnect and try again.');
      return false;
    }
    setSaving(true);
    try {
      const savedId = await ensureDraft();
      setSavedDraft(savedId);
      setEditSnapshot(structuredClone(form));
      setNotice('Draft saved.');
      setSaveMessage('Draft saved successfully.');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Draft save failed.';
      setNotice(message);
      setSaveMessage(message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const errors = validateEventApplication(form, documentPaths, templateSelection, draftDocuments, currentExtractionId, evidenceManifest);
    if (errors.length > 0) {
      setValidationErrors(errors);
      setNotice(errors[0]);
      requestAnimationFrame(() => {
        validationRef.current?.focus({ preventScroll: true });
        validationRef.current?.scrollIntoView({ block: 'start' });
      });
      return;
    }
    if (!isFirebaseConfigured) {
      setNotice('Firebase is not configured. Submission disabled.');
      return;
    }
    setSubmitting(true);
    try {
      const id = await ensureDraft();
      const submit = httpsCallable<{ eventId: string }, { versionId: string }>(functions, 'submitEvent');
      await submit({ eventId: id });
      toast.success(activeRevision ? 'Revised application submitted.' : 'Event submitted. The risk assessment will run shortly.');
      navigate(`/organizer/events/${id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Submission failed';
      setNotice(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>, role: M1DocumentRole, requirementId?: string) => {
    const files = [...(event.target.files ?? [])];
    if (files.length === 0) return;
    if (role !== 'supporting_evidence' && files.length !== 1) return setNotice('Choose exactly one application file.');
    const detectedTypes: string[] = [];
    try {
      for (const file of files) {
        const selectedScenarioDefinition = templateSelection
          ? scenarioTemplateFor(templateSelection.eventCategory, templateSelection.venueSetting)
          : undefined;
        const nameError = applicationFileNameError(file.name, role, selectedScenarioDefinition);
        if (nameError) return setNotice(nameError);
        if (!file.size || file.size > 10 * 1024 * 1024) return setNotice(`${file.name} must be a non-empty file no larger than 10 MB.`);
        const detected = documentMime(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
        if (!detected || (file.type && file.type !== 'application/octet-stream' && file.type !== detected)) return setNotice(`${file.name}: the contents do not match a supported PDF, DOCX or image. Choose the original file.`);
        if (role !== 'supporting_evidence' && ![PDF_MIME, DOCX_MIME].includes(detected)) return setNotice('Application templates must be PDF or DOCX. Images can be added as supporting evidence.');
        detectedTypes.push(detected);
      }
    } catch { return setNotice('This file could not be read. Select it again from your device.'); }
    const applicationRoles = new Set<M1DocumentRole>(['core_template', 'scenario_template', 'combined_application']);
    const retained = role === 'supporting_evidence'
      ? draftDocuments
      : draftDocuments.filter((document) => role === 'combined_application'
        ? !applicationRoles.has(document.role)
        : document.role !== role && document.role !== 'combined_application');
    if (retained.length + files.length > 20) return setNotice('Submit no more than 20 application documents.');
    const uploaded: M1DraftDocument[] = [];
    let uploadDraftId = '';
    const persistCompletedUploads = async () => {
      if (!uploadDraftId || uploaded.length === 0) return;
      let nextManifest = evidenceManifest;
      const nextDocuments = [...retained, ...uploaded];
      if (role === 'supporting_evidence' && requirementId) {
        const replacementPath = uploaded[0].path;
        nextManifest = evidenceManifest.map((response) => response.requirementId === requirementId
          ? { requirementId, applicability: 'required', documentPath: replacementPath }
          : response);
      }
      const structuredPaths = new Set(draftDocuments.map((document) => document.path));
      const unstructuredLegacyPaths = documentPaths.filter((path) => !structuredPaths.has(path));
      const nextPaths = [...unstructuredLegacyPaths, ...nextDocuments.map((document) => document.path)];
      await updateDoc(doc(db, COLLECTIONS.EVENTS, uploadDraftId), {
        draftDocumentPaths: nextPaths,
        draftDocuments: nextDocuments,
        draftEvidenceManifest: nextManifest,
        evidenceManifestSchemaVersion: M1_EVIDENCE_MANIFEST_SCHEMA_VERSION,
        updatedAt: Date.now(),
      });
      setDraftDocuments(nextDocuments);
      setDocumentPaths(nextPaths);
      setEvidenceManifest(nextManifest);
    };
    setUploading(true);
    try {
      const id = await ensureDraft();
      uploadDraftId = id;
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-150) || 'document';
        const path = `event_documents/${id}/${editableVersionId}/${crypto.randomUUID()}-${safeName}`;
        const mimeType = detectedTypes[index];
        const task = uploadBytesResumable(ref(storage, path), file, { contentType: mimeType });
        activeUploadTaskRef.current = task;
        setActiveUpload({ role, requirementId, fileName: file.name, progress: Math.round((index / files.length) * 100) });
        await new Promise<void>((resolve, reject) => task.on('state_changed', (snapshot) => {
          const fileProgress = snapshot.bytesTransferred / snapshot.totalBytes;
          const progress = Math.round(((index + fileProgress) / files.length) * 100);
          setActiveUpload({ role, requirementId, fileName: file.name, progress });
        }, reject, resolve));
        uploaded.push({
          path,
          role,
          originalName: file.name.slice(0, 255),
          mimeType,
          sizeBytes: file.size,
          uploadedAt: Date.now(),
          schemaVersion: M1_DOCUMENT_SCHEMA_VERSION,
        });
      }
      await persistCompletedUploads();
      if (role !== 'supporting_evidence') {
        setExtraction(null);
        setCurrentExtractionId('');
      }
      setValidationErrors([]);
      setNotice(`${uploaded.length} document${uploaded.length === 1 ? '' : 's'} uploaded. Select the matching evidence item below.`);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (uploaded.length > 0) {
        try { await persistCompletedUploads(); } catch { /* A retry remains safe because paths are immutable. */ }
      }
      setNotice(code === 'storage/canceled'
        ? uploaded.length > 0 ? `Upload cancelled. ${uploaded.length} completed file${uploaded.length === 1 ? ' was' : 's were'} kept.` : 'Upload cancelled. No document was added.'
        : error instanceof Error ? error.message : 'Document upload failed.');
    } finally {
      activeUploadTaskRef.current = null;
      setActiveUpload(null);
      setUploading(false);
      event.target.value = '';
    }
  };

  const cancelUpload = () => {
    if (activeUploadTaskRef.current?.cancel()) setNotice('Cancelling upload…');
  };

  const removeDocument = async (path: string) => {
    if (!draftId || !path.startsWith(`event_documents/${draftId}/${editableVersionId}/`)) return;
    try {
      const nextDocuments = draftDocuments.filter((document) => document.path !== path);
      const nextPaths = documentPaths.filter((item) => item !== path);
      const nextManifest = evidenceManifest.map((response) => response.documentPath === path
        ? { requirementId: response.requirementId, applicability: 'required' as const }
        : response);
      await updateDoc(doc(db, COLLECTIONS.EVENTS, draftId), {
        draftDocumentPaths: nextPaths,
        draftDocuments: nextDocuments,
        draftEvidenceManifest: nextManifest,
        evidenceManifestSchemaVersion: M1_EVIDENCE_MANIFEST_SCHEMA_VERSION,
        updatedAt: Date.now(),
      });
      setValidationErrors([]);
      setDraftDocuments(nextDocuments);
      setDocumentPaths(nextPaths);
      setEvidenceManifest(nextManifest);
      if (draftDocuments.find((document) => document.path === path)?.role !== 'supporting_evidence') {
        setExtraction(null);
        setCurrentExtractionId('');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to remove document.');
    }
  };

  const updateEvidenceResponse = (requirementId: string, response: M1EvidenceRequirementResponse) => {
    const nextManifest = evidenceManifest.map((item) => item.requirementId === requirementId ? response : item);
    setEvidenceManifest(nextManifest);
    setValidationErrors([]);
  };

  const viewDocument = (path: string) => setPreviewPath(path);

  const extractDocuments = async () => {
    if (!draftId) return setNotice('Save the Draft before extracting documents.');
    if (manuallyEdited && !window.confirm('Extract again and replace your edited details with the uploaded document?')) return;
    setNotice('');
    setExtracting(true);
    try {
      const extract = httpsCallable<{ eventId: string }, M1DocumentExtraction>(functions, 'extractApplicationDocuments');
      const result = (await extract({ eventId: draftId })).data;
      setEditing(false);
      setManuallyEdited(false);
      setExtraction(result);
      setCurrentExtractionId(result.extractionId);
      setForm((current) => {
        const extracted = applyM1ExtractedFields(current, result.extractedFields);
        const selectedVenue = extracted.venueId
          ? venues.find((venue) => venue.venueId === extracted.venueId)
          : findUniqueRegistryVenueMatch(extracted.venueName, venues);
        return selectedVenue ? bindCanonicalVenue(extracted, selectedVenue) : extracted;
      });
      setValidationErrors([]);
      setNotice(`Auto-filled ${result.extractedFields.length} fields. Review all highlighted warnings before submission.`);
    } catch (error) {
      setNotice(extractionErrorMessage(error));
    } finally {
      setExtracting(false);
    }
  };

  const toDatetimeLocal = (epoch: number) => {
    if (!epoch) return '';
    const d = new Date(epoch);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const fromDatetimeLocal = (v: string) => (v ? new Date(v).getTime() : 0);

  if (loading) return <div className="py-16 text-center text-ink-500">Loading application…</div>;

  const selectedScenario = templateSelection
    ? scenarioTemplateFor(templateSelection.eventCategory, templateSelection.venueSetting)
    : undefined;
  const [templateCompatibilityError] = templateSelection
    ? validateTemplateCompatibility(form, templateSelection)
    : [];
  const recommendationUrl = draftId
    ? `/organizer/events/new?draft=${encodeURIComponent(draftId)}${templateSelection ? `&category=${templateSelection.eventCategory}&venue=${templateSelection.venueSetting}` : ''}`
    : '/organizer/events/new';
  const coreUpload = draftDocuments.find((document) => document.role === 'core_template');
  const scenarioUpload = draftDocuments.find((document) => document.role === 'scenario_template');
  const combinedUpload = draftDocuments.find((document) => document.role === 'combined_application');
  const supportingUploads = draftDocuments.filter((document) => document.role === 'supporting_evidence');
  const structuredUploadPaths = new Set(draftDocuments.map((document) => document.path));
  const legacySupportingPaths = documentPaths.filter((path) => !structuredUploadPaths.has(path));
  const evidenceDefinitions = templateSelection ? m1EvidenceRequirementsFor(templateSelection.scenarioTemplateId) : [];
  const evidenceGuidance = new Map([
    ...M1_CORE_TEMPLATE.supportingDocuments,
    ...(selectedScenario?.supportingDocuments ?? []),
  ].map((guidance) => [guidance.id, guidance]));
  const validNotApplicable = evidenceDefinitions.filter(definition => {
    const response = evidenceManifest.find(item => item.requirementId === definition.id);
    return !isM1EvidenceForcedRequired(definition, form.riskProfile) && response?.applicability === 'not_applicable' && (response.notApplicableReason?.trim().length ?? 0) >= 10;
  });
  const requiredEvidenceCount = evidenceDefinitions.length - validNotApplicable.length;
  const completeEvidenceCount = evidenceDefinitions.filter(definition => {
    const response = evidenceManifest.find(item => item.requirementId === definition.id);
    return response?.applicability === 'required' && supportingUploads.some(document => document.path === response.documentPath);
  }).length;

  const jumpTo = (id: string) => {
    requestAnimationFrame(() => {
      const target = document.getElementById(id);
      target?.scrollIntoView({ block: 'start' });
      target?.focus({ preventScroll: true });
    });
  };
  const reviewError = (error: string) => {
    const item = evidenceDefinitions.find(definition => error.includes(definition.id));
    if (item || /supporting.evidence/.test(error)) {
      setOnlyMissing(false);
      jumpTo(item ? `evidence-${item.id}` : 'supporting-evidence');
    } else if (/Upload|Extract|template/i.test(error)) {
      jumpTo('application-documents');
    } else if (/Organizer/i.test(error)) {
      jumpTo('organizer-contact');
    } else {
      setEditSnapshot(structuredClone(form));
      setEditing(true);
      jumpTo('application-details');
    }
  };

  return (
    <div>
      <PageHeader
        title={draftId ? 'Edit Event Application' : 'New Event Application'}
        description="Complete the operational details and supporting evidence used for the official category assessment and AI advisory explanation."
      />

      <nav aria-label="Application progress" className="sticky top-[72px] z-20 mb-5 flex gap-4 overflow-x-auto border border-brand-200 bg-cream-50 p-3 text-sm font-semibold shadow-sm">{[['template-choice', '1. Templates'], ['application-documents', '2. Upload & extract'], ['supporting-evidence', '3. Review & evidence'], ['application-submit', '4. Submit']].map(([id, label]) => <button key={id} type="button" className="min-h-11 shrink-0 underline decoration-brand-300 underline-offset-4" onClick={() => jumpTo(id)}>{label}</button>)}</nav>
      {notice && <div role="status" className="mb-5 rounded-md border border-gold-300 bg-gold-50 p-4 text-sm">{notice}{savedDraft && notice === 'Draft saved.' && <Link className="ml-3 font-bold underline" to={`/organizer/events?status=Draft&highlight=${encodeURIComponent(savedDraft)}`}>View drafts</Link>}</div>}
      <section id="template-choice" tabIndex={-1} style={{ scrollMarginTop: 155 }} className={`mb-6 border ${templateSelection && !templateCompatibilityError ? 'border-brand-200 bg-brand-50' : 'border-gold-300 bg-gold-50'} p-4 sm:p-5`} aria-labelledby="template-choice-heading">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${templateSelection && !templateCompatibilityError ? 'bg-brand-700 text-cream-50' : 'bg-gold-300 text-brand-950'}`}><FileText size={18} /></span>
            <div>
              <h2 id="template-choice-heading" className="font-bold text-ink-800">{templateCompatibilityError ? 'Template recommendation needs attention' : selectedScenario ? 'Two application templates selected' : 'Template recommendation required'}</h2>
              {templateCompatibilityError ? (
                <p className="mt-1 text-sm leading-5 text-ink-600">{templateCompatibilityError}</p>
              ) : selectedScenario ? (
                <p className="mt-1 text-sm leading-5 text-ink-600">{M1_CORE_TEMPLATE.title} + {selectedScenario.title}</p>
              ) : (
                <p className="mt-1 text-sm leading-5 text-ink-600">This draft was created with an earlier application format. Choose a Core and scenario template before submission.</p>
              )}
            </div>
          </div>
          <button
            type="button"
            className="btn-secondary shrink-0"
            disabled={documentPaths.length > 0}
            title={documentPaths.length > 0 ? 'Remove uploaded documents before changing the template recommendation.' : undefined}
            onClick={() => navigate(recommendationUrl)}
          >
            <RotateCcw size={16} /> {documentPaths.length > 0 ? 'Templates locked after upload' : selectedScenario ? 'Change templates' : 'Choose templates'}
          </button>
        </div>
      </section>

      <form onSubmit={handleSubmit} noValidate className="rounded-lg border border-[#ded5c5] bg-[#fffdf8] shadow-card">
        <div className="border-b border-[#e3dacb] bg-brand-50 px-4 py-4 sm:px-6">
          <p className="text-xs font-bold uppercase tracking-[0.07em] text-brand-700">Application {editableVersionId}</p>
          <p className="mt-1 text-sm text-ink-500">
            Fields marked * are required. Save a draft at any time before submission.
            {activeRevision ? ' This edit creates a new immutable version when resubmitted.' : ''}
          </p>
        </div>
        <div className="space-y-8 p-4 sm:p-6 lg:p-8">
          {validationErrors.length > 0 && (
            <div ref={validationRef} tabIndex={-1} style={{ scrollMarginTop: 155 }} className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
              <p className="font-semibold">Required information is missing or needs correction</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {validationErrors.map((error) => <li key={error}><button type="button" className="text-left underline underline-offset-2" onClick={() => reviewError(error)}>{error}</button></li>)}
              </ul>
            </div>
          )}

          {activeRevision && (
            <div className="flex flex-col gap-3 rounded-lg border border-gold-200 bg-gold-50 p-4 text-sm text-gold-700 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-gold-700">{activeRevision.kind === 'rejected_revision' ? 'Correct a rejected application' : 'Editing a submitted application'}</p>
                <p className="mt-1 leading-6">Update this Draft and resubmit it as a new immutable version. Version {activeRevision.sourceVersionId} remains locked.</p>
                {activeRevision.rejectionReason && <p className="mt-2 font-medium">Reason: {activeRevision.rejectionReason}</p>}
                {activeRevision.rejectionSuggestion && <p className="mt-1">Suggested correction: {activeRevision.rejectionSuggestion}</p>}
              </div>
              <OrganizerStatusBadge status="Draft" />
            </div>
          )}

          <fieldset id="application-documents" tabIndex={-1} style={{ scrollMarginTop: 155 }} className="space-y-5 border-t border-[#e3dacb] pt-8">
            <legend className="section-title mb-2 pr-4">Completed application documents</legend>
            <p className="text-sm leading-6 text-ink-500">Upload one combined, text-searchable PDF/DOCX, or upload the completed Core and recommended scenario as PDF/DOCX files separately. STERAS detects both template IDs and Field IDs before auto-filling this form.</p>
            <TemplateUploadCard label="Combined Core + scenario application" document={combinedUpload} uploading={uploading} activeUpload={activeUpload?.role === 'combined_application' ? activeUpload : null} onCancel={cancelUpload} onChange={(event) => handleFiles(event, 'combined_application')} onRemove={removeDocument} onView={viewDocument} />
            <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.08em] text-ink-400"><span className="h-px flex-1 bg-[#e3dacb]" /><span>or upload separately</span><span className="h-px flex-1 bg-[#e3dacb]" /></div>
            <div className="grid gap-4 md:grid-cols-2">
              <TemplateUploadCard label="Core application PDF or DOCX" expectedName={M1_CORE_TEMPLATE.fileName} document={coreUpload} uploading={uploading} activeUpload={activeUpload?.role === 'core_template' ? activeUpload : null} onCancel={cancelUpload} onChange={(event) => handleFiles(event, 'core_template')} onRemove={removeDocument} onView={viewDocument} />
              <TemplateUploadCard label="Scenario-specific PDF or DOCX" expectedName={selectedScenario?.fileName} document={scenarioUpload} uploading={uploading} activeUpload={activeUpload?.role === 'scenario_template' ? activeUpload : null} onCancel={cancelUpload} onChange={(event) => handleFiles(event, 'scenario_template')} onRemove={removeDocument} onView={viewDocument} />
            </div>
            <button type="button" className="btn-primary" disabled={(!combinedUpload && (!coreUpload || !scenarioUpload)) || uploading || extracting} onClick={extractDocuments}>
              <Sparkles size={16} className={extracting ? 'animate-pulse motion-reduce:animate-none' : ''} />{extracting ? 'Extracting documents…' : 'Extract and auto-fill'}
            </button>
            {extraction && (
              <div className="sticky top-[148px] z-10 rounded-lg border border-brand-200 bg-brand-50 p-4 shadow-sm" role="status">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><p className="font-semibold text-ink-900">Auto-fill review</p><p className="mt-1 text-sm text-ink-600">{extraction.extractedFields.length} fields populated from {extraction.rawFieldIds.length} recognised Field IDs.</p></div>
                  <span className="badge bg-white text-brand-700">{extraction.completionPercent}% extracted</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-brand-600" style={{ width: `${extraction.completionPercent}%` }} /></div>
                {extraction.warnings.length > 0 && <div className="mt-4 rounded-md border border-gold-300 bg-gold-50 p-3 text-sm text-gold-700"><p className="font-semibold">Check missing or uncertain responses</p><p className="mt-1">{extraction.warnings.length} item(s) need checking against your uploaded templates.</p><details className="mt-2"><summary className="cursor-pointer font-semibold">Show items to check</summary><ul className="mt-2 list-disc space-y-1 pl-5">{extraction.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details></div>}
                <div className="mt-4 flex gap-3 overflow-x-auto pb-1" aria-label="Auto-filled fields by section">
                  {groupExtractedFields(extraction).map((group) => <div key={group.label} className="min-w-[15rem] rounded-md border border-[#dce3c6] bg-white p-3"><p className="text-xs font-bold uppercase tracking-[0.06em] text-brand-700">{group.label}</p><p className="mt-2 text-sm text-ink-700">{group.count} field{group.count === 1 ? '' : 's'} filled</p></div>)}
                </div>
                <p className="mt-3 text-xs text-ink-500">Compare these details with your uploaded documents. Select Edit details only if something needs correcting.</p>
              </div>
            )}
          </fieldset>

          <section id="application-details" tabIndex={-1} style={{ scrollMarginTop: 155 }} aria-labelledby="application-details-heading">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div><h2 id="application-details-heading" className="section-title">Application details</h2><p className="mt-1 text-sm text-ink-500">Upload and extract your completed templates above. Review the details below; edit only when a correction is needed.</p></div>
              {!editing ? <button type="button" className="btn-secondary" onClick={() => { setEditSnapshot(structuredClone(form)); setEditing(true); }}>Edit details</button> : <div className="flex gap-2"><button type="button" className="btn-secondary" disabled={saving} onClick={() => { if (editSnapshot) setForm(editSnapshot); setSaveMessage(''); setEditing(false); }}>Cancel edits</button><button type="button" className="btn-primary" disabled={saving || uploading || submitting} onClick={async () => { if (await handleSaveDraft()) { setEditing(false); setManuallyEdited(true); } }}>{saving ? 'Saving...' : 'Save details'}</button></div>}
            </div>
            {saveMessage && <p role="status" className="mb-4 text-sm font-semibold text-brand-800">{saveMessage}</p>}
            {!editing && <dl className="grid gap-4 rounded-lg bg-cream-50 p-5 sm:grid-cols-2">{[
              ['Event', form.name], ['Type', form.type], ['Venue', form.venueName], ['Address', form.venueAddress], ['State', form.venueState], ['Attendance / capacity', `${form.expectedAttendance || '—'} / ${form.venueCapacity || '—'}`], ['Starts', form.startDatetime ? new Date(form.startDatetime).toLocaleString() : '—'], ['Ends', form.endDatetime ? new Date(form.endDatetime).toLocaleString() : '—'], ['Environment', form.environment], ['Coverage / seating', `${form.coverage} / ${form.seating}`], ['Coordinates', `${form.venueLocation?.lat ?? '—'}, ${form.venueLocation?.lng ?? '—'}`], ['Description', form.description], ['Emergency plan', form.emergencyPlanSummary], ...Object.entries(form.riskProfile ?? {}).filter(([, value]) => typeof value === 'number').map(([key, value]) => [key.replace(/([A-Z])/g, ' $1'), String(value)]), ['Safety declarations', RISK_PROFILE_OPTIONS.filter(option => form.riskProfile?.[option.key]).map(option => option.label).join(', ') || 'No declarations extracted'],
            ].map(([label, value]) => <div key={label}><dt className="text-xs font-semibold text-ink-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm text-ink-900">{value || 'Not provided'}</dd></div>)}</dl>}
            <fieldset hidden={!editing} disabled={!editing || extracting || saving} className="space-y-8">
          <fieldset className="space-y-5">
            <legend className="section-title mb-5">Event and venue</legend>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="event-name" className="field-label">Event name *</label>
                <input id="event-name" className="input mt-1" required value={form.name} onChange={(e) => update('name', e.target.value)} />
              </div>
              <div>
                <label htmlFor="event-type" className="field-label">Event type *</label>
                <select id="event-type" disabled title="Event type follows the selected template scenario. Change templates before uploading to choose a different scenario." className="input mt-1" value={form.type} onChange={(e) => update('type', e.target.value as EventType)}>
                  {EVENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="venue-registry" className="field-label">Verified venue registry</label>
                <select
                  id="venue-registry"
                  className="input mt-1"
                  value={form.venueId ?? ''}
                  onChange={(e) => {
                    setValidationErrors([]);
                    const venue = venues.find((item) => item.venueId === e.target.value);
                    if (!venue) {
                      setForm((previous) => ({ ...previous, venueId: undefined }));
                      return;
                    }
                    setForm((previous) => bindCanonicalVenue(previous, venue));
                  }}
                >
                  <option value="">Custom / unverified venue</option>
                  {venues.map((venue) => (
                    <option key={venue.venueId} value={venue.venueId}>{venue.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-ink-500">Registry selection supplies the stable venue ID used for capacity and history retrieval.</p>
              </div>
              <div>
                <label htmlFor="venue-name" className="field-label">Venue name *</label>
                <input id="venue-name" className="input mt-1" required disabled={Boolean(form.venueId)} value={form.venueName} onChange={(e) => { setValidationErrors([]); setForm((previous) => ({ ...previous, venueId: undefined, venueName: e.target.value })); }} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="venue-address" className="field-label">Venue address *</label>
                <input id="venue-address" className="input mt-1" required disabled={Boolean(form.venueId)} value={form.venueAddress} onChange={(e) => update('venueAddress', e.target.value)} />
              </div>
              <div>
                <label htmlFor="venue-capacity" className="field-label">Venue capacity *</label>
                <input id="venue-capacity" type="number" min={1} className="input mt-1" required disabled={Boolean(form.venueId)} value={form.venueCapacity || ''} onChange={(e) => update('venueCapacity', Number(e.target.value))} />
              </div>
            </div>

            <div>
              <label htmlFor="venue-state" className="field-label">Venue state *</label>
              <input id="venue-state" className="input mt-1" required disabled={Boolean(form.venueId)} value={form.venueState ?? ''} onChange={(e) => update('venueState', e.target.value)} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="venue-latitude" className="field-label">Latitude *</label>
                <input id="venue-latitude" type="number" step="any" min={-90} max={90} className="input mt-1" required disabled={Boolean(form.venueId)} value={form.venueLocation?.lat ?? ''} onChange={(e) => update('venueLocation', { lat: Number(e.target.value), lng: form.venueLocation?.lng ?? 0 })} />
              </div>
              <div>
                <label htmlFor="venue-longitude" className="field-label">Longitude *</label>
                <input id="venue-longitude" type="number" step="any" min={-180} max={180} className="input mt-1" required disabled={Boolean(form.venueId)} value={form.venueLocation?.lng ?? ''} onChange={(e) => update('venueLocation', { lat: form.venueLocation?.lat ?? 0, lng: Number(e.target.value) })} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="expected-attendance" className="field-label">Expected attendance *</label>
                <input id="expected-attendance" type="number" min={1} className="input mt-1" required value={form.expectedAttendance || ''} onChange={(e) => update('expectedAttendance', Number(e.target.value))} />
                {form.venueCapacity > 0 && form.expectedAttendance > form.venueCapacity && <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">Attendance cannot exceed the declared venue capacity.</p>}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="event-environment" className="field-label">Environment *</label>
                <select id="event-environment" className="input mt-1" value={form.environment} onChange={(e) => update('environment', e.target.value as EventDetails['environment'])}>
                  <option value="indoor">Indoor</option><option value="outdoor">Outdoor</option><option value="mixed">Mixed</option>
                </select>
              </div>
              <div>
                <label htmlFor="event-coverage" className="field-label">Coverage *</label>
                <select id="event-coverage" className="input mt-1" value={form.coverage} onChange={(e) => update('coverage', e.target.value as EventDetails['coverage'])}>
                  <option value="covered">Covered</option><option value="partially_covered">Partially covered</option><option value="uncovered">Uncovered</option>
                </select>
              </div>
              <div>
                <label htmlFor="event-seating" className="field-label">Seating *</label>
                <select id="event-seating" className="input mt-1" value={form.seating} onChange={(e) => update('seating', e.target.value as EventDetails['seating'])}>
                  <option value="seated">Seated</option><option value="standing">Standing</option><option value="mixed">Mixed</option>
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="start-datetime" className="field-label">Start date and time *</label>
                <input id="start-datetime" type="datetime-local" className="input mt-1" required value={toDatetimeLocal(form.startDatetime)} onChange={(e) => update('startDatetime', fromDatetimeLocal(e.target.value))} />
              </div>
              <div>
                <label htmlFor="end-datetime" className="field-label">End date and time *</label>
                <input id="end-datetime" type="datetime-local" className="input mt-1" required value={toDatetimeLocal(form.endDatetime)} onChange={(e) => update('endDatetime', fromDatetimeLocal(e.target.value))} />
              </div>
            </div>

            <div>
              <label htmlFor="event-description" className="field-label">Description <span className="font-normal text-ink-400">(optional)</span></label>
              <textarea id="event-description" className="input mt-1" rows={3} maxLength={2000} value={form.description} onChange={(e) => update('description', e.target.value)} />
            </div>
            <div>
              <label htmlFor="emergency-plan" className="field-label">Emergency plan summary *</label>
              <textarea id="emergency-plan" className="input mt-1" rows={3} maxLength={2000} required value={form.emergencyPlanSummary} onChange={(e) => update('emergencyPlanSummary', e.target.value)} />
            </div>
          </fieldset>

          <fieldset className="space-y-4 border-t border-[#e3dacb] pt-8">
            <legend className="section-title mb-2 pr-4">Event safety details</legend>
            <p className="text-sm leading-6 text-ink-500">
              These details describe the crowd, venue and planned activities. They are extracted from your templates and help reviewers assess event safety.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {RISK_PROFILE_OPTIONS.map(({ key, label }) => (
                <label key={key} className="flex min-h-12 items-center gap-3 border border-[#ded5c5] bg-cream-50 px-3 py-2 text-sm text-ink-700">
                  <input
                    type="checkbox"
                    checked={Boolean(form.riskProfile?.[key])}
                    onChange={(event) => updateRiskProfile(key, event.target.checked)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="vulnerable-attendees" className="field-label">Vulnerable attendees estimate (%)</label>
                <input id="vulnerable-attendees" type="number" min={0} max={100} required className="input mt-1" value={form.riskProfile?.vulnerableAttendeesPercent ?? ''} onChange={(event) => updateRiskProfile('vulnerableAttendeesPercent', Number(event.target.value))} />
              </div>
              <div>
                <label htmlFor="standing-attendees" className="field-label">Standing attendees estimate (%)</label>
                <input id="standing-attendees" type="number" min={0} max={100} required className="input mt-1" value={form.riskProfile?.standingAttendeesPercent ?? ''} onChange={(event) => updateRiskProfile('standingAttendeesPercent', Number(event.target.value))} />
              </div>
              <div>
                <label htmlFor="hospital-travel" className="field-label">Nearest hospital travel time (minutes)</label>
                <input id="hospital-travel" type="number" min={0} max={240} className="input mt-1" value={form.riskProfile?.nearestHospitalTravelMinutes ?? ''} onChange={(event) => updateRiskProfile('nearestHospitalTravelMinutes', Number(event.target.value))} />
              </div>
            </div>
          </fieldset>

            </fieldset>
          </section>

          <fieldset id="supporting-evidence" tabIndex={-1} style={{ scrollMarginTop: 155 }} className="space-y-4 border-t border-[#e3dacb] pt-8">
            <legend className="section-title mb-2 pr-4">Supporting evidence</legend>
            <p className="text-sm leading-6 text-ink-500">Complete every Core and scenario checklist item. A current PDF, DOCX, or image can support more than one requirement; conditional items need either evidence or a clear not-applicable reason.</p>
            <div className="sticky top-[148px] z-10 rounded-lg border border-brand-200 bg-brand-50 p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-ink-900">Evidence completeness</p><span className="badge bg-white text-brand-700">{completeEvidenceCount} / {requiredEvidenceCount} evidence items linked · {validNotApplicable.length} not applicable</span></div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-brand-600" style={{ width: `${requiredEvidenceCount ? Math.round((completeEvidenceCount / requiredEvidenceCount) * 100) : 100}%` }} /></div>
            </div>
            <div className="rounded-lg border border-cream-200 p-4"><p className="text-sm text-ink-600">Upload supporting files together, then select the matching file for each requirement below. Check the document contents; filenames alone do not prove that evidence is correct.</p><label className="btn-secondary mt-3 cursor-pointer">Upload supporting files<input type="file" multiple accept=".pdf,.docx,.jpg,.jpeg,.png,.webp" disabled={uploading} onChange={event => handleFiles(event, 'supporting_evidence')} className="sr-only" /></label>{activeUpload?.role === 'supporting_evidence' && !activeUpload.requirementId && <UploadProgress upload={activeUpload} onCancel={cancelUpload} />}<ul className="mt-3 space-y-2">{supportingUploads.map(file => <li key={file.path} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="break-all">{file.originalName}</span><div><button type="button" className="btn-secondary" onClick={() => viewDocument(file.path)}>View</button><button type="button" className="btn-secondary ml-2" onClick={() => removeDocument(file.path)}>Remove</button></div></li>)}</ul></div>
            <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={onlyMissing} onChange={event => setOnlyMissing(event.target.checked)} />Only show missing evidence</label>
            <div className="space-y-4">
              {onlyMissing && completeEvidenceCount + validNotApplicable.length === evidenceDefinitions.length && <p role="status" className="rounded-md bg-brand-50 p-4 text-sm">All evidence items are complete. Turn off the filter to review them.</p>}
              {evidenceDefinitions.map((definition) => {
                const guidance = evidenceGuidance.get(definition.id);
                const response = evidenceManifest.find((item) => item.requirementId === definition.id)
                  ?? { requirementId: definition.id, applicability: 'not_applicable' as const, notApplicableReason: '' };
                const forcedRequired = isM1EvidenceForcedRequired(definition, form.riskProfile);
                const assigned = supportingUploads.find((document) => document.path === response.documentPath);
                const complete = Boolean(assigned && response.applicability === 'required') || validNotApplicable.some(item => item.id === definition.id);
                if (onlyMissing && complete) return null;
                return <article id={`evidence-${definition.id}`} tabIndex={-1} style={{ scrollMarginTop: 290 }} key={definition.id} className="rounded-lg border border-[#ded5c5] bg-cream-50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-brand-700">{definition.id}</span><span className="badge bg-white text-ink-600">{definition.source === 'core' ? 'Core' : 'Scenario'}</span>{forcedRequired && <span className="badge bg-red-50 text-red-700">Required</span>}</div><h3 className="mt-2 font-semibold text-ink-900">{guidance?.title ?? definition.id}</h3><p className="mt-1 text-sm leading-5 text-ink-500">{guidance?.condition ?? 'Review whether this evidence applies to the event.'}</p></div>
                    {!forcedRequired && <select aria-label={`${definition.id} applicability`} className="input w-full sm:w-48" value={response.applicability} onChange={(event) => updateEvidenceResponse(definition.id, event.target.value === 'required'
                      ? { requirementId: definition.id, applicability: 'required', ...(response.documentPath ? { documentPath: response.documentPath } : {}) }
                      : { requirementId: definition.id, applicability: 'not_applicable', notApplicableReason: '' })}><option value="required">Applies — evidence required</option><option value="not_applicable">Not applicable</option></select>}
                  </div>
                  {response.applicability === 'not_applicable' && !forcedRequired ? <div className="mt-4"><label className="field-label" htmlFor={`reason-${definition.id}`}>Why this does not apply *</label><textarea id={`reason-${definition.id}`} className="input mt-1 min-h-20" maxLength={500} value={response.notApplicableReason ?? ''} onChange={(event) => updateEvidenceResponse(definition.id, { requirementId: definition.id, applicability: 'not_applicable', notApplicableReason: event.target.value })} /></div> : <div className="mt-4 space-y-3">
                    {assigned ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-brand-200 bg-white px-3 py-2 text-sm"><span className="min-w-0 truncate font-medium text-ink-800">{assigned.originalName}</span><div className="flex gap-1"><button type="button" className="min-h-11 px-3 font-semibold text-brand-700" onClick={() => viewDocument(assigned.path)}>View</button><button type="button" className="min-h-11 px-3 font-semibold text-red-700" onClick={() => updateEvidenceResponse(definition.id, { requirementId: definition.id, applicability: 'required' })}>Remove</button></div></div> : <p className="text-sm font-medium text-red-700">No evidence file linked.</p>}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      {supportingUploads.length > 0 && <select aria-label={`${definition.id} existing evidence`} className="input min-w-0 flex-1" value={response.documentPath ?? ''} onChange={(event) => updateEvidenceResponse(definition.id, { requirementId: definition.id, applicability: 'required', ...(event.target.value ? { documentPath: event.target.value } : {}) })}><option value="">Choose an uploaded file</option>{supportingUploads.map((document) => <option key={document.path} value={document.path}>{document.originalName}</option>)}</select>}
                      <label className="btn-secondary cursor-pointer justify-center"><span>{assigned ? 'Replace file' : 'Upload file'}</span><input type="file" accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp,.pdf,.docx" disabled={uploading} onChange={(event) => handleFiles(event, 'supporting_evidence', definition.id)} className="sr-only" /></label>
                    </div>
                    {activeUpload?.role === 'supporting_evidence' && activeUpload.requirementId === definition.id && <UploadProgress upload={activeUpload} onCancel={cancelUpload} />}
                  </div>}
                </article>;
              })}
            </div>
            {legacySupportingPaths.length > 0 && <div className="rounded-md border border-gold-200 bg-gold-50 p-3"><p className="text-xs font-semibold text-gold-700">Previously uploaded supporting files</p><ul className="mt-2 divide-y divide-gold-200">{legacySupportingPaths.map((path) => <li key={path} className="flex items-center justify-between gap-3 py-2 text-sm"><span className="min-w-0 truncate">{legacyDocumentName(path)}</span><div className="flex"><button type="button" onClick={() => viewDocument(path)} className="min-h-11 px-2 font-semibold text-brand-700">View</button><button type="button" onClick={() => removeDocument(path)} className="min-h-11 px-2 font-semibold text-red-700">Remove</button></div></li>)}</ul></div>}
          </fieldset>

          <fieldset id="organizer-contact" tabIndex={-1} style={{ scrollMarginTop: 155 }} className="space-y-4 border-t border-[#e3dacb] pt-8">
            <legend className="section-title mb-2 pr-4">Organizer contact</legend><p className="text-sm text-ink-500">These details are linked to your account. <Link className="font-semibold text-brand-700 underline" to="/organizer/profile">Edit profile</Link> to update them.</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="organizer-name" className="field-label">Organizer name *</label>
                <input id="organizer-name" className="input mt-1" required value={form.organizerName} readOnly />
              </div>
              <div>
                <label htmlFor="organizer-email" className="field-label">Email *</label>
                <input id="organizer-email" type="email" className="input mt-1" required value={form.organizerEmail} readOnly />
              </div>
              <div>
                <label htmlFor="organizer-phone" className="field-label">Phone *</label>
                <input id="organizer-phone" type="tel" className="input mt-1" required value={form.organizerPhone} readOnly />
              </div>
            </div>
          </fieldset>

          <div id="application-submit" tabIndex={-1} style={{ scrollMarginTop: 155 }} className="-mx-4 flex flex-wrap justify-end gap-2 border-t border-[#d8cebd] bg-[#fffdf8] px-4 pb-1 pt-4 sm:mx-0 sm:px-0">
            {validationErrors.length > 0 && <button type="button" className="w-full text-left text-sm font-semibold text-red-700 underline" onClick={() => { validationRef.current?.focus(); validationRef.current?.scrollIntoView({ block: 'start' }); }}>Review {validationErrors.length} items before submitting.</button>}
            {saveMessage && <p role="status" className="w-full text-sm">{saveMessage}</p>}
            <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
            <button type="button" disabled={saving || submitting || uploading} className="btn-secondary" onClick={() => { void handleSaveDraft(); }}>{saving ? 'Saving...' : 'Save draft'}</button>
            <button type="submit" disabled={submitting || saving || uploading || extracting || editing} className="btn-primary">
              {submitting ? 'Submitting…' : activeRevision ? 'Submit new version' : 'Submit application'}
            </button>
          </div>
        </div>
      </form>
      {previewPath && <EvidencePreview path={previewPath} onClose={() => setPreviewPath('')} />}

    </div>
  );
}

function legacyDocumentName(path: string): string {
  const value = path.split('/').pop() ?? 'supporting-file';
  try {
    return decodeURIComponent(value).replace(/^[0-9a-f]{8}-[0-9a-f-]{27}-/i, '');
  } catch {
    return 'supporting-file';
  }
}

function TemplateUploadCard({ label, expectedName, document, uploading, activeUpload, onCancel, onChange, onRemove, onView }: {
  label: string;
  expectedName?: string;
  document?: M1DraftDocument;
  uploading: boolean;
  activeUpload: ActiveUpload | null;
  onCancel: () => void;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: (path: string) => void;
  onView: (path: string) => void;
}) {
  return <div className={`rounded-lg border p-4 ${document ? 'border-brand-200 bg-brand-50' : 'border-[#ded5c5] bg-cream-50'}`}>
    <div className="flex items-start gap-3"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${document ? 'bg-brand-700 text-white' : 'bg-cream-200 text-ink-500'}`}>{document ? <FileCheck2 size={17} /> : <FileText size={17} />}</span><div className="min-w-0"><p className="text-sm font-semibold text-ink-900">{label}</p><p className="mt-1 truncate text-xs text-ink-500">{document?.originalName ?? 'No completed file uploaded'}</p>{expectedName && <p className="mt-1 text-xs text-ink-500">Expected: {expectedName}</p>}</div></div>
    <div className="mt-4 flex flex-wrap gap-2">
      <label className="btn-secondary cursor-pointer"><span>{document ? 'Replace PDF/DOCX' : 'Upload PDF/DOCX'}</span><input type="file" accept={APPLICATION_DOCUMENT_ACCEPT} disabled={uploading} onChange={onChange} className="sr-only" /></label>
      {document && <button type="button" className="btn-secondary" onClick={() => onView(document.path)}>View</button>}
      {document && <button type="button" className="min-h-11 px-3 text-sm font-semibold text-red-700" onClick={() => onRemove(document.path)}>Remove</button>}
    </div>
    {activeUpload && <UploadProgress upload={activeUpload} onCancel={onCancel} />}
  </div>;
}

function UploadProgress({ upload, onCancel }: { upload: ActiveUpload; onCancel: () => void }) {
  return <div className="mt-3" role="status" aria-label={`Uploading ${upload.fileName}`}>
    <div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="min-w-0 truncate font-medium text-ink-700">Uploading {upload.fileName}</span><button type="button" className="min-h-11 shrink-0 px-2 font-semibold text-red-700 underline" onClick={onCancel}>Cancel</button></div>
    <div className="h-2 overflow-hidden rounded-full bg-cream-200" aria-label={`${upload.progress}% uploaded`}><div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${upload.progress}%` }} /></div>
  </div>;
}

function groupExtractedFields(extraction: M1DocumentExtraction): Array<{ label: string; count: number }> {
  const groups = [
    { label: 'Event', targets: ['name', 'description', 'expectedAttendance', 'venueCapacity'] },
    { label: 'Schedule and venue', targets: ['venueName', 'venueAddress', 'startDatetime', 'endDatetime'] },
    { label: 'Organizer', targets: ['organizerName', 'organizerEmail', 'organizerPhone'] },
    { label: 'Safety and risk', targets: ['emergencyPlanSummary', 'riskProfile.'] },
  ];
  return groups.map((group) => ({
    label: group.label,
    count: extraction.extractedFields.filter((field) => group.targets.some((target) => target.endsWith('.') ? field.target.startsWith(target) : field.target === target)).length,
  })).filter((group) => group.count > 0);
}

const RISK_PROFILE_OPTIONS: Array<{
  key: keyof Pick<
    EventRiskProfile,
    | 'internationalAttendees'
    | 'alcoholServed'
    | 'foodServed'
    | 'freeDrinkingWater'
    | 'ticketedEntry'
    | 'overnightAccommodation'
    | 'pyrotechnics'
    | 'temporaryStructures'
    | 'rivalryOrTensionExpected'
    | 'crowdManagementPlan'
    | 'trafficManagementPlan'
    | 'severeWeatherPlan'
    | 'medicalPlan'
    | 'evacuationPlanTested'
    | 'authorityCoordinationConfirmed'
  >;
  label: string;
}> = [
  { key: 'internationalAttendees', label: 'International attendees expected' },
  { key: 'alcoholServed', label: 'Alcohol served' },
  { key: 'foodServed', label: 'Food served' },
  { key: 'freeDrinkingWater', label: 'Free drinking water planned' },
  { key: 'ticketedEntry', label: 'Ticketed entry or attendee registration' },
  { key: 'overnightAccommodation', label: 'Overnight accommodation involved' },
  { key: 'pyrotechnics', label: 'Pyrotechnics or special effects' },
  { key: 'temporaryStructures', label: 'Temporary stages or structures' },
  { key: 'rivalryOrTensionExpected', label: 'Rivalry or crowd tension expected' },
  { key: 'crowdManagementPlan', label: 'Crowd management plan declared' },
  { key: 'trafficManagementPlan', label: 'Traffic management plan declared' },
  { key: 'severeWeatherPlan', label: 'Severe weather plan declared' },
  { key: 'medicalPlan', label: 'Medical plan declared' },
  { key: 'evacuationPlanTested', label: 'Evacuation plan tested' },
  { key: 'authorityCoordinationConfirmed', label: 'Authority coordination confirmed' },
];
