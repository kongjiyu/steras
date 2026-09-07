import { documentMime } from '../../utils/documentMime';
import { useEffect, useRef, useState } from 'react';
import { getBlob, ref } from 'firebase/storage';
import { storage } from '../../config/firebase';

/** Authenticated, in-page preview: no popup permission or public URL required. */
export default function EvidencePreview({ path, onClose }: { path: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<{ url: string; type: string }>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let active = true;
    let url = '';
    setFile(undefined);
    setError('');
    getBlob(ref(storage, path), 10 * 1024 * 1024).then(async blob => {
      const type = documentMime(new Uint8Array(await blob.slice(0, 16).arrayBuffer())) ?? 'application/octet-stream';
      if (!active) return;
      url = URL.createObjectURL(new Blob([blob], { type }));
      setFile({ url, type });
    }).catch(() => { if (active) setError('This file could not be opened. Check your connection and access, then retry.'); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [path, retry]);
  return <dialog ref={dialog} onCancel={onClose} className="m-0 ml-auto h-dvh max-h-none w-full max-w-3xl bg-cream-50 p-0 text-ink-900 backdrop:bg-black/40" aria-labelledby="evidence-preview-title">
    <header className="flex items-center justify-between gap-4 border-b p-4"><h2 id="evidence-preview-title" className="min-w-0 truncate font-semibold">Document preview</h2><button type="button" className="btn-secondary" onClick={onClose}>Close</button></header>
    <div className="p-4">{error ? <div role="alert">{error}<button type="button" className="btn-secondary mt-3" onClick={() => setRetry(value => value + 1)}>Retry</button></div> : !file ? <p role="status">Opening document…</p> : <>
      <a href={file.url} download={path.split('/').pop()} className="btn-secondary mb-4">Download file</a>
      {file.type.startsWith('image/') ? <img src={file.url} alt="Uploaded supporting document" className="h-auto max-w-full" /> : file.type === 'application/pdf' ? <iframe title="Uploaded PDF" src={file.url} className="h-[75dvh] w-full border-0" /> : <p>Preview is unavailable for this file format. Download it to view the document.</p>}
    </>}</div>
  </dialog>;
}
