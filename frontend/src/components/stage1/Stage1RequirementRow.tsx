/**
 * Stage1RequirementRow — M3 Workstream 3
 *
 * A single Stage 1 document row in the organizer's `OrganizerEventControls`
 * page. Renders the current status (pending_submission | pending_verification
 * | verified | rejected | use_previous) and the appropriate action
 * buttons (Upload | Use Previous | Replace | Resubmit | View).
 *
 * Per the M3 owner decision 2026-08-19, "Use Previous" is a one-click
 * flag (no source-event picker) available only for `docType: 'receipt'`
 * (A25). Stage 2 is the public verification backstop.
 *
 * Reused later (Workstream 5 publish) by the admin and officer UIs when
 * they need to show the same per-row state.
 */
import { useState, useRef, type ChangeEvent } from 'react';
import { httpsCallable } from 'firebase/functions';
import {
  CheckCircle2,
  Circle,
  Clock,
  FileWarning,
  Image as ImageIcon,
  Replace,
  RotateCcw,
  Upload,
  XCircle,
} from 'lucide-react';
import { functions } from '../../config/firebase';
import type { Stage1Doc } from '@shared/types';
import { safeStage1DocumentHref } from './safeDocumentLink';

export interface Stage1Requirement {
  docId: string;
  docType: 'receipt' | 'application' | 'floor_plan' | 'license' | 'insurance' | 'other';
  label: string;
  required: boolean;
}

export interface Stage1RequirementRowProps {
  eventId: string;
  controlId: string;
  requirement: Stage1Requirement;
  /** The current doc from Firestore (status, filePath, etc.). Null if
   *  not yet submitted (pending_submission). */
  doc: Stage1Doc | null;
  /** Disable all interactions (e.g. when the admin hasn't published the
   *  list yet, or when the event is not editable). */
  disabled?: boolean;
  /** Disable just the "submit" actions (file picker + Use Previous),
   *  but keep "View" working. Useful while a submit is in flight. */
  busy?: boolean;
  /** Called after a successful submit so the parent can refresh or show
   *  a toast. */
  onSubmitted?: (result: { status: Stage1Doc['status'] }) => void;
  /** Called on submit error so the parent can show a toast. */
  onError?: (message: string) => void;
}

const MAX_FILE_BYTES = 700 * 1024; // mirrors the Cloud Function gate
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'application/pdf'];
const ALLOWED_LABEL: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'application/pdf': 'PDF',
};

const DOC_TYPE_LABEL: Record<Stage1Requirement['docType'], string> = {
  receipt: 'Receipt',
  application: 'Application',
  floor_plan: 'Floor plan',
  license: 'License',
  insurance: 'Insurance',
  other: 'Other',
};

export default function Stage1RequirementRow(props: Stage1RequirementRowProps) {
  const { eventId, controlId, requirement, doc, disabled = false, busy = false, onSubmitted, onError } = props;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const status: Stage1Doc['status'] = doc?.status ?? 'pending_submission';
  const isReceipt = requirement.docType === 'receipt';
  const isEffectivelyBusy = busy || submitting;

  async function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Always reset the input so the same file can be re-selected.
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      const msg = `File too large: ${(file.size / 1024).toFixed(0)} KB. Max ${MAX_FILE_BYTES / 1024} KB. Compress and re-upload.`;
      setErrorMessage(msg);
      onError?.(msg);
      return;
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      const msg = `Unsupported file type: ${file.type || 'unknown'}. Allowed: ${Object.values(ALLOWED_LABEL).join(', ')}.`;
      setErrorMessage(msg);
      onError?.(msg);
      return;
    }
    setSubmitting(true);
    setErrorMessage('');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      // Strip the "data:<mime>;base64," prefix — the Cloud Function adds
      // it back when constructing filePath.
      const base64 = dataUrl.split(',', 2)[1];
      const fn = httpsCallable<{ eventId: string; controlId: string; docId: string; fileName: string; mimeType: string; fileBase64: string }, { status: Stage1Doc['status'] }>(functions, 'submitStage1Doc');
      const result = await fn({ eventId, controlId, docId: requirement.docId, fileName: file.name, mimeType: file.type, fileBase64: base64 });
      onSubmitted?.(result.data);
    } catch (err) {
      const msg = errorMessageFrom(err);
      setErrorMessage(msg);
      onError?.(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUsePrevious() {
    if (!isReceipt) return;
    if (!window.confirm('Mark this receipt as "Use Previous"? The public verification step remains available—if the item is not actually at the venue, the public can report it through Incident reporting.')) {
      return;
    }
    setSubmitting(true);
    setErrorMessage('');
    try {
      const fn = httpsCallable<{ eventId: string; controlId: string; docId: string; usePrevious: boolean }, { status: Stage1Doc['status'] }>(functions, 'submitStage1Doc');
      const result = await fn({ eventId, controlId, docId: requirement.docId, usePrevious: true });
      onSubmitted?.(result.data);
    } catch (err) {
      const msg = errorMessageFrom(err);
      setErrorMessage(msg);
      onError?.(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  return (
    <div
      className="rounded-md border border-ink-200 bg-white p-3"
      data-testid={`stage1-row-${requirement.docId}`}
      data-status={status}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge bg-ink-100 text-ink-700 text-xs font-medium">
              {DOC_TYPE_LABEL[requirement.docType] ?? requirement.docType}
            </span>
            <span className="text-sm font-medium text-ink-800">{requirement.label}</span>
            {requirement.required && (
              <span className="badge bg-amber-100 text-amber-800 text-xs">Required</span>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-500">
            <StatusIcon status={status} />
            <span data-testid={`stage1-status-${requirement.docId}`}>
              <StatusText status={status} doc={doc} />
            </span>
          </div>
          {status === 'rejected' && doc?.rejectionReason && (
            <div className="mt-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">
              <div className="font-semibold">Officer feedback:</div>
              <div className="mt-0.5">{doc.rejectionReason}</div>
              {doc.rejectionSuggestion && (
                <div className="mt-1 italic text-red-700">Suggestion: {doc.rejectionSuggestion}</div>
              )}
            </div>
          )}
          {errorMessage && (
            <div className="mt-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-800" role="alert">
              {errorMessage}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-stretch">
          {/* Hidden file input, triggered by the buttons below. */}
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_MIME.join(',')}
            className="hidden"
            onChange={handleFileSelected}
            disabled={disabled || isEffectivelyBusy}
            data-testid={`stage1-file-input-${requirement.docId}`}
          />
          {renderActions({
            status,
            isReceipt,
            filePath: doc?.filePath,
            disabled: disabled || isEffectivelyBusy,
            onUpload: openFilePicker,
            onUsePrevious: handleUsePrevious,
          })}
        </div>
      </div>
    </div>
  );
}

interface ActionsProps {
  status: Stage1Doc['status'];
  isReceipt: boolean;
  filePath?: string;
  disabled: boolean;
  onUpload: () => void;
  onUsePrevious: () => void;
}

function renderActions({ status, isReceipt, filePath, disabled, onUpload, onUsePrevious }: ActionsProps) {
  const safeFilePath = safeStage1DocumentHref(filePath);
  const uploadBtn = (label: string, icon: React.ReactNode, testid: string, key: string) => (
    <button
      key={key}
      type="button"
      onClick={onUpload}
      disabled={disabled}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50"
      data-testid={testid}
    >
      {icon}
      {label}
    </button>
  );
  const previousButton = (label: string, testid: string, key: string) => (
    <button
      key={key}
      type="button"
      onClick={onUsePrevious}
      disabled={disabled}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
      data-testid={testid}
    >
      <RotateCcw size={14} />
      {label}
    </button>
  );
  const viewLink = (label: string, href: string, key: string) => (
    <a
      key={key}
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
      data-testid={`stage1-view-${key}`}
    >
      <ImageIcon size={14} />
      {label}
    </a>
  );

  switch (status) {
    case 'pending_submission':
      return (
        <>
          {uploadBtn('Upload', <Upload size={14} />, 'stage1-upload', 'upload')}
          {isReceipt && previousButton('Use Previous', 'stage1-use-previous', 'use-previous')}
        </>
      );
    case 'pending_verification':
      return (
        <>
          {safeFilePath ? viewLink('View', safeFilePath, 'pending') : viewLink('Unavailable', '#', 'pending')}
          {uploadBtn('Replace', <Replace size={14} />, 'stage1-replace', 'replace')}
        </>
      );
    case 'rejected':
      return (
        <>
          {uploadBtn('Resubmit', <Upload size={14} />, 'stage1-resubmit', 'resubmit')}
          {isReceipt && previousButton('Use Previous', 'stage1-use-previous', 'use-previous')}
        </>
      );
    case 'use_previous':
      return (
        <span className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-medium text-ink-700">
          <CheckCircle2 size={14} className="text-ink-500" />
          Marked as Use Previous
        </span>
      );
    case 'verified':
      return (
        <span className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-status-approved/10 px-3 py-1.5 text-xs font-medium text-status-approved">
          <CheckCircle2 size={14} />
          Verified
        </span>
      );
    default:
      return null;
  }
}

function StatusIcon({ status }: { status: Stage1Doc['status'] }) {
  switch (status) {
    case 'pending_submission':
      return <Circle size={14} className="text-ink-400" />;
    case 'pending_verification':
      return <Clock size={14} className="text-amber-500" />;
    case 'verified':
      return <CheckCircle2 size={14} className="text-status-approved" />;
    case 'rejected':
      return <XCircle size={14} className="text-red-500" />;
    case 'use_previous':
      return <CheckCircle2 size={14} className="text-ink-500" />;
    default:
      return <FileWarning size={14} className="text-ink-400" />;
  }
}

function StatusText({ status, doc }: { status: Stage1Doc['status']; doc: Stage1Doc | null }) {
  switch (status) {
    case 'pending_submission':
      return <span className="text-ink-500">Not uploaded yet</span>;
    case 'pending_verification':
      return <span className="text-amber-700">Awaiting officer verification</span>;
    case 'verified': {
      const when = doc?.verifiedAt ? new Date(doc.verifiedAt).toLocaleDateString() : '';
      return <span className="text-status-approved">Verified{when ? ` on ${when}` : ''}</span>;
    }
    case 'rejected':
      return <span className="text-red-700">Rejected — see feedback below</span>;
    case 'use_previous':
      return <span className="text-ink-700">Marked as Use Previous — no upload required</span>;
    default:
      return <span className="text-ink-500">—</span>;
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

function errorMessageFrom(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const e = err as { code?: string; message?: string; details?: unknown };
    if (e.code && e.message) return `${e.message}`;
    if (e.message) return e.message;
    if (e.details) return String(e.details);
  }
  return String(err);
}
