/**
 * Stage2RequirementRow — M3 Workstream 4 organizer row.
 *
 *   A single Stage 2 image row in the organizer's `OrganizerEventControls`
 *   page. Renders the current state (pending | published | reported) and
 *   the appropriate action buttons (Upload | Replace | View).
 *
 *   Singleton per control: docId = `${controlId}-s2`. Re-upload
 *   overwrites the prior image. The server refuses replace if
 *   `m4TicketId` is set on the prior doc (organizer must wait for
 *   M4's outcome to clear the ticket).
 *
 *   Mirrors the Stage 1 row's file picker + size guard pattern.
 */
import { useState, useRef, type ChangeEvent } from 'react';
import { httpsCallable } from 'firebase/functions';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Image as ImageIcon,
  Replace,
  Upload,
} from 'lucide-react';
import { functions } from '../../config/firebase';
import type { Stage2Doc } from '@shared/types';

export interface Stage2RequirementRowProps {
  eventId: string;
  controlId: string;
  authority: string;
  label: string;
  /** The current Stage 2 doc from Firestore. Null if not yet uploaded. */
  doc: Stage2Doc | null;
  disabled?: boolean;
  onSubmitted?: (result: { docId: string; status: 'published' }) => void;
  onError?: (message: string) => void;
}

const MAX_FILE_BYTES = 700 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png'];

export default function Stage2RequirementRow(props: Stage2RequirementRowProps) {
  const { eventId, controlId, authority, label, doc, disabled = false, onSubmitted, onError } = props;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const isBusy = disabled || submitting;

  const reported = !!doc?.m4TicketId;
  const published = !!doc?.published;
  // Workstream 5: an admin may reject the image pre-publish. The
  // rejection fields are set on the doc so the organizer can see
  // why + re-upload. We treat `published: false + rejectionReason`
  // as the "rejected" state for the row.
  const rejected = !published && !!doc?.rejectionReason;
  const pending = !published && !rejected;
  const imageUrl = doc?.imageUrl;

  async function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      const msg = `File too large: ${(file.size / 1024).toFixed(0)} KB. Max ${MAX_FILE_BYTES / 1024} KB. Compress and re-upload.`;
      setErrorMessage(msg);
      onError?.(msg);
      return;
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      const msg = `Unsupported file type: ${file.type || 'unknown'}. Allowed: JPEG, PNG.`;
      setErrorMessage(msg);
      onError?.(msg);
      return;
    }
    setSubmitting(true);
    setErrorMessage('');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const base64 = dataUrl.split(',', 2)[1];
      const fn = httpsCallable<{ eventId: string; controlId: string; fileName: string; mimeType: string; fileBase64: string }, { status: 'pending'; docId: string }>(functions, 'submitStage2Doc');
      const result = await fn({ eventId, controlId, fileName: file.name, mimeType: file.type, fileBase64: base64 });
      onSubmitted?.({ docId: result.data.docId, status: 'pending' });
    } catch (err) {
      const msg = errorMessageFrom(err);
      setErrorMessage(msg);
      onError?.(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="rounded-md border border-ink-200 bg-white p-3"
      data-testid={`stage2-row-${authority}`}
      data-status={reported ? 'reported' : published ? 'published' : rejected ? 'rejected' : pending && imageUrl ? 'pending' : 'pending_upload'}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge bg-blue-100 text-brand-700 text-xs font-medium">Stage 2</span>
            <span className="text-sm font-medium text-ink-800">{label}</span>
            {reported && (
              <span className="badge bg-red-100 text-red-700 text-xs" data-testid={`stage2-reported-badge-${authority}`}>
                <AlertTriangle size={11} className="mr-0.5 inline" /> Reported to M4
              </span>
            )}
            {published && !reported && (
              <span className="badge bg-status-approved/15 text-status-approved text-xs">
                <CheckCircle2 size={11} className="mr-0.5 inline" /> Published
              </span>
            )}
            {rejected && !reported && (
              <span className="badge bg-red-100 text-red-700 text-xs" data-testid={`stage2-rejected-badge-${authority}`}>
                <AlertTriangle size={11} className="mr-0.5 inline" /> Rejected by admin
              </span>
            )}
            {pending && !reported && imageUrl && (
              <span className="badge bg-amber-100 text-amber-800 text-xs" data-testid={`stage2-pending-badge-${authority}`}>
                <Clock size={11} className="mr-0.5 inline" /> Pending admin review
              </span>
            )}
            {pending && !reported && !imageUrl && (
              <span className="badge bg-ink-100 text-ink-600 text-xs">
                <Clock size={11} className="mr-0.5 inline" /> Awaiting upload
              </span>
            )}
          </div>
          {imageUrl && (
            <div className="mt-2 flex items-center gap-2 text-xs text-ink-500">
              <ImageIcon size={14} className="text-ink-400" />
              <a
                href={imageUrl}
                target="_blank"
                rel="noreferrer"
                className="text-brand-700 hover:text-brand-800 underline"
                data-testid={`stage2-view-link-${authority}`}
              >
                View uploaded image
              </a>
              {doc?.publicConfirmCount !== undefined && (
                <span className="ml-2" data-testid={`stage2-confirm-count-${authority}`}>
                  · {doc.publicConfirmCount} confirm{doc.publicConfirmCount === 1 ? '' : 's'} from the public
                </span>
              )}
            </div>
          )}
          {rejected && doc?.rejectionReason && (
            <div className="mt-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-800" data-testid={`stage2-rejection-reason-${authority}`}>
              <div className="font-semibold">Admin feedback:</div>
              <div className="mt-0.5">{doc.rejectionReason}</div>
            </div>
          )}
          {errorMessage && (
            <div className="mt-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-800" role="alert">
              {errorMessage}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-stretch">
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_MIME.join(',')}
            className="hidden"
            onChange={handleFileSelected}
            disabled={isBusy}
            data-testid={`stage2-file-input-${authority}`}
          />
          {!published && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50"
              data-testid={`stage2-upload-${authority}`}
            >
              <Upload size={14} />
              Upload
            </button>
          )}
          {published && !reported && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
              data-testid={`stage2-replace-${authority}`}
            >
              <Replace size={14} />
              Replace
            </button>
          )}
          {reported && (
            <span className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-medium text-ink-700">
              Replace disabled (M4 ticket open)
            </span>
          )}
          {rejected && !reported && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
              data-testid={`stage2-replace-${authority}`}
            >
              <Replace size={14} />
              Re-upload
            </button>
          )}
          {pending && !reported && imageUrl && !rejected && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
              data-testid={`stage2-replace-${authority}`}
            >
              <Replace size={14} />
              Replace
            </button>
          )}
        </div>
      </div>
    </div>
  );
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
    if (e.code && e.message) return e.message;
    if (e.message) return e.message;
    if (e.details) return String(e.details);
  }
  return String(err);
}
